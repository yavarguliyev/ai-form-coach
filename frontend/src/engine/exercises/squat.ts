// Squat, side view (CLAUDE.md §8.7). Primary angle: knee (hip-knee-ankle), decreasing.

import type { RepErrorCode } from '../errorCodes';
import { angleAt, angleFromVertical } from '../geometry';
import { LM } from '../landmarks';
import type { Side } from '../visibility';
import type { ExerciseDefinition } from './types';

const LEAN = 'maxTorsoLean';
const FAST = 'tooFastMs';

/** Knee angle at or above this = standing (start position). */
export const SQUAT_START_ANGLE = 160;
/** Knee angle below this = the rep has begun (15° hysteresis gap below standing). */
export const SQUAT_LEAVE_TOP_ANGLE = 145;
/** Knee angle must reach this or lower for the rep to count ("deep enough"). */
export const SQUAT_END_ANGLE = 100;
/** Knee angle at or below this = great depth (thighs below parallel). Informational only. */
export const SQUAT_GREAT_DEPTH_ANGLE = 90;
/**
 * Max torso angle from vertical before "Keep your chest up". Many people lean ~45° in a deep
 * squat naturally — tune live with the debug sliders before the demo (§8.7).
 */
export const SQUAT_MAX_TORSO_LEAN = 45;
/** Counted reps faster than this get SQUAT_TOO_FAST ("Slow down"). */
export const SQUAT_TOO_FAST_MS = 1000;

const CHAINS = {
  left: { shoulder: LM.LEFT_SHOULDER, hip: LM.LEFT_HIP, knee: LM.LEFT_KNEE, ankle: LM.LEFT_ANKLE },
  right: { shoulder: LM.RIGHT_SHOULDER, hip: LM.RIGHT_HIP, knee: LM.RIGHT_KNEE, ankle: LM.RIGHT_ANKLE },
};
const chain = (side: Side | null) => CHAINS[side ?? 'left'];

export function isGreatDepth(minKneeAngle: number): boolean {
  return minKneeAngle <= SQUAT_GREAT_DEPTH_ANGLE;
}

export const squat: ExerciseDefinition = {
  slug: 'squat',
  name: 'Squat',
  cameraView: 'side',
  thresholds: {
    direction: 'decreasing',
    startThreshold: SQUAT_START_ANGLE,
    leaveTopThreshold: SQUAT_LEAVE_TOP_ANGLE,
    endThreshold: SQUAT_END_ANGLE,
  },
  sideChains: {
    left: Object.values(CHAINS.left),
    right: Object.values(CHAINS.right),
  },

  requiredLandmarks: (side) => Object.values(chain(side)),

  primaryAngle(pose, side) {
    const c = chain(side);
    return angleAt(pose[c.hip], pose[c.knee], pose[c.ankle]);
  },

  frameMetrics(pose, side) {
    const c = chain(side);
    return { torsoLean: angleFromVertical(pose[c.hip], pose[c.shoulder]) };
  },

  limits: [
    { key: LEAN, label: 'Max torso lean', default: SQUAT_MAX_TORSO_LEAN, min: 20, max: 80, step: 1, unit: '°' },
    { key: FAST, label: 'Too fast below', default: SQUAT_TOO_FAST_MS, min: 600, max: 2500, step: 50, unit: 'ms' },
  ],

  evaluateRep(rep, limits) {
    const errors: RepErrorCode[] = [];
    if (rep.maxMetrics.torsoLean > limits[LEAN]) errors.push('SQUAT_TORSO_LEAN');
    if (rep.durationMs < limits[FAST]) errors.push('SQUAT_TOO_FAST');
    return errors;
  },

  liveCue: (metrics, _state, limits) => (metrics.torsoLean > limits[LEAN] ? 'SQUAT_TORSO_LEAN' : null),

  partialCue: 'SQUAT_SHALLOW',

  primaryAngleLabel: 'Knee angle',
  startHint: 'Stand up straight to start',

  setupInstructions:
    'Stand sideways to the camera, 2–3 m away, with your whole body in frame — head to feet.',
};
