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

// Prepares the open book for narration in one press: strips the trailing Index /
// About the Author / Bibliography that every top-down step in textCleaner misses,
// then wraps the result in the two sentences a narrator speaks.
//
// The book itself never leaves the machine. Only a ~4,000 character excerpt goes
// to Gemini, and only to write the intro — see narrator.js.
//
// Like /api/preview and read-aloud this bypasses the job slot deliberately, so
// cleaning works during a generation and a cancel can never kill it.
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
    // The title page and copyright block are stripped here as well as at
    // generation time. preprocessText already runs step 0, but only on the way
    // to the engine — so without this the user presses Clean, still sees
    // "ISBN 978-0-525-42814-5" in the editor, and gets it as a bogus chapter in
    // the sidebar. Running it twice is safe: on already-clean text findBodyStart
    // lands on line 0 and the second pass changes nothing.
    // Read the title page before it is stripped — that is where the title and
    // author are. On a re-clean the title page is already gone, so an intro from
    // an earlier run is the better source.
    const meta = metaFromExistingIntro(text) || detectBookMeta(text, filename);

    // Pressing Clean twice must replace the narration, not stack a second copy
    // of it on top of the first.
    const front = removeFrontMatterAndMetadata(stripExistingNarration(text));
    const trimmed = removeBackMatter(front);
    const narration = await writeIntroOutro({ text: trimmed.text, filename, meta });

    // The intro and outro are their own paragraphs so splitIntoChunks keeps them
    // whole and chapter detection never mistakes them for a heading.
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
