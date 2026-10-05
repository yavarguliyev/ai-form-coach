import { describe, expect, it } from 'vitest';
import {
  angleAt,
  angleBetweenVectors,
  angleFromVertical,
  distance,
  toPixel,
  toPixelLandmarks,
  type Point,
} from '../geometry';
import type { Landmark } from '../landmarks';

const p = (x: number, y: number): Point => ({ x, y });
const lm = (x: number, y: number, visibility = 1): Landmark => ({ x, y, z: 0, visibility });

describe('angleAt', () => {
  it('returns 90 for a right angle', () => {
    expect(angleAt(p(0, -10), p(0, 0), p(10, 0))).toBeCloseTo(90, 10);
  });

  it('returns 180 for collinear points on opposite sides', () => {
    expect(angleAt(p(-5, 0), p(0, 0), p(7, 0))).toBeCloseTo(180, 10);
    // For these points the raw cosine is -1.0000000000000002 (floating point error), so
    // without the clamp acos would return NaN.
    const pastMinusOne = angleAt(p(0.7, 0.3), p(0.8, 0.4), p(0.9, 0.5));
    expect(pastMinusOne).not.toBeNaN();
    expect(pastMinusOne).toBeCloseTo(180, 10);
    // acos is ill-conditioned near ±1: here cos is -0.9999999999999998 → ~1e-6° off.
    expect(angleAt(p(0.1, 0.1), p(0.2, 0.2), p(0.3, 0.3))).toBeCloseTo(180, 4);
  });

  it('returns 0 when both arms point the same way', () => {
    expect(angleAt(p(3, 3), p(0, 0), p(9, 9))).toBeCloseTo(0, 5);
  });

  it('returns 45 and 135 for diagonal arms', () => {
    expect(angleAt(p(10, 0), p(0, 0), p(10, 10))).toBeCloseTo(45, 10);
    expect(angleAt(p(10, 0), p(0, 0), p(-10, 10))).toBeCloseTo(135, 10);
  });

  it('returns NaN when an arm has zero length', () => {
    expect(angleAt(p(0, 0), p(0, 0), p(10, 0))).toBeNaN();
    expect(angleAt(p(10, 0), p(0, 0), p(0, 0))).toBeNaN();
    expect(angleAt(p(1, 1), p(1, 1), p(1, 1))).toBeNaN();
  });

  it('is symmetric, and invariant to translation and uniform scale', () => {
    const a = p(12, -3), b = p(4, 5), c = p(-7, 11);
    const base = angleAt(a, b, c);
    expect(angleAt(c, b, a)).toBeCloseTo(base, 10);
    const t = (q: Point) => p(q.x * 3.5 + 100, q.y * 3.5 - 40);
    expect(angleAt(t(a), t(b), t(c))).toBeCloseTo(base, 10);
  });

  it('always stays within 0..180', () => {
    for (let i = 0; i < 500; i++) {
      const r = () => (Math.sin(i * 12.9898 + Math.random()) * 1000) % 500;
      const angle = angleAt(p(r(), r()), p(r(), r()), p(r(), r()));
      if (!Number.isNaN(angle)) {
        expect(angle).toBeGreaterThanOrEqual(0);
        expect(angle).toBeLessThanOrEqual(180);
      }
    }
  });
});

describe('angleFromVertical', () => {
  it('is 0 for a segment pointing up (image y grows downward)', () => {
    expect(angleFromVertical(p(100, 500), p(100, 200))).toBeCloseTo(0, 10);
  });

  it('is 180 for a segment pointing down', () => {
    expect(angleFromVertical(p(100, 200), p(100, 500))).toBeCloseTo(180, 10);
  });

  it('is 90 for horizontal segments in either direction', () => {
    expect(angleFromVertical(p(0, 0), p(50, 0))).toBeCloseTo(90, 10);
    expect(angleFromVertical(p(0, 0), p(-50, 0))).toBeCloseTo(90, 10);
  });

  it('measures lean either way as a positive angle', () => {
    // hip at (0,0), shoulder up-and-forward / up-and-back by 45°
    expect(angleFromVertical(p(0, 0), p(30, -30))).toBeCloseTo(45, 10);
    expect(angleFromVertical(p(0, 0), p(-30, -30))).toBeCloseTo(45, 10);
    expect(angleFromVertical(p(0, 0), p(Math.tan(Math.PI / 3) * 10, -10))).toBeCloseTo(60, 10);
  });

  it('returns NaN for a zero-length segment', () => {
    expect(angleFromVertical(p(5, 5), p(5, 5))).toBeNaN();
  });
});

describe('angleBetweenVectors', () => {
  it('returns NaN for a zero vector', () => {
    expect(angleBetweenVectors(p(0, 0), p(1, 0))).toBeNaN();
  });
});

describe('distance', () => {
  it('is euclidean distance', () => {
    expect(distance(p(0, 0), p(3, 4))).toBe(5);
    expect(distance(p(-1, -1), p(-1, -1))).toBe(0);
  });
});

describe('pixel conversion (§8.2)', () => {
  const W = 1280;
  const H = 720;
  // A true 90° joint drawn in PIXELS with both arms on diagonals, so that unequal scaling of
  // x and y changes the angle. Vertex at frame center, arms 200 px long at ±45°.
  const aPx = p(640 + 200, 360 - 200);
  const bPx = p(640, 360);
  const cPx = p(640 - 200, 360 - 200);
  const normalized = [aPx, bPx, cPx].map((q) => lm(q.x / W, q.y / H));

  it('gives the correct angle after converting to pixels on a 1280×720 frame', () => {
    const [a, b, c] = toPixelLandmarks(normalized, W, H);
    expect(angleAt(a, b, c)).toBeCloseTo(90, 9);
  });

  it('would give a wrong angle on normalized coordinates (the bug this avoids)', () => {
    const [a, b, c] = normalized;
    const wrong = angleAt(a, b, c);
    expect(Math.abs(wrong - 90)).toBeGreaterThan(20); // ≈ 58.7°
  });

  it('round-trips coordinates and keeps visibility and normalized values', () => {
    const out = toPixel(lm(0.25, 0.5, 0.42), W, H);
    expect(out).toEqual({ x: 320, y: 360, visibility: 0.42, nx: 0.25, ny: 0.5 });
  });

  it('gives the same angle for the same pose at different resolutions', () => {
    const lowRes = toPixelLandmarks(normalized, 640, 360);
    const hiRes = toPixelLandmarks(normalized, 1920, 1080);
    expect(angleAt(lowRes[0], lowRes[1], lowRes[2])).toBeCloseTo(
      angleAt(hiRes[0], hiRes[1], hiRes[2]),
      9,
    );
  });
});
