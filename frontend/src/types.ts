/** Shared types for the LocalAudioBook client. Mirrors the backend API shapes. */

export interface Chapter {
  index: number;
  title: string;
  lineIndex: number;
  /**
   * How many source lines the heading itself occupies. Display type often breaks
   * one heading over three lines ("Chapter" / "I" / the title), and the reader
   * renders those as a single heading rather than a fragment plus two orphans.
   */
  lineSpan?: number;
  wordCount: number;
}

/** A parsed book, as returned by POST /api/upload. */
export interface Book {
  text: string;
  chapters: Chapter[];
  wordCount: number;
  pageCount: number | null;
  estimatedMinutes: number;
  filename: string;
  sizeBytes: number;
}

/** Which local TTS engine produces a voice. */
export type TtsEngine = 'piper' | 'supertonic' | 'kokoro';

/** An installed voice, discovered by scanning each engine's model folder. */
export interface Voice {
  id: string;
  engine: TtsEngine;
  name: string;
  locale: string | null;
  quality: string;
  gender?: string;
  label: string;
  /** Display heading this voice is filed under in the dropdown. */
  group: string;
  /** One line on what this voice suits, including its measured cost. */
  bestFor?: string;
  /** Seconds of compute per second of audio, measured on this machine. */
  speedFactor?: number | null;
  file: string;
}

export interface VoicesResponse {
  voices: Voice[];
  engines: Record<TtsEngine, boolean>;
  ttsAvailable: boolean;
  ffmpegAvailable: boolean;
}

/** Generation lifecycle, as broadcast over SSE by the backend. */
export type GenerationStatus =
  | 'idle'
  | 'starting'
  | 'generating'
  /** Per-chunk conditioning: levelling, fades, gap padding. */
  | 'processing'
  | 'merging'
  | 'done'
  | 'cancelled'
  | 'error';

export interface Progress {
  status: GenerationStatus;
  progress: number;
  chunk?: number;
  totalChunks?: number;
  message?: string;
}

/**
 * One timed span of narration, keyed to the text the reader is showing.
 *
 * Keys are short because a full-length book produces around fourteen thousand
 * of these: `s`/`e` are start and end in seconds, `a`/`b` are the first word and
 * one past the last, indexing the book's whitespace-separated words.
 *
 * Boundaries are real — measured from pauses in the synthesised audio — so a
 * span begins and ends exactly where the voice does. Within a span, time is
 * shared out across its words by length.
 */
export interface TimelineSegment {
  s: number;
  e: number;
  a: number;
  b: number;
}

export interface Timeline {
  /** Total words in the display text, for a sanity check against the reader. */
  words: number;
  duration: number;
  segments: TimelineSegment[];
}

/** The finished MP3, as returned by POST /api/generate. */
export interface GeneratedAudio {
  audioUrl: string;
  duration: number;
  sizeBytes: number;
  totalChunks: number;
  /** Absent on audio recovered from a server that no longer holds the run. */
  timeline?: Timeline;
}

export interface ApiError {
  error: string;
  code?: string;
}
