/**
 * A layout-aware `pagerender` for pdf-parse.
 *
 * pdf-parse's own renderer (node_modules/pdf-parse/lib/pdf-parse.js:3-36) emits a
 * newline whenever the Y baseline changes and concatenates everything else:
 *
 *     if (lastY == item.transform[5] || !lastY) text += item.str;
 *     else text += '\n' + item.str;
 *
 * X position, advance width and font size are all ignored, so nothing survives
 * that says where a paragraph ended, which line was a heading, or where one word
 * stopped and the next began. This renderer reads all three off the geometry.
 *
 * The bundled pdf.js is v1.10.100 and its text items carry
 * `{ str, dir, width, height, transform, fontName }` (pdf.worker.js:17651-17722),
 * where transform[4]/[5] are device x/y and `height` is the rendered font size.
 *
 * Output shape is the contract in docStructure.js: a heading alone on its line, a
 * paragraph or list item as one flowed line, a blank line between blocks, and no
 * blank line between consecutive list items.
 */

import { LIST_MARKER, isHeadingLike, headingKey } from './docStructure.js';

/** Two items are on the same visual line when their baselines differ by less. */
const LINE_TOLERANCE_MAX = 3;
/** A gap wider than this share of the font size is a missing space. */
const SPACE_GAP_RATIO = 0.25;
/** A line needs this share of single-letter runs to be read as letter-spaced. */
const LETTER_SPACED_SHARE = 0.6;
/** ...and its gaps must fall into two classes at least this far apart. */
const LETTER_SPACED_MIN_JUMP = 0.2;
/** A single capital set this much larger than the body face is a drop cap. */
const DROP_CAP_SIZE_RATIO = 1.6;
/** An edge line this far from its neighbour is margin furniture, not text. */
const MARGIN_GAP_RATIO = 1.8;
/** Below this many lines a page has no margin worth judging. */
const MARGIN_MIN_LINES = 4;
/** A line this much larger than the body face is a heading. */
const HEADING_SIZE_RATIO = 1.15;
/** A first line indented this far past the column edge opens a paragraph. */
const INDENT_RATIO = 0.5;
/** A line stopping this far short of the column edge ended its paragraph. */
const SHORT_LINE_RATIO = 3;
/** Vertical leading this much larger than usual is a paragraph break. */
const PARA_GAP_RATIO = 1.35;
/** Centred headings must sit within this share of the column of its centre. */
const CENTRE_TOLERANCE_RATIO = 0.02;
/** A centred heading is short. A full-measure line that happens to sit
 *  symmetrically is an ordinary line of prose. */
const CENTRE_MAX_WIDTH_RATIO = 0.6;
/** Heading size relative to the body face, largest bucket first. */
const LEVEL_RATIOS = [1.5, 1.25];
/** An edge line repeating on this share of pages is a running head or footer. */
const RUNNING_HEAD_SHARE = 0.3;
const RUNNING_HEAD_MIN_PAGES = 3;
const RUNNING_HEAD_MAX_CHARS = 80;

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** The value carrying the most characters, which is the body face on a page. */
function modalByWeight(entries) {
  const weights = new Map();
  for (const { value, weight } of entries) {
    const key = Math.round(value * 2) / 2;
    weights.set(key, (weights.get(key) || 0) + weight);
  }
  let best = 0;
  let bestWeight = -1;
  for (const [key, weight] of weights) {
    if (weight > bestWeight) {
      best = key;
      bestWeight = weight;
    }
  }
  return best;
}

/**
 * The gap that separates two words on this line.
 *
 * Normally that is a fixed share of the font size. A letter-spaced display line
 * defeats that rule outright: tracking between the glyphs of one word is itself
 * wider than a body space, so every gap reads as a word break and
 * `L A W S  O F` arrives as six words that fixSingleLetterSpacing then welds
 * into `LAWSOFHUMANNATURE` — the word boundaries are gone before any repair
 * step can see them.
 *
 * The geometry still holds the answer, because the gaps on such a line fall
 * into two classes with an empty band between them, and the threshold belongs
 * in that band — the widest jump in the sorted gaps. The same reading fixes the
 * other layout that defeats a fixed ratio: a font that emits one item per glyph
 * gives gaps of roughly zero inside a word and one space width between words,
 * a band well below the fixed threshold rather than above it.
 *
 * Only lines that are mostly single letters are read this way; ordinary
 * word-level items keep the fixed ratio, which is already right for them.
 */
function wordGapFor(tokens, size) {
  const standard = SPACE_GAP_RATIO * (size || 10);
  if (tokens.length < 4) return standard;

  const singles = tokens.filter((token) => /^[A-Za-z]$/.test(token.str.trim())).length;
  if (singles / tokens.length < LETTER_SPACED_SHARE) return standard;

  const gaps = [];
  for (let i = 1; i < tokens.length; i += 1) {
    gaps.push(tokens[i].x - (tokens[i - 1].x + tokens[i - 1].w));
  }

  const sorted = gaps.sort((a, b) => a - b);
  let jump = 0;
  let split = standard;
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] - sorted[i - 1] > jump) {
      jump = sorted[i] - sorted[i - 1];
      split = (sorted[i] + sorted[i - 1]) / 2;
    }
  }

  if (jump >= LETTER_SPACED_MIN_JUMP * (size || 10)) return split;

  // One class of gap, so the line holds no word break at all — provided the
  // gap is wider than a space would be, which is what says it is tracking. A
  // uniform gap narrower than that is ordinary spacing and keeps the fixed rule.
  return sorted[0] > standard ? sorted[sorted.length - 1] + 1 : standard;
}

/** Turns pdf.js text items into visual lines, inserting the spaces it dropped. */
function groupIntoLines(items) {
  const tokens = items
    .filter((item) => typeof item.str === 'string' && item.str.length)
    .map((item) => ({
      str: item.str,
      x: item.transform[4],
      y: item.transform[5],
      w: item.width || 0,
      h: item.height || 0,
    }));

  if (!tokens.length) return [];

  const tolerance = Math.max(
    1,
    Math.min(LINE_TOLERANCE_MAX, 0.3 * median(tokens.map((t) => t.h).filter(Boolean))),
  );

  // Reading order: down the page, then left to right. PDF y grows upward.
  tokens.sort((a, b) => (Math.abs(a.y - b.y) <= tolerance ? a.x - b.x : b.y - a.y));

  const lines = [];
  let current = null;

  for (const token of tokens) {
    if (!current || Math.abs(token.y - current.y) > tolerance) {
      current = { y: token.y, tokens: [token] };
      lines.push(current);
      continue;
    }
    current.tokens.push(token);
  }

  return lines.map((line) => {
    line.tokens.sort((a, b) => a.x - b.x);

    // The face of the run carrying the most characters: a superscript footnote
    // marker must not make the line it hangs off look like small print.
    const size = modalByWeight(
      line.tokens.map((token) => ({ value: token.h, weight: token.str.trim().length })),
    );

    const wordGap = wordGapFor(line.tokens, size);

    let text = '';
    let right = null;

    for (const token of line.tokens) {
      if (text && right !== null) {
        const needsSpace = token.x - right > wordGap;
        if (needsSpace && !/\s$/.test(text) && !/^\s/.test(token.str)) text += ' ';
      }
      text += token.str;
      right = token.x + token.w;
    }

    return {
      text: text.replace(/\s+/g, ' ').trim(),
      x0: Math.min(...line.tokens.map((t) => t.x)),
      x1: Math.max(...line.tokens.map((t) => t.x + t.w)),
      y: line.y,
      size: size || median(line.tokens.map((t) => t.h)),
    };
  }).filter((line) => line.text.length);
}

/** Body face, column edges and normal leading for one page. */
function pageMetrics(lines) {
  const bodySize =
    modalByWeight(lines.map((line) => ({ value: line.size, weight: line.text.length }))) || 10;

  const body = lines.filter((line) => Math.abs(line.size - bodySize) <= 0.5);
  const measured = body.length ? body : lines;

  const columnLeft = Math.min(...measured.map((line) => line.x0));
  const columnRight = Math.max(...measured.map((line) => line.x1));

  const gaps = [];
  for (let i = 1; i < measured.length; i += 1) {
    const gap = measured[i - 1].y - measured[i].y;
    if (gap > 0 && gap < bodySize * 3) gaps.push(gap);
  }

  return {
    bodySize,
    columnLeft,
    columnRight,
    lineGap: median(gaps) || bodySize * 1.2,
  };
}

/**
 * Both margins have to be clear, not just the left one. Testing the centre
 * alone matches an ordinary first line of a paragraph: its indent shifts the
 * centre by about the tolerance, and every body paragraph on the page then
 * reports as a heading. Requiring the line to stop short of the right margin
 * as well is what separates a centred title from an indented first line.
 */
function isCentred(line, metrics) {
  const columnWidth = metrics.columnRight - metrics.columnLeft;
  if (columnWidth <= 0) return false;
  const centre = (line.x0 + line.x1) / 2;
  const columnCentre = (metrics.columnLeft + metrics.columnRight) / 2;
  return (
    line.x0 > metrics.columnLeft + metrics.bodySize &&
    metrics.columnRight - line.x1 > metrics.bodySize &&
    line.x1 - line.x0 < CENTRE_MAX_WIDTH_RATIO * columnWidth &&
    Math.abs(centre - columnCentre) < CENTRE_TOLERANCE_RATIO * columnWidth
  );
}

/**
 * The letters a drop cap can be when only the text is left to judge by, matching
 * removeFrontMatterAndMetadata. A standalone I or A is a real word.
 */
const DROP_CAP = /^[TYWP]$/;

/**
 * A large single capital standing at the head of a paragraph is a drop cap.
 *
 * The plain-text rule in removeFrontMatterAndMetadata can only trust T/Y/W/P,
 * because in text alone a lone `I` or `A` is a real word. Here the font size
 * settles it — a letter set well above the body face is display type whatever
 * letter it is — so the restriction is dropped and `I`f and `A`ll open their
 * paragraphs correctly instead of shedding their first letter.
 *
 * It has to be flush with the column edge, which is where a drop cap is always
 * set. Without that a large *centred* capital qualifies, and the standalone
 * roman numeral in `Chapter` / `I` / `The Coinage` is a large centred capital —
 * reading it as a drop cap would consume the chapter number that
 * reconstructChapterHeaders is later looking for.
 */
function isDropCapLine(line, metrics) {
  return (
    /^[A-Z]$/.test(line.text) &&
    line.size > metrics.bodySize * DROP_CAP_SIZE_RATIO &&
    line.x0 <= metrics.columnLeft + metrics.bodySize
  );
}

/**
 * The line the cap belongs to.
 *
 * A drop cap is not stacked above its paragraph, it is set *into* it: the cap
 * spans two or three lines and the text is inset to its right. Its baseline
 * therefore sits a line or two *below* the first line of the paragraph it
 * opens, and reading order — down the page — hands it over after that line has
 * already gone by. Prepending it to whatever comes next is what produced
 * `Ylife as best you can` while the real opening lost its `Y`.
 *
 * So the target is found by geometry instead: the topmost line that begins to
 * the right of the cap and falls inside the cap's own vertical span.
 */
function findDropCapTarget(lines, cap, metrics) {
  let best = null;

  for (const line of lines) {
    if (line === cap) continue;
    if (line.x0 < cap.x1 - metrics.bodySize * 0.5) continue;
    // Inset text starts beside the cap, not across the page from it.
    if (line.x0 > cap.x1 + metrics.bodySize * 2) continue;
    if (line.y < cap.y - metrics.bodySize * 0.3) continue;
    if (line.y > cap.y + cap.size) continue;
    if (!best || line.y > best.y) best = line;
  }

  return best;
}

/** Folds each drop cap into its paragraph, leaving unmatched ones in place. */
function attachDropCaps(lines, metrics) {
  const caps = lines.filter((line) => isDropCapLine(line, metrics));
  if (!caps.length) return lines;

  const consumed = new Set();
  const taken = new Set();

  for (const cap of caps) {
    const target = findDropCapTarget(lines, cap, metrics);
    if (!target || taken.has(target)) continue;
    target.text = cap.text + target.text;
    taken.add(target);
    consumed.add(cap);
  }

  return lines.filter((line) => !consumed.has(line));
}

/** A page number standing alone: digits, or the lower-case roman of front matter. */
const FOLIO = /^[([]?(?:\d{1,4}|[ivxlcdm]{1,8})[)\].]?$/;

/**
 * Drops the page furniture that repetition cannot catch.
 *
 * `stripRunningHeads` works by finding the same string on many pages, which a
 * folio never is — every page carries a different number. Left in, it is picked
 * up as the first or last block of the page and, because a bare numeral ends in
 * no punctuation, `mergeWrappedBlocks` then welds it onto the paragraph running
 * over the page break: `1 and so the pattern repeats itself`.
 *
 * Position is the only evidence available, so the test is positional: an edge
 * line separated from the text block by a margin, set no larger than the body
 * face. Stripping a leading or trailing number from a wider edge line covers
 * `12  The Laws of Human Nature`, whose residue then repeats like any other
 * running head.
 */
function dropMarginArtifacts(lines, metrics) {
  if (lines.length < MARGIN_MIN_LINES) return lines;

  const margin = metrics.lineGap * MARGIN_GAP_RATIO;
  const dropped = new Set();

  for (const [index, neighbour] of [[0, 1], [lines.length - 1, lines.length - 2]]) {
    const line = lines[index];
    const other = lines[neighbour];

    if (!line || !other) continue;
    if (Math.abs(other.y - line.y) < margin) continue;
    if (line.text.length > RUNNING_HEAD_MAX_CHARS) continue;
    // Display type is a chapter number, not a folio.
    if (line.size > metrics.bodySize * HEADING_SIZE_RATIO) continue;

    if (FOLIO.test(line.text)) {
      dropped.add(line);
      continue;
    }

    const stripped = line.text.replace(/^\d{1,4}\s+|\s+\d{1,4}$/, '').trim();
    if (stripped.length >= 3 && stripped !== line.text) line.text = stripped;
  }

  return dropped.size ? lines.filter((line) => !dropped.has(line)) : lines;
}

/**
 * Renders one page into the line shapes docStructure.js expects.
 * `collector` accumulates cross-page state: measured headings and the candidate
 * running heads that only repetition can identify.
 */
function renderLines(rawLines, collector) {
  const metrics = pageMetrics(rawLines);
  // Both passes are geometric, so they run before reading order flattens the
  // page into a list of lines and throws the positions away.
  const lines = dropMarginArtifacts(attachDropCaps(rawLines, metrics), metrics);
  const out = [];

  let buffer = '';
  let bufferKind = null;
  let previous = null;
  let pendingDropCap = '';

  const flush = () => {
    if (buffer) out.push(buffer);
    buffer = '';
  };

  const separate = () => {
    if (out.length && out[out.length - 1] !== '') out.push('');
  };

  for (const line of lines) {
    let text = line.text;

    if (pendingDropCap) {
      // Extraction pulls the large first letter onto its own line, and it is a
      // coin flip whether the next line reads "he study" or "The study".
      if (/^[a-z]/.test(text)) text = pendingDropCap + text;
      pendingDropCap = '';
    }

    const big = line.size > metrics.bodySize * HEADING_SIZE_RATIO;

    // A cap attachDropCaps could not place, because it stands above its
    // paragraph rather than beside it. Here there is no geometry left to go on,
    // so the letter set stays the conservative T/Y/W/P of
    // removeFrontMatterAndMetadata: this branch *discards* a cap the next line
    // does not continue, and a standalone I or A is a real word.
    if (big && DROP_CAP.test(text)) {
      pendingDropCap = text;
      continue;
    }

    const heading =
      text.length >= 3 &&
      text.length <= 80 &&
      (big || (isCentred(line, metrics) && !/[.!?;,]$/.test(text)));

    if (heading) {
      flush();
      separate();
      out.push(text);
      separate();
      collector.headings.push({ text, ratio: line.size / metrics.bodySize });
      bufferKind = 'heading';
      previous = line;
      continue;
    }

    const isListItem = LIST_MARKER.test(text);

    if (isListItem) {
      flush();
      // Consecutive items stay adjacent so the reader can group them into one
      // list; anything else is separated by a blank line.
      if (bufferKind !== 'list') separate();
      buffer = text;
      bufferKind = 'list';
      previous = line;
      continue;
    }

    // A wrapped list item hangs indented under its marker, so the indent test
    // has to be suppressed inside one or every continuation opens a paragraph.
    const indented =
      bufferKind !== 'list' && line.x0 > metrics.columnLeft + metrics.bodySize * INDENT_RATIO;
    const endedShort =
      previous !== null && previous.x1 < metrics.columnRight - metrics.bodySize * SHORT_LINE_RATIO;
    const bigGap = previous !== null && previous.y - line.y > metrics.lineGap * PARA_GAP_RATIO;

    if (!buffer || indented || endedShort || bigGap) {
      flush();
      separate();
      buffer = text;
      bufferKind = 'paragraph';
    } else if (/[a-z]-$/.test(buffer) && /^[a-z]/.test(text)) {
      buffer = buffer.slice(0, -1) + text;
    } else {
      buffer = `${buffer} ${text}`;
    }

    previous = line;
  }

  if (pendingDropCap) out.push(pendingDropCap);
  flush();

  if (lines.length) {
    for (const edge of [lines[0], lines[lines.length - 1]]) {
      if (edge.text.length <= RUNNING_HEAD_MAX_CHARS) {
        collector.edges.set(edge.text, (collector.edges.get(edge.text) || 0) + 1);
      }
    }
    collector.pages += 1;
  }

  return out.join('\n');
}

/** The default pdf-parse renderer, kept as the fallback for a page we cannot lay out. */
function renderFlat(items) {
  let lastY;
  let text = '';
  for (const item of items) {
    if (lastY === item.transform[5] || !lastY) text += item.str;
    else text += `\n${item.str}`;
    lastY = item.transform[5];
  }
  return text;
}

function createCollector() {
  return { headings: [], edges: new Map(), pages: 0 };
}

function createPageRenderer(collector) {
  return function renderPage(pageData) {
    return pageData
      .getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false })
      .then((content) => {
        try {
          const lines = groupIntoLines(content.items);
          if (!lines.length) return '';
          return renderLines(lines, collector);
        } catch {
          // A rotated or vertical page can defeat the geometry. Losing its
          // formatting is survivable; losing its words is not.
          return renderFlat(content.items);
        }
      });
  };
}

/**
 * Joins a block that stops mid-sentence onto the one after it.
 *
 * pdf-parse concatenates pages with a hardcoded '\n\n', so a paragraph running
 * across a page boundary always arrives as two blocks. The rule is the same one
 * joinBrokenLines uses and is safe anywhere: an unterminated block followed by a
 * lower-case one was never two paragraphs.
 *
 * `collector` supplies the headings extraction *measured*, which is the other
 * half of the refusal below. `isHeadingLike` can only see an ALL-CAPS line or an
 * explicit keyword, so a title-case subhead like `The Coinage of Attention`
 * looked joinable — and an epigraph or any paragraph opening on a quotation
 * mark matches the lower-case test, so the heading and the paragraph under it
 * came back as one line.
 */
function mergeWrappedBlocks(text, collector) {
  const measured = new Set(
    (collector?.headings || []).map((heading) => headingKey(heading.text)).filter(Boolean),
  );

  const blocks = String(text || '')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const out = [];

  for (const block of blocks) {
    const previous = out[out.length - 1];
    const joinable =
      previous &&
      !previous.includes('\n') &&
      !block.includes('\n') &&
      !LIST_MARKER.test(previous) &&
      !LIST_MARKER.test(block) &&
      // A heading never ends in a full stop, so without this the body under a
      // running head or a chapter title gets absorbed into it.
      !isHeadingLike(previous) &&
      !measured.has(headingKey(previous)) &&
      !/[.!?:;"')\]]$/.test(previous) &&
      /^[a-z(“‘"']/.test(block);

    if (!joinable) {
      out.push(block);
      continue;
    }

    out[out.length - 1] = /[a-z]-$/.test(previous)
      ? previous.slice(0, -1) + block
      : `${previous} ${block}`;
  }

  return out.join('\n\n');
}

/** Drops the running heads and footers that repetition has identified. */
function stripRunningHeads(text, collector) {
  const threshold = Math.max(RUNNING_HEAD_MIN_PAGES, collector.pages * RUNNING_HEAD_SHARE);
  const repeated = new Set();
  for (const [line, count] of collector.edges) {
    if (count >= threshold) repeated.add(line);
  }
  if (!repeated.size) return text;

  return String(text || '')
    .split('\n')
    .filter((line) => !repeated.has(line.trim()))
    .join('\n');
}

/**
 * Ranks the measured heading sizes into levels 1-3. Level cannot be recovered
 * from the text later, so this map is the one thing extraction has to hand
 * forward; docStructure.buildOutline falls back to 2 on a miss.
 */
function levelFromRatio(ratio) {
  if (ratio >= LEVEL_RATIOS[0]) return 1;
  if (ratio >= LEVEL_RATIOS[1]) return 2;
  return 3;
}

export {
  createCollector,
  createPageRenderer,
  mergeWrappedBlocks,
  stripRunningHeads,
  levelFromRatio,
};
