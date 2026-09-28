import { splitSentences } from './sentences.js';

/**
 * Deterministic checks that a summary says only what its source says.
 *
 * A model asked not to invent things still sometimes does, and the three kinds
 * of invention that matter most in a book summary are also the three a machine
 * can check without a second model: a quotation the author never wrote, a figure
 * that is not in the text, and a person or place the book never mentions. All
 * three are tested against the words of the book itself, on this machine.
 *
 * What this cannot catch is a wrong claim made in the book's own vocabulary —
 * that is what the grounding rules in the prompt are for. The checks are the
 * net under the prompt, not a replacement for it.
 */

/** Case, accents, curly quotes, dashes and punctuation folded away; words kept. */
function normalise(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function numbersIn(text) {
  const found = new Set();
  for (const match of String(text || '').matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    found.add(match[0].replace(/,/g, '').replace(/\.$/, ''));
  }
  return found;
}

/**
 * Everything a check needs about one body of text, built once. The whole book
 * is indexed once per summary; each passage is indexed when it is checked.
 */
function indexText(text) {
  const normalised = normalise(text);
  return {
    normalised: ` ${normalised} `,
    words: new Set(normalised.split(' ').filter(Boolean)),
    numbers: numbersIn(text),
  };
}

// Capitalised for reasons that have nothing to do with being a name.
const CAPITALISED_ANYWAY = new Set(
  (
    'i monday tuesday wednesday thursday friday saturday sunday january february march april ' +
    'may june july august september october november december english'
  ).split(' '),
);

const QUOTE = /[“"]([^”"]{3,600})[”"]/g;
const MIN_QUOTE_WORDS = 3;

function sentenceOf(text, needle) {
  return splitSentences(text).find((sentence) => sentence.includes(needle)) || needle;
}

/**
 * @param {string} summary  what the model wrote for this passage
 * @param {object} source   indexText() of the passage it summarized
 * @param {object} book     indexText() of the whole book
 * @param {string[]} extra  titles and the author's name: words the summary may use
 * @returns {{kind: 'quote'|'number'|'name', detail: string, sentence: string}[]}
 */
function checkSection(summary, source, book, extra = []) {
  const issues = [];
  const allowed = indexText(extra.join(' '));

  // A quotation must appear word for word in the passage. Scare quotes around
  // one or two words are left alone: they are emphasis, not a claim of quoting.
  for (const match of summary.matchAll(QUOTE)) {
    const quoted = normalise(match[1]);
    if (quoted.split(' ').length < MIN_QUOTE_WORDS) continue;
    if (!source.normalised.includes(` ${quoted} `)) {
      issues.push({ kind: 'quote', detail: match[1].trim(), sentence: sentenceOf(summary, match[0]) });
    }
  }

  // A figure must appear in the passage. Single digits are skipped: the book
  // may say "three" where the summary says "3", and a one-digit invention is
  // not the kind that misleads.
  for (const number of numbersIn(summary)) {
    if (number.replace(/\D/g, '').length < 2) continue;
    if (source.numbers.has(number) || allowed.numbers.has(number)) continue;
    issues.push({ kind: 'number', detail: number, sentence: sentenceOf(summary, number) });
  }

  // A name must appear somewhere in the book. The whole book, not the passage,
  // because a chapter may rightly name someone introduced three chapters back.
  const flagged = new Set();
  for (const sentence of splitSentences(summary)) {
    // The first word of a sentence, or of a quotation or clause after a colon,
    // is capitalised for grammar. Those positions are skipped.
    const tokens = sentence.split(/\s+/);
    tokens.forEach((raw, i) => {
      if (i === 0) return;
      const previous = tokens[i - 1];
      if (/[:;—–-]$|^[“"(]/.test(previous) || /^[“"(]/.test(raw)) return;

      const word = raw.replace(/^[^A-Za-z]+|[^A-Za-z'’-]+$/g, '').replace(/['’]s$/, '');
      if (!/^[A-Z][a-zA-Z'’-]{2,}$/.test(word)) return;

      const parts = normalise(word).split(' ').filter(Boolean);
      if (!parts.length || parts.every((part) => CAPITALISED_ANYWAY.has(part))) return;
      if (parts.every((part) => book.words.has(part) || allowed.words.has(part))) return;
      if (flagged.has(word)) return;

      flagged.add(word);
      issues.push({ kind: 'name', detail: word, sentence });
    });
  }

  return issues;
}

/** The feedback line a model is shown when asked to correct its own summary. */
function describeIssue(issue) {
  if (issue.kind === 'quote') {
    return `The quotation "${issue.detail}" does not appear word for word in the passage.`;
  }
  if (issue.kind === 'number') return `The number ${issue.detail} does not appear in the passage.`;
  return `"${issue.detail}" is not mentioned anywhere in the book.`;
}

export { normalise, indexText, checkSection, describeIssue };
