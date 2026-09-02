import { config } from '../config/env.js';
import { logger, secs, timer } from './logger.js';
import { knownMoods, sampleText } from './mood.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

function available() {
  return Boolean(config.geminiApiKey);
}

function buildPrompt(text, meta) {
  const moods = knownMoods()
    .map((entry) => `- ${entry.mood}: ${entry.label}`)
    .join('\n');

  return [
    'You are choosing background music for an audiobook narration.',
    '',
    'Pick the single mood that best fits the book, then give three short search',
    'phrases for a royalty-free music library. Prefer instrumental, looping,',
    'low-key beds that will sit underneath a speaking voice without competing',
    'with it. Never suggest anything with vocals, lyrics, or a strong beat.',
    '',
    'Allowed moods:',
    moods,
    '',
    `Book title: ${meta.title || 'unknown'}`,
    meta.chapters?.length ? `Chapter titles: ${meta.chapters.slice(0, 25).join(' | ')}` : '',
    '',
    'Excerpt from the book:',
    '"""',
    sampleText(text).slice(0, 12000),
    '"""',
  ]
    .filter(Boolean)
    .join('\n');
}

const SCHEMA = {
  type: 'object',
  properties: {
    mood: { type: 'string' },
    terms: { type: 'array', items: { type: 'string' } },
    reason: { type: 'string' },
  },
  required: ['mood', 'terms', 'reason'],
};

function parseResponse(body) {
  const parts = body?.candidates?.[0]?.content?.parts;
  const raw = Array.isArray(parts) ? parts.map((part) => part.text || '').join('') : '';
  if (!raw.trim()) return null;

  const parsed = JSON.parse(raw);
  const terms = Array.isArray(parsed.terms)
    ? parsed.terms.map((term) => String(term).trim()).filter(Boolean).slice(0, 3)
    : [];

  if (!parsed.mood || !terms.length) return null;

  return {
    source: 'gemini',
    mood: String(parsed.mood).toLowerCase().trim(),
    terms,
    reason: String(parsed.reason || '').trim(),
    confidence: 'high',
  };
}

async function suggestMood(text, meta = {}) {
  if (!available()) return null;

  const url = `${ENDPOINT}/${encodeURIComponent(config.geminiModel)}:generateContent`;
  const elapsed = timer();

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.geminiApiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: buildPrompt(text, meta) }] }],
        generationConfig: {
          temperature: 0.4,
          responseMimeType: 'application/json',
          responseSchema: SCHEMA,
        },
      }),
      signal: AbortSignal.timeout(config.suggestTimeoutMs),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      logger.warn('gemini', `suggestion rejected (${response.status})`, {
        model: config.geminiModel,
        detail: detail.slice(0, 200).replace(/\s+/g, ' '),
      });
      return null;
    }

    const suggestion = parseResponse(await response.json());
    if (!suggestion) {
      logger.warn('gemini', 'response had no usable suggestion');
      return null;
    }

    logger.info('gemini', 'suggested a mood', {
      mood: suggestion.mood,
      model: config.geminiModel,
      took: secs(elapsed()),
    });
    return suggestion;
  } catch (error) {
    const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError';
    logger.warn('gemini', timedOut ? 'suggestion timed out' : `suggestion failed: ${error.message}`, {
      after: secs(elapsed()),
    });
    return null;
  }
}

export { available, suggestMood };
