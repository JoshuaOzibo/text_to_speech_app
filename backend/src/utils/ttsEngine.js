'use strict';

const { config } = require('../config/env');
const { countWords, normaliseForSpeech } = require('./textCleaner');
const piper = require('./engines/piper');
const supertonic = require('./engines/supertonic');
const kokoro = require('./engines/kokoro');

/**
 * TTS front end.
 *
 * Dispatches to whichever engine owns the selected voice. Both engines expose
 * the same shape — `installed()`, `listVoices()`, `synthesize()` — so adding a
 * third means writing one file and adding it to ENGINES.
 *
 * Every voice carries an `engine` field, and ids are namespaced per engine, so
 * a voice id alone is enough to route a request.
 */

const ENGINES = { piper, supertonic, kokoro };

/** True when at least one engine can actually produce audio. */
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

/** Voices from every installed engine, grouped for display by `group`. */
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

/**
 * Words that end in a period without ending a sentence. Splitting after these
 * cuts "Mr. Smith" into two utterances and drops the natural liaison.
 */
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'rev', 'hon', 'st', 'sr', 'jr',
  'vs', 'etc', 'eg', 'ie', 'cf', 'al', 'fig', 'no', 'vol', 'ch', 'pp',
  'inc', 'ltd', 'co', 'corp', 'dept', 'est', 'approx', 'min', 'max',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
]);

const CHAPTER_HEADING =
  /^(chapter|part|book|section|prologue|epilogue|introduction|foreword|preface|afterword|conclusion)\b/i;

/** A short standalone line that opens a new chapter. */
function isChapterHeading(paragraph) {
  const trimmed = paragraph.trim();
  return trimmed.length >= 3 && trimmed.length <= 80 && CHAPTER_HEADING.test(trimmed);
}

/**
 * Split a paragraph into sentences.
 *
 * A bare `[.!?]` split breaks on "Mr.", "3.14" and "J. R. R.", so each candidate
 * boundary is checked: the token before it must not be an abbreviation or a
 * single initial, the split must not sit between two digits, and what follows
 * must look like the start of a new sentence.
 */
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

    // 3.14 — a period between digits is a decimal point, not a full stop.
    if (punctuation === '.' && /\d/.test(prevChar || '') && /\d/.test(nextChar || '')) continue;

    if (punctuation === '.') {
      const lastToken = (text.slice(start, match.index).match(/(\S+)$/) || [''])[0];
      const bare = lastToken.replace(/[^A-Za-z]/g, '').toLowerCase();
      // "Mr." and friends, plus single-letter initials such as "J. R. R."
      if (ABBREVIATIONS.has(bare)) continue;
      if (bare.length === 1) continue;
    }

    // A real sentence starts with a capital, a digit, or an opening quote.
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

/**
 * Every chunk is synthesised as its own utterance, so the last thing in it has
 * to read as an ending. A chunk that stops on a comma or a colon — which happens
 * whenever a heading or a mid-sentence clause lands on the boundary — makes the
 * engine trail off, and the silence appended after it turns into an audible
 * stall. A full stop tells the engine to finish the phrase properly.
 */
function ensureChunkEndsCleanly(chunk) {
  const trimmed = chunk.trim();
  if (!trimmed) return '';
  if (/[.!?]["'’”)\]]?$/.test(trimmed)) return trimmed;
  // Replace a dangling separator rather than stacking punctuation on it.
  return `${trimmed.replace(/[,;:]+$/, '')}.`;
}

/**
 * Split text into chunks of roughly `wordsPerChunk` words, never cutting a
 * sentence in half and never spanning a chapter boundary.
 *
 * Chunks are assembled out of whole sentences, so a boundary can only ever fall
 * where a sentence already ended — this is what stops a chunk from breaking at
 * "...accumulated," and leaving a one to two second hole before "and defended
 * without end". When a single sentence is longer than the budget it is kept
 * whole and overshoots; the alternative is a break the listener can hear.
 *
 * Returns `{ text, chapterIndex, endsChapter }[]`. `endsChapter` tells the
 * pipeline to leave a longer silence after that chunk, so listeners hear where
 * one chapter stops and the next begins.
 *
 * Every chunk's text is flattened to a single line by `normaliseForSpeech` —
 * internal newlines are what make Piper drop the first word of each paragraph.
 */
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
    // A heading closes the previous chapter so a gap can be inserted there.
    if (isChapterHeading(paragraph) && (chunks.length || current.length)) {
      closeChapter();
    }

    for (const sentence of splitSentences(paragraph)) {
      const words = countWords(sentence);
      if (wordCount + words > wordsPerChunk && current.length) flush();
      // Terminate here rather than in normaliseForSpeech: sentences are joined
      // with spaces into one line, so a heading with no punctuation would
      // otherwise run straight into the paragraph after it with no pause.
      current.push(/[.!?,;:]$/.test(sentence) ? sentence : `${sentence}.`);
      wordCount += words;
    }
  }

  flush();
  return chunks;
}

/**
 * Speak one chunk of text into a WAV file using the engine that owns the voice.
 *
 * `onSpawn` is only meaningful for process-based engines (Piper) — it hands the
 * child process to the caller so a cancel can kill it mid-chunk. In-process
 * engines take `isCancelled` instead and stop at the next safe point.
 */
async function generateChunkAudio(text, voiceId, speed, outputWavPath, onSpawn, isCancelled) {
  const voice = resolveVoice(voiceId);
  const engine = ENGINES[voice.engine];

  if (!engine) {
    const error = new Error(`Unknown TTS engine for voice "${voiceId}".`);
    error.code = 'UNKNOWN_ENGINE';
    throw error;
  }

  // Give the engine a throwaway token to warm up on, so the first real word is
  // never the one that gets clipped. wavProcessor trims the resulting lead
  // silence back off, leaving no trace of it in the merged audio.
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
  // Kept for callers that only care about Piper's presence.
  piperInstalled: piper.installed,
};
