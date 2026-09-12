import fs from 'fs';

const RENAME_BACKOFF_MS = [10, 20, 40, 80, 160, 250, 250, 250, 250, 250];
const TRANSIENT = new Set(['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY']);

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      if (!TRANSIENT.has(error.code) || attempt >= RENAME_BACKOFF_MS.length) throw error;
      sleepSync(RENAME_BACKOFF_MS[attempt]);
    }
  }
}

function writeFileAtomic(file, data, encoding = 'utf8') {
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, data, encoding);
  renameWithRetry(temp, file);
}

function writeJsonAtomic(file, data) {
  writeFileAtomic(file, JSON.stringify(data));
}

export { renameWithRetry, writeFileAtomic, writeJsonAtomic };
