// Ties the engine together (CLAUDE.md §8.10): one call per video frame, frame in → state out.
//
//   landmarks → pixels → smoothing → side selection → visibility gate → lost-tracking timer
//             → primary angle + metrics → rep state machine → evaluation + score
//
// Pure and deterministic: time comes in as `timestampMs`; nothing reads a clock.

import type { ErrorCode, MissErrorCode, MissReason, RepErrorCode } from './errorCodes';
import { defaultLimits, type ExerciseDefinition, type FrameMetrics, type Limits, type Pose } from './exercises/types';
import { toPixelLandmarks } from './geometry';
import type { Landmark } from './landmarks';
import { checkOrientation } from './orientation';
import { createRepCounter, type RejectReason, type RepState, type RepThresholds } from './repCounter';
import { scoreRep } from './scoring';
import { createLandmarkSmoother } from './smoothing';
import {
  checkVisibility,
  chooseSide,
  createTrackingMonitor,
  visibilityMessage,
  type Side,
} from './visibility';

export interface CompletedRep {
  /** 1-based number among COUNTED reps (what the counter shows and the voice says). */
  index: number;
  /** 1-based number among all attempts in this set, counted or missed (storage order). */
  attemptIndex: number;
  /** Same clock as the timestamps passed to processFrame. */
  startedAtMs: number;
  durationMs: number;
  minAngle: number;
  maxAngle: number;
  score: number;
  errors: RepErrorCode[];
  /** Per-rep maxima of the frame metrics, e.g. { max_torsoLean: 31.2 }. */
  metrics: Record<string, number>;
}

export interface RejectedRepInfo {
  reason: RejectReason;
  /** Cue to show for this rejection (partial reps that went far enough), else null. */
  cue: ErrorCode | null;
}

/** A real attempt that was not counted — recorded and reported, never silently dropped. */
export interface MissedAttempt {
  attemptIndex: number;
  reason: MissReason;
  /** Code stored with it: "not deep enough" or "too fast"; null for too slow / not seen. */
  code: MissErrorCode | RepErrorCode | null;
  /** False when the camera lost sight (setup problem): shown, but doesn't lower the score. */
  penalized: boolean;
  startedAtMs: number;
  durationMs: number;
  minAngle: number;
  maxAngle: number;
}

export interface AnalyzerOutput {
  state: RepState;
  repCount: number;
  /** Body side used (side-view exercises), null for front view. */
  side: Side | null;
  /** Primary angle of this frame, or null when the frame is invalid. */
  primaryAngle: number | null;
  frameMetrics: FrameMetrics;
  visibilityOk: boolean;
  /** Specific instruction when required landmarks are missing, else null. */
  visibilityMessage: string | null;
  /** Required landmarks that failed the gate this frame. */
  missingLandmarks: number[];
  liveCue: ErrorCode | null;
  /**
   * While waiting to start (READY, body visible): what the user must do, e.g. "Turn sideways
   * to the camera" or "Stand up straight to start". Null once in position.
   */
  positionHint: string | null;
  /** READY only: fraction 0..1 of the start-position hold completed. */
  holdProgress: number;
  /** Turned the right way for the camera view (true when it can't be judged). */
  orientationOk: boolean;
  /** "Turn sideways to the camera" / "Face the camera" when orientationOk is false. */
  orientationHint: string | null;
  /** Measured orientation ratio (debug), null when not measurable. */
  orientationRatio: number | null;
  /** Present only on the frame a rep is counted. */
  completedRep?: CompletedRep;
  /** Present only on the frame a rep is rejected. */
  rejectedRep?: RejectedRepInfo;
  /** Present only on the frame a real attempt is rejected (not on tiny wobbles). */
  missedAttempt?: MissedAttempt;
  /** Attempts so far that didn't count and lower the score (too shallow / fast / slow). */
  missedCount: number;
  /** Attempts so far lost because the camera couldn't see (not penalized). */
  unseenCount: number;
}

export interface AnalyzerOptions {
  /** Override the definition's rep thresholds (debug-panel tuning). */
  thresholds?: Partial<RepThresholds>;
  /** Override form-error limits by key (debug-panel tuning). */
  limits?: Partial<Record<string, number>>;
}

export interface Analyzer {
  processFrame(
    landmarks: readonly Landmark[] | null,
    videoWidth: number,
    videoHeight: number,
    timestampMs: number,
  ): AnalyzerOutput;
  reset(): void;
  readonly thresholds: RepThresholds;
  readonly limits: Limits;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function createAnalyzer(definition: ExerciseDefinition, options: AnalyzerOptions = {}): Analyzer {
  const thresholds: RepThresholds = { ...definition.thresholds, ...options.thresholds };
  const limits: Limits = { ...defaultLimits(definition), ...options.limits } as Limits;
  const counter = createRepCounter(thresholds);
  const smoother = createLandmarkSmoother();
  const tracking = createTrackingMonitor();
  const isSideView = definition.cameraView === 'side';
  if (isSideView && !definition.sideChains) {
    throw new Error(`${definition.slug}: side-view exercises need sideChains`);
  }

  let side: Side | null = isSideView ? 'left' : null;
  let sideChosen = false;
  let repMetrics: FrameMetrics = {};
  let wasLost = false;
  let attempts = 0;
  let missedCount = 0;
  let unseenCount = 0;

  const accumulate = (metrics: FrameMetrics) => {
    for (const [k, v] of Object.entries(metrics)) {
      if (Number.isFinite(v)) repMetrics[k] = Math.max(repMetrics[k] ?? -Infinity, v);
    }
  };

  return {
    thresholds,
    limits,

    reset() {
      attempts = 0;
      missedCount = 0;
      unseenCount = 0;
      counter.reset();
      smoother.reset();
      tracking.reset();
      side = isSideView ? 'left' : null;
      sideChosen = false;
      repMetrics = {};
      wasLost = false;
    },

    processFrame(landmarks, videoWidth, videoHeight, timestampMs) {
      const raw = landmarks ? toPixelLandmarks(landmarks, videoWidth, videoHeight) : null;
      // Smoothing only touches x/y; visibility and normalized coords stay raw (see smoothing.ts).
      const pose: Pose | null = raw ? smoother.smooth(raw) : null;

      // Side is (re)chosen only between reps — never mid-rep (§8.5).
      if (isSideView && raw && counter.state !== 'IN_REP') {
        side = chooseSide(raw, definition.sideChains!, sideChosen ? (side ?? undefined) : undefined);
        sideChosen = true;
      }

      const required = definition.requiredLandmarks(side);
      const vis = checkVisibility(pose, required);
      const lost = tracking.update(vis.ok, timestampMs);
      if (lost && !wasLost) smoother.reset(); // don't blend stale positions into the next pose
      wasLost = lost;

      let angle = Number.NaN;
      let frameMetrics: FrameMetrics = {};
      let endConditionOk = true;
      if (vis.ok && pose) {
        angle = definition.primaryAngle(pose, side);
        frameMetrics = definition.frameMetrics(pose, side);
        endConditionOk = definition.endConditionOk?.(pose, side) ?? true;
      }
      const valid = vis.ok && Number.isFinite(angle);
      // Orientation only gates the START of a set; it is never checked mid-rep.
      const orientation = pose ? checkOrientation(pose, definition.cameraView) : null;
      const startAllowed = orientation?.ok ?? true;

      const out = counter.update({
        angle,
        valid,
        trackingLost: lost,
        timestampMs,
        endConditionOk,
        startAllowed,
      });

      if (out.started) repMetrics = {};
      // Metrics only from valid frames of the rep in progress (never report errors from
      // invalid frames). The completing frame counts too: it is part of the rep.
      if (valid && (out.state === 'IN_REP' || out.completed)) accumulate(frameMetrics);

      let liveCue: ErrorCode | null = null;
      let completedRep: CompletedRep | undefined;
      let rejectedRep: RejectedRepInfo | undefined;
      let missedAttempt: MissedAttempt | undefined;

      if (valid && out.state === 'IN_REP') {
        liveCue = definition.liveCue?.(frameMetrics, out.state, limits) ?? null;
      }
      if (out.reversal) {
        liveCue = definition.reversalCue?.(out.reversal.peakAngle, limits) ?? liveCue;
      }

      if (out.completed) {
        const errors = definition.evaluateRep({
          durationMs: out.completed.durationMs,
          minAngle: out.completed.minAngle,
          maxAngle: out.completed.maxAngle,
          maxMetrics: { ...repMetrics },
        }, limits);
        attempts += 1;
        completedRep = {
          index: out.repCount,
          attemptIndex: attempts,
          startedAtMs: out.completed.startedAtMs,
          durationMs: Math.round(out.completed.durationMs),
          minAngle: round2(out.completed.minAngle),
          maxAngle: round2(out.completed.maxAngle),
          score: scoreRep(errors),
          errors,
          metrics: Object.fromEntries(
            Object.entries(repMetrics).map(([k, v]) => [`max_${k}`, round2(v)]),
          ),
        };
        liveCue = errors[0] ?? null;
        repMetrics = {};
      }

      if (out.rejected) {
        const r = out.rejected;
        const cue = r.cue ? definition.partialCue : null;
        rejectedRep = { reason: r.reason, cue };
        if (cue) liveCue = cue;
        repMetrics = {};
        if (r.attempt) {
          attempts += 1;
          const penalized = r.reason !== 'lost_tracking';
          if (penalized) missedCount += 1;
          else unseenCount += 1;
          missedAttempt = {
            attemptIndex: attempts,
            reason: r.reason,
            code: r.reason === 'partial' ? definition.partialCue : r.reason === 'too_short' ? definition.tooFastCue : null,
            penalized,
            startedAtMs: r.startedAtMs,
            durationMs: Math.round(r.durationMs),
            minAngle: round2(r.minAngle),
            maxAngle: round2(r.maxAngle),
          };
        }
      }

      let positionHint: string | null = null;
      if (out.state === 'READY' && valid) {
        if (!startAllowed) positionHint = orientation?.hint ?? null;
        else if (!out.atStartPosition) positionHint = definition.startHint;
      }

      return {
        state: out.state,
        repCount: out.repCount,
        side,
        primaryAngle: valid ? angle : null,
        frameMetrics,
        visibilityOk: vis.ok,
        visibilityMessage: visibilityMessage(pose, vis.missing),
        missingLandmarks: vis.missing,
        liveCue,
        positionHint,
        holdProgress: out.holdProgress,
        orientationOk: startAllowed,
        orientationHint: orientation?.hint ?? null,
        orientationRatio: orientation?.ratio ?? null,
        missedCount,
        unseenCount,
        ...(completedRep && { completedRep }),
        ...(rejectedRep && { rejectedRep }),
        ...(missedAttempt && { missedAttempt }),
      };
    },
  };
}
