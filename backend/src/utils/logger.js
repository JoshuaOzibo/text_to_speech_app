const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

const threshold = LEVELS[String(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

function stamp() {
  const now = new Date();
  const pad = (value, width = 2) => String(value).padStart(width, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(
    now.getMilliseconds(),
    3,
  )}`;
}

function fields(data) {
  if (!data) return '';
  return Object.entries(data)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
}

function emit(name, weight, tag, message, data) {
  if (weight > threshold) return;
  const head = `${stamp()} ${name.padEnd(5)} ${String(tag).padEnd(8)} ${message}`;
  const extra = fields(data);
  const line = extra ? `${head}  ${extra}` : head;
  if (weight <= LEVELS.error) console.error(line);
  else console.log(line);
}

const logger = {
  error: (tag, message, data) => emit('ERROR', LEVELS.error, tag, message, data),
  warn: (tag, message, data) => emit('WARN', LEVELS.warn, tag, message, data),
  info: (tag, message, data) => emit('INFO', LEVELS.info, tag, message, data),
  debug: (tag, message, data) => emit('DEBUG', LEVELS.debug, tag, message, data),
  level: Object.keys(LEVELS).find((name) => LEVELS[name] === threshold) || 'info',
};

function timer() {
  const started = process.hrtime.bigint();
  return () => Number(process.hrtime.bigint() - started) / 1e9;
}

const secs = (value) => `${value.toFixed(2)}s`;

function watchdog(tag, message, intervalMs = 30000) {
  const elapsed = timer();
  const handle = setInterval(() => {
    logger.warn(tag, `${message} - still running`, { for: secs(elapsed()) });
  }, intervalMs);
  if (handle.unref) handle.unref();
  return () => {
    clearInterval(handle);
    return elapsed();
  };
}

function requestLogger(req, res, next) {
  const elapsed = timer();
  const route = req.originalUrl.split('?')[0];

  if (route === '/api/status') {
    logger.info('http', 'SSE stream opened');
    res.on('close', () => logger.info('http', 'SSE stream closed', { after: secs(elapsed()) }));
    return next();
  }

  res.on('finish', () => {
    const took = elapsed();
    const data = { status: res.statusCode, took: secs(took) };
    if (res.statusCode >= 500) logger.error('http', `${req.method} ${route}`, data);
    else if (res.statusCode >= 400) logger.warn('http', `${req.method} ${route}`, data);
    else logger.info('http', `${req.method} ${route}`, data);
  });

  res.on('close', () => {
    if (res.writableEnded) return;
    const level = res.headersSent ? 'debug' : 'warn';
    logger[level]('http', `${req.method} ${route} - client closed the connection early`, {
      status: res.headersSent ? res.statusCode : undefined,
      after: secs(elapsed()),
    });
  });

  next();
}

export { logger, timer, secs, watchdog, requestLogger, LEVELS };
