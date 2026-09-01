import { useCallback, useEffect, useState } from 'react';
import type { Progress } from '../types';

const IDLE: Progress = { status: 'idle', progress: 0 };

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
      }
    };

    source.onerror = () => {
      setConnected(false);
    };

    return () => source.close();
  }, []);

  const reset = useCallback(() => setProgress(IDLE), []);

  return { progress, connected, reset };
}
