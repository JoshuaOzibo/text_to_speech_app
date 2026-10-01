import { config } from '../../config/env.js';
import { llmError } from './errors.js';
import { chatJson } from './openaiChat.js';

/**
 * OpenRouter: one key (openrouter.ai, no card) in front of many hosts, some of
 * which serve open models for free under ids ending in `:free`. Checked on
 * 2026-09-28 against openrouter.ai/docs/api_reference/limits: free models
 * allow 20 requests a minute and **50 a day across all of them**, or 1,000 a
 * day once the account has ever bought $10 of credit. A long summary is a
 * dozen or so requests, so the daily cap is the limit that matters.
 *
 * The free line-up changes month to month; 17 were listed that day. So the
 * model is not trusted blind: the public model list (no key, no book text) is
 * read and cached, a configured model that has vanished is reported before
 * anything is sent, and with OPENROUTER_MODEL empty one still listed is picked
 * automatically. The same list says how each model can be asked for JSON.
 */
const id = 'openrouter';
const label = 'OpenRouter';
const vendor = 'OpenRouter';
const local = false;
const freeTier = true;
// Where the user creates a key; the page links to it while this is not set up.
const keyUrl = 'https://openrouter.ai/settings/keys';

const BASE_URL = 'https://openrouter.ai/api/v1';

// Tried in order when OPENROUTER_MODEL is empty. All three take structured
// output and a 262K context; the 120B Nemotron is the largest of them.
const PREFERRED = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'qwen/qwen3.8-27b:free',
  'google/gemma-4-31b-it:free',
];
// Free models that are not general writers: classifiers and code models.
const NOT_A_WRITER = /safety|guard|code|coder/i;
const MIN_CONTEXT = 32000;

const CATALOGUE_TTL_MS = 10 * 60 * 1000;
const OUTPUT_TOKENS = 16000;

const FREE_NOTE =
  'Free models: 50 requests a day across all of them, or 1,000 once the account has ever bought $10 of credit. ' +
  'The hosts of free models may log or train on what you send.';

let catalogue = null;

function describe(model) {
  const params = model.supported_parameters || [];
  return {
    free: model.id.endsWith(':free'),
    context: model.context_length || 0,
    maxOutput: model.top_provider?.max_completion_tokens || null,
    format: params.includes('structured_outputs') ? 'strict' : params.includes('response_format') ? 'object' : 'prompt',
    effort: params.includes('reasoning_effort'),
  };
}

/** The public model list, cached. `null` when it cannot be read and never has been. */
async function readCatalogue() {
  if (catalogue && Date.now() - catalogue.at < CATALOGUE_TTL_MS) return catalogue.models;
  try {
    const response = await fetch(`${BASE_URL}/models`, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    const models = new Map((body.data || []).map((model) => [model.id, describe(model)]));
    catalogue = { at: Date.now(), models };
    return models;
  } catch {
    // A stale list beats none; no list at all means the request decides.
    return catalogue?.models ?? null;
  }
}

function freeWriters(models) {
  return [...models]
    .filter(([key, model]) => model.free && model.context >= MIN_CONTEXT && !NOT_A_WRITER.test(key))
    .sort(([, a], [, b]) => (b.format === 'strict') - (a.format === 'strict') || b.context - a.context)
    .map(([key]) => key);
}

function pickFree(models) {
  return PREFERRED.find((key) => models.get(key)?.free) ?? freeWriters(models)[0] ?? null;
}

function defaultModel() {
  return config.openrouterModel || PREFERRED[0];
}

async function status() {
  const configured = config.openrouterModel;
  if (!config.openrouterApiKey) {
    return {
      available: false,
      reason: 'Set OPENROUTER_API_KEY in backend/.env. A free key from openrouter.ai needs no card.',
      model: defaultModel(),
    };
  }

  const models = await readCatalogue();
  if (!models) {
    return { available: true, reason: null, model: defaultModel(), note: FREE_NOTE };
  }

  if (configured) {
    if (!models.has(configured)) {
      const options = freeWriters(models).slice(0, 3);
      return {
        available: false,
        reason:
          `OpenRouter no longer lists "${configured}".` +
          `${options.length ? ` Free models right now include ${options.join(', ')}.` : ''}` +
          ' Set OPENROUTER_MODEL to one of them, or leave it empty to pick one automatically.',
        model: configured,
      };
    }
    return {
      available: true,
      reason: null,
      model: configured,
      note: models.get(configured).free ? FREE_NOTE : 'This is a paid model, billed to your OpenRouter credit.',
    };
  }

  const model = pickFree(models);
  if (!model) {
    return { available: false, reason: 'OpenRouter lists no free models right now.', model: defaultModel() };
  }
  return { available: true, reason: null, model, note: FREE_NOTE };
}

function limits() {
  // Every free default takes 262K tokens. Big passages mean few requests, and
  // requests are what the 50-a-day cap counts.
  return {
    maxInputWords: 50000,
    concurrency: config.summaryConcurrency,
    timeoutMs: config.summaryTimeoutMs,
  };
}

/** OpenRouter's error bodies are `{ error: { message, metadata } }`. */
function bodyMessage(detail) {
  try {
    return JSON.parse(detail)?.error?.message || '';
  } catch {
    return '';
  }
}

function explain(error, model) {
  const detail = error.detail || '';

  if (error.code === 'LLM_RATE_LIMITED' && /free-models-per-day/i.test(detail)) {
    const limit = /X-RateLimit-Limit"\s*:\s*"?(\d+)/i.exec(detail)?.[1];
    const reset = Number(/X-RateLimit-Reset"\s*:\s*"?(\d{10,13})/i.exec(detail)?.[1]);
    const resetAt = reset ? new Date(reset < 1e12 ? reset * 1000 : reset) : null;
    return llmError(
      'LLM_QUOTA',
      `OpenRouter's free allowance of ${limit || 50} requests a day is used up. ` +
        `It resets ${resetAt ? `at ${resetAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'once a day'}; ` +
        'having ever bought $10 of credit raises it to 1,000 a day. The parts already written are saved.',
      { status: 429, cause: error },
    );
  }

  if (error.code === 'LLM_MODEL_MISSING') {
    // The list is stale if the model has gone; the next status() re-reads it.
    catalogue = null;
    const reason = bodyMessage(detail);
    if (/data policy|privacy/i.test(reason)) {
      return llmError(
        'LLM_MODEL_MISSING',
        `Your OpenRouter privacy settings rule out every host of ${model}. Free models need their hosts ` +
          'allowed at openrouter.ai/settings/privacy.',
        { status: error.status, cause: error },
      );
    }
    return llmError(
      'LLM_MODEL_MISSING',
      `OpenRouter could not serve ${model}${reason ? ` (${reason})` : ''}. Reopen the Summarize page to pick another free model.`,
      { status: error.status, cause: error },
    );
  }

  return error;
}

async function generateJson({ system, prompt, schema, model, signal }) {
  const known = catalogue?.models.get(model);
  const extra = {
    // Only hosts that honour every parameter sent, so a json_schema request is
    // never quietly routed to one that would ignore it.
    provider: { require_parameters: true },
  };
  if (known?.effort) extra.reasoning = { effort: 'low' };

  try {
    return await chatJson({
      baseUrl: BASE_URL,
      headers: { Authorization: `Bearer ${config.openrouterApiKey}` },
      label,
      model,
      system,
      prompt,
      schema,
      format: known?.format ?? 'strict',
      maxTokens: Math.min(OUTPUT_TOKENS, known?.maxOutput || OUTPUT_TOKENS),
      extra,
      timeoutMs: limits().timeoutMs,
      signal,
    });
  } catch (error) {
    throw explain(error, model);
  }
}

export { id, label, vendor, local, freeTier, keyUrl, defaultModel, status, limits, generateJson };
