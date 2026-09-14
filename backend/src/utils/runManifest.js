import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { paths } from '../config/env.js';
import { removeFile } from './cleanup.js';
import { writeFileAtomic, writeJsonAtomic, readJson } from './atomicFile.js';
const MANIFEST = 'run.json';
const RUN_TEXT = 'run-text.txt';

const manifestPath = () => path.join(paths.chunks, MANIFEST);
const runTextPath = () => path.join(paths.chunks, RUN_TEXT);

const chunkWav = (index) =>
  path.join(paths.chunks, `chunk-${String(index + 1).padStart(4, '0')}.wav`);

const chunkSidecar = (index) => chunkWav(index).replace(/\.wav$/, '.json');
function runKey(spokenText, voice, speed) {
  return crypto
    .createHash('sha1')
    .update(`${voice}|${speed}|${spokenText}`)
    .digest('hex')
    .slice(0, 16);
}

function readManifest() {
  const manifest = readJson(manifestPath());
  return manifest && typeof manifest.key === 'string' ? manifest : null;
}

function writeManifest(data) {
  fs.mkdirSync(paths.chunks, { recursive: true });
  writeJsonAtomic(manifestPath(), data);
}
function writeRunText(text) {
  fs.mkdirSync(paths.chunks, { recursive: true });
  writeFileAtomic(runTextPath(), text);
}

function readRunText() {
  try {
    return fs.readFileSync(runTextPath(), 'utf8');
  } catch {
    return null;
  }
}

function countFinishedChunks() {
  if (!fs.existsSync(paths.chunks)) return 0;
  return fs.readdirSync(paths.chunks).filter((entry) => entry.endsWith('.wav')).length;
}
function sweepPartials() {
  if (!fs.existsSync(paths.chunks)) return;
  for (const entry of fs.readdirSync(paths.chunks)) {
    if (entry.endsWith('.part') || entry.endsWith('.tmp')) {
      removeFile(path.join(paths.chunks, entry));
    }
  }
}
function resumableRun() {
  const manifest = readManifest();
  const done = countFinishedChunks();

  if (!manifest || done === 0) {
    return { resumable: false, done, total: manifest?.total ?? 0 };
  }

  return {
    resumable: readRunText() !== null,
    done,
    total: manifest.total ?? 0,
    voice: manifest.voice ?? null,
    speed: manifest.speed ?? 1,
    title: manifest.title ?? null,
    wordCount: manifest.wordCount ?? 0,
    startedAt: manifest.startedAt ?? null,
    test: manifest.test ?? 0,
  };
}

export {
  MANIFEST,
  RUN_TEXT,
  manifestPath,
  runTextPath,
  chunkWav,
  chunkSidecar,
  runKey,
  readJson,
  writeJsonAtomic,
  readManifest,
  writeManifest,
  writeRunText,
  readRunText,
  countFinishedChunks,
  sweepPartials,
  resumableRun,
};
