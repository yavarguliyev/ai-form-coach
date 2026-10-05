// Exercise definition contract (CLAUDE.md §8.7). Every threshold lives in the definition
// file as a named constant; the analyzer and rep counter contain no exercise numbers.

import type { ErrorCode, LiveOnlyCode, RepErrorCode } from '../errorCodes';
import type { PixelLandmark } from '../geometry';
import type { RepThresholds } from '../repCounter';
import type { RepState } from '../repCounter';
import type { Side, SideChains } from '../visibility';

export type ExerciseSlug = 'squat' | 'bicep_curl' | 'shoulder_press';

/** Smoothed pixel landmarks (33). */
export type Pose = readonly PixelLandmark[];

/** Frame metrics, e.g. { torsoLean: 12.3 }. */
export type FrameMetrics = Record<string, number>;

/** Everything known about a rep when it completes. */
export interface RepData {
  durationMs: number;
  minAngle: number;
  maxAngle: number;
  /** Maximum of each frame metric over the rep's valid frames. */
  maxMetrics: FrameMetrics;
}

/** A form-error limit that can be tuned live from the debug panel. */
export interface TunableLimit {
  key: string;
  label: string;
  default: number;
  min: number;
  max: number;
  step: number;
  unit: '°' | 'ms' | '×';
}

/** Current limit values by key (defaults merged with any overrides). */
export type Limits = Readonly<Record<string, number>>;

export interface ExerciseDefinition {
  slug: ExerciseSlug;
  name: string;
  cameraView: 'side' | 'front';
  /** Rep-counter thresholds and direction. */
  thresholds: RepThresholds;
  /** Side-view only: landmark chains compared to pick the more visible side. */
  sideChains?: SideChains;
  /** Landmarks that must be visible and in frame. `side` is null for front-view exercises. */
  requiredLandmarks(side: Side | null): number[];
  /** The angle that drives the rep counter, in degrees. */
  primaryAngle(pose: Pose, side: Side | null): number;
  /** Extra rule for reaching the end position (e.g. wrists above nose). Default: always true. */
  endConditionOk?(pose: Pose, side: Side | null): boolean;
  /** Computed every valid frame; the analyzer keeps the per-rep maximum of each. */
  frameMetrics(pose: Pose, side: Side | null): FrameMetrics;
  /** Form-error limits used by evaluateRep / liveCue / reversalCue, tunable at runtime. */
  limits: readonly TunableLimit[];
  /** Errors for a completed (counted) rep. The score comes from scoring.ts. */
  evaluateRep(rep: RepData, limits: Limits): RepErrorCode[];
  /** Real-time warning mid-rep, or null. */
  liveCue?(metrics: FrameMetrics, state: RepState, limits: Limits): ErrorCode | null;
  /** Cue for a partial rep that travelled far enough (e.g. SQUAT_SHALLOW → "Go lower"). */
  partialCue: LiveOnlyCode;
  /**
   * Called when the user turns back toward the end before returning to start
   * (e.g. re-curling without extending). Return a cue code or null.
   */
  reversalCue?(peakAngle: number, limits: Limits): ErrorCode | null;
  /** Shown on the setup screen. */
  setupInstructions: string;
}

export function defaultLimits(definition: ExerciseDefinition): Record<string, number> {
  return Object.fromEntries(definition.limits.map((l) => [l.key, l.default]));
}
