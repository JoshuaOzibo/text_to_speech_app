import { Download } from 'lucide-react';
import { downloadUrl } from '../lib/api';
import type { GeneratedAudio } from '../types';

interface Props {
  audio: GeneratedAudio | null;
  bookName: string;
}

function formatSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatMinutes(seconds: number): string {
  if (!seconds) return '';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hr ${minutes % 60} min`;
}

/**
 * Download the finished MP3.
 *
 * A plain anchor rather than fetch + blob: the browser streams the file straight
 * to disk, which matters for multi-hour books that would otherwise have to be
 * held in memory first.
 */
export function DownloadButton({ audio, bookName }: Props) {
  if (!audio) {
    return (
      <div
        aria-disabled="true"
        className="flex h-12 w-full cursor-not-allowed items-center justify-center gap-2 rounded-btn border-[1.5px] border-line-strong text-[14px] font-medium text-faint"
      >
        <Download size={16} />
        Download MP3
      </div>
    );
  }

  const details = [
    'output.mp3',
    formatMinutes(audio.duration),
    formatSize(audio.sizeBytes),
  ].filter(Boolean);

  return (
    <a
      href={downloadUrl(bookName)}
      download
      className="flex h-12 w-full flex-col items-center justify-center rounded-btn border-[1.5px] border-success-bright bg-success-bright/6 hover:bg-success-bright/12"
    >
      <span className="flex items-center gap-2 text-[14px] font-medium text-success">
        <Download size={16} />
        Download MP3
      </span>
      <span className="mt-0.5 text-[11px] text-muted">{details.join(' · ')}</span>
    </a>
  );
}
