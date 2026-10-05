// DEV ONLY: replays synthetic landmark sequences through the real pipeline, so the workout
// flow can be tested end to end without a person in front of the camera. Loaded with a
// dynamic import behind import.meta.env.DEV, so it never ships in a production build.

import {
  generateCurl,
  generatePress,
  generateSquat,
  hold,
  repeat,
  sweep,
  timeline,
  type SyntheticFrame,
} from '../engine/__tests__/helpers/synthetic';

const STAND = hold(170, 2500); // setup checks + countdown happen while standing still
const S_REP = sweep(170, 85, 2000);

export const SCENARIOS: Record<string, () => SyntheticFrame[]> = {
  // 5 clean squats
  'squat-clean': () => generateSquat({ knee: timeline(STAND, hold(170, 3500), repeat(S_REP, 5), hold(170, 3000)), torsoLean: 10 }, { noisePx: 1 }),
  // clean, shallow, leaning, fast, clean
  'squat-mixed': () =>
    generateSquat(
      {
        knee: timeline(STAND, hold(170, 3500), S_REP, sweep(170, 120, 2000), S_REP, sweep(170, 85, 1100), hold(170, 600), S_REP, hold(170, 3000)),
        torsoLean: (t, knee) => (t > 10000 && t < 12000 && knee < 140 ? 60 : 10),
      },
      { noisePx: 1 },
    ),
  // the user's example: 3 clean squats, then 9 half squats (to ~125°)
  'squat-misses': () =>
    generateSquat({ knee: timeline(STAND, hold(170, 3500), repeat(S_REP, 3), repeat(sweep(170, 125, 2000), 9), hold(170, 4000)), torsoLean: 10 }, { noisePx: 1 }),
  // auto-finish: 4 squats then stand still (rest timer)
  'squat-then-rest': () =>
    generateSquat({ knee: timeline(STAND, hold(170, 3500), repeat(S_REP, 4), hold(170, 30000)), torsoLean: 10 }, { noisePx: 1 }),
  // auto-finish: 3 squats then walk out of the frame
  'squat-then-leave': () =>
    generateSquat(
      { knee: timeline(STAND, hold(170, 3500), repeat(S_REP, 3), hold(170, 30000)), torsoLean: 10 },
      { noisePx: 1, drops: [{ fromMs: 6000 + 3 * 2000 + 600, toMs: 99999, noPerson: true }] },
    ),
  // auto-finish cancel: 2 squats, an 8.5 s pause (warning shows), 2 more squats, then rest
  'squat-pause-resume': () =>
    generateSquat({ knee: timeline(STAND, hold(170, 3500), repeat(S_REP, 2), hold(170, 8500), repeat(S_REP, 2), hold(170, 30000)), torsoLean: 10 }, { noisePx: 1 }),
  // endless clean squats (for long-running persistence tests)
  'squat-loop': () => generateSquat({ knee: timeline(STAND, hold(170, 3500), repeat(S_REP, 60)), torsoLean: 10 }, { noisePx: 1 }),
  'curl-clean': () => generateCurl({ elbow: timeline(STAND, hold(170, 3500), repeat(sweep(170, 35, 2000), 5), hold(170, 3000)) }, { noisePx: 1 }),
  'press-clean': () => generatePress({ leftElbow: timeline(hold(90, 6000), repeat(sweep(90, 168, 2000), 5), hold(90, 3000)) }, { noisePx: 1 }),
};

export interface ReplayHandle {
  stop(): void;
}

/** Feeds frames at their own frame rate with fresh performance.now() timestamps. Loops at the end. */
export function startReplay(
  scenario: string,
  onFrame: (frame: SyntheticFrame) => void,
): ReplayHandle | null {
  const make = SCENARIOS[scenario];
  if (!make) return null;
  const frames = make();
  let i = 0;
  const interval = frames.length > 1 ? frames[1].timestampMs - frames[0].timestampMs : 1000 / 30;
  const id = setInterval(() => {
    const f = frames[i % frames.length];
    i += 1;
    onFrame({ ...f, timestampMs: performance.now() });
  }, interval);
  return { stop: () => clearInterval(id) };
}
