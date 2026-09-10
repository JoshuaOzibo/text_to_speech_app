import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
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

const MANIFEST = 'run.json';

const chunkWav = (index) => path.join(paths.chunks, `chunk-${String(index + 1).padStart(4, '0')}.wav`);
const chunkSidecar = (index) => chunkWav(index).replace(/\.wav$/, '.json');

function runKey(spokenText, voice, speed) {
  return crypto
    .createHash('sha1')
    .update(`${voice}|${speed}|${spokenText}`)
    .digest('hex')
    .slice(0, 16);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data), 'utf8');
}

function sweepPartials() {
  if (!fs.existsSync(paths.chunks)) return;
  for (const entry of fs.readdirSync(paths.chunks)) {
    if (entry.endsWith('.part') || entry.endsWith('.tmp')) {
      removeFile(path.join(paths.chunks, entry));
    }
  }
}

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
      logger.warn('generate', 'client hung up mid-generation - cancelling');
      jobStore.cancel();
    }
  });

  jobStore.setLastResult(null);
  removeFile(paths.outputMp3);

  const spokenText = preprocessText(text);
  const chunks = splitIntoChunks(spokenText, config.wordsPerChunk);
  const wavFiles = [];

  const key = runKey(spokenText, voice, rate);
  const manifestFile = path.join(paths.chunks, MANIFEST);
  const previous = readJson(manifestFile);
  const resuming = previous?.key === key && previous?.total === chunks.length;

  if (!resuming) clearChunks();
  fs.mkdirSync(paths.chunks, { recursive: true });
  sweepPartials();
  if (!resuming) writeJson(manifestFile, { key, total: chunks.length, voice, speed: rate });

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
      fs.renameSync(partPath, wavPath);
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

      if (!measured) {
        const result = processChunk(wavFiles[i], { gapMs });
        measured = {
          speechSec: result ? result.speechSec : readWavDuration(wavFiles[i]),
          gapSec: result ? gapMs / 1000 : 0,
          pauses: result ? result.pauses : [],
        };
        writeJson(sidecar, measured);
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
    removeFile(paths.outputMp3);
    sweepPartials();

    if (cancelled) {
      clearChunks();
      jobStore.publish({ status: 'cancelled', progress: 0, message: 'Generation cancelled.' });
      return res.status(499).json({ success: false, error: 'Generation cancelled.', code: 'CANCELLED' });
    }


    const kept = fs.existsSync(paths.chunks)
      ? fs.readdirSync(paths.chunks).filter((f) => f.endsWith('.wav')).length
      : 0;

    logger.error('generate', `failed: ${error.message}`, { code: error.code, keptChunks: kept });

    const message = error.message || 'Audio generation failed.';
    const resumable = kept
      ? `${message} ${kept} finished ${kept === 1 ? 'chunk was' : 'chunks were'} kept — starting the same book again with the same voice will carry on from there.`
      : message;

    jobStore.publish({ status: 'error', progress: 0, message: resumable });
    res.status(500).json({ success: false, error: resumable, code: error.code });
  } finally {
    finished = true;
    jobStore.endJob();
  }
});

export default router;
