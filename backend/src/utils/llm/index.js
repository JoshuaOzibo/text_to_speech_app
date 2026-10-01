import * as gemini from './gemini.js';
import * as claude from './claude.js';
import * as deepseek from './deepseek.js';
import * as groq from './groq.js';
import * as mistral from './mistral.js';
import * as openrouter from './openrouter.js';
import * as ollama from './ollama.js';
import { llmError, cancelled } from './errors.js';

/**
 * The AI providers a summary can be written by. Same shape as ENGINES in
 * ttsEngine.js: adding another means one new file here plus an entry below.
 * One that speaks the OpenAI chat dialect is mostly a call to openaiChat.js.
 *
 * Every adapter exports `id`, `label`, `vendor`, `local`, `freeTier`, `keyUrl`
 * (where to get a key, or for Ollama the installer), `defaultModel()`, `status()`, `limits()` and `generateJson({ system, prompt,
 * schema, model, signal })`, which resolves to the parsed JSON answer or throws
 * an error from errors.js. `status()` may add a `note`: a sentence the page
 * shows under the provider, for a free tier's limits or data terms.
 */
const PROVIDERS = { gemini, groq, mistral, openrouter, claude, deepseek, ollama };

// Free tiers first, then the paid cloud providers, then the one on this PC.
const ORDER = ['gemini', 'groq', 'mistral', 'openrouter', 'claude', 'deepseek', 'ollama'];

const MAX_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 5000;
const MAX_WAIT_MS = 60000;

async function listProviders() {
  return Promise.all(
    ORDER.map(async (key) => {
      const provider = PROVIDERS[key];
      const state = await provider.status();
      return {
        id: provider.id,
        label: provider.label,
        vendor: provider.vendor,
        local: provider.local,
        freeTier: provider.freeTier,
        keyUrl: provider.keyUrl,
        note: null,
        ...state,
      };
    }),
  );
}

/**
 * The provider plus the model it will actually run. A model chosen on the page
 * is honoured only for Ollama, and only when it is installed; the cloud models
 * come from backend/.env, so the browser can never pick an arbitrary one.
 */
async function resolveProvider(providerId, requestedModel) {
  const provider = PROVIDERS[providerId];
  if (!provider) {
    throw llmError('SUMMARY_PROVIDER_UNKNOWN', `There is no summary provider called "${providerId}".`);
  }

  const state = await provider.status();
  if (!state.available) {
    throw llmError('SUMMARY_PROVIDER_UNAVAILABLE', state.reason || `${provider.label} is not available.`);
  }

  const model =
    provider.local && requestedModel && state.models?.includes(requestedModel) ? requestedModel : state.model;

  return { provider, model, limits: provider.limits(model) };
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancelled());
    const handle = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(handle);
      reject(cancelled());
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * The one retry loop. Adapters never retry on their own (the Anthropic SDK is
 * built with maxRetries 0 for this reason), so every wait passes through here
 * and is reported through `onWait` — the page says "rate-limited, trying again
 * in 20s" instead of sitting silent for a minute.
 */
async function callJson({ provider, model }, request, { signal, onWait } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await provider.generateJson({ ...request, model, signal });
    } catch (error) {
      if (signal?.aborted || error.code === 'CANCELLED') throw cancelled();
      if (!error.retryable || attempt >= MAX_ATTEMPTS) throw error;

      const backoff = BASE_BACKOFF_MS * 2 ** (attempt - 1);
      const wait = Math.min(MAX_WAIT_MS, Math.max(1000, error.retryAfterMs ?? backoff));
      onWait?.({ seconds: Math.ceil(wait / 1000), reason: error.message, attempt });
      await sleep(wait, signal);
    }
  }
}

export { PROVIDERS, listProviders, resolveProvider, callJson };
