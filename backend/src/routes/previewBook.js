'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { config, paths } = require('../config/env');
const {
  splitIntoChunks,
  generateChunkAudio,
  resolveVoice,
  anyEngineInstalled,
} = require('../utils/ttsEngine');
const { preprocessText } = require('../utils/textCleaner');
const { processChunk } = require('../utils/wavProcessor');
const { buildTimeline } = require('../utils/timeline');
const { logger } = require('../utils/logger');

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
  const chunks = splitIntoChunks(preprocessText(text), config.wordsPerChunk);

  if (!chunks.length) {
    return res.status(422).json({ error: 'No readable text was found to narrate.' });
  }

  const outputPath = path.join(paths.previews, 'first-chunk.wav');

  try {
    fs.mkdirSync(paths.previews, { recursive: true });
    await generateChunkAudio(chunks[0].text, voice, rate, outputPath);
    const measured = processChunk(outputPath, { gapMs: 0 });

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

module.exports = router;
