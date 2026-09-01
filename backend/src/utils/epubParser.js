'use strict';

const epub2 = require('epub2');

const EPub = epub2.EPub || epub2.default || epub2;

function htmlToText(html) {
  return html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(br|hr)\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|h[1-6]|li|tr|section|blockquote)\s*>/gi, '\n\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
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

  for (const item of book.flow) {
    try {
      const raw = await book.getChapterRawAsync(item.id);
      const text = htmlToText(raw || '');
      if (!text) continue;
      const title = (item.title || '').trim();
      sections.push(title ? `${title}\n\n${text}` : text);
    } catch {
    }
  }

  if (sections.length === 0) {
    const error = new Error('No readable text was found in this EPUB.');
    error.code = 'EPUB_NO_TEXT';
    throw error;
  }

  return { rawText: sections.join('\n\n'), pageCount: null };
}

module.exports = { parseEPUB };
