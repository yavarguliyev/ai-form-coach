// Is the user turned the right way for the exercise's camera view?
//
// Side view: the shoulders overlap, so shoulder width is small compared to torso length.
// Facing the camera: the shoulders are far apart. Angles measured in the wrong orientation are
// foreshortened and unreliable, so a set may not START until the orientation is right.

import { distance, type PixelLandmark } from './geometry';
import { LM } from './landmarks';

/** Side view: shoulder width / torso length must be at most this. */
export const SIDE_VIEW_MAX_SHOULDER_RATIO = 0.45;
/** Front view: shoulder width / (nose → shoulder-line height) must be at least this. */
export const FRONT_VIEW_MIN_SHOULDER_RATIO = 0.8;
/** Landmarks used here need at least this visibility to judge orientation at all. */
const MIN_ORIENTATION_VISIBILITY = 0.3;

export interface OrientationCheck {
  /** False only when we are confident the user is turned the wrong way. */
  ok: boolean;
  /** The measured ratio, or null when it couldn't be measured. */
  ratio: number | null;
  hint: string | null;
}

const mid = (a: PixelLandmark, b: PixelLandmark) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const seen = (...lms: PixelLandmark[]) => lms.every((l) => l.visibility >= MIN_ORIENTATION_VISIBILITY);

export function checkOrientation(pose: readonly PixelLandmark[], view: 'side' | 'front'): OrientationCheck {
  const ls = pose[LM.LEFT_SHOULDER];
  const rs = pose[LM.RIGHT_SHOULDER];
  const shoulderWidth = distance(ls, rs);
  const shoulders = mid(ls, rs);

  if (view === 'side') {
    const lh = pose[LM.LEFT_HIP];
    const rh = pose[LM.RIGHT_HIP];
    if (!seen(ls, rs, lh, rh)) return { ok: true, ratio: null, hint: null };
    const torso = distance(shoulders, mid(lh, rh));
    if (torso <= 0) return { ok: true, ratio: null, hint: null };
    const ratio = shoulderWidth / torso;
    return ratio <= SIDE_VIEW_MAX_SHOULDER_RATIO
      ? { ok: true, ratio, hint: null }
      : { ok: false, ratio, hint: 'Turn sideways to the camera' };
  }

  const nose = pose[LM.NOSE];
  if (!seen(ls, rs, nose)) return { ok: true, ratio: null, hint: null };
  const headHeight = Math.abs(shoulders.y - nose.y);
  if (headHeight <= 0) return { ok: true, ratio: null, hint: null };
  const ratio = shoulderWidth / headHeight;
  return ratio >= FRONT_VIEW_MIN_SHOULDER_RATIO
    ? { ok: true, ratio, hint: null }
    : { ok: false, ratio, hint: 'Face the camera' };
}
