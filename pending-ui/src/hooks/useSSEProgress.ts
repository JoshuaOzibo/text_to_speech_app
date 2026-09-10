import { useCallback, useEffect, useState } from 'react';
import type { Progress } from '../types';

const IDLE: Progress = { status: 'idle', progress: 0 };

const SNAPSHOT_PATIENCE_MS = 60_000;

export function useSSEProgress() {
  const [progress, setProgress] = useState<Progress>(IDLE);
  const [connected, setConnected] = useState(false);
  const [hasSnapshot, setHasSnapshot] = useState(false);

  const [givenUpWaiting, setGivenUpWaiting] = useState(false);

  useEffect(() => {
    const source = new EventSource('/api/status');

    source.onopen = () => setConnected(true);

    source.onmessage = (event) => {
      try {
        setProgress(JSON.parse(event.data) as Progress);
        setHasSnapshot(true);
      } catch {
      }
    };

    source.onerror = () => {
      setConnected(false);
    };

    const patience = setTimeout(() => setGivenUpWaiting(true), SNAPSHOT_PATIENCE_MS);

    return () => {
      clearTimeout(patience);
      source.close();
    };
  }, []);

  const reset = useCallback(() => setProgress(IDLE), []);

  return { progress, connected, hasSnapshot: hasSnapshot || givenUpWaiting, reset };
}
