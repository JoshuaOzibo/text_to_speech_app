import fs from 'fs';
import express from 'express';
import { config, paths } from '../config/env.js';
import * as jobStore from '../utils/jobStore.js';
import {
  splitIntoChunks,
  generateChunkAudio,
  anyEngineInstalled,
  resolveVoice,
} from '../utils/ttsEngine.js';
import {
  mergeWavsToMp3,
  totalWavDuration,
  ffmpegAvailable,
  readWavDuration,
} from '../utils/audioMerger.js';
import { processChunk } from '../utils/wavProcessor.js';
import { preprocessText } from '../utils/textCleaner.js';
import { buildTimeline } from '../utils/timeline.js';
import { clearChunks, removeFile } from '../utils/cleanup.js';
import { renameWithRetry, writeJsonAtomic } from '../utils/atomicFile.js';
import {
  chunkWav,
  chunkSidecar,
  runKey,
  readJson,
  readManifest,
  writeManifest,
  writeRunText,
  readRunText,
  countFinishedChunks,
  sweepPartials,
} from '../utils/runManifest.js';
import { logger, secs, timer } from '../utils/logger.js';

const router = express.Router();

const SYNTH_PROGRESS_SHARE = 70;
const CONDITION_PROGRESS_END = 80;

async function runGeneration(res, { text, voice, rate, title, wordCount, discardExisting }) {
  const spokenText = preprocessText(text);
  const chunks = splitIntoChunks(spokenText, config.wordsPerChunk);
  const wavFiles = [];

  const key = runKey(spokenText, voice, rate);
  const previous = readManifest();
  const resuming = previous?.key === key && previous?.total === chunks.length;

  if (!resuming) {
    const kept = countFinishedChunks();
    if (kept > 0 && !discardExisting) {
      const of = previous?.total ? ` of ${previous.total}` : '';
      return res.status(409).json({
        success: false,
        code: 'CHUNKS_FROM_ANOTHER_RUN',
        error:
          `${kept}${of} finished chunks from a different book, voice or speed are already on disk. ` +
          'Resume that run, or press "Start from scratch" in the sidebar to delete them and begin again.',
      });
    }
    clearChunks();
  }

  jobStore.startJob();

  let finished = false;
  res.on('close', () => {
    if (!finished && !res.writableFinished && jobStore.isBusy()) {
      logger.warn('generate', 'client hung up mid-generation - stopping, finished chunks kept');
      jobStore.cancel('disconnected');
    }
  });

  jobStore.setLastResult(null);
  removeFile(paths.outputMp3);
  removeFile(paths.resultJson);

  fs.mkdirSync(paths.chunks, { recursive: true });
  sweepPartials();

  if (!resuming || readRunText() === null) writeRunText(text);

  if (!resuming || !previous.startedAt) {
    writeManifest({
      key,
      total: chunks.length,
      voice,
      speed: rate,
      title: title ?? previous?.title ?? null,
      wordCount: wordCount ?? previous?.wordCount ?? 0,
      startedAt: previous?.startedAt ?? new Date().toISOString(),
    });
  }

  const alreadyDone = resuming
    ? chunks.reduce((count, _, i) => count + (fs.existsSync(chunkWav(i)) ? 1 : 0), 0)
    : 0;

  const runElapsed = timer();
  let synthesised = 0;

  try {
    logger.info('generate', resuming ? 'resuming' : 'starting', {
      voice,
      speed: rate,
      chunks: chunks.length,
      ...(resuming ? { alreadyDone, toDo: chunks.length - alreadyDone } : {}),
    });

    jobStore.publish({
      status: 'generating',
      progress: Math.round((alreadyDone / chunks.length) * SYNTH_PROGRESS_SHARE),
      chunk: alreadyDone,
      totalChunks: chunks.length,
    });

    for (let i = 0; i < chunks.length; i += 1) {
      if (jobStore.isCancelled()) {
        const error = new Error('Generation cancelled.');
        error.code = 'CANCELLED';
        throw error;
      }

      const wavPath = chunkWav(i);

      if (fs.existsSync(wavPath)) {
        wavFiles.push(wavPath);
        continue;
      }

      const chunkElapsed = timer();
      const partPath = `${wavPath}.part`;
      await generateChunkAudio(
        chunks[i].text,
        voice,
        rate,
        partPath,
        jobStore.trackChild,
        jobStore.isCancelled
      );
      renameWithRetry(partPath, wavPath);
      wavFiles.push(wavPath);
      synthesised += 1;

      const done = i + 1;
    
      const remaining = ((chunks.length - done) * runElapsed()) / synthesised;
      logger.info('generate', `chunk ${done}/${chunks.length}`, {
        took: secs(chunkElapsed()),
        elapsed: secs(runElapsed()),
        left: `${Math.round(remaining / 60)}min`,
      });

      jobStore.publish({
        status: 'generating',
        progress: Math.round(((i + 1) / chunks.length) * SYNTH_PROGRESS_SHARE),
        chunk: i + 1,
        totalChunks: chunks.length,
      });
    }

    if (jobStore.isCancelled()) {
      const error = new Error('Generation cancelled.');
      error.code = 'CANCELLED';
      throw error;
    }

    jobStore.publish({ status: 'processing', progress: SYNTH_PROGRESS_SHARE });

    const timings = [];

    for (let i = 0; i < wavFiles.length; i += 1) {
      const gapMs = chunks[i].endsChapter ? config.chapterGapMs : config.chunkGapMs;
      const sidecar = chunkSidecar(i);

      let measured = readJson(sidecar);
      if (measured && typeof measured.bytes === 'number') {
        const actual = fs.existsSync(wavFiles[i]) ? fs.statSync(wavFiles[i]).size : -1;
        if (actual !== measured.bytes) {
          logger.warn('generate', `chunk ${i + 1} was interrupted mid-conditioning - redoing it`);
          measured = null;
        }
      }

      if (!measured) {
        const result = processChunk(wavFiles[i], {
          gapMs,
          beforeCommit: ({ speechSec, pauses, bytes }) =>
            writeJsonAtomic(sidecar, { speechSec, gapSec: gapMs / 1000, pauses, bytes }),
        });

        if (result) {
          measured = { speechSec: result.speechSec, gapSec: gapMs / 1000, pauses: result.pauses, bytes: result.bytes };
        } else {
          measured = { speechSec: readWavDuration(wavFiles[i]), gapSec: 0, pauses: [] };
          writeJsonAtomic(sidecar, measured);
        }
      }

      timings.push({ text: chunks[i].text, ...measured });

      const span = CONDITION_PROGRESS_END - SYNTH_PROGRESS_SHARE;
      jobStore.publish({
        status: 'processing',
        progress: SYNTH_PROGRESS_SHARE + Math.round(((i + 1) / wavFiles.length) * span),
      });
    }

    if (jobStore.isCancelled()) {
      const error = new Error('Generation cancelled.');
      error.code = 'CANCELLED';
      throw error;
    }

    jobStore.publish({ status: 'merging', progress: CONDITION_PROGRESS_END });

    const duration = Math.round(totalWavDuration(wavFiles));

    await mergeWavsToMp3(wavFiles, paths.outputMp3, (percent) => {
      const span = 100 - CONDITION_PROGRESS_END;
      jobStore.publish({
        status: 'merging',
        progress: CONDITION_PROGRESS_END + Math.round((percent / 100) * span),
      });
    });

    clearChunks();

    const sizeBytes = fs.existsSync(paths.outputMp3) ? fs.statSync(paths.outputMp3).size : 0;

    jobStore.publish({
      status: 'done',
      progress: 100,
      chunk: chunks.length,
      totalChunks: chunks.length,
    });

    const result = {
      audioUrl: '/api/audio/output.mp3',
      duration,
      sizeBytes,
      totalChunks: chunks.length,
      timeline: buildTimeline(text, timings),
    };
    jobStore.setLastResult(result);
    try {
      writeJsonAtomic(paths.resultJson, result);
    } catch (error) {
      logger.warn('generate', `could not save result.json: ${error.message}`);
    }

    logger.info('generate', 'finished', {
      chunks: chunks.length,
      audio: secs(duration),
      took: secs(runElapsed()),
      realtime: `${(runElapsed() / Math.max(1, duration)).toFixed(2)}x`,
      mb: (sizeBytes / 1024 / 1024).toFixed(1),
    });

    res.json({ success: true, ...result });
  } catch (error) {
    const cancelled = error.code === 'CANCELLED' || jobStore.isCancelled();
    removeFile(paths.outputMp3);
    sweepPartials();
    const kept = countFinishedChunks();
    const carryOn = kept
      ? ` ${kept} of ${chunks.length} finished ${kept === 1 ? 'chunk is' : 'chunks are'} kept — press Resume to carry on.`
      : '';

    if (cancelled) {
      const disconnected = jobStore.cancelReason() === 'disconnected';
      const message =
        (disconnected ? 'Generation stopped - the page disconnected.' : 'Generation cancelled.') +
        carryOn;

      logger.info('generate', disconnected ? 'disconnected' : 'cancelled', { keptChunks: kept });
      jobStore.publish({ status: 'cancelled', progress: 0, message });
      return res.status(499).json({ success: false, error: message, code: 'CANCELLED' });
    }

    logger.error('generate', `failed: ${error.message}`, { code: error.code, keptChunks: kept });

    const message = (error.message || 'Audio generation failed.') + carryOn;

    jobStore.publish({ status: 'error', progress: 0, message });
    res.status(500).json({ success: false, error: message, code: error.code });
  } finally {
    finished = true;
    jobStore.endJob();
  }
}

function preflight(res, voice) {
  if (jobStore.isBusy()) {
    res.status(409).json({
      success: false,
      error: 'A generation is already running. Cancel it before starting another.',
    });
    return false;
  }
  if (!anyEngineInstalled()) {
    const error = 'No TTS engine is installed. Please follow the setup instructions in README.md.';
    jobStore.publish({ status: 'error', progress: 0, message: error });
    res.status(503).json({ success: false, error, code: 'PIPER_NOT_FOUND' });
    return false;
  }
  if (!ffmpegAvailable()) {
    const error = 'ffmpeg not found. Install it using: npm install ffmpeg-static';
    jobStore.publish({ status: 'error', progress: 0, message: error });
    res.status(503).json({ success: false, error, code: 'FFMPEG_NOT_FOUND' });
    return false;
  }
  try {
    resolveVoice(voice);
  } catch (error) {
    jobStore.publish({ status: 'error', progress: 0, message: error.message });
    res.status(400).json({ success: false, error: error.message, code: error.code });
    return false;
  }
  return true;
}

const clampSpeed = (speed) => Math.min(2, Math.max(0.5, Number(speed) || 1));

router.post('/generate', async (req, res) => {
  const { text, voice, speed = 1.0, title, wordCount, discardExisting = false } = req.body || {};

  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ success: false, error: 'No text was provided to narrate.' });
  }
  if (!voice) {
    return res.status(400).json({ success: false, error: 'No voice was selected.' });
  }
  if (!preflight(res, voice)) return;

  await runGeneration(res, {
    text,
    voice,
    rate: clampSpeed(speed),
    title,
    wordCount,
    discardExisting: Boolean(discardExisting),
  });
});

router.post('/generate/resume', async (req, res) => {
  const manifest = readManifest();
  const text = readRunText();

  if (!manifest || text === null) {
    return res.status(404).json({
      success: false,
      code: 'NO_RESUMABLE_RUN',
      error: 'There is no interrupted run to resume.',
    });
  }
  if (!manifest.voice) {
    return res.status(409).json({
      success: false,
      code: 'NO_RESUMABLE_RUN',
      error: 'The interrupted run predates resumable manifests and cannot be continued automatically.',
    });
  }
  if (!preflight(res, manifest.voice)) return;

  logger.info('generate', 'resume requested', {
    voice: manifest.voice,
    done: countFinishedChunks(),
    total: manifest.total,
  });

  await runGeneration(res, {
    text,
    voice: manifest.voice,
    rate: clampSpeed(manifest.speed),
    title: manifest.title,
    wordCount: manifest.wordCount,
  });
});

export default router;
