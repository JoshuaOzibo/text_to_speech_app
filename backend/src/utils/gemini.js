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
    'You are choosing an ambient sound bed for an audiobook. It plays softly',
    'underneath a narrator while someone listens to a book.',
    '',
    'The sound must follow ALL of these rules, with no exceptions:',
    '- No vocals, no singing, no choir, no spoken word',
    '- No drums, no beats, no rhythm, no bass',
    '- No melodic hooks — nothing the listener will follow',
    '- No dramatic swells, no builds, no drops in volume',
    '- No cinematic or film-score style music',
    '- No lofi, no jazz, no classical orchestra',
    '- Consistent volume from start to finish: flat, steady, background only',
    '- It should feel like the room the listener is sitting in, not a performance',
    '- It must never pull attention away from the voice',
    '',
    'A good sound is one of these:',
    '- A slow sustained drone (tanpura, shruti box, a singing bowl that never stops)',
    '- Very sparse distant piano notes with long silences between them',
    '- Pure ambient nature (gentle rain, soft wind, quiet forest)',
    '- A tibetan singing bowl resonance that fades very slowly',
    '- Deep space ambient: texture only, no melody',
    '- Soft sustained string notes held a very long time (a tone, not a melody)',
    '- Soft binaural or theta waves layered with gentle nature sound',
    '',
    'Pick the single mood that best fits the book, then give six search phrases',
    'of two to five words each for a royalty-free music library. Every phrase',
    'must describe a sound that obeys the rules above.',
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
    ? parsed.terms.map((term) => String(term).trim()).filter(Boolean).slice(0, 6)
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
