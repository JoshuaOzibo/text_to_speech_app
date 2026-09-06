
export interface Chapter {
  index: number;
  title: string;
  lineIndex: number;
  lineSpan?: number;
  wordCount: number;
}

/**
 * A structural line in `book.text`, reported by the backend's docStructure.js.
 * Optional throughout: a book restored from an older session has no outline and
 * the reader falls back to reading the same shapes off the text itself.
 */
export interface OutlineEntry {
  lineIndex: number;
  kind: 'heading' | 'list';
  /** 1-3, measured from the source's font sizes. Only headings carry one. */
  level?: number;
  marker?: string;
  ordered?: boolean;
}

export interface Book {
  text: string;
  chapters: Chapter[];
  outline?: OutlineEntry[];
  wordCount: number;
  pageCount: number | null;
  estimatedMinutes: number;
  filename: string;
  sizeBytes: number;
}

export interface BookRescan {
  text: string;
  chapters: Chapter[];
  outline?: OutlineEntry[];
  wordCount: number;
  estimatedMinutes: number;
}

export type TtsEngine = 'piper' | 'supertonic' | 'kokoro';

/**
 * Whether audio from a voice can be published, and on what terms.
 * 'yes' publish freely · 'credit' commercial but must attribute ·
 * 'no' not licensed for monetised use · 'unknown' the licence does not say.
 */
export type LicenceUse = 'yes' | 'credit' | 'no' | 'unknown';

export interface Licence {
  id: string;
  use: LicenceUse;
  credit?: string;
}

export interface Voice {
  id: string;
  engine: TtsEngine;
  name: string;
  locale: string | null;
  quality: string;
  gender?: string;
  label: string;
  group: string;
  bestFor?: string;
  speedFactor?: number | null;
  licence?: Licence;
  /** When the voice's model file landed on disk, in epoch ms. Drives the New badge. */
  addedAt?: number | null;
  file: string;
}

export interface VoicesResponse {
  voices: Voice[];
  engines: Record<TtsEngine, boolean>;
  ttsAvailable: boolean;
  ffmpegAvailable: boolean;
}

export type GenerationStatus =
  | 'idle'
  | 'starting'
  | 'generating'
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

export interface TimelineSegment {
  s: number;
  e: number;
  a: number;
  b: number;
}

export interface Timeline {
  words: number;
  duration: number;
  segments: TimelineSegment[];
}

export interface ReadPlanChunk {
  i: number;
  words: number;
  chapterIndex: number;
  endsChapter: boolean;
  a: number;
  b: number;
}

export interface ReadPlan {
  id: string;
  totalChunks: number;
  totalWords: number;
  chunks: ReadPlanChunk[];
}

export interface ReadChunk {
  url: string;
  duration: number;
  timeline: Timeline | null;
}

export interface BackgroundTrack {
  provider: string;
  id: string;
  title: string;
  author: string;
  durationSec: number;
  license: string;
  licenseNote: string;
  attribution: string | null;
  pageUrl: string;
  term?: string;
  flatnessDb?: number | null;
  rangeDb?: number | null;
  measured?: boolean;
}

export interface BackgroundStatus {
  selected: BackgroundTrack | null;
  level: number;
  ai: boolean;
  library: string;
  levelRange: { min: number; max: number };
}

export interface GeminiState {
  available: boolean;
  used: boolean;
  reason: string | null;
}

export interface BackgroundSuggestion {
  source: 'gemini' | 'local' | 'manual';
  gemini: GeminiState;
  mood: string;
  label: string;
  reason: string;
  confidence: string;
  terms: string[];
  provider: string;
  aiAvailable: boolean;
  tracks: BackgroundTrack[];
}

export interface GeneratedAudio {
  audioUrl: string;
  duration: number;
  sizeBytes: number;
  totalChunks: number;
  timeline?: Timeline;
}

export interface ApiError {
  error: string;
  code?: string;
}
