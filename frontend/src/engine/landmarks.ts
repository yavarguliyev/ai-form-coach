// MediaPipe BlazePose landmark indices (CLAUDE.md §8.1). Left/right = the PERSON's left/right.

export const LM = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
} as const;

export type LandmarkIndex = (typeof LM)[keyof typeof LM];

export const LANDMARK_NAMES: Record<LandmarkIndex, string> = {
  0: 'nose',
  11: 'left shoulder',
  12: 'right shoulder',
  13: 'left elbow',
  14: 'right elbow',
  15: 'left wrist',
  16: 'right wrist',
  23: 'left hip',
  24: 'right hip',
  25: 'left knee',
  26: 'right knee',
  27: 'left ankle',
  28: 'right ankle',
  31: 'left foot',
  32: 'right foot',
};

/** Normalized landmark as produced by MediaPipe: x, y in 0..1 of frame width/height. */
export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

/** Body segments drawn by the skeleton overlay (face points are left out). */
export const BODY_CONNECTIONS: ReadonlyArray<readonly [LandmarkIndex, LandmarkIndex]> = [
  [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
  [LM.LEFT_SHOULDER, LM.LEFT_ELBOW],
  [LM.LEFT_ELBOW, LM.LEFT_WRIST],
  [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW],
  [LM.RIGHT_ELBOW, LM.RIGHT_WRIST],
  [LM.LEFT_SHOULDER, LM.LEFT_HIP],
  [LM.RIGHT_SHOULDER, LM.RIGHT_HIP],
  [LM.LEFT_HIP, LM.RIGHT_HIP],
  [LM.LEFT_HIP, LM.LEFT_KNEE],
  [LM.LEFT_KNEE, LM.LEFT_ANKLE],
  [LM.LEFT_ANKLE, LM.LEFT_FOOT_INDEX],
  [LM.RIGHT_HIP, LM.RIGHT_KNEE],
  [LM.RIGHT_KNEE, LM.RIGHT_ANKLE],
  [LM.RIGHT_ANKLE, LM.RIGHT_FOOT_INDEX],
];

/** All body landmarks shown in the overlay and the debug panel. */
export const BODY_LANDMARKS: readonly LandmarkIndex[] = Object.values(LM);
