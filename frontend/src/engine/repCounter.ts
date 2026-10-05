// Generic rep state machine driven by one primary angle (CLAUDE.md §8.6).
//
// NOT_VISIBLE → READY → TOP ⇄ IN_REP
//   READY : waiting for the user to hold the start position for START_HOLD_MS
//   TOP   : in the start position; crossing LEAVE_TOP starts a rep
//   IN_REP: tracking min/max; reaching END sets endReached; returning past START ends the rep

/** User must hold the start position this long before counting begins. */
export const START_HOLD_MS = 500;
/** Shorter reps are jitter or bounces → rejected. */
export const MIN_REP_MS = 600;
/** Longer reps are discarded and the user must return to the start position. */
export const MAX_REP_MS = 8000;
/** A partial rep only triggers a cue ("Go lower") if it travelled at least this far. */
export const PARTIAL_CUE_MIN_TRAVEL = 25;
/** After the end is reached, moving back toward the end by this much = re-started mid-way. */
export const REVERSAL_DEG = 15;

export type Direction = 'decreasing' | 'increasing';
export type RepState = 'NOT_VISIBLE' | 'READY' | 'TOP' | 'IN_REP';

export interface RepThresholds {
  /** How the primary angle moves during the working phase. */
  direction: Direction;
  /** At or past this = start position ("top"). */
  startThreshold: number;
  /** Crossing this (away from start) begins a rep. Gap to start = hysteresis. */
  leaveTopThreshold: number;
  /** The working phase must reach this for the rep to count. */
  endThreshold: number;
}

export interface RepCounterConfig extends RepThresholds {
  startHoldMs?: number;
  minRepMs?: number;
  maxRepMs?: number;
  partialCueMinTravel?: number;
  reversalDeg?: number;
}

export interface RepFrameInput {
  /** Primary angle in degrees. NaN is treated as an invalid frame. */
  angle: number;
  /** Visibility gate passed for this frame. */
  valid: boolean;
  /** Frames have been invalid for longer than LOST_TRACKING_MS. */
  trackingLost: boolean;
  timestampMs: number;
  /** Extra exercise rule for reaching the end (e.g. wrists above nose). Default true. */
  endConditionOk?: boolean;
  /**
   * Whether the body is set up so a set may start (e.g. turned sideways for a side-view
   * exercise). While false, READY never advances to TOP. Default true. Ignored mid-rep.
   */
  startAllowed?: boolean;
}

export interface CompletedRepTiming {
  startedAtMs: number;
  durationMs: number;
  minAngle: number;
  maxAngle: number;
}

export type RejectReason = 'partial' | 'too_short' | 'too_long' | 'lost_tracking';

export interface RejectedRep {
  reason: RejectReason;
  durationMs: number;
  /** Degrees travelled from the start threshold toward the end. */
  travel: number;
  /** Whether this rejection deserves user feedback (partial reps that went far enough). */
  cue: boolean;
}

export interface RepFrameOutput {
  state: RepState;
  repCount: number;
  /** True only on the frame a rep begins. */
  started: boolean;
  /** Present only on the frame a rep is counted. */
  completed?: CompletedRepTiming;
  /** Present only on the frame a rep is rejected. */
  rejected?: RejectedRep;
  /** After reaching the end, the user turned back toward it before returning to start. */
  reversal?: { peakAngle: number };
  /** READY only: the current angle is in the start position (and starting is allowed). */
  atStartPosition: boolean;
  /** READY only: fraction 0..1 of the start hold completed. */
  holdProgress: number;
  /** Live info about the rep in progress (null outside IN_REP). */
  current: { startedAtMs: number; minAngle: number; maxAngle: number; endReached: boolean } | null;
}

export interface RepCounter {
  update(input: RepFrameInput): RepFrameOutput;
  reset(): void;
  readonly state: RepState;
  readonly repCount: number;
}

export function validateThresholds(t: RepThresholds): void {
  const ordered =
    t.direction === 'decreasing'
      ? t.startThreshold > t.leaveTopThreshold && t.leaveTopThreshold > t.endThreshold
      : t.startThreshold < t.leaveTopThreshold && t.leaveTopThreshold < t.endThreshold;
  if (!ordered) {
    throw new RangeError(
      `Thresholds out of order for ${t.direction}: start=${t.startThreshold}, ` +
        `leaveTop=${t.leaveTopThreshold}, end=${t.endThreshold}`,
    );
  }
}

export function createRepCounter(config: RepCounterConfig): RepCounter {
  validateThresholds(config);
  const {
    direction,
    startThreshold,
    leaveTopThreshold,
    endThreshold,
    startHoldMs = START_HOLD_MS,
    minRepMs = MIN_REP_MS,
    maxRepMs = MAX_REP_MS,
    partialCueMinTravel = PARTIAL_CUE_MIN_TRAVEL,
    reversalDeg = REVERSAL_DEG,
  } = config;

  // "Toward the end" in the working direction. sign = +1 if the angle shrinks during work.
  const sign = direction === 'decreasing' ? 1 : -1;
  /** How far `angle` is past `threshold` in the working direction (positive = past it). */
  const pastBy = (angle: number, threshold: number) => sign * (threshold - angle);
  const atStart = (angle: number) => pastBy(angle, startThreshold) <= 0;

  let state: RepState = 'NOT_VISIBLE';
  let repCount = 0;
  let holdSince: number | null = null;
  let rep: {
    startedAtMs: number;
    minAngle: number;
    maxAngle: number;
    endReached: boolean;
    /** Furthest point back toward start since the end was reached (for reversal detection). */
    returnPeak: number | null;
    /** A reversal was reported; don't report another until the end is reached again. */
    reversalReported: boolean;
  } | null = null;

  const output = (extra: Partial<RepFrameOutput> = {}): RepFrameOutput => ({
    state,
    repCount,
    started: false,
    atStartPosition: false,
    holdProgress: 0,
    current: rep
      ? {
          startedAtMs: rep.startedAtMs,
          minAngle: rep.minAngle,
          maxAngle: rep.maxAngle,
          endReached: rep.endReached,
        }
      : null,
    ...extra,
  });

  /** Degrees travelled from start toward end during the current rep. */
  const travel = () => {
    if (!rep) return 0;
    const extreme = direction === 'decreasing' ? rep.minAngle : rep.maxAngle;
    return Math.max(0, pastBy(extreme, startThreshold));
  };

  const reject = (reason: RejectReason, now: number, nextState: RepState): RepFrameOutput => {
    const durationMs = rep ? now - rep.startedAtMs : 0;
    const t = travel();
    const rejected: RejectedRep = {
      reason,
      durationMs,
      travel: t,
      cue: reason === 'partial' && t >= partialCueMinTravel,
    };
    rep = null;
    state = nextState;
    holdSince = null;
    return output({ rejected });
  };

  const waitForStartHold = (angle: number, now: number, startAllowed: boolean): RepFrameOutput => {
    if (!startAllowed || !atStart(angle)) {
      holdSince = null;
      return output({ atStartPosition: false, holdProgress: 0 });
    }
    holdSince ??= now;
    const held = now - holdSince;
    if (held >= startHoldMs) {
      state = 'TOP';
      holdSince = null;
      return output({ atStartPosition: true, holdProgress: 1 });
    }
    return output({ atStartPosition: true, holdProgress: Math.min(1, held / startHoldMs) });
  };

  return {
    get state() {
      return state;
    },
    get repCount() {
      return repCount;
    },

    reset() {
      state = 'NOT_VISIBLE';
      repCount = 0;
      holdSince = null;
      rep = null;
    },

    update({ angle, valid, trackingLost, timestampMs: now, endConditionOk = true, startAllowed = true }) {
      // Lost tracking: discard any partial rep and wait for the body to be visible again.
      if (trackingLost) {
        if (state === 'IN_REP') return reject('lost_tracking', now, 'NOT_VISIBLE');
        state = 'NOT_VISIBLE';
        holdSince = null;
        return output();
      }

      // A rep that runs too long is discarded even across invalid frames.
      if (state === 'IN_REP' && rep && now - rep.startedAtMs > maxRepMs) {
        return reject('too_long', now, 'READY');
      }

      // Invalid frames never change state, angles or counts.
      if (!valid || Number.isNaN(angle)) return output();

      switch (state) {
        case 'NOT_VISIBLE':
          // Visible again: this valid frame already counts toward the start hold.
          state = 'READY';
          holdSince = null;
          return waitForStartHold(angle, now, startAllowed);

        case 'READY':
          return waitForStartHold(angle, now, startAllowed);

        case 'TOP':
          if (pastBy(angle, leaveTopThreshold) >= 0) {
            state = 'IN_REP';
            rep = {
              startedAtMs: now,
              minAngle: angle,
              maxAngle: angle,
              endReached: pastBy(angle, endThreshold) >= 0 && endConditionOk,
              returnPeak: null,
              reversalReported: false,
            };
            return output({ started: true });
          }
          return output();

        case 'IN_REP': {
          if (!rep) throw new Error('IN_REP without rep data');
          rep.minAngle = Math.min(rep.minAngle, angle);
          rep.maxAngle = Math.max(rep.maxAngle, angle);

          let reversal: RepFrameOutput['reversal'];
          if (pastBy(angle, endThreshold) >= 0 && endConditionOk) {
            rep.endReached = true;
            rep.returnPeak = null;
            rep.reversalReported = false;
          } else if (rep.endReached && !rep.reversalReported) {
            // Track how far back toward start the user got after reaching the end.
            if (rep.returnPeak === null || pastBy(angle, rep.returnPeak) < 0) {
              rep.returnPeak = angle;
            } else if (pastBy(angle, rep.returnPeak) >= reversalDeg) {
              reversal = { peakAngle: rep.returnPeak };
              rep.reversalReported = true;
            }
          }

          if (!atStart(angle)) return output(reversal ? { reversal } : {});

          // Back at the start position: the rep is over. Evaluate it.
          const durationMs = now - rep.startedAtMs;
          if (durationMs < minRepMs) return reject('too_short', now, 'TOP');
          if (!rep.endReached) return reject('partial', now, 'TOP');

          const completed: CompletedRepTiming = {
            startedAtMs: rep.startedAtMs,
            durationMs,
            minAngle: rep.minAngle,
            maxAngle: rep.maxAngle,
          };
          repCount += 1;
          rep = null;
          state = 'TOP';
          return output({ completed });
        }
      }
    },
  };
}
