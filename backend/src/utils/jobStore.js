'use strict';

/**
 * Tracks the single active generation job and fans progress out to SSE clients.
 *
 * This app is a local, single-user tool, so one module-level job is enough — no
 * database, no session handling (both are explicitly out of scope in the spec).
 */

const clients = new Set();

/** Latest progress snapshot. Replayed to every new SSE subscriber on connect. */
let state = { status: 'idle', progress: 0 };

/** The in-flight job, or null when nothing is generating. */
let job = null;

/**
 * Metadata for the last MP3 produced. Kept so a reloaded page can recover the
 * finished audio even though the original response went to a browser that is
 * no longer listening.
 */
let lastResult = null;

function getState() {
  return state;
}

function getLastResult() {
  return lastResult;
}

function setLastResult(result) {
  lastResult = result;
}

function isBusy() {
  return job !== null;
}

/** Merge a patch into the snapshot and push it to every connected client. */
function publish(patch) {
  state = { ...state, ...patch };
  const frame = `data: ${JSON.stringify(state)}\n\n`;
  for (const res of clients) {
    // A client that vanished mid-write shouldn't take the generation down.
    try {
      res.write(frame);
    } catch {
      clients.delete(res);
    }
  }
}

/** Register an SSE response stream. Returns an unsubscribe function. */
function subscribe(res) {
  clients.add(res);
  // Replay current state immediately so a client that connects slightly after
  // generation started doesn't sit at 0% until the next tick.
  try {
    res.write(`data: ${JSON.stringify(state)}\n\n`);
  } catch {
    clients.delete(res);
  }
  return () => clients.delete(res);
}

function startJob() {
  job = { cancelled: false, child: null };
  publish({ status: 'starting', progress: 0, chunk: 0, totalChunks: 0, message: undefined });
  return job;
}

function endJob() {
  job = null;
}

/** Attach the Piper child process so cancel() can kill it mid-chunk. */
function trackChild(child) {
  if (job) job.child = child;
}

function isCancelled() {
  return Boolean(job && job.cancelled);
}

/** Flag the job cancelled and kill the running Piper process. */
function cancel() {
  if (!job) return false;
  job.cancelled = true;
  if (job.child && job.child.exitCode === null) {
    job.child.kill();
  }
  publish({ status: 'cancelled', progress: 0, message: 'Generation cancelled.' });
  return true;
}

function reset() {
  state = { status: 'idle', progress: 0 };
}

module.exports = {
  getState,
  getLastResult,
  setLastResult,
  isBusy,
  publish,
  subscribe,
  startJob,
  endJob,
  trackChild,
  isCancelled,
  cancel,
  reset,
};
