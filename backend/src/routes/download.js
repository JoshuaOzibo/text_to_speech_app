'use strict';

const fs = require('fs');
const express = require('express');
const { config, paths } = require('../config/env');
const { scheduleOutputCleanup } = require('../utils/cleanup');

const router = express.Router();

function toFilename(name) {
  const base = String(name || 'audiobook')
    .replace(/\.[^.]+$/, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
  return `${base || 'audiobook'}.mp3`;
}

router.get('/download', (req, res) => {
  if (!fs.existsSync(paths.outputMp3)) {
    return res.status(404).json({ error: 'No audio has been generated yet.' });
  }

  const filename = toFilename(req.query.name);
  const { size } = fs.statSync(paths.outputMp3);

  res.set({
    'Content-Type': 'audio/mpeg',
    'Content-Length': String(size),
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  });

  const stream = fs.createReadStream(paths.outputMp3);
  stream.pipe(res);

  res.on('finish', () => scheduleOutputCleanup(config.cleanupDelayMs));
  stream.on('error', () => res.destroy());
});

module.exports = router;
