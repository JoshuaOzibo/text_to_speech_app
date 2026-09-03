import fs from 'fs';
import express from 'express';
import { paths } from '../config/env.js';
import * as jobStore from '../utils/jobStore.js';
import { removeFile } from '../utils/cleanup.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

router.get('/result', (req, res) => {
  const result = jobStore.getLastResult();

  if (!result || !fs.existsSync(paths.outputMp3)) {
    return res.status(404).json({ error: 'No audio has been generated yet.' });
  }

  res.json({ success: true, ...result });
});

router.delete('/result', (req, res) => {
  if (jobStore.isBusy()) {
    return res.status(409).json({
      error: 'A generation is running. Cancel it before discarding the audio.',
      code: 'JOB_RUNNING',
    });
  }

  const had = fs.existsSync(paths.outputMp3);
  jobStore.setLastResult(null);
  removeFile(paths.outputMp3);

  if (had) logger.info('result', 'discarded the generated MP3 - the book text changed');
  res.json({ success: true, discarded: had });
});

export default router;
