import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config/env.js';
import { llmError, cancelled, retryAfterFromHeader } from './errors.js';
import { parseJsonText } from './http.js';

const id = 'claude';
const label = 'Claude';
const vendor = 'Anthropic';
const local = false;

// Server-side refusal fallback: if Claude's safety classifiers decline a
// request, the API re-runs it on Anthropic's recommended fallback model inside
// the same call instead of returning a refusal. Only the Opus 5 / Fable 5
// families take the `"default"` form, so it is gated on the model name.
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const TAKES_DEFAULT_FALLBACK = /^claude-(opus-5|fable-5|mythos-5)/;

let client = null;

function getClient() {
  // maxRetries 0: callJson owns retries, so a rate-limit wait is reported to the
  // page instead of happening silently inside the SDK.
  if (!client) client = new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 0 });
  return client;
}

function defaultModel() {
  return config.claudeModel;
}

async function status() {
  const model = defaultModel();
  if (!config.anthropicApiKey) {
    return { available: false, reason: 'Set ANTHROPIC_API_KEY (or CLAUDE_API_KEY) in backend/.env.', model };
  }
  return { available: true, reason: null, model };
}

function limits() {
  return {
    maxInputWords: 60000,
    concurrency: config.summaryConcurrency,
    timeoutMs: config.summaryTimeoutMs,
  };
}

/** Most specific first: the SDK's classes inherit from one another. */
function fromSdkError(error, { signal, model }) {
  if (signal?.aborted || error instanceof Anthropic.APIUserAbortError) return cancelled();
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return llmError('LLM_TIMEOUT', 'Claude took too long to answer.', { retryable: true, cause: error });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return llmError('LLM_NETWORK', `Could not reach Anthropic (${error.message}).`, {
      retryable: true,
      cause: error,
    });
  }
  if (error instanceof Anthropic.RateLimitError) {
    return llmError('LLM_RATE_LIMITED', 'Claude is rate-limited right now (429).', {
      retryable: true,
      retryAfterMs: retryAfterFromHeader(error.headers?.get?.('retry-after')),
      status: 429,
      cause: error,
    });
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return llmError('LLM_AUTH', `Anthropic rejected the API key (${error.status}).`, {
      status: error.status,
      cause: error,
    });
  }
  if (error instanceof Anthropic.NotFoundError) {
    return llmError('LLM_MODEL_MISSING', `The Claude model "${model}" is not available (404).`, {
      status: 404,
      cause: error,
    });
  }
  if (error instanceof Anthropic.BadRequestError) {
    const detail = String(error.message || '');
    if (/credit balance/i.test(detail)) {
      return llmError('LLM_AUTH', 'The Anthropic account is out of credit.', { status: 400, cause: error });
    }
    return llmError('LLM_BAD_REQUEST', `Claude refused the request: ${detail.slice(0, 160)}`, {
      status: 400,
      cause: error,
    });
  }
  if (error instanceof Anthropic.APIError && (error.status >= 500 || error.status === 529)) {
    return llmError('LLM_SERVER', `Anthropic is overloaded or having trouble (${error.status}).`, {
      retryable: true,
      retryAfterMs: retryAfterFromHeader(error.headers?.get?.('retry-after')),
      status: error.status,
      cause: error,
    });
  }
  return llmError('LLM_BAD_REQUEST', `Claude failed: ${error.message}`, { cause: error });
}

async function generateJson({ system, prompt, schema, model, signal }) {
  const params = {
    model,
    max_tokens: 16000,
    system,
    messages: [{ role: 'user', content: prompt }],
    // Structured outputs: the answer is constrained to this schema, so there is
    // no fence or preamble to strip. No `temperature` — Opus 5 rejects it.
    output_config: { format: { type: 'json_schema', schema } },
  };
  if (TAKES_DEFAULT_FALLBACK.test(model)) {
    params.betas = [FALLBACK_BETA];
    params.fallbacks = 'default';
  }

  let response;
  try {
    response = await getClient().beta.messages.create(params, {
      signal,
      timeout: limits().timeoutMs,
    });
  } catch (error) {
    throw fromSdkError(error, { signal, model });
  }

  // stop_reason is checked before content is read: a refusal still arrives as
  // HTTP 200.
  if (response.stop_reason === 'refusal') {
    throw llmError('LLM_BLOCKED', 'Claude declined to summarize this part of the book.');
  }
  if (response.stop_reason === 'max_tokens') {
    throw llmError('LLM_TRUNCATED', 'Claude ran out of room before finishing its answer.', {
      retryable: true,
    });
  }
  if (response.stop_reason === 'model_context_window_exceeded') {
    throw llmError('LLM_TOO_LARGE', 'That part of the book is too long for Claude.');
  }

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
  return parseJsonText(text, label);
}

export { id, label, vendor, local, defaultModel, status, limits, generateJson };
