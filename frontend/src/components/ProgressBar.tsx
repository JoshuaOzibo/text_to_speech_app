import { X } from 'lucide-react';
import type { Progress } from '../types';

interface Props {
  progress: Progress;
  /** True when this run was started elsewhere — another tab, or before a reload. */
  isAdopted?: boolean;
  onCancel: () => void;
}

function describe(progress: Progress): string {
  switch (progress.status) {
    case 'starting':
      return 'Preparing text…';
    case 'generating':
      return progress.totalChunks
        ? `Generating chunk ${progress.chunk ?? 0} of ${progress.totalChunks}…`
        : 'Generating audio…';
    case 'processing':
      return 'Levelling volume and smoothing joins…';
    case 'merging':
      return 'Mastering and encoding MP3…';
    case 'done':
      return 'Finished.';
    default:
      return 'Working…';
  }
}

/** Live generation progress, driven by the SSE stream. */
export function ProgressBar({ progress, isAdopted = false, onCancel }: Props) {
  const percent = Math.min(100, Math.max(0, progress.progress || 0));

  return (
    <div>
      {isAdopted && (
        <p className="mb-2.5 rounded-btn border border-warning-bright bg-warning-bright/10 px-3 py-2 text-[12px] leading-relaxed text-ink">
          A run started earlier is still going. Wait for it, or cancel it to start a new one.
        </p>
      )}

      <div
        className="h-[5px] w-full overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Audio generation progress"
      >
        <div className="progress-fill h-full rounded-full" style={{ width: `${percent}%` }} />
      </div>

      <div className="mt-2.5 flex items-start justify-between gap-3">
        <p className="min-w-0 text-[12px] leading-snug text-muted">{describe(progress)}</p>
        <span className="shrink-0 text-[12px] font-medium text-accent-ink tabular-nums">
          {percent}%
        </span>
      </div>

      <button
        type="button"
        onClick={onCancel}
        className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-btn border border-line-strong text-[13px] font-medium text-muted hover:border-danger hover:text-danger"
      >
        <X size={13} />
        Cancel
      </button>
    </div>
  );
}
