// Shoulder press tests (CLAUDE.md §8.11), on synthetic front-view landmark sequences.
import { describe, expect, it } from 'vitest';
import { createAnalyzer, type AnalyzerOutput } from '../analyzer';
import { EXERCISES, getExercise } from '../exercises';
import {
  PRESS_END_ANGLE,
  PRESS_LEAVE_TOP_ANGLE,
  PRESS_MAX_ARM_ASYMMETRY,
  PRESS_MAX_WRIST_HEIGHT_DIFF,
  PRESS_START_ANGLE,
  PRESS_TOO_FAST_MS,
  shoulderPress,
} from '../exercises/shoulderPress';
import { LM } from '../landmarks';
import {
  generatePress,
  hold,
  repeat,
  sweep,
  timeline,
  type GenerateOptions,
  type PressParams,
} from './helpers/synthetic';

function run(params: PressParams, opts?: GenerateOptions) {
  const analyzer = createAnalyzer(shoulderPress);
  const outputs: AnalyzerOutput[] = generatePress(params, opts).map((f) =>
    analyzer.processFrame(f.landmarks, f.videoWidth, f.videoHeight, f.timestampMs),
  );
  return {
    outputs,
    last: outputs[outputs.length - 1],
    completed: outputs.flatMap((o) => (o.completedRep ? [o.completedRep] : [])),
    rejected: outputs.flatMap((o) => (o.rejectedRep ? [o.rejectedRep] : [])),
    cues: outputs.flatMap((o) => (o.liveCue ? [o.liveCue] : [])),
  };
}

const START = hold(90, 700); // hands at the shoulders
const END = hold(90, 300);
const REP = sweep(90, 168, 2000);

describe('shoulder press definition', () => {
  it('uses the spec thresholds, increasing', () => {
    expect([PRESS_START_ANGLE, PRESS_LEAVE_TOP_ANGLE, PRESS_END_ANGLE]).toEqual([100, 115, 155]);
    expect([PRESS_MAX_ARM_ASYMMETRY, PRESS_MAX_WRIST_HEIGHT_DIFF, PRESS_TOO_FAST_MS]).toEqual([20, 0.25, 800]);
    expect(shoulderPress.thresholds.direction).toBe('increasing');
    expect(shoulderPress.cameraView).toBe('front');
  });

  it('requires both shoulders, elbows, wrists and the nose', () => {
    expect(shoulderPress.requiredLandmarks(null).sort((a, b) => a - b)).toEqual([0, 11, 12, 13, 14, 15, 16]);
  });
});

describe('shoulder press (§8.11)', () => {
  it('5 clean presses → count = 5, no errors, no side', () => {
    const r = run({ leftElbow: timeline(START, repeat(REP, 5), END) });
    expect(r.completed).toHaveLength(5);
    expect(r.completed.every((c) => c.errors.length === 0 && c.score === 100)).toBe(true);
    expect(r.cues).toEqual([]);
    expect(r.last.side).toBeNull();
  });

  it('presses stopping at 140° → count = 0, PRESS_PARTIAL reported', () => {
    const r = run({ leftElbow: timeline(START, repeat(sweep(90, 140, 2000), 3), END) });
    expect(r.completed).toHaveLength(0);
    expect(r.rejected).toHaveLength(3);
    expect(r.rejected.every((x) => x.reason === 'partial' && x.cue === 'PRESS_PARTIAL')).toBe(true);
  });

  it('straight arms but wrists NOT above the nose (pushed out sideways) → not counted', () => {
    // Elbows reach 168° but the arms stay horizontal: the wrists-above-nose rule fails.
    const r = run({
      leftElbow: timeline(START, REP, END),
      leftElevationOffset: (_t, angle) => -((angle - 90) * 75) / 80, // cancel the rise: arm stays at −15°
      rightElevationOffset: (_t, angle) => -((angle - 90) * 75) / 80,
    });
    expect(r.outputs.some((o) => (o.primaryAngle ?? 0) > PRESS_END_ANGLE)).toBe(true); // angle reached
    expect(r.completed).toHaveLength(0);
    expect(r.rejected).toEqual([{ reason: 'partial', cue: 'PRESS_PARTIAL' }]);
  });

  it('uneven press: right elbow 25° behind the left → counted with PRESS_UNEVEN', () => {
    const r = run({
      leftElbow: timeline(START, sweep(90, 178, 2000), END),
      rightElbow: (_t, left) => Math.max(85, left - 25 * Math.min(1, (left - 90) / 40)),
    });
    expect(r.completed).toHaveLength(1);
    expect(r.completed[0].errors).toEqual(['PRESS_UNEVEN']);
    expect(r.completed[0].score).toBe(70);
    expect(r.completed[0].metrics.max_armAsymmetry).toBeGreaterThan(PRESS_MAX_ARM_ASYMMETRY);
    expect(r.cues).toContain('PRESS_UNEVEN');
  });

  it('uneven press by wrist height only (equal elbow angles) → PRESS_UNEVEN', () => {
    const r = run({ leftElbow: timeline(START, REP, END), rightElevationOffset: -15 });
    expect(r.completed).toHaveLength(1);
    expect(r.completed[0].metrics.max_armAsymmetry).toBeLessThan(1);
    expect(r.completed[0].metrics.max_wristHeightDiff).toBeGreaterThan(PRESS_MAX_WRIST_HEIGHT_DIFF);
    expect(r.completed[0].errors).toEqual(['PRESS_UNEVEN']);
  });

  it('a small 10° difference between arms is fine', () => {
    const r = run({ leftElbow: timeline(START, REP, END), rightElbow: (_t, left) => left - 10 * Math.min(1, (left - 90) / 40) });
    expect(r.completed).toHaveLength(1);
    expect(r.completed[0].errors).toEqual([]);
  });

  it('a fast but valid press (~700 ms) is counted with PRESS_TOO_FAST', () => {
    const r = run({ leftElbow: timeline(START, sweep(90, 168, 1000), END) });
    expect(r.completed).toHaveLength(1);
    expect(r.completed[0].durationMs).toBeLessThan(PRESS_TOO_FAST_MS);
    expect(r.completed[0].errors).toEqual(['PRESS_TOO_FAST']);
    expect(r.completed[0].score).toBe(85);
  });

  it('a press under 600 ms is rejected', () => {
    const r = run({ leftElbow: timeline(START, sweep(90, 168, 700), END) });
    expect(r.completed).toHaveLength(0);
    expect(r.rejected[0].reason).toBe('too_short');
  });

  it('jitter: average elbow oscillating ±8° around 100 for 3 s → count = 0', () => {
    const r = run(
      { leftElbow: { durationMs: 3700, at: (t) => (t < 700 ? 90 : 100 + (Math.floor(t / (1000 / 30)) % 2 ? 8 : -8)) } },
      { noisePx: 1, seed: 3 },
    );
    expect(r.completed).toHaveLength(0);
    expect(r.cues).toEqual([]);
  });

  it('head out of frame mid-press → partial rep discarded, NOT_VISIBLE, no count', () => {
    const r = run(
      { leftElbow: timeline(START, REP, END) },
      { drops: [{ fromMs: 1300, toMs: 2100, landmarks: [LM.NOSE], visibility: 0.05 }] },
    );
    expect(r.outputs[Math.floor((1300 * 30) / 1000) - 1].state).toBe('IN_REP');
    expect(r.outputs.map((o) => o.state)).toContain('NOT_VISIBLE');
    expect(r.completed).toHaveLength(0);
    expect(r.rejected[0].reason).toBe('lost_tracking');
    expect(r.outputs.some((o) => o.visibilityMessage === "Move into the frame — I can't see your head")).toBe(true);
  });

  it('counts with landmark noise', () => {
    const r = run({ leftElbow: timeline(START, repeat(REP, 4), END) }, { noisePx: 1.5, seed: 8 });
    expect(r.completed).toHaveLength(4);
  });
});

describe('exercise registry', () => {
  it('has all three exercises by slug', () => {
    expect(Object.keys(EXERCISES).sort()).toEqual(['bicep_curl', 'shoulder_press', 'squat']);
    expect(getExercise('shoulder_press')).toBe(shoulderPress);
  });

  it('returns undefined for unknown slugs, including prototype keys', () => {
    expect(getExercise('lunge')).toBeUndefined();
    expect(getExercise('constructor')).toBeUndefined();
    expect(getExercise('__proto__')).toBeUndefined();
  });
});
