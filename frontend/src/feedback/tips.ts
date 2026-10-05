// Coaching tips for the Summary page's "most common mistake" (CLAUDE.md §9).

import type { MissErrorCode, RepErrorCode } from '../engine/errorCodes';

export const MISTAKE_TIPS: Record<RepErrorCode | MissErrorCode, { title: string; tip: string }> = {
  SQUAT_SHALLOW: {
    title: 'Not squatting deep enough',
    tip: 'Sit down until your thighs are at least parallel to the floor (knees at about 90°). If that is hard, widen your stance a little and keep your heels down.',
  },
  CURL_PARTIAL: {
    title: 'Not curling all the way up',
    tip: 'Bring your hand all the way up to your shoulder on every rep. If you can’t, the weight is too heavy.',
  },
  PRESS_PARTIAL: {
    title: 'Not pressing all the way up',
    tip: 'Finish every press with straight arms and both hands above your head before lowering.',
  },
  SQUAT_TORSO_LEAN: {
    title: 'Chest dropping forward',
    tip: 'Brace your core, keep your eyes straight ahead and sit your hips back as if onto a chair, so your chest stays up.',
  },
  SQUAT_TOO_FAST: {
    title: 'Squatting too fast',
    tip: 'Take about two seconds on the way down and one second up. Control beats speed.',
  },
  CURL_ELBOW_SWING: {
    title: 'Elbow swinging forward',
    tip: 'Pin your upper arm to your side — only your forearm should move. If you need momentum, the weight is too heavy.',
  },
  CURL_TOO_FAST: {
    title: 'Curling too fast',
    tip: 'Lift for one second, lower for two. The slow way down builds the most strength.',
  },
  PRESS_UNEVEN: {
    title: 'Arms pressing unevenly',
    tip: 'Move both hands at the same speed and finish with both arms straight above your head. Use the mirror or a lighter weight.',
  },
  PRESS_TOO_FAST: {
    title: 'Pressing too fast',
    tip: 'Press up for one second and lower for two, stopping with your hands at shoulder height.',
  },
};
