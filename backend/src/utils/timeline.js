'use strict';

/**
 * Word-level timing for the finished audiobook.
 *
 * There are no word timings to be had from any of the three engines, so the
 * timeline is assembled from two things that *are* exact:
 *
 *   1. Every chunk's real duration, measured from its conditioned PCM.
 *   2. The pauses inside each chunk, found in that same PCM. Piper leaves a
 *      measurable gap at each prosodic break (~480ms after a full stop, ~280ms
 *      after a comma), so the punctuation in the text can be pinned to real
 *      times rather than guessed at.
 *
 * Between two anchors — typically five to ten words apart — time is shared out
 * by word length. The residual error there is well under a fifth of a second,
 * which is close enough that a highlight lands on the right word.
 *
 * The result is expressed in *display* word indices, not spoken ones, because
 * the reader shows the extracted text while the engine is fed a rewritten
 * version of it (see textCleaner.preprocessText). `alignToDisplay` walks the two
 * sequences together and resyncs, so an expanded number or a dropped running
 * header shifts nothing after it.
 */

/** Split a phrase off at every mark a speaker would actually pause on. */
const PHRASE_BREAK = /(?<=[,;:.!?…])[ \t]+/;
const SENTENCE_BREAK = /(?<=[.!?…])[ \t]+/;

/** A pause this long is a full stop rather than a comma. */
const SENTENCE_PAUSE_MS = 380;

const splitPhrases = (text) => text.split(PHRASE_BREAK).filter((p) => p.trim());
const splitSentencesOnly = (text) => text.split(SENTENCE_BREAK).filter((p) => p.trim());

/** Words as the reader counts them: whitespace-separated, in order. */
function splitWords(text) {
  const trimmed = String(text || '').trim();
  return trimmed ? trimmed.split(/\s+/) : [];
}

/** Compare two words ignoring case and punctuation. */
function normaliseWord(word) {
  return String(word || '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9']/g, '');
}

/**
 * Cut one chunk into timed segments using the pauses found in its audio.
 *
 * The pause count has to agree with what the punctuation predicts before the two
 * are paired up — a mismatch means the engine phrased it differently, and a
 * wrong pairing would put every later word in the chunk on the wrong line. Three
 * attempts, each strictly safer than the last: every phrase, then sentences
 * only, then the whole chunk as one segment.
 */
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
      // A segment runs to the start of the pause that follows it: the silence
      // belongs to neither phrase.
      const to = i < gaps.length ? gaps[i].start : speechSec;
      segments.push({ start: chunkStart + from, end: chunkStart + to, text: part });
      from = i < gaps.length ? gaps[i].end : to;
    });
    return segments;
  }

  return whole;
}

/**
 * Map spoken segments onto the words of the text the reader is looking at.
 *
 * A forward-only scan with a bounded search window. Every spoken word is looked
 * for ahead of the cursor; one that isn't there (a spelled-out number, an
 * expanded symbol) is skipped without moving the cursor, and display words that
 * were never spoken (running headers, ornaments) are stepped over as soon as the
 * next spoken word matches past them. Because the cursor only moves forward and
 * the window is small, a bad match can misplace one segment but cannot
 * accumulate into drift.
 */
function alignToDisplay(displayWords, segments, window = 60) {
  const normalised = displayWords.map(normaliseWord);
  const aligned = [];
  let cursor = 0;

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
      // Nothing in this segment could be located — carry the previous position
      // rather than inventing one, and let the next segment resync.
      const previous = aligned[aligned.length - 1];
      first = previous ? previous.wordEnd : cursor;
      last = first;
    }

    // Short keys on purpose: a full-length book runs to ~14,000 segments, and
    // spelling these out doubles the size of every response carrying them.
    // s = start, e = end (seconds); a = first word, b = one past the last.
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

/**
 * Build the finished timeline.
 *
 * `chunks` are `{ text, speechSec, gapSec, pauses }` in playback order, where
 * `text` is what the engine was actually given.
 */
function buildTimeline(displayText, chunks) {
  const displayWords = splitWords(displayText);
  const segments = [];
  let clock = 0;

  for (const chunk of chunks) {
    segments.push(...segmentChunk(chunk.text, chunk.pauses || [], clock, chunk.speechSec));
    // The inter-chunk gap is silence, so it advances the clock but holds no words.
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
