import { useBackend, type BackendStatus as Status } from '../state/BackendContext';
import styles from './BackendStatus.module.css';

const LABELS: Record<Status, string> = {
  checking: 'Backend: checking…',
  connected: 'Backend: connected',
  'db-error': 'Backend: database unavailable',
  offline: 'Backend: offline',
};

export function BackendStatus() {
  const { status } = useBackend();
  return (
    <span className={`${styles.status} ${styles[status]}`} role="status">
      <span className={styles.dot} aria-hidden />
      {LABELS[status]}
    </span>
  );
}
