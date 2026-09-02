import fs from 'fs';
import express from 'express';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { analyseMood, profileFor } from '../utils/mood.js';
import * as gemini from '../utils/gemini.js';
import {
  searchTracks,
  downloadTrack,
  findCandidate,
  setSelected,
  getSelected,
  clearSelected,
  setLevel,
  publicTrack,
  providerChain,
} from '../utils/soundtrack.js';

const router = express.Router();

const MIN_LEVEL_DB = -40;
const MAX_LEVEL_DB = -6;

function clampLevel(value) {
  const level = Number(value);
  if (!Number.isFinite(level)) return config.backgroundLevelDb;
  return Math.max(MIN_LEVEL_DB, Math.min(MAX_LEVEL_DB, level));
}

function status() {
  return {
    selected: publicTrack(getSelected()),
    level: getSelected()?.levelDb ?? config.backgroundLevelDb,
    ai: gemini.available(),
    library: providerChain().map((entry) => entry.name).join(' → '),
    levelRange: { min: MIN_LEVEL_DB, max: MAX_LEVEL_DB },
  };
}

router.get('/background', (req, res) => {
  res.json(status());
});

router.post('/background/suggest', async (req, res) => {
  const { text, title, chapters } = req.body || {};

  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Open a book before asking for a background.' });
  }

  const local = analyseMood(text);
  const ai = await gemini.suggestMood(text, { title, chapters });

  const suggestion = ai || local;
  const profile = profileFor(suggestion.mood);
  const terms = suggestion.terms?.length ? suggestion.terms : profile?.terms || local.terms;

  try {
    const { provider, tracks } = await searchTracks(terms, profile?.tags || []);
    res.json({
      source: suggestion.source,
      mood: suggestion.mood,
      label: profile?.label || suggestion.mood,
      reason: suggestion.reason,
      confidence: suggestion.confidence,
      terms,
      provider,
      aiAvailable: gemini.available(),
      tracks,
    });
  } catch (error) {
    logger.error('sound', `search failed: ${error.message}`, { code: error.code });
    res.status(502).json({
      error: error.message || 'Could not reach the music library.',
      code: error.code || 'SOUNDTRACK_SEARCH_FAILED',
    });
  }
});

router.post('/background/select', async (req, res) => {
  const { provider, id, level } = req.body || {};
  const candidate = findCandidate(provider, id);

  if (!candidate) {
    return res.status(404).json({
      error: 'That track is no longer in the last set of suggestions. Search again.',
      code: 'TRACK_NOT_FOUND',
    });
  }

  try {
    const file = await downloadTrack(candidate);
    setSelected(candidate, file, clampLevel(level));
    res.json(status());
  } catch (error) {
    logger.error('sound', `could not use that track: ${error.message}`, { code: error.code });
    res.status(502).json({
      error: error.message || 'Could not download that track.',
      code: error.code || 'SOUNDTRACK_DOWNLOAD_FAILED',
    });
  }
});

router.patch('/background/level', (req, res) => {
  if (!getSelected()) {
    return res.status(404).json({ error: 'No background track is selected.' });
  }
  setLevel(clampLevel(req.body?.level));
  res.json(status());
});

router.delete('/background', (req, res) => {
  clearSelected();
  res.json(status());
});

router.get('/background/audio/:provider/:id', async (req, res) => {
  const { provider, id } = req.params;
  const current = getSelected();
  const track =
    current && current.provider === provider && current.id === id
      ? current
      : findCandidate(provider, id);

  if (!track) {
    return res.status(404).json({ error: 'That track is not available to preview.' });
  }

  try {
    const file = track.file && fs.existsSync(track.file) ? track.file : await downloadTrack(track);
    const { size } = fs.statSync(file);

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(size),
      'Cache-Control': 'no-store',
    });

    const stream = fs.createReadStream(file);
    stream.on('error', (error) => {
      logger.error('sound', `could not stream preview: ${error.message}`);
      res.destroy();
    });
    stream.pipe(res);
  } catch (error) {
    logger.error('sound', `preview failed: ${error.message}`, { code: error.code });
    res.status(502).json({
      error: error.message || 'Could not play that track.',
      code: error.code,
    });
  }
});

export default router;
