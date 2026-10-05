import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { CameraError } from '../components/CameraError';
import { DebugPanel, type DebugInfo, type Tuning } from '../components/DebugPanel';
import { drawSkeleton } from '../components/skeleton';
import { VideoCanvas } from '../components/VideoCanvas';
import { createAnalyzer, type Analyzer, type AnalyzerOutput } from '../engine/analyzer';
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

type LogEntry =
  | { kind: 'rep'; index: number; score: number; errors: string[]; minAngle: number; maxAngle: number; durationMs: number; good: boolean }
  | { kind: 'rejected'; reason: RejectReason; cue: ErrorCode | null };

const REJECT_TEXT: Record<RejectReason, string> = {
  partial: 'not counted — end position not reached',
  too_short: 'not counted — too quick (< 600 ms)',
  too_long: 'not counted — took longer than 8 s',
  lost_tracking: 'not counted — lost sight of you mid-rep',
};

type Tone = 'info' | 'ok' | 'warn' | 'error';

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

// Live engine on the camera feed. The full workout flow (setup, countdown, saving) is T-25/T-26.
export default function WorkoutPage() {
  const { exerciseSlug = '' } = useParams();
  const definition = getExercise(exerciseSlug);
  if (!definition) {
    return (
      <section>
        <h1>Unknown exercise</h1>
        <p>“{exerciseSlug}” is not one of the supported exercises.</p>
      </section>
    );
  }
  return <Workout key={definition.slug} definition={definition} />;
}

function Workout({ definition }: { definition: ExerciseDefinition }) {
  const { videoRef, state: camera, retry } = useCamera();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // --- tuning → analyzer -------------------------------------------------------
  const [tuning, setTuning] = useState<Tuning>(() => initialTuning(definition));
  const [tuningError, setTuningError] = useState<string | null>(null);
  const analyzerRef = useRef<Analyzer>(createAnalyzer(definition));
  const logRef = useRef<LogEntry[]>([]);
  const cueRef = useRef<{ code: ErrorCode; atMs: number } | null>(null);
  // Latest event message (cue, counted rep, rejected rep), shown for CUE_VISIBLE_MS.
  const noticeRef = useRef<{ text: string; tone: Tone; atMs: number } | null>(null);

  useEffect(() => {
    try {
      validateThresholds(tuning.thresholds);
    } catch (err) {
      setTuningError(err instanceof Error ? err.message : String(err));
      return; // keep the previous, valid analyzer
    }
    setTuningError(null);
    analyzerRef.current = createAnalyzer(definition, tuning);
    logRef.current = [];
    cueRef.current = null;
    noticeRef.current = null;
  }, [definition, tuning]);

  // --- per-frame processing (refs only) -----------------------------------------
  const lastFrameRef = useRef<PoseFrame | null>(null);
  const lastOutRef = useRef<AnalyzerOutput | null>(null);
  const framesRef = useRef(0);

  const onFrame = useCallback(
    (frame: PoseFrame) => {
      lastFrameRef.current = frame;
      framesRef.current += 1;
      const out = analyzerRef.current.processFrame(
        frame.landmarks,
        frame.videoWidth,
        frame.videoHeight,
        frame.timestampMs,
      );
      lastOutRef.current = out;

      const now = frame.timestampMs;
      if (out.liveCue) {
        cueRef.current = { code: out.liveCue, atMs: now };
        noticeRef.current = { text: CUE_TEXT[out.liveCue], tone: 'error', atMs: now };
      }
      if (out.completedRep) {
        const r = out.completedRep;
        noticeRef.current = r.errors.length
          ? { text: `Rep ${r.index} — ${CUE_TEXT[r.errors[0]]}`, tone: 'warn', atMs: now }
          : { text: `Rep ${r.index} counted`, tone: 'ok', atMs: now };
        logRef.current = [
          { kind: 'rep' as const, index: r.index, score: r.score, errors: r.errors, minAngle: r.minAngle, maxAngle: r.maxAngle, durationMs: r.durationMs, good: isGoodRep(r.score, r.errors) },
          ...logRef.current,
        ].slice(0, LOG_LIMIT);
      }
      if (out.rejectedRep) {
        const text = rejectionNotice(out.rejectedRep.reason, out.rejectedRep.cue);
        if (text) noticeRef.current = { text, tone: 'error', atMs: now };
        logRef.current = [
          { kind: 'rejected' as const, reason: out.rejectedRep.reason, cue: out.rejectedRep.cue },
          ...logRef.current,
        ].slice(0, LOG_LIMIT);
      }

      const cueActive = cueRef.current !== null && frame.timestampMs - cueRef.current.atMs < CUE_VISIBLE_MS;
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) {
        drawSkeleton(ctx, frame.landmarks, {
          activeJoints: new Set(definition.requiredLandmarks(out.side)),
          cueActive,
        });
      }
      if (import.meta.env.DEV) {
        // Lets automated browser checks read the latest frame and engine output. Dev only.
        const w = window as unknown as { __formcoachLastFrame?: PoseFrame; __formcoachLastOut?: AnalyzerOutput };
        w.__formcoachLastFrame = frame;
        w.__formcoachLastOut = out;
      }
    },
    [definition],
  );

  const { model, fpsRef } = usePoseLandmarker(videoRef, camera.status === 'ready', onFrame);

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

  const resetCounter = () => {
    analyzerRef.current.reset();
    logRef.current = [];
    cueRef.current = null;
    noticeRef.current = null;
  };

  const banner = ui.notice ?? statusBanner(ui.out);
  const showHold = !ui.notice && ui.out?.state === 'READY' && ui.out.visibilityOk && !ui.out.positionHint;

  const goodReps = useMemo(() => ui.log.filter((e) => e.kind === 'rep' && e.good).length, [ui.log]);
  const width = camera.status === 'ready' ? camera.width : 1280;
  const height = camera.status === 'ready' ? camera.height : 720;

  return (
    <section className={styles.page}>
      <header className={styles.top}>
        <div>
          <h1>{definition.name}</h1>
          <p className={styles.instructions}>{definition.setupInstructions}</p>
        </div>
        <div className={styles.counters}>
          <div className={styles.counter}>
            <span className={styles.counterValue} data-rep-count>
              {ui.out?.repCount ?? 0}
            </span>
            <span className={styles.counterLabel}>reps</span>
          </div>
          <div className={styles.counter}>
            <span className={`${styles.counterValue} ${styles.good}`}>{goodReps}</span>
            <span className={styles.counterLabel}>good</span>
          </div>
        </div>
      </header>

      {camera.status === 'error' && <CameraError kind={camera.kind} detail={camera.detail} onRetry={retry} />}
      {camera.status === 'requesting' && <p>Waiting for camera permission…</p>}

      <div className={styles.main}>
        <div className={styles.videoCol}>
          <VideoCanvas ref={canvasRef} videoRef={videoRef} width={width} height={height} hidden={camera.status === 'error'} />
          <div className={`${styles.banner} ${styles[banner.tone]}`} data-banner data-tone={banner.tone} role="status">
            {banner.text}
            {showHold && (
              <span className={styles.holdTrack} aria-hidden>
                <span className={styles.holdFill} style={{ width: `${(ui.out?.holdProgress ?? 0) * 100}%` }} />
              </span>
            )}
          </div>
          <p className={styles.meta} data-pose-status={model.status}>
            {model.status === 'loading' && 'Loading pose model…'}
            {model.status === 'error' && `Pose detection unavailable: ${model.detail}`}
            {model.status === 'ready' && 'Press D for the debug and tuning panel'}
          </p>
        </div>

        <aside className={styles.log} aria-label="Rep log">
          <div className={styles.logHeader}>
            <h2>Rep log</h2>
            <button type="button" onClick={resetCounter}>
              Reset
            </button>
          </div>
          {ui.log.length === 0 && <p className={styles.muted}>Completed and rejected reps appear here.</p>}
          <ol className={styles.logList} data-rep-log>
            {ui.log.map((e, i) =>
              e.kind === 'rep' ? (
                <li key={i} className={e.good ? styles.logGood : styles.logBad}>
                  <strong>#{e.index}</strong> score {e.score}
                  {e.errors.length > 0 && ` · ${e.errors.map((c) => CUE_TEXT[c as ErrorCode]).join(', ')}`}
                  <span className={styles.muted}>
                    {' '}
                    · {e.minAngle.toFixed(0)}–{e.maxAngle.toFixed(0)}° · {(e.durationMs / 1000).toFixed(1)} s
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
