'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { config, paths } = require('../config/env');
const jobStore = require('../utils/jobStore');
const {
  splitIntoChunks,
  generateChunkAudio,
  anyEngineInstalled,
  resolveVoice,
} = require('../utils/ttsEngine');
const { mergeWavsToMp3, totalWavDuration, ffmpegAvailable } = require('../utils/audioMerger');
const { processChunk } = require('../utils/wavProcessor');
const { preprocessText } = require('../utils/textCleaner');
const { clearChunks, removeFile, cancelScheduledCleanup } = require('../utils/cleanup');

const router = express.Router();

// Progress budget for each stage of the pipeline. Synthesis dominates the wall
// clock, so it owns most of the bar; conditioning is fast; the final ffmpeg pass
// reports real progress of its own.
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

  // Fail fast with an actionable message rather than part-way through a book.
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

  // If the browser goes away mid-generation — reload, navigate, closed tab —
  // stop working and free the job slot. Without this the server keeps narrating
  // a book nobody is waiting for, and every later attempt gets a 409 for a run
  // the user can no longer see.
  //
  // Attached only after our own job starts, so a request that was rejected with
  // a 409 can never cancel the job it lost the race to.
  //
  // Listen on the RESPONSE, not the request: express.json() has already drained
  // the request body by the time this handler runs, so req's 'close' fires
  // immediately on every call and would abort every generation. res emits
  // 'close' when the socket goes away, and writableFinished distinguishes "we
  // sent the whole response" from "the client hung up on us".
  let finished = false;
  res.on('close', () => {
    if (!finished && !res.writableFinished && jobStore.isBusy()) {
      console.log('Client disconnected mid-generation — cancelling.');
      jobStore.cancel();
    }
  });

  // Start from a clean slate so a previous run's chunks can't leak into this one.
  jobStore.setLastResult(null);
  clearChunks();
  removeFile(paths.outputMp3);
  fs.mkdirSync(paths.chunks, { recursive: true });

  // Prepare the text for speech once, before chunking: fix ALL CAPS, expand
  // symbols and context-sensitive numbers, drop URLs. The uploaded text the
  // client displays is untouched — only what the engine hears changes.
  const spokenText = preprocessText(text);
  const chunks = splitIntoChunks(spokenText, config.wordsPerChunk);
  const wavFiles = [];

  try {
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
      // trackChild lets a cancel kill a process-based engine mid-chunk;
      // isCancelled lets an in-process engine bail at its next safe point.
      await generateChunkAudio(
        chunks[i].text,
        voice,
        rate,
        wavPath,
        jobStore.trackChild,
        jobStore.isCancelled
      );
      wavFiles.push(wavPath);

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

    // Condition every chunk: trim the warm-up lead, level it to a common RMS,
    // fade both edges, and append the inter-chunk gap. Without this the merged
    // book clicks at every join and jumps in volume between chunks.
    jobStore.publish({ status: 'processing', progress: SYNTH_PROGRESS_SHARE });

    for (let i = 0; i < wavFiles.length; i += 1) {
      processChunk(wavFiles[i], {
        gapMs: chunks[i].endsChapter ? config.chapterGapMs : config.chunkGapMs,
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

    // Measured after conditioning — trimming and padding both change lengths.
    const duration = Math.round(totalWavDuration(wavFiles));

    await mergeWavsToMp3(wavFiles, paths.outputMp3, (percent) => {
      const span = 100 - CONDITION_PROGRESS_END;
      jobStore.publish({
        status: 'merging',
        progress: CONDITION_PROGRESS_END + Math.round((percent / 100) * span),
      });
    });

    // The MP3 is the deliverable; the chunks are scratch space.
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
    };
    // Remember it so a reloaded page can recover this audio via /api/result.
    jobStore.setLastResult(result);

    res.json({ success: true, ...result });
  } catch (error) {
    const cancelled = error.code === 'CANCELLED' || jobStore.isCancelled();
    clearChunks();
    removeFile(paths.outputMp3);

    if (cancelled) {
      jobStore.publish({ status: 'cancelled', progress: 0, message: 'Generation cancelled.' });
      return res.status(499).json({ success: false, error: 'Generation cancelled.', code: 'CANCELLED' });
    }

    console.error('Generation error:', error);
    const message = error.message || 'Audio generation failed.';
    jobStore.publish({ status: 'error', progress: 0, message });
    res.status(500).json({ success: false, error: message, code: error.code });
  } finally {
    // Runs synchronously after the response is sent, and the 'close' event
    // fires on a later tick — so this reliably marks a completed request as
    // finished before the disconnect handler could misread it as an abort.
    finished = true;
    jobStore.endJob();
  }
});

module.exports = router;
