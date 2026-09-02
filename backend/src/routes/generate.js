import fs from 'fs';
import path from 'path';
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
import { clearChunks, removeFile, cancelScheduledCleanup } from '../utils/cleanup.js';
import { logger, secs, timer } from '../utils/logger.js';
import { getSelected } from '../utils/soundtrack.js';

const router = express.Router();

const SYNTH_PROGRESS_SHARE = 70;
const CONDITION_PROGRESS_END = 80;

router.post('/generate', async (req, res) => {
  const { text, voice, speed = 1.0 } = req.body || {};

  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ success: false, error: 'No text was provided to narrate.' });
  }
  if (!voice) {
    return res.status(400).json({ success: false, error: 'No voice was selected.' });
  }
  if (jobStore.isBusy()) {
    return res.status(409).json({
      success: false,
      error: 'A generation is already running. Cancel it before starting another.',
    });
  }

  if (!anyEngineInstalled()) {
    const error = 'No TTS engine is installed. Please follow the setup instructions in README.md.';
    jobStore.publish({ status: 'error', progress: 0, message: error });
    return res.status(503).json({ success: false, error, code: 'PIPER_NOT_FOUND' });
  }
  if (!ffmpegAvailable()) {
    const error = 'ffmpeg not found. Install it using: npm install ffmpeg-static';
    jobStore.publish({ status: 'error', progress: 0, message: error });
    return res.status(503).json({ success: false, error, code: 'FFMPEG_NOT_FOUND' });
  }
  try {
    resolveVoice(voice);
  } catch (error) {
    jobStore.publish({ status: 'error', progress: 0, message: error.message });
    return res.status(400).json({ success: false, error: error.message, code: error.code });
  }

  const rate = Math.min(2, Math.max(0.5, Number(speed) || 1));

  jobStore.startJob();
  cancelScheduledCleanup();

  let finished = false;
  res.on('close', () => {
    if (!finished && !res.writableFinished && jobStore.isBusy()) {
      logger.warn('generate', 'client hung up mid-generation — cancelling');
      jobStore.cancel();
    }
  });

  jobStore.setLastResult(null);
  clearChunks();
  removeFile(paths.outputMp3);
  fs.mkdirSync(paths.chunks, { recursive: true });

  const spokenText = preprocessText(text);
  const chunks = splitIntoChunks(spokenText, config.wordsPerChunk);
  const wavFiles = [];

  const runElapsed = timer();

  try {
    logger.info('generate', 'starting', { voice, speed: rate, chunks: chunks.length });

    jobStore.publish({
      status: 'generating',
      progress: 0,
      chunk: 0,
      totalChunks: chunks.length,
    });

    for (let i = 0; i < chunks.length; i += 1) {
      if (jobStore.isCancelled()) {
        const error = new Error('Generation cancelled.');
        error.code = 'CANCELLED';
        throw error;
      }

      const wavPath = path.join(paths.chunks, `chunk-${String(i + 1).padStart(4, '0')}.wav`);
      const chunkElapsed = timer();
      await generateChunkAudio(
        chunks[i].text,
        voice,
        rate,
        wavPath,
        jobStore.trackChild,
        jobStore.isCancelled
      );
      wavFiles.push(wavPath);

      const done = i + 1;
      const remaining = ((chunks.length - done) * runElapsed()) / done;
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
      const measured = processChunk(wavFiles[i], { gapMs });

      timings.push({
        text: chunks[i].text,
        speechSec: measured ? measured.speechSec : readWavDuration(wavFiles[i]),
        gapSec: measured ? gapMs / 1000 : 0,
        pauses: measured ? measured.pauses : [],
      });

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

    const bed = getSelected();
    if (bed) {
      logger.info('generate', 'mixing a background bed under the narration', {
        title: bed.title,
        provider: bed.provider,
        level: `${bed.levelDb}dB`,
      });
    }

    await mergeWavsToMp3(
      wavFiles,
      paths.outputMp3,
      (percent) => {
        const span = 100 - CONDITION_PROGRESS_END;
        jobStore.publish({
          status: 'merging',
          progress: CONDITION_PROGRESS_END + Math.round((percent / 100) * span),
        });
      },
      bed,
    );

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
    clearChunks();
    removeFile(paths.outputMp3);

    if (cancelled) {
      jobStore.publish({ status: 'cancelled', progress: 0, message: 'Generation cancelled.' });
      return res.status(499).json({ success: false, error: 'Generation cancelled.', code: 'CANCELLED' });
    }

    logger.error('generate', `failed: ${error.message}`, { code: error.code });
    const message = error.message || 'Audio generation failed.';
    jobStore.publish({ status: 'error', progress: 0, message });
    res.status(500).json({ success: false, error: message, code: error.code });
  } finally {
    finished = true;
    jobStore.endJob();
  }
});

export default router;
