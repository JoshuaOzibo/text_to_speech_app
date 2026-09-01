import { useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, RotateCw, Square } from 'lucide-react';
import type { GeneratedAudio } from '../types';

interface Props {
  audio: GeneratedAudio;
  title: string;
  subtitle?: string;
  /** Playback position as 0-1, reported so the reading panel can follow along. */
  onProgress?: (fraction: number | null) => void;
}

const SKIP_SECONDS = 15;

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

/**
 * Playback for the generated MP3.
 *
 * Seeking relies on the backend answering HTTP Range requests; without that the
 * browser cannot jump around inside a multi-hour file.
 */
export function AudioPlayer({ audio, title, subtitle, onProgress }: Props) {
  const ref = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  // Fall back to the server-reported duration until metadata loads.
  const [duration, setDuration] = useState(audio.duration || 0);

  // A new generation replaces the source, so reset transport state.
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(audio.duration || 0);
  }, [audio.audioUrl, audio.duration]);

  // The reading panel highlights where we are, but only while sound is playing —
  // a paused player should leave the text alone.
  useEffect(() => {
    if (!onProgress) return;
    onProgress(isPlaying && duration > 0 ? currentTime / duration : null);
  }, [isPlaying, currentTime, duration, onProgress]);

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };

  const skip = (seconds: number) => {
    const el = ref.current;
    if (!el) return;
    const next = Math.min(duration || 0, Math.max(0, el.currentTime + seconds));
    el.currentTime = next;
    setCurrentTime(next);
  };

  const stop = () => {
    const el = ref.current;
    if (!el) return;
    el.pause();
    el.currentTime = 0;
    setCurrentTime(0);
  };

  const percent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="rounded-card border border-line-strong bg-card p-4">
      <audio
        ref={ref}
        src={audio.audioUrl}
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const value = e.currentTarget.duration;
          if (Number.isFinite(value) && value > 0) setDuration(value);
        }}
      />

      <p className="text-[10px] font-medium tracking-[0.1em] text-accent-ink uppercase">
        Now playing
      </p>
      <p className="mt-1.5 truncate text-[14px] font-medium text-ink" title={title}>
        {title}
      </p>
      {subtitle && <p className="mt-0.5 truncate text-[12px] text-muted">{subtitle}</p>}

      <div className="mt-3.5 flex items-center justify-center gap-1">
        <button
          type="button"
          onClick={() => skip(-SKIP_SECONDS)}
          aria-label={`Back ${SKIP_SECONDS} seconds`}
          className="rounded-full p-2 text-muted hover:bg-surface hover:text-ink"
        >
          <RotateCcw size={16} />
        </button>

        <button
          type="button"
          onClick={toggle}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="mx-1 flex h-10 w-10 items-center justify-center rounded-full bg-accent text-white hover:bg-accent-hover"
        >
          {isPlaying ? <Pause size={17} /> : <Play size={17} className="ml-0.5" />}
        </button>

        <button
          type="button"
          onClick={() => skip(SKIP_SECONDS)}
          aria-label={`Forward ${SKIP_SECONDS} seconds`}
          className="rounded-full p-2 text-muted hover:bg-surface hover:text-ink"
        >
          <RotateCw size={16} />
        </button>

        <button
          type="button"
          onClick={stop}
          aria-label="Stop"
          className="ml-1 rounded-full p-2 text-muted hover:bg-surface hover:text-ink"
        >
          <Square size={14} />
        </button>
      </div>

      <div className="mt-3">
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={currentTime}
          disabled={!duration}
          aria-label="Seek"
          onChange={(e) => {
            const value = Number(e.target.value);
            if (ref.current) ref.current.currentTime = value;
            setCurrentTime(value);
          }}
          className="w-full"
          style={{
            background: `linear-gradient(to right, var(--color-accent) ${percent}%, var(--color-line-strong) ${percent}%)`,
            backgroundSize: '100% 4px',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            borderRadius: '999px',
          }}
        />
        <div className="mt-1 flex justify-between text-[12px] font-light text-muted tabular-nums">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
}
