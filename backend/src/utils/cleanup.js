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
  let manifest = null;

  try {
    const raw = fs.readFileSync(path.join(paths.chunks, 'run.json'), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.key === 'string') manifest = parsed;
  } catch {
    manifest = null;
  }

  if (manifest) {
    const finished = fs
      .readdirSync(paths.chunks)
      .filter((entry) => entry.endsWith('.wav')).length;

    if (finished > 0) {
      return { kept: finished, total: manifest.total ?? 0, voice: manifest.voice ?? null };
    }
  }

  emptyDir(paths.chunks);
  return { kept: 0, total: 0, voice: null };
}

function clearUploads() {
  emptyDir(paths.uploads);
}


export { emptyDir, removeFile, clearChunks, clearOrphanChunks, clearUploads };
