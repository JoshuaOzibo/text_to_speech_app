const clients = new Set();

let state = { status: 'idle', progress: 0 };

let job = null;

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

function publish(patch) {
  state = { ...state, ...patch };
  const frame = `data: ${JSON.stringify(state)}\n\n`;
  for (const res of clients) {
    try {
      res.write(frame);
    } catch {
      clients.delete(res);
    }
  }
}

function subscribe(res) {
  clients.add(res);
  try {
    res.write(`data: ${JSON.stringify(state)}\n\n`);
  } catch {
    clients.delete(res);
  }
  return () => clients.delete(res);
}

function startJob() {
  job = { cancelled: false, child: null, reason: null };
  publish({ status: 'starting', progress: 0, chunk: 0, totalChunks: 0, message: undefined });
  return job;
}

function endJob() {
  job = null;
}

function trackChild(child) {
  if (job) job.child = child;
}

function isCancelled() {
  return Boolean(job && job.cancelled);
}


let lastCancelReason = null;

function cancelReason() {
  return (job && job.reason) || lastCancelReason;
}

function cancel(reason = 'cancelled') {
  if (!job) return false;
  job.cancelled = true;
  job.reason = reason;
  lastCancelReason = reason;
  if (job.child && job.child.exitCode === null) {
    job.child.kill();
  }
  publish({
    status: 'cancelled',
    progress: 0,
    message:
      reason === 'disconnected'
        ? 'Generation stopped - the page disconnected.'
        : 'Generation cancelled.',
  });
  return true;
}

function reset() {
  state = { status: 'idle', progress: 0 };
}

export { getState, getLastResult, setLastResult, isBusy, publish, subscribe, startJob, endJob, trackChild, isCancelled, cancel, cancelReason, reset };
