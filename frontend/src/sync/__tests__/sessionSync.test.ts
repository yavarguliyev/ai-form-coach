import { describe, expect, it } from 'vitest';
import type { RepCreate } from '../../api/client';
import { FinishTimeoutError, createSessionSync, isRetryable, type SyncApi } from '../sessionSync';

const rep = (i: number): RepCreate => ({
  rep_index: i,
  started_at: new Date(1_700_000_000_000 + i * 2000).toISOString(),
  duration_ms: 1500,
  min_angle: 90,
  max_angle: 165,
  score: 100,
  errors: [],
  metrics: {},
});

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

/** In-memory backend that can be taken down (network errors) and brought back. */
function fakeBackend() {
  const state = {
    down: false,
    sessions: 0,
    reps: [] as number[],
    finishedWith: null as string | null,
    calls: 0,
    rejectRep: null as number | null, // rep_index answered with 422
  };
  const fail = () => {
    state.calls++;
    if (state.down) throw new TypeError('Failed to fetch');
  };
  const api: SyncApi = {
    async createSession() {
      fail();
      state.sessions++;
      return { id: 'session-1' };
    },
    async addRep(_id, r) {
      fail();
      if (r.rep_index === state.rejectRep) throw new HttpError(422);
      state.reps.push(r.rep_index);
    },
    async finishSession(_id, endedAt) {
      fail();
      state.finishedWith = endedAt;
    },
  };
  return { state, api };
}

const fast = { retryDelaysMs: [2] };
const until = async (cond: () => boolean, ms = 2000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 2));
  }
};

describe('isRetryable', () => {
  it('retries network failures and 5xx, not other 4xx', () => {
    expect(isRetryable(new TypeError('Failed to fetch'))).toBe(true);
    expect(isRetryable(new DOMException('timeout', 'TimeoutError'))).toBe(true);
    expect(isRetryable(new HttpError(503))).toBe(true);
    expect(isRetryable(new HttpError(429))).toBe(true);
    expect(isRetryable(new HttpError(422))).toBe(false);
    expect(isRetryable(new HttpError(409))).toBe(false);
    expect(isRetryable(new HttpError(404))).toBe(false);
  });
});

describe('createSessionSync', () => {
  it('creates the session, saves reps in order as they come, then finishes', async () => {
    const { state, api } = fakeBackend();
    const sync = createSessionSync(api, fast);
    sync.start();
    for (let i = 1; i <= 5; i++) sync.enqueue(rep(i));
    await until(() => state.reps.length === 5);
    expect(state.reps).toEqual([1, 2, 3, 4, 5]);
    expect(await sync.finish('2026-10-05T12:00:00Z')).toBe('session-1');
    expect(state.finishedWith).toBe('2026-10-05T12:00:00Z');
    expect(sync.status).toMatchObject({ saved: 5, pending: 0, failed: 0, finished: true });
  });

  it('loses nothing while the backend is down, and catches up in order', async () => {
    const { state, api } = fakeBackend();
    const sync = createSessionSync(api, fast);
    sync.start();
    sync.enqueue(rep(1));
    await until(() => state.reps.length === 1);

    state.down = true;
    for (let i = 2; i <= 6; i++) sync.enqueue(rep(i));
    await until(() => sync.status.retrying);
    expect(sync.status.pending).toBe(5);
    expect(sync.status.lastError).toMatch(/Failed to fetch/);

    state.down = false;
    await until(() => state.reps.length === 6);
    expect(state.reps).toEqual([1, 2, 3, 4, 5, 6]);
    expect(sync.status).toMatchObject({ pending: 0, retrying: false, lastError: null });
  });

  it('keeps retrying session creation until the backend comes up', async () => {
    const { state, api } = fakeBackend();
    state.down = true;
    const sync = createSessionSync(api, fast);
    sync.start();
    sync.enqueue(rep(1));
    await until(() => state.calls > 5);
    expect(sync.status.sessionId).toBeNull();
    state.down = false;
    await until(() => state.reps.length === 1);
    expect(state.sessions).toBe(1);
  });

  it('finish() waits for queued reps before finishing the session', async () => {
    const { state, api } = fakeBackend();
    const sync = createSessionSync(api, fast);
    sync.start();
    state.down = true;
    sync.enqueue(rep(1));
    sync.enqueue(rep(2));
    const finished = sync.finish('2026-10-05T12:00:00Z', 2000);
    await new Promise((r) => setTimeout(r, 30));
    expect(state.finishedWith).toBeNull(); // not finished while reps are pending
    state.down = false;
    expect(await finished).toBe('session-1');
    expect(state.reps).toEqual([1, 2]);
  });

  it('finish() rejects with the pending count if the backend stays down, and keeps the reps', async () => {
    const { state, api } = fakeBackend();
    const sync = createSessionSync(api, fast);
    sync.start();
    await until(() => sync.status.sessionId !== null);
    state.down = true;
    sync.enqueue(rep(1));
    await expect(sync.finish('2026-10-05T12:00:00Z', 100)).rejects.toBeInstanceOf(FinishTimeoutError);
    expect(sync.status.pending).toBe(1);
    // A later finish() still succeeds once the backend is back — nothing was dropped.
    state.down = false;
    expect(await sync.finish('2026-10-05T12:00:00Z', 2000)).toBe('session-1');
    expect(state.reps).toEqual([1]);
  });

  it('drops a rep the server rejects as invalid (4xx), reports it, and continues', async () => {
    const { state, api } = fakeBackend();
    state.rejectRep = 2;
    const sync = createSessionSync(api, fast);
    sync.start();
    [1, 2, 3].forEach((i) => sync.enqueue(rep(i)));
    await until(() => sync.status.pending === 0);
    expect(state.reps).toEqual([1, 3]);
    expect(sync.status).toMatchObject({ saved: 2, failed: 1 });
    expect(sync.status.lastError).toBe('HTTP 422');
  });

  it('refuses reps after finish() and stops after dispose()', async () => {
    const { state, api } = fakeBackend();
    const sync = createSessionSync(api, fast);
    sync.start();
    await sync.finish('2026-10-05T12:00:00Z', 2000);
    expect(() => sync.enqueue(rep(1))).toThrow();

    const s2 = createSessionSync(api, fast);
    state.down = true;
    s2.start();
    s2.enqueue(rep(1));
    s2.dispose();
    const calls = state.calls;
    await new Promise((r) => setTimeout(r, 30));
    expect(state.calls - calls).toBeLessThanOrEqual(1);
  });

  it('reports status changes', async () => {
    const { api } = fakeBackend();
    const seen: number[] = [];
    const sync = createSessionSync(api, { ...fast, onChange: (s) => seen.push(s.saved) });
    sync.start();
    sync.enqueue(rep(1));
    await sync.finish('2026-10-05T12:00:00Z', 2000);
    expect(seen).toContain(1);
  });
});
