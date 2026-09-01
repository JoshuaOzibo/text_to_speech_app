'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { config, paths } = require('../config/env');
const { generateChunkAudio, resolveVoice, anyEngineInstalled } = require('../utils/ttsEngine');
const { processChunk } = require('../utils/wavProcessor');
const { segmentChunk, alignToDisplay } = require('../utils/timeline');
const { setPlan, getPlan, publicPlan } = require('../utils/readStore');

const MAX_TIMELINE_HEADER = 6000;

const router = express.Router();

const inFlight = new Map();

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
      return { wavPath, meta: JSON.parse(fs.readFileSync(metaPath, 'utf8')) };
    } catch {
    }
  }

  if (inFlight.has(wavPath)) return inFlight.get(wavPath);

  const work = (async () => {
    fs.mkdirSync(dir, { recursive: true });
    const chunk = plan.chunks[index];

    await generateChunkAudio(chunk.text, voiceId, rate, wavPath);
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
    return { wavPath, meta };
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
    const plan = setPlan(text);
    if (!plan.chunks.length) {
      return res.status(422).json({ error: 'No readable text was found to narrate.' });
    }
    res.json(publicPlan(plan));
  } catch (error) {
    console.error('Read plan error:', error);
    res.status(500).json({ error: error.message || 'Could not prepare the book for reading.' });
  }
});

router.get('/read/:id/:index', async (req, res) => {
  const plan = getPlan(req.params.id);
  const index = Number(req.params.index);
  const { voice, speed = '1' } = req.query;

  if (!plan) {
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

    fs.createReadStream(wavPath).pipe(res);
  } catch (error) {
    console.error(`Read chunk ${index} error:`, error);
    res.status(500).json({
      error: error.message || 'Could not narrate this part of the book.',
      code: error.code,
    });
  }
});

module.exports = router;
