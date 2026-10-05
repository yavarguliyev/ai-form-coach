import { BODY_LANDMARKS, LANDMARK_NAMES, type Landmark } from '../engine/landmarks';
import styles from './DebugPanel.module.css';

const LOW_VISIBILITY = 0.6; // MIN_VISIBILITY (§8.5)

export interface DebugInfo {
  fps: number;
  delegate: string;
  frames: number;
  videoWidth: number;
  videoHeight: number;
  landmarks: readonly Landmark[] | null;
}

/** Live numbers for tuning (toggle with "D"). Exercise state, angles and sliders come in T-23. */
export function DebugPanel({ info }: { info: DebugInfo }) {
  return (
    <aside className={styles.panel} aria-label="Debug panel" data-debug-panel>
      <h2>Debug</h2>
      <dl className={styles.grid}>
        <dt>FPS</dt>
        <dd data-debug-fps>{info.fps.toFixed(1)}</dd>
        <dt>Delegate</dt>
        <dd>{info.delegate}</dd>
        <dt>Frames</dt>
        <dd>{info.frames}</dd>
        <dt>Video</dt>
        <dd>
          {info.videoWidth}×{info.videoHeight}
        </dd>
      </dl>

      <h3>Visibility</h3>
      {info.landmarks ? (
        <table className={styles.table}>
          <tbody>
            {BODY_LANDMARKS.map((i) => {
              const v = info.landmarks![i].visibility;
              return (
                <tr key={i} className={v < LOW_VISIBILITY ? styles.low : undefined}>
                  <td>{LANDMARK_NAMES[i]}</td>
                  <td className={styles.num}>{v.toFixed(2)}</td>
                  <td className={styles.barCell}>
                    <span className={styles.bar} style={{ width: `${v * 100}%` }} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className={styles.none}>No person detected</p>
      )}
      <p className={styles.hint}>Press D to hide</p>
    </aside>
  );
}
