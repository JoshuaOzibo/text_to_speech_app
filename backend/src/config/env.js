'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const backendRoot = path.resolve(__dirname, '../..');

dotenv.config({ path: path.join(backendRoot, '.env') });

const paths = {
  root: backendRoot,
  uploads: path.join(backendRoot, 'uploads'),
  audio: path.join(backendRoot, 'audio'),
  chunks: path.join(backendRoot, 'audio', 'chunks'),
  previews: path.join(backendRoot, 'audio', 'previews'),
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
  for (const dir of [paths.uploads, paths.audio, paths.chunks, paths.previews, paths.voicesDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

module.exports = { config, paths, ensureDirs };
