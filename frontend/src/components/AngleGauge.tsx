import styles from './AngleGauge.module.css';

interface Props {
  /** Current primary angle in degrees, or null when the frame is invalid. */
  angle: number | null;
  startThreshold: number;
  endThreshold: number;
  label: string;
}

const R = 80;
const CX = 100;
const CY = 95;

/** Point on the semicircle for an angle 0..180 (0 = left end, 180 = right end). */
function point(deg: number, r = R) {
  const t = Math.PI - (Math.min(180, Math.max(0, deg)) * Math.PI) / 180;
  return { x: CX + r * Math.cos(t), y: CY - r * Math.sin(t) };
}

function arc(from: number, to: number) {
  const a = point(Math.min(from, to));
  const b = point(Math.max(from, to));
  return `M ${a.x} ${a.y} A ${R} ${R} 0 0 1 ${b.x} ${b.y}`;
}

/** Semicircular 0–180° gauge: needle = current angle, green arc = range the rep must cover. */
export function AngleGauge({ angle, startThreshold, endThreshold, label }: Props) {
  const needle = angle === null ? null : point(angle, R - 12);
  const marks = [
    { deg: startThreshold, cls: styles.startMark },
    { deg: endThreshold, cls: styles.endMark },
  ];
  return (
    <figure className={styles.gauge} aria-label={`${label}: ${angle === null ? 'not visible' : `${Math.round(angle)} degrees`}`}>
      <svg viewBox="0 0 200 110" role="img">
        <path d={arc(0, 180)} className={styles.track} />
        <path d={arc(startThreshold, endThreshold)} className={styles.range} />
        {marks.map(({ deg, cls }) => {
          const a = point(deg, R - 10);
          const b = point(deg, R + 10);
          return <line key={cls} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={cls} />;
        })}
        {needle && <line x1={CX} y1={CY} x2={needle.x} y2={needle.y} className={styles.needle} />}
        <circle cx={CX} cy={CY} r="5" className={styles.hub} />
      </svg>
      <figcaption>
        <span className={styles.value} data-gauge-angle>
          {angle === null ? '—' : `${Math.round(angle)}°`}
        </span>
        <span className={styles.label}>{label}</span>
      </figcaption>
    </figure>
  );
}
