import { Headphones, Loader2, Play, Square } from 'lucide-react';
import { DownloadButton } from './DownloadButton';
import { ProgressBar } from './ProgressBar';
import { SpeedControl } from './SpeedControl';
import { StatusMessage, type StatusTone } from './StatusMessage';
import { VoicePicker } from './VoicePicker';
import type { GeneratedAudio, Progress, Voice } from '../types';

interface Props {
  voices: Voice[];
  voice: string;
  speed: number;
  isGenerating: boolean;
  isAdopted: boolean;
  canGenerate: boolean;
  progress: Progress;
  audio: GeneratedAudio | null;
  bookName: string;
  status: { tone: StatusTone; message: string } | null;
  isSampling: boolean;
  isSamplePlaying: boolean;
  sampleError: string | null;
  onVoice: (voiceId: string) => void;
  onSpeed: (speed: number) => void;
  onBrowseVoices: () => void;
  onGenerate: () => void;
  onCancel: () => void;
  onPreview: () => void;
}

/**
 * Right panel: pick a voice, set the speed, generate, download.
 *
 * Playback itself lives in the pinned bar along the bottom of the window, so it
 * stays put no matter which view the centre panel is showing.
 */
export function ControlsPanel({
  voices,
  voice,
  speed,
  isGenerating,
  isAdopted,
  canGenerate,
  progress,
  audio,
  bookName,
  status,
  isSampling,
  isSamplePlaying,
  sampleError,
  onVoice,
  onSpeed,
  onBrowseVoices,
  onGenerate,
  onCancel,
  onPreview,
}: Props) {
  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex-1 overflow-y-auto">
        <section className="px-4 py-4">
          <p className="mb-2.5 text-[10px] font-medium tracking-[0.12em] text-faint uppercase">
            Voice
          </p>
          <VoicePicker
            voices={voices}
            value={voice}
            speed={speed}
            disabled={isGenerating}
            onChange={onVoice}
            onBrowse={onBrowseVoices}
          />
        </section>

        <section className="border-t border-line px-4 py-4">
          <SpeedControl value={speed} disabled={isGenerating} onChange={onSpeed} />
        </section>

        <section className="border-t border-line px-4 py-4">
          {isGenerating ? (
            <ProgressBar progress={progress} isAdopted={isAdopted} onCancel={onCancel} />
          ) : (
            <>
              <div className="flex gap-2">
                {/* Hear the real opening before committing to a multi-hour run. */}
                <button
                  type="button"
                  disabled={!canGenerate || isSampling}
                  onClick={onPreview}
                  className="flex h-[42px] basis-[45%] items-center justify-center gap-1.5 rounded-btn border-[1.5px] border-line-strong text-[13px] font-medium text-muted hover:border-accent hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line-strong disabled:hover:text-muted"
                >
                  {isSampling ? (
                    <Loader2 size={14} className="animate-spin text-accent" />
                  ) : isSamplePlaying ? (
                    <Square size={12} className="text-accent" />
                  ) : (
                    <Headphones size={14} />
                  )}
                  {isSamplePlaying ? 'Stop' : 'Preview'}
                </button>

                <button
                  type="button"
                  disabled={!canGenerate}
                  onClick={onGenerate}
                  className="flex h-[42px] flex-1 items-center justify-center gap-1.5 rounded-btn bg-accent text-[14px] font-medium text-white hover:-translate-y-px hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-line-strong disabled:text-faint disabled:hover:translate-y-0"
                >
                  <Play size={14} />
                  Generate
                </button>
              </div>

              {isSampling && (
                <p className="mt-2 text-[12px] text-muted animate-pulse-soft">
                  Narrating the opening chunk…
                </p>
              )}
              {sampleError && <p className="mt-2 text-[12px] text-danger">{sampleError}</p>}
            </>
          )}

          {status && (
            <div className="mt-3">
              <StatusMessage tone={status.tone} message={status.message} />
            </div>
          )}
        </section>

      </div>

      <div className="shrink-0 border-t border-line px-4 py-4">
        <DownloadButton audio={audio} bookName={bookName} />
      </div>
    </div>
  );
}
