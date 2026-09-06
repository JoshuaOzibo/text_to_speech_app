import epub2 from 'epub2';
import { headingKey } from './docStructure.js';

const EPub = epub2.EPub || epub2.default || epub2;

const NAMED_ENTITIES = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  hellip: '...',
  mdash: '-',
  ndash: '-',
  lsquo: "'",
  rsquo: "'",
  ldquo: '"',
  rdquo: '"',
};

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? ' ');
}

/** Tags that close the current block without carrying any structure of their own. */
const BLOCK_TAGS = new Set(['p', 'div', 'section', 'blockquote', 'tr', 'td', 'th', 'article']);

/**
 * Turns a spine item's XHTML into the line shapes docStructure.js expects.
 *
 * EPUB is the one format where the structure is already explicit, so this is a
 * translation rather than a heuristic: <h1>-<h6> carry their own level, <li>
 * carries its marker, and <ol> carries its numbering. The old implementation
 * mapped </li> to a blank line and every other tag to a space, which threw all
 * three away and left detectChapters to re-infer headings from ALL-CAPS shape.
 */
function htmlToText(html, headingLevels) {
  const source = String(html || '')
    .replace(/<\s*(script|style|head)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    // The XML prolog, doctype and comments are not element tags, so the walker
    // below would not recognise them and would emit their innards as prose.
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<![^>]*>/g, '');

  const out = [];
  const listStack = [];

  let buffer = '';
  let headingLevel = 0;
  let marker = '';
  let lastKind = null;

  const separate = () => {
    if (out.length && out[out.length - 1] !== '') out.push('');
  };

  const flush = () => {
    const text = buffer.replace(/\s+/g, ' ').trim();
    buffer = '';

    if (!text) {
      marker = '';
      headingLevel = 0;
      return;
    }

    if (headingLevel) {
      separate();
      out.push(text);
      separate();
      const key = headingKey(text);
      if (key && !headingLevels.has(key)) headingLevels.set(key, Math.min(headingLevel, 3));
      lastKind = 'heading';
      headingLevel = 0;
      marker = '';
      return;
    }

    if (marker) {
      // Consecutive items stay adjacent so the reader groups them into one list.
      if (lastKind !== 'list') separate();
      out.push(`${marker} ${text}`);
      lastKind = 'list';
      marker = '';
      return;
    }

    separate();
    out.push(text);
    lastKind = 'paragraph';
  };

  // The trailing `<[^>]*>` is the catch-all: without it an unrecognised tag is
  // skipped a character at a time and its own text spills into the page.
  const pattern = /<\/?\s*([a-z][a-z0-9]*)[^>]*>|([^<]+)|<[^>]*>/gi;
  let match = pattern.exec(source);

  while (match !== null) {
    const [token, tag, text] = match;

    if (text !== undefined) {
      buffer += decodeEntities(text);
    } else if (tag !== undefined) {
      const name = tag.toLowerCase();
      const closing = /^<\s*\//.test(token);
      const heading = /^h([1-6])$/.exec(name);

      if (name === 'br') {
        buffer += ' ';
      } else if (heading) {
        flush();
        if (!closing) headingLevel = Number(heading[1]);
      } else if (name === 'ul' || name === 'ol') {
        flush();
        if (closing) listStack.pop();
        else listStack.push({ ordered: name === 'ol', counter: 0 });
      } else if (name === 'li') {
        flush();
        if (!closing) {
          const list = listStack[listStack.length - 1];
          if (list && list.ordered) {
            list.counter += 1;
            marker = `${list.counter}.`;
          } else {
            marker = '•';
          }
        }
      } else if (BLOCK_TAGS.has(name)) {
        flush();
      }
    }

    match = pattern.exec(source);
  }

  flush();

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function parseEPUB(filePath) {
  let book;
  try {
    book = await EPub.createAsync(filePath);
  } catch (err) {
    const error = new Error('This EPUB could not be opened. It may be corrupt or DRM protected.');
    error.code = 'EPUB_UNREADABLE';
    error.cause = err;
    throw error;
  }

  const sections = [];
  const headingLevels = new Map();

  for (const item of book.flow) {
    try {
      const raw = await book.getChapterRawAsync(item.id);
      const text = htmlToText(raw || '', headingLevels);
      if (!text) continue;
      const title = (item.title || '').trim();
      // The spine title and the section's own <h1> usually say the same thing,
      // and stacking them renders the chapter heading twice.
      if (!title || headingKey(text.split('\n', 1)[0]) === headingKey(title)) {
        sections.push(text);
        continue;
      }
      // A spine title is the chapter heading, so it ranks with one.
      const key = headingKey(title);
      if (key && !headingLevels.has(key)) headingLevels.set(key, 2);
      sections.push(`${title}\n\n${text}`);
    } catch {
    }
  }

  if (sections.length === 0) {
    const error = new Error('No readable text was found in this EPUB.');
    error.code = 'EPUB_NO_TEXT';
    throw error;
  }

  return { rawText: sections.join('\n\n'), pageCount: null, headingLevels };
}

export { parseEPUB };
