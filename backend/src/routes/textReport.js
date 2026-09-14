import express from 'express';
import { preprocessText, countWords } from '../utils/textCleaner.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

const HEAD_WORDS = 120;
const MAX_REPORTED_LINES = 60;

const firstWords = (text, count) => text.trim().split(/\s+/).slice(0, count).join(' ');
router.post('/text-report', (req, res) => {
  const { text } = req.body || {};

  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'No text was provided.' });
  }

  const report = {};
  const spoken = preprocessText(text, report);

  const originalWords = countWords(text);
  const spokenWords = countWords(spoken);

  const body = {
    original: { words: originalWords, lines: text.split('\n').length },
    spoken: { words: spokenWords, lines: spoken.split('\n').length },
    removedWords: Math.max(0, originalWords - spokenWords),

    stages: {
      metadata: report.metadata || { removed: 0, lines: [] },
      tableOfContents: report.toc || { removed: 0 },
      frontMatter: report.bodyStart || { cut: 0, reason: 'did not run', lines: [] },
    },
    droppedFromTop: (report.bodyStart?.skipReasons || []).slice(0, MAX_REPORTED_LINES),

    firstNarratedWords: firstWords(spoken, HEAD_WORDS),
    firstOriginalWords: firstWords(text, HEAD_WORDS),
  };

  logger.info('text-report', 'analysed', {
    removedWords: body.removedWords,
    cutLines: body.stages.frontMatter.cut,
    tocLines: body.stages.tableOfContents.removed,
  });

  res.json(body);
});

export default router;
