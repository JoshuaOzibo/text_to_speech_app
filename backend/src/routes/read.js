import fs from 'fs';
import path from 'path';
import express from 'express';
import { config, paths } from '../config/env.js';
import { generateChunkAudio, resolveVoice, anyEngineInstalled } from '../utils/ttsEngine.js';
import { processChunk } from '../utils/wavProcessor.js';
import { segmentChunk, alignToDisplay } from '../utils/timeline.js';
import { setPlan, getPlan, publicPlan } from '../utils/readStore.js';
import { logger, secs, timer, watchdog } from '../utils/logger.js';

const MAX_TIMELINE_HEADER = 6000;

const router = express.Router();

const inFlight = new Map();

let active = 0;
const waiting = [];

function acquireSlot() {
  if (active < config.readConcurrency) {
    active += 1;
    return Promise.resolve();
  }
  logger.debug('read', 'synthesis slots busy, queueing', { active, queued: waiting.length + 1 });
  return new Promise((resolve) => waiting.push(resolve));
}

function releaseSlot() {
  const next = waiting.shift();
  if (next) next();
  else active = Math.max(0, active - 1);
}

async function synthesizeWithRetry(chunk, index, voiceId, rate, wavPath) {
  try {
    await generateChunkAudio(chunk.text, voiceId, rate, wavPath);
  } catch (error) {
    if (error.code === 'CANCELLED') throw error;
    logger.warn('read', `chunk ${index} failed, retrying once: ${error.message}`, {
      code: error.code,
    });
    fs.rmSync(wavPath, { force: true });
    await generateChunkAudio(chunk.text, voiceId, rate, wavPath);
  }
}

function cacheKey(voiceId, rate) {
  const voice = String(voiceId).replace(/[^A-Za-z0-9_-]/g, '');
  return `${voice}-${Math.round(rate * 100)}`;
}

function pruneCache(dir, keep) {
  let entries;
  try {
    entries = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.wav'))
      .map((name) => {
        const full = path.join(dir, name);
        return { full, base: full.slice(0, -4), mtime: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return;
  }

  for (const entry of entries.slice(keep)) {
    try {
      fs.rmSync(entry.full, { force: true });
      fs.rmSync(`${entry.base}.json`, { force: true });
    } catch {
    }
  }
}

async function renderChunk(plan, index, voiceId, rate) {
  const dir = path.join(paths.read, plan.id);
  const base = path.join(dir, `${cacheKey(voiceId, rate)}-${index}`);
  const wavPath = `${base}.wav`;
  const metaPath = `${base}.json`;

  if (fs.existsSync(wavPath) && fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      logger.debug('read', `chunk ${index} served from cache`, { voice: voiceId });
      return { wavPath, meta, cached: true };
    } catch {
      logger.warn('read', `cached metadata for chunk ${index} was unreadable, rebuilding`);
    }
  }

  if (inFlight.has(wavPath)) {
    logger.debug('read', `chunk ${index} already being synthesized, joining that request`);
    return inFlight.get(wavPath);
  }

  const work = (async () => {
    fs.mkdirSync(dir, { recursive: true });
    const chunk = plan.chunks[index];

    logger.debug('read', `chunk ${index} synthesizing`, {
      voice: voiceId,
      speed: rate,
      words: chunk.words,
    });

    const queued = timer();
    await acquireSlot();
    const queuedSec = queued();

    const elapsed = timer();
    const stop = watchdog('read', `chunk ${index} synthesis`);
    try {
      await synthesizeWithRetry(chunk, index, voiceId, rate, wavPath);
    } finally {
      stop();
      releaseSlot();
    }
    const synthSec = elapsed();
    const measured = processChunk(wavPath, { gapMs: 0 });

    const speechSec = measured ? measured.speechSec : 0;
    const segments = segmentChunk(chunk.text, measured ? measured.pauses : [], 0, speechSec);

    const meta = {
      duration: Number(speechSec.toFixed(3)),
      timeline: {
        words: plan.displayWords.length,
        duration: Number(speechSec.toFixed(3)),
        segments: alignToDisplay(plan.displayWords, segments, 60, chunk.a),
      },
    };

    fs.writeFileSync(metaPath, JSON.stringify(meta));
    pruneCache(dir, config.readCacheChunks);

    const ratio = speechSec > 0 ? synthSec / speechSec : 0;
    const stats = {
      voice: voiceId,
      synth: secs(synthSec),
      audio: secs(speechSec),
      realtime: `${ratio.toFixed(2)}x`,
      queued: queuedSec > 0.05 ? secs(queuedSec) : undefined,
    };
    if (ratio >= 0.9) {
      logger.warn('read', `chunk ${index} took longer than it plays - reading will stall`, stats);
    } else {
      logger.info('read', `chunk ${index} ready`, stats);
    }

    return { wavPath, meta, cached: false };
  })();

  inFlight.set(wavPath, work);
  try {
    return await work;
  } finally {
    inFlight.delete(wavPath);
  }
}

router.post('/read/plan', (req, res) => {
  const { text } = req.body || {};

  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'No text was provided to read.' });
  }

  try {
    const elapsed = timer();
    const plan = setPlan(text);
    if (!plan.chunks.length) {
      logger.warn('read', 'plan rejected - no readable text');
      return res.status(422).json({ error: 'No readable text was found to narrate.' });
    }
    logger.info('read', 'plan ready', {
      id: plan.id,
      chunks: plan.chunks.length,
      words: plan.displayWords.length,
      took: secs(elapsed()),
    });
    res.json(publicPlan(plan));
  } catch (error) {
    logger.error('read', `plan failed: ${error.message}`);
    res.status(500).json({ error: error.message || 'Could not prepare the book for reading.' });
  }
});

router.get('/read/:id/:index', async (req, res) => {
  const plan = getPlan(req.params.id);
  const index = Number(req.params.index);
  const { voice, speed = '1' } = req.query;

  if (!plan) {
    logger.warn('read', `no plan for id ${req.params.id} - the client will re-send the book`);
    return res.status(404).json({
      error: 'This book is no longer loaded for reading.',
      code: 'READ_PLAN_UNKNOWN',
    });
  }
  if (!Number.isInteger(index) || index < 0 || index >= plan.chunks.length) {
    return res.status(404).json({ error: 'That part of the book does not exist.' });
  }
  if (!voice) {
    return res.status(400).json({ error: 'No voice was selected.' });
  }
  if (!anyEngineInstalled()) {
    return res.status(503).json({
      error: 'No TTS engine is installed. Please follow the setup instructions in README.md.',
      code: 'NO_ENGINE',
    });
  }

  try {
    resolveVoice(voice);
  } catch (error) {
    return res.status(404).json({ error: error.message, code: error.code });
  }

  const rate = Math.min(2, Math.max(0.5, Number(speed) || 1));

  try {
    const { wavPath, meta } = await renderChunk(plan, index, voice, rate);
    const { size } = fs.statSync(wavPath);

    res.set({
      'Content-Type': 'audio/wav',
      'Content-Length': String(size),
      'Cache-Control': 'no-store',
      'X-Chunk-Duration': String(meta.duration),
      'X-Chunk-Index': String(index),
    });

    const encoded = JSON.stringify(meta.timeline);
    if (encoded.length <= MAX_TIMELINE_HEADER) res.set('X-Word-Timeline', encoded);
    else logger.warn('read', `timeline for chunk ${index} too large to send`, { bytes: encoded.length });

    const stream = fs.createReadStream(wavPath);
    stream.on('error', (error) => {
      logger.error('read', `could not stream chunk ${index}: ${error.message}`);
      res.destroy();
    });
    stream.pipe(res);
  } catch (error) {
    logger.error('read', `chunk ${index} failed: ${error.message}`, { code: error.code });
    res.status(500).json({
      error: error.message || 'Could not narrate this part of the book.',
      code: error.code,
    });
  }
});

export default router;
