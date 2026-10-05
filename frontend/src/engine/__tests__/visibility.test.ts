import { describe, expect, it } from 'vitest';
import type { PixelLandmark } from '../geometry';
import { LM } from '../landmarks';
import {
  FRAME_MARGIN,
  LOST_TRACKING_MS,
  MIN_VISIBILITY,
  checkVisibility,
  chooseSide,
  createTrackingMonitor,
  isLandmarkUsable,
  visibilityMessage,
} from '../visibility';

/** 33 landmarks, all centered and fully visible, with optional per-index overrides. */
function frame(overrides: Record<number, Partial<PixelLandmark>> = {}): PixelLandmark[] {
  return Array.from({ length: 33 }, (_, i) => ({
    x: 640,
    y: 360,
    nx: 0.5,
    ny: 0.5,
    visibility: 0.99,
    ...overrides[i],
  }));
}

const SQUAT_LEFT = [LM.LEFT_SHOULDER, LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE];
const CHAINS = {
  left: [LM.LEFT_SHOULDER, LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE],
  right: [LM.RIGHT_SHOULDER, LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE],
};

describe('isLandmarkUsable', () => {
  it('requires visibility >= 0.6 (inclusive)', () => {
    expect(MIN_VISIBILITY).toBe(0.6);
    expect(isLandmarkUsable(frame({ 0: { visibility: 0.6 } })[0])).toBe(true);
    expect(isLandmarkUsable(frame({ 0: { visibility: 0.59 } })[0])).toBe(false);
  });

  it('rejects a highly "visible" landmark that lies outside the frame', () => {
    // The T-13 finding: MediaPipe gave ~0.99 visibility for knees it was guessing off-frame.
    expect(isLandmarkUsable(frame({ 0: { visibility: 0.99, ny: 1.08 } })[0])).toBe(false);
    expect(isLandmarkUsable(frame({ 0: { visibility: 0.99, nx: -0.05 } })[0])).toBe(false);
  });

  it('allows the small FRAME_MARGIN around the edges', () => {
    expect(isLandmarkUsable(frame({ 0: { ny: 1 + FRAME_MARGIN } })[0])).toBe(true);
    expect(isLandmarkUsable(frame({ 0: { nx: -FRAME_MARGIN } })[0])).toBe(true);
    expect(isLandmarkUsable(frame({ 0: { ny: 1 + FRAME_MARGIN + 0.001 } })[0])).toBe(false);
  });

  it('treats a missing landmark as unusable', () => {
    expect(isLandmarkUsable(undefined)).toBe(false);
  });
});

describe('checkVisibility', () => {
  it('passes when every required landmark is usable', () => {
    expect(checkVisibility(frame(), SQUAT_LEFT)).toEqual({ ok: true, missing: [] });
  });

  it('lists the failing required landmarks in order', () => {
    const lms = frame({ [LM.LEFT_ANKLE]: { visibility: 0.3 }, [LM.LEFT_KNEE]: { ny: 1.2 } });
    expect(checkVisibility(lms, SQUAT_LEFT)).toEqual({
      ok: false,
      missing: [LM.LEFT_KNEE, LM.LEFT_ANKLE],
    });
  });

  it('ignores landmarks that are not required', () => {
    const lms = frame({ [LM.RIGHT_KNEE]: { visibility: 0 }, [LM.NOSE]: { nx: 5 } });
    expect(checkVisibility(lms, SQUAT_LEFT).ok).toBe(true);
  });

  it('fails with everything missing when no person is detected', () => {
    expect(checkVisibility(null, SQUAT_LEFT)).toEqual({ ok: false, missing: SQUAT_LEFT });
  });
});

describe('chooseSide', () => {
  it('picks the side with higher mean visibility', () => {
    const lms = frame(
      Object.fromEntries(CHAINS.right.map((i) => [i, { visibility: 0.4 }])),
    );
    expect(chooseSide(lms, CHAINS)).toBe('left');
    const lms2 = frame(Object.fromEntries(CHAINS.left.map((i) => [i, { visibility: 0.4 }])));
    expect(chooseSide(lms2, CHAINS)).toBe('right');
  });

  it('counts landmarks outside the frame as invisible', () => {
    // Left chain claims higher visibility, but its knee and ankle are off-frame.
    const lms = frame({
      ...Object.fromEntries(CHAINS.right.map((i) => [i, { visibility: 0.8 }])),
      [LM.LEFT_KNEE]: { ny: 1.3 },
      [LM.LEFT_ANKLE]: { ny: 1.5 },
    });
    expect(chooseSide(lms, CHAINS)).toBe('right');
  });

  it('keeps the current side unless the other is better by more than the margin', () => {
    const slightlyBetterRight = frame(
      Object.fromEntries(CHAINS.left.map((i) => [i, { visibility: 0.85 }])),
    ); // left 0.85, right 0.99 → difference 0.14 > 0.1
    expect(chooseSide(slightlyBetterRight, CHAINS, 'left')).toBe('right');

    const marginallyBetterRight = frame(
      Object.fromEntries(CHAINS.left.map((i) => [i, { visibility: 0.93 }])),
    ); // difference 0.06 ≤ 0.1
    expect(chooseSide(marginallyBetterRight, CHAINS, 'left')).toBe('left');
    expect(chooseSide(marginallyBetterRight, CHAINS)).toBe('right'); // no current side
  });

  it('prefers left on an exact tie', () => {
    expect(chooseSide(frame(), CHAINS)).toBe('left');
  });
});

describe('visibilityMessage', () => {
  it('is null when nothing is missing', () => {
    expect(visibilityMessage(frame(), [])).toBeNull();
  });

  it('asks to step into view when no person is detected', () => {
    expect(visibilityMessage(null, SQUAT_LEFT)).toBe("I can't see you — step into the camera view");
  });

  it('asks to step back when lower-body joints are missing', () => {
    expect(visibilityMessage(frame(), [LM.LEFT_KNEE])).toBe("Step back — I can't see your knees");
    expect(visibilityMessage(frame(), [LM.LEFT_KNEE, LM.LEFT_ANKLE, LM.RIGHT_KNEE])).toBe(
      "Step back — I can't see your knees and ankles",
    );
  });

  it('asks to move into the frame for head or shoulders', () => {
    expect(visibilityMessage(frame(), [LM.NOSE])).toBe("Move into the frame — I can't see your head");
  });

  it('asks to keep arms in view for elbows or wrists', () => {
    expect(visibilityMessage(frame(), [LM.RIGHT_WRIST, LM.RIGHT_ELBOW])).toBe(
      "Keep your arms in view — I can't see your wrists and elbows",
    );
  });

  it('lists three or more parts naturally', () => {
    expect(visibilityMessage(frame(), [LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE])).toBe(
      "Step back — I can't see your hips, knees and ankles",
    );
  });
});

describe('createTrackingMonitor', () => {
  it('reports lost only after invalid frames for MORE than 500 ms', () => {
    expect(LOST_TRACKING_MS).toBe(500);
    const m = createTrackingMonitor();
    expect(m.update(false, 1000)).toBe(false);
    expect(m.update(false, 1400)).toBe(false);
    expect(m.update(false, 1500)).toBe(false); // exactly 500 ms
    expect(m.update(false, 1501)).toBe(true);
  });

  it('a single valid frame resets the timer', () => {
    const m = createTrackingMonitor();
    m.update(false, 0);
    m.update(false, 450);
    expect(m.update(true, 460)).toBe(false);
    expect(m.update(false, 470)).toBe(false);
    expect(m.update(false, 960)).toBe(false); // only 490 ms since the new invalid run began
    expect(m.update(false, 971)).toBe(true);
  });

  it('never reports lost while frames are valid', () => {
    const m = createTrackingMonitor();
    for (let t = 0; t < 5000; t += 33) expect(m.update(true, t)).toBe(false);
  });

  it('reset() clears a running timer', () => {
    const m = createTrackingMonitor();
    m.update(false, 0);
    m.reset();
    expect(m.update(false, 600)).toBe(false);
  });
});
