// A minimal knee-driven exercise used to test the analyzer independently of the real
// exercise definitions (those get their own tests in T-20..T-22).

import type { ExerciseDefinition } from '../../exercises/types';
import { angleAt, angleFromVertical } from '../../geometry';
import { LM } from '../../landmarks';
import type { Side } from '../../visibility';

const chain = (side: Side | null) =>
  side === 'right'
    ? { s: LM.RIGHT_SHOULDER, h: LM.RIGHT_HIP, k: LM.RIGHT_KNEE, a: LM.RIGHT_ANKLE }
    : { s: LM.LEFT_SHOULDER, h: LM.LEFT_HIP, k: LM.LEFT_KNEE, a: LM.LEFT_ANKLE };

export const TEST_LEAN_LIMIT = 45;

export const testExercise: ExerciseDefinition = {
  slug: 'squat',
  name: 'Test knee exercise',
  cameraView: 'side',
  thresholds: { direction: 'decreasing', startThreshold: 160, leaveTopThreshold: 145, endThreshold: 100 },
  sideChains: {
    left: [LM.LEFT_SHOULDER, LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE],
    right: [LM.RIGHT_SHOULDER, LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE],
  },
  requiredLandmarks: (side) => Object.values(chain(side)),
  primaryAngle: (p, side) => {
    const c = chain(side);
    return angleAt(p[c.h], p[c.k], p[c.a]);
  },
  frameMetrics: (p, side) => {
    const c = chain(side);
    return { torsoLean: angleFromVertical(p[c.h], p[c.s]) };
  },
  limits: [{ key: 'lean', label: 'Lean', default: TEST_LEAN_LIMIT, min: 0, max: 90, step: 1, unit: '°' }],
  evaluateRep: (rep, limits) => (rep.maxMetrics.torsoLean > limits.lean ? ['SQUAT_TORSO_LEAN'] : []),
  liveCue: (m, _state, limits) => (m.torsoLean > limits.lean ? 'SQUAT_TORSO_LEAN' : null),
  partialCue: 'SQUAT_SHALLOW',
  primaryAngleLabel: 'Knee angle',
  startHint: 'Stand up straight to start',
  setupInstructions: 'test',
};
