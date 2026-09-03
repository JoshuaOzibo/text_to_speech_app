import fs from 'fs';
import path from 'path';
import express from 'express';
import { paths } from '../config/env.js';
import { generateChunkAudio, resolveVoice, anyEngineInstalled } from '../utils/ttsEngine.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

const SAMPLE_TEXT =
  'The old accountant kept his ledger in a leather case, and counted every coin twice. ' +
  'Money, he said, is a story we agree to tell each other, nothing more, and nothing less.';

router.get('/preview/sample', (req, res) => {
  res.json({ text: SAMPLE_TEXT });
});

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
    logger.error('preview', `voice sample failed: ${error.message}`, { code: error.code });
    fs.rmSync(cacheFile, { force: true });
    res.status(500).json({
      error: error.message || 'Could not generate a preview for this voice.',
      code: error.code,
    });
  }
});

export default router;
