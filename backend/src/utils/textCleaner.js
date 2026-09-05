import {
  KNOWN_ACRONYMS,
  isKnownWord,
  isRomanNumeral,
  romanToInt,
} from './lexicon.js';

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

const SECTION_MARKER = /^Section \d+ of \d+$/;

const METADATA_MARKERS = [
  /\bISBN\b/i,
  /\bimprint of\b/i,
  /copyright[ \t]*©/i,
  /penguinrandomhouse/i,
  /all rights reserved/i,
  /version_/i,
];

const DROP_CAPS = new Set(['T', 'Y', 'W', 'P']);

const FRONT_MATTER_HEADING =
  /^(chapter|part|book|volume|canto|prologue|epilogue|introduction|foreword|preface|afterword|conclusion)\b/i;

const TOC_MAX_CHARS = 60;
const TOC_MIN_RUN = 6;
const BODY_MIN_CHARS = 60;
const MAX_FRONT_MATTER_LINES = 250;
const HEADING_LOOKBACK = 4;

const VERB_SOURCE = `
am are is was were be been being
have has had having do does did doing done
can could will would shall should may might must ought need dare
say says said tell tells told ask asks asked answer answers answered
speak speaks spoke spoken talk talks talked write writes wrote written read reads
go goes went gone come comes came get gets got gotten give gives gave given
take takes took taken make makes made know knows knew known think thinks thought
see sees saw seen look looks looked find finds found feel feels felt
want wants wanted use uses used work works worked call calls called
try tries tried leave leaves left put puts mean means meant keep keeps kept
let lets begin begins began begun seem seems seemed help helps helped
show shows showed shown hear hears heard play plays played run runs ran
move moves moved live lives lived believe believes believed bring brings brought
happen happens happened stand stands stood lose loses lost pay pays paid
meet meets met include includes included continue continues continued
set sets learn learns learned understand understands understood
watch watches watched follow follows followed stop stops stopped
create creates created remember remembers remembered consider considers considered
appear appears appeared buy buys bought wait waits waited serve serves served
die dies died send sends sent expect expects expected build builds built
stay stays stayed fall falls fell cut cuts reach reaches reached
kill kills killed remain remains remained suggest suggests suggested
raise raises raised pass passes passed sell sells sold require requires required
report reports reported decide decides decided pull pulls pulled
return returns returned explain explains explained hope hopes hoped
develop develops developed carry carries carried break breaks broke broken
receive receives received agree agrees agreed support supports supported
hit hits produce produces produced eat eats ate cover covers covered
catch catches caught draw draws drew choose chooses chose chosen
cause causes caused own owns owned turn turns turned become becomes became
grow grows grew open opens opened walk walks walked win wins won
offer offers offered love loves loved like likes liked add adds added
spend spends spent allow allows allowed sit sits sat provide provides provided
lead leads led change changes changed lie lies lay laid rise rises rose
bear bears bore borne wear wears wore hold holds held teach teaches taught
fight fights fought seek seeks sought throw throws threw thrown fill fills filled
save saves saved drive drives drove driven treat treats treated
wish wishes wished trade trades traded rule rules ruled
depend depends depended belong belongs belonged exist exists existed
matter matters mattered
`;

const VERBS = new Set(VERB_SOURCE.trim().split(/\s+/));

const VERB_CONTRACTION = /\b[A-Za-z]+(?:n't|'(?:re|ve|ll|m|d))\b/i;

function hasVerb(line) {
  if (VERB_CONTRACTION.test(line)) return true;
  const tokens = line.toLowerCase().match(/[a-z]+/g) || [];
  return tokens.some((token) => VERBS.has(token));
}

function isHeadingLine(line) {
  const trimmed = line.trim();
  const letters = trimmed.replace(/[^A-Za-z]/g, '');
  if (letters && letters === letters.toUpperCase()) return true;
  if (FRONT_MATTER_HEADING.test(trimmed)) return true;
  if (/[.!?]/.test(trimmed)) return false;

  const words = trimmed.split(/\s+/).filter((word) => /[A-Za-z]/.test(word));
  if (!words.length) return true;
  const capitalised = words.filter((word) => /^[A-Z]/.test(word)).length;
  return capitalised / words.length >= 0.6;
}

function isMetadataLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (SECTION_MARKER.test(trimmed)) return true;
  return METADATA_MARKERS.some((pattern) => pattern.test(trimmed));
}

function isTocLine(line) {
  const trimmed = line.trim();
  return trimmed.length > 0 && trimmed.length < TOC_MAX_CHARS && !/[.,;:!?]/.test(trimmed);
}

function stripTocRuns(lines) {
  const out = [];
  let run = [];
  let entries = 0;

  const flush = () => {
    if (entries < TOC_MIN_RUN) out.push(...run);
    run = [];
    entries = 0;
  };

  for (const line of lines) {
    if (!line.trim()) {
      if (run.length) run.push(line);
      else out.push(line);
      continue;
    }

    if (isTocLine(line)) {
      run.push(line);
      entries += 1;
      continue;
    }

    flush();
    out.push(line);
  }

  flush();
  return out;
}

function mergeDropCaps(lines) {
  const out = lines.slice();

  for (let i = 0; i < out.length; i += 1) {
    if (!DROP_CAPS.has(out[i].trim())) continue;

    let next = i + 1;
    while (next < out.length && !out[next].trim()) next += 1;

    if (next < out.length && /^[a-z]/.test(out[next].trim())) {
      out[next] = out[i].trim() + out[next].trim();
    }
    out[i] = '';
  }

  return out;
}

function findBodyStart(lines) {
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed.length <= BODY_MIN_CHARS) continue;
    if (isHeadingLine(trimmed)) continue;
    if (!hasVerb(trimmed)) continue;
    return i;
  }
  return -1;
}

function recoverHeading(lines, start) {
  let seen = 0;
  for (let i = start - 1; i >= 0 && seen < HEADING_LOOKBACK; i -= 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    seen += 1;
    if (FRONT_MATTER_HEADING.test(trimmed)) return i;
  }
  return start;
}

function removeFrontMatterAndMetadata(text) {
  if (!text) return '';

  const flattened = String(text).replace(/[ \t]*•(?:[ \t]*•){2}[ \t]*/g, '\n\n');

  let lines = flattened.split('\n').filter((line) => !isMetadataLine(line));
  lines = stripTocRuns(lines);
  lines = mergeDropCaps(lines);

  const start = findBodyStart(lines);
  if (start <= 0) return lines.join('\n');

  const body = recoverHeading(lines, start);
  const dropped = lines.slice(0, body).filter((line) => line.trim()).length;
  if (dropped > MAX_FRONT_MATTER_LINES) return lines.join('\n');

  return lines.slice(body).join('\n');
}

// --- Back matter --------------------------------------------------------------
// The mirror of removeFrontMatterAndMetadata: everything above walks the text
// from the top down, so an Index or an About the Author section at the *end*
// survives every step and gets narrated. This walks backward instead.
//
// It is deliberately NOT a step in preprocessText. That runs at generation time
// for every book, and a destructive cut nobody asked for must not happen
// silently — this is called only by /api/clean-text, where the result is shown
// in the editor and one Undo puts it back.

const BACK_MATTER_HEADING =
  /^(about the author|about the type|about the publisher|acknowledge?ments?|bibliography|index|endnotes|notes|further reading|suggested reading|selected (?:reading|bibliography|works)|works cited|references|appendix|appendices|glossary|permissions|credits|colophon|also by|by the same author)\b/i;

// Only the tail of the book is eligible. Same reasoning as the front-matter cap:
// a share-based rule was tried there and was wrong, because a share means
// something different on a 7-line file than on a 14,000-line one.
const MAX_BACK_MATTER_LINES = 250;

// A back-matter heading is alone on its line and short. Anything longer is a
// sentence that merely starts with the word "Notes" or "References".
const BACK_MATTER_MAX_CHARS = 60;

// How far above a candidate to look for a "Chapter"/"Part" marker. Extraction
// splits a heading across up to three lines (`Chapter` / `III` / `Notes`), so
// the marker sits at most two non-blank lines above the title.
const CHAPTER_MARKER_LOOKBACK = 2;

// `Chapter 3` followed by `Notes` is a chapter *titled* Notes, not the endnotes
// section — and cutting there silently deletes a real chapter. This is the
// inverse of recoverHeading, which joins the same three lines into one heading.
function precededByChapterMarker(lines, index) {
  let seen = 0;
  for (let i = index - 1; i >= 0 && seen < CHAPTER_MARKER_LOOKBACK; i -= 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    seen += 1;
    if (FRONT_MATTER_HEADING.test(trimmed)) return true;
  }
  return false;
}

function isBackMatterHeading(lines, index) {
  const trimmed = lines[index].trim();
  if (!trimmed || trimmed.length > BACK_MATTER_MAX_CHARS) return false;
  if (!BACK_MATTER_HEADING.test(trimmed)) return false;
  if (!isHeadingLine(trimmed)) return false;
  return !precededByChapterMarker(lines, index);
}

/**
 * Drops trailing Index / About the Author / Bibliography / Acknowledgements
 * sections. Returns the text unchanged when it cannot find one it trusts.
 *
 * Two guards, because a wrong cut here is silent and destroys real writing:
 *   - only the last MAX_BACK_MATTER_LINES non-blank lines are eligible, so a cut
 *     can never run away into the body;
 *   - the tail is refused if it contains a real chapter heading, which is what
 *     makes a bare "Notes" safe to match — a final chapter called Notes has
 *     chapter headings after it, back matter does not.
 */
function removeBackMatter(text) {
  const source = String(text || '');
  const unchanged = { text: source, removedLines: 0, removedWords: 0, heading: null };
  if (!source.trim()) return unchanged;

  const lines = source.split('\n');

  // Walk up from the end until MAX_BACK_MATTER_LINES non-blank lines are behind
  // us, remembering the earliest back-matter heading seen inside that window.
  let candidate = -1;
  let seen = 0;
  for (let i = lines.length - 1; i >= 0 && seen < MAX_BACK_MATTER_LINES; i -= 1) {
    if (!lines[i].trim()) continue;
    seen += 1;
    if (isBackMatterHeading(lines, i)) candidate = i;
  }

  if (candidate <= 0) return unchanged;

  const tail = lines.slice(candidate);
  const kept = lines.slice(0, candidate);

  // detectChapters over the tail sees the back-matter heading itself, so a tail
  // that is only back matter yields exactly one chapter. More than that means a
  // real chapter is down there and this is not back matter at all.
  if (detectChapters(tail.join('\n')).length > 1) return unchanged;

  const body = kept.join('\n').replace(/\s+$/, '');
  if (!body.trim()) return unchanged;

  return {
    text: body,
    removedLines: tail.filter((line) => line.trim()).length,
    removedWords: countWords(tail.join('\n')),
    heading: lines[candidate].trim(),
  };
}

/**
 * Cleans extracted book text for the engine. Runs at generation time only, so
 * the Text Preview and the reader keep showing the book as extracted.
 *
 * The order is load-bearing:
 *   0  removeFrontMatterAndMetadata  title page, copyright, TOC, drop caps
 *   1  removeDecorations             bullets, rules, leader dots
 *   2  fixSingleLetterSpacing        S P A C E D words
 *   3  fixMixedLetterSpacing         broken ALL CAPS lines
 *   4  fixMixedCaseLetterSpacing     broken mixed-case lines
 *   5  reconstructChapterHeaders     Chapter / I / Title -> one heading
 *   6  reconstructPartHeaders        Part One + title lines
 *   7  removeOrphanNumerals          leftover page and section numbers
 *   8  removeFusedHeaders            running headers, fused header words
 *   9  splitFusedWords               wordWord -> word Word
 *  10  fixPunctuationSpacing         spacing around , ; : ' ( )
 *  11  joinBrokenLines               unwrap PDF line breaks
 *  12  fixPracticeSections           callout label + body
 *  13  fixAllCaps                    MAKER -> Maker, keeping acronyms
 *  14  fixSymbols                    urls, markdown, dashes, ampersands
 *  15  normaliseNumbers              money, years, times, ordinals
 *  16  cleanWhitespace               collapse and trim
 *
 * Step 0 runs first because a copyright line is long and grammatical enough to
 * be mistaken for the first real paragraph once the repair steps have tidied
 * it up, and because its bullet separators must be seen before step 1 strips
 * every bullet in the book.
 */
function preprocessText(text) {
  if (!text) return '';

  let out = String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/\f/g, '\n')
    .replace(/­/g, '')
    .replace(/ﬁ/g, 'fi')
    .replace(/ﬂ/g, 'fl')
    .replace(/[ --]/g, '');

  out = removeFrontMatterAndMetadata(out);

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

export { cleanText, detectChapters, countWords, normalise, buildVocabulary, preprocessText, normaliseForSpeech, removeFrontMatterAndMetadata, removeBackMatter, removeDecorations, fixSingleLetterSpacing, fixMixedLetterSpacing, fixMixedCaseLetterSpacing, fixLetterSpacing, reconstructChapterHeaders, reconstructPartHeaders, removeOrphanNumerals, removeFusedHeaders, splitFusedWords, fixPunctuationSpacing, joinBrokenLines, fixPracticeSections, fixAllCaps, fixSymbols, normaliseSymbols, normaliseNumbers, cleanWhitespace, segmentFusedWord, isBrokenLine };
