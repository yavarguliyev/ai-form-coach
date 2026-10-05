import { describe, expect, it } from 'vitest';
import {
  AWAY_FINISH_MS,
  FINISH_WARNING_MS,
  REST_FINISH_MS,
  TARGET_FINISH_DELAY_MS,
  createAutoFinish,
  type AutoFinishInput,
  type AutoFinishStatus,
} from '../autoFinish';

const DT = 1000 / 30;

/** Feeds `ms` of frames with the given input, from time `t`; returns all statuses and the end time. */
function feed(
  af: ReturnType<typeof createAutoFinish>,
  t: number,
  ms: number,
  input: Omit<AutoFinishInput, 'timestampMs'>,
): { statuses: AutoFinishStatus[]; end: number } {
  const statuses: AutoFinishStatus[] = [];
  let now = t;
  for (; now < t + ms; now += DT) statuses.push(af.update({ ...input, timestampMs: now }));
  return { statuses, end: now };
}

const standing = { state: 'TOP' as const, visibilityOk: true, attempts: 3, repCount: 3 };
const inRep = { ...standing, state: 'IN_REP' as const };
const away = { state: 'NOT_VISIBLE' as const, visibilityOk: false, attempts: 3, repCount: 3 };
const finishes = (s: AutoFinishStatus[]) => s.filter((x) => x.phase === 'finish');
const firstIndex = (s: AutoFinishStatus[], phase: string) => s.findIndex((x) => x.phase === phase);

describe('rest: no rep for 10 s ends the set', () => {
  it('warns for the last 3 s, then finishes once', () => {
    const af = createAutoFinish();
    const t = feed(af, 0, 2000, inRep).end; // last rep ends at ~2 s
    const { statuses } = feed(af, t, 12_000, standing);
    const warnAt = firstIndex(statuses, 'warning') * DT;
    const finishAt = firstIndex(statuses, 'finish') * DT;
    expect(warnAt).toBeGreaterThanOrEqual(REST_FINISH_MS - FINISH_WARNING_MS - DT);
    expect(warnAt).toBeLessThanOrEqual(REST_FINISH_MS - FINISH_WARNING_MS + DT);
    expect(finishAt).toBeGreaterThanOrEqual(REST_FINISH_MS - DT);
    expect(finishAt).toBeLessThanOrEqual(REST_FINISH_MS + DT);
    expect(finishes(statuses)).toEqual([{ phase: 'finish', reason: 'rest' }]);
  });

  it('the warning counts down', () => {
    const af = createAutoFinish();
    const { statuses } = feed(af, 0, 9_500, standing);
    const warnings = statuses.flatMap((s) => (s.phase === 'warning' ? [s.remainingMs] : []));
    expect(warnings[0]).toBeLessThanOrEqual(FINISH_WARNING_MS);
    expect(warnings.at(-1)).toBeLessThan(warnings[0]);
  });

  it('starting a rep during the warning cancels it', () => {
    const af = createAutoFinish();
    let t = feed(af, 0, 8_000, standing).end; // in the warning
    t = feed(af, t, 1_500, inRep).end; // user does another rep
    const { statuses } = feed(af, t, 6_000, standing);
    expect(finishes(statuses)).toEqual([]); // timer restarted from the end of that rep
  });

  it('normal pauses between reps (≤ 4 s) never trigger it', () => {
    const af = createAutoFinish();
    let t = 0;
    const all: AutoFinishStatus[] = [];
    for (let i = 0; i < 12; i++) {
      const a = feed(af, t, 1_800, inRep);
      const b = feed(af, a.end, 4_000, standing);
      all.push(...a.statuses, ...b.statuses);
      t = b.end;
    }
    expect(all.some((s) => s.phase !== 'idle')).toBe(false);
  });
});

describe('away: out of view for 5 s ends the set', () => {
  it('finishes after 5 s out of view, with a warning first', () => {
    const af = createAutoFinish();
    const t = feed(af, 0, 1_000, standing).end;
    const { statuses } = feed(af, t, 6_000, away);
    expect(firstIndex(statuses, 'warning') * DT).toBeLessThanOrEqual(AWAY_FINISH_MS - FINISH_WARNING_MS + DT);
    expect(finishes(statuses)).toEqual([{ phase: 'finish', reason: 'away' }]);
  });

  it('coming back into view cancels it and restarts the rest timer', () => {
    const af = createAutoFinish();
    let t = feed(af, 0, 4_000, away).end; // in the away warning
    t = feed(af, t, 100, standing).end; // back
    const { statuses } = feed(af, t, 6_000, standing);
    expect(finishes(statuses)).toEqual([]); // 6 s < 10 s rest
  });
});

describe('safety', () => {
  it('never ends before the first attempt (setup, waiting to start)', () => {
    const af = createAutoFinish();
    const { statuses } = feed(af, 0, 60_000, { ...standing, attempts: 0, repCount: 0 });
    expect(statuses.every((s) => s.phase === 'idle')).toBe(true);
    const gone = feed(af, 0, 60_000, { ...away, attempts: 0, repCount: 0 });
    expect(gone.statuses.every((s) => s.phase === 'idle')).toBe(true);
  });

  it('never ends mid-rep, however long the rep', () => {
    const af = createAutoFinish();
    const { statuses } = feed(af, 0, 30_000, inRep);
    expect(statuses.every((s) => s.phase === 'idle')).toBe(true);
  });

  it('emits finish once, then stays idle', () => {
    const af = createAutoFinish();
    const { statuses } = feed(af, 0, 30_000, standing);
    expect(finishes(statuses)).toHaveLength(1);
  });

  it('reset() starts over', () => {
    const af = createAutoFinish();
    feed(af, 0, 11_000, standing);
    af.reset();
    const { statuses } = feed(af, 20_000, 11_000, standing);
    expect(finishes(statuses)).toHaveLength(1);
  });
});

describe('target reps', () => {
  it('finishes shortly after the target number of COUNTED reps', () => {
    const af = createAutoFinish({ targetReps: 10 });
    expect(feed(af, 0, 5_000, { ...standing, attempts: 12, repCount: 9 }).statuses.every((s) => s.phase === 'idle')).toBe(true);
    const { statuses } = feed(af, 5_000, 2_000, { ...standing, attempts: 13, repCount: 10 });
    expect(finishes(statuses)).toEqual([{ phase: 'finish', reason: 'target' }]);
    expect(firstIndex(statuses, 'finish') * DT).toBeGreaterThanOrEqual(TARGET_FINISH_DELAY_MS - DT);
  });

  it('missed attempts do not count toward the target', () => {
    const af = createAutoFinish({ targetReps: 10 });
    const { statuses } = feed(af, 0, 3_000, { ...standing, attempts: 15, repCount: 8 });
    expect(finishes(statuses)).toEqual([]);
  });

  it('custom timings are respected', () => {
    const af = createAutoFinish({ restMs: 4_000, warningMs: 1_000 });
    const { statuses } = feed(af, 0, 5_000, standing);
    expect(firstIndex(statuses, 'finish') * DT).toBeLessThanOrEqual(4_000 + DT);
  });
});
