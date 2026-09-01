'use strict';

const {
  KNOWN_ACRONYMS,
  isKnownWord,
  isRomanNumeral,
  romanToInt,
} = require('./lexicon');

/**
 * Text normalisation for extracted book text.
 *
 * PDFs produce text that reads fine to a human but sounds wrong when fed to a
 * TTS engine. The defects this file exists to repair, all seen in real books:
 *
 *   "A L E TTE R BE F ORE WE BE GI N"  letter-spaced display type
 *   "Kauti lya' s Arthas has tra"      spaces sprayed inside words
 *   "DharmaofWealth"                   a running header with its spaces lost
 *   "Dana : The Science of Giving"     spaces before punctuation
 *   "◆◆"                               decorative glyphs
 *   "Chapter\nI\nWhy the West..."      a heading broken over three lines
 *   "...built the\nmodern financial"   a sentence broken over two lines
 *
 * Two entry points:
 *   `normalise()`     runs at upload time and feeds the Text Preview. It repairs
 *                     structure but keeps the book looking like the book.
 *   `preprocessText()` runs at generation time only, on its way to the engine.
 *                     It may rewrite anything that would be *said* wrongly.
 */

/* ==========================================================================
 * Document vocabulary
 *
 * The letter-spacing repair has to decide whether "Arthas" is a word or half of
 * one. A fixed dictionary can't know a book's proper nouns, so the book supplies
 * them: every token on a *long* line is collected up front. Long lines are body
 * prose, which is where extraction gets the spacing right; the broken lines are
 * always short display type. That makes the book its own dictionary, with no
 * per-title configuration.
 * ========================================================================== */

/** Lines at least this long are body prose, and their tokens are real words. */
const BODY_LINE_CHARS = 70;

function buildVocabulary(text) {
  const vocab = new Set();

  for (const line of String(text || '').split('\n')) {
    if (line.length < BODY_LINE_CHARS) continue;
    const tokens = line.match(/[A-Za-z][A-Za-z'’-]*/g) || [];
    for (const token of tokens) {
      const word = token
        .toLowerCase()
        .replace(/[‘’]/g, "'")
        .replace(/'s$/, '')
        .replace(/[^a-z'-]/g, '');
      if (word.length >= 2) vocab.add(word);
      // Hyphenated compounds contribute their halves too ("non-attachment").
      for (const part of word.split('-')) {
        if (part.length >= 2) vocab.add(part);
      }
    }
  }

  return vocab;
}

/* ==========================================================================
 * Word segmentation
 *
 * Once a letter-spaced run is joined back up ("ALETTERBEFOREWEBEGIN") the spaces
 * that mattered have to be put back. This is a shortest-path over the string:
 * every prefix that is a known word is an edge, and the best path wins.
 * ========================================================================== */

/** No English word this test cares about is longer than this. */
const MAX_WORD_LEN = 18;
/** Below this a fused run is left alone — too little signal, too much risk. */
const MIN_SEGMENTABLE = 8;
/** Longer than this and it isn't a word run, it's a broken paragraph. */
const MAX_SEGMENTABLE = 60;

/**
 * Split a fused string into words.
 *
 * `allowUnknown` lets one unrecognised span through, which is what makes
 * "PARTONETHEINDIANVIEW" resolve when "indian" isn't in any list. Without it the
 * whole run stays fused. Scoring is length-squared, so the segmenter prefers a
 * few long words over many short ones — the alternative is "art has has tra".
 *
 * Returns an array of slices of the *original* string (case preserved), or null
 * when nothing convincing was found.
 */
function segmentFusedWord(word, vocab, allowUnknown = false) {
  const n = word.length;
  if (n < MIN_SEGMENTABLE || n > MAX_SEGMENTABLE) return null;

  const lower = word.toLowerCase();
  const best = new Array(n + 1).fill(-Infinity);
  const from = new Array(n + 1).fill(-1);
  const wasKnown = new Array(n + 1).fill(false);
  best[0] = 0;

  for (let i = 1; i <= n; i += 1) {
    for (let j = Math.max(0, i - MAX_WORD_LEN); j < i; j += 1) {
      if (best[j] === -Infinity) continue;

      const piece = lower.slice(j, i);
      const known = isKnownWord(piece, vocab);
      let score;

      if (known) {
        // "a" and "I" are the only real one-letter words; allowing others turns
        // every string into a pile of letters.
        if (piece.length === 1 && piece !== 'a' && piece !== 'i') continue;
        score = piece.length === 1 ? 0.5 : piece.length * piece.length;
      } else if (allowUnknown && piece.length >= 3) {
        score = -piece.length; // tolerated, never preferred
      } else {
        continue;
      }

      if (best[j] + score > best[i]) {
        best[i] = best[j] + score;
        from[i] = j;
        wasKnown[i] = known;
      }
    }
  }

  if (best[n] === -Infinity) return null;

  const parts = [];
  let unknownParts = 0;
  for (let i = n; i > 0; i = from[i]) {
    parts.unshift(word.slice(from[i], i));
    if (!wasKnown[i]) unknownParts += 1;
  }

  if (parts.length < 2) return null;
  // Guards against confident nonsense: "arthashastra" segments into
  // "art has has tra" (mean length 3.0) and must be rejected, while
  // "a letter before we begin" (4.0) and "how this book is arranged" (4.2) pass.
  const meanLength = n / parts.length;
  if (allowUnknown && (unknownParts > 1 || meanLength < 3.5)) return null;
  if (meanLength < 2.8) return null;

  return parts;
}

/**
 * Put the spaces back into one joined run.
 *
 * Three cheap structural splits first — case transitions and punctuation carry
 * real information and need no dictionary — then the segmenter for what's left.
 */
function resegment(joined, vocab) {
  if (!joined) return [];

  // "Kautilya'sArthashastra" -> "Kautilya's" + "Arthashastra"
  // "Dana:The"               -> "Dana:"      + "The"
  const parts = joined.split(/(?<=[a-z'’])(?=[A-Z])|(?<=[.,;:!?])(?=[A-Za-z])/);

  return parts.flatMap((part) => {
    if (!/^[A-Za-z]+$/.test(part)) return [part]; // has punctuation: leave it
    if (part.length < MIN_SEGMENTABLE) return [part];
    if (isKnownWord(part, vocab)) return [part];

    const isCaps = part === part.toUpperCase();
    // Complete segmentation first; the lenient pass is only for display type,
    // where a fused heading is guaranteed garbage anyway.
    return (
      segmentFusedWord(part, vocab, false) ||
      (isCaps ? segmentFusedWord(part, vocab, true) : null) || [part]
    );
  });
}

/* ==========================================================================
 * Broken-line detection
 * ========================================================================== */

/** Display type is short. A long line is prose, and prose is not repaired. */
const MAX_BROKEN_LINE = 70;
/** A fragment is short: "THI", "S", "tra". */
const FRAGMENT_CHARS = 3;
/** Real words average longer than this, even in a terse title. */
const MAX_FRAGMENT_MEAN = 4;

function lineTokens(line) {
  return line
    .trim()
    .split(/\s+/)
    .map((raw) => ({ raw, letters: raw.replace(/[^A-Za-z]/g, '') }))
    .filter((token) => token.letters.length > 0);
}

/**
 * Does this line have spaces inside its words?
 *
 * Every gate here is a way of saying "these tokens are too short and too rarely
 * words to be a real sentence":
 *
 *   ≤ 70 chars        display type, not prose
 *   ≥ 3 tokens        two tokens is not a pattern
 *   mean ≤ 4 letters  "Why the West Got Money Wrong" averages 3.8 but is 100%
 *                     real words, so the next two gates are what reject it
 *   ≥ 2 fragments     short tokens that aren't words ("THI", "S", "tra")
 *   ≥ 50% unknown     "Dr. Rao met Mr. Li in Goa" is 43% and survives
 *
 * The honest limit: a short heading made *entirely* of names the book never
 * spells out in body text ("The Tao of Wu Wei") looks identical to a broken one.
 * The document vocabulary catches those in any real book, and `lexicon.txt` is
 * there for the rest.
 */
function isBrokenLine(line, vocab) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > MAX_BROKEN_LINE) return false;

  const tokens = lineTokens(trimmed);
  if (tokens.length < 3) return false;

  let letters = 0;
  let unknown = 0;
  let fragments = 0;

  for (const token of tokens) {
    letters += token.letters.length;
    if (isKnownWord(token.raw, vocab)) continue;
    unknown += 1;
    if (token.letters.length <= FRAGMENT_CHARS) fragments += 1;
  }

  if (letters / tokens.length > MAX_FRAGMENT_MEAN) return false;
  if (fragments < 2) return false;
  return unknown / tokens.length >= 0.5;
}

/** Title Case, keeping acronyms and roman numerals in capitals. */
function toTitleCase(text) {
  return text.replace(/[A-Za-z][A-Za-z'’]*/g, (word) => {
    const upper = word.toUpperCase();
    if (KNOWN_ACRONYMS.has(upper) || (word === upper && isRomanNumeral(word))) return word;
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}

/**
 * Repair one broken line: join it back up, then put the real spaces back.
 *
 * Some PDFs keep the word boundary as a *double* space ("W h y  t h e  W e s t").
 * Where that signal survives it is authoritative, so groups are joined
 * separately; where it doesn't, the whole line is one group and the segmenter
 * does the work.
 */
function repairBrokenLine(line, vocab, titleCase) {
  const words = line
    .trim()
    .split(/\s{2,}/)
    .flatMap((group) => resegment(group.replace(/\s+/g, ''), vocab));

  const repaired = words.filter(Boolean).join(' ');
  return titleCase ? toTitleCase(repaired) : repaired;
}

/** Apply a per-line transform, leaving line structure alone. */
function mapLines(text, fn) {
  return String(text || '')
    .split('\n')
    .map(fn)
    .join('\n');
}

/* ==========================================================================
 * Step 1 — decoration
 * ========================================================================== */

/**
 * Strip ornaments. Piper reads "◆" as "diamond" or stalls on it, and a page of
 * asterisks becomes a page of "star star star".
 *
 * Standalone roman numerals are deliberately *not* removed here: step 5 needs
 * the "I" in "Chapter\nI\nTitle". Whatever is left over is dropped afterwards by
 * removeOrphanNumerals.
 */
function removeDecorations(text) {
  return String(text || '')
    // Decorative glyph runs anywhere in a line.
    .replace(/[◆◇●○■□▪▫►▶◄◀★☆✦✧✩❖•·∙‣⁃❯❮»«]+/g, ' ')
    // Zero-width and private-use characters, which some PDF fonts emit.
    .replace(/[\u200b-\u200f\u2028\u2029\ufeff\ue000-\uf8ff]/g, '')
    // Lines made only of rules, dots or ornaments.
    .replace(/^[ \t]*[-–—_=*~+#|.·:;'"]{2,}[ \t]*$/gm, '')
    // A single stranded punctuation mark on its own line.
    .replace(/^[ \t]*[-–—_=*~+#|·]{1}[ \t]*$/gm, '')
    // Dot leaders from a table of contents: "The Middle Path . . . . . 47".
    .replace(/[ \t]*(?:\.[ \t]*){4,}/g, ' ');
}

/* ==========================================================================
 * Steps 2-4 — letter spacing
 * ========================================================================== */

/**
 * Step 2: pure single-letter spacing — "A L E T T E R" -> "ALETTER".
 *
 * Four or more consecutive single letters. English has exactly two one-letter
 * words, so four in a row is never real text; the threshold also spares
 * initialisms like "U S A".
 */
function fixSingleLetterSpacing(text) {
  return String(text || '').replace(
    /(?<![A-Za-z])(?:[A-Za-z][ \t]){3,}[A-Za-z](?![A-Za-z])/g,
    (match) => match.replace(/[ \t]/g, '')
  );
}

/**
 * Step 3: mixed spacing in capitals — "A L E TTE R BE F ORE WE BE GI N".
 *
 * The tokens are a mix of one, two and three letters, so no fixed regex can
 * describe them. The line is detected as broken, joined, and re-split against
 * the dictionary; the result is title-cased because a line of display capitals
 * is a heading, and "MAKER" said as M-A-K-E-R is the defect this whole file is
 * about.
 *
 * `titleCase` is false on the upload path only: `detectChapters` reads ALL CAPS
 * as a heading signal, so flattening the case there would hide half the
 * chapters from the Text Preview. The engine gets the title-cased version.
 */
function fixMixedLetterSpacing(text, vocab, titleCase = true) {
  const words = vocab || buildVocabulary(text);
  return mapLines(text, (line) => {
    if (!/[A-Z]/.test(line)) return line;
    // Capitals only: mixed-case runs are step 4's, and their case is a signal
    // that must not be flattened.
    const letters = line.replace(/[^A-Za-z]/g, '');
    if (!letters || letters !== letters.toUpperCase()) return line;
    if (!isBrokenLine(line, words)) return line;
    return repairBrokenLine(line, words, titleCase);
  });
}

/**
 * Step 4: mixed-case spacing — "P a r t One", "Kauti lya' s Arthas has tra".
 *
 * Case is preserved here, because case is what puts the spaces back:
 * "Kautilya'sArthashastra" splits at the lowercase-to-uppercase seam into
 * "Kautilya's Arthashastra" with no dictionary needed.
 */
function fixMixedCaseLetterSpacing(text, vocab) {
  const words = vocab || buildVocabulary(text);
  return mapLines(text, (line) => {
    if (!isBrokenLine(line, words)) return line;
    return repairBrokenLine(line, words, false);
  });
}

/**
 * All three passes, in order.
 *
 * Used by the upload path, where the case of a heading still carries meaning —
 * so the repair puts the spaces back without touching capitals.
 */
function fixLetterSpacing(text, vocab) {
  const words = vocab || buildVocabulary(text);
  let out = fixSingleLetterSpacing(text);
  out = fixMixedLetterSpacing(out, words, false);
  out = fixMixedCaseLetterSpacing(out, words);
  return out;
}

/* ==========================================================================
 * Steps 5-6 — heading reconstruction
 * ========================================================================== */

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const TENS = [
  '', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
];

/** Spell out 0-99. Only used where digits would be read wrongly. */
function twoDigitsToWords(n) {
  if (n < 20) return ONES[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return ones === 0 ? TENS[tens] : `${TENS[tens]}-${ONES[ones]}`;
}

/** "IV" -> "Four". Chapter numbers only, so 1-99 is plenty. */
function numeralToWord(token) {
  const digits = /^\d+$/.test(token) ? Number(token) : romanToInt(token);
  if (!digits || digits > 99) return null;
  const word = twoDigitsToWords(digits);
  return word.charAt(0).toUpperCase() + word.slice(1);
}

const HEADING_WORD = /^(chapter|part|book|section|volume|canto)$/i;
const NUMERAL_LINE = /^([IVXLCivxlc]+|\d{1,3})[.:)]?$/;

/** A line that could be the title half of a heading — short, unpunctuated. */
function isTitleLine(line, maxChars = 80) {
  const trimmed = line.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= maxChars &&
    /[A-Za-z]/.test(trimmed) &&
    !/[.!?]$/.test(trimmed)
  );
}

/**
 * Step 5: "Chapter\nI\nWhy the West Got Money Wrong"
 *      -> "Chapter One. Why the West Got Money Wrong."
 *
 * Pure line work rather than a multiline regex: the number and the title are
 * each optional, blank lines may sit between them, and the fallback has to be
 * "leave it exactly as it was".
 */
function reconstructChapterHeaders(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (!HEADING_WORD.test(line)) {
      out.push(lines[i]);
      i += 1;
      continue;
    }

    // Look ahead past at most one blank line for a numeral.
    let j = i + 1;
    if (j < lines.length && lines[j].trim() === '') j += 1;
    const numeralLine = j < lines.length ? lines[j].trim() : '';
    const numeral = NUMERAL_LINE.test(numeralLine)
      ? numeralToWord(numeralLine.replace(/[.:)]$/, ''))
      : null;

    if (!numeral) {
      out.push(lines[i]);
      i += 1;
      continue;
    }

    // And past at most one more blank line for the title.
    let k = j + 1;
    if (k < lines.length && lines[k].trim() === '') k += 1;
    const titleLine = k < lines.length ? lines[k].trim() : '';
    const heading = `${line.charAt(0).toUpperCase()}${line.slice(1).toLowerCase()} ${numeral}`;

    if (isTitleLine(titleLine)) {
      // "Chapter One." then the title, so the engine pauses between the two
      // rather than reading "Chapter One Why the West Got Money Wrong".
      out.push(`${heading}. ${titleLine.replace(/[,;:]$/, '')}.`);
      i = k + 1;
    } else {
      // No title to run into: leave it unpunctuated and let normaliseForSpeech
      // terminate it like any other standalone heading.
      out.push(heading);
      i = j + 1;
    }
  }

  return out.join('\n');
}

/**
 * Step 6: "Part One\nThe Indian View\nof Wealth"
 *      -> "Part One. The Indian View of Wealth."
 *
 * Also the single-line form step 5 leaves behind: "Chapter IV" becomes
 * "Chapter Four", because espeak reads a bare roman numeral as a letter —
 * "Chapter I" comes out as "chapter aye".
 *
 * Only short unpunctuated lines are absorbed, and at most two of them, so a
 * heading is never allowed to swallow the paragraph that follows it.
 */
function reconstructPartHeaders(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    const match = /^(Part|Book|Volume|Section|Chapter|Canto)[ \t]+([A-Za-z0-9]+)[.:]?$/i.exec(line);

    if (!match) {
      out.push(lines[i]);
      i += 1;
      continue;
    }

    const label = `${match[1].charAt(0).toUpperCase()}${match[1].slice(1).toLowerCase()}`;
    const numeral = numeralToWord(match[2]) || match[2];
    const pieces = [];
    let j = i + 1;

    while (j < lines.length && pieces.length < 2 && isTitleLine(lines[j], 50)) {
      pieces.push(lines[j].trim());
      j += 1;
    }

    out.push(pieces.length ? `${label} ${numeral}. ${pieces.join(' ')}.` : `${label} ${numeral}`);
    i = j;
  }

  return out.join('\n');
}

/** Leftover page furniture: a line holding nothing but a numeral. */
function removeOrphanNumerals(text) {
  return String(text || '')
    .replace(/^[ \t]*\d{1,4}[ \t]*$/gm, '')
    .replace(/^[ \t]*[IVXLCDM]{1,6}[.:)]?[ \t]*$/gm, '');
}

/* ==========================================================================
 * Step 7 — fused words and running headers
 * ========================================================================== */

/**
 * A line that is one long word with a capital inside it is a running header
 * whose spaces were lost ("DharmaofWealth"), printed on every page. Reading the
 * book's title two hundred times is worse than losing it once, so it goes.
 *
 * The internal-capital test is what keeps a genuine one-word heading —
 * "Introduction", "Aparigraha" — on the page.
 */
function removeFusedHeaders(text) {
  const vocab = buildVocabulary(text);
  const lines = String(text || '').split('\n');

  const counts = new Map();
  const firstSeen = new Map();
  let bodyLines = 0;

  lines.forEach((line, index) => {
    const key = line.trim();
    if (!key) return;
    bodyLines += 1;
    if (key.length > 60) return;
    counts.set(key, (counts.get(key) || 0) + 1);
    if (!firstSeen.has(key)) firstSeen.set(key, index);
  });

  // A running header prints on nearly every page, so it recurs at roughly the
  // rate of one per page of extracted lines. A section label that repeats once
  // per chapter — "The Practice" — must stay, so the threshold scales with the
  // book rather than being a flat count.
  const runningHeaderMin = Math.max(5, Math.floor(bodyLines / 60));

  return lines
    .map((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      const fused =
        /^[A-Za-z]{8,}$/.test(trimmed) &&
        /[a-z][A-Z]/.test(trimmed) &&
        !isKnownWord(trimmed, vocab);

      // The first appearance is kept: if this really is a chapter title that
      // also prints in the header, that one occurrence is the chapter opening.
      const repeated =
        (counts.get(trimmed) || 0) >= runningHeaderMin &&
        firstSeen.get(trimmed) !== index &&
        !/[.!?]$/.test(trimmed);

      return fused || repeated ? '' : line;
    })
    .join('\n');
}

/**
 * Split words whose space was lost mid-line ("theModern" -> "the Modern").
 *
 * Applied token by token and only to tokens that aren't words in their own
 * right, so "iPhone" or a name the book uses elsewhere survives intact.
 */
function splitFusedWords(text, vocab) {
  const words = vocab || buildVocabulary(text);
  return String(text || '').replace(/[A-Za-z][A-Za-z'’]*/g, (token) => {
    if (!/[a-z][A-Z]/.test(token)) return token;
    if (isKnownWord(token, words)) return token;
    return token.replace(/([a-z])([A-Z])/g, '$1 $2');
  });
}

/* ==========================================================================
 * Step 8 — punctuation spacing
 * ========================================================================== */

/**
 * Repair spacing around punctuation.
 *
 * Every pattern uses `[ \t]` rather than `\s`: `\s` matches newlines, and a rule
 * meant to pull a comma back one space would silently splice two lines together.
 *
 * The hyphen rule is decided per line. In a heading, "Non - Attachment" is a
 * compound and closes up; in prose, "wealth - and power" is a dash used as a
 * pause and becomes a comma, which is what it sounds like.
 */
function fixPunctuationSpacing(text) {
  return mapLines(text, (line) => {
    if (!line.trim()) return line;

    let out = line
      // "Lakshmi ' s" and "Kauti lya' s" -> "Lakshmi's"
      .replace(/([A-Za-z])[ \t]*['’][ \t]*(s|t|d|m|re|ve|ll)\b/gi, "$1'$2")
      // "Dana : The", "Risk , Renunciation" -> "Dana: The", "Risk, Renunciation"
      .replace(/[ \t]+([,;:.!?])/g, '$1')
      // Punctuation that lost the space after it.
      .replace(/([,;:])(?=[A-Za-z])/g, '$1 ')
      // Space inside brackets and directional quotes. A straight " is left
      // alone: it is both the opening and the closing mark, so `said, "I` would
      // lose the space that belongs there.
      .replace(/\([ \t]+/g, '(')
      .replace(/[ \t]+\)/g, ')')
      .replace(/([“‘])[ \t]+/g, '$1')
      .replace(/[ \t]+([”’])/g, '$1');

    // A heading is short and unpunctuated; prose isn't.
    const headingLike = out.trim().length <= 60 && !/[.!?]$/.test(out.trim());

    out = out.replace(/\b([A-Za-z]+)[ \t]+-[ \t]+([A-Za-z]+)\b/g, (match, left, right) => {
      const compound = headingLike && /^[A-Z]/.test(left) && /^[A-Z]/.test(right);
      return compound ? `${left}-${right}` : `${left}, ${right}`;
    });

    return out;
  });
}

/* ==========================================================================
 * Step 9 — line joining
 * ========================================================================== */

/**
 * Rejoin sentences that extraction broke across lines.
 *
 * This is the fix for the pause that made the whole pipeline sound wrong. A
 * sentence split as "The one that built the / modern financial world" reaches
 * the engine as two lines, and every downstream step — chunking, and Piper's own
 * line-at-a-time reading — treats a line end as an utterance end. The result is
 * a one to two second silence in the middle of a sentence.
 *
 * A line is a continuation when it doesn't finish a sentence and the next line
 * starts lowercase. Everything else keeps its break, so headings stay headings.
 */
function joinBrokenLines(text) {
  const lines = String(text || '').split('\n');
  const out = [];

  for (const raw of lines) {
    const line = raw.trim();

    if (!line) {
      // Preserve the paragraph break, but never stack blank lines.
      if (out.length && out[out.length - 1] !== '') out.push('');
      continue;
    }

    const previous = out.length ? out[out.length - 1] : '';

    if (previous) {
      // "some-\nthing" — a word hyphenated across the break.
      if (/[a-z]-$/.test(previous) && /^[a-z]/.test(line)) {
        out[out.length - 1] = previous.slice(0, -1) + line;
        continue;
      }
      // Unfinished line + lowercase start = one sentence, two lines.
      const finished = /[.!?:;]$/.test(previous);
      if (!finished && /^[a-z(“‘"']/.test(line)) {
        out[out.length - 1] = `${previous} ${line}`;
        continue;
      }
    }

    out.push(line);
  }

  return out.join('\n');
}

/* ==========================================================================
 * Step 10 — labelled callouts
 * ========================================================================== */

/** A short unpunctuated line that labels the block under it ("The Practice"). */
function isCalloutLabel(line) {
  const trimmed = line.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= 40 &&
    /^[A-Z]/.test(trimmed) &&
    !/[.!?,;:]$/.test(trimmed) &&
    trimmed.split(/\s+/).length <= 4
  );
}

/**
 * Pull-quote blocks — "The Practice" and its kin — are set narrow, so extraction
 * returns them as a stack of half-lines. Left alone they become a run of
 * mini-utterances with a pause between each. The label gets its full stop (so
 * the engine pauses once, deliberately) and the body becomes one paragraph.
 */
function fixPracticeSections(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (!isCalloutLabel(line)) {
      out.push(lines[i]);
      i += 1;
      continue;
    }

    // Collect the block that follows, up to the next blank line.
    const body = [];
    let j = i + 1;
    while (j < lines.length && lines[j].trim()) {
      body.push(lines[j].trim());
      j += 1;
    }

    // One line of body isn't a callout, it's a heading over a paragraph.
    if (body.length < 2) {
      out.push(lines[i]);
      i += 1;
      continue;
    }

    out.push(`${line}.`);
    out.push(body.join(' '));
    i = j;
  }

  return out.join('\n');
}

/* ==========================================================================
 * Steps 11-12 — capitals, numbers, symbols
 * ========================================================================== */

/**
 * Convert ALL-CAPS words that aren't real acronyms into normal case.
 *
 * A run of consecutive caps words (a shouted line or a heading) becomes sentence
 * case rather than Title Case Of Every Word, which reads more naturally.
 */
function fixAllCaps(text) {
  // A caps run must not span lines: `\s+` would swallow the blank line between
  // a chapter number and its title, merging two headings into one and losing the
  // paragraph break the chunker relies on.
  return String(text || '').replace(/\b[A-Z][A-Z'’]*(?:[ \t]+[A-Z][A-Z'’]*)*\b/g, (match) => {
    const words = match.split(/[ \t]+/);

    // Single token: keep real acronyms and roman numerals untouched.
    if (words.length === 1) {
      const bare = words[0].replace(/['’]S$/, '');
      if (bare.length < 2) return match;
      if (KNOWN_ACRONYMS.has(bare) || isRomanNumeral(bare)) return match;
      // Handle possessives: MAKER'S -> Maker's, not Maker'S.
      return words[0].toLowerCase().replace(/^[a-z]/, (c) => c.toUpperCase());
    }

    // A run of caps words: sentence-case it, but leave known acronyms alone.
    return words
      .map((word, i) => {
        const bare = word.replace(/['’]S$/, '');
        if (KNOWN_ACRONYMS.has(bare) || isRomanNumeral(bare)) return word;
        const lower = word.toLowerCase();
        return i === 0 ? lower.replace(/^[a-z]/, (c) => c.toUpperCase()) : lower;
      })
      .join(' ');
  });
}

const ORDINAL_WORDS = {
  1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', 6: 'sixth',
  7: 'seventh', 8: 'eighth', 9: 'ninth', 10: 'tenth', 11: 'eleventh',
  12: 'twelfth', 13: 'thirteenth', 20: 'twentieth', 30: 'thirtieth',
};

/**
 * Read a 4-digit year the way a person would: 1995 -> "nineteen ninety-five",
 * 2007 -> "two thousand seven". Blanket number-to-words libraries get this
 * wrong ("one thousand nine hundred ninety-five"), which is why numbers are
 * handled by context here rather than converted wholesale.
 */
function yearToWords(year) {
  const n = Number(year);
  if (n >= 2000 && n < 2010) return `two thousand ${n % 10 === 0 ? '' : ONES[n % 10]}`.trim();
  if (n >= 2010 && n < 2100) return `twenty ${twoDigitsToWords(n % 100)}`;
  const high = Math.floor(n / 100);
  const low = n % 100;
  if (low === 0) return `${twoDigitsToWords(high)} hundred`;
  if (low < 10) return `${twoDigitsToWords(high)} oh ${ONES[low]}`;
  return `${twoDigitsToWords(high)} ${twoDigitsToWords(low)}`;
}

/**
 * Numbers, handled by what they represent rather than converted wholesale.
 * Money is read as money, years as years; everything else is left for the
 * engine's own frontend, which already handles decimals and plain counts.
 */
function normaliseNumbers(text) {
  return (
    String(text || '')
      // Currency must be reordered — a naive "$" -> "dollars" yields "dollars5".
      .replace(/\$\s?([\d,]+)\.(\d{2})\b/g, (m, whole, cents) => {
        const dollars = whole.replace(/,/g, '');
        const centValue = Number(cents);
        const dollarPart = `${dollars} ${dollars === '1' ? 'dollar' : 'dollars'}`;
        return centValue === 0
          ? dollarPart
          : `${dollarPart} ${centValue} ${centValue === 1 ? 'cent' : 'cents'}`;
      })
      .replace(/\$\s?([\d,]+)\b/g, (m, whole) => {
        const dollars = whole.replace(/,/g, '');
        return `${dollars} ${dollars === '1' ? 'dollar' : 'dollars'}`;
      })
      .replace(/£\s?([\d,]+)\b/g, (m, n) => `${n.replace(/,/g, '')} pounds`)
      .replace(/€\s?([\d,]+)\b/g, (m, n) => `${n.replace(/,/g, '')} euros`)
      // Years: only standalone 4-digit numbers in a plausible range, never part
      // of a larger number or a decimal. The trailing guard rejects "1995.50"
      // and "19950" but must still allow a year that ends a sentence ("in 1995.").
      // The currency guard matters because the rules above run first: "$1,250.50"
      // has already become "1250 dollars", and 1250 is a plausible year.
      .replace(
        /(?<![\d.,])(1[1-9]\d{2}|20\d{2})(?!\.?\d)(?![ \t]?(?:dollars?|pounds?|euros?|cents?)\b)/g,
        (m) => yearToWords(m)
      )
      // Times: 3:30 -> "three thirty".
      .replace(/\b(\d{1,2}):(\d{2})\b/g, (m, h, min) => {
        const hour = Number(h);
        const minute = Number(min);
        if (hour > 23 || minute > 59) return m;
        if (minute === 0) return `${twoDigitsToWords(hour)} o'clock`;
        if (minute < 10) return `${twoDigitsToWords(hour)} oh ${ONES[minute]}`;
        return `${twoDigitsToWords(hour)} ${twoDigitsToWords(minute)}`;
      })
      // Ordinals: 1st -> first.
      .replace(/\b(\d+)(st|nd|rd|th)\b/gi, (m, n) => {
        const value = Number(n);
        return ORDINAL_WORDS[value] || m;
      })
      .replace(/(\d)\s?%/g, '$1 percent')
  );
}

/** Expand or strip symbols and markup that read badly aloud. */
function normaliseSymbols(text) {
  return (
    String(text || '')
      // URLs and emails are unlistenable — remove them entirely.
      .replace(/\b(?:https?:\/\/|www\.)\S+/gi, '')
      .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, '')
      // Markdown emphasis markers.
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      // Citations and editorial brackets go; parentheses keep their contents.
      .replace(/\[[^\]]*\]/g, '')
      .replace(/[()]/g, '')
      // Dashes and ellipses become pauses the engine can actually hear.
      .replace(/\s*[—–]\s*/g, ', ')
      .replace(/\.{3,}/g, '. ')
      .replace(/\s+&\s+/g, ' and ')
      .replace(/&/g, ' and ')
      // Only between words — this must not touch dates (9/11) or fractions.
      // "and/or" is spelled out as "and or" rather than "and or or".
      .replace(/\b([A-Za-z]+)\/([A-Za-z]+)\b/g, (m, a, b) =>
        b.toLowerCase() === 'or' ? `${a} or` : `${a} or ${b}`
      )
      .replace(/#\s?(\d)/g, 'number $1')
      .replace(/\s@\s/g, ' at ')
      .replace(/[ \t]{2,}/g, ' ')
  );
}

/** Step 12 under the name the pipeline uses. */
const fixSymbols = normaliseSymbols;

/* ==========================================================================
 * Step 13 — whitespace
 * ========================================================================== */

/** Collapse spacing and tidy the punctuation the substitutions leave behind. */
function cleanWhitespace(text) {
  return String(text || '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/,{2,}/g, ',')
    .replace(/\.[ \t]*\.[ \t]*/g, '. ')
    .replace(/([!?])[ \t]*[.!?]+/g, '$1')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

/* ==========================================================================
 * Upload-time normalisation
 * ========================================================================== */

/** Collapse whitespace, drop page furniture, normalise punctuation for speech. */
function cleanText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n') // normalise line endings
    .replace(/\f/g, '\n') // form feeds -> newlines
    .replace(/­/g, '') // soft hyphens
    .replace(/ﬁ/g, 'fi')
    .replace(/ﬂ/g, 'fl') // common PDF ligatures
    .replace(/[‘’]/g, "'") // smart quotes -> plain
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-') // en/em dashes
    .replace(/…/g, '...')
    .replace(/([a-z])-\n([a-z])/g, '$1$2') // rejoin words hyphenated across lines
    .replace(/[ \t]+/g, ' ') // collapse runs of spaces
    .replace(/^\s*\d+\s*$/gm, '') // lone page numbers
    .replace(/^\s*Page \d+( of \d+)?\s*$/gim, '') // "Page 3 of 40" footers
    .replace(/\n{3,}/g, '\n\n') // at most one blank line
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

function countWords(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/** A line holding nothing but "Chapter" is half a heading; the rest follows it. */
const HEADING_WORD_ONLY = /^(chapter|part|book|section|volume|canto)$/i;

/**
 * Build the heading as a reader sees it on the page.
 *
 * Display type often breaks a heading across three lines — "Chapter", then "I",
 * then the title — and listing that as a chapter called "Chapter" is useless.
 * Returns the joined title and how many lines it occupies, so callers can show
 * one heading instead of a fragment followed by two orphans.
 */
function expandHeading(lines, index) {
  const first = lines[index].trim();
  if (!HEADING_WORD_ONLY.test(first)) return { title: first, lineSpan: 1 };

  const numeralLine = (lines[index + 1] || '').trim();
  if (!NUMERAL_LINE.test(numeralLine)) return { title: first, lineSpan: 1 };

  const head = `${first} ${numeralLine.replace(/[.:)]$/, '')}`;
  const titleLine = (lines[index + 2] || '').trim();

  if (titleLine && titleLine.length <= 80 && !/[.!?]$/.test(titleLine)) {
    return { title: `${head}: ${titleLine}`, lineSpan: 3 };
  }
  return { title: head, lineSpan: 2 };
}

/**
 * Find chapter headings and measure each chapter's length.
 *
 * A heading is a short standalone line that either starts with an explicit
 * chapter/part marker or is written in title case / all caps with no trailing
 * sentence punctuation.
 */
function detectChapters(text) {
  const lines = text.split('\n');
  const marks = [];

  const explicit = /^(chapter|part|book|section|prologue|epilogue|introduction|foreword|preface|afterword|conclusion)\b/i;

  // Lines already folded into a multi-line heading must not open a chapter of
  // their own — an ALL CAPS title line would otherwise be marked twice.
  let consumedUntil = -1;

  lines.forEach((line, i) => {
    if (i <= consumedUntil) return;

    const trimmed = line.trim();
    if (trimmed.length < 3 || trimmed.length > 80) return;
    // Headings don't end in sentence punctuation and aren't full paragraphs.
    if (/[.,;:]$/.test(trimmed)) return;

    const hasLetters = /[A-Za-z]/.test(trimmed);
    if (!hasLetters) return;

    const isExplicit = explicit.test(trimmed);
    const isAllCaps = trimmed === trimmed.toUpperCase() && trimmed.split(/\s+/).length <= 12;

    if (isExplicit || isAllCaps) {
      const { title, lineSpan } = expandHeading(lines, i);
      marks.push({ title, lineIndex: i, lineSpan });
      consumedUntil = i + lineSpan - 1;
    }
  });

  // No headings found: treat the whole book as a single chapter so the UI still
  // has something coherent to show.
  if (marks.length === 0) {
    return [{ index: 0, title: 'Full Text', lineIndex: 0, lineSpan: 1, wordCount: countWords(text) }];
  }

  return marks.map((mark, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].lineIndex : lines.length;
    const body = lines.slice(mark.lineIndex, end).join('\n');
    return {
      index: i,
      title: mark.title,
      lineIndex: mark.lineIndex,
      // How many source lines the heading itself spans, so a reader can render
      // it as one heading rather than a fragment plus two stray lines.
      lineSpan: mark.lineSpan,
      wordCount: countWords(body),
    };
  });
}

/* ==========================================================================
 * Speech preprocessing
 *
 * Everything below runs at generation time, not at upload time, so the Text
 * Preview keeps showing the book as extracted while the engine receives a
 * version tuned for reading aloud.
 * ========================================================================== */

/**
 * Flatten a chunk to a single line for the engine.
 *
 * Piper reads stdin line by line and treats each line as its own utterance, so
 * an internal newline inside a chunk breaks the audio exactly where the line
 * break was — that is what dropped the first word of every paragraph.
 *
 * Terminating each line with a full stop fixes the drop but introduces a worse
 * defect if the line was a continuation: "The one that built the." is a complete
 * sentence to the engine, and it pauses for a second before "modern financial
 * world". So a line that continues the one above it is joined instead, and only
 * genuine line ends are punctuated.
 */
function normaliseForSpeech(text) {
  const lines = String(text || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const out = [];

  for (const line of lines) {
    if (out.length) {
      const previous = out[out.length - 1];
      const finished = /[.!?,;:]$/.test(previous);

      if (!finished && /^[a-z(“‘"']/.test(line)) {
        out[out.length - 1] = `${previous} ${line}`;
        continue;
      }
      if (!finished) out[out.length - 1] = `${previous}.`;
    }
    out.push(line);
  }

  if (out.length && !/[.!?,;:]$/.test(out[out.length - 1])) {
    out[out.length - 1] = `${out[out.length - 1]}.`;
  }

  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Full text preparation for speech. Runs over the whole book once, before
 * chunking.
 *
 * The order is load-bearing:
 *
 *   1  decoration      before anything reads the line structure
 *   2  A L E T T E R   single-letter runs, the unambiguous case
 *   3  A L E TTE R     mixed fragments in capitals, dictionary-assisted
 *   4  P a r t One     mixed case, where case restores the spaces
 *   5  Chapter\nI      needs the numeral line, so it runs before…
 *   6  Part One        …and before the leftover numerals are dropped
 *   7  DharmaofWealth  running headers, then any remaining fused words
 *   8  Dana :          punctuation spacing
 *   9  broken lines    rejoin sentences split across lines
 *  10  callouts        pull-quote blocks set narrow
 *  11  ALL CAPS        whatever capitals survived the heading passes
 *  12  symbols         &, %, $, years, URLs
 *  13  whitespace      tidy up after all of the above
 */
function preprocessText(text) {
  if (!text) return '';

  // Line endings, ligatures and smart punctuation first — every step below
  // matches on plain ASCII quotes and real newlines.
  let out = String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/\f/g, '\n')
    .replace(/­/g, '')
    .replace(/ﬁ/g, 'fi')
    .replace(/ﬂ/g, 'fl')
    .replace(/[ --]/g, '');

  // The book's own words, harvested once and threaded through every pass that
  // has to tell a word from a fragment.
  const vocab = buildVocabulary(out);

  out = removeDecorations(out); // 1
  out = fixSingleLetterSpacing(out); // 2
  out = fixMixedLetterSpacing(out, vocab); // 3
  out = fixMixedCaseLetterSpacing(out, vocab); // 4
  out = reconstructChapterHeaders(out); // 5
  out = reconstructPartHeaders(out); // 6
  out = removeOrphanNumerals(out);
  out = removeFusedHeaders(out); // 7
  out = splitFusedWords(out, vocab);
  out = fixPunctuationSpacing(out); // 8
  out = joinBrokenLines(out); // 9
  out = fixPracticeSections(out); // 10
  out = fixAllCaps(out); // 11
  out = fixSymbols(out); // 12
  out = normaliseNumbers(out);
  return cleanWhitespace(out); // 13
}

/**
 * Run the full pipeline over raw extracted text.
 *
 * Letter spacing is repaired here too, because a preview full of
 * "A L E TTE R" is unreadable and unusable as a starting point for edits. The
 * repair keeps the original case: `detectChapters` uses ALL CAPS as a heading
 * signal, and title-casing at this stage would hide half the chapters.
 */
function normalise(rawText) {
  const text = cleanText(fixLetterSpacing(rawText || ''));
  return { text, chapters: detectChapters(text), wordCount: countWords(text) };
}

module.exports = {
  // Upload path.
  cleanText,
  detectChapters,
  countWords,
  normalise,
  buildVocabulary,

  // Speech preparation — used by the generate pipeline, not by upload.
  preprocessText,
  normaliseForSpeech,

  // Individual passes, exported so each can be exercised on its own.
  removeDecorations,
  fixSingleLetterSpacing,
  fixMixedLetterSpacing,
  fixMixedCaseLetterSpacing,
  fixLetterSpacing,
  reconstructChapterHeaders,
  reconstructPartHeaders,
  removeOrphanNumerals,
  removeFusedHeaders,
  splitFusedWords,
  fixPunctuationSpacing,
  joinBrokenLines,
  fixPracticeSections,
  fixAllCaps,
  fixSymbols,
  normaliseSymbols,
  normaliseNumbers,
  cleanWhitespace,
  segmentFusedWord,
  isBrokenLine,
};
