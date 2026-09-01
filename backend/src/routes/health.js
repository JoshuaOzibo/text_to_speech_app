import fs from 'fs';
import express from 'express';
import { paths } from '../config/env.js';
import { listVoices, engineStatus, anyEngineInstalled } from '../utils/ttsEngine.js';
import { ffmpegAvailable } from '../utils/audioMerger.js';
import * as jobStore from '../utils/jobStore.js';

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

export default router;
