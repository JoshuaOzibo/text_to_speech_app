'use strict';

const express = require('express');
const jobStore = require('../utils/jobStore');

const router = express.Router();

router.post('/cancel', (req, res) => {
  if (!jobStore.isBusy()) {
    return res.status(409).json({ success: false, error: 'Nothing is generating right now.' });
  }
  jobStore.cancel();
  res.json({ success: true });
});

module.exports = router;
