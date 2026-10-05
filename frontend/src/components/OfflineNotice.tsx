import { useBackend } from '../state/BackendContext';
import styles from './OfflineNotice.module.css';

/** One friendly message when the server is unreachable, instead of per-widget errors. */
export function OfflineNotice() {
  const { status, checkNow } = useBackend();
  if (status !== 'offline' && status !== 'db-error') return null;
  return (
    <div className={styles.notice} role="alert" data-offline-notice>
      <div>
        <strong>{status === 'offline' ? "Can't reach the FormCoach server." : 'The database is not available.'}</strong>
        <p>
          If you just started the app, give it a few seconds. Otherwise start it with{' '}
          <code>bash infra/start.sh</code>. This page reconnects by itself.
        </p>
      </div>
      <button type="button" className="btn btn-secondary" onClick={checkNow}>
        Check now
      </button>
    </div>
  );
}
