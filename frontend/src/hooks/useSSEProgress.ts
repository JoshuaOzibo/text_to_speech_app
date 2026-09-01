import { useCallback, useEffect, useState } from 'react';
import type { Progress } from '../types';

const IDLE: Progress = { status: 'idle', progress: 0 };

/**
 * Subscribe to the backend's generation progress stream.
 *
 * The connection stays open for the life of the page rather than only while
 * this tab is generating. That is what lets a freshly loaded page discover a
 * run that is already in flight — the server replays its current snapshot to
 * every new subscriber — so the progress bar shows up even if the run was
 * started before a reload.
 */
export function useSSEProgress() {
  const [progress, setProgress] = useState<Progress>(IDLE);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const source = new EventSource('/api/status');

    source.onopen = () => setConnected(true);

    source.onmessage = (event) => {
      try {
        setProgress(JSON.parse(event.data) as Progress);
      } catch {
        // Ignore a malformed frame rather than tearing down the stream.
      }
    };

    source.onerror = () => {
      // EventSource reconnects on its own; just reflect the dropped link.
      setConnected(false);
    };

    return () => source.close();
  }, []);

  const reset = useCallback(() => setProgress(IDLE), []);

  return { progress, connected, reset };
}
