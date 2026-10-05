// Error / cue codes (CLAUDE.md §8.7, §8.8). Keep REP_ERROR_CODES in sync with
// backend/app/error_codes.py — the API rejects any other code on a stored rep.

/** Codes that can appear on a COUNTED rep (stored in the DB). */
export const REP_ERROR_CODES = [
  'SQUAT_TORSO_LEAN',
  'SQUAT_TOO_FAST',
  'CURL_ELBOW_SWING',
  'CURL_TOO_FAST',
  'PRESS_UNEVEN',
  'PRESS_TOO_FAST',
] as const;

/**
 * "End position not reached": stored on MISSED attempts (not counted), never on counted reps.
 * Keep in sync with MissErrorCode in backend/app/error_codes.py.
 */
export const MISS_ERROR_CODES = ['SQUAT_SHALLOW', 'CURL_PARTIAL', 'PRESS_PARTIAL'] as const;

/** Live cue only: never stored. */
export const LIVE_ONLY_CODES = ['CURL_NO_EXTENSION'] as const;

export type RepErrorCode = (typeof REP_ERROR_CODES)[number];
export type MissErrorCode = (typeof MISS_ERROR_CODES)[number];
export type LiveOnlyCode = (typeof LIVE_ONLY_CODES)[number];
export type ErrorCode = RepErrorCode | MissErrorCode | LiveOnlyCode;

/** Why an attempt was not counted. Keep in sync with MissReason in the backend. */
export type MissReason = 'partial' | 'too_short' | 'too_long' | 'lost_tracking';

/** Form errors make a rep "not good" regardless of score. */
export const FORM_ERROR_CODES: ReadonlySet<RepErrorCode> = new Set([
  'SQUAT_TORSO_LEAN',
  'CURL_ELBOW_SWING',
  'PRESS_UNEVEN',
]);

export const TOO_FAST_CODES: ReadonlySet<RepErrorCode> = new Set([
  'SQUAT_TOO_FAST',
  'CURL_TOO_FAST',
  'PRESS_TOO_FAST',
]);

/** What the user sees and hears for each code. */
export const CUE_TEXT: Record<ErrorCode, string> = {
  SQUAT_SHALLOW: 'Go lower',
  SQUAT_TORSO_LEAN: 'Keep your chest up',
  SQUAT_TOO_FAST: 'Slow down',
  CURL_PARTIAL: 'Curl all the way up',
  CURL_ELBOW_SWING: 'Keep your elbow pinned to your side',
  CURL_NO_EXTENSION: 'Fully extend your arm',
  CURL_TOO_FAST: 'Slow down',
  PRESS_PARTIAL: 'Press all the way up',
  PRESS_UNEVEN: 'Press both arms evenly',
  PRESS_TOO_FAST: 'Slow down',
};

export function isRepErrorCode(code: string): code is RepErrorCode {
  return (REP_ERROR_CODES as readonly string[]).includes(code);
}

export function isMissErrorCode(code: string): code is MissErrorCode {
  return (MISS_ERROR_CODES as readonly string[]).includes(code);
}
