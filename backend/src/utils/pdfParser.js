'use strict';

const fs = require('fs');
const pdfParse = require('pdf-parse');

async function parsePDF(filePath) {
  const dataBuffer = fs.readFileSync(filePath);

  let data;
  try {
    data = await pdfParse(dataBuffer);
  } catch (err) {
    const error = new Error('This PDF could not be read. It may be corrupt or password protected.');
    error.code = 'PDF_UNREADABLE';
    error.cause = err;
    throw error;
  }

  const text = data.text || '';

  if (text.replace(/\s/g, '').length < 50 * Math.max(1, Math.min(data.numpages, 5))) {
    const error = new Error(
      'This PDF appears to be scanned. Text could not be extracted.'
    );
    error.code = 'PDF_NO_TEXT';
    throw error;
  }

  return { rawText: text, pageCount: data.numpages };
}

module.exports = { parsePDF };
