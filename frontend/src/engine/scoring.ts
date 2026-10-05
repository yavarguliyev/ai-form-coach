// Rep scoring (CLAUDE.md §8.8). Must match backend/app/aggregates.py for "good" reps.

import { FORM_ERROR_CODES, TOO_FAST_CODES, isRepErrorCode, type RepErrorCode } from './errorCodes';

export const MAX_SCORE = 100;
/** Deducted once per distinct form error (lean, swing, uneven). */
export const FORM_ERROR_PENALTY = 30;
/** Deducted for a rep that was counted but done too fast. */
export const TOO_FAST_PENALTY = 15;
/** A rep is "good" if its score is at least this and it has no form errors. */
export const GOOD_REP_MIN_SCORE = 70;

/**
 * Score for a COUNTED rep: 100 minus penalties, clamped to 0..100. Duplicate codes are
 * penalised once. Partial reps are never counted, so they are never scored — passing a
 * live-only code (e.g. SQUAT_SHALLOW) is a programming error.
 */
export function scoreRep(errors: readonly string[]): number {
  let score = MAX_SCORE;
  for (const code of new Set(errors)) {
    if (!isRepErrorCode(code)) throw new Error(`Cannot score a rep with code ${code}`);
    if (FORM_ERROR_CODES.has(code)) score -= FORM_ERROR_PENALTY;
    else if (TOO_FAST_CODES.has(code)) score -= TOO_FAST_PENALTY;
  }
  return Math.min(MAX_SCORE, Math.max(0, score));
}

export function isGoodRep(score: number, errors: readonly RepErrorCode[]): boolean {
  return score >= GOOD_REP_MIN_SCORE && !errors.some((e) => FORM_ERROR_CODES.has(e));
}
