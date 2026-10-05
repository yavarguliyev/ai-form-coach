// Typed fetch wrapper for the FormCoach backend (CLAUDE.md §7).

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8010';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API ${status}`);
  }
}

async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs = 5000, ...rest } = init ?? {};
  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: { 'Content-Type': 'application/json', ...rest.headers },
    signal: rest.signal ?? AbortSignal.timeout(timeoutMs),
  });
  const body: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  db: 'ok' | 'error';
}

export const api = {
  health: () => request<HealthResponse>('/api/health'),
};
