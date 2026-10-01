import { config } from '../../config/env.js';
import { llmError } from './errors.js';
import { chatJson } from './openaiChat.js';

/**
 * Mistral's free "Experiment" plan: a key from console.mistral.ai after a
 * one-time phone check, no card, with access to every API model. Mistral does
 * not publish the free limits any more; each account sees its own on the
 * Limits page of the admin console. What is public (checked 2026-09-28):
 *
 * - The free plan may use what is sent to train Mistral's models unless that is
 *   switched off in the console's privacy settings. Here that is a whole book,
 *   so the page says so beside the button.
 * - The large models take 128K tokens and more, so a passage can be as long as
 *   on Gemini or Claude and a whole book is a handful of requests.
 */
const id = 'mistral';
const label = 'Mistral';
const vendor = 'Mistral AI';
const local = false;
const freeTier = true;
// Where the user creates a key; the page links to it while this is not set up.
const keyUrl = 'https://console.mistral.ai/api-keys';

const BASE_URL = 'https://api.mistral.ai/v1';

function defaultModel() {
  return config.mistralModel;
}

async function status() {
  const model = defaultModel();
  if (!config.mistralApiKey) {
    return {
      available: false,
      reason: 'Set MISTRAL_API_KEY in backend/.env. The free plan at console.mistral.ai needs a phone number, no card.',
      model,
    };
  }
  return {
    available: true,
    reason: null,
    model,
    note: "Free plan: Mistral may train on what you send unless you turn that off in the console's privacy settings.",
  };
}

function limits() {
  // ~70K tokens of passage plus the instructions and an 8K answer, inside a
  // 128K context with room to spare.
  return {
    maxInputWords: 50000,
    concurrency: config.summaryConcurrency,
    timeoutMs: config.summaryTimeoutMs,
  };
}

/** A 429 that talks about the month is the free plan's allowance, not a blip. */
function explain(error, model) {
  if (error.code === 'LLM_RATE_LIMITED' && /month/i.test(error.detail || '')) {
    return llmError(
      'LLM_QUOTA',
      `Mistral's free monthly allowance for ${model} is used up. It resets with the next billing month; ` +
        'the parts already written are saved.',
      { status: 429, cause: error },
    );
  }
  return error;
}

async function generateJson({ system, prompt, schema, model, signal }) {
  try {
    return await chatJson({
      baseUrl: BASE_URL,
      headers: { Authorization: `Bearer ${config.mistralApiKey}` },
      label,
      model,
      system,
      prompt,
      schema,
      format: 'strict',
      maxTokens: 8000,
      timeoutMs: limits().timeoutMs,
      signal,
    });
  } catch (error) {
    throw explain(error, model);
  }
}

export { id, label, vendor, local, freeTier, keyUrl, defaultModel, status, limits, generateJson };
