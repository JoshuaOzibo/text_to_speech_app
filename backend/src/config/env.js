'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// backend/ package root, resolved from this file so the server works no matter
// which directory it was launched from (root `npm run dev`, backend/, etc.).
const backendRoot = path.resolve(__dirname, '../..');

dotenv.config({ path: path.join(backendRoot, '.env') });

const paths = {
  root: backendRoot,
  uploads: path.join(backendRoot, 'uploads'),
  audio: path.join(backendRoot, 'audio'),
  chunks: path.join(backendRoot, 'audio', 'chunks'),
  // Short voice samples, cached per voice+speed so repeat previews are instant.
  previews: path.join(backendRoot, 'audio', 'previews'),
  outputMp3: path.join(backendRoot, 'audio', 'output.mp3'),
  piperExe: path.join(backendRoot, 'piper', process.platform === 'win32' ? 'piper.exe' : 'piper'),
  voicesDir: path.join(backendRoot, 'piper', 'voices'),
  // Supertonic: vendored MIT inference code plus ONNX weights from HuggingFace.
  supertonicRoot: path.join(backendRoot, 'supertonic'),
  supertonicOnnx: path.join(backendRoot, 'supertonic', 'assets', 'onnx'),
  supertonicVoices: path.join(backendRoot, 'supertonic', 'assets', 'voice_styles'),
  // Kokoro: transformers.js-style model tree, vendored out of node_modules so a
  // reinstall can't wipe a 326MB download.
  kokoroRoot: path.join(backendRoot, 'kokoro'),
  kokoroModels: path.join(backendRoot, 'kokoro', 'models'),
  // Optional user word list, one word per line. Feeds the letter-spacing repair
  // in textCleaner with names it cannot know ("Kautilya", "Arthashastra").
  // Absent by default; nothing breaks without it.
  lexicon: path.join(backendRoot, 'lexicon.txt'),
  frontendDist: path.resolve(backendRoot, '../frontend/dist'),
};

const config = {
  port: Number(process.env.PORT) || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
  // Max upload size in bytes (spec: 50MB).
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 50) * 1024 * 1024,
  // Words per TTS chunk. Smaller = smoother progress, more Piper invocations.
  wordsPerChunk: Number(process.env.WORDS_PER_CHUNK) || 300,
  // How long generated audio survives after a download, in ms (spec: 5 mins).
  cleanupDelayMs: Number(process.env.CLEANUP_DELAY_MINUTES || 5) * 60 * 1000,
  mp3Bitrate: process.env.MP3_BITRATE || '192k',
  // Supertonic denoising steps: more = better quality, proportionally slower.
  // Measured on a 300-word chunk: 2 -> 0.23x realtime, 4 -> 0.42x, 8 -> 0.64x.
  supertonicSteps: Number(process.env.SUPERTONIC_STEPS) || 4,
  // Kokoro quantisation. fp32 is both the best quality and, measured here, the
  // fastest — int8 kernels are slower than float on CPUs without VNNI
  // (fp32 1.63x realtime vs q8 3.69x). q8 only matters if disk is tight.
  kokoroDtype: process.env.KOKORO_DTYPE || 'fp32',

  // --- Text preprocessing ---------------------------------------------------
  // Prepend a throwaway ". " to each chunk so the engine warms up on it rather
  // than on the first real word. The resulting lead silence is trimmed again by
  // wavProcessor. Turn off if a voice renders it audibly.
  ttsWarmup: process.env.TTS_WARMUP !== 'false',

  // --- Per-chunk audio conditioning ----------------------------------------
  // Every chunk is normalised to this RMS so merged chunks don't jump in level.
  chunkTargetDbfs: Number(process.env.CHUNK_TARGET_DBFS) || -20,
  // Hard ceiling applied after gain, so normalisation can never clip.
  chunkPeakCeilingDbfs: Number(process.env.CHUNK_PEAK_CEILING_DBFS) || -1,
  // Fades at each chunk edge — this is what removes the boundary clicks.
  chunkFadeMs: Number(process.env.CHUNK_FADE_MS) || 50,
  // Silence appended after every chunk, and after the last chunk of a chapter.
  // Chunk boundaries fall between sentences, where the engine has already left
  // its own trailing pause — 150ms on top of that read as a stall mid-paragraph,
  // so the gap only has to be long enough to keep the join from sounding rushed.
  chunkGapMs: Number(process.env.CHUNK_GAP_MS) || 80,
  chapterGapMs: Number(process.env.CHAPTER_GAP_MS) || 2000,
  // Anything quieter than this counts as silence when trimming chunk edges.
  silenceFloorDbfs: Number(process.env.SILENCE_FLOOR_DBFS) || -50,
  // Lead-in kept when trimming, so no onset is ever clipped.
  leadInMs: Number(process.env.LEAD_IN_MS) || 30,

  // --- Final mastering ------------------------------------------------------
  highpassHz: Number(process.env.HIGHPASS_HZ) || 80,
  compressorEnabled: process.env.COMPRESSOR_ENABLED !== 'false',
  loudnormI: Number(process.env.LOUDNORM_I) || -16,
  loudnormTp: Number(process.env.LOUDNORM_TP) || -1.5,
  loudnormLra: Number(process.env.LOUDNORM_LRA) || 11,

  paths,
};

config.isProduction = config.nodeEnv === 'production';

/** Create the working directories the app writes into. */
function ensureDirs() {
  for (const dir of [paths.uploads, paths.audio, paths.chunks, paths.previews, paths.voicesDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

module.exports = { config, paths, ensureDirs };
