'use strict';

const express = require('express');
const { listVoices, engineStatus, anyEngineInstalled } = require('../utils/ttsEngine');
const { ffmpegAvailable } = require('../utils/audioMerger');

const router = express.Router();

/**
 * Report the voices actually available across every engine, plus which engines
 * and tools are installed, so the UI can show precise setup guidance rather
 * than a generic failure once generation is attempted.
 */
router.get('/voices', (req, res) => {
  res.json({
    voices: listVoices(),
    engines: engineStatus(),
    ttsAvailable: anyEngineInstalled(),
    ffmpegAvailable: ffmpegAvailable(),
    // Kept for backwards compatibility with the original Piper-only shape.
    piperInstalled: engineStatus().piper,
  });
});

module.exports = router;
