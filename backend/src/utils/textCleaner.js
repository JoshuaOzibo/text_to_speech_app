'use strict';

const {
  KNOWN_ACRONYMS,
  isKnownWord,
  isRomanNumeral,
  romanToInt,
} = require('./lexicon');

const BODY_LINE_CHARS = 70;

function buildVocabulary(text) {
  const vocab = new Set();

  for (const line of String(text || '').split('\n')) {
    if (line.length < BODY_LINE_CHARS) continue;
    const tokens = line.match(/[A-Za-z][A-Za-z'’-]*/g) || [];
    for (const token of tokens) {
      const word = token
        .toLowerCase()
        .replace(/[‘’]/g, "'")
        .replace(/'s$/, '')
        .replace(/[^a-z'-]/g, '');
      if (word.length >= 2) vocab.add(word);
      for (const part of word.split('-')) {
        if (part.length >= 2) vocab.add(part);
      }
    }
  }

  return vocab;
}

const MAX_WORD_LEN = 18;
const MIN_SEGMENTABLE = 8;
const MAX_SEGMENTABLE = 60;

function segmentFusedWord(word, vocab, allowUnknown = false) {
  const n = word.length;
  if (n < MIN_SEGMENTABLE || n > MAX_SEGMENTABLE) return null;

  const lower = word.toLowerCase();
  const best = new Array(n + 1).fill(-Infinity);
  const from = new Array(n + 1).fill(-1);
  const wasKnown = new Array(n + 1).fill(false);
  best[0] = 0;

  for (let i = 1; i <= n; i += 1) {
    for (let j = Math.max(0, i - MAX_WORD_LEN); j < i; j += 1) {
      if (best[j] === -Infinity) continue;

      const piece = lower.slice(j, i);
      const known = isKnownWord(piece, vocab);
      let score;

      if (known) {
        if (piece.length === 1 && piece !== 'a' && piece !== 'i') continue;
        score = piece.length === 1 ? 0.5 : piece.length * piece.length;
      } else if (allowUnknown && piece.length >= 3) {
        score = -piece.length;
      } else {
        continue;
      }

      if (best[j] + score > best[i]) {
        best[i] = best[j] + score;
        from[i] = j;
        wasKnown[i] = known;
      }
    }
  }

  if (best[n] === -Infinity) return null;

  const parts = [];
  let unknownParts = 0;
  for (let i = n; i > 0; i = from[i]) {
    parts.unshift(word.slice(from[i], i));
    if (!wasKnown[i]) unknownParts += 1;
  }

  if (parts.length < 2) return null;
  const meanLength = n / parts.length;
  if (allowUnknown && (unknownParts > 1 || meanLength < 3.5)) return null;
  if (meanLength < 2.8) return null;

  return parts;
}

function resegment(joined, vocab) {
  if (!joined) return [];

  const parts = joined.split(/(?<=[a-z'’])(?=[A-Z])|(?<=[.,;:!?])(?=[A-Za-z])/);

  return parts.flatMap((part) => {
    if (!/^[A-Za-z]+$/.test(part)) return [part];
    if (part.length < MIN_SEGMENTABLE) return [part];
    if (isKnownWord(part, vocab)) return [part];

    const isCaps = part === part.toUpperCase();
    return (
      segmentFusedWord(part, vocab, false) ||
      (isCaps ? segmentFusedWord(part, vocab, true) : null) || [part]
    );
  });
}

const MAX_BROKEN_LINE = 70;
const FRAGMENT_CHARS = 3;
const MAX_FRAGMENT_MEAN = 4;

function lineTokens(line) {
  return line
    .trim()
    .split(/\s+/)
    .map((raw) => ({ raw, letters: raw.replace(/[^A-Za-z]/g, '') }))
    .filter((token) => token.letters.length > 0);
}

function isBrokenLine(line, vocab) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > MAX_BROKEN_LINE) return false;

  const tokens = lineTokens(trimmed);
  if (tokens.length < 3) return false;

  let letters = 0;
  let unknown = 0;
  let fragments = 0;

  for (const token of tokens) {
    letters += token.letters.length;
    if (isKnownWord(token.raw, vocab)) continue;
    unknown += 1;
    if (token.letters.length <= FRAGMENT_CHARS) fragments += 1;
  }

  if (letters / tokens.length > MAX_FRAGMENT_MEAN) return false;
  if (fragments < 2) return false;
  return unknown / tokens.length >= 0.5;
}

function toTitleCase(text) {
  return text.replace(/[A-Za-z][A-Za-z'’]*/g, (word) => {
    const upper = word.toUpperCase();
    if (KNOWN_ACRONYMS.has(upper) || (word === upper && isRomanNumeral(word))) return word;
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}

function repairBrokenLine(line, vocab, titleCase) {
  const words = line
    .trim()
    .split(/\s{2,}/)
    .flatMap((group) => resegment(group.replace(/\s+/g, ''), vocab));

  const repaired = words.filter(Boolean).join(' ');
  return titleCase ? toTitleCase(repaired) : repaired;
}

function mapLines(text, fn) {
  return String(text || '')
    .split('\n')
    .map(fn)
    .join('\n');
}

function removeDecorations(text) {
  return String(text || '')
    .replace(/[◆◇●○■□▪▫►▶◄◀★☆✦✧✩❖•·∙‣⁃❯❮»«]+/g, ' ')
    .replace(/[\u200b-\u200f\u2028\u2029\ufeff\ue000-\uf8ff]/g, '')
    .replace(/^[ \t]*[-–—_=*~+#|.·:;'"]{2,}[ \t]*$/gm, '')
    .replace(/^[ \t]*[-–—_=*~+#|·]{1}[ \t]*$/gm, '')
    .replace(/[ \t]*(?:\.[ \t]*){4,}/g, ' ');
}

function fixSingleLetterSpacing(text) {
  return String(text || '').replace(
    /(?<![A-Za-z])(?:[A-Za-z][ \t]){3,}[A-Za-z](?![A-Za-z])/g,
    (match) => match.replace(/[ \t]/g, '')
  );
}

function fixMixedLetterSpacing(text, vocab, titleCase = true) {
  const words = vocab || buildVocabulary(text);
  return mapLines(text, (line) => {
    if (!/[A-Z]/.test(line)) return line;
    const letters = line.replace(/[^A-Za-z]/g, '');
    if (!letters || letters !== letters.toUpperCase()) return line;
    if (!isBrokenLine(line, words)) return line;
    return repairBrokenLine(line, words, titleCase);
  });
}

function fixMixedCaseLetterSpacing(text, vocab) {
  const words = vocab || buildVocabulary(text);
  return mapLines(text, (line) => {
    if (!isBrokenLine(line, words)) return line;
    return repairBrokenLine(line, words, false);
  });
}

function fixLetterSpacing(text, vocab) {
  const words = vocab || buildVocabulary(text);
  let out = fixSingleLetterSpacing(text);
  out = fixMixedLetterSpacing(out, words, false);
  out = fixMixedCaseLetterSpacing(out, words);
  return out;
}

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const TENS = [
  '', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
];

function twoDigitsToWords(n) {
  if (n < 20) return ONES[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return ones === 0 ? TENS[tens] : `${TENS[tens]}-${ONES[ones]}`;
}

function numeralToWord(token) {
  const digits = /^\d+$/.test(token) ? Number(token) : romanToInt(token);
  if (!digits || digits > 99) return null;
  const word = twoDigitsToWords(digits);
  return word.charAt(0).toUpperCase() + word.slice(1);
}

const HEADING_WORD = /^(chapter|part|book|section|volume|canto)$/i;
const NUMERAL_LINE = /^([IVXLCivxlc]+|\d{1,3})[.:)]?$/;

function isTitleLine(line, maxChars = 80) {
  const trimmed = line.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= maxChars &&
    /[A-Za-z]/.test(trimmed) &&
    !/[.!?]$/.test(trimmed)
  );
}

function reconstructChapterHeaders(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (!HEADING_WORD.test(line)) {
      out.push(lines[i]);
      i += 1;
      continue;
    }

    let j = i + 1;
    if (j < lines.length && lines[j].trim() === '') j += 1;
    const numeralLine = j < lines.length ? lines[j].trim() : '';
    const numeral = NUMERAL_LINE.test(numeralLine)
      ? numeralToWord(numeralLine.replace(/[.:)]$/, ''))
      : null;

    if (!numeral) {
      out.push(lines[i]);
      i += 1;
      continue;
    }

    let k = j + 1;
    if (k < lines.length && lines[k].trim() === '') k += 1;
    const titleLine = k < lines.length ? lines[k].trim() : '';
    const heading = `${line.charAt(0).toUpperCase()}${line.slice(1).toLowerCase()} ${numeral}`;

    if (isTitleLine(titleLine)) {
      out.push(`${heading}. ${titleLine.replace(/[,;:]$/, '')}.`);
      i = k + 1;
    } else {
      out.push(heading);
      i = j + 1;
    }
  }

  return out.join('\n');
}

function reconstructPartHeaders(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    const match = /^(Part|Book|Volume|Section|Chapter|Canto)[ \t]+([A-Za-z0-9]+)[.:]?$/i.exec(line);

    if (!match) {
      out.push(lines[i]);
      i += 1;
      continue;
    }

    const label = `${match[1].charAt(0).toUpperCase()}${match[1].slice(1).toLowerCase()}`;
    const numeral = numeralToWord(match[2]) || match[2];
    const pieces = [];
    let j = i + 1;

    while (j < lines.length && pieces.length < 2 && isTitleLine(lines[j], 50)) {
      pieces.push(lines[j].trim());
      j += 1;
    }

    out.push(pieces.length ? `${label} ${numeral}. ${pieces.join(' ')}.` : `${label} ${numeral}`);
    i = j;
  }

  return out.join('\n');
}

function removeOrphanNumerals(text) {
  return String(text || '')
    .replace(/^[ \t]*\d{1,4}[ \t]*$/gm, '')
    .replace(/^[ \t]*[IVXLCDM]{1,6}[.:)]?[ \t]*$/gm, '');
}

function removeFusedHeaders(text) {
  const vocab = buildVocabulary(text);
  const lines = String(text || '').split('\n');

  const counts = new Map();
  const firstSeen = new Map();
  let bodyLines = 0;

  lines.forEach((line, index) => {
    const key = line.trim();
    if (!key) return;
    bodyLines += 1;
    if (key.length > 60) return;
    counts.set(key, (counts.get(key) || 0) + 1);
    if (!firstSeen.has(key)) firstSeen.set(key, index);
  });

  const runningHeaderMin = Math.max(5, Math.floor(bodyLines / 60));

  return lines
    .map((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      const fused =
        /^[A-Za-z]{8,}$/.test(trimmed) &&
        /[a-z][A-Z]/.test(trimmed) &&
        !isKnownWord(trimmed, vocab);

      const repeated =
        (counts.get(trimmed) || 0) >= runningHeaderMin &&
        firstSeen.get(trimmed) !== index &&
        !/[.!?]$/.test(trimmed);

      return fused || repeated ? '' : line;
    })
    .join('\n');
}

function splitFusedWords(text, vocab) {
  const words = vocab || buildVocabulary(text);
  return String(text || '').replace(/[A-Za-z][A-Za-z'’]*/g, (token) => {
    if (!/[a-z][A-Z]/.test(token)) return token;
    if (isKnownWord(token, words)) return token;
    return token.replace(/([a-z])([A-Z])/g, '$1 $2');
  });
}

function fixPunctuationSpacing(text) {
  return mapLines(text, (line) => {
    if (!line.trim()) return line;

    let out = line
      .replace(/([A-Za-z])[ \t]*['’][ \t]*(s|t|d|m|re|ve|ll)\b/gi, "$1'$2")
      .replace(/[ \t]+([,;:.!?])/g, '$1')
      .replace(/([,;:])(?=[A-Za-z])/g, '$1 ')
      .replace(/\([ \t]+/g, '(')
      .replace(/[ \t]+\)/g, ')')
      .replace(/([“‘])[ \t]+/g, '$1')
      .replace(/[ \t]+([”’])/g, '$1');

    const headingLike = out.trim().length <= 60 && !/[.!?]$/.test(out.trim());

    out = out.replace(/\b([A-Za-z]+)[ \t]+-[ \t]+([A-Za-z]+)\b/g, (match, left, right) => {
      const compound = headingLike && /^[A-Z]/.test(left) && /^[A-Z]/.test(right);
      return compound ? `${left}-${right}` : `${left}, ${right}`;
    });

    return out;
  });
}

function joinBrokenLines(text) {
  const lines = String(text || '').split('\n');
  const out = [];

  for (const raw of lines) {
    const line = raw.trim();

    if (!line) {
      if (out.length && out[out.length - 1] !== '') out.push('');
      continue;
    }

    const previous = out.length ? out[out.length - 1] : '';

    if (previous) {
      if (/[a-z]-$/.test(previous) && /^[a-z]/.test(line)) {
        out[out.length - 1] = previous.slice(0, -1) + line;
        continue;
      }
      const finished = /[.!?:;]$/.test(previous);
      if (!finished && /^[a-z(“‘"']/.test(line)) {
        out[out.length - 1] = `${previous} ${line}`;
        continue;
      }
    }

    out.push(line);
  }

  return out.join('\n');
}

function isCalloutLabel(line) {
  const trimmed = line.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= 40 &&
    /^[A-Z]/.test(trimmed) &&
    !/[.!?,;:]$/.test(trimmed) &&
    trimmed.split(/\s+/).length <= 4
  );
}

function fixPracticeSections(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (!isCalloutLabel(line)) {
      out.push(lines[i]);
      i += 1;
      continue;
    }

    const body = [];
    let j = i + 1;
    while (j < lines.length && lines[j].trim()) {
      body.push(lines[j].trim());
      j += 1;
    }

    if (body.length < 2) {
      out.push(lines[i]);
      i += 1;
      continue;
    }

    out.push(`${line}.`);
    out.push(body.join(' '));
    i = j;
  }

  return out.join('\n');
}

function fixAllCaps(text) {
  return String(text || '').replace(/\b[A-Z][A-Z'’]*(?:[ \t]+[A-Z][A-Z'’]*)*\b/g, (match) => {
    const words = match.split(/[ \t]+/);

    if (words.length === 1) {
      const bare = words[0].replace(/['’]S$/, '');
      if (bare.length < 2) return match;
      if (KNOWN_ACRONYMS.has(bare) || isRomanNumeral(bare)) return match;
      return words[0].toLowerCase().replace(/^[a-z]/, (c) => c.toUpperCase());
    }

    return words
      .map((word, i) => {
        const bare = word.replace(/['’]S$/, '');
        if (KNOWN_ACRONYMS.has(bare) || isRomanNumeral(bare)) return word;
        const lower = word.toLowerCase();
        return i === 0 ? lower.replace(/^[a-z]/, (c) => c.toUpperCase()) : lower;
      })
      .join(' ');
  });
}

const ORDINAL_WORDS = {
  1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', 6: 'sixth',
  7: 'seventh', 8: 'eighth', 9: 'ninth', 10: 'tenth', 11: 'eleventh',
  12: 'twelfth', 13: 'thirteenth', 20: 'twentieth', 30: 'thirtieth',
};

function yearToWords(year) {
  const n = Number(year);
  if (n >= 2000 && n < 2010) return `two thousand ${n % 10 === 0 ? '' : ONES[n % 10]}`.trim();
  if (n >= 2010 && n < 2100) return `twenty ${twoDigitsToWords(n % 100)}`;
  const high = Math.floor(n / 100);
  const low = n % 100;
  if (low === 0) return `${twoDigitsToWords(high)} hundred`;
  if (low < 10) return `${twoDigitsToWords(high)} oh ${ONES[low]}`;
  return `${twoDigitsToWords(high)} ${twoDigitsToWords(low)}`;
}

function normaliseNumbers(text) {
  return (
    String(text || '')
      .replace(/\$\s?([\d,]+)\.(\d{2})\b/g, (m, whole, cents) => {
        const dollars = whole.replace(/,/g, '');
        const centValue = Number(cents);
        const dollarPart = `${dollars} ${dollars === '1' ? 'dollar' : 'dollars'}`;
        return centValue === 0
          ? dollarPart
          : `${dollarPart} ${centValue} ${centValue === 1 ? 'cent' : 'cents'}`;
      })
      .replace(/\$\s?([\d,]+)\b/g, (m, whole) => {
        const dollars = whole.replace(/,/g, '');
        return `${dollars} ${dollars === '1' ? 'dollar' : 'dollars'}`;
      })
      .replace(/£\s?([\d,]+)\b/g, (m, n) => `${n.replace(/,/g, '')} pounds`)
      .replace(/€\s?([\d,]+)\b/g, (m, n) => `${n.replace(/,/g, '')} euros`)
      .replace(
        /(?<![\d.,])(1[1-9]\d{2}|20\d{2})(?!\.?\d)(?![ \t]?(?:dollars?|pounds?|euros?|cents?)\b)/g,
        (m) => yearToWords(m)
      )
      .replace(/\b(\d{1,2}):(\d{2})\b/g, (m, h, min) => {
        const hour = Number(h);
        const minute = Number(min);
        if (hour > 23 || minute > 59) return m;
        if (minute === 0) return `${twoDigitsToWords(hour)} o'clock`;
        if (minute < 10) return `${twoDigitsToWords(hour)} oh ${ONES[minute]}`;
        return `${twoDigitsToWords(hour)} ${twoDigitsToWords(minute)}`;
      })
      .replace(/\b(\d+)(st|nd|rd|th)\b/gi, (m, n) => {
        const value = Number(n);
        return ORDINAL_WORDS[value] || m;
      })
      .replace(/(\d)\s?%/g, '$1 percent')
  );
}

function normaliseSymbols(text) {
  return (
    String(text || '')
      .replace(/\b(?:https?:\/\/|www\.)\S+/gi, '')
      .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/[()]/g, '')
      .replace(/\s*[—–]\s*/g, ', ')
      .replace(/\.{3,}/g, '. ')
      .replace(/\s+&\s+/g, ' and ')
      .replace(/&/g, ' and ')
      .replace(/\b([A-Za-z]+)\/([A-Za-z]+)\b/g, (m, a, b) =>
        b.toLowerCase() === 'or' ? `${a} or` : `${a} or ${b}`
      )
      .replace(/#\s?(\d)/g, 'number $1')
      .replace(/\s@\s/g, ' at ')
      .replace(/[ \t]{2,}/g, ' ')
  );
}

const fixSymbols = normaliseSymbols;

function cleanWhitespace(text) {
  return String(text || '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/,{2,}/g, ',')
    .replace(/\.[ \t]*\.[ \t]*/g, '. ')
    .replace(/([!?])[ \t]*[.!?]+/g, '$1')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

function cleanText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\f/g, '\n')
    .replace(/­/g, '')
    .replace(/ﬁ/g, 'fi')
    .replace(/ﬂ/g, 'fl')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/([a-z])-\n([a-z])/g, '$1$2')
    .replace(/[ \t]+/g, ' ')
    .replace(/^\s*\d+\s*$/gm, '')
    .replace(/^\s*Page \d+( of \d+)?\s*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

function countWords(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

const HEADING_WORD_ONLY = /^(chapter|part|book|section|volume|canto)$/i;

function expandHeading(lines, index) {
  const first = lines[index].trim();
  if (!HEADING_WORD_ONLY.test(first)) return { title: first, lineSpan: 1 };

  const numeralLine = (lines[index + 1] || '').trim();
  if (!NUMERAL_LINE.test(numeralLine)) return { title: first, lineSpan: 1 };

  const head = `${first} ${numeralLine.replace(/[.:)]$/, '')}`;
  const titleLine = (lines[index + 2] || '').trim();

  if (titleLine && titleLine.length <= 80 && !/[.!?]$/.test(titleLine)) {
    return { title: `${head}: ${titleLine}`, lineSpan: 3 };
  }
  return { title: head, lineSpan: 2 };
}

function detectChapters(text) {
  const lines = text.split('\n');
  const marks = [];

  const explicit = /^(chapter|part|book|section|prologue|epilogue|introduction|foreword|preface|afterword|conclusion)\b/i;

  let consumedUntil = -1;

  lines.forEach((line, i) => {
    if (i <= consumedUntil) return;

    const trimmed = line.trim();
    if (trimmed.length < 3 || trimmed.length > 80) return;
    if (/[.,;:]$/.test(trimmed)) return;

    const hasLetters = /[A-Za-z]/.test(trimmed);
    if (!hasLetters) return;

    const isExplicit = explicit.test(trimmed);
    const isAllCaps = trimmed === trimmed.toUpperCase() && trimmed.split(/\s+/).length <= 12;

    if (isExplicit || isAllCaps) {
      const { title, lineSpan } = expandHeading(lines, i);
      marks.push({ title, lineIndex: i, lineSpan });
      consumedUntil = i + lineSpan - 1;
    }
  });

  if (marks.length === 0) {
    return [{ index: 0, title: 'Full Text', lineIndex: 0, lineSpan: 1, wordCount: countWords(text) }];
  }

  return marks.map((mark, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].lineIndex : lines.length;
    const body = lines.slice(mark.lineIndex, end).join('\n');
    return {
      index: i,
      title: mark.title,
      lineIndex: mark.lineIndex,
      lineSpan: mark.lineSpan,
      wordCount: countWords(body),
    };
  });
}

function normaliseForSpeech(text) {
  const lines = String(text || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const out = [];

  for (const line of lines) {
    if (out.length) {
      const previous = out[out.length - 1];
      const finished = /[.!?,;:]$/.test(previous);

      if (!finished && /^[a-z(“‘"']/.test(line)) {
        out[out.length - 1] = `${previous} ${line}`;
        continue;
      }
      if (!finished) out[out.length - 1] = `${previous}.`;
    }
    out.push(line);
  }

  if (out.length && !/[.!?,;:]$/.test(out[out.length - 1])) {
    out[out.length - 1] = `${out[out.length - 1]}.`;
  }

  return out.join(' ').replace(/\s+/g, ' ').trim();
}

function preprocessText(text) {
  if (!text) return '';

  let out = String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/\f/g, '\n')
    .replace(/­/g, '')
    .replace(/ﬁ/g, 'fi')
    .replace(/ﬂ/g, 'fl')
    .replace(/[ --]/g, '');

  const vocab = buildVocabulary(out);

  out = removeDecorations(out);
  out = fixSingleLetterSpacing(out);
  out = fixMixedLetterSpacing(out, vocab);
  out = fixMixedCaseLetterSpacing(out, vocab);
  out = reconstructChapterHeaders(out);
  out = reconstructPartHeaders(out);
  out = removeOrphanNumerals(out);
  out = removeFusedHeaders(out);
  out = splitFusedWords(out, vocab);
  out = fixPunctuationSpacing(out);
  out = joinBrokenLines(out);
  out = fixPracticeSections(out);
  out = fixAllCaps(out);
  out = fixSymbols(out);
  out = normaliseNumbers(out);
  return cleanWhitespace(out);
}

function normalise(rawText) {
  const text = cleanText(fixLetterSpacing(rawText || ''));
  return { text, chapters: detectChapters(text), wordCount: countWords(text) };
}

module.exports = {
  cleanText,
  detectChapters,
  countWords,
  normalise,
  buildVocabulary,

  preprocessText,
  normaliseForSpeech,

  removeDecorations,
  fixSingleLetterSpacing,
  fixMixedLetterSpacing,
  fixMixedCaseLetterSpacing,
  fixLetterSpacing,
  reconstructChapterHeaders,
  reconstructPartHeaders,
  removeOrphanNumerals,
  removeFusedHeaders,
  splitFusedWords,
  fixPunctuationSpacing,
  joinBrokenLines,
  fixPracticeSections,
  fixAllCaps,
  fixSymbols,
  normaliseSymbols,
  normaliseNumbers,
  cleanWhitespace,
  segmentFusedWord,
  isBrokenLine,
};
