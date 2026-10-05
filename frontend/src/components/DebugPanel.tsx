import type { AnalyzerOutput } from '../engine/analyzer';
import type { ExerciseDefinition } from '../engine/exercises/types';
import { BODY_LANDMARKS, LANDMARK_NAMES, type Landmark } from '../engine/landmarks';
import type { RepThresholds } from '../engine/repCounter';
import { MIN_VISIBILITY } from '../engine/visibility';
import styles from './DebugPanel.module.css';

export interface DebugInfo {
  fps: number;
  delegate: string;
  frames: number;
  videoWidth: number;
  videoHeight: number;
  landmarks: readonly Landmark[] | null;
  engine: AnalyzerOutput | null;
}

export interface Tuning {
  thresholds: RepThresholds;
  limits: Record<string, number>;
}

interface Props {
  info: DebugInfo;
  definition: ExerciseDefinition;
  tuning: Tuning;
  tuningError: string | null;
  onTuningChange: (tuning: Tuning) => void;
  onResetTuning: () => void;
  onClose: () => void;
}

const THRESHOLD_FIELDS: Array<{ key: 'startThreshold' | 'leaveTopThreshold' | 'endThreshold'; label: string }> = [
  { key: 'startThreshold', label: 'Start' },
  { key: 'leaveTopThreshold', label: 'Leave top' },
  { key: 'endThreshold', label: 'End' },
];

const fmt = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : v.toFixed(digits);

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  isDefault: boolean;
  onChange: (v: number) => void;
}) {
  const { label, value, min, max, step, unit, isDefault, onChange } = props;
  const digits = step < 1 ? 2 : 0;
  return (
    <label className={styles.slider}>
      <span className={styles.sliderLabel}>
        {label}
        <span className={isDefault ? styles.value : styles.changed}>
          {value.toFixed(digits)}
          {unit}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

/** Live engine numbers + threshold tuning (toggle with "D"). Changes are in-memory only. */
export function DebugPanel({ info, definition, tuning, tuningError, onTuningChange, onResetTuning, onClose }: Props) {
  const e = info.engine;
  return (
    <aside className={styles.panel} aria-label="Debug panel" data-debug-panel>
      <div className={styles.head}>
        <h2>Debug · {definition.name}</h2>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close debug panel">
          ✕
        </button>
      </div>

      <dl className={styles.grid}>
        <dt>State</dt>
        <dd data-debug-state>{e?.state ?? '—'}</dd>
        <dt>Side</dt>
        <dd>{e?.side ?? (definition.cameraView === 'front' ? 'both (front)' : '—')}</dd>
        <dt>Angle</dt>
        <dd className={styles.big} data-debug-angle>
          {fmt(e?.primaryAngle)}°
        </dd>
        {e &&
          Object.entries(e.frameMetrics).map(([k, v]) => (
            <FragmentRow key={k} label={k} value={fmt(v, k === 'wristHeightDiff' ? 2 : 1)} />
          ))}
        <dt>Visible</dt>
        <dd className={e && !e.visibilityOk ? styles.lowText : undefined}>
          {e ? (e.visibilityOk ? 'yes' : 'no') : '—'}
        </dd>
        <dt>FPS</dt>
        <dd data-debug-fps>{info.fps.toFixed(1)}</dd>
        <dt>Delegate</dt>
        <dd>{info.delegate}</dd>
        <dt>Video</dt>
        <dd>
          {info.videoWidth}×{info.videoHeight}
        </dd>
      </dl>

      <h3>Rep thresholds ({tuning.thresholds.direction})</h3>
      {THRESHOLD_FIELDS.map(({ key, label }) => (
        <Slider
          key={key}
          label={label}
          value={tuning.thresholds[key]}
          min={0}
          max={180}
          step={1}
          unit="°"
          isDefault={tuning.thresholds[key] === definition.thresholds[key]}
          onChange={(v) => onTuningChange({ ...tuning, thresholds: { ...tuning.thresholds, [key]: v } })}
        />
      ))}

      <h3>Form limits</h3>
      {definition.limits.map((l) => (
        <Slider
          key={l.key}
          label={l.label}
          value={tuning.limits[l.key]}
          min={l.min}
          max={l.max}
          step={l.step}
          unit={l.unit}
          isDefault={tuning.limits[l.key] === l.default}
          onChange={(v) => onTuningChange({ ...tuning, limits: { ...tuning.limits, [l.key]: v } })}
        />
      ))}
      {tuningError && <p className={styles.error}>{tuningError}</p>}
      <button type="button" className={`btn btn-secondary ${styles.resetBtn}`} onClick={onResetTuning}>
        Reset to defaults
      </button>
      <p className={styles.hint}>Changes restart the rep counter and are not saved.</p>

      <h3>Visibility</h3>
      {info.landmarks ? (
        <table className={styles.table}>
          <tbody>
            {BODY_LANDMARKS.map((i) => {
              const v = info.landmarks![i].visibility;
              const required = e?.missingLandmarks.includes(i);
              return (
                <tr key={i} className={v < MIN_VISIBILITY || required ? styles.low : undefined}>
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

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}
