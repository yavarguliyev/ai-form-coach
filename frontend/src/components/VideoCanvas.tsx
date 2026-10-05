import { forwardRef, type RefObject } from 'react';
import styles from './VideoCanvas.module.css';

interface Props {
  videoRef: RefObject<HTMLVideoElement>;
  /** Intrinsic video size; the stage takes this aspect ratio so overlay and video line up. */
  width: number;
  height: number;
  hidden?: boolean;
}

/** Webcam video with a skeleton canvas on top. Both are mirrored for display only. */
export const VideoCanvas = forwardRef<HTMLCanvasElement, Props>(function VideoCanvas(
  { videoRef, width, height, hidden },
  canvasRef,
) {
  return (
    <div className={styles.stage} style={{ aspectRatio: `${width} / ${height}` }} hidden={hidden}>
      <video ref={videoRef} className={styles.layer} playsInline muted />
      <canvas ref={canvasRef} className={styles.layer} width={width} height={height} />
    </div>
  );
});
