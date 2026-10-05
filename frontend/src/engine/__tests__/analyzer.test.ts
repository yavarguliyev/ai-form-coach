// Analyzer tests (CLAUDE.md §8.11, the parts that don't depend on a specific exercise).
import { describe, expect, it } from 'vitest';
import { createAnalyzer, type AnalyzerOutput } from '../analyzer';
import { LM } from '../landmarks';
import { generateSquat, hold, repeat, sweep, timeline, type SyntheticFrame } from './helpers/synthetic';
import { testExercise } from './helpers/testExercise';

function run(frames: SyntheticFrame[], analyzer = createAnalyzer(testExercise)) {
  const outputs: AnalyzerOutput[] = frames.map((f) =>
    analyzer.processFrame(f.landmarks, f.videoWidth, f.videoHeight, f.timestampMs),
  );
  return {
    outputs,
    last: outputs[outputs.length - 1],
    completed: outputs.flatMap((o) => (o.completedRep ? [o.completedRep] : [])),
    rejected: outputs.flatMap((o) => (o.rejectedRep ? [o.rejectedRep] : [])),
    states: outputs.map((o) => o.state),
  };
}

const START = hold(170, 700); // stand still long enough for the 500 ms start hold
const REP = sweep(170, 85, 2000);
// Stand still briefly at the end: smoothing trails the true angle by a frame or two, so a
// clip that ends exactly as the last rep returns to 170° hasn't crossed back past 160° yet.
const END = hold(170, 300);
// Keep the torso nearly upright unless a test says otherwise.
const UPRIGHT = 10;

describe('counting', () => {
  it('counts 5 clean synthetic reps with no errors', () => {
    const r = run(generateSquat({ knee: timeline(START, repeat(REP, 5)), torsoLean: UPRIGHT }));
    expect(r.completed).toHaveLength(5);
    expect(r.completed.map((c) => c.index)).toEqual([1, 2, 3, 4, 5]);
    for (const rep of r.completed) {
      expect(rep.errors).toEqual([]);
      expect(rep.score).toBe(100);
      expect(rep.minAngle).toBeCloseTo(85, 0);
    }
    expect(r.rejected).toHaveLength(0);
    expect(r.last.repCount).toBe(5);
  });

  it('measures the true angle on a 1280×720 frame (pixel conversion end to end)', () => {
    const r = run(generateSquat({ knee: timeline(START, hold(120, 1000)), torsoLean: UPRIGHT }));
    // Smoothing has converged on the held value by the end (50° · 0.5^30 ≈ 0).
    expect(r.last.primaryAngle).toBeCloseTo(120, 6);
  });

  it('counts the same on 640×480 and 1920×1080 frames', () => {
    for (const [width, height] of [
      [640, 480],
      [1920, 1080],
    ]) {
      const r = run(
        generateSquat({ knee: timeline(START, repeat(REP, 3)), torsoLean: UPRIGHT }, { width, height }),
      );
      expect(r.completed).toHaveLength(3);
    }
  });

  it('still counts correctly with 2 px landmark noise', () => {
    const r = run(
      generateSquat({ knee: timeline(START, repeat(REP, 5)), torsoLean: UPRIGHT }, { noisePx: 2, seed: 11 }),
    );
    expect(r.completed).toHaveLength(5);
  });

  it('reports startedAtMs and duration on the caller’s clock', () => {
    const r = run(
      generateSquat({ knee: timeline(START, REP), torsoLean: UPRIGHT }, { startMs: 1_000_000 }),
    );
    const [rep] = r.completed;
    expect(rep.startedAtMs).toBeGreaterThan(1_000_700);
    expect(rep.startedAtMs).toBeLessThan(1_001_200);
    expect(rep.durationMs).toBeGreaterThan(1200);
    expect(rep.durationMs).toBeLessThan(2000);
  });
});

describe('rejections', () => {
  it('counts nothing for an angle oscillating ±8° around 160 for 3 s', () => {
    const frames = generateSquat({
      knee: {
        durationMs: 3700,
        at: (t) => (t < 700 ? 170 : 160 + (Math.floor(t / (1000 / 30)) % 2 ? 8 : -8)),
      },
      torsoLean: UPRIGHT,
    });
    const r = run(frames);
    expect(r.completed).toHaveLength(0);
    expect(r.outputs.some((o) => o.liveCue !== null)).toBe(false);
  });

  it('rejects a too-fast rep (< 600 ms)', () => {
    const r = run(generateSquat({ knee: timeline(START, sweep(170, 85, 500), END), torsoLean: UPRIGHT }));
    expect(r.completed).toHaveLength(0);
    expect(r.rejected).toEqual([{ reason: 'too_short', cue: null }]);
  });

  it('rejects shallow reps with the partial cue and counts none', () => {
    const r = run(generateSquat({ knee: timeline(START, repeat(sweep(170, 120, 2000), 3)), torsoLean: UPRIGHT }));
    expect(r.completed).toHaveLength(0);
    expect(r.rejected).toEqual(Array(3).fill({ reason: 'partial', cue: 'SQUAT_SHALLOW' }));
    expect(r.outputs.filter((o) => o.liveCue === 'SQUAT_SHALLOW')).toHaveLength(3);
  });
});

describe('form errors', () => {
  it('counts a rep with a form error, scores it, and records the metric maximum', () => {
    const r = run(generateSquat({ knee: timeline(START, REP), torsoLean: (_t, knee) => (knee < 120 ? 60 : 10) }));
    expect(r.completed).toHaveLength(1);
    expect(r.completed[0].errors).toEqual(['SQUAT_TORSO_LEAN']);
    expect(r.completed[0].score).toBe(70);
    expect(r.completed[0].metrics.max_torsoLean).toBeCloseTo(60, 0);
    // The live cue fired during the rep, not only at the end.
    expect(r.outputs.some((o) => o.state === 'IN_REP' && o.liveCue === 'SQUAT_TORSO_LEAN')).toBe(true);
  });

  it('never takes a form error from frames outside a rep', () => {
    // Leaning while standing (between reps) must not mark the next clean rep.
    const knee = timeline(START, hold(170, 1000), REP);
    const r = run(generateSquat({ knee, torsoLean: (t) => (t > 700 && t < 1700 ? 70 : 10) }));
    expect(r.completed).toHaveLength(1);
    expect(r.completed[0].errors).toEqual([]);
  });
});

describe('visibility', () => {
  const knee = timeline(START, REP, REP, END);

  it('drop mid-rep: partial rep discarded, NOT_VISIBLE, no count, specific message', () => {
    // Knee unreadable for 800 ms in the middle of the first rep. After tracking returns the
    // user must hold the start position again (READY) before the next rep can count.
    const frames = generateSquat(
      { knee: timeline(START, REP, hold(170, 700), REP, END), torsoLean: UPRIGHT },
      { drops: [{ fromMs: 1200, toMs: 2000, landmarks: [LM.LEFT_KNEE, LM.RIGHT_KNEE], visibility: 0.1 }] },
    );
    const r = run(frames);
    expect(r.states).toContain('NOT_VISIBLE');
    expect(r.rejected[0]).toEqual({ reason: 'lost_tracking', cue: null });
    const during = r.outputs[Math.round(1.9 * 30)];
    expect(during.visibilityOk).toBe(false);
    expect(during.visibilityMessage).toBe("Step back — I can't see your knees");
    expect(during.primaryAngle).toBeNull();
    // First rep lost; the second, done after holding the start position again, counts.
    expect(r.completed).toHaveLength(1);
    expect(r.completed[0].startedAtMs).toBeGreaterThan(3400);
  });

  it('without holding the start position after lost tracking, the next rep does not count', () => {
    const frames = generateSquat(
      { knee, torsoLean: UPRIGHT },
      { drops: [{ fromMs: 1200, toMs: 2000, landmarks: [LM.LEFT_KNEE, LM.RIGHT_KNEE], visibility: 0.1 }] },
    );
    expect(run(frames).completed).toHaveLength(0);
  });

  it('a brief drop (< 500 ms) mid-rep is ignored and the rep still counts', () => {
    const frames = generateSquat(
      { knee, torsoLean: UPRIGHT },
      { drops: [{ fromMs: 1300, toMs: 1600, landmarks: [LM.LEFT_KNEE], visibility: 0.1 }] },
    );
    const r = run(frames);
    expect(r.states).not.toContain('NOT_VISIBLE');
    expect(r.completed).toHaveLength(2);
  });

  it('rejects off-frame joints even when MediaPipe reports them as visible', () => {
    const frames = generateSquat(
      { knee, torsoLean: UPRIGHT },
      { drops: [{ fromMs: 1200, toMs: 2000, landmarks: [LM.LEFT_ANKLE, LM.RIGHT_ANKLE], offFrame: true }] },
    );
    const r = run(frames);
    expect(r.rejected[0].reason).toBe('lost_tracking');
    expect(r.outputs[Math.round(1.9 * 30)].visibilityMessage).toBe("Step back — I can't see your ankles");
  });

  it('says so when nobody is in view and counts nothing', () => {
    const r = run(generateSquat({ knee, torsoLean: UPRIGHT }, { drops: [{ fromMs: 0, toMs: 99999, noPerson: true }] }));
    expect(r.completed).toHaveLength(0);
    expect(r.last.state).toBe('NOT_VISIBLE');
    expect(r.last.visibilityMessage).toBe("I can't see you — step into the camera view");
  });
});

describe('side selection', () => {
  it('uses the side nearer the camera', () => {
    const r = run(generateSquat({ knee: timeline(START, REP), torsoLean: UPRIGHT }, { nearSide: 'right' }));
    expect(r.last.side).toBe('right');
    expect(r.completed).toHaveLength(1);
  });

  it('never switches side mid-rep', () => {
    // Left side becomes much less visible halfway through the rep (but stays above 0.6).
    const frames = generateSquat(
      { knee: timeline(START, REP, hold(170, 300)), torsoLean: UPRIGHT },
      {
        nearVisibility: 0.95,
        farVisibility: 0.8, // after the drop: left 0.61 vs right 0.8 → better by 0.19 > 0.1
        drops: [
          {
            fromMs: 1300,
            toMs: 99999,
            landmarks: [LM.LEFT_SHOULDER, LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE],
            visibility: 0.61,
          },
        ],
      },
    );
    const r = run(frames);
    const inRep = r.outputs.filter((o) => o.state === 'IN_REP');
    expect(new Set(inRep.map((o) => o.side))).toEqual(new Set(['left']));
    expect(r.completed).toHaveLength(1);
    expect(r.last.side).toBe('right'); // switched after the rep
  });
});

describe('determinism', () => {
  it('gives identical output for identical input', () => {
    const frames = generateSquat({ knee: timeline(START, repeat(REP, 2)) }, { noisePx: 3, seed: 5 });
    expect(run(frames).outputs).toEqual(run(frames).outputs);
  });

  it('reset() starts over', () => {
    const analyzer = createAnalyzer(testExercise);
    const frames = generateSquat({ knee: timeline(START, REP), torsoLean: UPRIGHT });
    run(frames, analyzer);
    analyzer.reset();
    const again = run(frames, analyzer);
    expect(again.completed.map((c) => c.index)).toEqual([1]);
  });

  it('accepts threshold overrides', () => {
    const analyzer = createAnalyzer(testExercise, { thresholds: { endThreshold: 125 } });
    const r = run(generateSquat({ knee: timeline(START, sweep(170, 120, 2000)), torsoLean: UPRIGHT }), analyzer);
    expect(r.completed).toHaveLength(1);
    expect(analyzer.thresholds.endThreshold).toBe(125);
  });
});

describe('tunable limits', () => {
  it('uses definition defaults and accepts overrides by key', () => {
    expect(createAnalyzer(testExercise).limits).toEqual({ lean: 45 });
    const leaning = generateSquat({ knee: timeline(START, REP, END), torsoLean: 50 });
    expect(run(leaning).completed[0].errors).toEqual(['SQUAT_TORSO_LEAN']);
    // Raising the limit to 55° makes the same 50° lean acceptable.
    const relaxed = createAnalyzer(testExercise, { limits: { lean: 55 } });
    expect(run(leaning, relaxed).completed[0].errors).toEqual([]);
  });
});
