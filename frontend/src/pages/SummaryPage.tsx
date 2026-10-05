import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError, api, type SessionDetail } from '../api/client';
import {
  CUE_TEXT,
  FORM_ERROR_CODES,
  isMissErrorCode,
  isRepErrorCode,
  type MissErrorCode,
  type MissReason,
  type RepErrorCode,
} from '../engine/errorCodes';
import { getExercise } from '../engine/exercises';
import { isGoodRep } from '../engine/scoring';
import { MISTAKE_TIPS } from '../feedback/tips';
import { OfflineNotice } from '../components/OfflineNotice';
import { formatDuration } from '../format';
import { useBackend } from '../state/BackendContext';
import { useTitle } from '../useTitle';
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

type Code = RepErrorCode | MissErrorCode;
const isCode = (e: string): e is Code => isRepErrorCode(e) || isMissErrorCode(e);

const MISS_LABEL: Record<MissReason, string> = {
  partial: 'Not deep enough',
  too_short: 'Too fast to count',
  too_long: 'Took longer than 8 s',
  lost_tracking: 'Not seen by the camera',
};

/**
 * Most frequent mistake over ALL attempts (counted reps and misses). On a tie, a missed rep
 * ("not deep enough") beats a form error, which beats "too fast" — the most costly first.
 */
function mostCommonMistake(session: SessionDetail): { code: Code; count: number } | null {
  const rank = (c: Code) => (isMissErrorCode(c) ? 2 : FORM_ERROR_CODES.has(c as RepErrorCode) ? 1 : 0);
  const counts = new Map<Code, number>();
  for (const rep of session.reps) {
    for (const e of rep.errors) if (isCode(e)) counts.set(e, (counts.get(e) ?? 0) + 1);
  }
  let best: { code: Code; count: number } | null = null;
  for (const [code, count] of counts) {
    if (!best || count > best.count || (count === best.count && rank(code) > rank(best.code))) {
      best = { code, count };
    }
  }
  return best;
}

export default function SummaryPage() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const { reconnects } = useBackend();
  const title = load.status === 'ready' ? `${getExercise(load.session.exercise_slug)?.name ?? 'Set'} summary` : 'Summary';
  useTitle(title);

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
  }, [sessionId, attempt, reconnects]);

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
        <OfflineNotice />
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
        <div className={`${styles.tile} ${styles.tileMain}`}>
          <span className={`${styles.tileValue} ${scoreTone(session.avg_score)}`} data-avg-score>
            {session.avg_score === null ? '—' : Math.round(session.avg_score)}
          </span>
          <span className={styles.tileLabel}>Set score</span>
          <span className={styles.tileNote}>
            {session.counted_avg_score === null
              ? 'Missed attempts count as 0'
              : `Counted reps averaged ${Math.round(session.counted_avg_score)} · missed attempts count as 0`}
          </span>
        </div>
        <div className={styles.tile}>
          <span className={styles.tileValue} data-total-reps>
            {session.total_reps}
          </span>
          <span className={styles.tileLabel}>Counted</span>
          <span className={styles.tileNote}>of {session.attempts} attempts</span>
        </div>
        <div className={styles.tile}>
          <span className={`${styles.tileValue} ${styles.good}`} data-good-reps>
            {session.good_reps}
          </span>
          <span className={styles.tileLabel}>Good</span>
          <span className={styles.tileNote}>
            {session.attempts ? `${Math.round((session.good_reps / session.attempts) * 100)}% effective` : '—'}
          </span>
        </div>
        <div className={styles.tile}>
          <span className={`${styles.tileValue} ${session.missed_reps ? styles.bad : ''}`} data-missed-reps>
            {session.missed_reps}
          </span>
          <span className={styles.tileLabel}>Missed</span>
          <span className={styles.tileNote}>{formatDuration(session.duration_ms)} set</span>
        </div>
      </div>

      {session.unseen_reps > 0 && (
        <p className={styles.notice}>
          {session.unseen_reps} attempt{session.unseen_reps === 1 ? ' was' : 's were'} not seen by the camera — not
          counted against you. Check your lighting and that your whole body stays in frame.
        </p>
      )}

      <div className={styles.columns}>
        <div className={styles.card}>
          <h2>Every attempt</h2>
          {session.reps.length === 0 ? (
            <p className={styles.muted}>No attempts were recorded in this set.</p>
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
                  if (!rep.counted) {
                    const reason = rep.miss_reason ?? 'partial';
                    return (
                      <tr key={rep.id} className={styles.missRow} data-miss>
                        <td className={styles.muted}>{rep.rep_index}</td>
                        <td>
                          <span className={`${styles.scorePill} ${reason === 'lost_tracking' ? styles.muted : styles.bad}`}>
                            {reason === 'lost_tracking' ? '–' : 0}
                          </span>
                        </td>
                        <td>
                          <strong className={reason === 'lost_tracking' ? styles.okish : styles.bad}>Not counted</strong>{' '}
                          · {MISS_LABEL[reason]}
                          {reason === 'partial' && definition && (
                            <span className={styles.muted}> (needs {definition.thresholds.endThreshold}°)</span>
                          )}
                        </td>
                        <td className={styles.num}>{Math.round(increasing ? rep.max_angle : rep.min_angle)}°</td>
                        <td className={styles.num}>{(rep.duration_ms / 1000).toFixed(1)} s</td>
                      </tr>
                    );
                  }
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
                  In {mistake.count} of {session.reps.length} attempt{session.reps.length === 1 ? '' : 's'}
                </p>
                <p className={styles.tip}>
                  <strong>Tip:</strong> {MISTAKE_TIPS[mistake.code].tip}
                </p>
              </>
            ) : session.reps.length > 0 && session.missed_reps === 0 ? (
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
