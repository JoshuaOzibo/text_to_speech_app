'use strict';

const express = require('express');
const jobStore = require('../utils/jobStore');

const router = express.Router();

/**
 * Stop an in-flight generation.
 *
 * jobStore kills the running Piper process; the generate handler then unwinds,
 * removes the partial chunks and reports the cancellation.
 */
router.post('/cancel', (req, res) => {
  if (!jobStore.isBusy()) {
    return res.status(409).json({ success: false, error: 'Nothing is generating right now.' });
  }
  jobStore.cancel();
  res.json({ success: true });
});

module.exports = router;
