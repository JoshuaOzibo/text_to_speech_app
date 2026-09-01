'use strict';

const fs = require('fs');
const express = require('express');
const { config, paths } = require('../config/env');
const { scheduleOutputCleanup } = require('../utils/cleanup');

const router = express.Router();

/** Turn a book title into a safe MP3 filename. */
function toFilename(name) {
  const base = String(name || 'audiobook')
    .replace(/\.[^.]+$/, '') // drop the source extension
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
  return `${base || 'audiobook'}.mp3`;
}

/**
 * Send the finished MP3 as a download.
 *
 * Temp files are swept a few minutes later rather than immediately, so the user
 * can re-download or keep playing without the file vanishing mid-stream.
 */
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
