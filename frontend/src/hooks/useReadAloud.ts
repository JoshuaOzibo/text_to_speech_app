import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchReadChunk, fetchReadPlan, RequestError } from '../lib/api';
import type { ReadChunk, ReadPlan, Timeline } from '../types';

const DEFAULT_SECONDS_PER_WORD = 0.38;
const MAX_CACHED_CHUNKS = 8;
const PREFETCH_AHEAD = 2;
const MIN_WORDS_TO_TRUST_RATE = 40;

export interface LiveNarration {
  available: boolean;
  active: boolean;
  preparing: boolean;
  buffering: boolean;
  error: string | null;
  url: string | null;
  timeline: Timeline | null;
  index: number;
  totalChunks: number;
  offset: number;
  total: number;
  startAt: number;
  epoch: number;
  atEnd: boolean;
  begin: () => void;
  next: () => void;
  seek: (seconds: number) => void;
  stop: () => void;
}

export function useReadAloud(
  text: string | null,
  voice: string,
  speed: number,
): LiveNarration {
  const [plan, setPlan] = useState<ReadPlan | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [index, setIndex] = useState(0);
  const [chunk, setChunk] = useState<ReadChunk | null>(null);
  const [startAt, setStartAt] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const [measuredVersion, setMeasuredVersion] = useState(0);

  const voiceRef = useRef(voice);
  const speedRef = useRef(speed);
  const textRef = useRef(text);
  const planRef = useRef<ReadPlan | null>(plan);
  const indexRef = useRef(index);
  voiceRef.current = voice;
  speedRef.current = speed;
  textRef.current = text;
  planRef.current = plan;
  indexRef.current = index;

  const cacheRef = useRef(new Map<string, ReadChunk>());
  const measuredRef = useRef(new Map<number, number>());
  const inFlightRef = useRef(new Set<string>());
  const requestRef = useRef(0);

  const keyFor = useCallback(
    (i: number) => `${voiceRef.current}|${speedRef.current.toFixed(1)}|${i}`,
    [],
  );

  const discard = useCallback(() => {
    requestRef.current += 1;
    for (const entry of cacheRef.current.values()) URL.revokeObjectURL(entry.url);
    cacheRef.current.clear();
    measuredRef.current.clear();
    inFlightRef.current.clear();
    setChunk(null);
    setActive(false);
    setBuffering(false);
    setIndex(0);
    setStartAt(0);
  }, []);

  useEffect(() => () => discard(), [discard]);

  useEffect(() => {
    discard();
    setError(null);

    const source = text?.trim() ? text : null;
    if (!source) {
      setPlan(null);
      planRef.current = null;
      return;
    }

    let cancelled = false;
    setPreparing(true);
    fetchReadPlan(source)
      .then((next) => {
        if (cancelled) return;
        setPlan(next);
        planRef.current = next;
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setPreparing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [text, discard]);

  const evict = useCallback(() => {
    const cache = cacheRef.current;
    while (cache.size > MAX_CACHED_CHUNKS) {
      const oldest = cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      const victim = cache.get(oldest);
      cache.delete(oldest);
      if (victim) URL.revokeObjectURL(victim.url);
    }
  }, []);

  const obtain = useCallback(
    async (i: number): Promise<ReadChunk> => {
      const cache = cacheRef.current;
      const key = keyFor(i);
      const cached = cache.get(key);
      if (cached) {
        cache.delete(key);
        cache.set(key, cached);
        return cached;
      }

      const current = planRef.current;
      if (!current) throw new Error('This book is not ready to be read yet.');

      let fetched: ReadChunk;
      try {
        fetched = await fetchReadChunk(current.id, i, voiceRef.current, speedRef.current);
      } catch (err) {
        const unknown = err instanceof RequestError && err.code === 'READ_PLAN_UNKNOWN';
        if (!unknown || !textRef.current) throw err;
        const revived = await fetchReadPlan(textRef.current);
        setPlan(revived);
        planRef.current = revived;
        fetched = await fetchReadChunk(revived.id, i, voiceRef.current, speedRef.current);
      }

      cache.set(key, fetched);
      measuredRef.current.set(i, fetched.duration);
      setMeasuredVersion((version) => version + 1);
      evict();
      return fetched;
    },
    [evict, keyFor],
  );

  const prefetch = useCallback(
    (from: number) => {
      const current = planRef.current;
      if (!current) return;

      for (let step = 1; step <= PREFETCH_AHEAD; step += 1) {
        const i = from + step;
        if (i >= current.totalChunks) break;

        const key = keyFor(i);
        if (cacheRef.current.has(key) || inFlightRef.current.has(key)) continue;

        inFlightRef.current.add(key);
        obtain(i)
          .catch(() => undefined)
          .finally(() => inFlightRef.current.delete(key));
      }
    },
    [keyFor, obtain],
  );

  const load = useCallback(
    async (i: number, within = 0) => {
      const current = planRef.current;
      if (!current || i < 0 || i >= current.totalChunks) return;

      const token = requestRef.current + 1;
      requestRef.current = token;

      setIndex(i);
      indexRef.current = i;
      setActive(true);
      setError(null);
      setBuffering(true);

      try {
        const next = await obtain(i);
        if (token !== requestRef.current) return;
        setChunk(next);
        setStartAt(Math.max(0, Math.min(within, Math.max(0, next.duration - 0.25))));
        setEpoch((value) => value + 1);
        setBuffering(false);
        prefetch(i);
      } catch (err) {
        if (token !== requestRef.current) return;
        setError((err as Error).message);
        setBuffering(false);
        setActive(false);
      }
    },
    [obtain, prefetch],
  );

  const starts = useMemo(() => {
    void measuredVersion;
    if (!plan) return [0];

    const measured = measuredRef.current;
    let knownSeconds = 0;
    let knownWords = 0;
    for (const [i, seconds] of measured) {
      knownSeconds += seconds;
      knownWords += plan.chunks[i]?.words ?? 0;
    }

    const rate =
      knownWords >= MIN_WORDS_TO_TRUST_RATE
        ? knownSeconds / knownWords
        : DEFAULT_SECONDS_PER_WORD / Math.max(0.5, speed);

    const out = new Array<number>(plan.chunks.length + 1);
    out[0] = 0;
    for (let i = 0; i < plan.chunks.length; i += 1) {
      out[i + 1] = out[i] + (measured.get(i) ?? plan.chunks[i].words * rate);
    }
    return out;
  }, [plan, speed, measuredVersion]);

  const begin = useCallback(() => {
    void load(indexRef.current, 0);
  }, [load]);

  const next = useCallback(() => {
    const current = planRef.current;
    const following = indexRef.current + 1;
    if (!current || following >= current.totalChunks) {
      setActive(false);
      return;
    }
    void load(following, 0);
  }, [load]);

  const seek = useCallback(
    (seconds: number) => {
      const current = planRef.current;
      if (!current) return;

      const target = Math.max(0, seconds);
      let i = starts.length - 2;
      for (let candidate = 0; candidate < current.totalChunks; candidate += 1) {
        if (target < starts[candidate + 1]) {
          i = candidate;
          break;
        }
      }
      i = Math.max(0, Math.min(current.totalChunks - 1, i));
      void load(i, target - starts[i]);
    },
    [load, starts],
  );

  const totalChunks = plan?.totalChunks ?? 0;

  return useMemo(
    () => ({
      available: totalChunks > 0,
      active,
      preparing,
      buffering,
      error,
      url: chunk?.url ?? null,
      timeline: chunk?.timeline ?? null,
      index,
      totalChunks,
      offset: starts[index] ?? 0,
      total: starts[starts.length - 1] ?? 0,
      startAt,
      epoch,
      atEnd: totalChunks > 0 && index >= totalChunks - 1,
      begin,
      next,
      seek,
      stop: discard,
    }),
    [
      totalChunks,
      active,
      preparing,
      buffering,
      error,
      chunk,
      index,
      starts,
      startAt,
      epoch,
      begin,
      next,
      seek,
      discard,
    ],
  );
}
