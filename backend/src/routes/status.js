'use strict';

const express = require('express');
const jobStore = require('../utils/jobStore');

const router = express.Router();

/**
 * Server-Sent Events stream of generation progress.
 *
 * The client opens this before POSTing to /api/generate, and jobStore replays
 * the current snapshot on connect, so no update can be missed in the gap
 * between subscribing and starting.
 */
router.get('/status', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Vite's dev proxy buffers by default; this asks any proxy not to.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const unsubscribe = jobStore.subscribe(res);

  // Comment frames keep the connection alive through idle periods.
  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* closed; the close handler will clean up */
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

module.exports = router;
