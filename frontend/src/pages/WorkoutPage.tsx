import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, type RepCreate } from '../api/client';
import { AngleGauge } from '../components/AngleGauge';
import { CameraError } from '../components/CameraError';
import { DebugPanel, type DebugInfo, type Tuning } from '../components/DebugPanel';
import { drawSkeleton } from '../components/skeleton';
import { VideoCanvas } from '../components/VideoCanvas';
import { createAnalyzer, type Analyzer, type AnalyzerOutput, type CompletedRep } from '../engine/analyzer';
import { CUE_TEXT, type ErrorCode } from '../engine/errorCodes';
import { getExercise } from '../engine/exercises';
import { LM } from '../engine/landmarks';
import { defaultLimits, type ExerciseDefinition } from '../engine/exercises/types';
import { validateThresholds, type RejectReason, type RepState } from '../engine/repCounter';
import { isGoodRep } from '../engine/scoring';
import { useCamera } from '../pose/useCamera';
import { usePoseLandmarker, type PoseFrame } from '../pose/usePoseLandmarker';
import { useUser } from '../state/UserContext';
import { FinishTimeoutError, createSessionSync, type SessionSync, type SyncStatus } from '../sync/sessionSync';
import styles from './WorkoutPage.module.css';

const UI_REFRESH_MS = 250; // per-frame data reaches React at 4 Hz, never per frame (§14)
const CUE_VISIBLE_MS = 2500; // §8.9
const LOG_LIMIT = 12;
/** Setup checks must pass continuously this long before the countdown starts by itself. */
const AUTO_START_AFTER_MS = 1000;
const COUNTDOWN_FROM = 3;

type Phase = 'setup' | 'countdown' | 'live' | 'saving' | 'done';
type Tone = 'info' | 'ok' | 'warn' | 'error';

type LogEntry =
  | { kind: 'rep'; rep: CompletedRep; good: boolean }
  | { kind: 'rejected'; reason: RejectReason; cue: ErrorCode | null };

const REJECT_TEXT: Record<RejectReason, string> = {
  partial: 'not counted — end position not reached',
  too_short: 'not counted — too quick (< 600 ms)',
  too_long: 'not counted — took longer than 8 s',
  lost_tracking: 'not counted — lost sight of you mid-rep',
};

/** What the user is told after a rep that did NOT count. Small partial wobbles stay silent. */
function rejectionNotice(reason: RejectReason, cue: ErrorCode | null): string | null {
  switch (reason) {
    case 'partial':
      return cue ? `Not counted — ${CUE_TEXT[cue]}` : null;
    case 'too_short':
      return 'Not counted — too fast, slow down';
    case 'too_long':
      return 'Not counted — that took too long';
    case 'lost_tracking':
      return 'Not counted — I lost sight of you';
  }
}

/** Banner when no recent event is showing. */
function statusBanner(out: AnalyzerOutput | null): { text: string; tone: Tone } {
  if (!out) return { text: 'Starting…', tone: 'info' };
  if (!out.visibilityOk) {
    return { text: out.visibilityMessage ?? "I can't see you — step into the camera view", tone: 'warn' };
  }
  if (out.positionHint) return { text: out.positionHint, tone: 'warn' };
  const s: Record<RepState, string> = {
    NOT_VISIBLE: "I can't see you — step into the camera view",
    READY: 'Hold still…',
    TOP: 'Ready — go!',
    IN_REP: 'Keep going',
  };
  return { text: s[out.state], tone: out.state === 'TOP' ? 'ok' : 'info' };
}

/** Engine rep → API payload. Engine time is performance.now()-based; convert to wall clock. */
function toRepCreate(r: CompletedRep): RepCreate {
  const clampAngle = (v: number) => Math.min(180, Math.max(0, v));
  return {
    rep_index: r.index,
    started_at: new Date(performance.timeOrigin + r.startedAtMs).toISOString(),
    duration_ms: r.durationMs,
    min_angle: clampAngle(r.minAngle),
    max_angle: clampAngle(r.maxAngle),
    score: r.score,
    errors: r.errors,
    metrics: r.metrics,
  };
}

function syncText(s: SyncStatus | null, hasUser: boolean): { text: string; tone: Tone } {
  if (!hasUser) return { text: 'Not saving — choose a user on the Home page', tone: 'warn' };
  if (!s) return { text: 'Connecting to the database…', tone: 'info' };
  if (s.retrying) {
    return { text: `Backend unreachable — ${s.pending} rep(s) waiting, retrying…`, tone: 'warn' };
  }
  if (s.failed) return { text: `Saved ${s.saved} · ${s.failed} rejected by server (${s.lastError})`, tone: 'error' };
  if (!s.sessionId) return { text: 'Creating session…', tone: 'info' };
  return { text: `Saved ${s.saved} rep${s.saved === 1 ? '' : 's'} to the database`, tone: 'ok' };
}

function initialTuning(def: ExerciseDefinition): Tuning {
  return { thresholds: { ...def.thresholds }, limits: defaultLimits(def) };
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) &&
    !(target instanceof HTMLInputElement && target.type === 'range')
  );
}

export default function WorkoutPage() {
  const { exerciseSlug = '' } = useParams();
  const definition = getExercise(exerciseSlug);
  if (!definition) {
    return (
      <section>
        <h1>Unknown exercise</h1>
        <p>“{exerciseSlug}” is not one of the supported exercises.</p>
        <Link to="/">Back to exercises</Link>
      </section>
    );
  }
  return <Workout key={definition.slug} definition={definition} />;
}

/** DEV only: ?replay=<scenario> feeds synthetic frames instead of the camera (src/dev/replay.ts). */
const REPLAY = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('replay') : null;

function Workout({ definition }: { definition: ExerciseDefinition }) {
  const { videoRef, state: realCamera, retry } = useCamera(!REPLAY);
  const camera = REPLAY ? ({ status: 'ready', width: 1280, height: 720 } as const) : realCamera;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const navigate = useNavigate();
  const { user } = useUser();
  const [phase, setPhase] = useState<Phase>('setup');
  const phaseRef = useRef<Phase>('setup');
  phaseRef.current = phase;

  // --- tuning → analyzer -------------------------------------------------------
  const [tuning, setTuning] = useState<Tuning>(() => initialTuning(definition));
  const [tuningError, setTuningError] = useState<string | null>(null);
  const analyzerRef = useRef<Analyzer>(createAnalyzer(definition));
  const logRef = useRef<LogEntry[]>([]);
  const cueRef = useRef<{ code: ErrorCode; atMs: number } | null>(null);
  // Latest event message (cue, counted rep, rejected rep), shown for CUE_VISIBLE_MS.
  const noticeRef = useRef<{ text: string; tone: Tone; atMs: number } | null>(null);

  // Counted separately: the log only keeps the last LOG_LIMIT entries.
  const goodCountRef = useRef(0);

  const clearSetState = useCallback(() => {
    goodCountRef.current = 0;
    logRef.current = [];
    cueRef.current = null;
    noticeRef.current = null;
  }, []);

  useEffect(() => {
    try {
      validateThresholds(tuning.thresholds);
    } catch (err) {
      setTuningError(err instanceof Error ? err.message : String(err));
      return; // keep the previous, valid analyzer
    }
    setTuningError(null);
    analyzerRef.current = createAnalyzer(definition, tuning);
    clearSetState();
  }, [definition, tuning, clearSetState]);

  // --- persistence ----------------------------------------------------------------
  const syncRef = useRef<SessionSync | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const startSync = useCallback(() => {
    syncRef.current?.dispose();
    syncRef.current = null;
    setSyncStatus(null);
    setSaveError(null);
    if (!user) return;
    const sync = createSessionSync(
      {
        createSession: () => api.createSession(user.id, definition.slug),
        addRep: (sessionId, rep) => api.addRep(sessionId, rep),
        finishSession: (sessionId, endedAt) => api.finishSession(sessionId, endedAt),
      },
      { onChange: setSyncStatus },
    );
    syncRef.current = sync;
    sync.start();
  }, [user, definition.slug]);

  useEffect(() => () => syncRef.current?.dispose(), []);

  // Warn before closing the tab while a set is running or reps are unsaved.
  useEffect(() => {
    const active = phase === 'live' || phase === 'saving' || (syncStatus?.pending ?? 0) > 0;
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [phase, syncStatus?.pending]);

  // --- per-frame processing (refs only) -----------------------------------------
  const lastFrameRef = useRef<PoseFrame | null>(null);
  const lastOutRef = useRef<AnalyzerOutput | null>(null);
  const framesRef = useRef(0);
  const fpsRef = useRef({ fps: 0, windowStart: 0, windowFrames: 0 });

  const onFrame = useCallback(
    (frame: PoseFrame) => {
      lastFrameRef.current = frame;
      framesRef.current += 1;
      const f = fpsRef.current;
      f.windowFrames += 1;
      if (frame.timestampMs - f.windowStart >= 1000) {
        f.fps = (f.windowFrames * 1000) / (frame.timestampMs - f.windowStart || 1);
        f.windowStart = frame.timestampMs;
        f.windowFrames = 0;
      }
      const out = analyzerRef.current.processFrame(frame.landmarks, frame.videoWidth, frame.videoHeight, frame.timestampMs);
      lastOutRef.current = out;
      const live = phaseRef.current === 'live';
      const now = frame.timestampMs;

      // Reps and cues only count during the live phase; setup/countdown only check position.
      if (live) {
        if (out.liveCue) {
          cueRef.current = { code: out.liveCue, atMs: now };
          noticeRef.current = { text: CUE_TEXT[out.liveCue], tone: 'error', atMs: now };
        }
        if (out.completedRep) {
          const r = out.completedRep;
          noticeRef.current = r.errors.length
            ? { text: `Rep ${r.index} — ${CUE_TEXT[r.errors[0]]}`, tone: 'warn', atMs: now }
            : { text: `Rep ${r.index} counted`, tone: 'ok', atMs: now };
          const good = isGoodRep(r.score, r.errors);
          if (good) goodCountRef.current += 1;
          logRef.current = [{ kind: 'rep' as const, rep: r, good }, ...logRef.current].slice(0, LOG_LIMIT);
          // Saved immediately (retried until the backend accepts it).
          syncRef.current?.enqueue(toRepCreate(r));
        }
        if (out.rejectedRep) {
          const text = rejectionNotice(out.rejectedRep.reason, out.rejectedRep.cue);
          if (text) noticeRef.current = { text, tone: 'error', atMs: now };
          logRef.current = [{ kind: 'rejected' as const, reason: out.rejectedRep.reason, cue: out.rejectedRep.cue }, ...logRef.current].slice(0, LOG_LIMIT);
        }
      }

      const cueActive = live && cueRef.current !== null && now - cueRef.current.atMs < CUE_VISIBLE_MS;
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) drawSkeleton(ctx, frame.landmarks, { activeJoints: new Set(definition.requiredLandmarks(out.side)), cueActive });

      if (import.meta.env.DEV) {
        // Lets automated browser checks read the latest frame and engine output. Dev only.
        const w = window as unknown as { __formcoachLastFrame?: PoseFrame; __formcoachLastOut?: AnalyzerOutput };
        w.__formcoachLastFrame = frame;
        w.__formcoachLastOut = out;
      }
    },
    [definition],
  );

  const { model: realModel } = usePoseLandmarker(
    videoRef,
    !REPLAY && camera.status === 'ready' && (phase === 'setup' || phase === 'countdown' || phase === 'live'),
    onFrame,
    !REPLAY,
  );
  const model = REPLAY ? ({ status: 'ready', delegate: 'GPU' } as const) : realModel;

  useEffect(() => {
    if (!REPLAY || phase === 'done' || phase === 'saving') return;
    let handle: { stop(): void } | null = null;
    let cancelled = false;
    void import('../dev/replay').then(({ startReplay }) => {
      if (!cancelled) handle = startReplay(REPLAY, onFrame);
    });
    return () => {
      cancelled = true;
      handle?.stop();
    };
  }, [phase, onFrame]);

  // --- UI snapshot at 4 Hz ---------------------------------------------------------
  const [ui, setUi] = useState<{
    out: AnalyzerOutput | null;
    notice: { text: string; tone: Tone } | null;
    log: LogEntry[];
    goodReps: number;
    debug: DebugInfo | null;
  }>({ out: null, notice: null, log: [], goodReps: 0, debug: null });

  useEffect(() => {
    if (model.status !== 'ready') return;
    const id = setInterval(() => {
      const f = lastFrameRef.current;
      const notice = noticeRef.current;
      const now = f?.timestampMs ?? 0;
      setUi({
        out: lastOutRef.current,
        notice: notice && now - notice.atMs < CUE_VISIBLE_MS ? { text: notice.text, tone: notice.tone } : null,
        log: logRef.current,
        goodReps: goodCountRef.current,
        debug: {
          fps: fpsRef.current.fps,
          delegate: model.delegate,
          frames: framesRef.current,
          videoWidth: f?.videoWidth ?? 0,
          videoHeight: f?.videoHeight ?? 0,
          landmarks: f?.landmarks ?? null,
          engine: lastOutRef.current,
        },
      });
    }, UI_REFRESH_MS);
    return () => clearInterval(id);
  }, [model]);

  // --- setup checks → auto countdown → live -----------------------------------------
  const checks = {
    camera: camera.status === 'ready',
    model: model.status === 'ready',
    visible: ui.out?.visibilityOk ?? false,
    orientation: (ui.out?.visibilityOk ?? false) && (ui.out?.orientationOk ?? false),
  };
  const setupReady = checks.camera && checks.model && checks.visible && checks.orientation;

  const readySinceRef = useRef<number | null>(null);
  useEffect(() => {
    if (phase !== 'setup') return;
    if (!setupReady) {
      readySinceRef.current = null;
      return;
    }
    readySinceRef.current ??= performance.now();
    if (performance.now() - readySinceRef.current >= AUTO_START_AFTER_MS) setPhase('countdown');
  }, [phase, setupReady, ui]);

  const [count, setCount] = useState(COUNTDOWN_FROM);
  useEffect(() => {
    if (phase !== 'countdown') return;
    setCount(COUNTDOWN_FROM);
    let n = COUNTDOWN_FROM;
    const id = setInterval(() => {
      n -= 1;
      if (n > 0) {
        setCount(n);
      } else {
        clearInterval(id);
        // Fresh set: counting starts now (the user must hold the start position again).
        analyzerRef.current.reset();
        clearSetState();
        startSync();
        setPhase('live');
      }
    }, 1000);
    return () => clearInterval(id);
  }, [phase, clearSetState, startSync]);

  // Walking out of view during the countdown cancels it.
  useEffect(() => {
    if (phase === 'countdown' && ui.out && (!ui.out.visibilityOk || !ui.out.orientationOk)) setPhase('setup');
  }, [phase, ui.out]);

  const finish = async () => {
    const sync = syncRef.current;
    if (!sync) {
      setPhase('done'); // nothing to save (no user selected)
      return;
    }
    setPhase('saving');
    setSaveError(null);
    try {
      const sessionId = await sync.finish(new Date().toISOString());
      navigate(`/sessions/${sessionId}`);
    } catch (err) {
      setSaveError(
        err instanceof FinishTimeoutError
          ? err.message
          : `Could not finish the session: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const discardSet = () => {
    syncRef.current?.dispose();
    syncRef.current = null;
    setSyncStatus(null);
    setSaveError(null);
    setPhase('done');
  };

  // --- debug panel toggle ---------------------------------------------------------
  const [showDebug, setShowDebug] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'd' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target)) {
        setShowDebug((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const goodReps = ui.goodReps;
  const inSet = phase === 'live' || phase === 'saving' || phase === 'done';
  const repCount = inSet ? (ui.out?.repCount ?? 0) : 0;
  const sync = syncText(syncStatus, Boolean(user));
  const width = camera.status === 'ready' ? camera.width : 1280;
  const height = camera.status === 'ready' ? camera.height : 720;
  const banner = ui.notice ?? statusBanner(ui.out);
  const showHold = !ui.notice && ui.out?.state === 'READY' && ui.out.visibilityOk && !ui.out.positionHint;

  // Overlays must not hide joints the exercise needs: if it needs the ankles (squat), put
  // messages at the top of the video; otherwise (curl, press — hands go up high) at the bottom.
  const needsFeet = [LM.LEFT_ANKLE, LM.RIGHT_ANKLE].some((i) =>
    [...definition.requiredLandmarks('left'), ...definition.requiredLandmarks('right')].includes(i),
  );
  const overlayPos = needsFeet ? styles.overlayTop : styles.overlayBottom;

  // First unmet setup check, shown big on the video so it's readable from 2–3 m away.
  const setupMessage = !checks.camera
    ? camera.status === 'requesting'
      ? 'Allow camera access'
      : null
    : !checks.model
      ? 'Loading pose model…'
      : !checks.visible
        ? (ui.out?.visibilityMessage ?? 'Step into the camera view')
        : !checks.orientation
          ? (ui.out?.orientationHint ?? (definition.cameraView === 'side' ? 'Turn sideways to the camera' : 'Face the camera'))
          : 'Hold still — starting…';

  return (
    <section className={styles.page} data-phase={phase}>
      <header className={styles.top}>
        <Link to="/" className={styles.back}>
          ← Exercises
        </Link>
        <h1>{definition.name}</h1>
        <span className={styles.viewTag}>{definition.cameraView === 'side' ? 'Side view' : 'Front view'}</span>
        <p className={styles.instructions} title={definition.setupInstructions}>
          {definition.setupInstructions}
        </p>
      </header>

      {camera.status === 'error' ? (
        <CameraError kind={camera.kind} detail={camera.detail} onRetry={retry} />
      ) : (
        <div className={styles.layout}>
          <div className={styles.stageArea}>
            <div className={styles.stageBox} style={{ aspectRatio: `${width} / ${height}` }}>
              <VideoCanvas ref={canvasRef} videoRef={videoRef} width={width} height={height} />

              {phase === 'setup' && (
                <div className={`${styles.overlay} ${overlayPos} ${setupReady ? styles.ok : styles.warn}`} data-setup-overlay>
                  {setupMessage}
                </div>
              )}
              {phase === 'countdown' && (
                <div className={styles.countdown} data-countdown aria-live="assertive">
                  {count}
                </div>
              )}
              {phase === 'live' && (
                <div className={`${styles.overlay} ${overlayPos} ${styles[banner.tone]}`} data-banner data-tone={banner.tone} role="status">
                  {banner.text}
                  {showHold && (
                    <span className={styles.holdTrack} aria-hidden>
                      <span className={styles.holdFill} style={{ width: `${(ui.out?.holdProgress ?? 0) * 100}%` }} />
                    </span>
                  )}
                </div>
              )}
              {model.status === 'error' && (
                <div className={`${styles.overlay} ${overlayPos} ${styles.error}`}>Pose detection unavailable: {model.detail}</div>
              )}
            </div>
          </div>

          <aside className={styles.side}>
            {phase === 'setup' && (
              <div className={styles.card} data-setup>
                <h2>Get into position</h2>
                <ul className={styles.checklist}>
                  <Check ok={checks.camera} label={camera.status === 'requesting' ? 'Waiting for camera permission…' : 'Camera on'} />
                  <Check ok={checks.model} label={model.status === 'loading' ? 'Loading pose model…' : 'Pose model ready'} />
                  <Check ok={checks.visible} label="Whole body visible" />
                  <Check
                    ok={checks.orientation}
                    label={definition.cameraView === 'side' ? 'Standing sideways' : 'Facing the camera'}
                  />
                </ul>
                <p className={setupReady ? styles.readyText : styles.muted} data-setup-status>
                  {setupReady ? 'Ready — starting…' : 'The countdown starts by itself once everything is green.'}
                </p>
                <button type="button" className="btn btn-primary" disabled={!setupReady} onClick={() => setPhase('countdown')}>
                  Start now
                </button>
              </div>
            )}

            {phase === 'countdown' && (
              <div className={styles.card}>
                <h2>Get ready</h2>
                <p className={styles.muted}>{definition.startHint}.</p>
              </div>
            )}

            {inSet && (
              <>
                <div className={styles.counters}>
                  <div className={styles.counter}>
                    <span className={styles.counterValue} data-rep-count>
                      {repCount}
                    </span>
                    <span className={styles.counterLabel}>Reps</span>
                  </div>
                  <div className={styles.counter}>
                    <span className={`${styles.counterValue} ${styles.good}`} data-good-count>
                      {goodReps}
                    </span>
                    <span className={styles.counterLabel}>Good</span>
                  </div>
                </div>

                <AngleGauge
                  angle={ui.out?.primaryAngle ?? null}
                  startThreshold={analyzerRef.current.thresholds.startThreshold}
                  endThreshold={analyzerRef.current.thresholds.endThreshold}
                  label={definition.primaryAngleLabel}
                />

                {phase === 'live' && (
                  <button type="button" className={`btn btn-primary ${styles.finish}`} onClick={() => void finish()} data-finish>
                    Finish set
                  </button>
                )}
                {(phase === 'live' || phase === 'saving') && (
                  <p className={`${styles.syncLine} ${styles[sync.tone]}`} data-sync-status data-tone={sync.tone}>
                    <span className={styles.syncDot} aria-hidden />
                    {sync.text}
                  </p>
                )}
                {phase === 'saving' && (
                  <div className={styles.card} data-saving>
                    <h2>{saveError ? 'Not saved yet' : 'Saving…'}</h2>
                    {saveError ? (
                      <>
                        <p className={styles.errorText}>{saveError}</p>
                        <div className={styles.row}>
                          <button type="button" className="btn btn-primary" onClick={() => void finish()}>
                            Keep trying
                          </button>
                          <button type="button" className="btn btn-secondary" onClick={discardSet}>
                            Discard set
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className={styles.muted}>Waiting for every rep to reach the database.</p>
                    )}
                  </div>
                )}
                {phase === 'done' && (
                  <div className={styles.card} data-done>
                    <h2>Set finished</h2>
                    <p className={styles.muted}>This set was not saved (no user selected).</p>
                    <div className={styles.row}>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => {
                          clearSetState();
                          setPhase('setup');
                        }}
                      >
                        New set
                      </button>
                      <Link className="btn btn-secondary" to="/">
                        Done
                      </Link>
                    </div>
                  </div>
                )}

                <div className={`${styles.card} ${styles.logCard}`} aria-label="Rep log">
                  <h2>Rep log</h2>
                  {ui.log.length === 0 && <p className={styles.muted}>Counted and rejected reps appear here.</p>}
                  <ol className={styles.logList} data-rep-log>
                    {ui.log.map((e, i) =>
                      e.kind === 'rep' ? (
                        <li key={i} className={styles.logItem}>
                          <span className={`${styles.logBadge} ${e.good ? styles.badgeGood : styles.badgeWarn}`}>#{e.rep.index}</span>
                          <span className={styles.logBody}>
                            <span>
                              Score <strong>{e.rep.score}</strong>
                              {e.rep.errors.length > 0 && ` · ${e.rep.errors.map((c) => CUE_TEXT[c]).join(', ')}`}
                            </span>
                            <span className={styles.logMeta}>
                              {e.rep.minAngle.toFixed(0)}–{e.rep.maxAngle.toFixed(0)}° · {(e.rep.durationMs / 1000).toFixed(1)} s
                            </span>
                          </span>
                        </li>
                      ) : (
                        <li key={i} className={styles.logItem}>
                          <span className={`${styles.logBadge} ${styles.badgeRejected}`}>✕</span>
                          <span className={styles.logBody}>
                            <span className={styles.muted}>{REJECT_TEXT[e.reason]}</span>
                            {e.cue && <span className={styles.logMeta}>“{CUE_TEXT[e.cue]}”</span>}
                          </span>
                        </li>
                      ),
                    )}
                  </ol>
                </div>
              </>
            )}
            <p className={styles.hint}>
              <kbd>D</kbd> debug &amp; tuning panel
            </p>
          </aside>
        </div>
      )}

      {showDebug && ui.debug && (
        <DebugPanel
          info={ui.debug}
          definition={definition}
          tuning={tuning}
          tuningError={tuningError}
          onTuningChange={setTuning}
          onResetTuning={() => setTuning(initialTuning(definition))}
          onClose={() => setShowDebug(false)}
        />
      )}
    </section>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className={ok ? styles.checkOk : styles.checkPending} data-check={ok ? 'ok' : 'pending'}>
      <span className={styles.checkIcon} aria-hidden>
        {ok ? '✓' : '•'}
      </span>
      {label}
    </li>
  );
}
