import { squat } from './squat';
import type { ExerciseDefinition, ExerciseSlug } from './types';

export const EXERCISES: Partial<Record<ExerciseSlug, ExerciseDefinition>> = {
  squat,
};

export function getExercise(slug: string): ExerciseDefinition | undefined {
  return EXERCISES[slug as ExerciseSlug];
}
