
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
  /** Set when this "book" is a summary: the filename of the book it summarizes. */
  summaryOf?: string;
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
  warning?: string | null;
}


export interface BackgroundStatus {
  selected: BackgroundTrack | null;
  ai: boolean;
  library: string;
  warning?: string | null;
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

/**
 * An interrupted run left in audio/chunks. Read off disk by the server, so it
 * survives a restart or a power cut. `resumable` is false when the chunks
 * predate stored run text and can only be continued by generating the same
 * book again by hand.
 */
export interface ChunkRun {
  resumable: boolean;
  done: number;
  total: number;
  voice?: string | null;
  speed?: number;
  title?: string | null;
  wordCount?: number;
  startedAt?: string | null;
  test?: number;
}

export interface DroppedLine {
  line: string;
  why: string;
}

export interface TextReport {
  original: { words: number; lines: number };
  spoken: { words: number; lines: number };
  removedWords: number;
  stages: {
    metadata: { removed: number; lines: string[] };
    tableOfContents: { removed: number };
    frontMatter: { cut: number; reason: string; lines: string[] };
  };
  droppedFromTop: DroppedLine[];
  firstNarratedWords: string;
  firstOriginalWords: string;
}

export type SummaryStructure = 'chapters' | 'continuous';

export type SummaryProviderId = 'gemini' | 'claude' | 'deepseek' | 'ollama';

/** An AI provider as the backend reports it. `reason` says why one is unavailable. */
export interface SummaryProvider {
  id: SummaryProviderId;
  label: string;
  vendor: string;
  /** True for Ollama: runs on this PC, sends nothing anywhere. */
  local: boolean;
  available: boolean;
  reason: string | null;
  model: string;
  /** Ollama only: the models pulled on this machine. */
  models?: string[];
}

export interface SummaryPlanSection {
  /** The source's headings, whether or not the summary announces them. */
  titles: string[];
  sourceWords: number;
  budget: number;
  parts: number;
}

/** A dry run of a summary: what it covers, and how many words each part may have. */
export interface SummaryPlan {
  title: string;
  author: string;
  detectedTitle: string;
  detectedAuthor: string;
  /** False when the title was guessed from the text rather than the file name. */
  titleCertain: boolean;
  structure: SummaryStructure;
  minutes: number;
  speed: number;
  wordsPerMinute: number;
  bookWords: number;
  bookMinutes: number;
  targetWords: number;
  sections: SummaryPlanSection[];
  units: number;
  provider: SummaryProviderId;
  model: string;
  available: boolean;
  /** Parts already written by an earlier run with these exact settings. */
  cachedUnits: number;
}

/** Something the local accuracy checks could not verify against the book. */
export interface SummaryWarning {
  section: string;
  kind: 'quote' | 'number' | 'name' | 'missing';
  detail: string;
  sentence: string;
}

export interface SummaryResult {
  text: string;
  words: number;
  targetWords: number;
  minutes: number;
  speed: number;
  estimatedMinutes: number;
  structure: SummaryStructure;
  provider: SummaryProviderId;
  providerLabel: string;
  model: string;
  title: string;
  author: string;
  headings: string[];
  sections: { titles: string[]; budget: number; words: number }[];
  warnings: SummaryWarning[];
  /** 'template' when the provider could not write the intro; `reason` says why. */
  intro: { source: 'ai' | 'template'; reason: string | null };
  cachedUnits: number;
  totalUnits: number;
  calls: number;
  seconds: number;
}

/** One line of the streamed POST /api/summary response. */
export type SummaryEvent =
  | { type: 'plan'; provider: string; model: string }
  | {
      type: 'unit';
      state: 'start' | 'done';
      index: number;
      done: number;
      total: number;
      titles: string[];
      cached?: boolean;
    }
  | { type: 'wait'; seconds: number; reason: string; attempt: number }
  | { type: 'check'; title: string; issues: number }
  | { type: 'intro' }
  | { type: 'tick' }
  | { type: 'done'; result: SummaryResult }
  | { type: 'error'; code: string; error: string; done?: number; total?: number };

export interface ApiError {
  error: string;
  code?: string;
}
