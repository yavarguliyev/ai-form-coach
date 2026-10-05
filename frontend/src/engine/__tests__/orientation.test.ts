import { describe, expect, it } from 'vitest';
import { createAnalyzer, type AnalyzerOutput } from '../analyzer';
import { bicepCurl } from '../exercises/bicepCurl';
import { shoulderPress } from '../exercises/shoulderPress';
import { squat } from '../exercises/squat';
import type { ExerciseDefinition } from '../exercises/types';
import { toPixelLandmarks } from '../geometry';
import { LM } from '../landmarks';
import { checkOrientation } from '../orientation';
import {
  generateCurl,
  generatePress,
  generateSquat,
  hold,
  sweep,
  timeline,
  type SyntheticFrame,
} from './helpers/synthetic';

/** Spread the shoulders apart horizontally by `px` pixels (person turned toward the camera). */
const turnToCamera = (frames: SyntheticFrame[], px = 140) =>
  frames.map((f) => {
    const lms = f.landmarks!.map((l) => ({ ...l }));
    lms[LM.LEFT_SHOULDER].x += px / 2 / f.videoWidth;
    lms[LM.RIGHT_SHOULDER].x -= px / 2 / f.videoWidth;
    return { ...f, landmarks: lms };
  });

/** Put both shoulders on top of each other (person turned sideways). */
const turnSideways = (frames: SyntheticFrame[]) =>
  frames.map((f) => {
    const lms = f.landmarks!.map((l) => ({ ...l }));
    const x = (lms[LM.LEFT_SHOULDER].x + lms[LM.RIGHT_SHOULDER].x) / 2;
    lms[LM.LEFT_SHOULDER].x = x + 0.003;
    lms[LM.RIGHT_SHOULDER].x = x - 0.003;
    return { ...f, landmarks: lms };
  });

function run(def: ExerciseDefinition, frames: SyntheticFrame[]) {
  const a = createAnalyzer(def);
  const outputs: AnalyzerOutput[] = frames.map((f) =>
    a.processFrame(f.landmarks, f.videoWidth, f.videoHeight, f.timestampMs),
  );
  return { outputs, last: outputs[outputs.length - 1], completed: outputs.filter((o) => o.completedRep) };
}

const px = (f: SyntheticFrame) => toPixelLandmarks(f.landmarks!, f.videoWidth, f.videoHeight);

describe('checkOrientation', () => {
  it('accepts a side-view pose for side exercises and a frontal pose for the press', () => {
    expect(checkOrientation(px(generateSquat({ knee: timeline(hold(170, 100)) })[0]), 'side').ok).toBe(true);
    expect(checkOrientation(px(generateCurl({ elbow: timeline(hold(170, 100)) })[0]), 'side').ok).toBe(true);
    expect(checkOrientation(px(generatePress({ leftElbow: timeline(hold(90, 100)) })[0]), 'front').ok).toBe(true);
  });

  it('asks to turn sideways when shoulders are wide in a side-view exercise', () => {
    const f = turnToCamera(generateSquat({ knee: timeline(hold(170, 100)) }))[0];
    expect(checkOrientation(px(f), 'side')).toMatchObject({ ok: false, hint: 'Turn sideways to the camera' });
  });

  it('asks to face the camera when shoulders overlap in a front-view exercise', () => {
    const f = turnSideways(generatePress({ leftElbow: timeline(hold(90, 100)) }))[0];
    expect(checkOrientation(px(f), 'front')).toMatchObject({ ok: false, hint: 'Face the camera' });
  });

  it('does not block when the landmarks needed to judge are barely visible', () => {
    const f = turnToCamera(generateSquat({ knee: timeline(hold(170, 100)) }))[0];
    const lms = px(f).map((l, i) => (i === LM.LEFT_HIP || i === LM.RIGHT_HIP ? { ...l, visibility: 0.1 } : l));
    expect(checkOrientation(lms, 'side')).toEqual({ ok: true, ratio: null, hint: null });
  });
});

describe('start-position hints in the analyzer', () => {
  it('squat facing the camera: never starts, says "Turn sideways to the camera"', () => {
    const r = run(squat, turnToCamera(generateSquat({ knee: timeline(hold(170, 1000), sweep(170, 85, 2000), hold(170, 300)) })));
    expect(r.completed).toHaveLength(0);
    expect(r.outputs.some((o) => o.state === 'TOP' || o.state === 'IN_REP')).toBe(false);
    expect(r.outputs[20].positionHint).toBe('Turn sideways to the camera');
    expect(r.outputs[20]).toMatchObject({ orientationOk: false, orientationHint: 'Turn sideways to the camera' });
  });

  it('squat starting crouched: "Stand up straight to start" until standing, then counts', () => {
    const r = run(
      squat,
      generateSquat({ knee: timeline(hold(120, 1000), hold(170, 700), sweep(170, 85, 2000), hold(170, 300)) }),
    );
    expect(r.outputs[20].state).toBe('READY');
    expect(r.outputs[20].positionHint).toBe('Stand up straight to start');
    expect(r.outputs[40].positionHint).toBeNull(); // standing, holding still
    expect(r.completed).toHaveLength(1);
  });

  it('reports hold progress while standing still', () => {
    const r = run(squat, generateSquat({ knee: timeline(hold(170, 700)) }));
    const progress = r.outputs.filter((o) => o.state === 'READY').map((o) => o.holdProgress);
    expect(progress[0]).toBe(0);
    expect(Math.max(...progress)).toBeGreaterThan(0.8);
    expect(progress).toEqual([...progress].sort((a, b) => a - b)); // only ever grows
  });

  it('curl with the arm bent: "Straighten your arm down by your side to start"', () => {
    const r = run(bicepCurl, generateCurl({ elbow: timeline(hold(90, 600)) }));
    expect(r.last.positionHint).toBe('Straighten your arm down by your side to start');
  });

  it('press turned sideways: never starts, says "Face the camera"', () => {
    const r = run(shoulderPress, turnSideways(generatePress({ leftElbow: timeline(hold(90, 1000), sweep(90, 168, 2000), hold(90, 300)) })));
    expect(r.completed).toHaveLength(0);
    expect(r.outputs[20].positionHint).toBe('Face the camera');
  });

  it('press with hands overhead at the start: "Bring your hands down to your shoulders to start"', () => {
    const r = run(shoulderPress, generatePress({ leftElbow: timeline(hold(165, 600)) }));
    expect(r.last.positionHint).toBe('Bring your hands down to your shoulders to start');
  });

  it('turning toward the camera mid-rep does not cancel or block the rep', () => {
    const frames = generateSquat({ knee: timeline(hold(170, 700), sweep(170, 85, 2000), hold(170, 300)) });
    // turned for the middle 1 s of the rep only
    const mixed = frames.map((f, i) => (i > 35 && i < 65 ? turnToCamera([f])[0] : f));
    expect(run(squat, mixed).completed).toHaveLength(1);
  });
});
