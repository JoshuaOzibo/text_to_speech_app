import type { Book, GeneratedAudio, VoicesResponse } from '../types';

/**
 * All requests use relative URLs. In development Vite proxies /api to the
 * Express server on port 3001; in production the backend serves both.
 */

/** Pull the backend's error message out of a failed response. */
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

/**
 * Metadata for the last MP3 the server produced, or null if there isn't one.
 * Used to recover audio from a run this page didn't receive a response for.
 */
export async function fetchResult(): Promise<GeneratedAudio | null> {
  const response = await fetch('/api/result');
  if (!response.ok) return null;
  return response.json();
}

/**
 * Narrate just the first chunk of the uploaded book, so the opening can be
 * heard before committing to a full run. Returns an object URL for playback.
 */
export async function previewFirstChunk(
  text: string,
  voice: string,
  speed: number,
): Promise<string> {
  const response = await fetch('/api/preview-book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice, speed }),
  });
  if (!response.ok) {
    throw new Error(await readError(response, 'Could not generate a preview.'));
  }
  return URL.createObjectURL(await response.blob());
}

/** URL of a short spoken sample for one voice, streamed as WAV. */
export function previewUrl(voice: string, speed: number): string {
  return `/api/preview?voice=${encodeURIComponent(voice)}&speed=${speed.toFixed(1)}`;
}

/** The paragraph every voice reads when previewed. */
export async function fetchSampleText(): Promise<string> {
  const response = await fetch('/api/preview/sample');
  if (!response.ok) throw new Error('Could not load the sample text.');
  const body = await response.json();
  return body.text as string;
}

/** URL for the download endpoint, naming the file after the source book. */
export function downloadUrl(bookName: string): string {
  return `/api/download?name=${encodeURIComponent(bookName)}`;
}
