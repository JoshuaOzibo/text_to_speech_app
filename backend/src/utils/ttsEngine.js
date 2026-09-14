import path from 'path';
import { config } from '../config/env.js';
import { countWords, normaliseForSpeech } from './textCleaner.js';
import { splitSentences } from './sentences.js';
import { readWavDuration } from './wavProcessor.js';
import { logger, secs, watchdog } from './logger.js';
import * as piper from './engines/piper.js';
import * as supertonic from './engines/supertonic.js';
import * as kokoro from './engines/kokoro.js';
import { withLicence } from './licences.js';

const ENGINES = { piper, supertonic, kokoro };

function anyEngineInstalled() {
  return Object.values(ENGINES).some((engine) => engine.installed());
}

function engineStatus() {
  return {
    piper: piper.installed(),
    supertonic: supertonic.installed(),
    kokoro: kokoro.installed(),
  };
}

function listVoices() {
  return Object.values(ENGINES).flatMap((engine) => engine.listVoices().map(withLicence));
}

function resolveVoice(voiceId) {
  const voice = listVoices().find((v) => v.id === voiceId);
  if (!voice) {
    const error = new Error(
      `Voice model not found: "${voiceId}". Download it using the link in README.md.`
    );
    error.code = 'VOICE_NOT_FOUND';
    throw error;
  }
  return voice;
}

const CHAPTER_HEADING =
  /^(chapter|part|book|section|prologue|epilogue|introduction|foreword|preface|afterword|conclusion)\b/i;

function isChapterHeading(paragraph) {
  const trimmed = paragraph.trim();
  return trimmed.length >= 3 && trimmed.length <= 80 && CHAPTER_HEADING.test(trimmed);
}

function ensureChunkEndsCleanly(chunk) {
  const trimmed = chunk.trim();
  if (!trimmed) return '';
  if (/[.!?]["'’”)\]]?$/.test(trimmed)) return trimmed;
  return `${trimmed.replace(/[,;:]+$/, '')}.`;
}

function splitIntoChunks(text, wordsPerChunk = 300) {
  const paragraphs = String(text || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks = [];
  let current = [];
  let wordCount = 0;
  let chapterIndex = 0;

  const flush = () => {
    if (!current.length) return;
    const body = ensureChunkEndsCleanly(normaliseForSpeech(current.join('\n')));
    if (body) chunks.push({ text: body, chapterIndex, endsChapter: false });
    current = [];
    wordCount = 0;
  };

  const closeChapter = () => {
    flush();
    if (chunks.length) chunks[chunks.length - 1].endsChapter = true;
    chapterIndex += 1;
  };

  for (const paragraph of paragraphs) {
    if (isChapterHeading(paragraph) && (chunks.length || current.length)) {
      closeChapter();
    }

    for (const sentence of splitSentences(paragraph)) {
      const words = countWords(sentence);
      if (wordCount + words > wordsPerChunk && current.length) flush();
      current.push(/[.!?,;:]$/.test(sentence) ? sentence : `${sentence}.`);
      wordCount += words;
    }
  }

  flush();
  return chunks;
}
const MIN_PLAUSIBLE_WORDS_PER_SEC = 6;

async function generateChunkAudio(text, voiceId, speed, outputWavPath, onSpawn, isCancelled) {
  const voice = resolveVoice(voiceId);
  const engine = ENGINES[voice.engine];

  if (!engine) {
    const error = new Error(`Unknown TTS engine for voice "${voiceId}".`);
    error.code = 'UNKNOWN_ENGINE';
    throw error;
  }

  const spoken = config.ttsWarmup ? `. ${normaliseForSpeech(text)}` : normaliseForSpeech(text);
  const stop = watchdog('tts', `${voice.engine}/${voice.id} synthesis`);

  try {
    const result = await engine.synthesize({
      text: spoken,
      voice,
      speed,
      outputPath: outputWavPath,
      onSpawn,
      isCancelled,
    });
    const words = countWords(spoken);
    const seconds = readWavDuration(outputWavPath);
    const atLeast = words / (MIN_PLAUSIBLE_WORDS_PER_SEC * (Number(speed) || 1));
    const short = words >= 20 && seconds > 0 && seconds < atLeast;

    if (short) {
      logger.error('tts', 'synthesised audio is far shorter than its text - words are missing', {
        engine: voice.engine,
        voice: voice.id,
        words,
        audio: secs(seconds),
        atLeast: secs(atLeast),
        file: path.basename(outputWavPath),
      });
    }

    logger.debug('tts', 'synthesized', {
      engine: voice.engine,
      voice: voice.id,
      chars: spoken.length,
      audio: secs(seconds),
      took: secs(stop()),
    });
    return { path: result, words, seconds, short };
  } catch (error) {
    const took = stop();
    if (error.code === 'CANCELLED') {
      logger.debug('tts', 'synthesis cancelled', { voice: voice.id, after: secs(took) });
    } else {
      logger.error('tts', `synthesis failed: ${error.message}`, {
        engine: voice.engine,
        voice: voice.id,
        code: error.code,
        after: secs(took),
      });
    }
    throw error;
  }
}

const piperInstalled = piper.installed;

export { anyEngineInstalled, engineStatus, listVoices, resolveVoice, splitIntoChunks, splitSentences, generateChunkAudio, piperInstalled };
