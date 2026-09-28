import { config } from '../config/env.js';
import {
  detectChapters,
  countWords,
  removeFrontMatterAndMetadata,
  removeBackMatter,
  buildVocabulary,
  segmentFusedWord,
} from './textCleaner.js';
import { detectBookMeta, stripExistingNarration, metaFromExistingIntro } from './narrator.js';
import { LIST_MARKER, buildOutline, headingKey, headingLevelMap } from './docStructure.js';
import { splitSentences } from './sentences.js';
import { INTRO_CLOSER, summaryIntroOpening, summaryOutroOpening } from './narrationMarkers.js';

/**
 * Plans a summary before a single request is made: which parts of the book
 * exist, how many words each may have, and how they are grouped into calls.
 *
 * Pure and synchronous, so the page can show the breakdown (and what a run
 * would cost) on every change of length, provider or structure.
 *
 * The one promise it makes is arithmetic: every budget here is rounded down, the
 * intro and outro are capped, and headings are counted, so the finished summary
 * can never be longer than `targetWords`.
 */

/** Longest the model may make each piece of the intro and outro, in words. */
const INTRO_CAPS = { about: 90, invitation: 60, reflection: 90, farewell: 35 };

/**
 * Below this many words of body text a section is folded into its neighbour: a
 * PART ONE divider, an epigraph, a two-paragraph preface. Its heading is kept,
 * in order; its text is summarized with the section it joined. Nothing is dropped.
 */
const SMALL_SECTION_WORDS = 150;
/** Fewest words a real section is given. Less than this is not a summary of anything. */
const MIN_SECTION_WORDS = 60;
/** Most words asked of one request. Long answers drift from their length target. */
const MAX_UNIT_BUDGET = 1500;
/** Most passages batched into one request. */
const MAX_UNIT_ITEMS = 8;
/** Shortest summary worth writing: under this, the intro and outro are most of it. */
const MIN_TARGET_WORDS = 450;
/** A "summary" longer than this share of the book is not a summary. */
const MAX_SHARE = 0.6;
/** Headings may take at most this share of the words left after the intro and outro. */
const MAX_HEADING_SHARE = 0.35;
/** A heading repeated this often is a running head, not a chapter. */
const RUNNING_HEAD_REPEATS = 3;

const STRUCTURES = ['chapters', 'continuous'];

function planError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function cleanTitle(title) {
  // A heading must not end in . , ; : or detectChapters stops seeing it once the
  // summary becomes the open book.
  return String(title || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:]+$/, '')
    .trim();
}

/**
 * Title and author from a file named the way books are usually named:
 * "The Laws of Human Nature - Robert Greene.pdf". Tried before the text itself,
 * because detectBookMeta reads the first short line of the book and on a real
 * ebook that is as likely to be "Also by Robert Greene" as the title.
 */
const NAME_WORD = /^[A-Z][a-zA-Z'’.-]*$/;
const NOT_IN_NAMES = /^(of|the|and|a|an|to|in|on|for|with)$/i;

function isNameLike(text) {
  const words = text.split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 4 && words.every((w) => NAME_WORD.test(w) && !NOT_IN_NAMES.test(w));
}

function metaFromFilename(filename) {
  const stem = String(filename || '')
    .replace(/\.[^.]+$/, '')
    .replace(/_[^_]*\.(?:com|org|net)[^_]*_/gi, ' ')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = stem.split(/\s+[-–—]\s+/).map((part) => part.trim());
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  if (isNameLike(parts[1])) return { title: parts[0], author: parts[1] };
  if (isNameLike(parts[0])) return { title: parts[1], author: parts[0] };
  return null;
}

const SMALL_TITLE_WORD = /^(a|an|and|at|by|for|in|of|on|or|the|to|with)$/i;

function titleFromName(filename) {
  return String(filename || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((word, i) =>
      i > 0 && SMALL_TITLE_WORD.test(word) ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(' ');
}

/**
 * The text a summary is written from: the book with the narrator's own intro,
 * the title page, contents and back matter removed — the same three steps as
 * POST /api/clean-text, so an index or a copyright page never takes budget.
 *
 * `certain` is false when the title was guessed from the text, which is often
 * wrong on a real ebook; the page then asks for it to be checked, because it is
 * spoken in the intro and the closing.
 */
function prepareBook(text, filename = '') {
  const fromIntro = metaFromExistingIntro(text);
  const fromFile = fromIntro ? null : metaFromFilename(filename);
  let meta = fromIntro || fromFile || detectBookMeta(text, filename);

  // A fused heading ("ALETTERBEFOREWEBEGIN") is never a title. The file name
  // is a better guess, even if it still needs checking.
  if (!fromIntro && !fromFile && /^\S{12,}$/.test(meta.title) && titleFromName(filename)) {
    meta = { ...meta, title: titleFromName(filename) };
  }

  const front = removeFrontMatterAndMetadata(stripExistingNarration(text));
  const body = removeBackMatter(front).text.trim();
  return { meta, body, certain: Boolean(fromIntro || fromFile) };
}

const BARE_HEADING = /^(chapter|part|book|section|volume|canto)$/i;
const NUMERAL =
  /^([IVXLC]+|\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)[.:)]?$/i;
// A heading line ending on one of these was wrapped mid-phrase:
// "Transform Self-love into" / "Empathy".
const TRAILING_FUNCTION_WORD =
  /\b(a|an|the|of|into|to|by|or|and|for|with|in|on|from|at|as|upon|over|under|than|toward|towards|within|without|your|their|our|its|his|her|my)$/i;

/** Headings that are never part of what the book says. Whole-title matches only. */
const NOT_THE_BOOK =
  /^(contents|table of contents|index|notes|endnotes|bibliography|selected bibliography|references|works cited|sources|acknowledg(?:e)?ments|about the authors?|also by\b.*|copyright|dedication|title page|permissions|credits|glossary|further reading|praise for\b.*|a note on (?:the )?sources|list of illustrations)$/i;

function titleLike(line) {
  const text = String(line || '').trim();
  return (
    text.length > 0 &&
    text.length <= 80 &&
    /[A-Za-z0-9]/.test(text) &&
    !/[.!?,;:"”’]$/.test(text) &&
    !/^["“‘'(]/.test(text) &&
    !LIST_MARKER.test(text)
  );
}

const STRUCTURAL =
  /^(chapter|part|book|section|prologue|epilogue|introduction|foreword|preface|afterword|conclusion|contents|index|notes|appendix|glossary|bibliography|acknowledg(?:e)?ments)$/i;
const FUNCTION_WORD =
  /^(a|an|the|of|into|to|by|or|and|for|with|in|on|from|at|as|upon|over|under|than|toward|towards|within|without|is|are|not|your|their|our|its|his|her|my|vs)$/;

/**
 * Splits a heading line the PDF fused with the paragraph under it:
 * "The Law of Narcissism e all naturally possess the most remarkable…", where
 * the drop cap "W" went missing and the opening sentence landed on the heading
 * line. The cut is at the first lower-case word that is not a function word;
 * a real title only ever runs lower case through words like "of" and "into".
 * The remainder is book text and goes back into the section body. Paragraphs
 * arrive as one flowed line, so a real fusion leaves a long remainder; asking
 * for twelve words keeps a sentence-case title ("How to think about money")
 * from being cut in half.
 */
const FUSED_REST_WORDS = 12;

function splitFusedHeading(line) {
  const tokens = line.split(/\s+/);
  if (tokens.length < FUSED_REST_WORDS + 2) return { title: line, rest: '' };
  for (let i = 2; i <= tokens.length - FUSED_REST_WORDS; i += 1) {
    if (/^[a-z]/.test(tokens[i]) && !FUNCTION_WORD.test(tokens[i]) && !/-/.test(tokens[i])) {
      return { title: tokens.slice(0, i).join(' '), rest: tokens.slice(i).join(' ') };
    }
  }
  return { title: line, rest: '' };
}

/**
 * Whether `next` continues the heading `title` rather than starting something
 * new: the title stopped on "of" or "into", the next line runs on in lower
 * case, or the next line is one capitalised word that is not itself a heading
 * ("Make Them Want to Follow" / "You").
 */
function continuesHeading(title, next) {
  if (TRAILING_FUNCTION_WORD.test(title)) return true;
  // A heading's tail is a few words ("the Group"). A longer lower-case line, or
  // one opening on a stray letter, is the paragraph set beside a drop cap
  // ("e all naturally possess the most remarkable tool for") and is not joined.
  if (/^[a-z]/.test(next)) {
    return next.split(/\s+/).length <= 5 && !/^[b-hj-z](?:\s|$)/.test(next);
  }
  return /^[A-Z][a-z'’]+$/.test(next) && title.split(/\s+/).length >= 2 && !STRUCTURAL.test(next);
}

function nextNonBlank(lines, from) {
  for (let i = from; i < lines.length && i < from + 4; i += 1) {
    if (lines[i].trim()) return i;
  }
  return -1;
}

/**
 * Turns candidate heading lines into whole headings. A bare "Chapter" takes the
 * numeral and the title below it even across blank lines ("Chapter" / "I" /
 * "Why the West Got Money Wrong"), and a heading wrapped mid-phrase takes its
 * continuation. Every line a heading swallows is marked consumed, so a numeral
 * detectChapters reported as a heading of its own ("III") disappears into it.
 */
function expandMarks(marks, lines) {
  const out = [];
  let consumed = -1;
  for (const mark of [...marks].sort((a, b) => a.lineIndex - b.lineIndex)) {
    if (mark.lineIndex <= consumed) continue;
    let { title, rest } = splitFusedHeading(lines[mark.lineIndex].trim());
    let end = mark.lineIndex;

    if (BARE_HEADING.test(title)) {
      const n = nextNonBlank(lines, end + 1);
      if (n >= 0 && NUMERAL.test(lines[n].trim())) {
        title += ` ${lines[n].trim().replace(/[.:)]$/, '')}`;
        end = n;
      }
      const t = nextNonBlank(lines, end + 1);
      if (t >= 0 && titleLike(lines[t]) && !BARE_HEADING.test(lines[t].trim())) {
        title += `: ${lines[t].trim()}`;
        end = t;
      }
    }

    for (let joins = 0; !rest && joins < 2; joins += 1) {
      const k = nextNonBlank(lines, end + 1);
      if (k < 0 || !titleLike(lines[k])) break;
      const next = splitFusedHeading(lines[k].trim());
      if (!continuesHeading(title, next.title)) break;
      title += ` ${next.title}`;
      rest = next.rest;
      end = k;
    }

    out.push({ title, rest, lineIndex: mark.lineIndex, end });
    consumed = end;
  }
  return out;
}

/**
 * Repairs a heading the PDF broke: "ALETTERBEFOREWEBEGIN" and "THE WEALTH THAT
 * REMAI NS". The reader shows headings as extracted, but the summary is new
 * text and there is no reason for it to carry the damage forward. Uses the
 * book's own vocabulary, the same way preprocessText repairs body text.
 */
function repairHeading(title, vocab) {
  const tokens = title.split(/\s+/);
  const merged = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const a = tokens[i];
    const b = tokens[i + 1];
    if (b && /^[A-Za-z]+$/.test(a + b) && !vocab.has(a.toLowerCase()) && vocab.has(`${a}${b}`.toLowerCase())) {
      merged.push(a + b);
      i += 1;
    } else merged.push(a);
  }

  return merged
    .map((token) => {
      if (!/^[A-Za-z]{10,}$/.test(token) || vocab.has(token.toLowerCase())) return token;
      const words = segmentFusedWord(token.toLowerCase(), vocab, true);
      if (!words || words.length < 2 || words.some((word) => /\s/.test(word))) return token;
      const upper = token === token.toUpperCase();
      return words
        .map((word, i) =>
          upper ? word.toUpperCase() : i === 0 || word.length > 3 ? word[0].toUpperCase() + word.slice(1) : word,
        )
        .join(' ');
    })
    .join(' ');
}

/** Headings that are not chapters: epigraphs, index entries, the alphabet strip. */
function isRealHeading(title) {
  if (!title || title.length > 100) return false;
  if (/^["“‘']/.test(title)) return false;
  if (/[.!]["”’]?$/.test(title)) return false;
  // Two sentences is a pull quote set in large type, not a title.
  if (/[.!?]\s+[A-Z]/.test(title)) return false;
  if (/\d/.test(title) && /,/.test(title)) return false;
  if (/^A\s?B\s?C\s?D/.test(title)) return false;
  return true;
}

/**
 * A contents page repeats every chapter title, so a title seen twice is kept
 * only where it appears the second time. A title seen three or more times is a
 * running head, or a recurring subhead like "Keys to Human Nature", and is not
 * a boundary at all.
 */
function dropRepeats(marks) {
  const count = new Map();
  for (const mark of marks) count.set(headingKey(mark.title), (count.get(headingKey(mark.title)) || 0) + 1);
  const seen = new Map();
  return marks.filter((mark) => {
    const key = headingKey(mark.title);
    const total = count.get(key);
    seen.set(key, (seen.get(key) || 0) + 1);
    if (total >= RUNNING_HEAD_REPEATS) return false;
    return total === 1 || seen.get(key) === total;
  });
}

function isProse(lines) {
  if (!lines.length) return false;
  const prose = lines.filter((line) => countWords(line) >= 12 || /[.!?]["”’)]?$/.test(line.trim()));
  return prose.length / lines.length >= 0.4;
}

/**
 * The book as ordered sections for one set of heading candidates. Front and
 * back matter that survived the cleaners is dropped here: a section headed
 * "Contents" or "Index" anywhere, list-shaped text (a contents page, an index)
 * in the first tenth or the last fifth, and everything after the first
 * back-matter heading in the last fifth.
 */
function sectionsFrom(body, lines, candidates, vocab) {
  const marks = dropRepeats(
    expandMarks(candidates, lines)
      .map((mark) => ({ ...mark, title: cleanTitle(repairHeading(mark.title, vocab)) }))
      .filter((mark) => isRealHeading(mark.title)),
  );

  const sections = [];
  const push = (titles, from, to, lead = '') => {
    const bodyLines = [lead, ...lines.slice(from, to)].filter((line) => line.trim());
    sections.push({ titles, lines: bodyLines, sourceWords: countWords(bodyLines.join(' ')) });
  };

  // Text above the first heading (an unlabelled preface) is still the book.
  push([], 0, marks.length ? marks[0].lineIndex : lines.length);
  marks.forEach((mark, i) => {
    push([mark.title], mark.end + 1, i + 1 < marks.length ? marks[i + 1].lineIndex : lines.length, mark.rest);
  });

  const total = sections.reduce((sum, section) => sum + section.sourceWords, 0) || 1;
  const kept = [];
  let position = 0;
  for (const section of sections) {
    const start = position / total;
    position += section.sourceWords;

    const named = section.titles.some((title) => NOT_THE_BOOK.test(title));
    const listShaped = section.sourceWords >= SMALL_SECTION_WORDS && !isProse(section.lines);
    if (start >= 0.8 && (named || listShaped)) break;
    if (named) continue;
    if (listShaped && start < 0.1) continue;
    if (!section.titles.length && !section.sourceWords) continue;
    kept.push(section);
  }

  // A book so short or so unusual that everything was filtered is summarized
  // whole rather than not at all.
  return kept.length ? kept : [{ titles: [], lines: lines.filter((l) => l.trim()), sourceWords: countWords(body) }];
}

/**
 * Picks the heading set to summarize by. Three candidates: detectChapters
 * (what the sidebar shows), and the measured outline at its top level and at
 * its top two levels (what extraction saw set in large type). The chosen one is
 * the most detailed that still leaves every section a real paragraph or two;
 * a finer structure than that would only be merged back together.
 */
function buildSections(body, headingLevels, maxSections) {
  const lines = body.split('\n');
  const vocab = buildVocabulary(body);

  const chapters = detectChapters(body)
    .filter((chapter) => chapter.title !== 'Full Text')
    .map((chapter) => ({ lineIndex: chapter.lineIndex }));
  const outline = buildOutline(body, headingLevelMap(headingLevels)).filter((entry) => entry.kind === 'heading');
  const level = (max) =>
    outline.filter((entry) => (entry.level ?? 2) <= max).map((entry) => ({ lineIndex: entry.lineIndex }));

  const options = [chapters, level(1), level(2)].map((candidates) =>
    absorbSmall(sectionsFrom(body, lines, candidates, vocab)),
  );

  // Explicit "Chapter I" / "Part Two" markers are the strongest structure a
  // book has. When detectChapters found several, they win outright: the outline
  // can also contain pull quotes and epigraphs that extraction saw in large type.
  const explicit = options[0].filter((section) =>
    section.titles.some((title) => /^(chapter|part|book)\b/i.test(title)),
  ).length;
  if (explicit >= 3) return options[0];

  const fitting = options.filter((sections) => sections.length <= maxSections);
  if (fitting.length) return fitting.reduce((best, sections) => (sections.length > best.length ? sections : best));
  return options.reduce((best, sections) => (sections.length < best.length ? sections : best));
}

function join(a, b) {
  return {
    titles: [...a.titles, ...b.titles],
    context: [...(a.context || a.titles), ...(b.context || b.titles)],
    lines: [...a.lines, ...b.lines],
    sourceWords: a.sourceWords + b.sourceWords,
  };
}

/**
 * Folds every section too short to summarize on its own into the next one (the
 * last into the one before it). Headings stay in reading order, so a summary
 * opens "PART ONE" / "Chapter 1" exactly as the book does.
 */
function absorbSmall(sections) {
  const out = [];
  let carry = null;
  for (const section of sections) {
    const merged = carry ? join(carry, section) : section;
    if (merged.sourceWords < SMALL_SECTION_WORDS) carry = merged;
    else {
      out.push(merged);
      carry = null;
    }
  }
  if (carry) {
    if (out.length) out.push(join(out.pop(), carry));
    else out.push(carry);
  }
  return out;
}

/**
 * Merges the adjacent pair of sections with the fewest words between them. Both
 * headings are kept, in order, so nothing claims to cover less than it does.
 */
function mergeSmallestPair(sections) {
  let best = -1;
  for (let i = 0; i + 1 < sections.length; i += 1) {
    const words = sections[i].sourceWords + sections[i + 1].sourceWords;
    if (best < 0 || words < sections[best].sourceWords + sections[best + 1].sourceWords) best = i;
  }
  if (best < 0) return false;
  sections.splice(best, 2, join(sections[best], sections[best + 1]));
  return true;
}

/**
 * Splits `total` across `weights` in proportion, no share under `floor`, every
 * share rounded down — so the shares never add up to more than `total`.
 */
function allocate(weights, total, floor) {
  const fixed = new Set();
  for (;;) {
    const freeWeight = weights.reduce((sum, w, i) => (fixed.has(i) ? sum : sum + w), 0);
    const remaining = total - fixed.size * floor;
    const shares = weights.map((w, i) =>
      fixed.has(i) ? floor : freeWeight > 0 ? Math.floor((remaining * w) / freeWeight) : 0,
    );
    let changed = false;
    shares.forEach((share, i) => {
      if (!fixed.has(i) && share < floor) {
        fixed.add(i);
        changed = true;
      }
    });
    if (!changed) return shares;
  }
}

/** Cuts a run of lines into `count` pieces of roughly equal length, on line boundaries. */
function splitLines(lines, count) {
  if (count <= 1) return [lines];

  // A single enormous line (a text file with no line breaks at all) is broken
  // at sentences first, or it could never be split.
  const atoms = lines.flatMap((line) => (countWords(line) > 2000 ? splitSentences(line) : [line]));
  const total = countWords(atoms.join(' '));
  const size = total / count;

  const pieces = [];
  let current = [];
  let words = 0;
  for (const atom of atoms) {
    current.push(atom);
    words += countWords(atom);
    if (words >= size * (pieces.length + 1) && pieces.length < count - 1) {
      pieces.push(current);
      current = [];
    }
  }
  if (current.length) pieces.push(current);
  return pieces;
}

function wordsOf(text) {
  return countWords(text);
}

/** Words the intro and outro can take at most, for this title and author. */
function introOutroReserve(meta) {
  return (
    wordsOf(summaryIntroOpening(meta.title, meta.author)) +
    wordsOf(INTRO_CLOSER) +
    wordsOf(summaryOutroOpening(meta.title, meta.author)) +
    Object.values(INTRO_CAPS).reduce((sum, cap) => sum + cap, 0)
  );
}

/**
 * @param {string} text        the open book, exactly as the reader shows it
 * @param {object} options
 *   minutes, speed            the requested length and the narration speed
 *   structure                 'chapters' | 'continuous'
 *   filename, title, author   title/author override what is detected
 *   headingLevels             api.headingLevelsOf(book), for title-case headings
 *   limits                    the provider's { maxInputWords }
 */
function planSummary(text, options) {
  const minutes = Number(options.minutes);
  const speed = Number(options.speed) || 1;
  const structure = STRUCTURES.includes(options.structure) ? options.structure : 'chapters';
  const chapterMode = structure === 'chapters';
  const wpm = config.summaryWordsPerMinute;
  const maxInputWords = Math.max(1000, Number(options.limits?.maxInputWords) || 30000);

  const { meta: detected, body, certain } = prepareBook(text, options.filename);
  const meta = {
    title: cleanTitle(options.title) || detected.title,
    author: String(options.author ?? detected.author ?? '').trim(),
  };

  const bookWords = wordsOf(body);
  const targetWords = Math.floor(minutes * wpm * speed);
  const bookMinutes = Math.round(bookWords / (wpm * speed));

  if (bookWords < 200) {
    throw planError('NO_TEXT', 'There is not enough text in this book to summarize.');
  }
  if (targetWords < MIN_TARGET_WORDS) {
    throw planError(
      'SUMMARY_TOO_SHORT',
      `Pick at least ${Math.ceil(MIN_TARGET_WORDS / (wpm * speed))} minutes. Anything shorter is mostly introduction.`,
    );
  }
  if (targetWords > bookWords * MAX_SHARE) {
    const most = Math.floor((bookWords * MAX_SHARE) / (wpm * speed));
    throw planError(
      'SUMMARY_TOO_LONG',
      most >= 3
        ? `This book is only about ${bookMinutes} minutes long. Pick ${most} minutes or less for a summary.`
        : `This book is only about ${bookMinutes} minutes long, too short to summarize.`,
    );
  }

  const reserve = introOutroReserve(meta);
  // Sections of about 150 words each at the most; any finer and the sections
  // would only be merged back together to fit.
  const maxSections = Math.max(1, Math.floor((targetWords - reserve) / 150));

  let sections = buildSections(body, options.headingLevels, maxSections);
  if (!chapterMode) {
    // A continuous talk has no headings. The sections still set the proportions
    // and the order; they just are not announced.
    sections = sections.map((section) => ({ ...section, context: section.titles, titles: [] }));
  }

  const headingWords = sections.reduce(
    (sum, section) => sum + section.titles.reduce((acc, title) => acc + wordsOf(title), 0),
    0,
  );

  if (chapterMode && headingWords > (targetWords - reserve) * MAX_HEADING_SHARE) {
    const need = Math.ceil((headingWords / MAX_HEADING_SHARE + reserve) / (wpm * speed));
    throw planError(
      'SUMMARY_TOO_SHORT',
      `This book has ${sections.filter((s) => s.titles.length).length} headings. Pick at least ${need} minutes ` +
        'for a chapter-by-chapter summary, or use Continuous talk.',
    );
  }

  const bodyBudget = targetWords - reserve - headingWords;
  while (sections.length * MIN_SECTION_WORDS > bodyBudget && mergeSmallestPair(sections));

  const budgets = allocate(
    sections.map((section) => section.sourceWords),
    bodyBudget,
    MIN_SECTION_WORDS,
  );

  const planned = sections.map((section, index) => ({
    index,
    titles: section.titles,
    // What the model is told each passage is, even when nothing is announced.
    context: section.context || section.titles,
    sourceWords: section.sourceWords,
    budget: budgets[index],
    lines: section.lines,
    parts: 0,
  }));

  // Items: one per part of a section. A section is cut into parts when its
  // text is too long for one request, or its budget too long for one answer.
  const items = [];
  for (const section of planned) {
    const parts = Math.max(
      Math.ceil(section.sourceWords / maxInputWords),
      Math.ceil(section.budget / MAX_UNIT_BUDGET),
      1,
    );
    const pieces = splitLines(section.lines, parts);
    const partBudgets = allocate(
      pieces.map((piece) => wordsOf(piece.join(' '))),
      section.budget,
      Math.min(MIN_SECTION_WORDS, Math.floor(section.budget / pieces.length)),
    );
    section.parts = pieces.length;
    pieces.forEach((piece, part) => {
      items.push({
        section: section.index,
        part,
        parts: pieces.length,
        titles: section.titles,
        context: section.context,
        source: piece.join('\n'),
        sourceWords: wordsOf(piece.join(' ')),
        budget: partBudgets[part],
      });
    });
  }

  // Units: consecutive items batched into one request while they fit, which is
  // what keeps a book of sixty short chapters to a handful of calls.
  const units = [];
  let current = null;
  for (const item of items) {
    const fits =
      current &&
      current.sourceWords + item.sourceWords <= maxInputWords &&
      current.budget + item.budget <= MAX_UNIT_BUDGET &&
      current.items.length < MAX_UNIT_ITEMS;
    if (!fits) {
      current = { index: units.length, items: [], sourceWords: 0, budget: 0 };
      units.push(current);
    }
    current.items.push({ ...item, id: String(current.items.length + 1) });
    current.sourceWords += item.sourceWords;
    current.budget += item.budget;
  }

  return {
    meta,
    detected,
    titleCertain: certain,
    structure,
    minutes,
    speed,
    wordsPerMinute: wpm,
    bookWords,
    bookMinutes,
    targetWords,
    reserve,
    headingWords,
    bodyBudget,
    sections: planned,
    units,
    chapterTitles: planned.flatMap((section) => section.context),
    body,
  };
}

/** What the page is shown: the plan without the book text in it. */
function publicPlan(plan) {
  return {
    title: plan.meta.title,
    author: plan.meta.author,
    detectedTitle: plan.detected.title,
    detectedAuthor: plan.detected.author,
    titleCertain: plan.titleCertain,
    structure: plan.structure,
    minutes: plan.minutes,
    speed: plan.speed,
    wordsPerMinute: plan.wordsPerMinute,
    bookWords: plan.bookWords,
    bookMinutes: plan.bookMinutes,
    targetWords: plan.targetWords,
    sections: plan.sections.map((section) => ({
      // The source's headings, whether or not the summary announces them.
      titles: section.context,
      sourceWords: section.sourceWords,
      budget: section.budget,
      parts: section.parts,
    })),
    units: plan.units.length,
  };
}

export { INTRO_CAPS, STRUCTURES, planSummary, publicPlan, prepareBook };
