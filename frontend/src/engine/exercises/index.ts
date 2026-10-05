import { bicepCurl } from './bicepCurl';
import { squat } from './squat';
import type { ExerciseDefinition, ExerciseSlug } from './types';

export const EXERCISES: Partial<Record<ExerciseSlug, ExerciseDefinition>> = {
  squat,
  bicep_curl: bicepCurl,
};

export function getExercise(slug: string): ExerciseDefinition | undefined {
  return EXERCISES[slug as ExerciseSlug];
}
