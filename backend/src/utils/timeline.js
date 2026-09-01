'use strict';

const PHRASE_BREAK = /(?<=[,;:.!?…])[ \t]+/;
const SENTENCE_BREAK = /(?<=[.!?…])[ \t]+/;

const SENTENCE_PAUSE_MS = 380;

const splitPhrases = (text) => text.split(PHRASE_BREAK).filter((p) => p.trim());
const splitSentencesOnly = (text) => text.split(SENTENCE_BREAK).filter((p) => p.trim());

function splitWords(text) {
  const trimmed = String(text || '').trim();
  return trimmed ? trimmed.split(/\s+/) : [];
}

function normaliseWord(word) {
  return String(word || '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9']/g, '');
}

function segmentChunk(text, pauses, chunkStart, speechSec) {
  const whole = [{ start: chunkStart, end: chunkStart + speechSec, text }];
  if (!speechSec) return whole;

  const attempts = [
    { parts: splitPhrases(text), gaps: pauses },
    {
      parts: splitSentencesOnly(text),
      gaps: pauses.filter((p) => p.durationMs >= SENTENCE_PAUSE_MS),
    },
  ];

  for (const { parts, gaps } of attempts) {
    if (parts.length < 2 || gaps.length !== parts.length - 1) continue;

    const segments = [];
    let from = 0;
    parts.forEach((part, i) => {
      const to = i < gaps.length ? gaps[i].start : speechSec;
      segments.push({ start: chunkStart + from, end: chunkStart + to, text: part });
      from = i < gaps.length ? gaps[i].end : to;
    });
    return segments;
  }

  return whole;
}

function alignToDisplay(displayWords, segments, window = 60, startWord = 0) {
  const normalised = displayWords.map(normaliseWord);
  const aligned = [];
  let cursor = startWord;

  const findFrom = (from, token) => {
    if (!token) return -1;
    const limit = Math.min(normalised.length, from + window);
    for (let i = from; i < limit; i += 1) {
      if (normalised[i] === token) return i;
    }
    return -1;
  };

  for (const segment of segments) {
    const tokens = splitWords(segment.text).map(normaliseWord).filter(Boolean);
    if (!tokens.length) continue;

    let first = -1;
    let last = -1;
    let position = cursor;

    for (const token of tokens) {
      const at = findFrom(position, token);
      if (at === -1) continue;
      if (first === -1) first = at;
      last = at;
      position = at + 1;
    }

    if (first === -1) {
      const previous = aligned[aligned.length - 1];
      first = previous ? previous.wordEnd : cursor;
      last = first;
    }

    aligned.push({
      s: Number(segment.start.toFixed(2)),
      e: Number(segment.end.toFixed(2)),
      a: first,
      b: Math.max(first + 1, last + 1),
    });
    cursor = last + 1;
  }

  return aligned;
}

function buildTimeline(displayText, chunks) {
  const displayWords = splitWords(displayText);
  const segments = [];
  let clock = 0;

  for (const chunk of chunks) {
    segments.push(...segmentChunk(chunk.text, chunk.pauses || [], clock, chunk.speechSec));
    clock += chunk.speechSec + (chunk.gapSec || 0);
  }

  return {
    words: displayWords.length,
    duration: Number(clock.toFixed(2)),
    segments: alignToDisplay(displayWords, segments),
  };
}

module.exports = {
  buildTimeline,
  segmentChunk,
  alignToDisplay,
  splitWords,
  normaliseWord,
};
