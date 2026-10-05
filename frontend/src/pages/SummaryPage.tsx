import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError, api, type SessionDetail } from '../api/client';
import { CUE_TEXT, FORM_ERROR_CODES, isRepErrorCode, type RepErrorCode } from '../engine/errorCodes';
import { getExercise } from '../engine/exercises';
import { isGoodRep } from '../engine/scoring';
import { MISTAKE_TIPS } from '../feedback/tips';
import { formatDuration } from '../format';
import styles from './SummaryPage.module.css';

type Load =
  | { status: 'loading' }
  | { status: 'ready'; session: SessionDetail }
  | { status: 'not-found' }
  | { status: 'error'; message: string };

function scoreTone(score: number | null): string {
  if (score === null) return styles.muted;
  return score >= 85 ? styles.good : score >= 70 ? styles.okish : styles.bad;
}

/** Most frequent stored error code across the reps; on a tie, form errors beat "too fast". */
function mostCommonMistake(session: SessionDetail): { code: RepErrorCode; count: number } | null {
  const counts = new Map<RepErrorCode, number>();
  for (const rep of session.reps) {
    for (const e of rep.errors) if (isRepErrorCode(e)) counts.set(e, (counts.get(e) ?? 0) + 1);
  }
  let best: { code: RepErrorCode; count: number } | null = null;
  for (const [code, count] of counts) {
    const beats =
      !best ||
      count > best.count ||
      (count === best.count && FORM_ERROR_CODES.has(code) && !FORM_ERROR_CODES.has(best.code));
    if (beats) best = { code, count };
  }
  return best;
}

export default function SummaryPage() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    api
      .getSession(sessionId)
      .then((session) => !cancelled && setLoad({ status: 'ready', session }))
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 404 || err.status === 422)) setLoad({ status: 'not-found' });
        else setLoad({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, attempt]);

  const mistake = useMemo(() => (load.status === 'ready' ? mostCommonMistake(load.session) : null), [load]);

  if (load.status === 'loading') {
    return (
      <section className={styles.page}>
        <p className={styles.muted}>Loading your results…</p>
      </section>
    );
  }
  if (load.status === 'not-found') {
    return (
      <section className={styles.page}>
        <h1>Session not found</h1>
        <div className={styles.empty}>
          <p>It may have been deleted.</p>
          <Link className="btn btn-secondary" to="/history">
            Go to history
          </Link>
        </div>
      </section>
    );
  }
  if (load.status === 'error') {
    return (
      <section className={styles.page}>
        <h1>Couldn't load the results</h1>
        <div className={styles.empty}>
          <p className={styles.errorText}>{load.message}</p>
          <button type="button" className="btn btn-secondary" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      </section>
    );
  }

  const { session } = load;
  const definition = getExercise(session.exercise_slug);
  const name = definition?.name ?? session.exercise_slug;
  const increasing = definition?.thresholds.direction === 'increasing';
  const angleHeader = increasing ? 'Highest angle' : 'Deepest angle';
  const started = new Date(session.started_at);

  const onDelete = async () => {
    if (!window.confirm('Delete this set and all its reps? This cannot be undone.')) return;
    setDeleting(true);
    try {
      await api.deleteSession(session.id);
      navigate('/history');
    } catch (err) {
      setDeleting(false);
      window.alert(`Could not delete: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <section className={styles.page} data-summary>
      <header className={styles.head}>
        <div>
          <p className={styles.kicker}>Set complete</p>
          <h1>{name}</h1>
          <p className={styles.muted}>
            {started.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} at{' '}
            {started.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <div className={styles.actions}>
          <Link className="btn btn-primary" to={`/workout/${session.exercise_slug}`}>
            Do another set
          </Link>
          <Link className="btn btn-secondary" to="/history">
            History
          </Link>
        </div>
      </header>

      {session.ended_at === null && (
        <p className={styles.notice}>This set wasn't finished (the page was closed mid-set). Reps saved so far are shown.</p>
      )}

      <div className={styles.tiles}>
        <div className={styles.tile}>
          <span className={styles.tileValue} data-total-reps>
            {session.total_reps}
          </span>
          <span className={styles.tileLabel}>Reps</span>
        </div>
        <div className={styles.tile}>
          <span className={`${styles.tileValue} ${styles.good}`} data-good-reps>
            {session.good_reps}
          </span>
          <span className={styles.tileLabel}>Good reps</span>
        </div>
        <div className={styles.tile}>
          <span className={`${styles.tileValue} ${scoreTone(session.avg_score)}`} data-avg-score>
            {session.avg_score === null ? '—' : Math.round(session.avg_score)}
          </span>
          <span className={styles.tileLabel}>Average score</span>
        </div>
        <div className={styles.tile}>
          <span className={styles.tileValue}>{formatDuration(session.duration_ms)}</span>
          <span className={styles.tileLabel}>Duration</span>
        </div>
      </div>

      <div className={styles.columns}>
        <div className={styles.card}>
          <h2>Reps</h2>
          {session.reps.length === 0 ? (
            <p className={styles.muted}>No reps were counted in this set.</p>
          ) : (
            <table className={styles.table} data-rep-table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Score</th>
                  <th>Feedback</th>
                  <th className={styles.num}>{angleHeader}</th>
                  <th className={styles.num}>Time</th>
                </tr>
              </thead>
              <tbody>
                {session.reps.map((rep) => {
                  const codes = rep.errors.filter(isRepErrorCode);
                  return (
                    <tr key={rep.id}>
                      <td className={styles.muted}>{rep.rep_index}</td>
                      <td>
                        <span className={`${styles.scorePill} ${scoreTone(rep.score)}`}>{rep.score}</span>
                      </td>
                      <td>
                        {codes.length === 0 ? (
                          <span className={isGoodRep(rep.score, codes) ? styles.good : styles.muted}>Clean rep</span>
                        ) : (
                          codes.map((c) => CUE_TEXT[c]).join(' · ')
                        )}
                      </td>
                      <td className={styles.num}>{Math.round(increasing ? rep.max_angle : rep.min_angle)}°</td>
                      <td className={styles.num}>{(rep.duration_ms / 1000).toFixed(1)} s</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <aside className={styles.side}>
          <div className={styles.card} data-mistake>
            <h2>Most common mistake</h2>
            {mistake ? (
              <>
                <p className={styles.mistakeTitle}>{MISTAKE_TIPS[mistake.code].title}</p>
                <p className={styles.muted}>
                  In {mistake.count} of {session.reps.length} rep{session.reps.length === 1 ? '' : 's'}
                </p>
                <p className={styles.tip}>
                  <strong>Tip:</strong> {MISTAKE_TIPS[mistake.code].tip}
                </p>
              </>
            ) : session.reps.length > 0 ? (
              <p className={styles.good}>None — every rep was clean. Great set!</p>
            ) : (
              <p className={styles.muted}>Nothing to review yet.</p>
            )}
          </div>
          <button type="button" className={`btn btn-secondary ${styles.delete}`} onClick={() => void onDelete()} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete this set'}
          </button>
        </aside>
      </div>
    </section>
  );
}
