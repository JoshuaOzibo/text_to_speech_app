import { config } from '../../config/env.js';
import { llmError } from './errors.js';
import { postJson, parseJsonText } from './http.js';

/**
 * A model served by Ollama on this machine. The only provider that keeps the
 * book on the PC, and by far the slowest: on this 4-core CPU a 7B model reads
 * a few dozen tokens a second, so a long book is hours, not minutes.
 */
const id = 'ollama';
const label = 'Ollama';
const vendor = 'this PC';
const local = true;

const SUGGESTED_MODEL = 'qwen2.5:7b';

// Tokens kept free in the context window for the instructions and the answer.
// The context has to hold all three; Ollama silently drops the start of a
// prompt that does not fit, which here would be the start of a chapter.
const RESERVED_TOKENS = 6000;
const TOKENS_PER_WORD = 1.4;

function baseUrl() {
  return config.ollamaUrl.replace(/\/+$/, '');
}

function defaultModel() {
  return config.ollamaModel;
}

async function installedModels() {
  const response = await fetch(`${baseUrl()}/api/tags`, { signal: AbortSignal.timeout(1500) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return (body.models || []).map((entry) => entry.name).filter(Boolean);
}

async function status() {
  let models;
  try {
    models = await installedModels();
  } catch {
    return {
      available: false,
      reason: `Ollama isn't running on this PC (looked at ${baseUrl()}).`,
      model: defaultModel() || SUGGESTED_MODEL,
      models: [],
    };
  }

  if (!models.length) {
    return {
      available: false,
      reason: `Ollama has no models yet. Run: ollama pull ${SUGGESTED_MODEL}`,
      model: SUGGESTED_MODEL,
      models,
    };
  }

  const configured = defaultModel();
  if (configured && !models.includes(configured)) {
    return {
      available: false,
      reason: `OLLAMA_MODEL is "${configured}", which isn't pulled. Run: ollama pull ${configured}`,
      model: configured,
      models,
    };
  }

  return { available: true, reason: null, model: configured || models[0], models };
}

function limits() {
  return {
    maxInputWords: Math.max(2000, Math.floor((config.ollamaNumCtx - RESERVED_TOKENS) / TOKENS_PER_WORD)),
    concurrency: 1,
    timeoutMs: config.ollamaTimeoutMs,
  };
}

async function generateJson({ system, prompt, schema, model, signal }) {
  let body;
  try {
    body = await postJson(`${baseUrl()}/api/chat`, {
      body: {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        // A JSON Schema here constrains decoding (Ollama 0.5+), so a small model
        // cannot wander off the shape.
        format: schema,
        stream: false,
        keep_alive: '15m',
        options: { temperature: 0.3, num_ctx: config.ollamaNumCtx },
      },
      timeoutMs: limits().timeoutMs,
      signal,
      vendor: 'Ollama',
      model,
    });
  } catch (error) {
    // Refused outright means the server is not running. Retrying a closed port
    // five times over a minute only delays the message.
    if (error.code === 'LLM_NETWORK' && /ECONNREFUSED/.test(error.message)) {
      throw llmError('LLM_UNAVAILABLE', "Ollama isn't running on this PC.", { cause: error });
    }
    if (error.code === 'LLM_MODEL_MISSING') {
      throw llmError('LLM_MODEL_MISSING', `Ollama doesn't have "${model}". Run: ollama pull ${model}`, {
        cause: error,
      });
    }
    throw error;
  }

  if (body?.done_reason === 'length') {
    throw llmError('LLM_TRUNCATED', 'The local model ran out of room before finishing its answer.', {
      retryable: true,
    });
  }
  return parseJsonText(body?.message?.content, 'Ollama');
}

export { id, label, vendor, local, defaultModel, status, limits, generateJson };
