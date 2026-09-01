'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { config, paths } = require('../config/env');
const { preprocessText } = require('./textCleaner');
const { splitIntoChunks } = require('./ttsEngine');
const { alignToDisplay, splitWords } = require('./timeline');

let current = null;

function countWords(text) {
  return splitWords(text).length;
}

function locateChunks(displayWords, chunks) {
  const segments = chunks.map((chunk) => ({ start: 0, end: 0, text: chunk.text }));
  return alignToDisplay(displayWords, segments);
}

function splitLead(chunks) {
  if (!chunks.length || countWords(chunks[0].text) <= config.readLeadWords) return chunks;

  const first = chunks[0];
  const lead = splitIntoChunks(first.text, config.readLeadWords).map((piece) => ({
    ...piece,
    chapterIndex: first.chapterIndex,
    endsChapter: false,
  }));

  if (!lead.length) return chunks;
  lead[lead.length - 1].endsChapter = first.endsChapter;
  return [...lead, ...chunks.slice(1)];
}

function setPlan(text) {
  const source = String(text || '');
  const id = crypto.createHash('sha1').update(source).digest('hex').slice(0, 12);

  if (current && current.id === id) return current;

  const displayWords = splitWords(source);
  const chunks = splitLead(splitIntoChunks(preprocessText(source), config.readWordsPerChunk));
  const spans = locateChunks(displayWords, chunks);

  current = {
    id,
    displayWords,
    chunks: chunks.map((chunk, i) => ({
      i,
      text: chunk.text,
      chapterIndex: chunk.chapterIndex,
      endsChapter: chunk.endsChapter,
      words: countWords(chunk.text),
      a: spans[i] ? spans[i].a : 0,
      b: spans[i] ? spans[i].b : 0,
    })),
  };

  discardOtherCaches(id);
  return current;
}

function getPlan(id) {
  return current && current.id === id ? current : null;
}

function discardOtherCaches(keepId) {
  if (!fs.existsSync(paths.read)) return;
  for (const entry of fs.readdirSync(paths.read)) {
    if (entry === keepId) continue;
    try {
      fs.rmSync(path.join(paths.read, entry), { recursive: true, force: true });
    } catch {
    }
  }
}

function publicPlan(plan) {
  return {
    id: plan.id,
    totalChunks: plan.chunks.length,
    totalWords: plan.displayWords.length,
    chunks: plan.chunks.map(({ i, words, chapterIndex, endsChapter, a, b }) => ({
      i,
      words,
      chapterIndex,
      endsChapter,
      a,
      b,
    })),
  };
}

module.exports = { setPlan, getPlan, publicPlan, discardOtherCaches };
