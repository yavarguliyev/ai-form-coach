// Bicep curl tests (CLAUDE.md §8.11), on synthetic side-view landmark sequences.
import { describe, expect, it } from 'vitest';
import { createAnalyzer, type AnalyzerOutput } from '../analyzer';
import {
  CURL_END_ANGLE,
  CURL_LEAVE_TOP_ANGLE,
  CURL_MAX_ELBOW_SWING,
  CURL_NO_EXTENSION_ANGLE,
  CURL_START_ANGLE,
  CURL_TOO_FAST_MS,
  bicepCurl,
} from '../exercises/bicepCurl';
import { LM } from '../landmarks';
import {
  generateCurl,
  hold,
  ramp,
  repeat,
  sweep,
  timeline,
  type CurlParams,
  type SideViewOptions,
} from './helpers/synthetic';

function run(params: CurlParams, opts?: SideViewOptions) {
  const analyzer = createAnalyzer(bicepCurl);
  const outputs: AnalyzerOutput[] = generateCurl(params, opts).map((f) =>
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
const REP = sweep(170, 35, 2000);

describe('bicep curl definition', () => {
  it('uses the spec thresholds', () => {
    expect([CURL_START_ANGLE, CURL_LEAVE_TOP_ANGLE, CURL_END_ANGLE]).toEqual([150, 135, 50]);
    expect([CURL_MAX_ELBOW_SWING, CURL_TOO_FAST_MS, CURL_NO_EXTENSION_ANGLE]).toEqual([25, 800, 140]);
    expect(bicepCurl.thresholds.direction).toBe('decreasing');
  });

  it('requires shoulder, elbow, wrist and hip of the chosen side', () => {
    expect(bicepCurl.requiredLandmarks('right')).toEqual([
      LM.RIGHT_SHOULDER,
      LM.RIGHT_ELBOW,
      LM.RIGHT_WRIST,
      LM.RIGHT_HIP,
    ]);
  });
});

describe('bicep curl (§8.11)', () => {
  it('5 clean curls → count = 5, no errors', () => {
    const r = run({ elbow: timeline(START, repeat(REP, 5), END) });
    expect(r.completed).toHaveLength(5);
    expect(r.completed.every((c) => c.errors.length === 0 && c.score === 100)).toBe(true);
    expect(r.cues).toEqual([]);
    // EMA smoothing trims the sharp turnaround slightly (35.7° here). It can only make the
    // reported depth more conservative, never deeper than the true 35°.
    for (const c of r.completed) {
      expect(c.minAngle).toBeGreaterThanOrEqual(35);
      expect(c.minAngle).toBeLessThan(37);
    }
  });

  it('curls that stop at 80° → count = 0, CURL_PARTIAL reported', () => {
    const r = run({ elbow: timeline(START, repeat(sweep(170, 80, 2000), 3), END) });
    expect(r.completed).toHaveLength(0);
    expect(r.rejected.every((x) => x.reason === 'partial' && x.cue === 'CURL_PARTIAL')).toBe(true);
    expect(r.rejected).toHaveLength(3);
  });

  it('elbow swinging 35° → counted with CURL_ELBOW_SWING', () => {
    const r = run({
      elbow: timeline(START, REP, END),
      // swing grows as the arm curls: up to 35° at the top of the curl
      upperArmSwing: (_t, elbow) => 5 + (30 * (170 - elbow)) / 135,
    });
    expect(r.completed).toHaveLength(1);
    expect(r.completed[0].errors).toEqual(['CURL_ELBOW_SWING']);
    expect(r.completed[0].score).toBe(70);
    expect(r.completed[0].metrics.max_upperArmSwing).toBeCloseTo(35, 0);
    expect(r.cues).toContain('CURL_ELBOW_SWING');
  });

  it('elbow swinging 15° is fine', () => {
    const r = run({ elbow: timeline(START, REP, END), upperArmSwing: 15 });
    expect(r.completed[0].errors).toEqual([]);
  });

  it('a fast but valid curl (~700 ms) is counted with CURL_TOO_FAST', () => {
    const r = run({ elbow: timeline(START, sweep(170, 35, 1000), END) });
    expect(r.completed).toHaveLength(1);
    expect(r.completed[0].durationMs).toBeLessThan(CURL_TOO_FAST_MS);
    expect(r.completed[0].durationMs).toBeGreaterThanOrEqual(600);
    expect(r.completed[0].errors).toEqual(['CURL_TOO_FAST']);
    expect(r.completed[0].score).toBe(85);
  });

  it('a curl under 600 ms is rejected', () => {
    const r = run({ elbow: timeline(START, sweep(170, 35, 700), END) });
    expect(r.completed).toHaveLength(0);
    expect(r.rejected[0].reason).toBe('too_short');
  });

  it('re-curling from 120° without extending → CURL_NO_EXTENSION cue, not counted', () => {
    const r = run({
      elbow: timeline(
        START,
        ramp(170, 40, 900), // first curl up
        ramp(40, 120, 700), // lower only to 120°
        ramp(120, 40, 700), // curl again
        ramp(40, 125, 700), // lower only to 125°
        ramp(125, 40, 700), // curl again
        hold(40, 300),
      ),
    });
    expect(r.completed).toHaveLength(0);
    expect(r.cues.filter((c) => c === 'CURL_NO_EXTENSION')).toHaveLength(2);
  });

  it('…and the rep counts once the arm is finally extended', () => {
    const r = run({
      elbow: timeline(START, ramp(170, 40, 900), ramp(40, 120, 700), ramp(120, 40, 700), ramp(40, 170, 900), END),
    });
    expect(r.cues).toContain('CURL_NO_EXTENSION');
    expect(r.completed).toHaveLength(1);
  });

  it('lowering to 145° before re-curling is not flagged (only below 140°)', () => {
    const r = run({
      elbow: timeline(START, ramp(170, 40, 900), ramp(40, 145, 800), ramp(145, 40, 800), ramp(40, 170, 900), END),
    });
    expect(r.cues).not.toContain('CURL_NO_EXTENSION');
  });

  it('jitter: elbow oscillating ±8° around 150 for 3 s → count = 0', () => {
    const r = run(
      { elbow: { durationMs: 3700, at: (t) => (t < 700 ? 170 : 150 + (Math.floor(t / (1000 / 30)) % 2 ? 8 : -8)) } },
      { noisePx: 1, seed: 2 },
    );
    expect(r.completed).toHaveLength(0);
    expect(r.cues).toEqual([]);
  });

  it('wrist lost mid-curl → partial rep discarded, NOT_VISIBLE, no count', () => {
    const r = run(
      { elbow: timeline(START, REP, END) },
      { drops: [{ fromMs: 1400, toMs: 2200, landmarks: [LM.LEFT_WRIST, LM.RIGHT_WRIST], visibility: 0.05 }] },
    );
    expect(r.outputs[Math.floor((1400 * 30) / 1000) - 1].state).toBe('IN_REP');
    expect(r.outputs.map((o) => o.state)).toContain('NOT_VISIBLE');
    expect(r.completed).toHaveLength(0);
    expect(r.rejected[0].reason).toBe('lost_tracking');
    expect(r.outputs.some((o) => o.visibilityMessage === "Keep your arms in view — I can't see your wrists")).toBe(
      true,
    );
  });

  it.each([
    ['left', 'right'],
    ['right', 'left'],
  ] as const)('works with the %s arm near the camera, facing %s', (nearSide, facing) => {
    const r = run({ elbow: timeline(START, repeat(REP, 3), END) }, { nearSide, facing, noisePx: 1.5, seed: 6 });
    expect(r.last.side).toBe(nearSide);
    expect(r.completed).toHaveLength(3);
    expect(r.completed.every((c) => c.errors.length === 0)).toBe(true);
  });
});
