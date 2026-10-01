import { config } from '../../config/env.js';
import { chatJson } from './openaiChat.js';

const id = 'deepseek';
const label = 'DeepSeek';
const vendor = 'DeepSeek';
const local = false;
const freeTier = false;
// Where the user creates a key; the page links to it while this is not set up.
const keyUrl = 'https://platform.deepseek.com/api_keys';

function defaultModel() {
  return config.deepseekModel;
}

async function status() {
  const model = defaultModel();
  if (!config.deepseekApiKey) {
    return { available: false, reason: 'Set DEEPSEEK_API_KEY in backend/.env.', model };
  }
  return { available: true, reason: null, model };
}

function limits() {
  // A 64K-token context shared between the passage, the instructions and an
  // answer of up to 8K tokens. ~1.4 tokens per word leaves room for all three.
  return {
    maxInputWords: 30000,
    concurrency: config.summaryConcurrency,
    timeoutMs: config.summaryTimeoutMs,
  };
}

async function generateJson({ system, prompt, schema, model, signal }) {
  // DeepSeek has JSON mode but no json_schema, so it gets 'object': valid JSON
  // guaranteed, the shape spelled out in the prompt.
  return chatJson({
    baseUrl: config.deepseekBaseUrl,
    headers: { Authorization: `Bearer ${config.deepseekApiKey}` },
    label,
    model,
    system,
    prompt,
    schema,
    format: 'object',
    maxTokens: 8000,
    timeoutMs: limits().timeoutMs,
    signal,
  });
}

export { id, label, vendor, local, freeTier, keyUrl, defaultModel, status, limits, generateJson };
