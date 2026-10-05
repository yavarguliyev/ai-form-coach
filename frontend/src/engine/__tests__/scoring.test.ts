import { describe, expect, it } from 'vitest';
import {
  CUE_TEXT,
  FORM_ERROR_CODES,
  LIVE_ONLY_CODES,
  REP_ERROR_CODES,
  TOO_FAST_CODES,
  type RepErrorCode,
} from '../errorCodes';
import { GOOD_REP_MIN_SCORE, isGoodRep, scoreRep } from '../scoring';

describe('scoreRep', () => {
  it('gives 100 to a clean rep', () => {
    expect(scoreRep([])).toBe(100);
  });

  it('deducts 30 per form error', () => {
    expect(scoreRep(['SQUAT_TORSO_LEAN'])).toBe(70);
    expect(scoreRep(['CURL_ELBOW_SWING'])).toBe(70);
    expect(scoreRep(['PRESS_UNEVEN'])).toBe(70);
  });

  it('deducts 15 for too fast', () => {
    expect(scoreRep(['SQUAT_TOO_FAST'])).toBe(85);
    expect(scoreRep(['CURL_TOO_FAST'])).toBe(85);
    expect(scoreRep(['PRESS_TOO_FAST'])).toBe(85);
  });

  it('adds penalties for multiple errors', () => {
    expect(scoreRep(['SQUAT_TORSO_LEAN', 'SQUAT_TOO_FAST'])).toBe(55);
  });

  it('penalises a duplicated code only once', () => {
    expect(scoreRep(['PRESS_UNEVEN', 'PRESS_UNEVEN'])).toBe(70);
  });

  it('never goes below 0', () => {
    // Not reachable with real exercises (max 2 codes each), but the clamp must hold.
    const all = [...REP_ERROR_CODES];
    expect(scoreRep(all)).toBe(0); // 100 - 3·30 - 3·15 = -35 → 0
  });

  it('refuses to score live-only codes (partial reps are never counted)', () => {
    for (const code of LIVE_ONLY_CODES) expect(() => scoreRep([code])).toThrow();
    expect(() => scoreRep(['NOT_A_CODE'])).toThrow();
  });
});

describe('isGoodRep', () => {
  const cases: Array<[RepErrorCode[], boolean]> = [
    [[], true],
    [['SQUAT_TOO_FAST'], true], // 85 and only a speed issue
    [['SQUAT_TORSO_LEAN'], false], // 70 but a form error
    [['SQUAT_TORSO_LEAN', 'SQUAT_TOO_FAST'], false],
  ];
  it.each(cases)('errors %j → good = %s', (errors, good) => {
    expect(isGoodRep(scoreRep(errors), errors)).toBe(good);
  });

  it('requires score >= 70', () => {
    expect(GOOD_REP_MIN_SCORE).toBe(70);
    expect(isGoodRep(69, [])).toBe(false);
    expect(isGoodRep(70, [])).toBe(true);
  });
});

describe('error codes', () => {
  it('lists exactly the six storable codes (make check-codes compares with the backend)', () => {
    expect([...REP_ERROR_CODES].sort()).toEqual(
      [
        'CURL_ELBOW_SWING',
        'CURL_TOO_FAST',
        'PRESS_TOO_FAST',
        'PRESS_UNEVEN',
        'SQUAT_TOO_FAST',
        'SQUAT_TORSO_LEAN',
      ].sort(),
    );
  });

  it('classify every stored code as exactly one of form error / too fast', () => {
    for (const code of REP_ERROR_CODES) {
      expect(Number(FORM_ERROR_CODES.has(code)) + Number(TOO_FAST_CODES.has(code))).toBe(1);
    }
  });

  it('have cue text for every code, matching the spec wording', () => {
    for (const code of [...REP_ERROR_CODES, ...LIVE_ONLY_CODES]) expect(CUE_TEXT[code]).toBeTruthy();
    expect(CUE_TEXT.SQUAT_SHALLOW).toBe('Go lower');
    expect(CUE_TEXT.CURL_ELBOW_SWING).toBe('Keep your elbow pinned to your side');
    expect(CUE_TEXT.PRESS_UNEVEN).toBe('Press both arms evenly');
  });
});
