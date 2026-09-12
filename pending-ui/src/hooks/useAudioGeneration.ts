import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelGeneration,
  clearChunkRun,
  fetchChunkRun,
  fetchResult,
  generateAudio,
  resumeGeneration,
} from '../lib/api';
import type { ChunkRun, GeneratedAudio } from '../types';
import { useSSEProgress } from './useSSEProgress';

const BUSY_STATUSES = ['starting', 'generating', 'processing', 'merging'];

export function useAudioGeneration() {
  const [isPosting, setIsPosting] = useState(false);
  const [audio, setAudio] = useState<GeneratedAudio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<ChunkRun | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const claimedRef = useRef(false);

  const { progress, hasSnapshot, reset: resetProgress } = useSSEProgress();

  const serverBusy = BUSY_STATUSES.includes(progress.status);
  const isGenerating = isPosting || serverBusy;
  const isAdopted = serverBusy && !isPosting;
  const isCheckingServer = !hasSnapshot && !isPosting;

  const refreshRun = useCallback(async () => {
    const next = await fetchChunkRun().catch(() => null);
    setRun(next);
    return next;
  }, []);

  // Both entry points share this: the only difference is which request is sent.
  const post = useCallback(
    async (send: (signal: AbortSignal) => Promise<GeneratedAudio>) => {
      setError(null);
      setAudio(null);
      claimedRef.current = false;
      setIsPosting(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const result = await send(controller.signal);
        claimedRef.current = true;
        setAudio({ ...result, audioUrl: `${result.audioUrl}?t=${Date.now()}` });
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError((err as Error).message);
        }
      } finally {
        setIsPosting(false);
        abortRef.current = null;
        refreshRun();
      }
    },
    [refreshRun],
  );

  const generate = useCallback(
    (text: string, voice: string, speed: number, meta?: { title?: string; wordCount?: number }) =>
      post((signal) => generateAudio(text, voice, speed, signal, meta)),
    [post],
  );

  /** Carry on the run stored on the server - no book needed on this side. */
  const resume = useCallback(() => post((signal) => resumeGeneration(signal)), [post]);

  /** Start from scratch: throw away the interrupted run's chunks. */
  const discardRun = useCallback(async () => {
    setError(null);
    try {
      const { removed } = await clearChunkRun();
      await refreshRun();
      return removed;
    } catch (err) {
      setError((err as Error).message);
      return 0;
    }
  }, [refreshRun]);

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

  // Re-read the chunk folder whenever the server settles, so the sidebar learns
  // about a run this tab never started - including one left by a power cut.
  useEffect(() => {
    if (serverBusy) return;
    refreshRun();
  }, [serverBusy, progress.status, refreshRun]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return {
    isGenerating,
    isAdopted,
    isCheckingServer,
    progress,
    audio,
    error,
    run,
    generate,
    resume,
    discardRun,
    cancel,
    clear,
  };
}
