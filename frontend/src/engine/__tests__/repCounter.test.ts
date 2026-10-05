import { describe, expect, it } from 'vitest';
import {
  MAX_REP_MS,
  MIN_REP_MS,
  START_HOLD_MS,
  createRepCounter,
  validateThresholds,
  type RepCounter,
  type RepCounterConfig,
  type RepFrameOutput,
} from '../repCounter';

const FPS = 30;
const DT = 1000 / FPS;

// Squat-like: angle goes DOWN during the rep.
const SQUAT: RepCounterConfig = {
  direction: 'decreasing',
  startThreshold: 160,
  leaveTopThreshold: 145,
  endThreshold: 100,
};
// Press-like: angle goes UP during the rep.
const PRESS: RepCounterConfig = {
  direction: 'increasing',
  startThreshold: 100,
  leaveTopThreshold: 115,
  endThreshold: 155,
};

interface Sample {
  angle: number;
  valid?: boolean;
  trackingLost?: boolean;
  endConditionOk?: boolean;
}

/** Feeds samples at 30 fps; returns all outputs. Keeps its own clock across calls. */
function driver(counter: RepCounter) {
  let t = 0;
  const outputs: RepFrameOutput[] = [];
  return {
    feed(samples: Sample[]) {
      for (const s of samples) {
        outputs.push(
          counter.update({
            angle: s.angle,
            valid: s.valid ?? true,
            trackingLost: s.trackingLost ?? false,
            endConditionOk: s.endConditionOk,
            timestampMs: t,
          }),
        );
        t += DT;
      }
      return this;
    },
    outputs,
    get completed() {
      return outputs.flatMap((o) => (o.completed ? [o.completed] : []));
    },
    get rejected() {
      return outputs.flatMap((o) => (o.rejected ? [o.rejected] : []));
    },
    get last() {
      return outputs[outputs.length - 1];
    },
  };
}

/** Constant angle for `ms`. */
const hold = (angle: number, ms: number): Sample[] =>
  Array.from({ length: Math.round(ms / DT) }, () => ({ angle }));

/** Smooth cosine sweep from `from` to `to` and back over `ms`. */
const sweep = (from: number, to: number, ms: number): Sample[] => {
  const n = Math.round(ms / DT);
  return Array.from({ length: n }, (_, i) => {
    const phase = (i / n) * 2 * Math.PI;
    return { angle: from + ((to - from) * (1 - Math.cos(phase))) / 2 };
  });
};

/** Counter already in TOP (start position held). */
function readySquat(config: RepCounterConfig = SQUAT) {
  const d = driver(createRepCounter(config));
  d.feed(hold(config.direction === 'decreasing' ? 170 : 90, START_HOLD_MS + 100));
  expect(d.last.state).toBe('TOP');
  return d;
}

describe('validateThresholds', () => {
  it('accepts correctly ordered thresholds for both directions', () => {
    expect(() => validateThresholds(SQUAT)).not.toThrow();
    expect(() => validateThresholds(PRESS)).not.toThrow();
  });

  it('rejects thresholds out of order', () => {
    expect(() => validateThresholds({ ...SQUAT, leaveTopThreshold: 165 })).toThrow(RangeError);
    expect(() => validateThresholds({ ...SQUAT, endThreshold: 150 })).toThrow(RangeError);
    expect(() => validateThresholds({ ...PRESS, direction: 'decreasing' })).toThrow(RangeError);
  });
});

describe('start position (READY → TOP)', () => {
  it('starts NOT_VISIBLE, becomes READY, and TOP only after holding 500 ms', () => {
    const d = driver(createRepCounter(SQUAT));
    expect(d.feed([{ angle: 170, valid: false }]).last.state).toBe('NOT_VISIBLE');
    d.feed(hold(170, 400));
    expect(d.last.state).toBe('READY');
    d.feed(hold(170, 200));
    expect(d.last.state).toBe('TOP');
  });

  it('restarts the hold timer if the user leaves the start position', () => {
    const d = driver(createRepCounter(SQUAT));
    d.feed(hold(170, 400)).feed(hold(150, 100)).feed(hold(170, 400));
    expect(d.last.state).toBe('READY');
  });

  it('does not count a full rep done before the start position was held', () => {
    const d = driver(createRepCounter(SQUAT));
    d.feed(hold(170, 200)).feed(sweep(170, 85, 2000));
    expect(d.completed).toHaveLength(0);
  });
});

describe('counting (decreasing direction, squat-like)', () => {
  it('counts 5 clean reps 170 → 85 → 170', () => {
    const d = readySquat();
    for (let i = 0; i < 5; i++) d.feed(sweep(170, 85, 2000));
    expect(d.completed).toHaveLength(5);
    expect(d.rejected).toHaveLength(0);
    expect(d.last.repCount).toBe(5);
    for (const rep of d.completed) {
      expect(rep.minAngle).toBeCloseTo(85, 0);
      // max includes the frame that crossed back past 160 and completed the rep
      expect(rep.maxAngle).toBeGreaterThanOrEqual(160);
      expect(rep.maxAngle).toBeLessThan(170);
      // From crossing 145 on the way down to crossing 160 on the way up.
      expect(rep.durationMs).toBeGreaterThan(1300);
      expect(rep.durationMs).toBeLessThan(2000);
    }
  });

  it('emits started=true exactly once per rep', () => {
    const d = readySquat();
    d.feed(sweep(170, 85, 2000)).feed(sweep(170, 85, 2000));
    expect(d.outputs.filter((o) => o.started)).toHaveLength(2);
  });

  it('reports live progress while in a rep', () => {
    const d = readySquat();
    d.feed(sweep(170, 85, 2000).slice(0, 30)); // halfway down: 1 s into a 2 s rep
    expect(d.last.state).toBe('IN_REP');
    expect(d.last.current?.endReached).toBe(true);
    expect(d.last.current?.minAngle).toBeLessThan(100);
  });
});

describe('partial reps', () => {
  it('rejects a rep that only reaches 120° with a cue', () => {
    const d = readySquat();
    for (let i = 0; i < 3; i++) d.feed(sweep(170, 120, 2000));
    expect(d.completed).toHaveLength(0);
    expect(d.rejected).toHaveLength(3);
    for (const r of d.rejected) {
      expect(r.reason).toBe('partial');
      expect(r.travel).toBeCloseTo(40, 0); // 160 → 120
      expect(r.cue).toBe(true);
    }
  });

  it('rejects a small dip past leave-top silently (no nagging)', () => {
    const d = readySquat();
    d.feed(sweep(170, 140, 2000));
    expect(d.rejected).toEqual([expect.objectContaining({ reason: 'partial', cue: false })]);
  });

  it('counts 100° exactly (end threshold is inclusive)', () => {
    const d = readySquat();
    d.feed(hold(170, 100)).feed(sweep(170, 100, 2000));
    expect(d.completed).toHaveLength(1);
  });
});

describe('jitter and timing', () => {
  it('counts nothing for an angle oscillating ±8° around 160 for 3 s', () => {
    const d = readySquat();
    const jitter = Array.from({ length: 90 }, (_, i) => ({ angle: 160 + (i % 2 ? 8 : -8) }));
    d.feed(jitter);
    expect(d.completed).toHaveLength(0);
    expect(d.rejected.filter((r) => r.cue)).toHaveLength(0);
  });

  it('counts nothing for slow ±8° drift around 160 either', () => {
    const d = readySquat();
    d.feed(Array.from({ length: 90 }, (_, i) => ({ angle: 160 + 8 * Math.sin(i / 5) })));
    expect(d.completed).toHaveLength(0);
  });

  it(`rejects a full-depth rep faster than ${MIN_REP_MS} ms as too short`, () => {
    const d = readySquat();
    d.feed(sweep(170, 85, 500));
    expect(d.completed).toHaveLength(0);
    expect(d.rejected).toEqual([expect.objectContaining({ reason: 'too_short' })]);
    expect(d.last.state).toBe('TOP');
  });

  it(`discards a rep longer than ${MAX_REP_MS} ms and requires the start hold again`, () => {
    const d = readySquat();
    d.feed(hold(140, 300)).feed(hold(90, MAX_REP_MS)); // 140 < 145 → the rep has started
    expect(d.rejected).toEqual([expect.objectContaining({ reason: 'too_long' })]);
    expect(d.last.state).toBe('READY');
    // Standing back up must not count as a rep.
    d.feed(hold(170, 1000));
    expect(d.completed).toHaveLength(0);
    expect(d.last.state).toBe('TOP');
  });
});

describe('invalid frames and tracking loss', () => {
  it('ignores brief invalid frames mid-rep and still counts the rep', () => {
    const d = readySquat();
    const rep = sweep(170, 85, 2000);
    // 6 invalid frames (200 ms) carrying garbage angles in the middle of the rep
    for (let i = 20; i < 26; i++) rep[i] = { angle: 10, valid: false };
    d.feed(rep);
    expect(d.completed).toHaveLength(1);
    expect(d.completed[0].minAngle).toBeGreaterThan(80); // the 10° garbage never counted
  });

  it('treats a NaN angle as an invalid frame', () => {
    const d = readySquat();
    const rep = sweep(170, 85, 2000);
    rep[10] = { angle: Number.NaN };
    d.feed(rep);
    expect(d.completed).toHaveLength(1);
    expect(Number.isNaN(d.completed[0].minAngle)).toBe(false);
  });

  it('discards the partial rep when tracking is lost, goes NOT_VISIBLE, counts nothing', () => {
    const d = readySquat();
    d.feed(sweep(170, 85, 2000).slice(0, 25));
    expect(d.last.state).toBe('IN_REP');
    d.feed([{ angle: 0, valid: false, trackingLost: true }]);
    expect(d.last.state).toBe('NOT_VISIBLE');
    expect(d.rejected).toEqual([expect.objectContaining({ reason: 'lost_tracking' })]);
    // Coming back mid-movement and standing up must not complete anything.
    d.feed(sweep(170, 85, 2000).slice(25));
    expect(d.completed).toHaveLength(0);
    expect(d.last.repCount).toBe(0);
  });

  it('needs the start hold again after tracking is lost', () => {
    const d = readySquat();
    d.feed([{ angle: 170, valid: false, trackingLost: true }]);
    d.feed(hold(170, 300));
    expect(d.last.state).toBe('READY');
    d.feed(hold(170, 300));
    expect(d.last.state).toBe('TOP');
  });
});

describe('increasing direction (press-like)', () => {
  it('counts reps 90 → 165 → 90', () => {
    const d = readySquat(PRESS);
    for (let i = 0; i < 4; i++) d.feed(sweep(90, 165, 2000));
    expect(d.completed).toHaveLength(4);
    expect(d.completed[0].maxAngle).toBeCloseTo(165, 0);
  });

  it('rejects a press that stops at 140° as partial with a cue', () => {
    const d = readySquat(PRESS);
    d.feed(sweep(90, 140, 2000));
    expect(d.rejected).toEqual([expect.objectContaining({ reason: 'partial', cue: true })]);
    expect(d.rejected[0].travel).toBeCloseTo(40, 0);
  });

  it('does not count the end unless the extra end condition holds', () => {
    const d = readySquat(PRESS);
    d.feed(sweep(90, 165, 2000).map((s) => ({ ...s, endConditionOk: false })));
    expect(d.completed).toHaveLength(0);
    expect(d.rejected).toEqual([expect.objectContaining({ reason: 'partial' })]);
  });

  it('counts when the end condition holds at the top', () => {
    const d = readySquat(PRESS);
    d.feed(sweep(90, 165, 2000).map((s) => ({ ...s, endConditionOk: s.angle > 150 })));
    expect(d.completed).toHaveLength(1);
  });
});

describe('reversal before returning to start (curl "no extension")', () => {
  const CURL: RepCounterConfig = {
    direction: 'decreasing',
    startThreshold: 150,
    leaveTopThreshold: 135,
    endThreshold: 50,
  };

  it('reports the peak when the user re-curls from 130° without extending', () => {
    const d = readySquat({ ...CURL });
    // curl up to 40°, lower only to 130°, curl again to 40°, then extend fully
    const down = (from: number, to: number, ms: number): Sample[] => {
      const n = Math.round(ms / DT);
      return Array.from({ length: n }, (_, i) => ({ angle: from + ((to - from) * i) / (n - 1) }));
    };
    d.feed(down(170, 40, 800)).feed(down(40, 130, 600)).feed(down(130, 40, 600));
    const reversals = d.outputs.flatMap((o) => (o.reversal ? [o.reversal] : []));
    expect(reversals).toHaveLength(1);
    expect(reversals[0].peakAngle).toBeCloseTo(130, 0);
    d.feed(down(40, 170, 800));
    expect(d.completed).toHaveLength(1);
  });

  it('reports again after the end is reached a second time', () => {
    const d = readySquat({ ...CURL });
    const line = (from: number, to: number, ms: number): Sample[] => {
      const n = Math.round(ms / DT);
      return Array.from({ length: n }, (_, i) => ({ angle: from + ((to - from) * i) / (n - 1) }));
    };
    d.feed(line(170, 40, 800))
      .feed(line(40, 130, 600))
      .feed(line(130, 40, 600))
      .feed(line(40, 125, 600))
      .feed(line(125, 40, 600));
    const peaks = d.outputs.flatMap((o) => (o.reversal ? [o.reversal.peakAngle] : []));
    expect(peaks.map(Math.round)).toEqual([130, 125]);
  });

  it('does not report a reversal for a normal rep', () => {
    const d = readySquat({ ...CURL });
    d.feed(sweep(170, 40, 2000));
    expect(d.outputs.some((o) => o.reversal)).toBe(false);
    expect(d.completed).toHaveLength(1);
  });
});

describe('reset', () => {
  it('returns to NOT_VISIBLE with count 0', () => {
    const counter = createRepCounter(SQUAT);
    const d = driver(counter);
    d.feed(hold(170, 600)).feed(sweep(170, 85, 2000));
    expect(counter.repCount).toBe(1);
    counter.reset();
    expect(counter.state).toBe('NOT_VISIBLE');
    expect(counter.repCount).toBe(0);
  });
});
