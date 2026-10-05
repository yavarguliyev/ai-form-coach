// Bicep curl, side view (CLAUDE.md §8.7). Primary angle: elbow (shoulder-elbow-wrist), decreasing.

import type { RepErrorCode } from '../errorCodes';
import { angleAt } from '../geometry';
import { LM } from '../landmarks';
import type { Side } from '../visibility';
import type { ExerciseDefinition } from './types';

/** Elbow angle at or above this = arm extended (start position). */
export const CURL_START_ANGLE = 150;
/** Elbow angle below this = the curl has begun (15° hysteresis gap). */
export const CURL_LEAVE_TOP_ANGLE = 135;
/** Elbow angle must reach this or lower for the rep to count ("fully curled"). */
export const CURL_END_ANGLE = 50;
/**
 * Max angle between upper arm (shoulder → elbow) and torso (shoulder → hip) during a rep
 * before "Keep your elbow pinned to your side".
 */
export const CURL_MAX_ELBOW_SWING = 25;
/** Counted reps faster than this get CURL_TOO_FAST ("Slow down"). */
export const CURL_TOO_FAST_MS = 800;
/**
 * After curling up, lowering only to an angle below this before curling again means the arm
 * was never extended → "Fully extend your arm" (the rep doesn't complete until it is).
 */
export const CURL_NO_EXTENSION_ANGLE = 140;

const CHAINS = {
  left: { shoulder: LM.LEFT_SHOULDER, elbow: LM.LEFT_ELBOW, wrist: LM.LEFT_WRIST, hip: LM.LEFT_HIP },
  right: { shoulder: LM.RIGHT_SHOULDER, elbow: LM.RIGHT_ELBOW, wrist: LM.RIGHT_WRIST, hip: LM.RIGHT_HIP },
};
const chain = (side: Side | null) => CHAINS[side ?? 'left'];

export const bicepCurl: ExerciseDefinition = {
  slug: 'bicep_curl',
  name: 'Bicep Curl',
  cameraView: 'side',
  thresholds: {
    direction: 'decreasing',
    startThreshold: CURL_START_ANGLE,
    leaveTopThreshold: CURL_LEAVE_TOP_ANGLE,
    endThreshold: CURL_END_ANGLE,
  },
  sideChains: {
    left: Object.values(CHAINS.left),
    right: Object.values(CHAINS.right),
  },

  requiredLandmarks: (side) => Object.values(chain(side)),

  primaryAngle(pose, side) {
    const c = chain(side);
    return angleAt(pose[c.shoulder], pose[c.elbow], pose[c.wrist]);
  },

  frameMetrics(pose, side) {
    const c = chain(side);
    // Angle at the shoulder between the upper arm and the torso line.
    return { upperArmSwing: angleAt(pose[c.elbow], pose[c.shoulder], pose[c.hip]) };
  },

  evaluateRep(rep) {
    const errors: RepErrorCode[] = [];
    if (rep.maxMetrics.upperArmSwing > CURL_MAX_ELBOW_SWING) errors.push('CURL_ELBOW_SWING');
    if (rep.durationMs < CURL_TOO_FAST_MS) errors.push('CURL_TOO_FAST');
    return errors;
  },

  liveCue: (metrics) => (metrics.upperArmSwing > CURL_MAX_ELBOW_SWING ? 'CURL_ELBOW_SWING' : null),

  partialCue: 'CURL_PARTIAL',

  reversalCue: (peakAngle) => (peakAngle < CURL_NO_EXTENSION_ANGLE ? 'CURL_NO_EXTENSION' : null),

  setupInstructions:
    'Stand sideways to the camera with your working arm closest to it. Keep your whole upper body and hips in frame.',
};
