/**
 * Errors shared by every summary provider.
 *
 * A leaf module, because index.js imports every adapter and every adapter needs
 * these — importing them from index.js would be a cycle.
 *
 * Always a freshly constructed Error. Setting `.code` on an error caught from
 * fetch or an SDK is how downloadTrack crashed on a DOMException whose `code` is
 * a getter; the original is kept as `.cause` instead.
 *
 * `retryable` is what callJson reads. Only failures that can plausibly clear on
 * their own are marked: a rate limit, an overloaded or failing server, a network
 * blip, a timeout. A bad key, a missing model or a refusal will say the same
 * thing every time, so retrying them only delays the message.
 */
function llmError(code, message, { retryable = false, retryAfterMs = null, status, cause } = {}) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.retryable = retryable;
  error.retryAfterMs = retryAfterMs;
  if (status !== undefined) error.status = status;
  return error;
}

function cancelled() {
  return llmError('CANCELLED', 'Summary cancelled.');
}

/** `Retry-After` is seconds (or, rarely, an HTTP date). */
function retryAfterFromHeader(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

/**
 * Maps an HTTP failure to a coded error with a sentence for the end user.
 * `detail` is the response body, used to recognise a few well-known cases, and
 * kept on the error as `.detail` so an adapter can recognise its own: a
 * per-minute limit (wait and retry) against a per-day quota (retrying for hours
 * will not help), or OpenRouter's 404 for a privacy setting rather than a
 * missing model.
 */
function fromHttpStatus(status, detail, options) {
  const text = String(detail || '');
  const error = classifyHttpError(status, text, options);
  error.detail = text.slice(0, 4000);
  return error;
}

function classifyHttpError(status, text, { vendor, model, retryAfterMs = null }) {
  if (status === 429) {
    return llmError('LLM_RATE_LIMITED', `${vendor} is rate-limited or out of quota (429).`, {
      retryable: true,
      retryAfterMs,
      status,
    });
  }
  if (status === 401 || status === 403 || (status === 400 && /api[ _-]?key/i.test(text))) {
    return llmError('LLM_AUTH', `${vendor} rejected the API key (${status}).`, { status });
  }
  if (status === 402 || (status < 500 && /credit balance|insufficient balance|billing/i.test(text))) {
    return llmError('LLM_AUTH', `${vendor} says the account is out of credit (${status}).`, {
      status,
    });
  }
  if (status === 404) {
    return llmError('LLM_MODEL_MISSING', `The ${vendor} model "${model}" is not available (404).`, {
      status,
    });
  }
  if (status === 413 || (status === 400 && /context length|context window|too long|maximum.*tokens/i.test(text))) {
    return llmError('LLM_TOO_LARGE', `That part of the book is too long for ${vendor} (${status}).`, {
      status,
    });
  }
  if (status >= 500) {
    return llmError('LLM_SERVER', `${vendor} is having trouble right now (${status}).`, {
      retryable: true,
      retryAfterMs,
      status,
    });
  }
  const snippet = text.replace(/\s+/g, ' ').slice(0, 160);
  return llmError('LLM_BAD_REQUEST', `${vendor} refused the request (${status})${snippet ? `: ${snippet}` : '.'}`, {
    status,
  });
}

export { llmError, cancelled, retryAfterFromHeader, fromHttpStatus };
