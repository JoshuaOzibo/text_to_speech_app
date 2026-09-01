'use strict';

const fs = require('fs');
const express = require('express');
const { paths } = require('../config/env');

const router = express.Router();

/**
 * Stream the generated MP3 for in-browser playback.
 *
 * HTTP Range support is what makes the seek bar work: without a 206 response
 * the browser can't jump to an arbitrary position in the file, and on a
 * multi-hour audiobook that is the difference between usable and useless.
 */
router.get('/audio/output.mp3', (req, res) => {
  if (!fs.existsSync(paths.outputMp3)) {
    return res.status(404).json({ error: 'No audio has been generated yet.' });
  }

  const { size } = fs.statSync(paths.outputMp3);
  const range = req.headers.range;

  res.set('Accept-Ranges', 'bytes');
  res.set('Content-Type', 'audio/mpeg');
  // The file changes with every generation, so it must never be cached.
  res.set('Cache-Control', 'no-store');

  if (!range) {
    res.set('Content-Length', String(size));
    return fs.createReadStream(paths.outputMp3).pipe(res);
  }

  const match = /bytes=(\d*)-(\d*)/.exec(range);
  if (!match) {
    return res.status(416).set('Content-Range', `bytes */${size}`).end();
  }

  // An open-ended suffix range ("bytes=-500") counts back from the end.
  let start = match[1] ? parseInt(match[1], 10) : size - parseInt(match[2] || '0', 10);
  let end = match[2] && match[1] ? parseInt(match[2], 10) : size - 1;

  start = Math.max(0, start);
  end = Math.min(end, size - 1);

  if (Number.isNaN(start) || Number.isNaN(end) || start > end) {
    return res.status(416).set('Content-Range', `bytes */${size}`).end();
  }

  res.status(206);
  res.set('Content-Range', `bytes ${start}-${end}/${size}`);
  res.set('Content-Length', String(end - start + 1));
  fs.createReadStream(paths.outputMp3, { start, end }).pipe(res);
});

module.exports = router;
