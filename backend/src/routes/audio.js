import fs from 'fs';
import express from 'express';
import { paths } from '../config/env.js';
import { sendFileRange } from '../utils/httpRange.js';

const router = express.Router();

router.get('/audio/output.mp3', (req, res) => {
  if (!fs.existsSync(paths.outputMp3)) {
    return res.status(404).json({ error: 'No audio has been generated yet.' });
  }

  sendFileRange(req, res, paths.outputMp3, 'audio/mpeg');
});

export default router;
