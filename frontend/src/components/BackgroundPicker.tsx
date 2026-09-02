import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Loader2, Music, Play, Sparkles, Square, Trash2, Wand2, X } from 'lucide-react';
import {
  backgroundAudioUrl,
  clearBackground,
  selectBackground,
  setBackgroundLevel,
  suggestBackground,
} from '../lib/api';
import type { BackgroundStatus, BackgroundSuggestion, BackgroundTrack } from '../types';

interface Props {
  text: string;
  title: string;
  chapters: string[];
  status: BackgroundStatus;
  onStatus: (status: BackgroundStatus) => void;
  onClose: () => void;
}

function formatDuration(seconds: number): string {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function levelLabel(db: number): string {
  if (db <= -28) return 'barely there';
  if (db <= -20) return 'background';
  if (db <= -14) return 'present';
  return 'forward';
}

function keyOf(track: BackgroundTrack): string {
  return `${track.provider}:${track.id}`;
}

interface ScrubberProps {
  duration: number;
  position: number;
  buffered: number;
  active: boolean;
  label: string;
  onSeek: (fraction: number) => void;
}

const Scrubber = memo(function Scrubber({
  duration,
  position,
  buffered,
  active,
  label,
  onSeek,
}: ScrubberProps) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const fractionAt = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const nudge = (seconds: number) => {
    if (!duration) return;
    onSeek(Math.min(1, Math.max(0, (position + seconds) / duration)));
  };

  const played = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;

  return (
    <div
      ref={barRef}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.max(1, Math.round(duration) || 100)}
      aria-valuenow={Math.round(position)}
      aria-valuetext={`${formatClock(position)} of ${duration ? formatClock(duration) : 'unknown'}`}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.focus();
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        onSeek(fractionAt(e.clientX));
      }}
      onPointerMove={(e) => {
        if (dragging) onSeek(fractionAt(e.clientX));
      }}
      onPointerUp={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
        setDragging(false);
      }}
      onPointerCancel={() => setDragging(false)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault();
          nudge(5);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault();
          nudge(-5);
        } else if (e.key === 'Home') {
          e.preventDefault();
          onSeek(0);
        } else if (e.key === 'End') {
          e.preventDefault();
          onSeek(0.98);
        }
      }}
      className="group/bar relative h-4 flex-1 cursor-pointer touch-none select-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
    >
      <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 overflow-hidden rounded-full bg-surface">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-line-strong/70"
          style={{ width: `${Math.min(1, Math.max(0, buffered)) * 100}%` }}
        />
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${active ? 'bg-accent' : 'bg-line-strong'}`}
          style={{ width: `${played * 100}%` }}
        />
      </div>
      <div
        className={`pointer-events-none absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-sm transition-opacity ${
          active || dragging ? 'opacity-100' : 'opacity-0 group-hover/bar:opacity-100'
        }`}
        style={{ left: `${played * 100}%` }}
      />
    </div>
  );
});

interface RowProps {
  track: BackgroundTrack;
  active: boolean;
  loading: boolean;
  busy: boolean;
  chosen: boolean;
  position: number;
  duration: number;
  buffered: number;
  onToggle: (track: BackgroundTrack) => void;
  onSeek: (track: BackgroundTrack, fraction: number) => void;
  onChoose: (track: BackgroundTrack) => void;
}

const TrackRow = memo(function TrackRow({
  track,
  active,
  loading,
  busy,
  chosen,
  position,
  duration,
  buffered,
  onToggle,
  onSeek,
  onChoose,
}: RowProps) {
  const total = active && duration ? duration : track.durationSec;
  const handleSeek = useCallback((fraction: number) => onSeek(track, fraction), [onSeek, track]);

  return (
    <li className="py-2.5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onToggle(track)}
          aria-label={active ? `Stop ${track.title}` : `Play ${track.title}`}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${
            active
              ? 'border-accent bg-accent-soft text-accent-ink'
              : 'border-line-strong text-muted hover:border-accent hover:text-accent-ink'
          }`}
        >
          {loading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : active ? (
            <Square size={11} />
          ) : (
            <Play size={12} />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-ink">{track.title}</p>
          <p className="truncate text-[11px] text-muted">
            {track.author} · {formatDuration(total)} · {track.license}
            {track.attribution ? ' · credit required' : ''}
          </p>
        </div>

        <button
          type="button"
          onClick={() => onChoose(track)}
          disabled={busy}
          className={`flex h-8 shrink-0 items-center gap-1 rounded-btn px-2.5 text-[12px] font-medium disabled:opacity-50 ${
            chosen
              ? 'bg-accent-soft text-accent-ink'
              : 'border border-line-strong text-muted hover:border-accent hover:text-ink'
          }`}
        >
          {busy ? (
            <Loader2 size={12} className="animate-spin" />
          ) : chosen ? (
            <Check size={12} />
          ) : null}
          {chosen ? 'In use' : 'Use'}
        </button>
      </div>

      <div className="mt-1.5 flex items-center gap-2 pl-11">
        <Scrubber
          duration={total}
          position={active ? position : 0}
          buffered={active ? buffered : 0}
          active={active}
          label={`Scrub ${track.title}`}
          onSeek={handleSeek}
        />
        <span className="w-[76px] shrink-0 text-right text-[10px] tabular-nums text-faint">
          {formatClock(active ? position : 0)} / {total ? formatClock(total) : '—:—'}
        </span>
      </div>
    </li>
  );
});

export function BackgroundPicker({ text, title, chapters, status, onStatus, onClose }: Props) {
  const [suggestion, setSuggestion] = useState<BackgroundSuggestion | null>(null);
  const [thinking, setThinking] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(status.level);
  const [copied, setCopied] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const positionRef = useRef(0);

  const stop = useCallback(() => {
    const el = audioRef.current;
    if (el) {
      el.onloadedmetadata = null;
      el.oncanplay = null;
      el.onended = null;
      el.onerror = null;
      el.pause();
    }
    audioRef.current = null;
    pendingSeekRef.current = null;
    positionRef.current = 0;
    setPlaying(null);
    setLoadingId(null);
    setPosition(0);
    setDuration(0);
    setBuffered(0);
  }, []);

  const start = useCallback(
    (track: BackgroundTrack, fraction: number) => {
      stop();
      setError(null);

      const id = keyOf(track);
      const audio = new Audio(backgroundAudioUrl(track.provider, track.id));
      audio.preload = 'auto';
      audio.volume = 0.7;
      audioRef.current = audio;
      pendingSeekRef.current = fraction > 0 ? fraction : null;

      audio.onloadedmetadata = () => {
        const total = Number.isFinite(audio.duration) ? audio.duration : 0;
        setDuration(total);
        const pending = pendingSeekRef.current;
        if (pending != null && total) {
          audio.currentTime = Math.min(total - 0.05, pending * total);
          pendingSeekRef.current = null;
        }
      };
      audio.oncanplay = () => setLoadingId(null);
      audio.onended = () => stop();
      audio.onerror = () => {
        setError(`Could not play "${track.title}".`);
        stop();
      };

      const guessed = fraction * (track.durationSec || 0);
      positionRef.current = guessed;
      setPlaying(id);
      setLoadingId(id);
      setPosition(guessed);
      setDuration(track.durationSec || 0);
      setBuffered(0);

      void audio.play().catch(() => {
        setError(`Could not play "${track.title}".`);
        stop();
      });
    },
    [stop],
  );

  const toggle = useCallback(
    (track: BackgroundTrack) => {
      if (playing === keyOf(track)) {
        stop();
        return;
      }
      start(track, 0);
    },
    [playing, start, stop],
  );

  const seek = useCallback(
    (track: BackgroundTrack, fraction: number) => {
      const el = audioRef.current;
      if (playing !== keyOf(track) || !el) {
        start(track, fraction);
        return;
      }

      const total = Number.isFinite(el.duration) ? el.duration : 0;
      if (total) {
        const next = Math.min(total - 0.05, Math.max(0, fraction * total));
        el.currentTime = next;
        positionRef.current = next;
        setPosition(next);
      } else {
        pendingSeekRef.current = fraction;
      }

      if (el.paused) void el.play().catch(() => undefined);
    },
    [playing, start],
  );

  useEffect(() => {
    if (!playing) return;

    let frame = 0;
    const tick = () => {
      const el = audioRef.current;
      if (el) {
        const now = el.currentTime;
        if (Math.abs(now - positionRef.current) >= 0.05) {
          positionRef.current = now;
          setPosition(now);
        }

        const total = Number.isFinite(el.duration) ? el.duration : 0;
        if (total) setDuration((prev) => (Math.abs(total - prev) > 0.01 ? total : prev));

        const ranges = el.buffered;
        const ahead = ranges.length && total ? ranges.end(ranges.length - 1) / total : 0;
        setBuffered((prev) => (Math.abs(ahead - prev) >= 0.01 ? ahead : prev));
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  useEffect(() => () => audioRef.current?.pause(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const suggest = async () => {
    stop();
    setError(null);
    setThinking(true);
    try {
      setSuggestion(await suggestBackground(text, title, chapters));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setThinking(false);
    }
  };

  const choose = useCallback(
    async (track: BackgroundTrack) => {
      setError(null);
      setBusyId(keyOf(track));
      try {
        setCopied(false);
        onStatus(await selectBackground(track.provider, track.id, level));
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusyId(null);
      }
    },
    [level, onStatus],
  );

  const commitLevel = async (next: number) => {
    setLevel(next);
    if (!status.selected) return;
    try {
      onStatus(await setBackgroundLevel(next));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async () => {
    stop();
    try {
      onStatus(await clearBackground());
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const selectedKey = status.selected ? keyOf(status.selected) : null;
  const selectedActive = Boolean(selectedKey && playing === selectedKey);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/25 p-4 backdrop-blur-[2px] sm:p-10"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-2xl rounded-card border border-line-strong bg-base shadow-[0_24px_60px_-20px_rgba(22,22,42,0.35)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Background music"
      >
        <header className="rounded-t-card border-b border-line bg-base px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-[17px] font-semibold text-ink">Background music</h2>
              <p className="text-[13px] text-muted">
                Mixed under the narration in the exported MP3, ducking whenever the voice speaks.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close background music"
              className="rounded-btn border border-line-strong p-2 text-muted hover:border-ink/30 hover:text-ink"
            >
              <X size={15} />
            </button>
          </div>
        </header>

        <div className="px-5 py-4">
          {status.selected && (
            <div className="mb-4 rounded-card border border-accent/40 bg-accent-soft px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <button
                    type="button"
                    onClick={() => toggle(status.selected!)}
                    aria-label={
                      selectedActive
                        ? `Stop ${status.selected.title}`
                        : `Play ${status.selected.title}`
                    }
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-accent/50 bg-base text-accent-ink hover:border-accent"
                  >
                    {loadingId === selectedKey ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : selectedActive ? (
                      <Square size={10} />
                    ) : (
                      <Play size={11} />
                    )}
                  </button>
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                      <Music size={13} className="shrink-0 text-accent-ink" />
                      <span className="truncate">{status.selected.title}</span>
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-muted">
                      {status.selected.author} · {status.selected.license} ·{' '}
                      {formatDuration(
                        selectedActive && duration ? duration : status.selected.durationSec,
                      )}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={remove}
                  className="flex shrink-0 items-center gap-1 rounded-btn border border-line-strong bg-base px-2 py-1.5 text-[11px] font-medium text-muted hover:border-danger/40 hover:text-danger"
                >
                  <Trash2 size={12} />
                  Remove
                </button>
              </div>

              <div className="mt-2 flex items-center gap-2">
                <Scrubber
                  duration={
                    selectedActive && duration ? duration : status.selected.durationSec
                  }
                  position={selectedActive ? position : 0}
                  buffered={selectedActive ? buffered : 0}
                  active={selectedActive}
                  label={`Scrub ${status.selected.title}`}
                  onSeek={(fraction) => seek(status.selected!, fraction)}
                />
                <span className="w-[76px] shrink-0 text-right text-[10px] tabular-nums text-muted">
                  {formatClock(selectedActive ? position : 0)} /{' '}
                  {formatClock(
                    selectedActive && duration ? duration : status.selected.durationSec,
                  )}
                </span>
              </div>

              {status.selected.attribution && (
                <div className="mt-2.5 rounded-btn border border-warning-bright/40 bg-warning-bright/10 px-2.5 py-2">
                  <p className="text-[10px] font-medium tracking-[0.08em] text-warning uppercase">
                    Credit required — paste this into your video description
                  </p>
                  <div className="mt-1 flex items-start gap-2">
                    <code className="min-w-0 flex-1 text-[11px] leading-snug break-words text-ink">
                      {status.selected.attribution}
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard
                          ?.writeText(status.selected!.attribution ?? '')
                          .then(() => setCopied(true))
                          .catch(() => setError('Could not copy the credit line.'));
                      }}
                      className="flex shrink-0 items-center gap-1 rounded-btn border border-line-strong bg-base px-2 py-1 text-[11px] font-medium text-muted hover:border-accent hover:text-ink"
                    >
                      {copied ? <Check size={11} /> : <Copy size={11} />}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              )}

              <label className="mt-3 block">
                <span className="flex items-center justify-between text-[11px] text-muted">
                  <span>Level under the voice</span>
                  <span className="tabular-nums">
                    {level} dB · {levelLabel(level)}
                  </span>
                </span>
                <input
                  type="range"
                  min={status.levelRange.min}
                  max={status.levelRange.max}
                  step={1}
                  value={level}
                  onChange={(e) => void commitLevel(Number(e.target.value))}
                  className="mt-1.5 w-full"
                  aria-label="Background level"
                />
              </label>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={suggest}
              disabled={thinking || !text}
              className="flex h-[38px] items-center justify-center gap-1.5 rounded-btn bg-accent px-3.5 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-line-strong disabled:text-faint"
            >
              {thinking ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
              {suggestion ? 'Suggest again' : 'Suggest a background'}
            </button>
            <p className="text-[11px] text-muted">
              {status.ai
                ? 'Gemini reads an excerpt to pick the mood'
                : 'Mood is worked out on this machine'}{' '}
              · tracks from {status.library}
            </p>
          </div>

          {error && (
            <p className="mt-3 rounded-btn border border-danger/30 bg-danger/5 px-3 py-2 text-[12px] text-danger">
              {error}
            </p>
          )}

          {suggestion && (
            <div className="mt-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-ink">
                  {suggestion.label}
                </span>
                <span
                  className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    suggestion.source === 'gemini'
                      ? 'bg-accent-soft text-accent-ink'
                      : 'bg-surface text-muted'
                  }`}
                >
                  <Sparkles size={10} />
                  {suggestion.source === 'gemini' ? 'Gemini' : 'On-device'}
                </span>
                {suggestion.terms.map((term) => (
                  <span key={term} className="text-[11px] text-faint">
                    “{term}”
                  </span>
                ))}
              </div>

              {suggestion.reason && (
                <p className="mt-2 text-[12px] leading-relaxed text-muted">{suggestion.reason}</p>
              )}

              <ul className="mt-3 divide-y divide-line border-t border-line">
                {suggestion.tracks.map((track) => {
                  const id = keyOf(track);
                  const live = playing === id;
                  return (
                    <TrackRow
                      key={id}
                      track={track}
                      active={live}
                      loading={loadingId === id}
                      busy={busyId === id}
                      chosen={selectedKey === id}
                      position={live ? position : 0}
                      duration={live ? duration : 0}
                      buffered={live ? buffered : 0}
                      onToggle={toggle}
                      onSeek={seek}
                      onChoose={choose}
                    />
                  );
                })}
              </ul>

              {!suggestion.tracks.length && (
                <p className="mt-3 text-[12px] text-muted">
                  Nothing came back for those search terms. Try suggesting again.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
