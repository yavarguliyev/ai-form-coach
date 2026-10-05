import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { CameraError } from '../components/CameraError';
import { DebugPanel, type DebugInfo } from '../components/DebugPanel';
import { drawSkeleton } from '../components/skeleton';
import { VideoCanvas } from '../components/VideoCanvas';
import { LM } from '../engine/landmarks';
import { useCamera } from '../pose/useCamera';
import { usePoseLandmarker, type PoseFrame } from '../pose/usePoseLandmarker';
import styles from './WorkoutPage.module.css';

const UI_REFRESH_MS = 250; // per-frame numbers reach React at 4 Hz, never per frame (§14)
const LOG_EVERY_MS = 1000;

// Joints highlighted per exercise. Both sides for now; the engine picks one side (T-15) and
// the exercise definitions (T-20..22) will provide this list.
const ACTIVE_JOINTS: Record<string, ReadonlySet<number>> = {
  squat: new Set([LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_HIP, LM.RIGHT_HIP, LM.LEFT_KNEE, LM.RIGHT_KNEE, LM.LEFT_ANKLE, LM.RIGHT_ANKLE]),
  bicep_curl: new Set([LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_ELBOW, LM.RIGHT_ELBOW, LM.LEFT_WRIST, LM.RIGHT_WRIST, LM.LEFT_HIP, LM.RIGHT_HIP]),
  shoulder_press: new Set([LM.NOSE, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_ELBOW, LM.RIGHT_ELBOW, LM.LEFT_WRIST, LM.RIGHT_WRIST]),
};
const NO_JOINTS: ReadonlySet<number> = new Set();

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

// Camera + pose + overlay for now; the workout flow (T-25) builds on it.
export default function WorkoutPage() {
  const { exerciseSlug = '' } = useParams();
  const activeJoints = ACTIVE_JOINTS[exerciseSlug] ?? NO_JOINTS;
  const { videoRef, state: camera, retry } = useCamera();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastFrameRef = useRef<PoseFrame | null>(null);
  const framesRef = useRef(0);
  const lastLogRef = useRef(0);

  const onFrame = useCallback(
    (frame: PoseFrame) => {
      lastFrameRef.current = frame;
      framesRef.current += 1;
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) drawSkeleton(ctx, frame.landmarks, { activeJoints, cueActive: false });

      if (frame.timestampMs - lastLogRef.current >= LOG_EVERY_MS) {
        lastLogRef.current = frame.timestampMs;
        console.debug('[pose]', framesRef.current, 'frames; landmarks:', frame.landmarks);
      }
      if (import.meta.env.DEV) {
        // Lets automated browser checks read the latest frame. Dev builds only.
        (window as unknown as { __formcoachLastFrame?: PoseFrame }).__formcoachLastFrame = frame;
      }
    },
    [activeJoints],
  );

  const { model, fpsRef } = usePoseLandmarker(videoRef, camera.status === 'ready', onFrame);

  // Debug panel toggled with "D".
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

  const [debug, setDebug] = useState<DebugInfo | null>(null);
  useEffect(() => {
    if (model.status !== 'ready') return;
    const id = setInterval(() => {
      const f = lastFrameRef.current;
      setDebug({
        fps: fpsRef.current,
        delegate: model.delegate,
        frames: framesRef.current,
        videoWidth: f?.videoWidth ?? 0,
        videoHeight: f?.videoHeight ?? 0,
        landmarks: f?.landmarks ?? null,
      });
    }, UI_REFRESH_MS);
    return () => clearInterval(id);
  }, [model, fpsRef]);

  const width = camera.status === 'ready' ? camera.width : 1280;
  const height = camera.status === 'ready' ? camera.height : 720;

  return (
    <section>
      <h1>Workout</h1>
      {camera.status === 'error' && (
        <CameraError kind={camera.kind} detail={camera.detail} onRetry={retry} />
      )}
      {camera.status === 'requesting' && <p>Waiting for camera permission…</p>}
      <VideoCanvas
        ref={canvasRef}
        videoRef={videoRef}
        width={width}
        height={height}
        hidden={camera.status === 'error'}
      />
      <p className={styles.meta} data-pose-status={model.status}>
        {model.status === 'loading' && 'Loading pose model…'}
        {model.status === 'error' && `Pose detection unavailable: ${model.detail}`}
        {model.status === 'ready' && 'Pose detection running · press D for the debug panel'}
      </p>
      {showDebug && debug && <DebugPanel info={debug} />}
    </section>
  );
}
