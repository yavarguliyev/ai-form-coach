import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ApiError, api, type Exercise } from '../api/client';
import { OfflineNotice } from '../components/OfflineNotice';
import { useTitle } from '../useTitle';
import { useBackend } from '../state/BackendContext';
import { useUser } from '../state/UserContext';
import styles from './HomePage.module.css';

const BODY_PART_LABEL: Record<Exercise['body_part'], string> = {
  legs: 'Legs & hips',
  arms: 'Arms',
  shoulders: 'Shoulders',
};

/** What the engine checks on every rep, shown on the cards (UI copy, see engine/exercises). */
const CHECKS: Record<Exercise['slug'], string[]> = {
  squat: ['Depth — knees to 100° or lower', 'Chest up — torso lean under 45°', 'Tempo — at least 1 s per rep'],
  bicep_curl: ['Full curl — elbow to 50° or lower', 'Elbow pinned to your side', 'Full extension between reps'],
  shoulder_press: ['Lockout — both hands above your head', 'Both arms pressing evenly', 'Tempo — at least 0.8 s per rep'],
};

/** Little figure seen from the side or the front, so the camera setup is clear at a glance. */
function CameraViewIcon({ view }: { view: Exercise['camera_view'] }) {
  return (
    <svg viewBox="0 0 48 48" width="30" height="30" aria-hidden>
      <circle cx="24" cy="9" r="5" fill="currentColor" />
      {view === 'side' ? (
        <path d="M24 15 v16 M24 20 l7 6 M24 31 l-4 13 M24 31 l4 13" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M24 15 v16 M14 20 h20 M24 31 l-6 13 M24 31 l6 13" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      )}
    </svg>
  );
}

function UserCard() {
  const { users, user, loading, error, selectUser, createUser, reload } = useUser();
  const { status } = useBackend();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    setCreateError(null);
    try {
      await createUser(trimmed);
      setName('');
    } catch (err) {
      setCreateError(
        err instanceof ApiError && err.status === 409
          ? `“${trimmed}” already exists — pick it from the list.`
          : err instanceof Error
            ? err.message
            : String(err),
      );
    } finally {
      setCreating(false);
    }
  };

  // While the server is unreachable the page-level OfflineNotice explains it once.
  if (error && status === 'connected') {
    return (
      <div className={styles.userCard} role="alert">
        <p className={styles.error}>Couldn't load users: {error}</p>
        <button type="button" className="btn btn-secondary" onClick={() => void reload()}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className={styles.userCard}>
      <label className={styles.field}>
        <span className={styles.label}>Training as</span>
        <select
          value={user?.id ?? ''}
          onChange={(e) => selectUser(e.target.value)}
          disabled={loading || users.length === 0}
          data-user-select
        >
          {loading && <option value="">Loading…</option>}
          {!loading && users.length === 0 && (
            <option value="">{status === 'connected' ? 'No users yet' : 'Waiting for server…'}</option>
          )}
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </label>

      <form className={styles.field} onSubmit={onCreate}>
        <span className={styles.label}>New person</span>
        <div className={styles.inline}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" maxLength={50} data-new-user />
          <button type="submit" className="btn btn-secondary" disabled={creating || !name.trim()}>
            {creating ? 'Adding…' : 'Add'}
          </button>
        </div>
      </form>
      {createError && (
        <p className={styles.error} role="alert">
          {createError}
        </p>
      )}
    </div>
  );
}

export default function HomePage() {
  useTitle('Exercises');
  const { user } = useUser();
  const { status, reconnects } = useBackend();
  const [exercises, setExercises] = useState<Exercise[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .listExercises()
      .then((list) => !cancelled && setExercises(list))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [attempt, reconnects]);

  return (
    <section className={styles.page}>
      <div className={styles.hero}>
        <div>
          <h1 className={styles.title}>Pick an exercise</h1>
          <p className={styles.lead}>
            Your camera watches your form, counts only clean reps, and tells you what to fix. Video never leaves this
            laptop.
          </p>
        </div>
        <UserCard />
      </div>

      <OfflineNotice />
      {error && status === 'connected' && (
        <div className={styles.notice} role="alert">
          <p className={styles.error}>Couldn't load exercises: {error}</p>
          <button type="button" className="btn btn-secondary" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      )}
      {!exercises && !error && status !== 'offline' && <p className={styles.muted}>Loading exercises…</p>}

      <div className={styles.cards}>
        {exercises?.map((ex) => (
          <article key={ex.slug} className={styles.card} data-exercise-card={ex.slug}>
            <header className={styles.cardHeader}>
              <span className={styles.icon}>
                <CameraViewIcon view={ex.camera_view} />
              </span>
              <div className={styles.cardTitle}>
                <h2>{ex.name}</h2>
                <div className={styles.tags}>
                  <span>{BODY_PART_LABEL[ex.body_part]}</span>
                  <span>{ex.camera_view === 'side' ? 'Side view' : 'Front view'}</span>
                </div>
              </div>
            </header>

            <div className={styles.section}>
              <h3>Setup</h3>
              <p>{ex.instructions}</p>
            </div>

            <div className={styles.section}>
              <h3>What I check</h3>
              <ul className={styles.checks}>
                {CHECKS[ex.slug].map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>

            {user ? (
              <Link className={`btn btn-primary ${styles.start}`} to={`/workout/${ex.slug}`}>
                Start as {user.name}
              </Link>
            ) : (
              <span className={`btn btn-secondary ${styles.start}`} aria-disabled>
                Choose a user first
              </span>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
