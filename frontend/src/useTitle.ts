import { useEffect } from 'react';

/** Sets the browser tab title, e.g. "Squat · FormCoach AI". */
export function useTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} · FormCoach AI` : 'FormCoach AI';
  }, [title]);
}
