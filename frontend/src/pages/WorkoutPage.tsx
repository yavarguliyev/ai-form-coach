import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { AngleGauge } from '../components/AngleGauge';
import { CameraError } from '../components/CameraError';
import { DebugPanel, type DebugInfo, type Tuning } from '../components/DebugPanel';
import { drawSkeleton } from '../components/skeleton';
import { VideoCanvas } from '../components/VideoCanvas';
import { createAnalyzer, type Analyzer, type AnalyzerOutput, type CompletedRep } from '../engine/analyzer';
import { CUE_TEXT, type ErrorCode } from '../engine/errorCodes';
import { getExercise } from '../engine/exercises';
import { defaultLimits, type ExerciseDefinition } from '../engine/exercises/types';
import { validateThresholds, type RejectReason, type RepState } from '../engine/repCounter';
import { isGoodRep } from '../engine/scoring';
import { useCamera } from '../pose/useCamera';
import { usePoseLandmarker, type PoseFrame } from '../pose/usePoseLandmarker';
import styles from './WorkoutPage.module.css';

const UI_REFRESH_MS = 250; // per-frame data reaches React at 4 Hz, never per frame (§14)
const CUE_VISIBLE_MS = 2500; // §8.9
const LOG_LIMIT = 12;
/** Setup checks must pass continuously this long before the countdown starts by itself. */
const AUTO_START_AFTER_MS = 1000;
const COUNTDOWN_FROM = 3;

type Phase = 'setup' | 'countdown' | 'live' | 'done';
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

  const clearSetState = useCallback(() => {
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

  // --- per-frame processing (refs only) -----------------------------------------
  const lastFrameRef = useRef<PoseFrame | null>(null);
  const lastOutRef = useRef<AnalyzerOutput | null>(null);
  const framesRef = useRef(0);

  const onFrame = useCallback(
    (frame: PoseFrame) => {
      lastFrameRef.current = frame;
      framesRef.current += 1;
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
          logRef.current = [{ kind: 'rep' as const, rep: r, good: isGoodRep(r.score, r.errors) }, ...logRef.current].slice(0, LOG_LIMIT);
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

  const { model: realModel, fpsRef } = usePoseLandmarker(
    videoRef,
    !REPLAY && camera.status === 'ready' && phase !== 'done',
    onFrame,
    !REPLAY,
  );
  const model = REPLAY ? ({ status: 'ready', delegate: 'GPU' } as const) : realModel;

  useEffect(() => {
    if (!REPLAY || phase === 'done') return;
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
    debug: DebugInfo | null;
  }>({ out: null, notice: null, log: [], debug: null });

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
        debug: {
          fps: fpsRef.current,
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
  }, [model, fpsRef]);

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
        setPhase('live');
      }
    }, 1000);
    return () => clearInterval(id);
  }, [phase, clearSetState]);

  // Walking out of view during the countdown cancels it.
  useEffect(() => {
    if (phase === 'countdown' && ui.out && (!ui.out.visibilityOk || !ui.out.orientationOk)) setPhase('setup');
  }, [phase, ui.out]);

  const finish = () => setPhase('done');

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

  const reps = useMemo(() => ui.log.flatMap((e) => (e.kind === 'rep' ? [e] : [])), [ui.log]);
  const goodReps = reps.filter((e) => e.good).length;
  const repCount = phase === 'live' || phase === 'done' ? (ui.out?.repCount ?? 0) : 0;
  const width = camera.status === 'ready' ? camera.width : 1280;
  const height = camera.status === 'ready' ? camera.height : 720;
  const banner = ui.notice ?? statusBanner(ui.out);
  const showHold = !ui.notice && ui.out?.state === 'READY' && ui.out.visibilityOk && !ui.out.positionHint;

  return (
    <section className={styles.page} data-phase={phase}>
      <header className={styles.top}>
        <div>
          <h1>{definition.name}</h1>
          <p className={styles.instructions}>{definition.setupInstructions}</p>
        </div>
        {(phase === 'live' || phase === 'done') && (
          <div className={styles.counters}>
            <div className={styles.counter}>
              <span className={styles.counterValue} data-rep-count>
                {repCount}
              </span>
              <span className={styles.counterLabel}>reps</span>
            </div>
            <div className={styles.counter}>
              <span className={`${styles.counterValue} ${styles.good}`} data-good-count>
                {goodReps}
              </span>
              <span className={styles.counterLabel}>good</span>
            </div>
          </div>
        )}
      </header>

      {camera.status === 'error' && <CameraError kind={camera.kind} detail={camera.detail} onRetry={retry} />}

      <div className={styles.main}>
        <div className={styles.videoCol}>
          <div className={styles.stageWrap}>
            <VideoCanvas ref={canvasRef} videoRef={videoRef} width={width} height={height} hidden={camera.status === 'error'} />
            {phase === 'countdown' && (
              <div className={styles.countdown} data-countdown aria-live="assertive">
                {count}
              </div>
            )}
          </div>

          {phase === 'live' && (
            <div className={`${styles.banner} ${styles[banner.tone]}`} data-banner data-tone={banner.tone} role="status">
              {banner.text}
              {showHold && (
                <span className={styles.holdTrack} aria-hidden>
                  <span className={styles.holdFill} style={{ width: `${(ui.out?.holdProgress ?? 0) * 100}%` }} />
                </span>
              )}
            </div>
          )}
          {phase !== 'live' && model.status === 'error' && (
            <p className={styles.errorText}>Pose detection unavailable: {model.detail}</p>
          )}
        </div>

        <aside className={styles.side}>
          {phase === 'setup' && (
            <div className={styles.card} data-setup>
              <h2>Get into position</h2>
              <ul className={styles.checklist}>
                <Check ok={checks.camera} label={camera.status === 'requesting' ? 'Waiting for camera permission…' : 'Camera on'} />
                <Check ok={checks.model} label={model.status === 'loading' ? 'Loading pose model…' : 'Pose model ready'} />
                <Check
                  ok={checks.visible}
                  label={checks.visible ? 'Body visible' : (ui.out?.visibilityMessage ?? 'Step into the camera view')}
                />
                <Check
                  ok={checks.orientation}
                  label={
                    checks.orientation
                      ? definition.cameraView === 'side'
                        ? 'Standing sideways'
                        : 'Facing the camera'
                      : (ui.out?.orientationHint ?? (definition.cameraView === 'side' ? 'Turn sideways to the camera' : 'Face the camera'))
                  }
                />
              </ul>
              <p className={setupReady ? styles.readyText : styles.muted} data-setup-status>
                {setupReady ? 'Ready — starting…' : 'The countdown starts by itself once everything is green.'}
              </p>
              <button type="button" className={styles.primary} disabled={!setupReady} onClick={() => setPhase('countdown')}>
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

          {(phase === 'live' || phase === 'done') && (
            <>
              <AngleGauge
                angle={ui.out?.primaryAngle ?? null}
                startThreshold={analyzerRef.current.thresholds.startThreshold}
                endThreshold={analyzerRef.current.thresholds.endThreshold}
                label={definition.primaryAngleLabel}
              />
              {phase === 'live' && (
                <button type="button" className={`${styles.primary} ${styles.finish}`} onClick={finish} data-finish>
                  Finish set
                </button>
              )}
              {phase === 'done' && (
                <div className={styles.card} data-done>
                  <h2>Set finished</h2>
                  <p>
                    {repCount} reps · {goodReps} good
                  </p>
                  <div className={styles.row}>
                    <button
                      type="button"
                      className={styles.primary}
                      onClick={() => {
                        clearSetState();
                        setPhase('setup');
                      }}
                    >
                      New set
                    </button>
                    <Link className={styles.secondary} to="/">
                      Done
                    </Link>
                  </div>
                </div>
              )}
              <div className={styles.card} aria-label="Rep log">
                <h2>Rep log</h2>
                {ui.log.length === 0 && <p className={styles.muted}>Counted and rejected reps appear here.</p>}
                <ol className={styles.logList} data-rep-log>
                  {ui.log.map((e, i) =>
                    e.kind === 'rep' ? (
                      <li key={i} className={e.good ? styles.logGood : styles.logBad}>
                        <strong>#{e.rep.index}</strong> score {e.rep.score}
                        {e.rep.errors.length > 0 && ` · ${e.rep.errors.map((c) => CUE_TEXT[c]).join(', ')}`}
                        <span className={styles.muted}>
                          {' '}
                          · {e.rep.minAngle.toFixed(0)}–{e.rep.maxAngle.toFixed(0)}° · {(e.rep.durationMs / 1000).toFixed(1)} s
                        </span>
                      </li>
                    ) : (
                      <li key={i} className={styles.logRejected}>
                        {REJECT_TEXT[e.reason]}
                        {e.cue && ` · “${CUE_TEXT[e.cue]}”`}
                      </li>
                    ),
                  )}
                </ol>
              </div>
            </>
          )}
          <p className={styles.muted}>Press D for the debug and tuning panel.</p>
        </aside>
      </div>

      {showDebug && ui.debug && (
        <DebugPanel
          info={ui.debug}
          definition={definition}
          tuning={tuning}
          tuningError={tuningError}
          onTuningChange={setTuning}
          onResetTuning={() => setTuning(initialTuning(definition))}
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
