import fs from 'fs';
import path from 'path';
import express from 'express';
import multer from 'multer';
import { config, paths } from '../config/env.js';
import { parsePDF } from '../utils/pdfParser.js';
import { parseEPUB } from '../utils/epubParser.js';
import { parseTXT } from '../utils/txtParser.js';
import { normalise, detectChapters, countWords } from '../utils/textCleaner.js';
import { buildOutline, headingKey } from '../utils/docStructure.js';
import { removeFile } from '../utils/cleanup.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

const ALLOWED = ['.pdf', '.txt', '.epub'];

const WORDS_PER_MINUTE = 150;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, paths.uploads),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `book-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadBytes },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED.includes(ext)) {
      const error = new Error('Only PDF, TXT, and EPUB files are supported');
      error.code = 'UNSUPPORTED_FILE_TYPE';
      return cb(error);
    }
    cb(null, true);
  },
}).single('file');

const PARSERS = { '.pdf': parsePDF, '.epub': parseEPUB, '.txt': parseTXT };

router.post('/upload', (req, res) => {
  upload(req, res, async (uploadError) => {
    if (uploadError) {
      const tooBig = uploadError.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({
        success: false,
        error: tooBig
          ? `File is too large. Maximum size is ${Math.round(config.maxUploadBytes / 1024 / 1024)}MB.`
          : uploadError.message,
        code: uploadError.code,
      });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file was uploaded.' });
    }

    const ext = path.extname(req.file.filename).toLowerCase();
    const parse = PARSERS[ext];

    try {
      const { rawText, pageCount, headingLevels } = await parse(req.file.path);
      const { text, chapters, wordCount, outline } = normalise(rawText, headingLevels);

      if (!text || wordCount < 10) {
        return res.status(422).json({
          success: false,
          error: 'No readable text was found in this file.',
          code: 'NO_TEXT',
        });
      }

      res.json({
        success: true,
        text,
        chapters,
        outline,
        wordCount,
        pageCount,
        estimatedMinutes: Math.round(wordCount / WORDS_PER_MINUTE),
        filename: req.file.originalname,
        sizeBytes: req.file.size,
      });
    } catch (error) {
      logger.error('upload', `parse failed: ${error.message}`, { code: error.code });
      const status = error.code === 'PDF_NO_TEXT' || error.code === 'EPUB_NO_TEXT' ? 422 : 500;
      res.status(status).json({
        success: false,
        error: error.message || 'Could not extract text from this file.',
        code: error.code,
      });
    } finally {
      removeFile(req.file.path);
    }
  });
});

/** Heading levels are per-book, so a generous cap is still a small object. */
const MAX_HEADING_LEVELS = 5000;

/**
 * Rebuilds the level map the client carried across the edit. Levels are measured
 * from the source's font sizes and cannot be recovered from plain text, so
 * without this every heading the shape rules cannot see on their own is demoted
 * to a paragraph the moment anything in the book is edited.
 */
function levelsFrom(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;

  const levels = new Map();
  for (const [line, level] of Object.entries(input).slice(0, MAX_HEADING_LEVELS)) {
    if (!Number.isInteger(level) || level < 1 || level > 3) continue;
    const key = headingKey(line);
    if (key) levels.set(key, level);
  }

  return levels.size ? levels : undefined;
}

router.post('/book/rescan', (req, res) => {
  const { text, headingLevels } = req.body || {};

  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ success: false, error: 'There is no text left to narrate.' });
  }

  const wordCount = countWords(text);

  if (wordCount < 10) {
    return res.status(422).json({
      success: false,
      error: 'That leaves too little text to narrate. Restore some of it and try again.',
      code: 'NO_TEXT',
    });
  }

  logger.info('upload', 'rescanned edited text', { words: wordCount });

  res.json({
    success: true,
    text,
    chapters: detectChapters(text),
    // Re-derived from the saved text, so an edit keeps its lists and headings.
    outline: buildOutline(text, levelsFrom(headingLevels)),
    wordCount,
    estimatedMinutes: Math.round(wordCount / WORDS_PER_MINUTE),
  });
});

export default router;
