import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { logger, secs, timer } from './logger.js';

const RATE = 8000;
const HOP = 160;
const WINDOW_START = 15;
const WINDOW_SEC = 20;
const PROBE_TIMEOUT_MS = 20000;
const CONCURRENCY = 6;

const USER_AGENT = 'LocalAudioBook/1.0 (local audiobook tool)';

const cache = new Map();

let active = 0;
const waiting = [];

function acquire() {
  if (active < CONCURRENCY) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function release() {
  const next = waiting.shift();
  if (next) return next();
  active -= 1;
}

function probeUrl(track) {
  return track.auditionUrl || track.audioUrl;
}

function inputArgs(track) {
  const url = probeUrl(track);
  const args = ['-user_agent', USER_AGENT, '-rw_timeout', '15000000'];

  if (track.pageUrl || url) {
    const referer = track.pageUrl || new URL(url).origin;
    args.push('-headers', `Referer: ${referer}\r\n`);
  }

  args.push('-ss', String(WINDOW_START), '-t', String(WINDOW_SEC), '-i', url);
  return args;
}

function decode(track) {
  return new Promise((resolve) => {
    const args = [
      '-hide_banner',
      '-nostdin',
      ...inputArgs(track),
      '-map',
      '0:a:0',
      '-ac',
      '1',
      '-ar',
      String(RATE),
      '-f',
      's16le',
      '-',
    ];

    const child = spawn(ffmpegPath, args);
    const chunks = [];
    let stderr = '';
    let settled = false;

    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(killer);
      resolve(value);
    };

    const killer = setTimeout(() => {
      child.kill('SIGKILL');
      done({ error: 'timed out' });
    }, PROBE_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => done({ error: error.message }));
    child.on('close', () => {
      const match = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(stderr);
      const duration = match
        ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
        : 0;
      done({ pcm: Buffer.concat(chunks), duration, stderr });
    });
  });
}

function envelopeStats(pcm) {
  const frames = Math.floor(pcm.length / 2 / HOP);
  if (frames < 50) return null;

  const env = new Float64Array(frames);
  for (let f = 0; f < frames; f += 1) {
    let sum = 0;
    const base = f * HOP;
    for (let j = 0; j < HOP; j += 1) {
      const sample = pcm.readInt16LE((base + j) * 2) / 32768;
      sum += sample * sample;
    }
    env[f] = 10 * Math.log10(Math.max(sum / HOP, 1e-12));
  }

  let mean = 0;
  for (const value of env) mean += value;
  mean /= frames;

  let variance = 0;
  for (const value of env) variance += (value - mean) * (value - mean);
  const flatnessDb = Math.sqrt(variance / frames);

  const sorted = Array.from(env).sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
  const rangeDb = at(0.95) - at(0.1);

  return { flatnessDb, rangeDb, levelDb: mean };
}

async function probeTrack(track) {
  const key = `${track.provider}:${track.id}`;
  const cached = cache.get(key);
  if (cached) return cached;

  if (!ffmpegPath || !probeUrl(track)) {
    return { measured: false, reason: 'no audio to measure' };
  }

  await acquire();
  const elapsed = timer();
  let result;

  try {
    const decoded = await decode(track);

    if (decoded.error) {
      result = { measured: false, reason: decoded.error };
    } else {
      const stats = envelopeStats(decoded.pcm);
      result = stats
        ? {
            measured: true,
            durationSec: Math.round(decoded.duration) || track.durationSec || 0,
            flatnessDb: Number(stats.flatnessDb.toFixed(2)),
            rangeDb: Number(stats.rangeDb.toFixed(2)),
            levelDb: Number(stats.levelDb.toFixed(1)),
          }
        : { measured: false, reason: 'too little audio to measure' };
    }
  } finally {
    release();
  }

  logger.debug('sound', 'probed a candidate', {
    track: track.title,
    provider: track.provider,
    flatness: result.measured ? result.flatnessDb : undefined,
    range: result.measured ? result.rangeDb : undefined,
    why: result.measured ? undefined : result.reason,
    took: secs(elapsed()),
  });

  cache.set(key, result);
  return result;
}

async function probeAll(tracks) {
  return Promise.all(tracks.map((track) => probeTrack(track)));
}

export { probeTrack, probeAll };
