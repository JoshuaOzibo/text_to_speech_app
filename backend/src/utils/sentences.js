const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'rev', 'hon', 'st', 'sr', 'jr',
  'vs', 'etc', 'eg', 'ie', 'cf', 'al', 'fig', 'no', 'vol', 'ch', 'pp',
  'inc', 'ltd', 'co', 'corp', 'dept', 'est', 'approx', 'min', 'max',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
]);

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

export { ABBREVIATIONS, splitSentences };
