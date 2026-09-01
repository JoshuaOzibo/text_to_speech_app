'use strict';

const fs = require('fs');
const express = require('express');
const { paths } = require('../config/env');
const { listVoices, engineStatus, anyEngineInstalled } = require('../utils/ttsEngine');
const { ffmpegAvailable } = require('../utils/audioMerger');
const jobStore = require('../utils/jobStore');

const router = express.Router();

router.get('/health', (req, res) => {
  const engines = engineStatus();
  res.json({
    status: 'ok',
    engines,
    ttsAvailable: anyEngineInstalled(),
    piperInstalled: engines.piper,
    ffmpegAvailable: ffmpegAvailable(),
    voiceCount: listVoices().length,
    hasAudio: fs.existsSync(paths.outputMp3),
    generating: jobStore.isBusy(),
  });
});

module.exports = router;
