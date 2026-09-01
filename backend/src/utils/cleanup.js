'use strict';

const fs = require('fs');
const path = require('path');
const { paths } = require('../config/env');

/** Delete every file in a directory, leaving the directory itself in place. */
function emptyDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    const target = path.join(dir, entry);
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch {
      // A file still held open by a stream will be swept on the next pass.
    }
  }
}

function removeFile(filePath) {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    /* nothing to remove */
  }
}

/** Drop the intermediate WAV chunks once they have been merged. */
function clearChunks() {
  emptyDir(paths.chunks);
}

/** Drop uploaded book files — the extracted text lives in the client by then. */
function clearUploads() {
  emptyDir(paths.uploads);
}

let pendingCleanup = null;

/**
 * Schedule deletion of the generated MP3.
 *
 * Called after a download completes so long books don't accumulate on disk. A
 * fresh call replaces any pending timer, so re-downloading resets the clock.
 */
function scheduleOutputCleanup(delayMs) {
  if (pendingCleanup) clearTimeout(pendingCleanup);
  pendingCleanup = setTimeout(() => {
    removeFile(paths.outputMp3);
    clearChunks();
    pendingCleanup = null;
  }, delayMs);
  // Don't hold the process open just for a cleanup timer.
  if (pendingCleanup.unref) pendingCleanup.unref();
}

function cancelScheduledCleanup() {
  if (pendingCleanup) {
    clearTimeout(pendingCleanup);
    pendingCleanup = null;
  }
}

module.exports = {
  emptyDir,
  removeFile,
  clearChunks,
  clearUploads,
  scheduleOutputCleanup,
  cancelScheduledCleanup,
};
