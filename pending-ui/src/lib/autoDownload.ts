import type { GeneratedAudio } from '../types';

const KEY = 'localaudiobook.autoDownloaded';

function filenameFor(bookName: string): string {
  const base = String(bookName || 'audiobook')
    .replace(/\.[^.]+$/, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
  return `${base || 'audiobook'}.mp3`;
}

function stampOf(audio: GeneratedAudio): string {
  return `${audio.sizeBytes}:${audio.duration}`;
}

export function alreadyDownloaded(audio: GeneratedAudio): boolean {
  try {
    return localStorage.getItem(KEY) === stampOf(audio);
  } catch {
    return false;
  }
}

export function autoDownload(audio: GeneratedAudio, bookName: string): boolean {
  if (alreadyDownloaded(audio)) return false;

  const link = document.createElement('a');
  link.href = '/api/audio/output.mp3';
  link.download = filenameFor(bookName);
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();

  try {
    localStorage.setItem(KEY, stampOf(audio));
  } catch {
  }

  return true;
}
