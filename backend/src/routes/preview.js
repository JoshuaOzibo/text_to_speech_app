'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { paths } = require('../config/env');
const { generateChunkAudio, resolveVoice, anyEngineInstalled } = require('../utils/ttsEngine');

const router = express.Router();

/**
 * The paragraph every voice reads when previewed.
 *
 * Deliberately book-like: a couple of clauses, a comma pause, a dash and a
 * closing cadence, so the sample exercises the prosody you'd actually hear in
 * an audiobook rather than a flat single sentence.
 */
const SAMPLE_TEXT =
  'The old accountant kept his ledger in a leather case, and counted every coin twice. ' +
  'Money, he said, is a story we agree to tell each other — nothing more, and nothing less.';

router.get('/preview/sample', (req, res) => {
  res.json({ text: SAMPLE_TEXT });
});

/**
 * Stream a short sample of one voice as WAV.
 *
 * Samples skip the MP3 encode entirely (a couple of seconds of audio doesn't
 * need it) and are cached on disk per voice+speed, so trying voices back and
 * forth is instant after the first listen.
 *
 * This never touches the job slot, so previewing works even while a book is
 * generating — and a cancel can't kill a preview or vice versa.
 */
router.get('/preview', async (req, res) => {
  const voiceId = String(req.query.voice || '');
  const speed = Math.min(2, Math.max(0.5, Number(req.query.speed) || 1));

  if (!voiceId) {
    return res.status(400).json({ error: 'No voice was selected.' });
  }
  if (!anyEngineInstalled()) {
    return res.status(503).json({
      error: 'No TTS engine is installed. Please follow the setup instructions in README.md.',
      code: 'NO_ENGINE',
    });
  }

  try {
    resolveVoice(voiceId);
  } catch (error) {
    return res.status(404).json({ error: error.message, code: error.code });
  }

  // Voice ids are validated against the folder scan above, so they're safe in a
  // filename; the speed is clamped to one decimal.
  const cacheFile = path.join(paths.previews, `${voiceId}-${speed.toFixed(1)}.wav`);

  try {
    if (!fs.existsSync(cacheFile)) {
      fs.mkdirSync(paths.previews, { recursive: true });
      await generateChunkAudio(SAMPLE_TEXT, voiceId, speed, cacheFile);
    }

    const { size } = fs.statSync(cacheFile);
    res.set({
      'Content-Type': 'audio/wav',
      'Content-Length': String(size),
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(cacheFile).pipe(res);
  } catch (error) {
    console.error('Preview error:', error);
    // A half-written file would poison the cache for this voice.
    fs.rmSync(cacheFile, { force: true });
    res.status(500).json({
      error: error.message || 'Could not generate a preview for this voice.',
      code: error.code,
    });
  }
});

module.exports = router;
