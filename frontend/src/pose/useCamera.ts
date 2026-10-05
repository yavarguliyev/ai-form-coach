import { useCallback, useEffect, useRef, useState } from 'react';

// CLAUDE.md §9: request 1280×720 from the front camera.
const CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
};

export type CameraErrorKind =
  | 'denied' // user or OS blocked camera access
  | 'not-found' // no camera connected
  | 'in-use' // another app is holding the camera
  | 'insecure' // not https / localhost, so the browser hides the camera API
  | 'ended' // camera was unplugged or stopped mid-session
  | 'unknown';

export type CameraState =
  | { status: 'requesting' }
  | { status: 'ready'; width: number; height: number }
  | { status: 'error'; kind: CameraErrorKind; detail: string };

function classify(err: unknown): CameraErrorKind {
  const name = err instanceof DOMException ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'not-found';
    case 'NotReadableError':
    case 'AbortError':
      return 'in-use';
    default:
      return 'unknown';
  }
}

/**
 * Opens the webcam and plays it into the returned video ref.
 * Stops all tracks on unmount. `retry()` re-requests after an error.
 */
export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<CameraState>({ status: 'requesting' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState({ status: 'error', kind: 'insecure', detail: 'navigator.mediaDevices is unavailable' });
      return;
    }

    let stream: MediaStream | null = null;
    let cancelled = false;
    setState({ status: 'requesting' });

    navigator.mediaDevices
      .getUserMedia(CONSTRAINTS)
      .then(async (s) => {
        if (cancelled) {
          // Unmounted (or StrictMode re-ran the effect) while the prompt was open.
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const [track] = s.getVideoTracks();
        track?.addEventListener('ended', () => {
          if (!cancelled) setState({ status: 'error', kind: 'ended', detail: 'video track ended' });
        });

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = s;
        if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
          await new Promise<void>((resolve) =>
            video.addEventListener('loadedmetadata', () => resolve(), { once: true }),
          );
        }
        await video.play();
        if (!cancelled) {
          setState({ status: 'ready', width: video.videoWidth, height: video.videoHeight });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({ status: 'error', kind: classify(err), detail: String(err) });
      });

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { videoRef, state, retry };
}
