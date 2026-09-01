import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  FastForward,
  Pause,
  Play,
  Repeat,
  Rewind,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { downloadUrl } from '../lib/api';
import type { Chapter, GeneratedAudio } from '../types';

interface Props {
  /** Null until a run finishes — the bar still renders, with its controls off. */
  audio: GeneratedAudio | null;
  title: string;
  voiceLabel?: string;
  bookName: string;
  chapters: Chapter[];
  /** Playback position as 0-1, reported so the reader can follow along. */
  onProgress: (fraction: number | null) => void;
}

const SKIP_SECONDS = 15;
/** Past this far into a chapter, "previous" restarts it instead of going back. */
const RESTART_WINDOW = 3;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

interface ButtonProps {
  label: string;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function TransportButton({ label, disabled, active, onClick, children }: ButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`flex h-9 w-9 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-30 ${
        active ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:bg-surface hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * The pinned transport bar, full width across the bottom of the app.
 *
 * Always on screen — it is part of the frame, not something that appears when a
 * run finishes — so the reading column always scrolls beneath a fixed bar rather
 * than reflowing the moment audio arrives. With nothing generated yet the
 * controls are visibly disabled instead of hidden.
 *
 * It owns the only <audio> element, so playback survives switching views in the
 * centre panel and reports its position upward for the reading highlight.
 *
 * Chapter positions are derived from the running word count rather than real
 * timings — no engine gives those — so chapter skips land within a few seconds
 * of the heading rather than exactly on it.
 */
export function PlayerBar({ audio, title, voiceLabel, bookName, chapters, onProgress }: Props) {
  const ref = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  // Fall back to the server-reported duration until metadata loads.
  const [duration, setDuration] = useState(audio?.duration || 0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [repeat, setRepeat] = useState(false);

  const ready = Boolean(audio);

  // A new generation replaces the source, so reset transport state.
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(audio?.duration || 0);
  }, [audio?.audioUrl, audio?.duration]);

  // The reader highlights where we are, but only while sound is actually
  // playing — a paused player should leave the text alone.
  useEffect(() => {
    onProgress(isPlaying && duration > 0 ? currentTime / duration : null);
  }, [isPlaying, currentTime, duration, onProgress]);

  /** Where each chapter starts, as a fraction of the whole book. */
  const marks = useMemo(() => {
    const total = chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);
    if (!total || chapters.length < 2) return [];
    let running = 0;
    return chapters.map((chapter) => {
      const start = running / total;
      running += chapter.wordCount;
      return { title: chapter.title, start };
    });
  }, [chapters]);

  const chapterAt = (fraction: number) => {
    let index = 0;
    for (let i = 0; i < marks.length; i += 1) {
      if (fraction >= marks[i].start) index = i;
      else break;
    }
    return index;
  };

  const fraction = duration > 0 ? currentTime / duration : 0;
  const currentChapter = marks.length ? marks[chapterAt(fraction)] : null;

  const seekTo = (value: number) => {
    const el = ref.current;
    if (!el) return;
    const next = Math.max(0, Math.min(duration || 0, value));
    el.currentTime = next;
    setCurrentTime(next);
  };

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };

  const previousChapter = () => {
    if (!marks.length || !duration) return seekTo(0);
    const index = chapterAt(fraction);
    const startedAt = marks[index].start * duration;
    // Media convention: rewind to the top of this chapter first, then step back.
    if (index === 0 || currentTime - startedAt > RESTART_WINDOW) seekTo(startedAt);
    else seekTo(marks[index - 1].start * duration);
  };

  const nextChapter = () => {
    if (!marks.length || !duration) return;
    const index = chapterAt(fraction);
    if (index + 1 < marks.length) seekTo(marks[index + 1].start * duration);
  };

  const atLastChapter = marks.length > 0 && chapterAt(fraction) === marks.length - 1;
  const percent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <footer className="shrink-0 border-t border-line bg-panel">
      {/* Only mounted once there is a real source: an <audio> with an empty src
          makes the browser log a failed media load on every render. */}
      {audio && (
      <audio
        ref={ref}
        src={audio.audioUrl}
        preload="metadata"
        loop={repeat}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const value = e.currentTarget.duration;
          if (Number.isFinite(value) && value > 0) setDuration(value);
        }}
      />
      )}

      <div className="flex items-center gap-3 px-4 pt-2">
        <span className="w-12 shrink-0 text-right text-[11px] font-light text-muted tabular-nums">
          {formatTime(currentTime)}
        </span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={currentTime}
          disabled={!ready || !duration}
          aria-label="Seek"
          onChange={(e) => seekTo(Number(e.target.value))}
          className="flex-1"
          style={{
            background: `linear-gradient(to right, var(--color-accent) ${percent}%, var(--color-line-strong) ${percent}%)`,
            backgroundSize: '100% 4px',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            borderRadius: '999px',
          }}
        />
        <span className="w-12 shrink-0 text-[11px] font-light text-muted tabular-nums">
          {formatTime(duration)}
        </span>
      </div>

      {/* Three columns so the transport sits dead centre of the window whatever
          the title on the left happens to be. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 pt-1 pb-2.5">
        <div className="hidden min-w-0 sm:block">
          <p
            className={`truncate text-[13px] font-medium ${ready ? 'text-ink' : 'text-faint'}`}
            title={title}
          >
            {title}
          </p>
          <p className="truncate text-[11px] text-muted">
            {!ready
              ? 'No audio yet — press Generate'
              : currentChapter
                ? currentChapter.title
                : voiceLabel}
          </p>
        </div>

        <div className="col-start-2 flex items-center gap-0.5 rounded-full border border-line bg-base px-1.5 py-1">
          <TransportButton
            label={repeat ? 'Repeat on' : 'Repeat off'}
            active={repeat}
            disabled={!ready}
            onClick={() => setRepeat((on) => !on)}
          >
            <Repeat size={15} />
          </TransportButton>

          <TransportButton
            label="Previous chapter"
            disabled={!ready || !marks.length}
            onClick={previousChapter}
          >
            <SkipBack size={16} />
          </TransportButton>

          <TransportButton
            label={`Back ${SKIP_SECONDS} seconds`}
            disabled={!ready}
            onClick={() => seekTo(currentTime - SKIP_SECONDS)}
          >
            <Rewind size={16} />
          </TransportButton>

          <button
            type="button"
            onClick={toggle}
            disabled={!ready}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            title={ready ? (isPlaying ? 'Pause' : 'Play') : 'Generate audio first'}
            className="mx-1 flex h-11 w-11 items-center justify-center rounded-full bg-accent text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-line-strong disabled:text-faint"
          >
            {isPlaying ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
          </button>

          <TransportButton
            label={`Forward ${SKIP_SECONDS} seconds`}
            disabled={!ready}
            onClick={() => seekTo(currentTime + SKIP_SECONDS)}
          >
            <FastForward size={16} />
          </TransportButton>

          <TransportButton
            label="Next chapter"
            disabled={!ready || !marks.length || atLastChapter}
            onClick={nextChapter}
          >
            <SkipForward size={16} />
          </TransportButton>

          {ready ? (
            <a
              href={downloadUrl(bookName)}
              download
              title="Download MP3"
              aria-label="Download MP3"
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-success"
            >
              <Download size={16} />
            </a>
          ) : (
            <span
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center rounded-full text-faint opacity-30"
            >
              <Download size={16} />
            </span>
          )}
        </div>

        <div className="col-start-3 hidden items-center justify-end gap-2 sm:flex">
          <button
            type="button"
            onClick={() => {
              const next = !muted;
              setMuted(next);
              if (ref.current) ref.current.muted = next;
            }}
            disabled={!ready}
            aria-label={muted ? 'Unmute' : 'Mute'}
            title={muted ? 'Unmute' : 'Mute'}
            className="rounded-full p-1.5 text-muted hover:bg-surface hover:text-ink disabled:opacity-30"
          >
            {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            disabled={!ready}
            aria-label="Volume"
            onChange={(e) => {
              const value = Number(e.target.value);
              setVolume(value);
              setMuted(false);
              if (ref.current) {
                ref.current.volume = value;
                ref.current.muted = false;
              }
            }}
            className="w-20"
            style={{
              background: `linear-gradient(to right, var(--color-accent) ${
                (muted ? 0 : volume) * 100
              }%, var(--color-line-strong) ${(muted ? 0 : volume) * 100}%)`,
              backgroundSize: '100% 4px',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
              borderRadius: '999px',
            }}
          />
        </div>
      </div>
    </footer>
  );
}
