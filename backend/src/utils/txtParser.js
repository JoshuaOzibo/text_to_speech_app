'use strict';

const fs = require('fs');

async function parseTXT(filePath) {
  let text = fs.readFileSync(filePath, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return { rawText: text, pageCount: null };
}

module.exports = { parseTXT };
