// Squat tests (CLAUDE.md §8.11), on synthetic side-view landmark sequences.
import { describe, expect, it } from 'vitest';
import { createAnalyzer, type AnalyzerOutput } from '../analyzer';
import { LM } from '../landmarks';
import {
  SQUAT_END_ANGLE,
  SQUAT_LEAVE_TOP_ANGLE,
  SQUAT_MAX_TORSO_LEAN,
  SQUAT_START_ANGLE,
  SQUAT_TOO_FAST_MS,
  isGreatDepth,
  squat,
} from '../exercises/squat';
import { generateSquat, hold, repeat, sweep, timeline, type SideViewOptions, type SquatParams } from './helpers/synthetic';

function run(params: SquatParams, opts?: SideViewOptions) {
  const analyzer = createAnalyzer(squat);
  const outputs: AnalyzerOutput[] = generateSquat(params, opts).map((f) =>
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

const START = hold(170, 700);
const END = hold(170, 300);
const REP = sweep(170, 85, 2000);

describe('squat definition', () => {
  it('uses the spec thresholds with a hysteresis gap', () => {
    expect([SQUAT_START_ANGLE, SQUAT_LEAVE_TOP_ANGLE, SQUAT_END_ANGLE]).toEqual([160, 145, 100]);
    expect(squat.thresholds.direction).toBe('decreasing');
    expect(SQUAT_MAX_TORSO_LEAN).toBe(45);
    expect(SQUAT_TOO_FAST_MS).toBe(1000);
  });

  it('requires shoulder, hip, knee and ankle of the chosen side', () => {
    expect(squat.requiredLandmarks('left')).toEqual([LM.LEFT_SHOULDER, LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE]);
    expect(squat.requiredLandmarks('right')).toEqual([LM.RIGHT_SHOULDER, LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE]);
  });

  it('flags great depth at 90° or below', () => {
    expect(isGreatDepth(90)).toBe(true);
    expect(isGreatDepth(95)).toBe(false);
  });
});

describe('squat (§8.11)', () => {
  it('5 clean synthetic reps → count = 5, no errors', () => {
    const r = run({ knee: timeline(START, repeat(REP, 5), END) });
    expect(r.completed).toHaveLength(5);
    expect(r.completed.every((c) => c.errors.length === 0 && c.score === 100)).toBe(true);
    expect(r.cues).toEqual([]);
    expect(r.completed[0].metrics.max_torsoLean).toBeLessThan(SQUAT_MAX_TORSO_LEAN);
  });

  it('reps that only reach 120° → count = 0, SQUAT_SHALLOW reported', () => {
    const r = run({ knee: timeline(START, repeat(sweep(170, 120, 2000), 4), END) });
    expect(r.completed).toHaveLength(0);
    expect(r.rejected).toHaveLength(4);
    expect(r.rejected.every((x) => x.reason === 'partial' && x.cue === 'SQUAT_SHALLOW')).toBe(true);
    expect(r.cues.filter((c) => c === 'SQUAT_SHALLOW')).toHaveLength(4);
  });

  it('torso leaning 60° → counted with SQUAT_TORSO_LEAN', () => {
    const r = run({ knee: timeline(START, REP, END), torsoLean: 60 });
    expect(r.completed).toHaveLength(1);
    expect(r.completed[0].errors).toEqual(['SQUAT_TORSO_LEAN']);
    expect(r.completed[0].score).toBe(70);
    expect(r.completed[0].metrics.max_torsoLean).toBeCloseTo(60, 0);
    expect(r.cues).toContain('SQUAT_TORSO_LEAN'); // live, during the rep
  });

  it('a lean of 40° (below the limit) is fine', () => {
    const r = run({ knee: timeline(START, REP, END), torsoLean: 40 });
    expect(r.completed[0].errors).toEqual([]);
  });

  it('a fast but valid rep (~800 ms) is counted with SQUAT_TOO_FAST', () => {
    const r = run({ knee: timeline(START, sweep(170, 85, 1100), END) });
    expect(r.completed).toHaveLength(1);
    expect(r.completed[0].durationMs).toBeLessThan(SQUAT_TOO_FAST_MS);
    expect(r.completed[0].durationMs).toBeGreaterThanOrEqual(600);
    expect(r.completed[0].errors).toEqual(['SQUAT_TOO_FAST']);
    expect(r.completed[0].score).toBe(85);
  });

  it('a too-fast rep (< 600 ms) is rejected, not counted', () => {
    const r = run({ knee: timeline(START, sweep(170, 85, 500), END) });
    expect(r.completed).toHaveLength(0);
    expect(r.rejected[0].reason).toBe('too_short');
  });

  it('leaning AND fast → both errors, score 55', () => {
    const r = run({ knee: timeline(START, sweep(170, 85, 1100), END), torsoLean: 55 });
    expect(r.completed[0].errors).toEqual(['SQUAT_TORSO_LEAN', 'SQUAT_TOO_FAST']);
    expect(r.completed[0].score).toBe(55);
  });

  it('jitter: knee oscillating ±8° around 160 for 3 s → count = 0', () => {
    const r = run(
      { knee: { durationMs: 3700, at: (t) => (t < 700 ? 170 : 160 + (Math.floor(t / (1000 / 30)) % 2 ? 8 : -8)) } },
      { noisePx: 1, seed: 4 },
    );
    expect(r.completed).toHaveLength(0);
    expect(r.cues).toEqual([]);
  });

  it('visibility drop mid-rep → partial rep discarded, NOT_VISIBLE, no count', () => {
    const r = run(
      { knee: timeline(START, REP, END) },
      { drops: [{ fromMs: 1400, toMs: 2200, landmarks: [LM.LEFT_ANKLE, LM.RIGHT_ANKLE], visibility: 0.05 }] },
    );
    // The rep was genuinely in progress (knee ≈ 110°) when the ankles disappeared.
    const justBefore = r.outputs[Math.floor((1400 * 30) / 1000) - 1];
    expect(justBefore.state).toBe('IN_REP');
    expect(r.outputs.map((o) => o.state)).toContain('NOT_VISIBLE');
    expect(r.completed).toHaveLength(0);
    expect(r.rejected[0].reason).toBe('lost_tracking');
    expect(r.outputs.some((o) => o.visibilityMessage === "Step back — I can't see your ankles")).toBe(true);
  });

  it.each([
    ['left', 'right'],
    ['right', 'right'],
    ['left', 'left'],
    ['right', 'left'],
  ] as const)('works with the %s side near the camera, facing %s', (nearSide, facing) => {
    const r = run({ knee: timeline(START, repeat(REP, 3), END) }, { nearSide, facing, noisePx: 1.5, seed: 9 });
    expect(r.last.side).toBe(nearSide);
    expect(r.completed).toHaveLength(3);
    expect(r.completed.every((c) => c.errors.length === 0)).toBe(true);
  });

  it('a half-rep set: 5 reps to 120° then 3 full reps → only 3 counted', () => {
    const r = run({ knee: timeline(START, repeat(sweep(170, 120, 2000), 5), repeat(REP, 3), END) });
    expect(r.completed).toHaveLength(3);
    expect(r.completed.map((c) => c.index)).toEqual([1, 2, 3]);
  });
});
