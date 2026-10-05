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
