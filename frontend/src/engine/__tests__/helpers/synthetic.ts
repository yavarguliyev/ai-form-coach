// Synthetic pose generator for engine tests (CLAUDE.md T-18).
//
// Builds 33-landmark frames from joint-angle curves. Geometry is constructed in PIXEL space
// and only then normalized by the frame size, exactly like MediaPipe output — so a generated
// 90° knee measures 90° after pixel conversion, on any frame size.

import { LM, type Landmark } from '../../landmarks';

// --- timelines ---------------------------------------------------------------

export interface Segment {
  durationMs: number;
  /** Value at time t, 0 <= t <= durationMs. */
  at(t: number): number;
}

/** Constant value. */
export const hold = (value: number, durationMs: number): Segment => ({
  durationMs,
  at: () => value,
});

/** Linear one-way move from → to. */
export const ramp = (from: number, to: number, durationMs: number): Segment => ({
  durationMs,
  at: (t) => from + ((to - from) * t) / durationMs,
});

/** Smooth there-and-back: from → to → from (cosine), like one rep. */
export const sweep = (from: number, to: number, durationMs: number): Segment => ({
  durationMs,
  at: (t) => from + ((to - from) * (1 - Math.cos((2 * Math.PI * t) / durationMs))) / 2,
});

/** `n` copies of the same segment. */
export const repeat = (segment: Segment, n: number): Segment[] => Array.from({ length: n }, () => segment);

export interface Timeline {
  durationMs: number;
  at(t: number): number;
}

export function timeline(...segments: Array<Segment | Segment[]>): Timeline {
  const flat = segments.flat();
  const durationMs = flat.reduce((sum, s) => sum + s.durationMs, 0);
  return {
    durationMs,
    at(t) {
      let start = 0;
      for (const s of flat) {
        if (t < start + s.durationMs) return s.at(t - start);
        start += s.durationMs;
      }
      const last = flat[flat.length - 1];
      return last.at(last.durationMs);
    },
  };
}

/** A curve may be a timeline, a constant, or derived from the primary angle at time t. */
export type Curve = Timeline | number | ((t: number, primary: number) => number);

function evalCurve(curve: Curve, t: number, primary: number): number {
  if (typeof curve === 'number') return curve;
  if (typeof curve === 'function') return curve(t, primary);
  return curve.at(t);
}

// --- frames ------------------------------------------------------------------

export interface SyntheticFrame {
  /** null = no person detected. */
  landmarks: Landmark[] | null;
  timestampMs: number;
  videoWidth: number;
  videoHeight: number;
}

export interface VisibilityDrop {
  fromMs: number;
  toMs: number;
  /** Landmarks to drop; omit for all. Ignored when `noPerson` is set. */
  landmarks?: readonly number[];
  /** Visibility during the drop (default 0.1). */
  visibility?: number;
  /** Model finds nobody at all during the window (landmarks = null). */
  noPerson?: boolean;
  /** Move the landmarks off-frame instead of lowering visibility (MediaPipe "guessing"). */
  offFrame?: boolean;
}

export interface GenerateOptions {
  fps?: number;
  width?: number;
  height?: number;
  /** Gaussian noise in pixels (standard deviation) added to every landmark. */
  noisePx?: number;
  seed?: number;
  drops?: readonly VisibilityDrop[];
  /** First timestamp (ms). */
  startMs?: number;
}

interface P {
  x: number;
  y: number;
}

/** Pixel positions + visibility for all 33 landmarks of one frame. */
type PixelPose = Array<{ x: number; y: number; visibility: number }>;

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

function render(
  durationMs: number,
  poseAt: (t: number) => PixelPose,
  opts: GenerateOptions,
): SyntheticFrame[] {
  const { fps = 30, width = 1280, height = 720, noisePx = 0, seed = 1, drops = [], startMs = 0 } = opts;
  const rand = rng(seed);
  const frames: SyntheticFrame[] = [];
  const n = Math.round((durationMs * fps) / 1000);
  for (let i = 0; i < n; i++) {
    const t = (i * 1000) / fps;
    const pose = poseAt(t);
    const active = drops.filter((d) => t >= d.fromMs && t < d.toMs);
    const timestampMs = startMs + t;
    if (active.some((d) => d.noPerson)) {
      frames.push({ landmarks: null, timestampMs, videoWidth: width, videoHeight: height });
      continue;
    }
    const landmarks = pose.map((p, idx) => {
      let { x, y, visibility } = p;
      if (noisePx > 0) {
        x += gaussian(rand) * noisePx;
        y += gaussian(rand) * noisePx;
      }
      for (const d of active) {
        if (d.landmarks && !d.landmarks.includes(idx)) continue;
        if (d.offFrame) y = height * 1.15; // below the frame, still "confident"
        else visibility = d.visibility ?? 0.1;
      }
      return { x: x / width, y: y / height, z: 0, visibility };
    });
    frames.push({ landmarks, timestampMs, videoWidth: width, videoHeight: height });
  }
  return frames;
}

// --- 2D helpers ----------------------------------------------------------------

const DEG = Math.PI / 180;
const add = (a: P, b: P): P => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (v: P, k: number): P => ({ x: v.x * k, y: v.y * k });
const sub = (a: P, b: P): P => ({ x: a.x - b.x, y: a.y - b.y });
const unit = (v: P): P => scale(v, 1 / Math.hypot(v.x, v.y));
/** Rotate by `deg`; positive = counter-clockwise ON SCREEN (y grows downward). */
const rotate = (v: P, deg: number): P => {
  const c = Math.cos(-deg * DEG);
  const s = Math.sin(-deg * DEG);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
};
/** Unit vector at `deg` from straight up, leaning toward +x for positive angles. */
const fromVertical = (deg: number): P => ({ x: Math.sin(deg * DEG), y: -Math.cos(deg * DEG) });

/** Fills all 33 landmarks: named body points plus face/hand/heel points near their parents. */
function fullPose(
  body: Partial<Record<number, P>>,
  visibilityOf: (idx: number) => number,
): PixelPose {
  const nose = body[LM.NOSE]!;
  const parent: Record<number, number> = {
    1: LM.NOSE, 2: LM.NOSE, 3: LM.NOSE, 4: LM.NOSE, 5: LM.NOSE, 6: LM.NOSE, 7: LM.NOSE,
    8: LM.NOSE, 9: LM.NOSE, 10: LM.NOSE,
    17: LM.LEFT_WRIST, 19: LM.LEFT_WRIST, 21: LM.LEFT_WRIST,
    18: LM.RIGHT_WRIST, 20: LM.RIGHT_WRIST, 22: LM.RIGHT_WRIST,
    29: LM.LEFT_ANKLE, 30: LM.RIGHT_ANKLE,
  };
  return Array.from({ length: 33 }, (_, i) => {
    const p = body[i] ?? body[parent[i]] ?? nose;
    const offset = body[i] ? { x: 0, y: 0 } : { x: ((i % 3) - 1) * 4, y: ((i % 2) * 2 - 1) * 3 };
    return { ...add(p, offset), visibility: visibilityOf(body[i] ? i : (parent[i] ?? LM.NOSE)) };
  });
}

const LEFT_IDS = new Set<number>([11, 13, 15, 23, 25, 27, 31]);
const RIGHT_IDS = new Set<number>([12, 14, 16, 24, 26, 28, 32]);

function sideVisibility(near: 'left' | 'right', nearVis: number, farVis: number) {
  return (i: number) =>
    LEFT_IDS.has(i) ? (near === 'left' ? nearVis : farVis)
    : RIGHT_IDS.has(i) ? (near === 'right' ? nearVis : farVis)
    : nearVis;
}

// --- side-view body (squat, curl) ------------------------------------------------

export interface SideViewOptions extends GenerateOptions {
  /** Body side nearer the camera (more visible). Default 'left'. */
  nearSide?: 'left' | 'right';
  /** Direction the person faces on screen. Default 'right'. */
  facing?: 'left' | 'right';
  nearVisibility?: number;
  farVisibility?: number;
}

const BODY = { shin: 150, thigh: 150, torso: 200, neck: 50, upperArm: 110, forearm: 100, foot: 45 };

interface SideBody {
  shoulder: P;
  elbow: P;
  wrist: P;
  hip: P;
  knee: P;
  ankle: P;
  foot: P;
  nose: P;
}

/** Same skeleton for both sides, the far side shifted a few pixels. */
function sidePose(b: SideBody, opts: SideViewOptions): PixelPose {
  const near = opts.nearSide ?? 'left';
  const shift = (p: P): P => ({ x: p.x - 6, y: p.y - 2 });
  const nearIds = near === 'left'
    ? { s: LM.LEFT_SHOULDER, e: LM.LEFT_ELBOW, w: LM.LEFT_WRIST, h: LM.LEFT_HIP, k: LM.LEFT_KNEE, a: LM.LEFT_ANKLE, f: LM.LEFT_FOOT_INDEX }
    : { s: LM.RIGHT_SHOULDER, e: LM.RIGHT_ELBOW, w: LM.RIGHT_WRIST, h: LM.RIGHT_HIP, k: LM.RIGHT_KNEE, a: LM.RIGHT_ANKLE, f: LM.RIGHT_FOOT_INDEX };
  const farIds = near === 'left'
    ? { s: LM.RIGHT_SHOULDER, e: LM.RIGHT_ELBOW, w: LM.RIGHT_WRIST, h: LM.RIGHT_HIP, k: LM.RIGHT_KNEE, a: LM.RIGHT_ANKLE, f: LM.RIGHT_FOOT_INDEX }
    : { s: LM.LEFT_SHOULDER, e: LM.LEFT_ELBOW, w: LM.LEFT_WRIST, h: LM.LEFT_HIP, k: LM.LEFT_KNEE, a: LM.LEFT_ANKLE, f: LM.LEFT_FOOT_INDEX };
  const body: Partial<Record<number, P>> = { [LM.NOSE]: b.nose };
  for (const [ids, f] of [[nearIds, (p: P) => p], [farIds, shift]] as const) {
    body[ids.s] = f(b.shoulder);
    body[ids.e] = f(b.elbow);
    body[ids.w] = f(b.wrist);
    body[ids.h] = f(b.hip);
    body[ids.k] = f(b.knee);
    body[ids.a] = f(b.ankle);
    body[ids.f] = f(b.foot);
  }
  return fullPose(body, sideVisibility(near, opts.nearVisibility ?? 0.95, opts.farVisibility ?? 0.5));
}

export interface SquatParams {
  /** Knee angle (hip-knee-ankle), degrees. */
  knee: Timeline;
  /** Torso angle from vertical (hip → shoulder), degrees. Default: 10 + 0.25·(170 − knee). */
  torsoLean?: Curve;
}

/** Side-view squat. Facing +x by default; the shin leans forward as the knee bends. */
export function generateSquat(params: SquatParams, opts: SideViewOptions = {}): SyntheticFrame[] {
  const width = opts.width ?? 1280;
  const height = opts.height ?? 720;
  const dir = (opts.facing ?? 'right') === 'right' ? 1 : -1;
  const lean = params.torsoLean ?? ((_t: number, knee: number) => 10 + 0.25 * Math.max(0, 170 - knee));
  // Body sized to the frame so it fits at any resolution.
  const k = height / 720;
  const ankle = { x: width / 2 - dir * 40 * k, y: height - 70 * k };

  return render(params.knee.durationMs, (t) => {
    const kneeAngle = params.knee.at(t);
    const shinTilt = dir * (180 - kneeAngle) * 0.45; // shin leans forward with depth
    const knee = add(ankle, scale(fromVertical(shinTilt), BODY.shin * k));
    // Thigh: rotate the knee→ankle direction so the angle at the knee equals kneeAngle,
    // with the hip going BACK (away from the facing direction).
    const toAnkle = unit(sub(ankle, knee));
    const hip = add(knee, scale(rotate(toAnkle, -dir * kneeAngle), BODY.thigh * k));
    const torsoDir = fromVertical(dir * evalCurve(lean, t, kneeAngle));
    const shoulder = add(hip, scale(torsoDir, BODY.torso * k));
    const nose = add(shoulder, add(scale(torsoDir, BODY.neck * k), { x: dir * 15 * k, y: 0 }));
    // Arms reach forward for balance.
    const elbow = add(shoulder, scale(fromVertical(dir * 100), BODY.upperArm * k));
    const wrist = add(elbow, scale(fromVertical(dir * 90), BODY.forearm * k));
    const foot = add(ankle, { x: dir * BODY.foot * k, y: 0 });
    return sidePose({ shoulder, elbow, wrist, hip, knee, ankle, foot, nose }, opts);
  }, opts);
}

export interface CurlParams {
  /** Elbow angle (shoulder-elbow-wrist), degrees. */
  elbow: Timeline;
  /** Angle between upper arm and torso (shoulder→elbow vs shoulder→hip). Default 5. */
  upperArmSwing?: Curve;
}

/** Side-view standing bicep curl; the forearm comes up in front of the body. */
export function generateCurl(params: CurlParams, opts: SideViewOptions = {}): SyntheticFrame[] {
  const width = opts.width ?? 1280;
  const height = opts.height ?? 720;
  const dir = (opts.facing ?? 'right') === 'right' ? 1 : -1;
  const k = height / 720;
  const ankle = { x: width / 2, y: height - 70 * k };
  const knee = add(ankle, { x: 0, y: -BODY.shin * k });
  const hip = add(knee, { x: 0, y: -BODY.thigh * k });
  const shoulder = add(hip, { x: 0, y: -BODY.torso * k });
  const nose = add(shoulder, { x: dir * 15 * k, y: -BODY.neck * k });
  const foot = add(ankle, { x: dir * BODY.foot * k, y: 0 });

  return render(params.elbow.durationMs, (t) => {
    const elbowAngle = params.elbow.at(t);
    const swing = evalCurve(params.upperArmSwing ?? 5, t, elbowAngle);
    // Upper arm: straight down, swung forward by `swing`.
    const upperDir = fromVertical(dir * (180 - swing));
    const elbow = add(shoulder, scale(upperDir, BODY.upperArm * k));
    // Forearm: rotate elbow→shoulder by elbowAngle so the hand comes up in front.
    const toShoulder = unit(sub(shoulder, elbow));
    const wrist = add(elbow, scale(rotate(toShoulder, -dir * elbowAngle), BODY.forearm * k));
    return sidePose({ shoulder, elbow, wrist, hip, knee, ankle, foot, nose }, opts);
  }, opts);
}

// --- front-view body (shoulder press) ---------------------------------------------

export interface PressParams {
  /** Left elbow angle, degrees. */
  leftElbow: Timeline;
  /** Right elbow angle; defaults to the left (symmetric press). */
  rightElbow?: Curve;
  /**
   * Degrees added to each upper arm's elevation (default 0). Negative = arm pushed out to the
   * side instead of up, e.g. −60 keeps a straight arm horizontal (wrist below the nose).
   */
  leftElevationOffset?: Curve;
  rightElevationOffset?: Curve;
}

/**
 * Front-view press. Hands near the shoulders at ~90°, overhead near 170°. The upper arm
 * rises with the elbow angle; the forearm points up and in.
 */
export function generatePress(params: PressParams, opts: GenerateOptions & { visibility?: number } = {}): SyntheticFrame[] {
  const width = opts.width ?? 1280;
  const height = opts.height ?? 720;
  const k = height / 720;
  const cx = width / 2;
  const shoulderY = height * 0.55;
  const halfShoulder = 70 * k;
  const lShoulder = { x: cx + halfShoulder, y: shoulderY }; // person's left = image right (facing camera)
  const rShoulder = { x: cx - halfShoulder, y: shoulderY };
  const nose = { x: cx, y: shoulderY - 110 * k };
  const lHip = { x: cx + 50 * k, y: shoulderY + 200 * k };
  const rHip = { x: cx - 50 * k, y: shoulderY + 200 * k };
  const upperArm = 120 * k;
  const forearm = 110 * k;

  /** outward = +1 for the person's left arm (image right), −1 for the right arm. */
  const arm = (shoulder: P, elbowAngle: number, outward: 1 | -1, elevationOffset: number) => {
    // Upper arm elevation above horizontal: −15° at 90°, ~60° at 170°.
    const elevation = -15 + ((elbowAngle - 90) * 75) / 80 + elevationOffset;
    const upper = { x: outward * Math.cos(elevation * DEG), y: -Math.sin(elevation * DEG) };
    const elbow = add(shoulder, scale(upper, upperArm));
    // Rotate elbow→shoulder by elbowAngle toward "up": choose the rotation that ends higher.
    const toShoulder = unit(sub(shoulder, elbow));
    const a = rotate(toShoulder, elbowAngle);
    const b = rotate(toShoulder, -elbowAngle);
    const wrist = add(elbow, scale(a.y < b.y ? a : b, forearm));
    return { elbow, wrist };
  };

  return render(params.leftElbow.durationMs, (t) => {
    const left = params.leftElbow.at(t);
    const right = params.rightElbow === undefined ? left : evalCurve(params.rightElbow, t, left);
    const l = arm(lShoulder, left, 1, evalCurve(params.leftElevationOffset ?? 0, t, left));
    const r = arm(rShoulder, right, -1, evalCurve(params.rightElevationOffset ?? 0, t, right));
    const body: Partial<Record<number, P>> = {
      [LM.NOSE]: nose,
      [LM.LEFT_SHOULDER]: lShoulder,
      [LM.RIGHT_SHOULDER]: rShoulder,
      [LM.LEFT_ELBOW]: l.elbow,
      [LM.RIGHT_ELBOW]: r.elbow,
      [LM.LEFT_WRIST]: l.wrist,
      [LM.RIGHT_WRIST]: r.wrist,
      [LM.LEFT_HIP]: lHip,
      [LM.RIGHT_HIP]: rHip,
      [LM.LEFT_KNEE]: add(lHip, { x: 0, y: 150 * k }),
      [LM.RIGHT_KNEE]: add(rHip, { x: 0, y: 150 * k }),
      // Front view at this framing: legs below the knees are out of frame → low visibility.
      [LM.LEFT_ANKLE]: add(lHip, { x: 0, y: 290 * k }),
      [LM.RIGHT_ANKLE]: add(rHip, { x: 0, y: 290 * k }),
      [LM.LEFT_FOOT_INDEX]: add(lHip, { x: 10 * k, y: 320 * k }),
      [LM.RIGHT_FOOT_INDEX]: add(rHip, { x: -10 * k, y: 320 * k }),
    };
    const vis = opts.visibility ?? 0.95;
    const legs = new Set<number>([27, 28, 29, 30, 31, 32]);
    return fullPose(body, (i) => (legs.has(i) ? 0.2 : vis));
  }, opts);
}
