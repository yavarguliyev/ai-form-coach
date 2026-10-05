// Tests for the test-data generator itself: if it produced wrong angles, every exercise
// test built on it would be meaningless.
import { describe, expect, it } from 'vitest';
import { angleAt, angleFromVertical, toPixelLandmarks } from '../geometry';
import { LM } from '../landmarks';
import {
  generateCurl,
  generatePress,
  generateSquat,
  hold,
  ramp,
  repeat,
  sweep,
  timeline,
  type SyntheticFrame,
} from './helpers/synthetic';

const px = (f: SyntheticFrame) => toPixelLandmarks(f.landmarks!, f.videoWidth, f.videoHeight);

describe('timeline', () => {
  it('chains segments and reports total duration', () => {
    const tl = timeline(hold(170, 500), sweep(170, 85, 2000), ramp(170, 100, 1000));
    expect(tl.durationMs).toBe(3500);
    expect(tl.at(0)).toBe(170);
    expect(tl.at(500)).toBeCloseTo(170, 9); // sweep start
    expect(tl.at(1500)).toBeCloseTo(85, 9); // sweep midpoint
    expect(tl.at(2500)).toBeCloseTo(170, 9); // ramp start
    expect(tl.at(3000)).toBeCloseTo(135, 9);
    expect(tl.at(99999)).toBe(100); // clamps to the end
  });

  it('repeat() flattens', () => {
    expect(timeline(repeat(hold(1, 100), 5)).durationMs).toBe(500);
  });
});

describe('frames', () => {
  it('produce fps·duration frames with matching timestamps and size', () => {
    const frames = generateSquat({ knee: timeline(hold(170, 1000)) }, { fps: 30, startMs: 5000 });
    expect(frames).toHaveLength(30);
    expect(frames[1].timestampMs - frames[0].timestampMs).toBeCloseTo(1000 / 30, 9);
    expect(frames[0].timestampMs).toBe(5000);
    expect([frames[0].videoWidth, frames[0].videoHeight]).toEqual([1280, 720]);
    expect(frames[0].landmarks).toHaveLength(33);
  });

  it('keep every landmark inside the frame by default (squat, curl)', () => {
    for (const frames of [
      generateSquat({ knee: timeline(sweep(175, 60, 2000)) }),
      generateCurl({ elbow: timeline(sweep(175, 30, 2000)) }),
    ]) {
      for (const f of frames) {
        for (const lm of f.landmarks!) {
          expect(lm.x).toBeGreaterThanOrEqual(0);
          expect(lm.x).toBeLessThanOrEqual(1);
          expect(lm.y).toBeGreaterThanOrEqual(0);
          expect(lm.y).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('are deterministic for a given seed and differ across seeds', () => {
    const make = (seed: number) =>
      generateSquat({ knee: timeline(hold(170, 300)) }, { noisePx: 3, seed });
    expect(make(7)).toEqual(make(7));
    expect(make(7)).not.toEqual(make(8));
  });
});

describe('generateSquat', () => {
  const knee = timeline(sweep(170, 85, 2000));

  it.each([
    [1280, 720],
    [640, 480],
    [1920, 1080],
  ])('measures back the requested knee angle at %ix%i', (width, height) => {
    const frames = generateSquat({ knee }, { width, height });
    frames.forEach((f, i) => {
      const p = px(f);
      const measured = angleAt(p[LM.LEFT_HIP], p[LM.LEFT_KNEE], p[LM.LEFT_ANKLE]);
      expect(measured).toBeCloseTo(knee.at((i * 1000) / 30), 6);
    });
  });

  it('measures back the requested torso lean', () => {
    const frames = generateSquat({ knee: timeline(hold(100, 500)), torsoLean: 60 });
    const p = px(frames[0]);
    expect(angleFromVertical(p[LM.LEFT_HIP], p[LM.LEFT_SHOULDER])).toBeCloseTo(60, 6);
  });

  it('puts the hips behind the knees (facing right → hips at smaller x)', () => {
    const p = px(generateSquat({ knee: timeline(hold(90, 100)) })[0]);
    expect(p[LM.LEFT_HIP].x).toBeLessThan(p[LM.LEFT_KNEE].x);
    expect(p[LM.LEFT_HIP].y).toBeLessThan(p[LM.LEFT_ANKLE].y);
  });

  it('mirrors correctly when facing left', () => {
    const frames = generateSquat({ knee: timeline(hold(90, 100)) }, { facing: 'left' });
    const p = px(frames[0]);
    expect(p[LM.LEFT_HIP].x).toBeGreaterThan(p[LM.LEFT_KNEE].x);
    expect(angleAt(p[LM.LEFT_HIP], p[LM.LEFT_KNEE], p[LM.LEFT_ANKLE])).toBeCloseTo(90, 6);
  });

  it('makes the near side visible and the far side less so', () => {
    const [f] = generateSquat({ knee: timeline(hold(170, 100)) }, { nearSide: 'right' });
    expect(f.landmarks![LM.RIGHT_KNEE].visibility).toBe(0.95);
    expect(f.landmarks![LM.LEFT_KNEE].visibility).toBe(0.5);
  });
});

describe('generateCurl', () => {
  it('measures back the requested elbow angle and upper-arm swing', () => {
    const elbow = timeline(sweep(170, 35, 2000));
    const frames = generateCurl({ elbow, upperArmSwing: 30 });
    frames.forEach((f, i) => {
      const p = px(f);
      expect(angleAt(p[LM.LEFT_SHOULDER], p[LM.LEFT_ELBOW], p[LM.LEFT_WRIST])).toBeCloseTo(
        elbow.at((i * 1000) / 30),
        6,
      );
      expect(angleAt(p[LM.LEFT_ELBOW], p[LM.LEFT_SHOULDER], p[LM.LEFT_HIP])).toBeCloseTo(30, 6);
    });
  });

  it('brings the hand up in front of the body (facing right)', () => {
    const p = px(generateCurl({ elbow: timeline(hold(60, 100)) })[0]);
    expect(p[LM.LEFT_WRIST].x).toBeGreaterThan(p[LM.LEFT_ELBOW].x);
    expect(p[LM.LEFT_WRIST].y).toBeLessThan(p[LM.LEFT_ELBOW].y);
  });
});

describe('generatePress', () => {
  it('measures back both elbow angles, including uneven arms', () => {
    const leftElbow = timeline(sweep(90, 165, 2000));
    const frames = generatePress({ leftElbow, rightElbow: (_t, left) => left - 25 });
    frames.forEach((f, i) => {
      const p = px(f);
      const left = leftElbow.at((i * 1000) / 30);
      expect(angleAt(p[LM.LEFT_SHOULDER], p[LM.LEFT_ELBOW], p[LM.LEFT_WRIST])).toBeCloseTo(left, 6);
      expect(angleAt(p[LM.RIGHT_SHOULDER], p[LM.RIGHT_ELBOW], p[LM.RIGHT_WRIST])).toBeCloseTo(
        left - 25,
        6,
      );
    });
  });

  it('has wrists below the nose at the bottom and above it at the top', () => {
    const bottom = px(generatePress({ leftElbow: timeline(hold(90, 100)) })[0]);
    const top = px(generatePress({ leftElbow: timeline(hold(165, 100)) })[0]);
    for (const w of [LM.LEFT_WRIST, LM.RIGHT_WRIST]) {
      expect(bottom[w].y).toBeGreaterThan(bottom[LM.NOSE].y);
      expect(top[w].y).toBeLessThan(top[LM.NOSE].y);
    }
  });

  it("places the person's left arm on the image right (facing the camera)", () => {
    const p = px(generatePress({ leftElbow: timeline(hold(120, 100)) })[0]);
    expect(p[LM.LEFT_SHOULDER].x).toBeGreaterThan(p[LM.RIGHT_SHOULDER].x);
  });
});

describe('noise and visibility drops', () => {
  it('adds gaussian noise with roughly the requested standard deviation', () => {
    const clean = generateSquat({ knee: timeline(hold(170, 10000)) });
    const noisy = generateSquat({ knee: timeline(hold(170, 10000)) }, { noisePx: 4, seed: 3 });
    const dx = noisy.map((f, i) => (f.landmarks![LM.LEFT_KNEE].x - clean[i].landmarks![LM.LEFT_KNEE].x) * 1280);
    const mean = dx.reduce((a, b) => a + b, 0) / dx.length;
    const sd = Math.sqrt(dx.reduce((a, b) => a + (b - mean) ** 2, 0) / dx.length);
    expect(Math.abs(mean)).toBeLessThan(0.5);
    expect(sd).toBeGreaterThan(3.5);
    expect(sd).toBeLessThan(4.5);
  });

  it('lowers visibility of chosen landmarks only within the window', () => {
    const frames = generateSquat(
      { knee: timeline(hold(170, 1000)) },
      { drops: [{ fromMs: 300, toMs: 600, landmarks: [LM.LEFT_KNEE], visibility: 0.2 }] },
    );
    const vis = (f: SyntheticFrame, i: number) => f.landmarks![i].visibility;
    expect(vis(frames[5], LM.LEFT_KNEE)).toBe(0.95); // t=167
    expect(vis(frames[12], LM.LEFT_KNEE)).toBe(0.2); // t=400
    expect(vis(frames[12], LM.LEFT_HIP)).toBe(0.95);
    expect(vis(frames[20], LM.LEFT_KNEE)).toBe(0.95); // t=667
  });

  it('can make the person disappear entirely', () => {
    const frames = generateSquat(
      { knee: timeline(hold(170, 1000)) },
      { drops: [{ fromMs: 300, toMs: 600, noPerson: true }] },
    );
    expect(frames[12].landmarks).toBeNull();
    expect(frames[25].landmarks).not.toBeNull();
  });

  it('can move landmarks off-frame while keeping high visibility (model guessing)', () => {
    const [f] = generateSquat(
      { knee: timeline(hold(170, 100)) },
      { drops: [{ fromMs: 0, toMs: 100, landmarks: [LM.LEFT_ANKLE], offFrame: true }] },
    );
    expect(f.landmarks![LM.LEFT_ANKLE].y).toBeGreaterThan(1);
    expect(f.landmarks![LM.LEFT_ANKLE].visibility).toBe(0.95);
  });
});
