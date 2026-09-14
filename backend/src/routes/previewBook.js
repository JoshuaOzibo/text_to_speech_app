import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import express from 'express';
import { config, paths } from '../config/env.js';
import {
  splitIntoChunks,
  generateChunkAudio,
  resolveVoice,
  anyEngineInstalled,
} from '../utils/ttsEngine.js';
import { preprocessText } from '../utils/textCleaner.js';
import { processChunk } from '../utils/wavProcessor.js';
import { buildTimeline } from '../utils/timeline.js';
import { readJson, writeJsonAtomic } from '../utils/atomicFile.js';
import { logger, timer, secs } from '../utils/logger.js';

const MAX_TIMELINE_HEADER = 6000;

const router = express.Router();

router.post('/preview-book', async (req, res) => {
  const { text, voice, speed = 1.0 } = req.body || {};

  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'No text was provided to narrate.' });
  }
  if (!voice) {
    return res.status(400).json({ error: 'No voice was selected.' });
  }
  if (!anyEngineInstalled()) {
    return res.status(503).json({
      error: 'No TTS engine is installed. Please follow the setup instructions in README.md.',
      code: 'NO_ENGINE',
    });
  }

  try {
    resolveVoice(voice);
  } catch (error) {
    return res.status(404).json({ error: error.message, code: error.code });
  }

  const rate = Math.min(2, Math.max(0.5, Number(speed) || 1));

  const chunks = splitIntoChunks(preprocessText(text), config.readLeadWords);

  if (!chunks.length) {
    return res.status(422).json({ error: 'No readable text was found to narrate.' });
  }

  const stamp = crypto
    .createHash('sha1')
    .update(`${voice}|${rate}|${chunks[0].text}`)
    .digest('hex')
    .slice(0, 12);
  const outputPath = path.join(paths.previews, `book-${stamp}.wav`);

  const sidecarPath = outputPath.replace(/\.wav$/, '.json');

  try {
    fs.mkdirSync(paths.previews, { recursive: true });
    const hit =
      fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0 && fs.existsSync(sidecarPath);

    let measured = hit ? readJson(sidecarPath) : null;
    const elapsed = timer();

    if (!measured) {
      await generateChunkAudio(chunks[0].text, voice, rate, outputPath);
      const result = processChunk(outputPath, { gapMs: 0 });
      if (result) {
        measured = { speechSec: result.speechSec, pauses: result.pauses };
        writeJsonAtomic(sidecarPath, measured);
      }
    }

    logger.info('preview', measured && hit ? 'book preview (cached)' : 'book preview', {
      voice,
      words: chunks[0].text.split(/\s+/).length,
      audio: measured ? secs(measured.speechSec) : 'n/a',
      took: secs(elapsed()),
    });

    const { size } = fs.statSync(outputPath);
    res.set({
      'Content-Type': 'audio/wav',
      'Content-Length': String(size),
      'Cache-Control': 'no-store',
    });

    if (measured) {
      const timeline = buildTimeline(text, [
        {
          text: chunks[0].text,
          speechSec: measured.speechSec,
          gapSec: 0,
          pauses: measured.pauses,
        },
      ]);
      const encoded = JSON.stringify(timeline);
      if (encoded.length <= MAX_TIMELINE_HEADER) res.set('X-Word-Timeline', encoded);
    }
    fs.createReadStream(outputPath).pipe(res);
  } catch (error) {
    logger.error('preview', `book preview failed: ${error.message}`, { code: error.code });
    fs.rmSync(outputPath, { force: true });
    res.status(500).json({
      error: error.message || 'Could not generate a preview.',
      code: error.code,
    });
  }
});

export default router;
