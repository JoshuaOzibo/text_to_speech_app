'use strict';

const { config } = require('../config/env');
const { countWords, normaliseForSpeech } = require('./textCleaner');
const piper = require('./engines/piper');
const supertonic = require('./engines/supertonic');
const kokoro = require('./engines/kokoro');

const ENGINES = { piper, supertonic, kokoro };

function anyEngineInstalled() {
  return Object.values(ENGINES).some((engine) => engine.installed());
}

function engineStatus() {
  return {
    piper: piper.installed(),
    supertonic: supertonic.installed(),
    kokoro: kokoro.installed(),
  };
}

function listVoices() {
  return Object.values(ENGINES).flatMap((engine) => engine.listVoices());
}

function resolveVoice(voiceId) {
  const voice = listVoices().find((v) => v.id === voiceId);
  if (!voice) {
    const error = new Error(
      `Voice model not found: "${voiceId}". Download it using the link in README.md.`
    );
    error.code = 'VOICE_NOT_FOUND';
    throw error;
  }
  return voice;
}

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'rev', 'hon', 'st', 'sr', 'jr',
  'vs', 'etc', 'eg', 'ie', 'cf', 'al', 'fig', 'no', 'vol', 'ch', 'pp',
  'inc', 'ltd', 'co', 'corp', 'dept', 'est', 'approx', 'min', 'max',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
]);

const CHAPTER_HEADING =
  /^(chapter|part|book|section|prologue|epilogue|introduction|foreword|preface|afterword|conclusion)\b/i;

function isChapterHeading(paragraph) {
  const trimmed = paragraph.trim();
  return trimmed.length >= 3 && trimmed.length <= 80 && CHAPTER_HEADING.test(trimmed);
}

function splitSentences(text) {
  const sentences = [];
  const boundary = /([.!?]+)(["'’)\]]*)(\s+)/g;
  let start = 0;
  let match;

  while ((match = boundary.exec(text)) !== null) {
    const punctuation = match[1];
    const endIndex = match.index + punctuation.length + match[2].length;
    const nextChar = text[endIndex + match[3].length];
    const prevChar = text[match.index - 1];

    if (punctuation === '.' && /\d/.test(prevChar || '') && /\d/.test(nextChar || '')) continue;

    if (punctuation === '.') {
      const lastToken = (text.slice(start, match.index).match(/(\S+)$/) || [''])[0];
      const bare = lastToken.replace(/[^A-Za-z]/g, '').toLowerCase();
      if (ABBREVIATIONS.has(bare)) continue;
      if (bare.length === 1) continue;
    }

    if (nextChar && !/["'“‘(\[A-Z0-9]/.test(nextChar)) continue;

    const sentence = text.slice(start, endIndex).trim();
    if (sentence) sentences.push(sentence);
    start = endIndex + match[3].length;
    boundary.lastIndex = start;
  }

  const tail = text.slice(start).trim();
  if (tail) sentences.push(tail);
  return sentences;
}

function ensureChunkEndsCleanly(chunk) {
  const trimmed = chunk.trim();
  if (!trimmed) return '';
  if (/[.!?]["'’”)\]]?$/.test(trimmed)) return trimmed;
  return `${trimmed.replace(/[,;:]+$/, '')}.`;
}

function splitIntoChunks(text, wordsPerChunk = 300) {
  const paragraphs = String(text || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks = [];
  let current = [];
  let wordCount = 0;
  let chapterIndex = 0;

  const flush = () => {
    if (!current.length) return;
    const body = ensureChunkEndsCleanly(normaliseForSpeech(current.join('\n')));
    if (body) chunks.push({ text: body, chapterIndex, endsChapter: false });
    current = [];
    wordCount = 0;
  };

  const closeChapter = () => {
    flush();
    if (chunks.length) chunks[chunks.length - 1].endsChapter = true;
    chapterIndex += 1;
  };

  for (const paragraph of paragraphs) {
    if (isChapterHeading(paragraph) && (chunks.length || current.length)) {
      closeChapter();
    }

    for (const sentence of splitSentences(paragraph)) {
      const words = countWords(sentence);
      if (wordCount + words > wordsPerChunk && current.length) flush();
      current.push(/[.!?,;:]$/.test(sentence) ? sentence : `${sentence}.`);
      wordCount += words;
    }
  }

  flush();
  return chunks;
}

async function generateChunkAudio(text, voiceId, speed, outputWavPath, onSpawn, isCancelled) {
  const voice = resolveVoice(voiceId);
  const engine = ENGINES[voice.engine];

  if (!engine) {
    const error = new Error(`Unknown TTS engine for voice "${voiceId}".`);
    error.code = 'UNKNOWN_ENGINE';
    throw error;
  }

  const spoken = config.ttsWarmup ? `. ${normaliseForSpeech(text)}` : normaliseForSpeech(text);

  return engine.synthesize({
    text: spoken,
    voice,
    speed,
    outputPath: outputWavPath,
    onSpawn,
    isCancelled,
  });
}

module.exports = {
  anyEngineInstalled,
  engineStatus,
  listVoices,
  resolveVoice,
  splitIntoChunks,
  splitSentences,
  generateChunkAudio,
  piperInstalled: piper.installed,
};
