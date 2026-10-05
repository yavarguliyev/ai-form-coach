// Ends a set without touching the screen (hands are full of weights). Pure: time is passed in.
//
// A set ends by itself when, after at least one attempt:
//   - rest:   no rep has been in progress for REST_FINISH_MS while the user is visible, or
//   - away:   the user has been out of view for AWAY_FINISH_MS, or
//   - target: the target number of COUNTED reps is reached (optional).
// Rest and away first show a FINISH_WARNING_MS countdown; starting a rep (or coming back into
// view) cancels it. It never ends mid-rep and never before the first attempt.

import type { RepState } from './repCounter';

/** No rep in progress for this long (while visible) ends the set. */
export const REST_FINISH_MS = 10_000;
/** Out of the camera's view for this long ends the set (e.g. racking the bar). */
export const AWAY_FINISH_MS = 5_000;
/** Countdown shown before rest / away ends the set, so it never surprises. */
export const FINISH_WARNING_MS = 3_000;
/** After the target rep is counted, wait this long (let the voice say the number). */
export const TARGET_FINISH_DELAY_MS = 1_500;

export type FinishReason = 'rest' | 'away' | 'target';

export interface AutoFinishOptions {
  restMs?: number;
  awayMs?: number;
  warningMs?: number;
  /** Counted reps that complete the set; null = no target. */
  targetReps?: number | null;
}

export interface AutoFinishInput {
  timestampMs: number;
  state: RepState;
  visibilityOk: boolean;
  /** Attempts so far in this set (counted + missed + unseen). */
  attempts: number;
  /** Counted reps so far. */
  repCount: number;
}

export type AutoFinishStatus =
  | { phase: 'idle' }
  /** Counting down; `remainingMs` until the set ends unless the user acts. */
  | { phase: 'warning'; reason: FinishReason; remainingMs: number }
  /** End the set now. Emitted once. */
  | { phase: 'finish'; reason: FinishReason };

export interface AutoFinish {
  update(input: AutoFinishInput): AutoFinishStatus;
  reset(): void;
}

export function createAutoFinish(options: AutoFinishOptions = {}): AutoFinish {
  const restMs = options.restMs ?? REST_FINISH_MS;
  const awayMs = options.awayMs ?? AWAY_FINISH_MS;
  const warningMs = Math.min(options.warningMs ?? FINISH_WARNING_MS, restMs, awayMs);
  const targetReps = options.targetReps ?? null;

  let lastActiveMs: number | null = null; // last time a rep was in progress (or user came back)
  let awaySinceMs: number | null = null;
  let targetReachedMs: number | null = null;
  let finished = false;

  const countdown = (reason: FinishReason, elapsed: number, limit: number): AutoFinishStatus => {
    if (elapsed >= limit) {
      finished = true;
      return { phase: 'finish', reason };
    }
    if (elapsed >= limit - warningMs) return { phase: 'warning', reason, remainingMs: limit - elapsed };
    return { phase: 'idle' };
  };

  return {
    reset() {
      lastActiveMs = null;
      awaySinceMs = null;
      targetReachedMs = null;
      finished = false;
    },

    update({ timestampMs: now, state, visibilityOk, attempts, repCount }) {
      if (finished) return { phase: 'idle' };

      // Never mid-rep: a rep in progress is activity and cancels any countdown.
      if (state === 'IN_REP') {
        lastActiveMs = now;
        awaySinceMs = null;
        return { phase: 'idle' };
      }

      // Never before the first attempt (setup / waiting to start).
      if (attempts === 0) {
        lastActiveMs = now;
        awaySinceMs = null;
        return { phase: 'idle' };
      }
      lastActiveMs ??= now;

      if (targetReps !== null && repCount >= targetReps) {
        targetReachedMs ??= now;
        if (now - targetReachedMs >= TARGET_FINISH_DELAY_MS) {
          finished = true;
          return { phase: 'finish', reason: 'target' };
        }
        return { phase: 'idle' };
      }

      const away = state === 'NOT_VISIBLE' || !visibilityOk;
      if (away) {
        awaySinceMs ??= now;
        return countdown('away', now - awaySinceMs, awayMs);
      }
      if (awaySinceMs !== null) {
        // Back in view: start the rest timer over, they're clearly not done yet.
        awaySinceMs = null;
        lastActiveMs = now;
      }
      return countdown('rest', now - lastActiveMs, restMs);
    },
  };
}
