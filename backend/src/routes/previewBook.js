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

const router = express.Router();

/**
 * Narrate only the first chunk of an uploaded book.
 *
 * Lets the user hear the actual opening — this voice, this speed, this text,
 * through the same preprocessing and conditioning the full run uses — before
 * committing to a job that can take hours.
 *
 * Like /api/preview, this deliberately bypasses the job slot: previewing during
 * a generation is allowed, and a cancel can never kill a preview.
 */
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

  // Its own file, so a preview can never collide with a running generation's
  // chunk files.
  const outputPath = path.join(paths.previews, 'first-chunk.wav');

  try {
    fs.mkdirSync(paths.previews, { recursive: true });
    await generateChunkAudio(chunks[0].text, voice, rate, outputPath);
    processChunk(outputPath, { gapMs: 0 });

    const { size } = fs.statSync(outputPath);
    res.set({
      'Content-Type': 'audio/wav',
      'Content-Length': String(size),
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(outputPath).pipe(res);
  } catch (error) {
    console.error('Book preview error:', error);
    fs.rmSync(outputPath, { force: true });
    res.status(500).json({
      error: error.message || 'Could not generate a preview.',
      code: error.code,
    });
  }
});

module.exports = router;
