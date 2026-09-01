import fs from 'fs';
import express from 'express';
import { paths } from '../config/env.js';
import * as jobStore from '../utils/jobStore.js';

const router = express.Router();

router.get('/result', (req, res) => {
  const result = jobStore.getLastResult();

  if (!result || !fs.existsSync(paths.outputMp3)) {
    return res.status(404).json({ error: 'No audio has been generated yet.' });
  }

  res.json({ success: true, ...result });
});

export default router;
