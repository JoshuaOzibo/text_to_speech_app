/**
 * The shared line-shape rules for extracted book text.
 *
 * Structure is carried by the *shape* of the lines in `book.text`, never by a
 * parallel copy of the words: a heading sits alone on its line, a paragraph is
 * one flowed line, a list item is one flowed line that opens with its marker,
 * and a blank line separates blocks. `pdfLayout` and `epubParser` emit those
 * shapes; `buildOutline` reads them back off the final text.
 *
 * Reading structure back rather than carrying it alongside is what lets an
 * edited book keep its formatting — `POST /api/book/rescan` re-derives the
 * outline from whatever the user saved, exactly as it re-derives chapters.
 *
 * `isHeadingLike` deliberately mirrors the test inside `detectChapters`
 * (textCleaner.js). If the two ever disagree, a line renders as a heading that
 * the chapter list does not know about, or the reverse.
 */

/** Bullet or ordinal opening a list item. Mirrors LIST_START in BookEditor.tsx. */
const LIST_MARKER = /^([•·●○▪◦‣*–—-][ \t]+|\(?\d{1,3}[.)][ \t]+|\(?[a-z][.)][ \t]+)/;

const HEADING_WORD =
  /^(chapter|part|book|section|prologue|epilogue|introduction|foreword|preface|afterword|conclusion)\b/i;

function isHeadingLike(line) {
  const trimmed = String(line || '').trim();
  if (trimmed.length < 3 || trimmed.length > 80) return false;
  if (/[.,;:]$/.test(trimmed)) return false;
  if (!/[A-Za-z]/.test(trimmed)) return false;
  if (HEADING_WORD.test(trimmed)) return true;
  return trimmed === trimmed.toUpperCase() && trimmed.split(/\s+/).length <= 12;
}

/** 'blank' | 'heading' | 'list' | 'paragraph' */
function classifyLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return 'blank';
  // A marker wins over the heading test: "1. Introduction" is a list item, not
  // a chapter, and detectChapters would not have claimed it either.
  if (LIST_MARKER.test(trimmed)) return 'list';
  if (isHeadingLike(trimmed)) return 'heading';
  return 'paragraph';
}

/** An ordered marker opens with a digit or a letter; a bullet is a glyph. */
function isOrderedMarker(marker) {
  return /[0-9a-z]/i.test(marker);
}

/** Lookup key for the heading-level map: case and punctuation insensitive. */
function headingKey(line) {
  return String(line || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Walks the final text and reports the structural lines in it.
 *
 * `headingLevels` is an optional Map from `headingKey(line)` to a heading level
 * (1-3) measured during extraction. Levels cannot be recovered from plain text,
 * so a miss falls back to 2 — a rescanned book keeps its headings, it just
 * renders them all at chapter level.
 *
 * A measured heading also *overrides* the shape test, because the shape test can
 * only see what detectChapters can see: an ALL-CAPS line or an explicit keyword.
 * A title-case subhead like "The Coinage" fails both, but extraction saw it set
 * two points larger than the body face and knows perfectly well what it is.
 */
function buildOutline(text, headingLevels) {
  const levels = headingLevels instanceof Map ? headingLevels : new Map();
  const lines = String(text || '').split('\n');
  const outline = [];

  lines.forEach((line, lineIndex) => {
    const kind = classifyLine(line);
    if (kind === 'blank') return;

    const measured = kind === 'list' ? undefined : levels.get(headingKey(line));

    if (kind === 'heading' || measured !== undefined) {
      outline.push({ lineIndex, kind: 'heading', level: measured ?? 2 });
      return;
    }

    if (kind === 'list') {
      const marker = line.trim().match(LIST_MARKER)[0].trim();
      outline.push({ lineIndex, kind, marker, ordered: isOrderedMarker(marker) });
    }
  });

  return outline;
}

export { LIST_MARKER, isHeadingLike, classifyLine, isOrderedMarker, headingKey, buildOutline };
