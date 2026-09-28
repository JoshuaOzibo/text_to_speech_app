import { llmError, cancelled, fromHttpStatus, retryAfterFromHeader } from './errors.js';

/**
 * One JSON POST for the fetch-based adapters (Gemini, DeepSeek, Ollama).
 *
 * The caller's `signal` (the user pressing Cancel, or closing the tab) and the
 * per-call timeout are combined, and told apart afterwards: a cancel must never
 * be retried, a timeout may be.
 */
async function postJson(url, { headers = {}, body, timeoutMs, signal, vendor, model, retryAfterFromBody }) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let response;
  let raw;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: combined,
    });
    // Reading the body is inside the try on purpose: a cancel or a timeout can
    // land while a long answer is still arriving.
    raw = await response.text();
  } catch (error) {
    throw fromFetchError(error, { signal, vendor, timeoutMs });
  }

  if (!response.ok) {
    const retryAfterMs =
      retryAfterFromHeader(response.headers.get('retry-after')) ??
      (retryAfterFromBody ? retryAfterFromBody(raw) : null);
    throw fromHttpStatus(response.status, raw, { vendor, model, retryAfterMs });
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw llmError('LLM_BAD_RESPONSE', `${vendor} sent a reply that is not JSON.`, { cause: error });
  }
}

function fromFetchError(error, { signal, vendor, timeoutMs }) {
  if (signal?.aborted) return cancelled();
  if (error.name === 'TimeoutError') {
    const minutes = Math.round(timeoutMs / 60000);
    return llmError(
      'LLM_TIMEOUT',
      `${vendor} took longer than ${minutes > 0 ? `${minutes} min` : `${Math.round(timeoutMs / 1000)}s`} to answer.`,
      { retryable: true, cause: error },
    );
  }
  const reason = error.cause?.code || error.cause?.message || error.message;
  return llmError('LLM_NETWORK', `Could not reach ${vendor} (${reason}).`, {
    retryable: true,
    cause: error,
  });
}

/**
 * Pulls the JSON object out of a model's text answer.
 *
 * Providers that constrain decoding (Gemini, Claude, Ollama) return bare JSON,
 * but DeepSeek's json mode and small local models have both been seen wrapping
 * it in a ```json fence or a sentence of preamble. Taking the outermost braces
 * handles both without guessing at anything inside them.
 */
function parseJsonText(text, vendor) {
  const source = String(text || '').trim();
  if (!source) throw llmError('LLM_BAD_RESPONSE', `${vendor} sent an empty answer.`);

  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  const candidate = start >= 0 && end > start ? source.slice(start, end + 1) : source;

  try {
    return JSON.parse(candidate);
  } catch (error) {
    throw llmError('LLM_BAD_RESPONSE', `${vendor} sent an answer that is not valid JSON.`, {
      retryable: true,
      cause: error,
    });
  }
}

export { postJson, parseJsonText };
