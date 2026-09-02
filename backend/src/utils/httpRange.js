import fs from 'fs';
import { logger } from './logger.js';

function sendFileRange(req, res, filePath, contentType = 'audio/mpeg') {
  const { size } = fs.statSync(filePath);
  const range = req.headers.range;

  res.set('Accept-Ranges', 'bytes');
  res.set('Content-Type', contentType);
  res.set('Cache-Control', 'no-store');

  if (!size) {
    return res.set('Content-Length', '0').status(range ? 416 : 200).end();
  }

  let start = 0;
  let end = size - 1;

  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (!match) {
      return res.status(416).set('Content-Range', `bytes */${size}`).end();
    }

    start = match[1] ? parseInt(match[1], 10) : size - parseInt(match[2] || '0', 10);
    end = match[2] && match[1] ? parseInt(match[2], 10) : size - 1;

    start = Math.max(0, start);
    end = Math.min(end, size - 1);

    if (Number.isNaN(start) || Number.isNaN(end) || start > end) {
      return res.status(416).set('Content-Range', `bytes */${size}`).end();
    }

    res.status(206);
    res.set('Content-Range', `bytes ${start}-${end}/${size}`);
  }

  res.set('Content-Length', String(end - start + 1));

  const stream = fs.createReadStream(filePath, { start, end });
  stream.on('error', (error) => {
    logger.error('http', `could not stream ${filePath}: ${error.message}`);
    res.destroy();
  });

  return stream.pipe(res);
}

export { sendFileRange };
