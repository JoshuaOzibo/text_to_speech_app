import fs from 'fs';
import path from 'path';
import express from 'express';
import multer from 'multer';
import { config, paths } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { sendFileRange } from '../utils/httpRange.js';
import { analyseMood, moodFromDescription, profileFor } from '../utils/mood.js';
import * as gemini from '../utils/gemini.js';
import {
  searchTracks,
  downloadTrack,
  saveLocalTrack,
  LOCAL_PROVIDER,
  findCandidate,
  setSelected,
  getSelected,
  clearSelected,
  publicTrack,
  providerChain,
} from '../utils/soundtrack.js';

const router = express.Router();

const BED_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.flac', '.aiff', '.aif', '.wma'];

const BED_MIME = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff',
  '.wma': 'audio/x-ms-wma',
};

function mimeFor(file) {
  return BED_MIME[path.extname(file).toLowerCase()] || 'audio/mpeg';
}

const uploadBed = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(paths.beds, { recursive: true });
      cb(null, paths.beds);
    },
    filename: (req, file, cb) =>
      cb(null, `${LOCAL_PROVIDER}-${Date.now()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: config.maxUploadBytes },
  fileFilter: (req, file, cb) => {
    if (BED_EXTENSIONS.includes(path.extname(file.originalname).toLowerCase())) return cb(null, true);
    const error = new Error(`Use an audio file — ${BED_EXTENSIONS.join(', ')}.`);
    error.code = 'UNSUPPORTED_BED_TYPE';
    cb(error);
  },
}).single('file');

// No level here either. There is nothing to balance the music against: it is
// downloaded as its own file and never mixed into the audiobook.
function status() {
  return {
    selected: publicTrack(getSelected()),
    ai: gemini.available(),
    library: providerChain().map((entry) => entry.name).join(' → '),
  };
}

router.get('/background', (req, res) => {
  res.json(status());
});

router.post('/background/suggest', async (req, res) => {
  const { text, title, chapters, mood } = req.body || {};

  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Open a book before asking for a background.' });
  }

  const override = moodFromDescription(mood);
  const local = analyseMood(text);

  let suggestion = override || local;
  let geminiReason = null;

  if (override) {
    geminiReason = 'You set the mood yourself, so nothing was sent to Gemini.';
  } else {
    const attempt = await gemini.suggestMood(text, { title, chapters });
    geminiReason = attempt.reason;
    if (attempt.suggestion) suggestion = attempt.suggestion;
  }

  const profile = profileFor(suggestion.mood);
  const terms = suggestion.terms?.length ? suggestion.terms : profile?.terms || local.terms;
  const tags = suggestion.tags?.length ? suggestion.tags : profile?.tags || [];

  try {
    const { provider, tracks } = await searchTracks(terms, tags);
    res.json({
      source: suggestion.source,
      mood: suggestion.mood,
      label: suggestion.label || profile?.label || suggestion.mood,
      reason: suggestion.reason,
      confidence: suggestion.confidence,
      terms,
      provider,
      aiAvailable: gemini.available(),
      gemini: {
        available: gemini.available(),
        used: suggestion.source === 'gemini',
        reason: geminiReason,
      },
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
  const { provider, id } = req.body || {};
  const candidate = findCandidate(provider, id);

  if (!candidate) {
    return res.status(404).json({
      error: 'That track is no longer in the last set of suggestions. Search again.',
      code: 'TRACK_NOT_FOUND',
    });
  }

  try {
    const file = await downloadTrack(candidate);
    setSelected(candidate, file);
    res.json(status());
  } catch (error) {
    logger.error('sound', `could not use that track: ${error.message}`, { code: error.code });
    res.status(502).json({
      error: error.message || 'Could not download that track.',
      code: error.code || 'SOUNDTRACK_DOWNLOAD_FAILED',
    });
  }
});

router.post('/background/upload', (req, res) => {
  uploadBed(req, res, async (uploadError) => {
    if (uploadError) {
      const tooBig = uploadError.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({
        error: tooBig
          ? `That file is too large. The limit is ${Math.round(config.maxUploadBytes / 1024 / 1024)}MB — raise MAX_UPLOAD_MB in backend/.env, or convert it to MP3.`
          : uploadError.message,
        code: uploadError.code,
      });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file was uploaded.', code: 'NO_FILE' });
    }

    try {
      const track = await saveLocalTrack(req.file.path, req.file.originalname);
      setSelected(track, req.file.path);
      res.json({ ...status(), warning: track.warning ?? null });
    } catch (error) {
      logger.error('sound', `could not use that file: ${error.message}`, { code: error.code });
      res.status(error.code === 'BED_UNREADABLE' ? 422 : 500).json({
        error: error.message || 'Could not use that file as a background.',
        code: error.code || 'BED_UPLOAD_FAILED',
      });
    }
  });
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
   
    const file =
      track.localPath && fs.existsSync(track.localPath)
        ? track.localPath
        : track.file && fs.existsSync(track.file)
          ? track.file
          : await downloadTrack(track, { audition: true });
    sendFileRange(req, res, file, mimeFor(file));
  } catch (error) {
    logger.error('sound', `preview failed: ${error.message}`, { code: error.code });
    res.status(502).json({
      error: error.message || 'Could not play that track.',
      code: error.code,
    });
  }
});

function downloadName(track, file) {
  const base = String(track.title || 'background')
    .replace(/\.[^.]+$/, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
  return `${base || 'background'}${path.extname(file).toLowerCase() || '.mp3'}`;
}

router.get('/background/download/:provider/:id', async (req, res) => {
  const { provider, id } = req.params;
  const current = getSelected();
  const track =
    current && current.provider === provider && current.id === id
      ? current
      : findCandidate(provider, id);

  if (!track) {
    return res.status(404).json({
      error: 'That track is no longer in the last set of suggestions. Search again.',
      code: 'TRACK_NOT_FOUND',
    });
  }

  try {
    const file =
      track.localPath && fs.existsSync(track.localPath)
        ? track.localPath
        : track.file && fs.existsSync(track.file)
          ? track.file
          : await downloadTrack(track, { audition: false });

    const { size } = fs.statSync(file);

    res.set({
      'Content-Type': mimeFor(file),
      'Content-Length': String(size),
      'Content-Disposition': `attachment; filename="${downloadName(track, file)}"`,
      'Cache-Control': 'no-store',
    });

    const stream = fs.createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  } catch (error) {
    logger.error('sound', `download failed: ${error.message}`, { code: error.code });
    res.status(502).json({
      error: error.message || 'Could not download that track.',
      code: error.code || 'SOUNDTRACK_DOWNLOAD_FAILED',
    });
  }
});

export default router;
