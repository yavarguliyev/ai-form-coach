import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ApiError, api, type Exercise } from '../api/client';
import { useUser } from '../state/UserContext';
import styles from './HomePage.module.css';

const BODY_PART_LABEL: Record<Exercise['body_part'], string> = {
  legs: 'Legs & hips',
  arms: 'Arms',
  shoulders: 'Shoulders',
};

/** Little figure seen from the side or the front, so the camera setup is clear at a glance. */
function CameraViewIcon({ view }: { view: Exercise['camera_view'] }) {
  return (
    <svg viewBox="0 0 48 48" width="40" height="40" aria-hidden className={styles.viewIcon}>
      <circle cx="24" cy="9" r="5" fill="currentColor" />
      {view === 'side' ? (
        <path d="M24 15 v16 M24 20 l7 6 M24 31 l-4 13 M24 31 l4 13" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M24 15 v16 M14 20 h20 M24 31 l-6 13 M24 31 l6 13" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      )}
    </svg>
  );
}

function UserPicker() {
  const { users, user, loading, error, selectUser, createUser, reload } = useUser();
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

  if (error) {
    return (
      <div className={styles.panel} role="alert">
        <p className={styles.error}>Couldn't load users: {error}</p>
        <button type="button" className={styles.secondary} onClick={() => void reload()}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <label className={styles.field}>
        <span>Who is training?</span>
        <select
          value={user?.id ?? ''}
          onChange={(e) => selectUser(e.target.value)}
          disabled={loading || users.length === 0}
          data-user-select
        >
          {loading && <option value="">Loading…</option>}
          {!loading && users.length === 0 && <option value="">No users yet</option>}
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </label>

      <form className={styles.createForm} onSubmit={onCreate}>
        <label className={styles.field}>
          <span>…or add someone new</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            maxLength={50}
            data-new-user
          />
        </label>
        <button type="submit" className={styles.secondary} disabled={creating || !name.trim()}>
          {creating ? 'Adding…' : 'Add'}
        </button>
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
  const { user } = useUser();
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
  }, [attempt]);

  return (
    <section>
      <h1 className={styles.title}>Pick an exercise</h1>
      <p className={styles.lead}>
        The camera watches your form, counts clean reps, and tells you what to fix. Video never leaves this laptop.
      </p>

      <UserPicker />

      {error && (
        <div className={styles.panel} role="alert">
          <p className={styles.error}>Couldn't load exercises: {error}</p>
          <button type="button" className={styles.secondary} onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      )}
      {!exercises && !error && <p className={styles.muted}>Loading exercises…</p>}

      <div className={styles.cards}>
        {exercises?.map((ex) => (
          <article key={ex.slug} className={styles.card} data-exercise-card={ex.slug}>
            <header className={styles.cardHeader}>
              <CameraViewIcon view={ex.camera_view} />
              <div>
                <h2>{ex.name}</h2>
                <p className={styles.tags}>
                  <span>{BODY_PART_LABEL[ex.body_part]}</span>
                  <span>{ex.camera_view === 'side' ? 'Side view' : 'Front view'}</span>
                </p>
              </div>
            </header>
            <p className={styles.instructions}>{ex.instructions}</p>
            {user ? (
              <Link className={styles.start} to={`/workout/${ex.slug}`}>
                Start as {user.name}
              </Link>
            ) : (
              <span className={`${styles.start} ${styles.disabled}`} aria-disabled>
                Choose a user first
              </span>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
