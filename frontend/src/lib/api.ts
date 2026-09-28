import type {
  BackgroundStatus,
  BackgroundSuggestion,
  Book,
  BookRescan,
  ChunkRun,
  GeneratedAudio,
  ReadChunk,
  ReadPlan,
  SummaryEvent,
  SummaryPlan,
  SummaryProvider,
  SummaryProviderId,
  SummaryResult,
  SummaryStructure,
  TextReport,
  Timeline,
  VoicesResponse,
} from '../types';

export class RequestError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'RequestError';
    this.code = code;
  }
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    return body?.error || fallback;
  } catch {
    return fallback;
  }
}

async function fail(response: Response, fallback: string): Promise<RequestError> {
  try {
    const body = await response.json();
    return new RequestError(body?.error || fallback, body?.code);
  } catch {
    return new RequestError(fallback);
  }
}

function readTimelineHeader(response: Response): Timeline | null {
  try {
    const header = response.headers.get('X-Word-Timeline');
    return header ? (JSON.parse(header) as Timeline) : null;
  } catch {
    return null;
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

export interface CleanedBook {
  text: string;
  wordCount: number;
  removedWords: number;
  heading: string | null;
  title: string;
  author: string;
  intro: string;
  outro: string;
  source: 'gemini' | 'template';
  reason: string | null;
}

export async function cleanBookText(text: string, filename: string): Promise<CleanedBook> {
  const response = await fetch('/api/clean-text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, filename }),
  });
  if (!response.ok) {
    throw new Error(await readError(response, 'Could not clean this book.'));
  }
  return response.json();
}

export interface SummaryRequest {
  text: string;
  filename: string;
  minutes: number;
  speed: number;
  structure: SummaryStructure;
  provider: SummaryProviderId;
  /** Ollama only: which pulled model to run. Ignored for cloud providers. */
  model?: string;
  /** Overrides for what was detected; both are spoken in the intro and outro. */
  title?: string;
  author?: string;
  headingLevels?: Record<string, number>;
  /** Ignore parts saved by an earlier run and write everything again. */
  fresh?: boolean;
}

export async function fetchSummaryProviders(): Promise<SummaryProvider[]> {
  const response = await fetch('/api/summary/providers');
  if (!response.ok) throw await fail(response, 'Could not list the AI providers.');
  const body = await response.json();
  return body.providers;
}

export async function planSummary(body: SummaryRequest, signal?: AbortSignal): Promise<SummaryPlan> {
  const response = await fetch('/api/summary/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw await fail(response, 'Could not plan the summary.');
  return response.json();
}

/**
 * Writes a summary. The server streams one JSON event per line while it works
 * and finishes on a `done` line carrying the result (or an `error` line), so a
 * run that takes minutes still reports progress. Aborting the signal cancels
 * the run; the parts already written stay saved on the server.
 */
export async function summarizeBook(
  body: SummaryRequest,
  onEvent: (event: SummaryEvent) => void,
  signal?: AbortSignal,
): Promise<SummaryResult> {
  const response = await fetch('/api/summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) throw await fail(response, 'Could not write the summary.');

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += value;

    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (!line) continue;

      const event = JSON.parse(line) as SummaryEvent;
      if (event.type === 'done') return event.result;
      if (event.type === 'error') throw new RequestError(event.error, event.code);
      onEvent(event);
    }

    if (done) break;
  }
  throw new RequestError('The connection closed before the summary finished.');
}

export async function generateAudio(
  text: string,
  voice: string,
  speed: number,
  signal?: AbortSignal,
  meta?: { title?: string; wordCount?: number; limitMinutes?: number },
): Promise<GeneratedAudio> {
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice, speed, ...meta }),
    signal,
  });
  if (!response.ok) {
    throw await fail(response, 'Audio generation failed.');
  }
  return response.json();
}
export async function resumeGeneration(signal?: AbortSignal): Promise<GeneratedAudio> {
  const response = await fetch('/api/generate/resume', { method: 'POST', signal });
  if (!response.ok) {
    throw await fail(response, 'Could not resume the interrupted run.');
  }
  return response.json();
}
export async function fetchTextReport(text: string): Promise<TextReport> {
  const response = await fetch('/api/text-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) throw await fail(response, 'Could not analyse the text.');
  return response.json();
}

export async function fetchChunkRun(): Promise<ChunkRun> {
  const response = await fetch('/api/chunks');
  if (!response.ok) throw await fail(response, 'Could not read the chunk folder.');
  return response.json();
}

/** Start from scratch: deletes every finished chunk of the interrupted run. */
export async function clearChunkRun(): Promise<{ removed: number }> {
  const response = await fetch('/api/chunks', { method: 'DELETE' });
  if (!response.ok) throw await fail(response, 'Could not clear the saved chunks.');
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

  const timeline = readTimelineHeader(response);
  return { url: URL.createObjectURL(await response.blob()), timeline };
}

export async function fetchReadPlan(text: string): Promise<ReadPlan> {
  const response = await fetch('/api/read/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    throw await fail(response, 'Could not prepare the book for reading.');
  }
  return response.json();
}

export async function fetchReadChunk(
  id: string,
  index: number,
  voice: string,
  speed: number,
): Promise<ReadChunk> {
  const query = `voice=${encodeURIComponent(voice)}&speed=${speed.toFixed(1)}`;
  const response = await fetch(`/api/read/${encodeURIComponent(id)}/${index}?${query}`);
  if (!response.ok) {
    throw await fail(response, 'Could not narrate this part of the book.');
  }

  const duration = Number(response.headers.get('X-Chunk-Duration')) || 0;
  const timeline = readTimelineHeader(response);
  return { url: URL.createObjectURL(await response.blob()), duration, timeline };
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
export function headingLevelsOf(book: Book): Record<string, number> {
  const lines = book.text.split('\n');
  const levels: Record<string, number> = {};

  for (const entry of book.outline ?? []) {
    if (entry.kind !== 'heading' || !entry.level) continue;
    const line = lines[entry.lineIndex]?.trim();
    if (line) levels[line] = entry.level;
  }

  return levels;
}

export async function rescanBook(
  text: string,
  headingLevels?: Record<string, number>,
): Promise<BookRescan> {
  const response = await fetch('/api/book/rescan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, headingLevels }),
  });
  if (!response.ok) throw await fail(response, 'Could not save the edited text.');
  return response.json();
}

export async function discardResult(): Promise<void> {
  await fetch('/api/result', { method: 'DELETE' }).catch(() => undefined);
}

export async function fetchBackground(): Promise<BackgroundStatus> {
  const response = await fetch('/api/background');
  if (!response.ok) throw await fail(response, 'Could not read the background settings.');
  return response.json();
}

export async function suggestBackground(
  text: string,
  title: string,
  chapters: string[],
  mood?: string,
): Promise<BackgroundSuggestion> {
  const response = await fetch('/api/background/suggest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, title, chapters, mood }),
  });
  if (!response.ok) throw await fail(response, 'Could not suggest a background.');
  return response.json();
}

export async function selectBackground(provider: string, id: string): Promise<BackgroundStatus> {
  const response = await fetch('/api/background/select', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, id }),
  });
  if (!response.ok) throw await fail(response, 'Could not use that track.');
  return response.json();
}

export async function uploadBackground(file: File): Promise<BackgroundStatus> {
  const body = new FormData();
  body.append('file', file);

  const response = await fetch('/api/background/upload', { method: 'POST', body });
  if (!response.ok) throw await fail(response, 'Could not use that file.');
  return response.json();
}

export async function clearBackground(): Promise<BackgroundStatus> {
  const response = await fetch('/api/background', { method: 'DELETE' });
  if (!response.ok) throw await fail(response, 'Could not remove the music.');
  return response.json();
}

/** The small lq copy the picker plays. Range-capable, so the scrubber works. */
export function backgroundAudioUrl(provider: string, id: string): string {
  return `/api/background/audio/${encodeURIComponent(provider)}/${encodeURIComponent(id)}`;
}

/** The full-quality music file, as an attachment. Never mixed into the audiobook. */
export function backgroundDownloadUrl(provider: string, id: string): string {
  return `/api/background/download/${encodeURIComponent(provider)}/${encodeURIComponent(id)}`;
}

export function downloadUrl(bookName: string): string {
  return `/api/download?name=${encodeURIComponent(bookName)}`;
}
