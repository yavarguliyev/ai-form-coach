// Decides WHAT to say and WHEN (CLAUDE.md §8.9). Pure and deterministic: time is passed in,
// so it can be unit tested. The speech itself lives in voice.ts.

import { CUE_TEXT, FORM_ERROR_CODES, type ErrorCode, type RepErrorCode } from '../engine/errorCodes';

/** The same cue code is spoken at most once per this many ms (don't nag). */
export const CUE_COOLDOWN_MS = 3000;
/** "Great rep!" at most once every this many counted reps. */
export const PRAISE_EVERY_N_REPS = 3;
export const PRAISE_TEXT = 'Great rep!';

const NUMBER_WORDS = [
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen',
  'Nineteen', 'Twenty',
];

/** "One", "Two", … "Twenty", then digits (speech engines read those fine). */
export function repWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

export type VoiceEvent =
  | { kind: 'cue'; code: ErrorCode; atMs: number }
  | { kind: 'rep'; index: number; errors: readonly RepErrorCode[]; atMs: number };

export interface Utterance {
  text: string;
  /** Interrupt whatever is being said (rep counts are time-critical). */
  interrupt: boolean;
}

export interface VoicePolicy {
  /** Returns what to say for this event (possibly nothing). */
  next(event: VoiceEvent): Utterance[];
  reset(): void;
}

export function createVoicePolicy(): VoicePolicy {
  const lastSpokenAt = new Map<ErrorCode, number>();
  let lastPraiseRep: number | null = null;

  const cueAllowed = (code: ErrorCode, atMs: number) => {
    const last = lastSpokenAt.get(code);
    if (last !== undefined && atMs - last < CUE_COOLDOWN_MS) return false;
    lastSpokenAt.set(code, atMs);
    return true;
  };

  return {
    next(event) {
      if (event.kind === 'cue') {
        return cueAllowed(event.code, event.atMs) ? [{ text: CUE_TEXT[event.code], interrupt: false }] : [];
      }

      // Counted rep: always say the number. Then its mistake (same cooldown as live cues,
      // so a cue already heard mid-rep isn't repeated), or occasional praise for a clean rep.
      const out: Utterance[] = [{ text: repWord(event.index), interrupt: true }];
      const mistake = event.errors.find((e) => FORM_ERROR_CODES.has(e)) ?? event.errors[0];
      if (mistake) {
        if (cueAllowed(mistake, event.atMs)) out.push({ text: CUE_TEXT[mistake], interrupt: false });
      } else if (lastPraiseRep === null || event.index - lastPraiseRep >= PRAISE_EVERY_N_REPS) {
        lastPraiseRep = event.index;
        out.push({ text: PRAISE_TEXT, interrupt: false });
      }
      return out;
    },
    reset() {
      lastSpokenAt.clear();
      lastPraiseRep = null;
    },
  };
}
