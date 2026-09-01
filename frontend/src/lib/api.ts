import type { Book, GeneratedAudio, Timeline, VoicesResponse } from '../types';

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    return body?.error || fallback;
  } catch {
    return fallback;
  }
}

export async function fetchVoices(): Promise<VoicesResponse> {
  const response = await fetch('/api/voices');
  if (!response.ok) {
    throw new Error(await readError(response, 'Could not load the voice list.'));
  }
  return response.json();
}

export async function uploadBook(file: File): Promise<Book> {
  const form = new FormData();
  form.append('file', file);

  const response = await fetch('/api/upload', { method: 'POST', body: form });
  if (!response.ok) {
    throw new Error(await readError(response, 'Upload failed.'));
  }
  return response.json();
}

export async function generateAudio(
  text: string,
  voice: string,
  speed: number,
  signal?: AbortSignal,
): Promise<GeneratedAudio> {
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice, speed }),
    signal,
  });
  if (!response.ok) {
    throw new Error(await readError(response, 'Audio generation failed.'));
  }
  return response.json();
}

export async function cancelGeneration(): Promise<void> {
  await fetch('/api/cancel', { method: 'POST' });
}

export async function fetchResult(): Promise<GeneratedAudio | null> {
  const response = await fetch('/api/result');
  if (!response.ok) return null;
  return response.json();
}

export async function previewFirstChunk(
  text: string,
  voice: string,
  speed: number,
): Promise<{ url: string; timeline: Timeline | null }> {
  const response = await fetch('/api/preview-book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice, speed }),
  });
  if (!response.ok) {
    throw new Error(await readError(response, 'Could not generate a preview.'));
  }

  let timeline: Timeline | null = null;
  try {
    const header = response.headers.get('X-Word-Timeline');
    if (header) timeline = JSON.parse(header) as Timeline;
  } catch {
  }

  return { url: URL.createObjectURL(await response.blob()), timeline };
}

export function previewUrl(voice: string, speed: number): string {
  return `/api/preview?voice=${encodeURIComponent(voice)}&speed=${speed.toFixed(1)}`;
}

export async function fetchSampleText(): Promise<string> {
  const response = await fetch('/api/preview/sample');
  if (!response.ok) throw new Error('Could not load the sample text.');
  const body = await response.json();
  return body.text as string;
}

export function downloadUrl(bookName: string): string {
  return `/api/download?name=${encodeURIComponent(bookName)}`;
}
