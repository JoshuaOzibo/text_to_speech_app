'use strict';

const { createApp } = require('./app');
const { config } = require('./config/env');
const { listVoices, engineStatus } = require('./utils/ttsEngine');
const { ffmpegAvailable } = require('./utils/audioMerger');
const { clearChunks, clearUploads } = require('./utils/cleanup');

// A previous run may have been killed mid-generation; start from a clean slate.
clearChunks();
clearUploads();

const app = createApp();

app.listen(config.port, '0.0.0.0', () => {
  const voices = listVoices();
  const engines = engineStatus();
  const byEngine = (name) => voices.filter((v) => v.engine === name).length;

  console.log(`\n  LocalAudioBook API  →  http://localhost:${config.port}  (${config.nodeEnv})`);

  // Driven by engineStatus() so a newly added engine shows up here for free.
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
  if (voices.length === 0) {
    console.log('\n  No voices installed. See README.md to add some.');
  }
  console.log('');
});
