'use strict';

const fs = require('fs');
const express = require('express');
const { paths } = require('../config/env');
const jobStore = require('../utils/jobStore');

const router = express.Router();

router.get('/result', (req, res) => {
  const result = jobStore.getLastResult();

  if (!result || !fs.existsSync(paths.outputMp3)) {
    return res.status(404).json({ error: 'No audio has been generated yet.' });
  }

  res.json({ success: true, ...result });
});

module.exports = router;
