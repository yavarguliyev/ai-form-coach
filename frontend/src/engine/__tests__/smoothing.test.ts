import { describe, expect, it } from 'vitest';
import type { PixelLandmark } from '../geometry';
import { SMOOTHING_ALPHA, createLandmarkSmoother } from '../smoothing';

const pt = (x: number, y: number, visibility = 1): PixelLandmark => ({
  x,
  y,
  visibility,
  nx: x / 1280,
  ny: y / 720,
});

describe('createLandmarkSmoother', () => {
  it('uses alpha 0.5 by default', () => {
    expect(SMOOTHING_ALPHA).toBe(0.5);
  });

  it('passes the first frame through unchanged', () => {
    const s = createLandmarkSmoother();
    expect(s.smooth([pt(100, 200)])).toEqual([pt(100, 200)]);
  });

  it('blends α·current + (1−α)·previous', () => {
    const s = createLandmarkSmoother(0.5);
    s.smooth([pt(100, 200)]);
    const [out] = s.smooth([pt(200, 100)]);
    expect([out.x, out.y]).toEqual([150, 150]);
    const [out2] = s.smooth([pt(200, 100)]);
    expect([out2.x, out2.y]).toEqual([175, 125]);
  });

  it('respects a custom alpha', () => {
    const s = createLandmarkSmoother(0.25);
    s.smooth([pt(0, 0)]);
    expect(s.smooth([pt(100, 100)])[0].x).toBe(25);
  });

  it('converges to a constant input', () => {
    const s = createLandmarkSmoother();
    s.smooth([pt(0, 0)]);
    let out = pt(0, 0);
    for (let i = 0; i < 40; i++) [out] = s.smooth([pt(640, 360)]);
    expect(out.x).toBeCloseTo(640, 6);
    expect(out.y).toBeCloseTo(360, 6);
  });

  it('cuts frame-to-frame jitter to a third of its amplitude (α = 0.5)', () => {
    // A landmark flickering ±8 px around 500 every frame.
    const s = createLandmarkSmoother();
    const outputs: number[] = [];
    for (let i = 0; i < 60; i++) outputs.push(s.smooth([pt(500 + (i % 2 ? 8 : -8), 0)])[0].x);
    const settled = outputs.slice(20);
    const amplitude = (Math.max(...settled) - Math.min(...settled)) / 2;
    expect(amplitude).toBeCloseTo(8 / 3, 3); // steady-state: α/(2−α)·A
  });

  it('passes visibility and normalized coordinates through raw (not smoothed)', () => {
    const s = createLandmarkSmoother();
    s.smooth([{ ...pt(100, 100), visibility: 0.9, nx: 0.1, ny: 0.2 }]);
    const [out] = s.smooth([{ ...pt(300, 300), visibility: 0.1, nx: 1.3, ny: 0.4 }]);
    expect([out.visibility, out.nx, out.ny]).toEqual([0.1, 1.3, 0.4]);
  });

  it('starts fresh after reset()', () => {
    const s = createLandmarkSmoother();
    s.smooth([pt(0, 0)]);
    s.smooth([pt(10, 10)]);
    s.reset();
    expect(s.smooth([pt(900, 500)])).toEqual([pt(900, 500)]);
  });

  it('restarts when the landmark count changes', () => {
    const s = createLandmarkSmoother();
    s.smooth([pt(0, 0)]);
    expect(s.smooth([pt(50, 50), pt(60, 60)])).toEqual([pt(50, 50), pt(60, 60)]);
  });

  it('does not mutate its input or hand out its internal state', () => {
    const s = createLandmarkSmoother();
    const input = [pt(0, 0)];
    s.smooth(input);
    const out = s.smooth([pt(100, 100)]);
    out[0].x = 9999;
    expect(input[0]).toEqual(pt(0, 0));
    expect(s.smooth([pt(100, 100)])[0].x).toBe(75); // 0.5·100 + 0.5·50, unaffected by 9999
  });

  it('rejects an alpha outside (0, 1]', () => {
    expect(() => createLandmarkSmoother(0)).toThrow(RangeError);
    expect(() => createLandmarkSmoother(1.5)).toThrow(RangeError);
    expect(() => createLandmarkSmoother(Number.NaN)).toThrow(RangeError);
  });
});
