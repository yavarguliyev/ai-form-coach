import { bicepCurl } from './bicepCurl';
import { shoulderPress } from './shoulderPress';
import { squat } from './squat';
import type { ExerciseDefinition, ExerciseSlug } from './types';

export const EXERCISES: Record<ExerciseSlug, ExerciseDefinition> = {
  squat,
  bicep_curl: bicepCurl,
  shoulder_press: shoulderPress,
};

/** Definition for a slug from the URL; undefined for anything unknown (incl. "constructor"). */
export function getExercise(slug: string): ExerciseDefinition | undefined {
  return Object.hasOwn(EXERCISES, slug) ? EXERCISES[slug as ExerciseSlug] : undefined;
}
