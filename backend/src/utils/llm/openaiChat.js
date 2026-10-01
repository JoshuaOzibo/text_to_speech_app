import { llmError } from './errors.js';
import { postJson, parseJsonText } from './http.js';

/**
 * One call to an OpenAI-compatible `/chat/completions` endpoint — the dialect
 * DeepSeek, Groq, Mistral and OpenRouter all speak. Each adapter keeps what is
 * genuinely its own (key, limits, quota wording, model quirks) and hands the
 * request shape and the answer checks to this, so the four cannot drift apart
 * on what a truncated or refused answer means.
 *
 * `format` is how the JSON is asked for, strongest first:
 *   'strict'  json_schema with strict: true. Decoding is constrained to the
 *             schema, so the shape is guaranteed. The shared schemas already
 *             meet strict mode's rules: every field required, and
 *             additionalProperties false on every object.
 *   'loose'   json_schema with strict: false, for models the provider can
 *             only steer on a best-effort basis.
 *   'object'  json_object mode: valid JSON but no particular shape. It
 *             requires the word "json" in the prompt, so the schema is spelled
 *             out in the system message.
 *   'prompt'  no response_format at all, for a model that accepts none; the
 *             schema is only described in the system message.
 * The caller shape-checks what comes back whichever is used.
 */
async function chatJson({
  baseUrl,
  headers = {},
  label,
  model,
  system,
  prompt,
  schema,
  format = 'object',
  maxTokens,
  maxTokensField = 'max_tokens',
  extra = {},
  timeoutMs,
  signal,
  retryAfterFromBody,
}) {
  const constrained = format === 'strict' || format === 'loose';
  const instructions = constrained
    ? system
    : `${system}\n\nReply with a single json object that matches this JSON Schema ` +
      `exactly, and nothing else:\n${JSON.stringify(schema)}`;

  const request = {
    model,
    messages: [
      { role: 'system', content: instructions },
      { role: 'user', content: prompt },
    ],
    temperature: 0.3,
    [maxTokensField]: maxTokens,
    stream: false,
    ...extra,
  };
  if (constrained) {
    request.response_format = {
      type: 'json_schema',
      json_schema: { name: 'answer', strict: format === 'strict', schema },
    };
  } else if (format === 'object') {
    request.response_format = { type: 'json_object' };
  }

  const body = await postJson(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    headers,
    body: request,
    timeoutMs,
    signal,
    vendor: label,
    model,
    retryAfterFromBody,
  });

  // OpenRouter reports a model host failing mid-request as a 200 that carries
  // an error object instead of an answer.
  const upstream = body?.error || body?.choices?.[0]?.error;
  if (upstream) {
    const detail = upstream.message || upstream.code || 'no detail given';
    throw llmError('LLM_SERVER', `${label} could not get an answer from ${model} (${detail}).`, {
      retryable: true,
    });
  }

  const choice = body?.choices?.[0];
  if (choice?.finish_reason === 'length') {
    throw llmError('LLM_TRUNCATED', `${label} ran out of room before finishing its answer.`, {
      retryable: true,
    });
  }
  if (choice?.finish_reason === 'content_filter') {
    throw llmError('LLM_BLOCKED', `${label} declined to summarize this part of the book.`);
  }
  return parseJsonText(choice?.message?.content, label);
}

/** "3 h 10 min", "14 min", "45s": how long until a daily allowance frees up. */
function formatWait(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
}

export { chatJson, formatWait };
