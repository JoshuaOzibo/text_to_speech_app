import express from 'express';
import {
  removeFrontMatterAndMetadata,
  removeBackMatter,
  countWords,
} from '../utils/textCleaner.js';
import {
  writeIntroOutro,
  detectBookMeta,
  stripExistingNarration,
  metaFromExistingIntro,
} from '../utils/narrator.js';
import { logger } from '../utils/logger.js';

const router = express.Router();


router.post('/clean-text', async (req, res) => {
  const { text, filename } = req.body || {};

  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({
      success: false,
      error: 'Open a book before cleaning it.',
      code: 'NO_TEXT',
    });
  }

  try {

    const meta = metaFromExistingIntro(text) || detectBookMeta(text, filename);

    // Pressing Clean twice must replace the narration, not stack a second copy
    // of it on top of the first.
    const front = removeFrontMatterAndMetadata(stripExistingNarration(text));
    const trimmed = removeBackMatter(front);
    const narration = await writeIntroOutro({ text: trimmed.text, filename, meta });
    const cleaned = `${narration.intro}\n\n${trimmed.text.trim()}\n\n${narration.outro}\n`;
    const wordCount = countWords(cleaned);

    if (wordCount < 10) {
      return res.status(422).json({
        success: false,
        error: 'That leaves too little text to narrate.',
        code: 'NO_TEXT',
      });
    }

    const removedWords = Math.max(0, countWords(text) - countWords(trimmed.text));

    logger.info('clean', 'cleaned the open book', {
      removedWords,
      backMatter: trimmed.removedWords,
      cutAt: trimmed.heading,
      intro: narration.source,
      words: wordCount,
    });

    res.json({
      success: true,
      text: cleaned,
      wordCount,
      removedWords,
      heading: trimmed.heading,
      title: narration.title,
      author: narration.author,
      intro: narration.intro,
      outro: narration.outro,
      source: narration.source,
      reason: narration.reason,
    });
  } catch (error) {
    logger.error('clean', `clean failed: ${error.message}`, { code: error.code });
    res.status(500).json({
      success: false,
      error: error.message || 'Could not clean this book.',
      code: error.code || 'CLEAN_FAILED',
    });
  }
});

export default router;
