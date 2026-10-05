import { useCallback, useEffect, useRef, useState } from 'react';
import { CameraError } from '../components/CameraError';
import { useCamera } from '../pose/useCamera';
import { usePoseLandmarker, type PoseFrame } from '../pose/usePoseLandmarker';
import styles from './WorkoutPage.module.css';

const STATS_REFRESH_MS = 250; // UI refresh rate for per-frame numbers (don't re-render per frame)
const LOG_EVERY_MS = 1000;

interface LiveStats {
  fps: number;
  frames: number;
  landmarks: number;
  minVisibility: number | null;
}

// Camera + pose detection only for now; overlay (T-13) and workout flow (T-25) build on it.
export default function WorkoutPage() {
  const { videoRef, state: camera, retry } = useCamera();
  const lastFrameRef = useRef<PoseFrame | null>(null);
  const framesRef = useRef(0);
  const lastLogRef = useRef(0);

  const onFrame = useCallback((frame: PoseFrame) => {
    lastFrameRef.current = frame;
    framesRef.current += 1;
    if (import.meta.env.DEV) {
      // Lets automated browser checks read the latest frame. Dev builds only.
      (window as unknown as { __formcoachLastFrame?: PoseFrame }).__formcoachLastFrame = frame;
    }
    if (frame.timestampMs - lastLogRef.current >= LOG_EVERY_MS) {
      lastLogRef.current = frame.timestampMs;
      console.debug('[pose]', framesRef.current, 'frames; landmarks:', frame.landmarks);
    }
  }, []);

  const { model, fpsRef } = usePoseLandmarker(videoRef, camera.status === 'ready', onFrame);

  const [stats, setStats] = useState<LiveStats | null>(null);
  useEffect(() => {
    if (model.status !== 'ready') return;
    const id = setInterval(() => {
      const lm = lastFrameRef.current?.landmarks;
      setStats({
        fps: fpsRef.current,
        frames: framesRef.current,
        landmarks: lm?.length ?? 0,
        minVisibility: lm ? Math.min(...lm.map((p) => p.visibility)) : null,
      });
    }, STATS_REFRESH_MS);
    return () => clearInterval(id);
  }, [model.status, fpsRef]);

  return (
    <section>
      <h1>Workout</h1>
      {camera.status === 'error' && (
        <CameraError kind={camera.kind} detail={camera.detail} onRetry={retry} />
      )}
      {camera.status === 'requesting' && <p>Waiting for camera permission…</p>}
      <div className={styles.stage} hidden={camera.status === 'error'}>
        {/* Mirrored for display only — never mirror coordinates used for math (§8.1). */}
        <video ref={videoRef} className={styles.video} playsInline muted />
      </div>
      <p className={styles.meta} data-pose-status={model.status}>
        {camera.status === 'ready' && `Camera: ${camera.width}×${camera.height} · `}
        {model.status === 'loading' && 'Loading pose model…'}
        {model.status === 'error' && `Pose detection unavailable: ${model.detail}`}
        {model.status === 'ready' &&
          `Pose model: ${model.delegate}` +
            (stats
              ? ` · ${stats.fps.toFixed(1)} fps · ${stats.frames} frames · ` +
                (stats.landmarks
                  ? `${stats.landmarks} landmarks, min visibility ${stats.minVisibility?.toFixed(2)}`
                  : 'no person detected')
              : '')}
      </p>
    </section>
  );
}
