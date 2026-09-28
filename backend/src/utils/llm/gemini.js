import { config } from '../../config/env.js';
import { llmError } from './errors.js';
import { postJson, parseJsonText } from './http.js';

// Plain fetch, never @google/genai — see CLAUDE.md. Same endpoint and header as
// utils/gemini.js (the music mood) and utils/narrator.js (Clean with AI).
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

const id = 'gemini';
const label = 'Gemini';
const vendor = 'Google';
const local = false;

function defaultModel() {
  return config.summaryGeminiModel || config.geminiModel;
}

async function status() {
  const model = defaultModel();
  if (!config.geminiApiKey) {
    return { available: false, reason: 'Set GEMINI_API_KEY in backend/.env.', model };
  }
  return { available: true, reason: null, model };
}

function limits() {
  // The context is far larger than this; the cap keeps one request well inside
  // the free tier's tokens-per-minute limit, so a rate limit costs one retry
  // rather than a string of them.
  return {
    maxInputWords: 60000,
    concurrency: config.summaryConcurrency,
    timeoutMs: config.summaryTimeoutMs,
  };
}

/**
 * Gemini's responseSchema is an OpenAPI subset and rejects `additionalProperties`,
 * which the Claude adapter needs. The shared schemas carry it; it is stripped here.
 */
function toGeminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'additionalProperties' || key === '$schema') continue;
    out[key] = toGeminiSchema(value);
  }
  return out;
}

/** Gemini states its wait in the body: `"retryDelay": "17s"`. */
function retryDelayFromBody(raw) {
  const match = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(String(raw || ''));
  return match ? Number(match[1]) * 1000 : null;
}

/**
 * The free tier has a per-day request quota as well as per-minute ones —
 * measured: 20 requests a day for gemini-3.6-flash. Its 429 still carries a
 * "retry in 39s" hint, so without this the retry loop would spend two minutes
 * waiting on a limit that resets at midnight Pacific time.
 */
function dailyQuota(error, model) {
  if (error.code !== 'LLM_RATE_LIMITED' || !/PerDay/i.test(error.detail || '')) return error;
  const limit = /limit:\s*(\d+)/.exec(error.detail)?.[1];
  return llmError(
    'LLM_QUOTA',
    `Gemini's daily quota for ${model} is used up${limit ? ` (${limit} requests a day on the free tier)` : ''}. ` +
      'It resets at midnight Pacific time. Try another provider, or enable billing on the Google project.',
    { status: 429, cause: error },
  );
}

async function generateJson({ system, prompt, schema, model, signal }) {
  const url = `${ENDPOINT}/${encodeURIComponent(model)}:generateContent`;

  const body = await postJson(url, {
    headers: { 'x-goog-api-key': config.geminiApiKey },
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: 'application/json',
        responseSchema: toGeminiSchema(schema),
      },
    },
    timeoutMs: limits().timeoutMs,
    signal,
    vendor: label,
    model,
    retryAfterFromBody: retryDelayFromBody,
  }).catch((error) => {
    throw dailyQuota(error, model);
  });

  if (body?.promptFeedback?.blockReason) {
    throw llmError('LLM_BLOCKED', `Gemini declined this part of the book (${body.promptFeedback.blockReason}).`, {
      retryable: false,
    });
  }

  const candidate = body?.candidates?.[0];
  const finish = candidate?.finishReason;

  // RECITATION is Gemini refusing to reproduce copyrighted text verbatim, which
  // a book summary can trip by quoting. The summarizer retries once without
  // quotations when it sees LLM_BLOCKED.
  if (finish === 'RECITATION' || finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT') {
    throw llmError('LLM_BLOCKED', `Gemini declined to answer (${finish}).`);
  }
  if (finish === 'MAX_TOKENS') {
    throw llmError('LLM_TRUNCATED', 'Gemini ran out of room before finishing its answer.', {
      retryable: true,
    });
  }

  const parts = candidate?.content?.parts;
  // Thinking models return their reasoning as parts flagged `thought`; only the
  // answer parts carry the JSON.
  const text = Array.isArray(parts)
    ? parts.filter((part) => !part.thought).map((part) => part.text || '').join('')
    : '';
  return parseJsonText(text, label);
}

export { id, label, vendor, local, defaultModel, status, limits, generateJson };
