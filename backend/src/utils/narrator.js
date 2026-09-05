import { config } from '../config/env.js';
import { logger, secs, timer } from './logger.js';
import { detectChapters } from './textCleaner.js';

// Writes the two sentences a narrator speaks either side of a book.
//
// This is the only part of "Clean with AI" that needs a model, and it needs
// almost nothing: a title, an author, and enough of the opening to know what the
// book is about. So it sends a ~4,000 character excerpt, not the book — the same
// provider, the same size and the same opt-in shape as the background-mood call
// that already exists, which is what keeps the boundary in CLAUDE.md intact.
//
// With no GEMINI_API_KEY it falls back to a template. The feature degrades; it
// never hard-fails and never blocks the local cleanup that runs before it.

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

const EXCERPT_CHARS = 4000;
const META_SCAN_LINES = 80;

const SCHEMA = {
  type: 'object',
  properties: {
    intro: { type: 'string' },
    outro: { type: 'string' },
  },
  required: ['intro', 'outro'],
};

function available() {
  return Boolean(config.geminiApiKey);
}

// Lines that are never a title or an author, whatever position they sit in.
const META_NOISE =
  /^(contents|table of contents|copyright|all rights reserved|isbn|first published|published by|a note|dedication|epigraph|chapter|part|prologue|introduction|foreword|preface)\b/i;

const BY_LINE = /^\s*(?:by|written by)\s+(.{2,60}?)\s*$/i;

function titleFromFilename(filename) {
  if (!filename) return '';
  return String(filename)
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Title and author from the head of the book, falling back to the filename for
 * the title — the same fallback `background.js` already relies on for `meta.title`.
 * Heuristic on purpose: a wrong guess costs one sentence of narration, and the
 * user can edit it, so this deliberately does not send anything anywhere.
 */
function detectBookMeta(text, filename = '') {
  const lines = String(text || '')
    .split('\n')
    .slice(0, META_SCAN_LINES)
    .map((line) => line.trim())
    .filter(Boolean);

  let title = '';
  let author = '';

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.length > 80 || META_NOISE.test(line)) continue;

    const byline = line.match(BY_LINE);
    if (byline) {
      if (!author) author = byline[1].trim();
      continue;
    }

    // The first short, non-noise, non-sentence line reads as the title.
    if (!title && !/[.!?]$/.test(line) && /[A-Za-z]/.test(line)) {
      title = line;
    }
  }

  const fallback = titleFromFilename(filename);
  return {
    title: title || fallback || 'this book',
    author: author || '',
  };
}

// Both openers are fixed by the prompt, so narration this app added is
// recognisable. Anchored to the first and last paragraph only, so a sentence
// inside the book that happens to begin "Welcome to…" is never touched.
const INTRO_OPENER = /^welcome to\s/i;
const OUTRO_OPENER = /^that concludes\s/i;

/**
 * Removes an intro and outro this app added on a previous run, so pressing
 * Clean twice replaces the narration instead of stacking a second copy on top.
 */
function stripExistingNarration(text) {
  let paragraphs = String(text || '').split(/\n{2,}/);

  const firstIndex = paragraphs.findIndex((p) => p.trim());
  if (firstIndex >= 0 && INTRO_OPENER.test(paragraphs[firstIndex].trim())) {
    paragraphs.splice(firstIndex, 1);
  }

  let lastIndex = -1;
  for (let i = paragraphs.length - 1; i >= 0; i -= 1) {
    if (paragraphs[i].trim()) {
      lastIndex = i;
      break;
    }
  }
  if (lastIndex >= 0 && OUTRO_OPENER.test(paragraphs[lastIndex].trim())) {
    paragraphs.splice(lastIndex, 1);
  }

  return paragraphs.join('\n\n').trim();
}

/**
 * Reads the title and author back out of an intro this app wrote earlier.
 *
 * Needed because a re-clean sees text whose title page has already been
 * stripped: `detectBookMeta` would then latch onto the first chapter title and
 * quietly downgrade "The Laws of Human Nature by Robert Greene" to "The Law".
 * The intro is the only place that information still survives.
 */
function metaFromExistingIntro(text) {
  const first = (String(text || '').split(/\n{2,}/).find((p) => p.trim()) || '').trim();
  if (!INTRO_OPENER.test(first)) return null;

  // Try the "by <author>" shape first; a non-greedy optional group would stop
  // at the title and drop the author.
  const withAuthor = /^welcome to\s+(.+?)\s+by\s+(.+?)\s*[.!]/i.exec(first);
  if (withAuthor) return { title: withAuthor[1].trim(), author: withAuthor[2].trim() };

  const titleOnly = /^welcome to\s+(.+?)\s*[.!]/i.exec(first);
  return titleOnly ? { title: titleOnly[1].trim(), author: '' } : null;
}

function templateIntro({ title, author }) {
  const credit = author ? `${title} by ${author}` : title;
  return {
    intro: `Welcome to ${credit}. Settle in, and let us begin.`,
    outro: `That concludes ${credit}. Thank you for listening.`,
  };
}

function buildPrompt(text, { title, author, chapters }) {
  return [
    'You are writing the two things an audiobook narrator says out loud: the',
    'opening welcome before the book starts, and the closing words after it ends.',
    '',
    'Rules:',
    '- 2 to 3 sentences each, and nothing else.',
    '- The intro must begin exactly with "Welcome to ' + title + '".',
    '- The outro must begin exactly with "That concludes ' + title + '".',
    '- Write for the ear. It is spoken aloud, so no headings, no lists, no',
    '  markdown, no stage directions, no quotation marks around the whole thing.',
    '- Set the tone from what the book is actually about. Warm and professional,',
    '  never breathless marketing copy.',
    '- The outro should leave the listener with one thought worth keeping,',
    '  drawn from the book itself rather than a generic sign-off.',
    '',
    `Title: ${title}`,
    author ? `Author: ${author}` : 'Author: not stated - do not invent one.',
    chapters?.length ? `Chapter titles: ${chapters.slice(0, 25).join(' | ')}` : '',
    '',
    'Opening of the book:',
    '"""',
    String(text || '').slice(0, EXCERPT_CHARS),
    '"""',
  ]
    .filter(Boolean)
    .join('\n');
}

function parseResponse(body) {
  const parts = body?.candidates?.[0]?.content?.parts;
  const raw = Array.isArray(parts) ? parts.map((part) => part.text || '').join('') : '';
  if (!raw.trim()) return null;

  const parsed = JSON.parse(raw);
  const intro = String(parsed.intro || '').trim();
  const outro = String(parsed.outro || '').trim();
  if (!intro || !outro) return null;

  return { intro, outro };
}

function explainStatus(status, detail) {
  if (status === 429) return 'Gemini is out of credits or rate-limited (429).';
  if (status === 404) return `The Gemini model "${config.geminiModel}" is unavailable (404).`;
  if (status === 400 && /API key/i.test(detail)) return 'The Gemini API key was rejected (400).';
  if (status === 403) return 'Gemini refused the request (403).';
  return `Gemini refused the request (${status}).`;
}

/**
 * Returns `{ intro, outro, source, reason }` and never throws. `source` is
 * 'gemini' or 'template'; `reason` is a sentence written for the end user,
 * present whenever the words did not come from Gemini.
 */
async function writeIntroOutro({ text, filename = '', meta: given = null }) {
  // The caller passes `meta` when it has already read the title page, because the
  // title and author live in exactly the front matter that gets stripped before
  // this runs — detecting from the trimmed text would lose both.
  const meta = given || detectBookMeta(text, filename);
  const fallback = templateIntro(meta);

  if (!available()) {
    return { ...fallback, ...meta, source: 'template', reason: 'No GEMINI_API_KEY is set.' };
  }

  const url = `${ENDPOINT}/${encodeURIComponent(config.geminiModel)}:generateContent`;
  const chapters = detectChapters(text).map((chapter) => chapter.title).filter(Boolean);
  const elapsed = timer();

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.geminiApiKey,
      },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: buildPrompt(text, { ...meta, chapters }) }] },
        ],
        generationConfig: {
          temperature: 0.7,
          responseMimeType: 'application/json',
          responseSchema: SCHEMA,
        },
      }),
      signal: AbortSignal.timeout(config.suggestTimeoutMs),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      logger.warn('narrator', `intro rejected (${response.status})`, {
        model: config.geminiModel,
        detail: detail.slice(0, 200).replace(/\s+/g, ' '),
      });
      return { ...fallback, ...meta, source: 'template', reason: explainStatus(response.status, detail) };
    }

    const written = parseResponse(await response.json());
    if (!written) {
      logger.warn('narrator', 'response had no usable intro');
      return { ...fallback, ...meta, source: 'template', reason: 'Gemini sent no usable answer.' };
    }

    logger.info('narrator', 'wrote an intro and outro', {
      title: meta.title,
      model: config.geminiModel,
      took: secs(elapsed()),
    });
    return { ...written, ...meta, source: 'gemini', reason: null };
  } catch (error) {
    const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError';
    logger.warn('narrator', timedOut ? 'intro timed out' : `intro failed: ${error.message}`, {
      after: secs(elapsed()),
    });
    return {
      ...fallback,
      ...meta,
      source: 'template',
      reason: timedOut ? 'Gemini timed out.' : `Gemini could not be reached (${error.message}).`,
    };
  }
}

export {
  available,
  detectBookMeta,
  writeIntroOutro,
  templateIntro,
  stripExistingNarration,
  metaFromExistingIntro,
};
