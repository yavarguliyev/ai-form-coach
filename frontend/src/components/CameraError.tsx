import type { CameraErrorKind } from '../pose/useCamera';
import styles from './CameraError.module.css';

const MESSAGES: Record<CameraErrorKind, { title: string; help: string }> = {
  denied: {
    title: 'Camera access is blocked',
    help:
      'Click the camera icon in the address bar and allow access, then press Try again. ' +
      'On macOS, also check System Settings → Privacy & Security → Camera for your browser.',
  },
  'not-found': {
    title: 'No camera found',
    help: 'Connect a webcam (or enable the built-in one) and press Try again.',
  },
  'in-use': {
    title: 'The camera is busy',
    help: 'Another app (Zoom, Teams, FaceTime…) or browser tab is using it. Close it and press Try again.',
  },
  insecure: {
    title: 'Camera not available on this address',
    help: 'Browsers only allow the camera on https or localhost. Open http://localhost:5180 instead.',
  },
  ended: {
    title: 'The camera stopped',
    help: 'It may have been unplugged or switched off. Press Try again.',
  },
  unknown: {
    title: 'Could not start the camera',
    help: 'Press Try again. If it keeps failing, reload the page.',
  },
};

interface Props {
  kind: CameraErrorKind;
  detail: string;
  onRetry: () => void;
}

export function CameraError({ kind, detail, onRetry }: Props) {
  const { title, help } = MESSAGES[kind];
  return (
    <div className={styles.box} role="alert" data-camera-error={kind}>
      <h2>{title}</h2>
      <p>{help}</p>
      <button type="button" className="btn btn-primary" onClick={onRetry}>
        Try again
      </button>
      <p className={styles.detail}>{detail}</p>
    </div>
  );
}
