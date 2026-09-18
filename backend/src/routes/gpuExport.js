import fs from 'fs';
import path from 'path';
import express from 'express';
import { config, paths } from '../config/env.js';
import * as jobStore from '../utils/jobStore.js';
import { splitIntoChunks, resolveVoice } from '../utils/ttsEngine.js';
import { splitForTokenCap } from '../utils/engines/kokoro.js';
import { preprocessText, normaliseForSpeech, countWords } from '../utils/textCleaner.js';
import { clearChunks } from '../utils/cleanup.js';
import { writeFileAtomic, writeJsonAtomic } from '../utils/atomicFile.js';
import {
  runKey,
  readManifest,
  writeManifest,
  writeRunText,
  countFinishedChunks,
} from '../utils/runManifest.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// Kokoro is 24kHz; the engine reads the rate back off the model at runtime but the
// notebook has to be told up front, and every voice in the catalogue is 24kHz.
const KOKORO_SAMPLE_RATE = 24000;

// kokoro-js takes a locale; the Python `kokoro` package takes a one-letter lang_code.
const LANG_CODES = { 'en-us': 'a', 'en-gb': 'b' };

const clampSpeed = (speed) => Math.min(2, Math.max(0.5, Number(speed) || 1));

/**
 * Exports a generation as a job bundle a GPU box can synthesise, and primes
 * audio/chunks/ with the manifest that run's WAVs will have to match.
 *
 * The bundle carries *finished* strings: preprocessText, splitIntoChunks,
 * normaliseForSpeech, the TTS_WARMUP prefix and splitForTokenCap have all already
 * run here. The remote side speaks what it is given and does no text processing of
 * its own - that is the whole contract, because every one of those steps would have
 * to be reimplemented identically in Python to land on the same chunk count, and a
 * mismatch would make the result unresumable.
 */
router.post('/gpu/export', (req, res) => {
  const { text, voice, speed = 1.0, title, wordCount, discardExisting = false } = req.body || {};

  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ success: false, error: 'No text was provided to narrate.' });
  }
  if (!voice) {
    return res.status(400).json({ success: false, error: 'No voice was selected.' });
  }
  if (jobStore.isBusy()) {
    return res.status(409).json({
      success: false,
      code: 'GENERATION_RUNNING',
      error: 'A generation is running. Cancel it before exporting a GPU job.',
    });
  }

  let resolved;
  try {
    resolved = resolveVoice(voice);
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message, code: error.code });
  }

  if (resolved.engine !== 'kokoro') {
    return res.status(400).json({
      success: false,
      code: 'GPU_ENGINE_UNSUPPORTED',
      error:
        `GPU export covers Kokoro voices only, and "${voice}" runs on ${resolved.engine}. ` +
        'Piper and Supertonic are already faster than realtime on this machine, so there is ' +
        'nothing to gain - generate those here.',
    });
  }

  const rate = clampSpeed(speed);
  const fullText = preprocessText(text);
  const chunks = splitIntoChunks(fullText, config.wordsPerChunk);

  if (!chunks.length) {
    return res.status(400).json({
      success: false,
      code: 'NO_CHUNKS',
      error: 'There was no narratable text left after cleaning. Check the Text Preview.',
    });
  }

  // Same identity the generate route computes, over the same string. A test run
  // (limitMinutes) is deliberately not supported here: it exists to check an opening
  // cheaply, which is already cheap locally, and supporting it would mean keeping a
  // second copy of the truncation rule in step with generate.js.
  const key = runKey(fullText, voice, rate);
  const previous = readManifest();
  const kept = countFinishedChunks();

  if (previous?.key !== key) {
    if (kept > 0 && !discardExisting) {
      const of = previous?.total ? ` of ${previous.total}` : '';
      return res.status(409).json({
        success: false,
        code: 'CHUNKS_FROM_ANOTHER_RUN',
        error:
          `${kept}${of} finished chunks from a different book, voice or speed are already on disk. ` +
          'Resume or finish that run first, or press "Start from scratch" in the sidebar to delete them.',
      });
    }
    clearChunks();
  }

  fs.mkdirSync(paths.chunks, { recursive: true });
  writeRunText(text);
  writeManifest({
    key,
    total: chunks.length,
    voice,
    speed: rate,
    title: title ?? previous?.title ?? null,
    wordCount: wordCount ?? previous?.wordCount ?? 0,
    startedAt: new Date().toISOString(),
  });

  // Exactly what generateChunkAudio hands the engine, including the warm-up prefix.
  const spokenFor = (chunkText) =>
    config.ttsWarmup ? `. ${normaliseForSpeech(chunkText)}` : normaliseForSpeech(chunkText);

  let pieceCount = 0;
  const lines = chunks.map((chunk, i) => {
    const pieces = splitForTokenCap(spokenFor(chunk.text), config.kokoroMaxChars);
    pieceCount += pieces.length;
    return JSON.stringify({ i, pieces });
  });

  fs.mkdirSync(paths.gpuJob, { recursive: true });

  const job = {
    key,
    total: chunks.length,
    // The Python package keys voices by bare name; the id is namespaced here.
    voice: resolved.file,
    langCode: LANG_CODES[resolved.locale] || 'a',
    speed: rate,
    sampleRate: KOKORO_SAMPLE_RATE,
    // Mirrors of the local join so the remote audio has the same shape, and so the
    // timeline anchors the same sentence breaks. See engines/kokoro.js.
    joinSilenceMs: config.kokoroJoinSilenceMs,
    silenceFloorDbfs: config.silenceFloorDbfs,
    leadInMs: config.leadInMs,
    maxChars: config.kokoroMaxChars,
    title: title ?? null,
    wordCount: countWords(fullText),
    exportedAt: new Date().toISOString(),
  };

  writeJsonAtomic(path.join(paths.gpuJob, 'job.json'), job);
  writeFileAtomic(path.join(paths.gpuJob, 'chunks.jsonl'), `${lines.join('\n')}\n`);

  logger.info('gpu', 'job exported', {
    chunks: chunks.length,
    pieces: pieceCount,
    voice: resolved.file,
    speed: rate,
    words: job.wordCount,
    dir: paths.gpuJob,
  });

  res.json({
    success: true,
    key,
    total: chunks.length,
    pieces: pieceCount,
    words: job.wordCount,
    voice: resolved.file,
    langCode: job.langCode,
    speed: rate,
    dir: paths.gpuJob,
  });
});

export default router;
