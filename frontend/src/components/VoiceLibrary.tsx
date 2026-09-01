import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Play, Search, Square, X } from 'lucide-react';
import { previewUrl } from '../lib/api';
import { voiceTitle } from '../lib/voice';
import type { Voice } from '../types';

interface Props {
  voices: Voice[];
  selected: string;
  speed: number;
  onSelect: (voiceId: string) => void;
  onClose: () => void;
}

/** Turn a realtime factor into the number people actually care about. */
function costPerHour(speedFactor?: number | null): string | null {
  if (!speedFactor) return null;
  const minutes = Math.round(speedFactor * 60);
  return minutes >= 60
    ? `~${(minutes / 60).toFixed(1)} hr of compute per hour of audio`
    : `~${minutes} min of compute per hour of audio`;
}

/** Colour the quality chip so the good voices are findable at a glance. */
function qualityTone(voice: Voice): string {
  const q = voice.quality;
  if (q === 'high' || q.startsWith('A') || q.startsWith('B')) {
    return 'border-success-bright/50 bg-success-bright/10 text-success';
  }
  if (q === 'medium' || q === 'neural' || q.startsWith('C')) {
    return 'border-warning-bright bg-warning-bright/15 text-warning';
  }
  return 'border-line-strong bg-surface text-muted';
}

/**
 * Full-catalogue voice browser.
 *
 * The panel list is for picking a voice you already know; this is for finding
 * one. Every voice can be auditioned in place, and each says what it is actually
 * good for — which matters most for the cost of a full book, where a "high"
 * quality voice is roughly six times slower than a "low" one.
 */
export function VoiceLibrary({ voices, selected, speed, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [playing, setPlaying] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stop = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(null);
    setLoading(null);
  };

  // Never leave a sample playing when the panel closes.
  useEffect(() => () => audioRef.current?.pause(), []);

  // Escape closes, matching every other dialog people have used.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const play = (voice: Voice) => {
    if (playing === voice.id || loading === voice.id) return stop();
    stop();
    setError(null);
    setLoading(voice.id);

    const audio = new Audio(previewUrl(voice.id, speed));
    audioRef.current = audio;
    // The first sample for a voice is synthesised on demand, so "loading" has to
    // last until playback actually starts, not until the request is sent.
    audio.onplaying = () => {
      setLoading(null);
      setPlaying(voice.id);
    };
    audio.onended = stop;
    audio.onerror = () => {
      setError(`Could not preview ${voiceTitle(voice)}.`);
      stop();
    };
    void audio.play().catch(() => {
      setError(`Could not preview ${voiceTitle(voice)}.`);
      stop();
    });
  };

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = needle
      ? voices.filter((v) =>
          [v.name, v.label, v.group, v.bestFor, v.gender].join(' ').toLowerCase().includes(needle),
        )
      : voices;

    return matches.reduce<Record<string, Voice[]>>((acc, voice) => {
      (acc[voice.group] ||= []).push(voice);
      return acc;
    }, {});
  }, [voices, query]);

  const total = Object.values(groups).reduce((n, g) => n + g.length, 0);

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
        aria-label="Voice library"
      >
        <header className="sticky top-0 z-10 rounded-t-card border-b border-line bg-base px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-[17px] font-semibold text-ink">Voice Library</h2>
              <p className="text-[13px] text-muted">
                {total} of {voices.length} voices · play any of them to compare
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close voice library"
              className="rounded-btn border border-line-strong p-2 text-muted hover:border-ink/30 hover:text-ink"
            >
              <X size={15} />
            </button>
          </div>

          <div className="relative mt-3">
            <Search
              size={14}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, accent, or what it suits…"
              className="h-10 w-full rounded-btn border border-line-strong bg-surface pr-3 pl-9 text-[13px] text-ink outline-none placeholder:text-faint hover:border-accent/50 focus:border-accent focus:bg-base"
            />
          </div>

          {error && <p className="mt-2 text-[13px] text-danger">{error}</p>}
        </header>

        <div className="px-5 py-4">
          {total === 0 && (
            <p className="py-10 text-center text-[13px] text-faint">No voices match “{query}”.</p>
          )}

          {Object.entries(groups).map(([group, list]) => (
            <section key={group} className="mb-6 last:mb-0">
              <h3 className="mb-2 text-[10px] font-medium tracking-[0.12em] text-faint uppercase">
                {group} ({list.length})
              </h3>

              <ul className="space-y-1.5">
                {list.map((voice) => {
                  const isSelected = voice.id === selected;
                  const cost = costPerHour(voice.speedFactor);

                  return (
                    <li
                      key={voice.id}
                      className={`flex items-start gap-3 rounded-btn border px-3 py-2.5 ${
                        isSelected
                          ? 'border-accent bg-accent-soft'
                          : 'border-line bg-base hover:border-line-strong'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => play(voice)}
                        aria-label={`Preview ${voiceTitle(voice)}`}
                        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line-strong text-muted hover:border-accent hover:text-accent"
                      >
                        {loading === voice.id ? (
                          <Loader2 size={13} className="animate-spin text-accent" />
                        ) : playing === voice.id ? (
                          <Square size={11} className="text-accent" />
                        ) : (
                          <Play size={12} className="ml-0.5" />
                        )}
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-[14px] font-medium text-ink">
                            {voiceTitle(voice)}
                          </span>
                          <span
                            className={`rounded border px-1.5 py-0.5 text-[11px] ${qualityTone(voice)}`}
                          >
                            {voice.quality}
                          </span>
                          {voice.gender && (
                            <span className="text-[12px] text-muted">{voice.gender}</span>
                          )}
                        </div>

                        {voice.bestFor && (
                          <p className="mt-0.5 text-[13px] leading-snug text-muted">
                            {voice.bestFor}
                          </p>
                        )}
                        {cost && <p className="mt-0.5 text-[11px] text-faint">{cost}</p>}
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          onSelect(voice.id);
                          stop();
                        }}
                        className={`mt-0.5 shrink-0 rounded-btn px-3 py-1.5 text-[12px] font-medium ${
                          isSelected
                            ? 'bg-accent text-white'
                            : 'border border-line-strong text-muted hover:border-accent hover:text-accent-ink'
                        }`}
                      >
                        {isSelected ? (
                          <span className="flex items-center gap-1">
                            <Check size={12} /> Selected
                          </span>
                        ) : (
                          'Use'
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
