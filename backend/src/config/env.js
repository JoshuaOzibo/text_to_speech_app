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
  gpuJob: path.join(backendRoot, 'audio', 'gpu-job'),
  previews: path.join(backendRoot, 'audio', 'previews'),
  read: path.join(backendRoot, 'audio', 'read'),
  beds: path.join(backendRoot, 'audio', 'beds'),
  summaries: path.join(backendRoot, 'audio', 'summaries'),
  outputMp3: path.join(backendRoot, 'audio', 'output.mp3'),
  resultJson: path.join(backendRoot, 'audio', 'result.json'),
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

  // Summaries. The words-per-minute rate sets the word budget for a requested
  // length; it is deliberately below the 180-187 wpm the voices measure, so a
  // "30 minute" summary comes in under 30 minutes.
  summaryWordsPerMinute: Number(process.env.SUMMARY_WORDS_PER_MINUTE) || 165,
  summaryConcurrency: Number(process.env.SUMMARY_CONCURRENCY) || 2,
  summaryTimeoutMs: Number(process.env.SUMMARY_TIMEOUT_MS) || 180000,
  summaryGeminiModel: process.env.SUMMARY_GEMINI_MODEL || '',
  // CLAUDE_API_KEY is accepted too: it is the name already in use in .env files.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || '',
  claudeModel: process.env.CLAUDE_MODEL || 'claude-opus-5',
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
  deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  ollamaUrl: process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
  ollamaModel: process.env.OLLAMA_MODEL || '',
  ollamaNumCtx: Number(process.env.OLLAMA_NUM_CTX) || 16384,
  ollamaTimeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS) || 1800000,

  backgroundDownloadTimeoutMs: Number(process.env.BACKGROUND_DOWNLOAD_TIMEOUT_MS) || 300000,
  backgroundMaxFlatnessDb: Number(process.env.BACKGROUND_MAX_FLATNESS_DB) || 6,
  backgroundMaxRangeDb: Number(process.env.BACKGROUND_MAX_RANGE_DB) || 16,
  backgroundMinSeconds: Number(process.env.BACKGROUND_MIN_SECONDS) || 90,
  backgroundMaxSeconds: Number(process.env.BACKGROUND_MAX_SECONDS) || 900,
  mp3Bitrate: process.env.MP3_BITRATE || '192k',
  supertonicSteps: Number(process.env.SUPERTONIC_STEPS) || 4,
  kokoroDtype: process.env.KOKORO_DTYPE || 'fp32',

  kokoroMaxChars: Number(process.env.KOKORO_MAX_CHARS) || 400,

  kokoroJoinSilenceMs: Number(process.env.KOKORO_JOIN_SILENCE_MS) || 400,

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
  const dirs = [paths.uploads, paths.audio, paths.chunks, paths.previews, paths.read, paths.beds, paths.summaries, paths.voicesDir];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export { config, paths, ensureDirs };
