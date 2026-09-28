import { config } from '../../config/env.js';
import { llmError } from './errors.js';
import { postJson, parseJsonText } from './http.js';

const id = 'deepseek';
const label = 'DeepSeek';
const vendor = 'DeepSeek';
const local = false;

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
  // JSON mode guarantees valid JSON, not a shape, and requires the word "json"
  // to appear in the prompt. So the schema is spelled out here and the caller
  // shape-checks what comes back, exactly as it does for every provider.
  const instructions =
    `${system}\n\nReply with a single json object that matches this JSON Schema ` +
    `exactly, and nothing else:\n${JSON.stringify(schema)}`;

  const body = await postJson(`${config.deepseekBaseUrl.replace(/\/+$/, '')}/chat/completions`, {
    headers: { Authorization: `Bearer ${config.deepseekApiKey}` },
    body: {
      model,
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 8000,
      stream: false,
    },
    timeoutMs: limits().timeoutMs,
    signal,
    vendor: label,
    model,
  });

  const choice = body?.choices?.[0];
  if (choice?.finish_reason === 'length') {
    throw llmError('LLM_TRUNCATED', 'DeepSeek ran out of room before finishing its answer.', {
      retryable: true,
    });
  }
  if (choice?.finish_reason === 'content_filter') {
    throw llmError('LLM_BLOCKED', 'DeepSeek declined to summarize this part of the book.');
  }
  return parseJsonText(choice?.message?.content, label);
}

export { id, label, vendor, local, defaultModel, status, limits, generateJson };
