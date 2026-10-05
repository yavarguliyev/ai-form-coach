import { describe, expect, it } from 'vitest';
import { CUE_COOLDOWN_MS, PRAISE_TEXT, createVoicePolicy, missText, repWord } from '../voicePolicy';

const texts = (u: { text: string }[]) => u.map((x) => x.text);

describe('repWord', () => {
  it('spells 1..20 and uses digits after', () => {
    expect([repWord(1), repWord(2), repWord(10), repWord(20)]).toEqual(['One', 'Two', 'Ten', 'Twenty']);
    expect(repWord(21)).toBe('21');
  });
});

describe('cue cooldown', () => {
  it('speaks a cue, then not again within 3 s, then again after', () => {
    const p = createVoicePolicy();
    expect(texts(p.next({ kind: 'cue', code: 'SQUAT_TORSO_LEAN', atMs: 0 }))).toEqual(['Keep your chest up']);
    expect(p.next({ kind: 'cue', code: 'SQUAT_TORSO_LEAN', atMs: 100 })).toEqual([]);
    expect(p.next({ kind: 'cue', code: 'SQUAT_TORSO_LEAN', atMs: CUE_COOLDOWN_MS - 1 })).toEqual([]);
    expect(texts(p.next({ kind: 'cue', code: 'SQUAT_TORSO_LEAN', atMs: CUE_COOLDOWN_MS }))).toEqual([
      'Keep your chest up',
    ]);
  });

  it('keeps a separate cooldown per cue code', () => {
    const p = createVoicePolicy();
    p.next({ kind: 'cue', code: 'SQUAT_TORSO_LEAN', atMs: 0 });
    expect(texts(p.next({ kind: 'cue', code: 'SQUAT_SHALLOW', atMs: 50 }))).toEqual(['Go lower']);
  });

  it('a live cue every frame for 2 s is spoken once', () => {
    const p = createVoicePolicy();
    let spoken = 0;
    for (let t = 0; t < 2000; t += 33) spoken += p.next({ kind: 'cue', code: 'PRESS_UNEVEN', atMs: t }).length;
    expect(spoken).toBe(1);
  });
});

describe('counted reps', () => {
  it('always says the rep number, queued (never cutting off a cue)', () => {
    const p = createVoicePolicy();
    const [first] = p.next({ kind: 'rep', index: 1, errors: [], atMs: 0 });
    expect(first).toEqual({ text: 'One' });
  });

  it('praises a clean rep at most once every 3 reps', () => {
    const p = createVoicePolicy();
    const said = [1, 2, 3, 4, 5, 6, 7].map((i) => texts(p.next({ kind: 'rep', index: i, errors: [], atMs: i * 2000 })));
    expect(said.map((s) => s.includes(PRAISE_TEXT))).toEqual([true, false, false, true, false, false, true]);
  });

  it('says the mistake instead of praise, skipping it if the live cue was just heard', () => {
    const p = createVoicePolicy();
    p.next({ kind: 'cue', code: 'SQUAT_TORSO_LEAN', atMs: 1000 }); // heard mid-rep
    expect(texts(p.next({ kind: 'rep', index: 1, errors: ['SQUAT_TORSO_LEAN'], atMs: 2000 }))).toEqual(['One']);
    expect(texts(p.next({ kind: 'rep', index: 2, errors: ['SQUAT_TORSO_LEAN'], atMs: 6000 }))).toEqual([
      'Two',
      'Keep your chest up',
    ]);
  });

  it('prefers the form error over "too fast" when a rep has both', () => {
    const p = createVoicePolicy();
    expect(texts(p.next({ kind: 'rep', index: 1, errors: ['SQUAT_TOO_FAST', 'SQUAT_TORSO_LEAN'], atMs: 0 }))).toEqual([
      'One',
      'Keep your chest up',
    ]);
  });

  it('reset() clears cooldowns and the praise counter', () => {
    const p = createVoicePolicy();
    p.next({ kind: 'rep', index: 1, errors: [], atMs: 0 });
    p.next({ kind: 'cue', code: 'CURL_ELBOW_SWING', atMs: 0 });
    p.reset();
    expect(texts(p.next({ kind: 'rep', index: 1, errors: [], atMs: 10 }))).toContain(PRAISE_TEXT);
    expect(p.next({ kind: 'cue', code: 'CURL_ELBOW_SWING', atMs: 10 })).toHaveLength(1);
  });
});

describe('missed attempts', () => {
  it('always says why an attempt did not count', () => {
    const p = createVoicePolicy();
    expect(texts(p.next({ kind: 'miss', reason: 'partial', code: 'SQUAT_SHALLOW', atMs: 0 }))).toEqual([
      'Not counted. Go lower.',
    ]);
    // the next miss 2 s later is spoken too — misses have no cooldown
    expect(texts(p.next({ kind: 'miss', reason: 'partial', code: 'SQUAT_SHALLOW', atMs: 2000 }))).toEqual([
      'Not counted. Go lower.',
    ]);
    expect(texts(p.next({ kind: 'miss', reason: 'too_short', code: 'SQUAT_TOO_FAST', atMs: 4000 }))).toEqual([
      'Not counted. Too fast.',
    ]);
  });

  it('does not repeat the same cue as a live cue right after the miss', () => {
    const p = createVoicePolicy();
    p.next({ kind: 'miss', reason: 'partial', code: 'CURL_PARTIAL', atMs: 0 });
    expect(p.next({ kind: 'cue', code: 'CURL_PARTIAL', atMs: 50 })).toEqual([]);
  });

  it('has a sentence for every reason', () => {
    expect(missText('too_long', null)).toBe('Not counted. That took too long.');
    expect(missText('lost_tracking', null)).toBe('I lost sight of you.');
    expect(missText('partial', 'PRESS_PARTIAL')).toBe('Not counted. Press all the way up.');
  });
});
