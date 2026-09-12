import express from 'express';
import * as jobStore from '../utils/jobStore.js';
import { clearChunks } from '../utils/cleanup.js';
import { countFinishedChunks, resumableRun } from '../utils/runManifest.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

router.get('/chunks', (req, res) => {
  res.json(resumableRun());
});

router.delete('/chunks', (req, res) => {
  if (jobStore.isBusy()) {
    return res.status(409).json({
      success: false,
      code: 'GENERATION_RUNNING',
      error: 'A generation is running. Cancel it before clearing the chunks.',
    });
  }

  const removed = countFinishedChunks();
  clearChunks();

  logger.info('chunks', 'cleared by request', { removed });
  res.json({ success: true, removed });
});

export default router;
