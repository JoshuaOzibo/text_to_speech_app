import express from 'express';
import { listVoices, engineStatus, anyEngineInstalled } from '../utils/ttsEngine.js';
import { ffmpegAvailable } from '../utils/audioMerger.js';

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

export default router;
