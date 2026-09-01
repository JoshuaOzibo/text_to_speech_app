import { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutGrid, Loader2, Play, Search, Square } from 'lucide-react';
import { previewUrl } from '../lib/api';
import { voiceGradient, voiceInitials, voiceSubtitle, voiceTitle } from '../lib/voice';
import type { Voice } from '../types';

interface Props {
  voices: Voice[];
  value: string;
  speed: number;
  disabled: boolean;
  onChange: (voiceId: string) => void;
  onBrowse: () => void;
}

/**
 * Voice list with in-place auditioning.
 *
 * Each sample is synthesised by the same engine call the real narration uses, at
 * the selected speed, and the server caches it — so the first play of a voice
 * takes a few seconds and every later one is instant.
 */
export function VoicePicker({ voices, value, speed, disabled, onChange, onBrowse }: Props) {
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

  // Changing speed invalidates whatever is playing, and nothing should outlive
  // the component.
  useEffect(() => stop(), [speed]);
  useEffect(() => () => audioRef.current?.pause(), []);

  const play = (voice: Voice) => {
    if (playing === voice.id || loading === voice.id) return stop();
    stop();
    setError(null);
    setLoading(voice.id);

    const el = new Audio(previewUrl(voice.id, speed));
    audioRef.current = el;
    // The first sample for a voice is synthesised on demand, so "loading" has to
    // last until playback actually starts, not until the request is sent.
    el.onplaying = () => {
      setLoading(null);
      setPlaying(voice.id);
    };
    el.onended = stop;
    el.onerror = () => {
      setError(`Could not preview ${voiceTitle(voice)}.`);
      stop();
    };
    void el.play().catch(() => {
      setError(`Could not preview ${voiceTitle(voice)}.`);
      stop();
    });
  };

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = needle
      ? voices.filter((voice) =>
          [voice.name, voice.label, voice.group, voice.bestFor, voice.gender]
            .join(' ')
            .toLowerCase()
            .includes(needle),
        )
      : voices;

    return matches.reduce<Record<string, Voice[]>>((acc, voice) => {
      (acc[voice.group || 'Other'] ||= []).push(voice);
      return acc;
    }, {});
  }, [voices, query]);

  const total = Object.values(groups).reduce((n, group) => n + group.length, 0);

  if (!voices.length) {
    return (
      <div className="rounded-card border border-warning-bright bg-warning-bright/8 px-3.5 py-3">
        <p className="text-[13px] font-medium text-ink">No voice models found</p>
        <p className="mt-1 text-[12px] leading-relaxed text-muted">
          Download at least one into{' '}
          <code className="rounded bg-surface px-1 py-0.5 text-[11px]">backend/piper/voices/</code>{' '}
          — the README has the links.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="relative">
        <Search
          size={13}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search voices…"
          aria-label="Search voices"
          className="h-9 w-full rounded-btn border border-line-strong bg-surface pr-3 pl-8 text-[13px] text-ink outline-none placeholder:text-faint hover:border-accent/50 focus:border-accent focus:bg-base"
        />
      </div>

      <div className="mt-2 max-h-[280px] overflow-y-auto">
        {total === 0 && (
          <p className="px-1 py-6 text-center text-[12px] text-faint">
            No voices match “{query}”.
          </p>
        )}

        {Object.entries(groups).map(([group, list]) => (
          <div key={group}>
            <p className="sticky top-0 z-10 bg-panel/95 py-1.5 text-[10px] font-medium tracking-[0.12em] text-faint uppercase backdrop-blur-sm">
              {group}
            </p>
            <ul>
              {list.map((voice) => {
                const selected = voice.id === value;
                const busy = loading === voice.id || playing === voice.id;

                return (
                  <li key={voice.id}>
                    <div
                      className={`group flex items-center gap-2.5 rounded-btn border-l-[3px] py-1.5 pr-1 pl-2 ${
                        selected
                          ? 'border-accent bg-accent-soft'
                          : 'border-transparent hover:bg-surface'
                      }`}
                    >
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onChange(voice.id)}
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <span
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                          style={{ backgroundImage: voiceGradient(voice) }}
                          aria-hidden="true"
                        >
                          {voiceInitials(voice)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-medium text-ink">
                            {voiceTitle(voice)}
                          </span>
                          <span className="block truncate text-[12px] text-muted">
                            {voiceSubtitle(voice)}
                          </span>
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => play(voice)}
                        aria-label={
                          busy
                            ? `Stop preview of ${voiceTitle(voice)}`
                            : `Preview ${voiceTitle(voice)}`
                        }
                        className={`shrink-0 rounded-full p-1.5 text-accent hover:bg-accent/10 ${
                          busy ? '' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                        }`}
                      >
                        {loading === voice.id ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : playing === voice.id ? (
                          <Square size={12} />
                        ) : (
                          <Play size={13} />
                        )}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}

      <button
        type="button"
        onClick={onBrowse}
        className="mt-2 flex items-center gap-1.5 text-[12px] text-muted hover:text-accent-ink"
      >
        <LayoutGrid size={12} />
        Compare all {voices.length} voices
      </button>
    </div>
  );
}
