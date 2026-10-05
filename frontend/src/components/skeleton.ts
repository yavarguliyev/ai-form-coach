import { BODY_CONNECTIONS, BODY_LANDMARKS, type Landmark } from '../engine/landmarks';

// Same threshold the engine's visibility gate will use (MIN_VISIBILITY, §8.5).
const LOW_VISIBILITY = 0.6;

const COLORS = {
  bone: 'rgba(255, 255, 255, 0.75)',
  joint: 'rgba(255, 255, 255, 0.9)',
  active: '#3ddc97', // joints used by the current exercise
  cue: '#f25f5c', // live form cue active
  hidden: 'rgba(138, 144, 156, 0.8)', // low visibility
};

export interface SkeletonStyle {
  /** Landmarks used by the current exercise, drawn larger in the accent color. */
  activeJoints: ReadonlySet<number>;
  /** When true, active joints turn red (live cue). */
  cueActive: boolean;
}

/**
 * Draws the skeleton in VIDEO PIXEL coordinates (canvas size = video size). The canvas is
 * mirrored with CSS together with the video, so the landmarks themselves are never mirrored.
 */
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: readonly Landmark[] | null,
  style: SkeletonStyle,
): void {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  if (!landmarks) return;

  const scale = Math.max(width, height) / 1280; // keep strokes similar across resolutions
  const px = (i: number) => [landmarks[i].x * width, landmarks[i].y * height] as const;
  const visible = (i: number) => landmarks[i].visibility >= LOW_VISIBILITY;

  ctx.lineCap = 'round';
  ctx.lineWidth = 4 * scale;
  for (const [a, b] of BODY_CONNECTIONS) {
    ctx.strokeStyle = visible(a) && visible(b) ? COLORS.bone : COLORS.hidden;
    ctx.beginPath();
    ctx.moveTo(...px(a));
    ctx.lineTo(...px(b));
    ctx.stroke();
  }

  for (const i of BODY_LANDMARKS) {
    const active = style.activeJoints.has(i);
    ctx.fillStyle = !visible(i)
      ? COLORS.hidden
      : active
        ? style.cueActive
          ? COLORS.cue
          : COLORS.active
        : COLORS.joint;
    ctx.beginPath();
    ctx.arc(...px(i), (active ? 9 : 5) * scale, 0, Math.PI * 2);
    ctx.fill();
  }
}
