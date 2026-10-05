// Shoulder press, front view (CLAUDE.md §8.7). Primary angle: average of both elbow angles,
// increasing. Both arms are always required, so there is no side selection.

import type { RepErrorCode } from '../errorCodes';
import { angleAt, distance } from '../geometry';
import { LM } from '../landmarks';
import type { ExerciseDefinition, Pose } from './types';

/** Average elbow angle at or below this = bottom position, hands near shoulders (start). */
export const PRESS_START_ANGLE = 100;
/** Average elbow angle above this = the press has begun (15° hysteresis gap). */
export const PRESS_LEAVE_TOP_ANGLE = 115;
/** Average elbow angle must reach this (with both wrists above the nose) to count. */
export const PRESS_END_ANGLE = 155;
/** Max |left − right| elbow angle during a rep before "Press both arms evenly". */
export const PRESS_MAX_ARM_ASYMMETRY = 20;
/** Max |left wrist y − right wrist y| / shoulder width during a rep before the same cue. */
export const PRESS_MAX_WRIST_HEIGHT_DIFF = 0.25;
/** Counted reps faster than this get PRESS_TOO_FAST ("Slow down"). */
export const PRESS_TOO_FAST_MS = 800;

const REQUIRED = [
  LM.LEFT_SHOULDER,
  LM.RIGHT_SHOULDER,
  LM.LEFT_ELBOW,
  LM.RIGHT_ELBOW,
  LM.LEFT_WRIST,
  LM.RIGHT_WRIST,
  LM.NOSE,
];

function elbowAngles(pose: Pose): { left: number; right: number } {
  return {
    left: angleAt(pose[LM.LEFT_SHOULDER], pose[LM.LEFT_ELBOW], pose[LM.LEFT_WRIST]),
    right: angleAt(pose[LM.RIGHT_SHOULDER], pose[LM.RIGHT_ELBOW], pose[LM.RIGHT_WRIST]),
  };
}

/** Both wrists above the nose. Image y grows downward, so "above" = smaller y. */
export function wristsAboveNose(pose: Pose): boolean {
  const noseY = pose[LM.NOSE].y;
  return pose[LM.LEFT_WRIST].y < noseY && pose[LM.RIGHT_WRIST].y < noseY;
}

export const shoulderPress: ExerciseDefinition = {
  slug: 'shoulder_press',
  name: 'Shoulder Press',
  cameraView: 'front',
  thresholds: {
    direction: 'increasing',
    startThreshold: PRESS_START_ANGLE,
    leaveTopThreshold: PRESS_LEAVE_TOP_ANGLE,
    endThreshold: PRESS_END_ANGLE,
  },

  requiredLandmarks: () => [...REQUIRED],

  primaryAngle(pose) {
    const { left, right } = elbowAngles(pose);
    return (left + right) / 2;
  },

  endConditionOk: (pose) => wristsAboveNose(pose),

  frameMetrics(pose) {
    const { left, right } = elbowAngles(pose);
    const shoulderWidth = distance(pose[LM.LEFT_SHOULDER], pose[LM.RIGHT_SHOULDER]);
    return {
      armAsymmetry: Math.abs(left - right),
      // NaN when the shoulders overlap (no width to normalize by); NaN metrics are ignored.
      wristHeightDiff:
        shoulderWidth > 0
          ? Math.abs(pose[LM.LEFT_WRIST].y - pose[LM.RIGHT_WRIST].y) / shoulderWidth
          : Number.NaN,
    };
  },

  evaluateRep(rep) {
    const errors: RepErrorCode[] = [];
    if (
      rep.maxMetrics.armAsymmetry > PRESS_MAX_ARM_ASYMMETRY ||
      rep.maxMetrics.wristHeightDiff > PRESS_MAX_WRIST_HEIGHT_DIFF
    ) {
      errors.push('PRESS_UNEVEN');
    }
    if (rep.durationMs < PRESS_TOO_FAST_MS) errors.push('PRESS_TOO_FAST');
    return errors;
  },

  liveCue: (m) =>
    m.armAsymmetry > PRESS_MAX_ARM_ASYMMETRY || m.wristHeightDiff > PRESS_MAX_WRIST_HEIGHT_DIFF
      ? 'PRESS_UNEVEN'
      : null,

  partialCue: 'PRESS_PARTIAL',

  setupInstructions:
    'Face the camera with your head, both arms and upper body in frame. Start with your hands at shoulder height.',
};
