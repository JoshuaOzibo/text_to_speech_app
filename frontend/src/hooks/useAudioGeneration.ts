import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelGeneration, fetchResult, generateAudio } from '../lib/api';
import type { GeneratedAudio } from '../types';
import { useSSEProgress } from './useSSEProgress';

/** Statuses that mean the server is actively working on a book. */
const BUSY_STATUSES = ['starting', 'generating', 'processing', 'merging'];

/**
 * Drives generation and reflects whatever the server is doing.
 *
 * `isGenerating` is true when *the server* is busy, not merely when this tab
 * started the run — so a reloaded page shows the live progress bar (and its
 * cancel button) for a job already underway, rather than appearing idle and
 * then failing with "a generation is already running".
 */
export function useAudioGeneration() {
  const [isPosting, setIsPosting] = useState(false);
  const [audio, setAudio] = useState<GeneratedAudio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Set once we've claimed a finished run, so we don't refetch it repeatedly.
  const claimedRef = useRef(false);

  const { progress, reset: resetProgress } = useSSEProgress();

  const serverBusy = BUSY_STATUSES.includes(progress.status);
  const isGenerating = isPosting || serverBusy;
  /** True when the running job belongs to some other tab or a previous page load. */
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
      // Cache-bust so the player never replays a previous run's file.
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
    // Tell the server to kill Piper, then drop our own pending request.
    await cancelGeneration().catch(() => undefined);
    abortRef.current?.abort();
    setIsPosting(false);
  }, []);

  const clear = useCallback(() => {
    setAudio(null);
    setError(null);
    claimedRef.current = true; // don't re-adopt the run we just dismissed
    resetProgress();
  }, [resetProgress]);

  /**
   * Recover audio this tab didn't receive directly.
   *
   * Covers a page reloaded mid-run and a run started in another tab: when the
   * stream reports 'done' and we hold no audio, ask the server for the result.
   */
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

  // Surface a server-side failure that happened outside our own request.
  useEffect(() => {
    if (progress.status === 'error' && progress.message) setError(progress.message);
  }, [progress.status, progress.message]);

  // Abort an in-flight request if the page unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  return { isGenerating, isAdopted, progress, audio, error, generate, cancel, clear };
}
