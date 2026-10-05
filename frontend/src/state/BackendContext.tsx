import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, api } from '../api/client';

export type BackendStatus = 'checking' | 'connected' | 'db-error' | 'offline';

const POLL_MS = 10_000;
/** Check more often while the server is down, so pages recover quickly once it's back. */
const POLL_OFFLINE_MS = 3_000;

interface BackendValue {
  status: BackendStatus;
  /** Increments every time the backend becomes reachable again — pages refetch on change. */
  reconnects: number;
  checkNow: () => void;
}

const BackendContext = createContext<BackendValue | null>(null);

export function BackendProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<BackendStatus>('checking');
  const [reconnects, setReconnects] = useState(0);
  const statusRef = useRef<BackendStatus>('checking');
  const [tick, setTick] = useState(0);

  const update = useCallback((next: BackendStatus) => {
    const prev = statusRef.current;
    statusRef.current = next;
    setStatus(next);
    if (next === 'connected' && (prev === 'offline' || prev === 'db-error')) setReconnects((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      let next: BackendStatus;
      try {
        const h = await api.health();
        next = h.db === 'ok' ? 'connected' : 'db-error';
      } catch (err) {
        // 503 from /api/health means the server is up but the database is not.
        next = err instanceof ApiError && err.status === 503 ? 'db-error' : 'offline';
      }
      if (cancelled) return;
      update(next);
      timer = setTimeout(check, next === 'connected' ? POLL_MS : POLL_OFFLINE_MS);
    };
    void check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [update, tick]);

  const value = useMemo(
    () => ({ status, reconnects, checkNow: () => setTick((n) => n + 1) }),
    [status, reconnects],
  );
  return <BackendContext.Provider value={value}>{children}</BackendContext.Provider>;
}

export function useBackend(): BackendValue {
  const ctx = useContext(BackendContext);
  if (!ctx) throw new Error('useBackend must be used inside <BackendProvider>');
  return ctx;
}
