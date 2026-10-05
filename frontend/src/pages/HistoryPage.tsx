import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, type ExerciseStats, type Session, type UserStats } from '../api/client';
import { CUE_TEXT, isMissErrorCode, isRepErrorCode } from '../engine/errorCodes';
import type { ExerciseSlug } from '../engine/exercises/types';
import { MISTAKE_TIPS } from '../feedback/tips';
import { formatDate, formatDateTime, formatDuration } from '../format';
import { OfflineNotice } from '../components/OfflineNotice';
import { useBackend } from '../state/BackendContext';
import { useUser } from '../state/UserContext';
import { useTitle } from '../useTitle';
import styles from './HistoryPage.module.css';

// Chart colours: validated with the dataviz palette validator against the dark surface
// #161920 (lightness band, chroma, CVD ΔE 19.6, normal-vision ΔE 20.9, contrast ≥ 3:1).
// The brand accent #3ddc97 is too light for filled marks on dark, so marks use these steps.
const SERIES_GOOD = '#199e70';
const SERIES_OTHER = '#3987e5';
const SERIES_MISSED = '#d95926'; // validated as a 3-colour set with the two above (all pairs)
const SURFACE = '#161920'; // gap / ring colour = card surface
const GRID = '#272c36';
const TICK = '#8d94a1';

const EXERCISE_ORDER: ExerciseSlug[] = ['squat', 'bicep_curl', 'shoulder_press'];

type Load =
  | { status: 'loading' }
  | { status: 'ready'; stats: UserStats; sessions: Session[] }
  | { status: 'error'; message: string };

interface Point {
  id: string;
  label: string;
  avg: number | null;
  good: number;
  other: number;
  missed: number;
  total: number;
  attempts: number;
}

function ChartTooltip({
  active,
  payload,
  mode,
}: {
  active?: boolean;
  payload?: Array<{ payload: Point }>;
  mode: 'score' | 'reps';
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipTitle}>{p.label}</div>
      {mode === 'score' ? (
        <div>
          Average score <strong>{p.avg === null ? '—' : p.avg.toFixed(1)}</strong>
        </div>
      ) : (
        <>
          <div>
            <span className={styles.key} style={{ background: SERIES_GOOD }} /> Good <strong>{p.good}</strong>
          </div>
          <div>
            <span className={styles.key} style={{ background: SERIES_OTHER }} /> Needs work <strong>{p.other}</strong>
          </div>
          <div>
            <span className={styles.key} style={{ background: SERIES_MISSED }} /> Missed <strong>{p.missed}</strong>
          </div>
          <div className={styles.tooltipMuted}>
            {p.total} counted of {p.attempts} attempts
          </div>
        </>
      )}
    </div>
  );
}

function ExerciseHistory({ stats, sessions }: { stats: ExerciseStats; sessions: Session[] }) {
  const points: Point[] = stats.recent_sessions.map((s) => ({
    id: s.id,
    label: formatDateTime(s.started_at),
    avg: s.avg_score,
    good: s.good_reps,
    other: s.total_reps - s.good_reps,
    missed: s.missed_reps,
    total: s.total_reps,
    attempts: s.attempts,
  }));
  const last = points[points.length - 1];

  if (stats.total_sessions === 0) {
    return (
      <div className={styles.empty} data-history-empty>
        <p>No {stats.exercise_name.toLowerCase()} sets yet.</p>
        <Link className="btn btn-primary" to={`/workout/${stats.exercise_slug}`}>
          Start a {stats.exercise_name.toLowerCase()} set
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className={styles.tiles}>
        <div className={styles.tile}>
          <span className={styles.tileValue}>{stats.total_sessions}</span>
          <span className={styles.tileLabel}>Sets</span>
        </div>
        <div className={styles.tile}>
          <span className={styles.tileValue}>{stats.total_reps}</span>
          <span className={styles.tileLabel}>Counted reps</span>
          <span className={styles.tileNote}>of {stats.attempts} attempts</span>
        </div>
        <div className={styles.tile}>
          <span className={styles.tileValue}>{stats.avg_score === null ? '—' : Math.round(stats.avg_score)}</span>
          <span className={styles.tileLabel}>Average set score</span>
          <span className={styles.tileNote}>
            {stats.best_session?.avg_score == null
              ? 'missed attempts count as 0'
              : `best ${Math.round(stats.best_session.avg_score)} · ${formatDate(stats.best_session.started_at)}`}
          </span>
        </div>
        <div className={styles.tile}>
          <span className={`${styles.tileValue} ${stats.missed_reps ? styles.bad : ''}`}>{stats.missed_reps}</span>
          <span className={styles.tileLabel}>Missed attempts</span>
          <span className={styles.tileNote}>
            {stats.attempts ? `${Math.round((stats.missed_reps / stats.attempts) * 100)}% of attempts` : '—'}
          </span>
        </div>
      </div>

      <div className={styles.charts}>
        <figure className={styles.card} data-chart="score">
          <figcaption>
            <h2>Set score</h2>
            <p className={styles.sub}>Last {points.length} sets · missed attempts count as 0</p>
          </figcaption>
          <div className={styles.chart}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 16, right: 36, bottom: 4, left: -16 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="label" tick={false} axisLine={{ stroke: GRID }} tickLine={false} />
                <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={{ fill: TICK, fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip mode="score" />} cursor={{ stroke: TICK, strokeWidth: 1 }} />
                <Line
                  type="monotone"
                  dataKey="avg"
                  stroke={SERIES_GOOD}
                  strokeWidth={2}
                  dot={{ r: 4, fill: SERIES_GOOD, stroke: SURFACE, strokeWidth: 2 }}
                  activeDot={{ r: 6, fill: SERIES_GOOD, stroke: SURFACE, strokeWidth: 2 }}
                  isAnimationActive={false}
                  connectNulls
                >
                  {/* Label only the latest value; axis + tooltip carry the rest. */}
                  <LabelList
                    dataKey="avg"
                    content={({ x, y, index, value }) =>
                      index === points.length - 1 && typeof value === 'number' ? (
                        <text x={Number(x) + 10} y={Number(y) + 4} fill="#eceef1" fontSize={13} fontWeight={700}>
                          {Math.round(value)}
                        </text>
                      ) : null
                    }
                  />
                </Line>
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className={styles.axisNote}>
            {points.length > 0 && `${points[0].label.split(',')[0]} → ${last.label.split(',')[0]}`}
          </p>
        </figure>

        <figure className={styles.card} data-chart="reps">
          <figcaption>
            <h2>Attempts per set</h2>
            <div className={styles.legend}>
              <span>
                <span className={styles.key} style={{ background: SERIES_GOOD }} /> Good
              </span>
              <span>
                <span className={styles.key} style={{ background: SERIES_OTHER }} /> Needs work
              </span>
              <span>
                <span className={styles.key} style={{ background: SERIES_MISSED }} /> Missed
              </span>
            </div>
          </figcaption>
          <div className={styles.chart}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={points} margin={{ top: 16, right: 8, bottom: 4, left: -16 }} barCategoryGap="30%">
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="label" tick={false} axisLine={{ stroke: GRID }} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fill: TICK, fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip mode="reps" />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                {/* 2px surface-coloured stroke = the gap between stacked segments. */}
                {/* Both segments get the 4px rounded end so a bar with no "needs work" reps still has one. */}
                <Bar
                  dataKey="good"
                  stackId="reps"
                  fill={SERIES_GOOD}
                  stroke={SURFACE}
                  strokeWidth={2}
                  maxBarSize={24}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="other"
                  stackId="reps"
                  fill={SERIES_OTHER}
                  stroke={SURFACE}
                  strokeWidth={2}
                  maxBarSize={24}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="missed"
                  stackId="reps"
                  fill={SERIES_MISSED}
                  stroke={SURFACE}
                  strokeWidth={2}
                  maxBarSize={24}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className={styles.axisNote}>Oldest → newest</p>
        </figure>
      </div>

      <div className={styles.columns}>
        <div className={styles.card}>
          <h2>Sets</h2>
          <table className={styles.table} data-session-table>
            <thead>
              <tr>
                <th>When</th>
                <th className={styles.num}>Counted</th>
                <th className={styles.num}>Good</th>
                <th className={styles.num}>Missed</th>
                <th className={styles.num}>Score</th>
                <th className={styles.num}>Duration</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>
                    {formatDateTime(s.started_at)}
                    {s.ended_at === null && <span className={styles.unfinished}> · unfinished</span>}
                  </td>
                  <td className={styles.num}>{s.total_reps}</td>
                  <td className={styles.num}>{s.good_reps}</td>
                  <td className={`${styles.num} ${s.missed_reps ? styles.bad : ''}`}>{s.missed_reps}</td>
                  <td className={styles.num}>{s.avg_score === null ? '—' : Math.round(s.avg_score)}</td>
                  <td className={styles.num}>{formatDuration(s.duration_ms)}</td>
                  <td className={styles.num}>
                    <Link to={`/sessions/${s.id}`}>Details →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <aside className={styles.card} data-top-mistakes>
          <h2>Top mistakes</h2>
          {stats.top_errors.length === 0 ? (
            <p className={styles.good}>No mistakes recorded — clean reps only.</p>
          ) : (
            <ol className={styles.mistakes}>
              {stats.top_errors.map((e) => {
                const share = stats.attempts ? e.count / stats.attempts : 0;
                const known = isRepErrorCode(e.code) || isMissErrorCode(e.code);
                return (
                  <li key={e.code}>
                    <div className={styles.mistakeRow}>
                      <span>{known ? MISTAKE_TIPS[e.code as keyof typeof MISTAKE_TIPS].title : e.code}</span>
                      <span className={styles.mistakeCount}>
                        {e.count}× · {Math.round(share * 100)}%
                      </span>
                    </div>
                    <span className={styles.track}>
                      <span className={styles.fill} style={{ width: `${Math.max(4, share * 100)}%` }} />
                    </span>
                    <span className={styles.cue}>“{known ? CUE_TEXT[e.code as keyof typeof CUE_TEXT] : e.code}”</span>
                  </li>
                );
              })}
            </ol>
          )}
        </aside>
      </div>
    </>
  );
}

export default function HistoryPage() {
  useTitle('History');
  const { user, loading: usersLoading } = useUser();
  const { status, reconnects } = useBackend();
  const [slug, setSlug] = useState<ExerciseSlug>('squat');
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoad({ status: 'loading' });
    Promise.all([api.userStats(user.id), api.listSessions({ userId: user.id, limit: 200 })])
      .then(([stats, sessions]) => !cancelled && setLoad({ status: 'ready', stats, sessions }))
      .catch((err: unknown) => !cancelled && setLoad({ status: 'error', message: err instanceof Error ? err.message : String(err) }));
    return () => {
      cancelled = true;
    };
  }, [user, attempt, reconnects]);

  const byExercise = useMemo(() => {
    if (load.status !== 'ready') return null;
    return new Map(load.stats.exercises.map((e) => [e.exercise_slug, e]));
  }, [load]);

  if (!user) {
    return (
      <section className={styles.page}>
        <h1 className={styles.title}>History</h1>
        <OfflineNotice />
        <div className={styles.empty} hidden={status === 'offline' || status === 'db-error'}>
          <p>{usersLoading ? 'Loading…' : 'Choose who is training first.'}</p>
          {!usersLoading && (
            <Link className="btn btn-secondary" to="/">
              Go to exercises
            </Link>
          )}
        </div>
      </section>
    );
  }

  const current = byExercise?.get(slug);
  const sessions = load.status === 'ready' ? load.sessions.filter((s) => s.exercise_slug === slug) : [];

  return (
    <section className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>History</h1>
          <p className={styles.sub}>{user.name}'s progress</p>
        </div>
        <div className={styles.tabs} role="tablist" aria-label="Exercise">
          {EXERCISE_ORDER.map((s) => {
            const e = byExercise?.get(s);
            return (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={s === slug}
                className={s === slug ? styles.tabActive : styles.tab}
                onClick={() => setSlug(s)}
                data-tab={s}
              >
                {e?.exercise_name ?? s}
                {e && <span className={styles.tabCount}>{e.total_sessions}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <OfflineNotice />
      {load.status === 'loading' && status !== 'offline' && <p className={styles.sub}>Loading history…</p>}
      {load.status === 'error' && status === 'connected' && (
        <div className={styles.empty} role="alert">
          <p className={styles.bad}>Couldn't load history: {load.message}</p>
          <button type="button" className="btn btn-secondary" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      )}
      {load.status === 'ready' && current && <ExerciseHistory stats={current} sessions={sessions} />}
    </section>
  );
}
