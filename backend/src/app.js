'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { config, ensureDirs } = require('./config/env');
const apiRoutes = require('./routes');

function createApp() {
  ensureDirs();

  const app = express();

  // The Vite dev server runs on a different port, so the browser's API calls are
  // cross-origin during development.
  app.use(cors());

  // Book text is posted as JSON and a full book runs to megabytes of characters.
  app.use(express.json({ limit: '25mb' }));

  app.use('/api', apiRoutes);

  // In production the backend also serves the built frontend, so the whole app
  // runs from a single port.
  if (config.isProduction && fs.existsSync(config.paths.frontendDist)) {
    app.use(express.static(config.paths.frontendDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(config.paths.frontendDist, 'index.html'));
    });
  }

  app.use('/api', (req, res) => {
    res.status(404).json({ error: `Unknown endpoint: ${req.method} ${req.originalUrl}` });
  });

  // Final safety net so a thrown error returns JSON the UI can display rather
  // than Express's default HTML error page.
  app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    if (res.headersSent) return next(error);
    res.status(500).json({ success: false, error: error.message || 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
