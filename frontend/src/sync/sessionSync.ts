// Saves one workout set to the backend without losing reps (CLAUDE.md §7, T-26).
//
// - creates the session, retrying until the backend answers
// - sends each completed rep in order as soon as it happens (reps show up in Adminer live)
// - network errors / timeouts / 5xx are retried forever with backoff; reps stay queued
// - 4xx means the request itself is wrong: reported and dropped, never retried forever
// - finish() waits for the queue to drain, then finishes the session (also retried)
//
// Rep posts are idempotent on the server (identical retry → 200), so retrying after a lost
// response never duplicates a rep.

import type { RepCreate } from '../api/client';

export interface SyncApi {
  createSession(): Promise<{ id: string }>;
  addRep(sessionId: string, rep: RepCreate): Promise<unknown>;
  finishSession(sessionId: string, endedAtIso: string): Promise<unknown>;
}

export interface SyncStatus {
  sessionId: string | null;
  /** Reps waiting to be saved. */
  pending: number;
  saved: number;
  /** Reps the server rejected as invalid (4xx) — a bug, not an outage. */
  failed: number;
  /** True while the last attempt failed and we are waiting to retry. */
  retrying: boolean;
  lastError: string | null;
  finished: boolean;
}

export interface SessionSync {
  start(): void;
  enqueue(rep: RepCreate): void;
  /** Resolves with the session id once everything is saved; rejects after timeoutMs. */
  finish(endedAtIso: string, timeoutMs?: number): Promise<string>;
  /** Stop all work (component unmounted). Pending reps are not sent. */
  dispose(): void;
  readonly status: SyncStatus;
}

export const RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 5000];

/** Should this failure be retried (backend unreachable / overloaded)? */
export function isRetryable(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === 'number') return status >= 500 || status === 408 || status === 429;
  return true; // fetch TypeError, AbortError/TimeoutError: the network, not the request
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class FinishTimeoutError extends Error {
  constructor(readonly pending: number) {
    super(`Backend not reachable — ${pending} rep(s) still waiting to be saved`);
  }
}

export function createSessionSync(
  api: SyncApi,
  options: {
    onChange?: (status: SyncStatus) => void;
    retryDelaysMs?: readonly number[];
    sleep?: (ms: number) => Promise<void>;
  } = {},
): SessionSync {
  const delays = options.retryDelaysMs ?? RETRY_DELAYS_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const queue: RepCreate[] = [];
  let status: SyncStatus = {
    sessionId: null,
    pending: 0,
    saved: 0,
    failed: 0,
    retrying: false,
    lastError: null,
    finished: false,
  };
  let running = false;
  let disposed = false;
  let finishRequest: { endedAtIso: string } | null = null;
  let wake: (() => void) | null = null;
  const finishWaiters: Array<{ resolve: (id: string) => void; reject: (e: Error) => void }> = [];

  const update = (patch: Partial<SyncStatus>) => {
    status = { ...status, ...patch, pending: queue.length };
    options.onChange?.(status);
  };

  /** Runs `op` until it succeeds or fails permanently. Returns false on permanent failure. */
  async function withRetry(op: () => Promise<unknown>): Promise<'ok' | 'failed' | 'disposed'> {
    for (let attempt = 0; ; attempt++) {
      if (disposed) return 'disposed';
      try {
        await op();
        // Clear only the transient outage error; a dropped rep's error stays visible.
        if (status.retrying) update({ retrying: false, lastError: status.failed ? status.lastError : null });
        return 'ok';
      } catch (err) {
        if (!isRetryable(err)) {
          update({ retrying: false, lastError: message(err) });
          return 'failed';
        }
        update({ retrying: true, lastError: message(err) });
        await sleep(delays[Math.min(attempt, delays.length - 1)]);
      }
    }
  }

  async function loop() {
    // 1. session
    let sessionId: string | null = null;
    const created = await withRetry(async () => {
      sessionId = (await api.createSession()).id;
    });
    if (created !== 'ok' || !sessionId) {
      finishWaiters.splice(0).forEach((w) => w.reject(new Error(status.lastError ?? 'Could not create session')));
      return;
    }
    update({ sessionId });

    // 2. reps, then finish
    while (!disposed) {
      if (queue.length > 0) {
        const rep = queue[0];
        const result = await withRetry(() => api.addRep(sessionId!, rep));
        if (result === 'disposed') return;
        queue.shift();
        update(result === 'ok' ? { saved: status.saved + 1 } : { failed: status.failed + 1 });
        continue;
      }
      if (finishRequest) {
        const endedAt = finishRequest.endedAtIso;
        const result = await withRetry(() => api.finishSession(sessionId!, endedAt));
        if (result === 'disposed') return;
        if (result === 'ok') {
          update({ finished: true });
          finishWaiters.splice(0).forEach((w) => w.resolve(sessionId!));
        } else {
          finishWaiters.splice(0).forEach((w) => w.reject(new Error(status.lastError ?? 'Finish failed')));
        }
        return;
      }
      await new Promise<void>((r) => (wake = r));
      wake = null;
    }
  }

  return {
    get status() {
      return status;
    },

    start() {
      if (running) return;
      running = true;
      update({});
      void loop();
    },

    enqueue(rep) {
      if (finishRequest) throw new Error('Cannot add reps after finish()');
      queue.push(rep);
      update({});
      wake?.();
    },

    finish(endedAtIso, timeoutMs = 15000) {
      finishRequest ??= { endedAtIso };
      wake?.();
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          const i = finishWaiters.findIndex((w) => w.resolve === done);
          if (i >= 0) finishWaiters.splice(i, 1);
          reject(new FinishTimeoutError(queue.length));
        }, timeoutMs);
        const done = (id: string) => {
          clearTimeout(timer);
          resolve(id);
        };
        finishWaiters.push({
          resolve: done,
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        });
        if (status.finished && status.sessionId) done(status.sessionId);
      });
    },

    dispose() {
      disposed = true;
      wake?.();
    },
  };
}
