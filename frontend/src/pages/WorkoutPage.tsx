import { CameraError } from '../components/CameraError';
import { useCamera } from '../pose/useCamera';
import styles from './WorkoutPage.module.css';

// Camera preview only for now; pose detection (T-12) and the workout flow (T-25) build on it.
export default function WorkoutPage() {
  const { videoRef, state, retry } = useCamera();

  return (
    <section>
      <h1>Workout</h1>
      {state.status === 'error' && (
        <CameraError kind={state.kind} detail={state.detail} onRetry={retry} />
      )}
      {state.status === 'requesting' && <p>Waiting for camera permission…</p>}
      <div className={styles.stage} hidden={state.status === 'error'}>
        {/* Mirrored for display only — never mirror coordinates used for math (§8.1). */}
        <video ref={videoRef} className={styles.video} playsInline muted />
      </div>
      {state.status === 'ready' && (
        <p className={styles.meta} data-camera-size>
          Camera: {state.width}×{state.height}
        </p>
      )}
    </section>
  );
}
