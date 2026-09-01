'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { config, ensureDirs } = require('./config/env');
const { logger, requestLogger } = require('./utils/logger');
const apiRoutes = require('./routes');

function createApp() {
  ensureDirs();

  const app = express();

  app.use(cors());

  app.use(express.json({ limit: '25mb' }));

  app.use('/api', requestLogger);

  app.use('/api', apiRoutes);

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

  app.use((error, req, res, next) => {
    logger.error('http', `unhandled error on ${req.method} ${req.originalUrl}: ${error.message}`, {
      code: error.code,
    });
    if (config.nodeEnv !== 'production') console.error(error.stack);
    if (res.headersSent) return next(error);
    res.status(500).json({ success: false, error: error.message || 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
