import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Music, Play, Sparkles, Square, Trash2, Wand2, X } from 'lucide-react';
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

function levelLabel(db: number): string {
  if (db <= -28) return 'barely there';
  if (db <= -20) return 'background';
  if (db <= -14) return 'present';
  return 'forward';
}

export function BackgroundPicker({ text, title, chapters, status, onStatus, onClose }: Props) {
  const [suggestion, setSuggestion] = useState<BackgroundSuggestion | null>(null);
  const [thinking, setThinking] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(status.level);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stop = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(null);
  };

  useEffect(() => () => audioRef.current?.pause(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const key = (track: BackgroundTrack) => `${track.provider}:${track.id}`;

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

  const preview = (track: BackgroundTrack) => {
    if (playing === key(track)) return stop();
    stop();
    setError(null);

    const audio = new Audio(backgroundAudioUrl(track.provider, track.id));
    audio.volume = 0.7;
    audioRef.current = audio;
    audio.onended = stop;
    audio.onerror = () => {
      setError(`Could not play "${track.title}".`);
      stop();
    };
    setPlaying(key(track));
    void audio.play().catch(() => {
      setError(`Could not play "${track.title}".`);
      stop();
    });
  };

  const choose = async (track: BackgroundTrack) => {
    setError(null);
    setBusyId(key(track));
    try {
      onStatus(await selectBackground(track.provider, track.id, level));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

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

  const selectedKey = status.selected ? key(status.selected) : null;

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
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                    <Music size={13} className="shrink-0 text-accent-ink" />
                    <span className="truncate">{status.selected.title}</span>
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-muted">
                    {status.selected.author} · {status.selected.license} ·{' '}
                    {formatDuration(status.selected.durationSec)}
                  </p>
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
                  const id = key(track);
                  return (
                    <li key={id} className="flex items-center gap-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => preview(track)}
                        aria-label={playing === id ? `Stop ${track.title}` : `Play ${track.title}`}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line-strong text-muted hover:border-accent hover:text-accent-ink"
                      >
                        {playing === id ? <Square size={11} /> : <Play size={12} />}
                      </button>

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-ink">{track.title}</p>
                        <p className="truncate text-[11px] text-muted">
                          {track.author} · {formatDuration(track.durationSec)} · {track.license}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => void choose(track)}
                        disabled={busyId === id}
                        className={`flex h-8 shrink-0 items-center gap-1 rounded-btn px-2.5 text-[12px] font-medium disabled:opacity-50 ${
                          selectedKey === id
                            ? 'bg-accent-soft text-accent-ink'
                            : 'border border-line-strong text-muted hover:border-accent hover:text-ink'
                        }`}
                      >
                        {busyId === id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : selectedKey === id ? (
                          <Check size={12} />
                        ) : null}
                        {selectedKey === id ? 'In use' : 'Use'}
                      </button>
                    </li>
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
