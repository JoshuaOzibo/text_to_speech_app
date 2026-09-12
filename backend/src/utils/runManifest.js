import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { paths } from '../config/env.js';
import { removeFile } from './cleanup.js';
import { renameWithRetry, writeFileAtomic, writeJsonAtomic } from './atomicFile.js';

// Everything that knows the on-disk shape of audio/chunks/ lives here, so the
// generate route and the chunks route can never disagree about a filename.
//
// The folder is durable state, not scratch. A run that is interrupted - by a
// power cut, a crash, a closed browser tab - leaves its finished chunks behind
// and the manifest names which book they belong to, so the next run carries on
// instead of starting again.

const MANIFEST = 'run.json';
const RUN_TEXT = 'run-text.txt';

const manifestPath = () => path.join(paths.chunks, MANIFEST);
const runTextPath = () => path.join(paths.chunks, RUN_TEXT);

const chunkWav = (index) =>
  path.join(paths.chunks, `chunk-${String(index + 1).padStart(4, '0')}.wav`);

const chunkSidecar = (index) => chunkWav(index).replace(/\.wav$/, '.json');

/**
 * Identity of a run. Text, voice and speed together decide whether chunks on
 * disk belong to the book being generated now - change any of them and the old
 * chunks are audio of something else.
 */
function runKey(spokenText, voice, speed) {
  return crypto
    .createHash('sha1')
    .update(`${voice}|${speed}|${spokenText}`)
    .digest('hex')
    .slice(0, 16);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// Atomic writes and the Windows rename retry live in atomicFile.js; re-exported
// here because the chunk folder is the main thing that needs them.

function readManifest() {
  const manifest = readJson(manifestPath());
  // A manifest without a key is not one of ours - treat it as absent rather
  // than letting a stray run.json protect a folder of orphans.
  return manifest && typeof manifest.key === 'string' ? manifest : null;
}

function writeManifest(data) {
  fs.mkdirSync(paths.chunks, { recursive: true });
  writeJsonAtomic(manifestPath(), data);
}

/**
 * The book's own text, stored beside the audio. Without this, resuming depends
 * on a browser somewhere still holding the text and re-posting it byte for
 * byte - which a power cut, a cleared cache or a different machine all break.
 */
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

/**
 * A chunk only carries its final name once it is complete, so a half-written
 * .part or .tmp from a killed process is never mistaken for finished work.
 * Sweep them before a run rather than letting them accumulate.
 */
function sweepPartials() {
  if (!fs.existsSync(paths.chunks)) return;
  for (const entry of fs.readdirSync(paths.chunks)) {
    if (entry.endsWith('.part') || entry.endsWith('.tmp')) {
      removeFile(path.join(paths.chunks, entry));
    }
  }
}

/**
 * What the UI and the boot banner need to describe an interrupted run, read
 * purely off disk so it survives a server restart.
 */
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
  renameWithRetry,
  readManifest,
  writeManifest,
  writeRunText,
  readRunText,
  countFinishedChunks,
  sweepPartials,
  resumableRun,
};
