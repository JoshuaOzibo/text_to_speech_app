import fs from 'fs';
import path from 'path';
import { paths } from '../config/env.js';

function emptyDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    const target = path.join(dir, entry);
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch {
    }
  }
}

function removeFile(filePath) {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
  }
}

function clearChunks() {
  emptyDir(paths.chunks);
}

function clearOrphanChunks() {
  const manifest = path.join(paths.chunks, 'run.json');

  if (fs.existsSync(manifest)) {
    const finished = fs
      .readdirSync(paths.chunks)
      .filter((entry) => entry.endsWith('.wav')).length;
    if (finished > 0) return finished;
  }

  emptyDir(paths.chunks);
  return 0;
}

function clearUploads() {
  emptyDir(paths.uploads);
}

let pendingCleanup = null;

function scheduleOutputCleanup(delayMs) {
  if (pendingCleanup) clearTimeout(pendingCleanup);
  pendingCleanup = setTimeout(() => {
    removeFile(paths.outputMp3);
    clearChunks();
    pendingCleanup = null;
  }, delayMs);
  if (pendingCleanup.unref) pendingCleanup.unref();
}

function cancelScheduledCleanup() {
  if (pendingCleanup) {
    clearTimeout(pendingCleanup);
    pendingCleanup = null;
  }
}

export { emptyDir, removeFile, clearChunks, clearOrphanChunks, clearUploads, scheduleOutputCleanup, cancelScheduledCleanup };
