'use strict';

const { createApp } = require('./app');
const { config } = require('./config/env');
const { listVoices, engineStatus } = require('./utils/ttsEngine');
const { ffmpegAvailable } = require('./utils/audioMerger');
const { clearChunks, clearUploads } = require('./utils/cleanup');
const { logger } = require('./utils/logger');

clearChunks();
clearUploads();

const app = createApp();

app.listen(config.port, '0.0.0.0', () => {
  const voices = listVoices();
  const engines = engineStatus();
  const byEngine = (name) => voices.filter((v) => v.engine === name).length;

  console.log(`\n  LocalAudioBook API  →  http://localhost:${config.port}  (${config.nodeEnv})`);

  for (const [name, present] of Object.entries(engines)) {
    const label = name.charAt(0).toUpperCase() + name.slice(1);
    console.log(
      `  ${label.padEnd(12)} ${present ? `found (${byEngine(name)} voices)` : 'not installed — see README.md'}`
    );
  }

  console.log(
    `  ${'ffmpeg'.padEnd(12)} ${ffmpegAvailable() ? 'found' : 'NOT FOUND — npm install ffmpeg-static'}`
  );
  console.log(`  ${'Total'.padEnd(12)} ${voices.length} voices`);
  console.log(`  ${'Logging'.padEnd(12)} ${logger.level}  (set LOG_LEVEL=debug to trace a stall)`);
  if (voices.length === 0) {
    console.log('\n  No voices installed. See README.md to add some.');
  }
  console.log('');
});
