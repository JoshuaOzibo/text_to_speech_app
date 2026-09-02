
export interface Chapter {
  index: number;
  title: string;
  lineIndex: number;
  lineSpan?: number;
  wordCount: number;
}

export interface Book {
  text: string;
  chapters: Chapter[];
  wordCount: number;
  pageCount: number | null;
  estimatedMinutes: number;
  filename: string;
  sizeBytes: number;
}

export type TtsEngine = 'piper' | 'supertonic' | 'kokoro';

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
}

export interface BackgroundStatus {
  selected: BackgroundTrack | null;
  level: number;
  ai: boolean;
  library: string;
  levelRange: { min: number; max: number };
}

export interface BackgroundSuggestion {
  source: 'gemini' | 'local';
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
