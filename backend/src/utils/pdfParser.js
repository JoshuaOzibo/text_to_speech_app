import fs from 'fs';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import {
  createCollector,
  createPageRenderer,
  levelFromRatio,
  mergeWrappedBlocks,
  stripRunningHeads,
} from './pdfLayout.js';
import { headingKey } from './docStructure.js';

async function parsePDF(filePath) {
  const dataBuffer = fs.readFileSync(filePath);

  // The collector gathers what only a whole-document view can decide: heading
  // levels, and which short edge lines repeat often enough to be running heads.
  const collector = createCollector();

  let data;
  try {
    data = await pdfParse(dataBuffer, { pagerender: createPageRenderer(collector) });
  } catch (err) {
    const error = new Error('This PDF could not be read. It may be corrupt or password protected.');
    error.code = 'PDF_UNREADABLE';
    error.cause = err;
    throw error;
  }

  const text = mergeWrappedBlocks(stripRunningHeads(data.text || '', collector));

  if (text.replace(/\s/g, '').length < 50 * Math.max(1, Math.min(data.numpages, 5))) {
    const error = new Error(
      'This PDF appears to be scanned. Text could not be extracted.'
    );
    error.code = 'PDF_NO_TEXT';
    throw error;
  }

  // Keyed on the heading text because cleanText may drop lines before the
  // outline is built, which would invalidate any index we recorded here.
  const headingLevels = new Map();
  for (const heading of collector.headings) {
    const key = headingKey(heading.text);
    const level = levelFromRatio(heading.ratio);
    if (!headingLevels.has(key) || level < headingLevels.get(key)) headingLevels.set(key, level);
  }

  return { rawText: text, pageCount: data.numpages, headingLevels };
}

export { parsePDF };
