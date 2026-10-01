import { config } from '../../config/env.js';
import { llmError } from './errors.js';
import { chatJson, formatWait } from './openaiChat.js';

/**
 * Groq's free tier: a key from console.groq.com, no card. Checked against
 * console.groq.com/docs/rate-limits on 2026-09-28, openai/gpt-oss-120b gets
 * 30 requests a minute, 1,000 a day, 8,000 tokens a minute and 200,000 tokens
 * a day. Fast, but the per-minute token limit shapes everything below:
 *
 * - Groq charges a request against that limit at the max_completion_tokens it
 *   *declares*, not what it ends up using, and refuses (413) any single request
 *   bigger than the whole minute's allowance. So the prompt and the answer's
 *   ceiling together must fit in 8,000 tokens, which is why passages are small
 *   here (~2,500 words against 50,000+ elsewhere) and why the ceiling is worked
 *   out per request from the prompt's size instead of being a constant.
 * - 200,000 tokens a day is a book of roughly 100,000 words. A longer one runs
 *   out part-way; the finished parts are cached, so it carries on the next day.
 *
 * GROQ_TOKENS_PER_MINUTE raises the ceiling for a paid (Dev tier) account.
 */
const id = 'groq';
const label = 'Groq';
const vendor = 'Groq';
const local = false;
const freeTier = true;
// Where the user creates a key; the page links to it while this is not set up.
const keyUrl = 'https://console.groq.com/keys';

const BASE_URL = 'https://api.groq.com/openai/v1';

const TOKENS_PER_WORD = 1.4;
// A full unit's answer is up to 1,500 words (~2,000 tokens) and gpt-oss spends
// some tokens reasoning first, even at low effort.
const OUTPUT_TOKENS = 3000;
// The system prompt, the book lines (with up to 60 section titles) and the
// instructions around the passages.
const PROMPT_OVERHEAD_TOKENS = 1500;
const MIN_OUTPUT_TOKENS = 1024;
// Deliberately low: English runs nearer 4 characters a token on gpt-oss's
// tokenizer. Overestimating the prompt only trims the answer's ceiling;
// underestimating it gets the request refused.
const CHARS_PER_TOKEN = 3.6;
const SAFETY_TOKENS = 150;

// Models that take strict json_schema on Groq (console.groq.com/docs/structured-outputs).
const STRICT_MODELS = /^(openai\/gpt-oss-(20b|120b)|qwen\/qwen3)/;

function defaultModel() {
  return config.groqModel;
}

async function status() {
  const model = defaultModel();
  if (!config.groqApiKey) {
    return {
      available: false,
      reason: 'Set GROQ_API_KEY in backend/.env. A free key from console.groq.com needs no card.',
      model,
    };
  }
  return {
    available: true,
    reason: null,
    model,
    note: 'Free tier: 200,000 tokens a day, about a 100,000-word book. A longer book stops part-way; the parts are saved and it carries on the next day.',
  };
}

function limits() {
  const room = config.groqTokensPerMinute - OUTPUT_TOKENS - PROMPT_OVERHEAD_TOKENS;
  return {
    maxInputWords: Math.max(1000, Math.floor(room / TOKENS_PER_WORD)),
    // Two requests at once would each want most of the minute's tokens, so the
    // second would only ever wait for the first.
    concurrency: 1,
    timeoutMs: config.summaryTimeoutMs,
  };
}

/** The answer's ceiling: whatever the minute's allowance leaves after the prompt. */
function outputCeiling(system, prompt, schema) {
  const chars = system.length + prompt.length + JSON.stringify(schema).length;
  const promptTokens = Math.ceil(chars / CHARS_PER_TOKEN);
  const room = config.groqTokensPerMinute - promptTokens - SAFETY_TOKENS;
  return Math.max(MIN_OUTPUT_TOKENS, Math.min(OUTPUT_TOKENS, room));
}

/** Per-model reasoning switches (console.groq.com/docs/reasoning). */
function reasoningFor(model) {
  // gpt-oss rejects reasoning_format with a 400; it takes these two instead.
  if (/^openai\/gpt-oss/.test(model)) return { reasoning_effort: 'low', include_reasoning: false };
  if (/^qwen\/qwen3/.test(model)) return { reasoning_effort: 'none' };
  return {};
}

/**
 * Turns Groq's failures into sentences worth reading. A 429 "on tokens per day"
 * whose wait is past what the retry loop will sit through is a spent daily
 * allowance, not a blip; retrying it five times only delays the message.
 */
function explain(error, model) {
  const detail = error.detail || '';

  if (error.code === 'LLM_RATE_LIMITED' && /per day/i.test(detail)) {
    const wait = error.retryAfterMs;
    if (wait != null && wait <= 60000) return error;
    const unit = /tokens per day/i.test(detail) ? 'tokens' : 'requests';
    const limit = /Limit\s+(\d+)/i.exec(detail)?.[1];
    return llmError(
      'LLM_QUOTA',
      `Groq's free daily allowance for ${model} is used up` +
        `${limit ? ` (${Number(limit).toLocaleString('en-US')} ${unit} a day)` : ''}. ` +
        `${wait ? `It frees up again in about ${formatWait(wait)}. ` : ''}` +
        'The parts already written are saved, so pressing Summarize then carries on from here.',
      { status: 429, cause: error },
    );
  }

  if (error.code === 'LLM_TOO_LARGE') {
    return llmError(
      'LLM_TOO_LARGE',
      `That part of the book is too big for Groq's free tier, which allows ${config.groqTokensPerMinute.toLocaleString('en-US')} ` +
        'tokens a minute including the answer. Try another provider for this book.',
      { status: error.status, cause: error },
    );
  }

  // The model's output failed Groq's own schema validation. A fresh sample
  // usually passes, so this one is worth another try.
  if (error.code === 'LLM_BAD_REQUEST' && /json_validate_failed|Failed to generate JSON/i.test(detail)) {
    return llmError('LLM_BAD_RESPONSE', 'Groq sent an answer that did not match the expected shape.', {
      retryable: true,
      status: error.status,
      cause: error,
    });
  }

  return error;
}

async function generateJson({ system, prompt, schema, model, signal }) {
  try {
    return await chatJson({
      baseUrl: BASE_URL,
      headers: { Authorization: `Bearer ${config.groqApiKey}` },
      label,
      model,
      system,
      prompt,
      schema,
      format: STRICT_MODELS.test(model) ? 'strict' : 'loose',
      maxTokens: outputCeiling(system, prompt, schema),
      maxTokensField: 'max_completion_tokens',
      extra: reasoningFor(model),
      timeoutMs: limits().timeoutMs,
      signal,
    });
  } catch (error) {
    throw explain(error, model);
  }
}

export { id, label, vendor, local, freeTier, keyUrl, defaultModel, status, limits, generateJson };
