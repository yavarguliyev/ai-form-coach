// Pure geometry helpers (CLAUDE.md §8.2, §8.3). All angle math happens in PIXEL space.

import type { Landmark } from './landmarks';

export interface Point {
  x: number;
  y: number;
}

/** A landmark converted to video pixels. `visibility` is carried over unchanged. */
export interface PixelLandmark extends Point {
  visibility: number;
  /** Original normalized coordinates, kept for the frame-bounds check (§8.5). */
  nx: number;
  ny: number;
}

/** Vectors shorter than this (in pixels) have no meaningful direction. */
export const MIN_SEGMENT_PX = 1e-6;

const RAD_TO_DEG = 180 / Math.PI;

/**
 * Normalized → pixel coordinates. MediaPipe's x is relative to frame WIDTH and y to frame
 * HEIGHT, so angles computed on normalized coordinates are wrong on non-square frames.
 */
export function toPixel(lm: Landmark, videoWidth: number, videoHeight: number): PixelLandmark {
  return {
    x: lm.x * videoWidth,
    y: lm.y * videoHeight,
    visibility: lm.visibility,
    nx: lm.x,
    ny: lm.y,
  };
}

export function toPixelLandmarks(
  landmarks: readonly Landmark[],
  videoWidth: number,
  videoHeight: number,
): PixelLandmark[] {
  return landmarks.map((lm) => toPixel(lm, videoWidth, videoHeight));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Angle in degrees (0..180) between two vectors; NaN if either is ~zero length. */
export function angleBetweenVectors(u: Point, v: Point): number {
  const lu = Math.hypot(u.x, u.y);
  const lv = Math.hypot(v.x, v.y);
  if (lu < MIN_SEGMENT_PX || lv < MIN_SEGMENT_PX) return Number.NaN;
  // Clamp guards against |cos| creeping past 1 through floating point error.
  const cos = clamp((u.x * v.x + u.y * v.y) / (lu * lv), -1, 1);
  return Math.acos(cos) * RAD_TO_DEG;
}

/**
 * Angle at vertex B formed by A-B-C, in degrees 0..180.
 * NaN when A or C coincides with B — callers must treat the frame as invalid.
 */
export function angleAt(a: Point, b: Point, c: Point): number {
  return angleBetweenVectors({ x: a.x - b.x, y: a.y - b.y }, { x: c.x - b.x, y: c.y - b.y });
}

/**
 * Angle in degrees (0..180) between the segment p1 → p2 and straight up.
 * Image y grows downward, so "up" is the vector (0, -1). NaN if p1 ≈ p2.
 */
export function angleFromVertical(p1: Point, p2: Point): number {
  return angleBetweenVectors({ x: p2.x - p1.x, y: p2.y - p1.y }, { x: 0, y: -1 });
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
