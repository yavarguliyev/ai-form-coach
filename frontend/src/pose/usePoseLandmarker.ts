import { FilesetResolver, PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import { useEffect, useRef, useState, type RefObject } from 'react';

// Served from public/ by scripts/fetch-model.sh — no CDN at runtime (CLAUDE.md §9).
const WASM_PATH = '/wasm';
const MODEL_PATH = '/models/pose_landmarker_full.task';

export type Delegate = 'GPU' | 'CPU';

/** `?delegate=cpu` in the URL forces the CPU delegate (troubleshooting, see CLAUDE.md §14). */
function forcedDelegate(): Delegate | null {
  const value = new URLSearchParams(window.location.search).get('delegate')?.toUpperCase();
  return value === 'CPU' || value === 'GPU' ? value : null;
}

export type PoseModelState =
  | { status: 'loading' }
  | { status: 'ready'; delegate: Delegate }
  | { status: 'error'; detail: string };

/** One detection result, passed to `onFrame` for every processed video frame. */
export interface PoseFrame {
  /** 33 landmarks of the first (only) pose, or null when no person is detected. */
  landmarks: NormalizedLandmark[] | null;
  /** Monotonic detection time in ms (performance.now based). */
  timestampMs: number;
  videoWidth: number;
  videoHeight: number;
}

async function createLandmarker(delegate: Delegate): Promise<PoseLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
  return PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_PATH, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
    outputSegmentationMasks: false,
  });
}

/**
 * Loads the pose model (GPU, falling back to CPU) and, while `enabled`, runs detection once
 * per new camera frame.
 *
 * Per-frame data is delivered through `onFrame` and kept out of React state; only `fps`
 * (a ref) and the model state are exposed, so the page doesn't re-render every frame.
 */
export function usePoseLandmarker(
  videoRef: RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  onFrame: (frame: PoseFrame) => void,
  /** Set false to skip loading the model entirely (dev replay mode). */
  load = true,
) {
  const [model, setModel] = useState<PoseModelState>({ status: 'loading' });
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  const fpsRef = useRef(0);

  // Load once.
  useEffect(() => {
    if (!load) return;
    let cancelled = false;
    (async () => {
      const forced = forcedDelegate();
      let delegate: Delegate = forced ?? 'GPU';
      let landmarker: PoseLandmarker;
      try {
        landmarker = await createLandmarker(delegate);
      } catch (gpuErr) {
        if (delegate === 'CPU') throw gpuErr;
        console.warn('PoseLandmarker: GPU delegate failed, falling back to CPU', gpuErr);
        delegate = 'CPU';
        landmarker = await createLandmarker('CPU');
      }
      if (cancelled) {
        landmarker.close();
        return;
      }
      landmarkerRef.current = landmarker;
      setModel({ status: 'ready', delegate });
    })().catch((err: unknown) => {
      if (!cancelled) setModel({ status: 'error', detail: String(err) });
    });

    return () => {
      cancelled = true;
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, [load]);

  // Detection loop: one detection per NEW camera frame.
  // requestVideoFrameCallback fires exactly once per presented frame. The fallback is a
  // requestAnimationFrame loop that skips frames whose media time hasn't advanced (note: for
  // live streams `currentTime` advances continuously, so prefer rVFC when available).
  useEffect(() => {
    const video = videoRef.current;
    if (!enabled || model.status !== 'ready' || !video) return;

    let stopped = false;
    let handle = 0;
    let lastMediaTime = -1;
    let lastTimestamp = 0;
    let windowStart = performance.now();
    let windowFrames = 0;
    const hasRvfc = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

    const detect = (mediaTime: number) => {
      const landmarker = landmarkerRef.current;
      if (!landmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      if (mediaTime === lastMediaTime) return;
      lastMediaTime = mediaTime;

      // MediaPipe requires strictly increasing timestamps in VIDEO mode.
      const timestampMs = Math.max(performance.now(), lastTimestamp + 1);
      lastTimestamp = timestampMs;
      const result = landmarker.detectForVideo(video, timestampMs);

      onFrameRef.current({
        landmarks: result.landmarks[0] ?? null,
        timestampMs,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
      });

      windowFrames += 1;
      const elapsed = timestampMs - windowStart;
      if (elapsed >= 1000) {
        fpsRef.current = (windowFrames * 1000) / elapsed;
        windowStart = timestampMs;
        windowFrames = 0;
      }
    };

    // A throwing detection must not silently kill the loop: report it and stop.
    const safeDetect = (mediaTime: number): boolean => {
      try {
        detect(mediaTime);
        return true;
      } catch (err) {
        console.error('PoseLandmarker: detection failed', err);
        setModel({ status: 'error', detail: `Detection failed: ${String(err)}` });
        return false;
      }
    };

    if (hasRvfc) {
      const onVideoFrame: VideoFrameRequestCallback = (_now, metadata) => {
        if (stopped || !safeDetect(metadata.mediaTime)) return;
        handle = video.requestVideoFrameCallback(onVideoFrame);
      };
      handle = video.requestVideoFrameCallback(onVideoFrame);
    } else {
      const onAnimationFrame = () => {
        if (stopped || !safeDetect(video.currentTime)) return;
        handle = requestAnimationFrame(onAnimationFrame);
      };
      handle = requestAnimationFrame(onAnimationFrame);
    }

    return () => {
      stopped = true;
      if (hasRvfc) video.cancelVideoFrameCallback(handle);
      else cancelAnimationFrame(handle);
    };
  }, [enabled, model.status, videoRef]);

  return { model, fpsRef };
}
