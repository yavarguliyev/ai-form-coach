// Visibility gate and side selection (CLAUDE.md §8.5).

import type { PixelLandmark } from './geometry';
import { LM } from './landmarks';

/** A required landmark must have at least this visibility for the frame to be valid. */
export const MIN_VISIBILITY = 0.6;
/**
 * …and lie inside the frame, with this much slack in normalized units. MediaPipe reports high
 * visibility for joints it is only guessing outside the image, so visibility alone isn't enough.
 */
export const FRAME_MARGIN = 0.02;
/** Invalid frames for longer than this → tracking lost (state NOT_VISIBLE). */
export const LOST_TRACKING_MS = 500;
/** Between reps, switch side only if the other side's mean visibility is better by this much. */
export const SIDE_SWITCH_MARGIN = 0.1;

export type Side = 'left' | 'right';

export function isInFrame(lm: PixelLandmark, margin: number = FRAME_MARGIN): boolean {
  return lm.nx >= -margin && lm.nx <= 1 + margin && lm.ny >= -margin && lm.ny <= 1 + margin;
}

export function isLandmarkUsable(lm: PixelLandmark | undefined): boolean {
  return lm !== undefined && lm.visibility >= MIN_VISIBILITY && isInFrame(lm);
}

export interface VisibilityCheck {
  ok: boolean;
  /** Required landmarks that failed, in the order they were required. */
  missing: number[];
}

/** A frame is valid only if every required landmark is usable. `null` = no person detected. */
export function checkVisibility(
  landmarks: readonly PixelLandmark[] | null,
  required: readonly number[],
): VisibilityCheck {
  const missing = landmarks ? required.filter((i) => !isLandmarkUsable(landmarks[i])) : [...required];
  return { ok: missing.length === 0, missing };
}

/** Visibility used for side selection: landmarks outside the frame count as 0. */
function effectiveVisibility(lm: PixelLandmark | undefined): number {
  return lm && isInFrame(lm) ? lm.visibility : 0;
}

function meanVisibility(landmarks: readonly PixelLandmark[], chain: readonly number[]): number {
  if (chain.length === 0) return 0;
  return chain.reduce((sum, i) => sum + effectiveVisibility(landmarks[i]), 0) / chain.length;
}

export interface SideChains {
  left: readonly number[];
  right: readonly number[];
}

/**
 * Picks the more visible body side for a side-view exercise. With `current` given, the side
 * only changes when the other side is better by more than SIDE_SWITCH_MARGIN (no flip-flop).
 * The caller decides WHEN to call this — only between reps, never mid-rep.
 */
export function chooseSide(
  landmarks: readonly PixelLandmark[],
  chains: SideChains,
  current?: Side,
): Side {
  const left = meanVisibility(landmarks, chains.left);
  const right = meanVisibility(landmarks, chains.right);
  if (current === 'left' && right - left <= SIDE_SWITCH_MARGIN) return 'left';
  if (current === 'right' && left - right <= SIDE_SWITCH_MARGIN) return 'right';
  return left >= right ? 'left' : 'right';
}

// --- user-facing instruction ------------------------------------------------

const PART_NAMES: Record<number, string> = {
  [LM.NOSE]: 'head',
  [LM.LEFT_SHOULDER]: 'shoulders',
  [LM.RIGHT_SHOULDER]: 'shoulders',
  [LM.LEFT_ELBOW]: 'elbows',
  [LM.RIGHT_ELBOW]: 'elbows',
  [LM.LEFT_WRIST]: 'wrists',
  [LM.RIGHT_WRIST]: 'wrists',
  [LM.LEFT_HIP]: 'hips',
  [LM.RIGHT_HIP]: 'hips',
  [LM.LEFT_KNEE]: 'knees',
  [LM.RIGHT_KNEE]: 'knees',
  [LM.LEFT_ANKLE]: 'ankles',
  [LM.RIGHT_ANKLE]: 'ankles',
  [LM.LEFT_FOOT_INDEX]: 'feet',
  [LM.RIGHT_FOOT_INDEX]: 'feet',
};

const LOWER_BODY = new Set(['hips', 'knees', 'ankles', 'feet']);

function joinParts(parts: string[]): string {
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/**
 * A specific instruction for the user, e.g. "Step back — I can't see your knees".
 * Returns null when nothing is missing.
 */
export function visibilityMessage(
  landmarks: readonly PixelLandmark[] | null,
  missing: readonly number[],
): string | null {
  if (missing.length === 0) return null;
  if (!landmarks) return "I can't see you — step into the camera view";
  const parts = [...new Set(missing.map((i) => PART_NAMES[i] ?? 'body'))];
  const what = `I can't see your ${joinParts(parts)}`;
  if (parts.some((p) => LOWER_BODY.has(p))) return `Step back — ${what}`;
  if (parts.includes('head') || parts.includes('shoulders')) return `Move into the frame — ${what}`;
  return `Keep your arms in view — ${what}`;
}

// --- lost-tracking timer ----------------------------------------------------

export interface TrackingMonitor {
  /** Feed every frame; returns true once frames have been invalid for > lostAfterMs. */
  update(frameValid: boolean, timestampMs: number): boolean;
  reset(): void;
}

export function createTrackingMonitor(lostAfterMs: number = LOST_TRACKING_MS): TrackingMonitor {
  let invalidSince: number | null = null;
  return {
    update(frameValid, timestampMs) {
      if (frameValid) {
        invalidSince = null;
        return false;
      }
      invalidSince ??= timestampMs;
      return timestampMs - invalidSince > lostAfterMs;
    },
    reset() {
      invalidSince = null;
    },
  };
}
