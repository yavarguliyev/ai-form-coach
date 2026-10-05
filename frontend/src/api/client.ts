// Typed fetch wrapper for the FormCoach backend (CLAUDE.md §7).

import type { MissReason } from '../engine/errorCodes';
import type { ExerciseSlug } from '../engine/exercises/types';

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8010';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(ApiError.describe(status, body));
  }

  /** Human-readable message from FastAPI's {detail} body. */
  static describe(status: number, body: unknown): string {
    const detail = (body as { detail?: unknown } | null)?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
      return detail.map((d: { msg?: string }) => d.msg ?? 'Invalid value').join('; ');
    }
    return `Request failed (${status})`;
  }
}

/**
 * The server could not be reached (not running, starting up, network down). Deliberately has no
 * `status`: the rep save queue retries errors without a status (see sync/sessionSync.ts).
 */
export class NetworkError extends Error {
  constructor(readonly cause: unknown) {
    super("Can't reach the FormCoach server");
  }
}

type RequestOptions = Omit<RequestInit, 'body'> & { timeoutMs?: number; body?: unknown };

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { timeoutMs = 5000, body, ...rest } = options;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...rest,
      headers: { 'Content-Type': 'application/json', ...rest.headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: rest.signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new NetworkError(err);
  }
  const data: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

// --- types (mirror backend/app/schemas.py) ----------------------------------------

export interface HealthResponse {
  status: 'ok' | 'degraded';
  db: 'ok' | 'error';
}

export interface User {
  id: string;
  name: string;
  created_at: string;
}

export interface Exercise {
  id: number;
  slug: ExerciseSlug;
  name: string;
  body_part: 'legs' | 'arms' | 'shoulders';
  camera_view: 'side' | 'front';
  instructions: string;
}

export interface Session {
  id: string;
  user_id: string;
  exercise_slug: ExerciseSlug;
  started_at: string;
  ended_at: string | null;
  /** Counted reps. */
  total_reps: number;
  good_reps: number;
  /** Attempts that didn't count (too shallow / fast / slow). */
  missed_reps: number;
  /** Attempts the camera lost — shown, not penalized. */
  unseen_reps: number;
  /** total_reps + missed_reps. */
  attempts: number;
  /** Set score: average over attempts, a missed attempt counts as 0. */
  avg_score: number | null;
  /** Average of counted reps only. */
  counted_avg_score: number | null;
  duration_ms: number | null;
}

export interface Rep {
  id: string;
  rep_index: number;
  started_at: string;
  duration_ms: number;
  min_angle: number;
  max_angle: number;
  score: number;
  errors: string[];
  metrics: Record<string, number>;
  counted: boolean;
  miss_reason: MissReason | null;
}

export interface SessionDetail extends Session {
  reps: Rep[];
}

/** One attempt, in attempt order. Omit counted / miss_reason for a counted rep. */
export interface RepCreate {
  rep_index: number;
  started_at: string;
  duration_ms: number;
  min_angle: number;
  max_angle: number;
  score: number;
  errors: string[];
  metrics: Record<string, number>;
  counted?: boolean;
  miss_reason?: MissReason;
}

export interface SessionPoint {
  id: string;
  started_at: string;
  total_reps: number;
  good_reps: number;
  missed_reps: number;
  attempts: number;
  avg_score: number | null;
}

export interface ExerciseStats {
  exercise_slug: ExerciseSlug;
  exercise_name: string;
  total_sessions: number;
  total_reps: number;
  good_reps: number;
  missed_reps: number;
  attempts: number;
  /** Over all attempts (missed = 0). */
  avg_score: number | null;
  best_session: SessionPoint | null;
  recent_sessions: SessionPoint[];
  top_errors: Array<{ code: string; count: number }>;
}

export interface UserStats {
  user_id: string;
  exercises: ExerciseStats[];
}

// --- endpoints ------------------------------------------------------------------

export const api = {
  health: () => request<HealthResponse>('/api/health'),

  listUsers: () => request<User[]>('/api/users'),
  createUser: (name: string) => request<User>('/api/users', { method: 'POST', body: { name } }),
  userStats: (userId: string) => request<UserStats>(`/api/users/${userId}/stats`),

  listExercises: () => request<Exercise[]>('/api/exercises'),

  createSession: (userId: string, exerciseSlug: ExerciseSlug) =>
    request<Session>('/api/sessions', { method: 'POST', body: { user_id: userId, exercise_slug: exerciseSlug } }),
  addRep: (sessionId: string, rep: RepCreate) =>
    request<Rep>(`/api/sessions/${sessionId}/reps`, { method: 'POST', body: rep }),
  finishSession: (sessionId: string, endedAt: string) =>
    request<Session>(`/api/sessions/${sessionId}/finish`, { method: 'POST', body: { ended_at: endedAt } }),
  listSessions: (params: { userId?: string; exerciseSlug?: ExerciseSlug; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.userId) q.set('user_id', params.userId);
    if (params.exerciseSlug) q.set('exercise_slug', params.exerciseSlug);
    if (params.limit) q.set('limit', String(params.limit));
    return request<Session[]>(`/api/sessions${q.size ? `?${q}` : ''}`);
  },
  getSession: (sessionId: string) => request<SessionDetail>(`/api/sessions/${sessionId}`),
  deleteSession: (sessionId: string) => request<null>(`/api/sessions/${sessionId}`, { method: 'DELETE' }),
};
