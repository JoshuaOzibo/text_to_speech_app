import express from 'express';
import { listProviders, resolveProvider, PROVIDERS } from '../utils/llm/index.js';
import { planSummary, publicPlan, STRUCTURES } from '../utils/summaryPlan.js';
import { summarize, isBusy, countCached } from '../utils/summarizer.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

const MIN_MINUTES = 3;
const MAX_MINUTES = 240;
const HEARTBEAT_MS = 15000;

/** Validates the fields both /summary/plan and /summary take. */
function readRequest(body) {
  const { text, filename, minutes, speed, structure, provider, model, title, author, headingLevels } = body || {};

  if (typeof text !== 'string' || !text.trim()) {
    return { error: { status: 400, code: 'NO_TEXT', message: 'Open a book before summarizing it.' } };
  }
  const length = Number(minutes);
  if (!Number.isFinite(length) || length < MIN_MINUTES || length > MAX_MINUTES) {
    return {
      error: {
        status: 400,
        code: 'SUMMARY_BAD_LENGTH',
        message: `Pick a length between ${MIN_MINUTES} and ${MAX_MINUTES} minutes.`,
      },
    };
  }
  if (!PROVIDERS[provider]) {
    return { error: { status: 400, code: 'SUMMARY_PROVIDER_UNKNOWN', message: 'Pick an AI provider.' } };
  }

  return {
    request: {
      text,
      filename: String(filename || ''),
      minutes: length,
      speed: Math.min(2, Math.max(0.5, Number(speed) || 1)),
      structure: STRUCTURES.includes(structure) ? structure : 'chapters',
      provider,
      model: typeof model === 'string' ? model : '',
      title: typeof title === 'string' ? title : '',
      author: typeof author === 'string' ? author : undefined,
      headingLevels,
    },
  };
}

function fail(res, status, code, message) {
  return res.status(status).json({ success: false, error: message, code });
}

/** Plan errors carry their own code; anything else is a bug and says so. */
function planStatus(error) {
  if (error.code === 'NO_TEXT' || error.code === 'SUMMARY_TOO_LONG' || error.code === 'SUMMARY_TOO_SHORT') return 422;
  return 500;
}

router.get('/summary/providers', async (req, res) => {
  res.json({ providers: await listProviders() });
});

/**
 * A dry run: what the summary would cover, how long each part may be, and how
 * much of it is already cached. Costs nothing, so the page calls it on every
 * change. It never refuses an unavailable provider — the page still shows the
 * breakdown and says why the button is off.
 */
router.post('/summary/plan', async (req, res) => {
  const { request, error } = readRequest(req.body);
  if (error) return fail(res, error.status, error.code, error.message);

  try {
    const provider = PROVIDERS[request.provider];
    const state = await provider.status();
    const model =
      provider.local && request.model && state.models?.includes(request.model) ? request.model : state.model;
    const limits = provider.limits(model);

    const plan = planSummary(request.text, { ...request, limits });
    const cachedUnits = state.available ? countCached(plan, { provider, model, limits }) : 0;

    res.json({ ...publicPlan(plan), provider: provider.id, model, available: state.available, cachedUnits });
  } catch (planError) {
    const status = planStatus(planError);
    if (status === 500) logger.error('summary', `plan failed: ${planError.message}`);
    fail(res, status, planError.code || 'SUMMARY_FAILED', planError.message || 'Could not plan the summary.');
  }
});

/**
 * Writes the summary. The response is newline-delimited JSON, streamed: one
 * progress event per line and a final `done` (or `error`) line carrying the
 * result, so a run that takes minutes still shows movement. Anything that can be
 * refused before work starts is refused as ordinary JSON with a status code.
 */
router.post('/summary', async (req, res) => {
  const { request, error } = readRequest(req.body);
  if (error) return fail(res, error.status, error.code, error.message);

  if (isBusy()) {
    return fail(res, 409, 'SUMMARY_BUSY', 'A summary is already being written. Wait for it to finish, or cancel it.');
  }

  let resolved;
  let plan;
  try {
    resolved = await resolveProvider(request.provider, request.model);
    plan = planSummary(request.text, { ...request, limits: resolved.limits });
  } catch (planError) {
    const status = planError.code?.startsWith('SUMMARY_PROVIDER') ? 503 : planStatus(planError);
    return fail(res, status, planError.code || 'SUMMARY_FAILED', planError.message);
  }

  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event) => {
    if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(event)}\n`);
  };

  // Cancel = the client going away. `res`, never `req`: express.json() has
  // already drained the request, so `req` emits 'close' immediately on every
  // call (the bug documented in generate.js). Finished parts stay cached, so
  // pressing Summarize again carries on from where this stopped.
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });

  const heartbeat = setInterval(() => send({ type: 'tick' }), HEARTBEAT_MS);
  let written = 0;

  try {
    send({ type: 'plan', plan: publicPlan(plan), provider: resolved.provider.id, model: resolved.model });
    const result = await summarize({
      plan,
      resolved,
      fresh: Boolean(req.body?.fresh),
      signal: controller.signal,
      emit: (event) => {
        if (event.type === 'unit' && event.state === 'done') written = event.done;
        send(event);
      },
    });
    send({ type: 'done', result });
  } catch (runError) {
    const code = runError.code || 'SUMMARY_FAILED';
    if (code === 'CANCELLED') logger.info('summary', 'cancelled - finished parts are kept', { written });
    else logger.error('summary', `failed: ${runError.message}`, { code, written });
    const kept = written
      ? ` ${written} of ${plan.units.length} parts are saved, so Summarize carries on from there.`
      : '';
    send({
      type: 'error',
      code,
      done: written,
      total: plan.units.length,
      error: code === 'CANCELLED' ? `Summary cancelled.${kept}` : `${runError.message}${kept}`,
    });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

export default router;
