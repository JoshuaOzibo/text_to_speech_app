const PHRASE_BREAK = /(?<=[,;:.!?…])[ \t]+/;

const SENTENCE_PAUSE_MS = 380;
const MATCH_TOLERANCE_SEC = 2;
const SKIP_COST_SEC = 0.9;
const TYPE_PENALTY_SEC = 0.35;

const splitPhrases = (text) => text.split(PHRASE_BREAK).filter((p) => p.trim());

function wordWeight(word) {
  return String(word || '').length + 1;
}

function phraseBreaks(text) {
  const parts = splitPhrases(text);
  const breaks = [];
  let words = 0;

  for (let i = 0; i < parts.length - 1; i += 1) {
    words += splitWords(parts[i]).length;
    breaks.push({ wordIndex: words, endsSentence: /[.!?…]["')\]]?$/.test(parts[i].trim()) });
  }
  return breaks;
}

function expectedTimes(words, breaks, speechSec) {
  const cumulative = [];
  let acc = 0;
  for (const word of words) {
    acc += wordWeight(word);
    cumulative.push(acc);
  }
  const total = acc || 1;
  return breaks.map((entry) => (speechSec * (cumulative[entry.wordIndex - 1] ?? 0)) / total);
}

function alignPauses(breaks, pauses, expected) {
  const m = breaks.length;
  const n = pauses.length;
  if (!m || !n) return [];

  const cost = Array.from({ length: m + 1 }, () => new Float64Array(n + 1).fill(Infinity));
  const move = Array.from({ length: m + 1 }, () => new Int8Array(n + 1));
  cost[0][0] = 0;

  for (let i = 0; i <= m; i += 1) {
    for (let j = 0; j <= n; j += 1) {
      const here = cost[i][j];
      if (here === Infinity) continue;

      if (i < m && here + SKIP_COST_SEC < cost[i + 1][j]) {
        cost[i + 1][j] = here + SKIP_COST_SEC;
        move[i + 1][j] = 1;
      }
      if (j < n && here + SKIP_COST_SEC < cost[i][j + 1]) {
        cost[i][j + 1] = here + SKIP_COST_SEC;
        move[i][j + 1] = 2;
      }
      if (i < m && j < n) {
        const delta = Math.abs(pauses[j].start - expected[i]);
        if (delta <= MATCH_TOLERANCE_SEC) {
          const long = pauses[j].durationMs >= SENTENCE_PAUSE_MS;
          const penalty = breaks[i].endsSentence === long ? 0 : TYPE_PENALTY_SEC;
          const total = here + delta + penalty;
          if (total < cost[i + 1][j + 1]) {
            cost[i + 1][j + 1] = total;
            move[i + 1][j + 1] = 3;
          }
        }
      }
    }
  }

  const pairs = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    const step = move[i][j];
    if (step === 3) {
      pairs.push({ breakIndex: i - 1, pauseIndex: j - 1 });
      i -= 1;
      j -= 1;
    } else if (step === 1) {
      i -= 1;
    } else if (step === 2) {
      j -= 1;
    } else {
      break;
    }
  }

  return pairs.reverse();
}

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

  const words = splitWords(text);
  const breaks = phraseBreaks(text);
  if (!breaks.length || !pauses.length || !words.length) return whole;

  const pairs =
    breaks.length === pauses.length
      ? breaks.map((entry, index) => ({ breakIndex: index, pauseIndex: index }))
      : alignPauses(breaks, pauses, expectedTimes(words, breaks, speechSec));

  if (!pairs.length) return whole;

  const segments = [];
  let fromWord = 0;
  let fromTime = 0;

  for (const { breakIndex, pauseIndex } of pairs) {
    const toWord = breaks[breakIndex].wordIndex;
    const pause = pauses[pauseIndex];
    if (toWord <= fromWord || pause.start <= fromTime) continue;

    segments.push({
      start: chunkStart + fromTime,
      end: chunkStart + pause.start,
      text: words.slice(fromWord, toWord).join(' '),
    });
    fromWord = toWord;
    fromTime = pause.end;
  }

  if (fromWord < words.length && speechSec > fromTime) {
    segments.push({
      start: chunkStart + fromTime,
      end: chunkStart + speechSec,
      text: words.slice(fromWord).join(' '),
    });
  }

  return segments.length ? segments : whole;
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

export {
  buildTimeline,
  segmentChunk,
  alignToDisplay,
  splitWords,
  normaliseWord,
  wordWeight,
  phraseBreaks,
  alignPauses,
  expectedTimes,
};
