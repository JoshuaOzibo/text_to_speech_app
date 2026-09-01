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

/** The finished MP3, as returned by POST /api/generate. */
export interface GeneratedAudio {
  audioUrl: string;
  duration: number;
  sizeBytes: number;
  totalChunks: number;
}

export interface ApiError {
  error: string;
  code?: string;
}
