import { execSync } from 'child_process';
import { createApp } from './app.js';
import { config } from './config/env.js';
import { listVoices, engineStatus } from './utils/ttsEngine.js';
import { ffmpegAvailable } from './utils/audioMerger.js';
import { clearOrphanChunks, clearUploads } from './utils/cleanup.js';
import { logger } from './utils/logger.js';


const keptChunks = clearOrphanChunks();
clearUploads();

const app = createApp();

function freePort(port) {
  try {
    if (process.platform === 'win32') {
      const pid = process.pid;
      const cmd = `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -ne ${pid} } | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`;
      execSync(cmd, { stdio: 'ignore' });
    } else {
      execSync(`npx kill-port ${port}`, { stdio: 'ignore' });
    }
  } catch (e) {
  }
}

let server;

function startServer(retries = 3) {
  server = app.listen(config.port, '0.0.0.0', () => {
    const voices = listVoices();
    const engines = engineStatus();
    const byEngine = (name) => voices.filter((v) => v.engine === name).length;

    console.log(`\n  LocalAudioBook API  →  http://localhost:${config.port}  (${config.nodeEnv})`);

    for (const [name, present] of Object.entries(engines)) {
      const label = name.charAt(0).toUpperCase() + name.slice(1);
      console.log(
        `  ${label.padEnd(12)} ${present ? `found (${byEngine(name)} voices)` : 'not installed, see README.md'}`
      );
    }

    console.log(
      `  ${'ffmpeg'.padEnd(12)} ${ffmpegAvailable() ? 'found' : 'NOT FOUND, run: npm install ffmpeg-static'}`
    );
    console.log(`  ${'Total'.padEnd(12)} ${voices.length} voices`);
    console.log(`  ${'Logging'.padEnd(12)} ${logger.level}  (set LOG_LEVEL=debug to trace a stall)`);
    if (keptChunks.kept) {
      const of = keptChunks.total ? ` of ${keptChunks.total}` : '';
      const by = keptChunks.voice ? ` (${keptChunks.voice})` : '';
      console.log(
        `  ${'Resumable'.padEnd(12)} ${keptChunks.kept}${of} chunks from an interrupted run${by} — ` +
          'press Resume in the sidebar, or POST /api/generate/resume',
      );
    }
    if (voices.length === 0) {
      console.log('\n  No voices installed. See README.md to add some.');
    }
    console.log('');
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && retries > 0) {
      logger.warn('server', `Port ${config.port} in use, freeing port and retrying... (${retries} attempts left)`);
      freePort(config.port);
      setTimeout(() => {
        startServer(retries - 1);
      }, 1000);
    } else {
      logger.error('server', `Failed to start server: ${err.message}`);
      process.exit(1);
    }
  });
}

function gracefulShutdown(signal) {
  if (server) {
    server.close(() => {
      if (signal === 'SIGUSR2') {
        process.kill(process.pid, 'SIGUSR2');
      } else {
        process.exit(0);
      }
    });
  } else {
    process.exit(0);
  }
}

process.once('SIGUSR2', () => gracefulShutdown('SIGUSR2'));
process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));

startServer();

