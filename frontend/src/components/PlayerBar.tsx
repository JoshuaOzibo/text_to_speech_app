import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
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
import { WordClock } from '../lib/wordClock';
import type { LiveNarration } from '../hooks/useReadAloud';
import type { Chapter, GeneratedAudio } from '../types';

interface Props {
  audio: GeneratedAudio | null;
  live: LiveNarration | null;
  title: string;
  voiceLabel?: string;
  bookName: string;
  chapters: Chapter[];
  words: string[];
  onProgress: (fraction: number | null) => void;
  onWord: (index: number) => void;
}

const SKIP_SECONDS = 15;
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
  children: ReactNode;
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

export function PlayerBar({
  audio,
  live,
  title,
  voiceLabel,
  bookName,
  chapters,
  words,
  onProgress,
  onWord,
}: Props) {
  const ref = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [elementDuration, setElementDuration] = useState(audio?.duration || 0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [shouldPlay, setShouldPlay] = useState(false);

  const isLive = !audio && Boolean(live?.available);
  const source = audio ? audio.audioUrl : isLive ? live?.url ?? null : null;
  const ready = Boolean(audio) || isLive;

  const appliedEpoch = useRef(-1);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setShouldPlay(false);
    setElementDuration(audio?.duration || 0);
  }, [audio?.audioUrl, audio?.duration]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !isLive || !live || !live.url) return;
    if (appliedEpoch.current === live.epoch) return;

    const epoch = live.epoch;
    const startAt = live.startAt;

    const apply = () => {
      if (appliedEpoch.current === epoch) return;
      appliedEpoch.current = epoch;
      if (startAt > 0) el.currentTime = startAt;
      setCurrentTime(el.currentTime);
      if (shouldPlay) void el.play();
    };

    if (el.readyState >= HTMLMediaElement.HAVE_METADATA) {
      apply();
      return;
    }

    el.addEventListener('loadedmetadata', apply);
    return () => el.removeEventListener('loadedmetadata', apply);
  }, [isLive, live, shouldPlay]);

  const bookTime = isLive ? (live?.offset ?? 0) + currentTime : currentTime;
  const bookDuration = isLive ? live?.total ?? 0 : elementDuration;

  useEffect(() => {
    onProgress(isPlaying && bookDuration > 0 ? bookTime / bookDuration : null);
  }, [isPlaying, bookTime, bookDuration, onProgress]);

  const timeline = audio ? audio.timeline : live?.timeline ?? null;

  const clock = useMemo(
    () => (timeline ? new WordClock(timeline, words) : null),
    [timeline, words],
  );

  useEffect(() => {
    if (!clock || !isPlaying) return;

    let frame = 0;
    let last = -1;

    const tick = () => {
      const el = ref.current;
      if (el) {
        const index = clock.wordAt(el.currentTime);
        if (index !== last) {
          last = index;
          onWord(index);
        }
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [clock, isPlaying, onWord]);

  useEffect(() => {
    if (!isPlaying && !(isLive && shouldPlay)) onWord(-1);
  }, [isPlaying, isLive, shouldPlay, onWord]);

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

  const fraction = bookDuration > 0 ? bookTime / bookDuration : 0;
  const currentChapter = marks.length ? marks[chapterAt(fraction)] : null;

  const seekTo = (value: number) => {
    const el = ref.current;
    const target = Math.max(0, Math.min(bookDuration || 0, value));

    if (isLive && live) {
      const start = live.offset;
      if (el && target >= start && target < start + elementDuration) {
        el.currentTime = target - start;
        setCurrentTime(el.currentTime);
        return;
      }
      live.seek(target);
      return;
    }

    if (!el) return;
    el.currentTime = target;
    setCurrentTime(target);
  };

  const toggle = () => {
    const el = ref.current;

    if (isLive && live && (!live.url || !live.active)) {
      setShouldPlay(true);
      live.begin();
      return;
    }

    if (!el) return;
    if (el.paused) {
      setShouldPlay(true);
      void el.play();
    } else {
      setShouldPlay(false);
      el.pause();
    }
  };

  const previousChapter = () => {
    if (!marks.length || !bookDuration) return seekTo(0);
    const index = chapterAt(fraction);
    const startedAt = marks[index].start * bookDuration;
    if (index === 0 || bookTime - startedAt > RESTART_WINDOW) seekTo(startedAt);
    else seekTo(marks[index - 1].start * bookDuration);
  };

  const nextChapter = () => {
    if (!marks.length || !bookDuration) return;
    const index = chapterAt(fraction);
    if (index + 1 < marks.length) seekTo(marks[index + 1].start * bookDuration);
  };

  const atLastChapter = marks.length > 0 && chapterAt(fraction) === marks.length - 1;
  const percent = bookDuration > 0 ? (bookTime / bookDuration) * 100 : 0;
  const showPause = isPlaying || (isLive && shouldPlay && Boolean(live?.buffering));

  const subtitle = (() => {
    if (!ready) return live?.preparing ? 'Preparing the book…' : 'No book open yet';
    if (isLive) {
      if (live?.error) return live.error;
      if (live?.buffering) return 'Narrating preparing the next part…';
      if (live?.active) {
        return currentChapter
          ? `${currentChapter.title} · reading aloud`
          : `Reading aloud · part ${(live?.index ?? 0) + 1} of ${live?.totalChunks ?? 0}`;
      }
      return 'Ready to read aloud press play';
    }
    return currentChapter ? currentChapter.title : voiceLabel;
  })();

  return (
    <footer className="shrink-0 border-t border-line bg-panel">
      {source && (
        <audio
          ref={ref}
          src={source}
          preload="metadata"
          loop={repeat && !isLive}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => {
            setIsPlaying(false);
            if (!isLive || !live) return;
            if (live.atEnd) setShouldPlay(false);
            live.next();
          }}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            const value = e.currentTarget.duration;
            if (Number.isFinite(value) && value > 0) setElementDuration(value);
          }}
        />
      )}

      <div className="flex items-center gap-3 px-4 pt-2">
        <span className="w-12 shrink-0 text-right text-[11px] font-light text-muted tabular-nums">
          {formatTime(bookTime)}
        </span>
        <input
          type="range"
          min={0}
          max={bookDuration || 0}
          step={0.1}
          value={Math.min(bookTime, bookDuration || 0)}
          disabled={!ready || !bookDuration}
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
          {isLive && !audio ? `~${formatTime(bookDuration)}` : formatTime(bookDuration)}
        </span>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 pt-1 pb-2.5">
        <div className="hidden min-w-0 sm:block">
          <p className="flex items-center gap-2 text-[13px] font-medium">
            <span className={`truncate ${ready ? 'text-ink' : 'text-faint'}`} title={title}>
              {title}
            </span>
            {isLive && live?.active && (
              <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-accent-ink uppercase">
                Live
              </span>
            )}
          </p>
          <p className={`truncate text-[11px] ${live?.error ? 'text-danger' : 'text-muted'}`}>
            {subtitle}
          </p>
        </div>

        <div className="col-start-2 flex items-center gap-0.5 rounded-full border border-line bg-base px-1.5 py-1">
          <TransportButton
            label={repeat ? 'Repeat on' : 'Repeat off'}
            active={repeat}
            disabled={!ready || isLive}
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
            onClick={() => seekTo(bookTime - SKIP_SECONDS)}
          >
            <Rewind size={16} />
          </TransportButton>

          <button
            type="button"
            onClick={toggle}
            disabled={!ready}
            aria-label={showPause ? 'Pause' : 'Play'}
            title={
              ready
                ? showPause
                  ? 'Pause'
                  : isLive
                    ? 'Read the book aloud'
                    : 'Play'
                : 'Open a book first'
            }
            className="mx-1 flex h-11 w-11 items-center justify-center rounded-full bg-accent text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-line-strong disabled:text-faint"
          >
            {showPause ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
          </button>

          <TransportButton
            label={`Forward ${SKIP_SECONDS} seconds`}
            disabled={!ready}
            onClick={() => seekTo(bookTime + SKIP_SECONDS)}
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

          {audio ? (
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
              title={isLive ? 'Generate the MP3 to download it' : 'Download MP3'}
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
