import { config } from '../config/env.js';
import { logger, secs, timer } from './logger.js';
import { detectChapters } from './textCleaner.js';
import {
  INTRO_OPENER,
  OUTRO_OPENER,
  INTRO_CUE,
  INTRO_CLOSER,
  introOpening,
  outroOpening,
} from './narrationMarkers.js';




const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

const EXCERPT_CHARS = 4000;
const TAIL_CHARS = 2000;
const META_SCAN_LINES = 80;

const SCHEMA = {
  type: 'object',
  properties: {
    about: { type: 'string' },
    invitation: { type: 'string' },
    reflection: { type: 'string' },
    farewell: { type: 'string' },
  },
  required: ['about', 'invitation', 'reflection', 'farewell'],
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


const MAX_INTRO_PARAGRAPHS = 6;
const MAX_OUTRO_PARAGRAPHS = 4;

function stripExistingNarration(text) {
  const paragraphs = String(text || '').split(/\n{2,}/);


  let seenFromEnd = 0;
  let outroStart = -1;
  for (let i = paragraphs.length - 1; i >= 0 && seenFromEnd < MAX_OUTRO_PARAGRAPHS; i -= 1) {
    const trimmed = paragraphs[i].trim();
    if (!trimmed) continue;
    seenFromEnd += 1;

    if (OUTRO_OPENER.test(trimmed)) outroStart = i;
  }
  if (outroStart >= 0) paragraphs.splice(outroStart);

  const introStart = paragraphs.findIndex((p) => p.trim());
  if (introStart >= 0 && INTRO_OPENER.test(paragraphs[introStart].trim())) {
    let introEnd = introStart;
    let scanned = 0;

    for (let i = introStart; i < paragraphs.length && scanned < MAX_INTRO_PARAGRAPHS; i += 1) {
      const trimmed = paragraphs[i].trim();
      if (!trimmed) continue;
      scanned += 1;

      if (i > introStart && INTRO_CUE.test(trimmed)) {
        introEnd = i;
        break;
      }
    }

    paragraphs.splice(introStart, introEnd - introStart + 1);
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
// Ordered, and the order is load-bearing. Applying the legacy " by " pattern to
// "Welcome to The Laws of Human Nature, written by Robert Greene." makes the
// lazy title group stop at the first " by ", yielding the title
// "The Laws of Human Nature, written" — which then gets spoken back on the next
// clean. The ", written by" shape has to be tried first.
const INTRO_META = [
  // "Welcome to X, written by Y." — written since 2026-09-11. Anchored to the
  // end of the paragraph so it cannot half-match a legacy intro, which carries
  // a second sentence after the full stop.
  /^welcome to\s+(.+?),\s*written by\s+(.+?)\s*[.!]\s*$/i,
  // "Welcome to X by Y. Settle in, and let us begin." — the first version.
  /^welcome to\s+(.+?)\s+by\s+(.+?)\s*[.!]/i,
];

// No author: "Welcome to Meditations." Tried last, or it would swallow both of
// the shapes above with the author glued onto the title.
//
// Known limitation, unchanged from the first version: a no-author title
// containing " by " ("Welcome to Death by Water.") still splits at the second
// pattern into title "Death" / author "Water". A real fix needs the title page,
// which has already been stripped by the time this runs.
const INTRO_TITLE_ONLY = /^welcome to\s+(.+?)\s*[.!]/i;

function metaFromExistingIntro(text) {
  const first = (String(text || '').split(/\n{2,}/).find((p) => p.trim()) || '').trim();
  if (!INTRO_OPENER.test(first)) return null;

  for (const pattern of INTRO_META) {
    const match = pattern.exec(first);
    if (match) return { title: match[1].trim(), author: match[2].trim() };
  }

  const titleOnly = INTRO_TITLE_ONLY.exec(first);
  return titleOnly ? { title: titleOnly[1].trim(), author: '' } : null;
}

/**
 * Flattens one piece of model prose into a single narratable paragraph.
 *
 * Two reasons, both found by reading the code that runs after this:
 *   - an internal newline would split one narrated paragraph into two, and
 *     splitIntoChunks would then treat the halves separately;
 *   - detectChapters skips any line ending in `.`/`,`/`;`/`:`, so a short
 *     unpunctuated fragment like "Introduction over" would come back as a
 *     chapter in the sidebar. Terminal punctuation is forced for that reason.
 */
function paragraph(value) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();

  if (!text) return '';
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * The no-GEMINI_API_KEY fallback. Same shape as the written version — four
 * paragraphs then three, same fixed openers, same closing cue — so
 * stripExistingNarration and findBodyStart behave identically whether or not a
 * key is set. Only the middles are generic, because nothing on this machine
 * knows what the book is about.
 */
function templateIntro({ title, author }) {
  return {
    intro: [
      introOpening(title, author),
      'Over the chapters ahead, take this at the pace it was written in. Some of it ' +
        'will land the first time you hear it, and some of it will only make sense ' +
        'later, once you have something of your own to hold it against.',
      'Listen not to reach the end, but to understand it. And more importantly, to ' +
        'understand yourself.',
      INTRO_CLOSER,
    ].join('\n\n'),
    outro: [
      outroOpening(title, author),
      'What stays with you now will not be every line of it. It will be the parts you ' +
        'found yourself arguing with, the parts you recognised straight away, and the ' +
        'one or two thoughts you will still be turning over tomorrow.',
      'Thank you for listening.',
    ].join('\n\n'),
  };
}

/**
 * The opening and the ending, labelled separately.
 *
 * The opening alone is why the outro used to be a generic sign-off: the model
 * had never seen how the book finishes, so it could only invent a closing
 * thought. The ending is what "reflection" is written from.
 */
function excerpts(text) {
  const source = String(text || '');
  const head = source.slice(0, EXCERPT_CHARS);

  // On a short book the head already reaches the end. Sending the same words
  // twice under two labels just invites the model to say the same thing twice.
  if (source.length <= EXCERPT_CHARS + TAIL_CHARS) return { head, tail: '' };

  // Dropped forward to the next whitespace so the excerpt does not open
  // mid-word.
  const tail = source.slice(-TAIL_CHARS).replace(/^\S*\s+/, '');
  return { head, tail };
}

function buildPrompt(text, { title, author, chapters }) {
  const { head, tail } = excerpts(text);

  // Named once and referenced everywhere, because the rules point at these
  // sections by name. A short book sends no separate tail — the opening excerpt
  // already runs to the last line — and a rule pointing at a section that is not
  // there invites the model to invent one.
  const headLabel = tail ? 'HOW THE BOOK OPENS' : 'THE BOOK';

  return [
    'You are writing what an audiobook narrator says out loud either side of a book:',
    'a spoken introduction before it starts, and spoken closing words after it ends.',
    'It is read aloud, so write for the ear.',
    '',
    'Return exactly four pieces of prose. Each is ONE paragraph of 45 to 90 words,',
    'plain sentences only - no headings, no lists, no markdown, no stage directions,',
    'no quotation marks around the whole thing, and no line breaks inside a piece.',
    '',
    '- about: what this book is really about and what the listener is in for. Name',
    `  the actual subject matter, taken from ${headLabel} below.`,
    '- invitation: how to listen to it - the attitude to bring, ending on what the',
    '  listener stands to understand.',
    tail
      ? '- reflection: the closing thought, drawn from HOW THE BOOK ENDS below. Use the\n' +
        '  idea the book actually finishes on, not a summary of the whole thing. If the\n' +
        '  ending quotes someone, that quotation is usually the thing worth keeping.'
      : '- reflection: the closing thought. The excerpt below runs to the end of the\n' +
        '  book, so use the idea it actually finishes on, not a summary of the whole\n' +
        '  thing. If it ends on a quotation, that is usually the thing worth keeping.',
    '- farewell: two short sentences handing the book over. Warm, final, under 25',
    '  words.',
    '',
    'Do NOT write a welcome line, a title, an author credit, "let us begin", or a',
    '"that brings us to the end" line. Those are added around your text already and',
    'repeating them would say the same thing twice.',
    'Warm and professional throughout, never breathless marketing copy.',
    '',
    `Title: ${title}`,
    author ? `Author: ${author}` : 'Author: not stated - do not invent one.',
    chapters?.length ? `Chapter titles: ${chapters.slice(0, 25).join(' | ')}` : '',
    '',
    tail ? `${headLabel} (the first few pages):` : `${headLabel} (short enough to send whole):`,
    '"""',
    head,
    '"""',
    // One array entry, so the existing .filter(Boolean) still drops it whole on
    // a short book without any change to how the rest of the prompt assembles.
    tail &&
      `\nHOW THE BOOK ENDS (the last page or two - "reflection" comes from here):\n"""\n${tail}\n"""`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Assembles the two blocks. Every fixed line is written here rather than taken
 * from the response, so the anchors stripExistingNarration, metaFromExistingIntro
 * and findBodyStart depend on are guaranteed whatever the model returns.
 */
function parseResponse(body, meta) {
  const parts = body?.candidates?.[0]?.content?.parts;
  const raw = Array.isArray(parts) ? parts.map((part) => part.text || '').join('') : '';
  if (!raw.trim()) return null;

  const parsed = JSON.parse(raw);
  const about = paragraph(parsed.about);
  const invitation = paragraph(parsed.invitation);
  const reflection = paragraph(parsed.reflection);
  const farewell = paragraph(parsed.farewell);

  // A missing middle falls back to the template rather than shipping a hole: an
  // intro with a blank paragraph reads as a stall in the narration.
  if (!about || !invitation || !reflection || !farewell) return null;

  return {
    intro: [introOpening(meta.title, meta.author), about, invitation, INTRO_CLOSER].join('\n\n'),
    outro: [outroOpening(meta.title, meta.author), reflection, farewell].join('\n\n'),
  };
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

    const written = parseResponse(await response.json(), meta);
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
