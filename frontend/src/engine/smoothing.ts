// Exponential moving average over landmark pixel coordinates (CLAUDE.md §8.4).

import type { PixelLandmark } from './geometry';

/** Weight of the newest frame: smoothed = α·current + (1−α)·previous. 1 = no smoothing. */
export const SMOOTHING_ALPHA = 0.5;

export interface LandmarkSmoother {
  /** Returns a smoothed copy; the input is not modified. */
  smooth(frame: readonly PixelLandmark[]): PixelLandmark[];
  /** Forget history (call when tracking is lost) so stale positions don't bleed in. */
  reset(): void;
}

/**
 * Only pixel x/y are smoothed. `visibility` and the normalized nx/ny are passed through raw,
 * so the visibility gate always judges what the model reports for THIS frame.
 */
export function createLandmarkSmoother(alpha: number = SMOOTHING_ALPHA): LandmarkSmoother {
  if (!(alpha > 0 && alpha <= 1)) throw new RangeError(`alpha must be in (0, 1], got ${alpha}`);
  let previous: PixelLandmark[] | null = null;

  return {
    smooth(frame) {
      if (!previous || previous.length !== frame.length) {
        previous = frame.map((lm) => ({ ...lm }));
        return previous.map((lm) => ({ ...lm }));
      }
      const prev = previous;
      const next = frame.map((lm, i) => ({
        ...lm,
        x: alpha * lm.x + (1 - alpha) * prev[i].x,
        y: alpha * lm.y + (1 - alpha) * prev[i].y,
      }));
      previous = next;
      return next.map((lm) => ({ ...lm }));
    },
    reset() {
      previous = null;
    },
  };
}
