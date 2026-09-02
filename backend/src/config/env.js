import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

dotenv.config({ path: path.join(backendRoot, '.env') });

const paths = {
  root: backendRoot,
  uploads: path.join(backendRoot, 'uploads'),
  audio: path.join(backendRoot, 'audio'),
  chunks: path.join(backendRoot, 'audio', 'chunks'),
  previews: path.join(backendRoot, 'audio', 'previews'),
  read: path.join(backendRoot, 'audio', 'read'),
  beds: path.join(backendRoot, 'audio', 'beds'),
  outputMp3: path.join(backendRoot, 'audio', 'output.mp3'),
  piperExe: path.join(backendRoot, 'piper', process.platform === 'win32' ? 'piper.exe' : 'piper'),
  voicesDir: path.join(backendRoot, 'piper', 'voices'),
  supertonicRoot: path.join(backendRoot, 'supertonic'),
  supertonicOnnx: path.join(backendRoot, 'supertonic', 'assets', 'onnx'),
  supertonicVoices: path.join(backendRoot, 'supertonic', 'assets', 'voice_styles'),
  kokoroRoot: path.join(backendRoot, 'kokoro'),
  kokoroModels: path.join(backendRoot, 'kokoro', 'models'),
  lexicon: path.join(backendRoot, 'lexicon.txt'),
  frontendDist: path.resolve(backendRoot, '../frontend/dist'),
};

const config = {
  port: Number(process.env.PORT) || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 50) * 1024 * 1024,
  wordsPerChunk: Number(process.env.WORDS_PER_CHUNK) || 300,
  readWordsPerChunk: Number(process.env.READ_WORDS_PER_CHUNK) || 60,
  readLeadWords: Number(process.env.READ_LEAD_WORDS) || 25,
  readCacheChunks: Number(process.env.READ_CACHE_CHUNKS) || 40,
  readConcurrency: Number(process.env.READ_CONCURRENCY) || 3,

  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
  pixabayApiKey: process.env.PIXABAY_API_KEY || '',
  freesoundApiKey: process.env.FREESOUND_API_KEY || '',
  suggestTimeoutMs: Number(process.env.SUGGEST_TIMEOUT_MS) || 20000,

  backgroundLevelDb: Number(process.env.BACKGROUND_LEVEL_DB) || -20,
  backgroundDuckDb: Number(process.env.BACKGROUND_DUCK_DB) || -14,
  backgroundFadeSec: Number(process.env.BACKGROUND_FADE_SEC) || 3,
  cleanupDelayMs: Number(process.env.CLEANUP_DELAY_MINUTES || 5) * 60 * 1000,
  mp3Bitrate: process.env.MP3_BITRATE || '192k',
  supertonicSteps: Number(process.env.SUPERTONIC_STEPS) || 4,
  kokoroDtype: process.env.KOKORO_DTYPE || 'fp32',

  ttsWarmup: process.env.TTS_WARMUP !== 'false',

  chunkTargetDbfs: Number(process.env.CHUNK_TARGET_DBFS) || -20,
  chunkPeakCeilingDbfs: Number(process.env.CHUNK_PEAK_CEILING_DBFS) || -1,
  chunkFadeMs: Number(process.env.CHUNK_FADE_MS) || 50,
  chunkGapMs: Number(process.env.CHUNK_GAP_MS) || 80,
  chapterGapMs: Number(process.env.CHAPTER_GAP_MS) || 2000,
  silenceFloorDbfs: Number(process.env.SILENCE_FLOOR_DBFS) || -50,
  leadInMs: Number(process.env.LEAD_IN_MS) || 30,

  highpassHz: Number(process.env.HIGHPASS_HZ) || 80,
  compressorEnabled: process.env.COMPRESSOR_ENABLED !== 'false',
  loudnormI: Number(process.env.LOUDNORM_I) || -16,
  loudnormTp: Number(process.env.LOUDNORM_TP) || -1.5,
  loudnormLra: Number(process.env.LOUDNORM_LRA) || 11,

  paths,
};

config.isProduction = config.nodeEnv === 'production';

function ensureDirs() {
  const dirs = [paths.uploads, paths.audio, paths.chunks, paths.previews, paths.read, paths.beds, paths.voicesDir];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export { config, paths, ensureDirs };
