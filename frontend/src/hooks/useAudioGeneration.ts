import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelGeneration, fetchResult, generateAudio } from '../lib/api';
import type { GeneratedAudio } from '../types';
import { useSSEProgress } from './useSSEProgress';

const BUSY_STATUSES = ['starting', 'generating', 'processing', 'merging'];

export function useAudioGeneration() {
  const [isPosting, setIsPosting] = useState(false);
  const [audio, setAudio] = useState<GeneratedAudio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const claimedRef = useRef(false);

  const { progress, reset: resetProgress } = useSSEProgress();

  const serverBusy = BUSY_STATUSES.includes(progress.status);
  const isGenerating = isPosting || serverBusy;
  const isAdopted = serverBusy && !isPosting;

  const generate = useCallback(async (text: string, voice: string, speed: number) => {
    setError(null);
    setAudio(null);
    claimedRef.current = false;
    setIsPosting(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await generateAudio(text, voice, speed, controller.signal);
      claimedRef.current = true;
      setAudio({ ...result, audioUrl: `${result.audioUrl}?t=${Date.now()}` });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError((err as Error).message);
      }
    } finally {
      setIsPosting(false);
      abortRef.current = null;
    }
  }, []);

  const cancel = useCallback(async () => {
    await cancelGeneration().catch(() => undefined);
    abortRef.current?.abort();
    setIsPosting(false);
  }, []);

  const clear = useCallback(() => {
    setAudio(null);
    setError(null);
    claimedRef.current = true;
    resetProgress();
  }, [resetProgress]);

  useEffect(() => {
    if (progress.status !== 'done' || audio || isPosting || claimedRef.current) return;

    let cancelled = false;
    claimedRef.current = true;

    fetchResult()
      .then((result) => {
        if (!cancelled && result) {
          setAudio({ ...result, audioUrl: `${result.audioUrl}?t=${Date.now()}` });
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [progress.status, audio, isPosting]);

  useEffect(() => {
    if (progress.status === 'error' && progress.message) setError(progress.message);
  }, [progress.status, progress.message]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { isGenerating, isAdopted, progress, audio, error, generate, cancel, clear };
}
