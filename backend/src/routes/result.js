'use strict';

const fs = require('fs');
const express = require('express');
const { paths } = require('../config/env');
const jobStore = require('../utils/jobStore');

const router = express.Router();

/**
 * Metadata for the most recently generated MP3.
 *
 * Lets a page that reloaded — or a tab that didn't start the run — pick the
 * finished audio back up and show the player, instead of losing it because the
 * response to /api/generate went to a browser that has since navigated away.
 */
router.get('/result', (req, res) => {
  const result = jobStore.getLastResult();

  if (!result || !fs.existsSync(paths.outputMp3)) {
    return res.status(404).json({ error: 'No audio has been generated yet.' });
  }

  res.json({ success: true, ...result });
});

module.exports = router;
