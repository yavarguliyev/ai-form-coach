// Speaks utterances with the browser's Web Speech API (speechSynthesis). Does nothing — silently —
// where the API is unavailable or while muted.

import type { Utterance } from './voicePolicy';

const MUTE_KEY = 'formcoach.muted';

export function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // storage unavailable — mute just won't persist
  }
}

export function speechAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

export function speak(utterances: readonly Utterance[]): void {
  if (!speechAvailable() || utterances.length === 0) return;
  const synth = window.speechSynthesis;
  if (utterances.some((u) => u.interrupt)) synth.cancel();
  for (const u of utterances) {
    const msg = new SpeechSynthesisUtterance(u.text);
    msg.lang = 'en-US';
    msg.rate = 1.05;
    synth.speak(msg);
  }
}

export function stopSpeaking(): void {
  if (speechAvailable()) window.speechSynthesis.cancel();
}
