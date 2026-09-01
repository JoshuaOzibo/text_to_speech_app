'use strict';

const express = require('express');
const { listVoices, engineStatus, anyEngineInstalled } = require('../utils/ttsEngine');
const { ffmpegAvailable } = require('../utils/audioMerger');

const router = express.Router();

router.get('/voices', (req, res) => {
  res.json({
    voices: listVoices(),
    engines: engineStatus(),
    ttsAvailable: anyEngineInstalled(),
    ffmpegAvailable: ffmpegAvailable(),
    piperInstalled: engineStatus().piper,
  });
});

module.exports = router;
