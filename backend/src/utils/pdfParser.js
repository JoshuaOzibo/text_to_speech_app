'use strict';

const fs = require('fs');
const pdfParse = require('pdf-parse');

/**
 * Extract raw text from a PDF.
 *
 * Scanned/image-only PDFs parse successfully but yield (almost) no text, which
 * we surface as a specific error so the UI can explain what happened instead of
 * showing an empty preview.
 */
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

  // A page of real prose is hundreds of characters; a handful of stray glyphs
  // across many pages means the pages are images.
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
