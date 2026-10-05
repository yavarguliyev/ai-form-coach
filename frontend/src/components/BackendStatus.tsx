import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import styles from './BackendStatus.module.css';

type Status = 'checking' | 'connected' | 'db-error' | 'offline';

const POLL_MS = 10_000;

const LABELS: Record<Status, string> = {
  checking: 'Backend: checking…',
  connected: 'Backend: connected',
  'db-error': 'Backend: database unavailable',
  offline: 'Backend: offline',
};

export function BackendStatus() {
  const [status, setStatus] = useState<Status>('checking');

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const h = await api.health();
        if (!cancelled) setStatus(h.db === 'ok' ? 'connected' : 'db-error');
      } catch (err) {
        // 503 from /api/health means the backend is up but the DB is not.
        if (!cancelled) setStatus(err instanceof ApiError && err.status === 503 ? 'db-error' : 'offline');
      }
    };
    void check();
    const id = setInterval(check, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <span className={`${styles.status} ${styles[status]}`} role="status">
      <span className={styles.dot} aria-hidden />
      {LABELS[status]}
    </span>
  );
}
