import fs from 'fs';
import path from 'path';
import { config, paths } from '../../config/env.js';
import { splitSentences } from '../sentences.js';
import { logger, secs, timer } from '../logger.js';

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

const DTYPE_FILES = {
  fp32: 'model.onnx',
  fp16: 'model_fp16.onnx',
  q8: 'model_quantized.onnx',
  q4: 'model_q4.onnx',
  q4f16: 'model_q4f16.onnx',
};

const VOICES = {
  af_heart: { name: 'Heart', locale: 'en-us', gender: 'Female', grade: 'A' },
  af_bella: { name: 'Bella', locale: 'en-us', gender: 'Female', grade: 'A-' },
  af_nicole: { name: 'Nicole', locale: 'en-us', gender: 'Female', grade: 'B-' },
  af_aoede: { name: 'Aoede', locale: 'en-us', gender: 'Female', grade: 'C+' },
  af_kore: { name: 'Kore', locale: 'en-us', gender: 'Female', grade: 'C+' },
  af_sarah: { name: 'Sarah', locale: 'en-us', gender: 'Female', grade: 'C+' },
  af_alloy: { name: 'Alloy', locale: 'en-us', gender: 'Female', grade: 'C' },
  af_nova: { name: 'Nova', locale: 'en-us', gender: 'Female', grade: 'C' },
  af_sky: { name: 'Sky', locale: 'en-us', gender: 'Female', grade: 'C-' },
  af_jessica: { name: 'Jessica', locale: 'en-us', gender: 'Female', grade: 'D' },
  af_river: { name: 'River', locale: 'en-us', gender: 'Female', grade: 'D' },
  am_fenrir: { name: 'Fenrir', locale: 'en-us', gender: 'Male', grade: 'C+' },
  am_michael: { name: 'Michael', locale: 'en-us', gender: 'Male', grade: 'C+' },
  am_puck: { name: 'Puck', locale: 'en-us', gender: 'Male', grade: 'C+' },
  am_echo: { name: 'Echo', locale: 'en-us', gender: 'Male', grade: 'D' },
  am_eric: { name: 'Eric', locale: 'en-us', gender: 'Male', grade: 'D' },
  am_liam: { name: 'Liam', locale: 'en-us', gender: 'Male', grade: 'D' },
  am_onyx: { name: 'Onyx', locale: 'en-us', gender: 'Male', grade: 'D' },
  am_santa: { name: 'Santa', locale: 'en-us', gender: 'Male', grade: 'D-' },
  am_adam: { name: 'Adam', locale: 'en-us', gender: 'Male', grade: 'F+' },
  bf_emma: { name: 'Emma', locale: 'en-gb', gender: 'Female', grade: 'B-' },
  bf_isabella: { name: 'Isabella', locale: 'en-gb', gender: 'Female', grade: 'C' },
  bf_alice: { name: 'Alice', locale: 'en-gb', gender: 'Female', grade: 'D' },
  bf_lily: { name: 'Lily', locale: 'en-gb', gender: 'Female', grade: 'D' },
  bm_fable: { name: 'Fable', locale: 'en-gb', gender: 'Male', grade: 'C' },
  bm_george: { name: 'George', locale: 'en-gb', gender: 'Male', grade: 'C' },
  bm_lewis: { name: 'Lewis', locale: 'en-gb', gender: 'Male', grade: 'D+' },
  bm_daniel: { name: 'Daniel', locale: 'en-gb', gender: 'Male', grade: 'D' },
};

const ID_PREFIX = 'kokoro-';

const LOCALE_NAMES = { 'en-us': 'American', 'en-gb': 'British' };

function describeGrade(grade) {
  if (grade.startsWith('A')) return 'Best quality, lead narration for a full book';
  if (grade.startsWith('B')) return 'Strong and steady, good for long-form narration';
  if (grade.startsWith('C')) return 'Decent for side characters, quotes, variety';
  if (grade.startsWith('D')) return 'Rough edges, short passages rather than whole books';
  return 'Weakest of the set, novelty and very short lines only';
}
const CLAUSE_BREAK = /(?<=[,;:])\s+/;
let announcedSplit = false;

function packInto(parts, maxChars) {
  const out = [];
  let current = '';
  for (const part of parts) {
    if (current && current.length + 1 + part.length > maxChars) {
      out.push(current);
      current = part;
    } else {
      current = current ? `${current} ${part}` : part;
    }
  }
  if (current) out.push(current);
  return out;
}

function splitLongSentence(sentence, maxChars) {
  if (sentence.length <= maxChars) return [sentence];

  const parts = [];
  for (const clause of sentence.split(CLAUSE_BREAK)) {
    if (clause.length > maxChars) parts.push(...packInto(clause.split(/\s+/), maxChars));
    else parts.push(clause);
  }
  return packInto(parts, maxChars);
}

function hardCut(part, maxChars) {
  const out = [];
  for (let at = 0; at < part.length; at += maxChars) {
    out.push(part.slice(at, at + maxChars));
  }
  return out;
}

function splitForTokenCap(text, maxChars) {
  const source = String(text || '').trim();
  if (!source) return [];
  if (source.length <= maxChars) return [source];

  const parts = [];
  for (const sentence of splitSentences(source)) {
    parts.push(...splitLongSentence(sentence.trim(), maxChars));
  }

  const pieces = packInto(parts.filter(Boolean), maxChars);
  if (!pieces.length) return [source];

  return pieces.flatMap((piece) => (piece.length > maxChars ? hardCut(piece, maxChars) : piece));
}

function trimSilentEnds(wave, floor, leadFrames) {
  let first = 0;
  let last = wave.length - 1;
  while (first < wave.length && Math.abs(wave[first]) <= floor) first += 1;
  while (last > first && Math.abs(wave[last]) <= floor) last -= 1;
  if (last <= first) return wave;

  const from = Math.max(0, first - leadFrames);
  const to = Math.min(wave.length - 1, last + leadFrames);
  return wave.subarray(from, to + 1);
}

function concatWaves(waves, joinFrames) {
  if (waves.length === 1) return waves[0];
  const total = waves.reduce((n, w) => n + w.length, 0) + joinFrames * (waves.length - 1);
  const out = new Float32Array(total);
  let at = 0;
  for (let i = 0; i < waves.length; i += 1) {
    out.set(waves[i], at);
    at += waves[i].length + (i < waves.length - 1 ? joinFrames : 0);
  }
  return out;
}

let enginePromise = null;

let queue = Promise.resolve();

function enqueue(task) {
  const result = queue.then(task, task);
  queue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function modelFile() {
  return DTYPE_FILES[config.kokoroDtype] || DTYPE_FILES.fp32;
}

function modelPath() {
  return path.join(paths.kokoroModels, MODEL_ID, 'onnx', modelFile());
}

function installed() {
  const base = path.join(paths.kokoroModels, MODEL_ID);
  return (
    fs.existsSync(modelPath()) &&
    fs.existsSync(path.join(base, 'config.json')) &&
    fs.existsSync(path.join(base, 'tokenizer.json'))
  );
}

function listVoices() {
  if (!installed()) return [];

  let addedAt = null;
  try {
    addedAt = fs.statSync(modelPath()).mtimeMs;
  } catch {
    addedAt = null;
  }

  return Object.entries(VOICES)
    .map(([key, meta]) => ({
      id: `${ID_PREFIX}${key}`,
      engine: 'kokoro',
      name: meta.name,
      locale: meta.locale,
      quality: meta.grade,
      gender: meta.gender,
      label: `${meta.name} | ${LOCALE_NAMES[meta.locale]} ${meta.gender} (grade ${meta.grade})`,
      group: 'Kokoro (neural, Apache-2.0)',
      bestFor: describeGrade(meta.grade),
      speedFactor: config.kokoroDtype === 'fp32' ? 1.63 : 3.69,
      addedAt,
      file: key,
    }))
    .sort((a, b) => a.quality.localeCompare(b.quality) || a.name.localeCompare(b.name));
}

async function loadEngine() {
  if (!enginePromise) {
    enginePromise = (async () => {
      logger.info('kokoro', `loading ${config.kokoroDtype} model (~310MB, once per server)…`);
      const elapsed = timer();
      const { KokoroTTS, env } = await import('kokoro-js');

      env.localModelPath = paths.kokoroModels;
      env.allowLocalModels = true;
      env.allowRemoteModels = false;

      const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: config.kokoroDtype,
        device: 'cpu',
      });

      const shipped = Object.keys(tts.voices || {});
      const missing = shipped.filter((id) => !VOICES[id]);
      if (missing.length) {
        logger.warn('kokoro', `model ships voices not in the catalogue: ${missing.join(', ')}`);
      }

      logger.info('kokoro', 'model ready', { took: secs(elapsed()) });
      return tts;
    })().catch((err) => {
      logger.error('kokoro', `model load failed: ${err.message}`);
      enginePromise = null;
      throw err;
    });
  }
  return enginePromise;
}

async function synthesize({ text, voice, speed, outputPath, isCancelled }) {
  if (!installed()) {
    const error = new Error(
      'Kokoro is not installed. Run: npm run get:kokoro (see README.md).'
    );
    error.code = 'KOKORO_NOT_FOUND';
    throw error;
  }

  let tts;
  try {
    tts = await loadEngine();
  } catch (err) {
    const error = new Error(`Could not load the Kokoro model: ${err.message}`);
    error.code = 'KOKORO_LOAD_FAILED';
    throw error;
  }

  if (isCancelled && isCancelled()) {
    const error = new Error('Generation cancelled.');
    error.code = 'CANCELLED';
    throw error;
  }

  const rate = Number(speed) || 1;
  const pieces = splitForTokenCap(text, config.kokoroMaxChars);

  const stopIfCancelled = () => {
    if (isCancelled && isCancelled()) {
      const error = new Error('Generation cancelled.');
      error.code = 'CANCELLED';
      throw error;
    }
  };

  if (pieces.length > 1 && !announcedSplit) {
    announcedSplit = true;
    logger.info('kokoro', 'splitting chunks to stay under the 512-token cap', {
      maxChars: config.kokoroMaxChars,
      pieces: pieces.length,
    });
  }

  const waves = [];
  let carrier = null;
  let sampleRate = 24000;

  for (let i = 0; i < pieces.length; i += 1) {
    stopIfCancelled();

    const elapsed = timer();
    const audio = await enqueue(() =>
      tts.generate(pieces[i], { voice: voice.file, speed: rate })
    );

    if (!carrier) carrier = audio;
    sampleRate = audio.sampling_rate || sampleRate;
    waves.push(
      pieces.length > 1
        ? trimSilentEnds(
            audio.audio,
            10 ** (config.silenceFloorDbfs / 20),
            Math.round((config.leadInMs / 1000) * sampleRate)
          )
        : audio.audio
    );

    const seconds = audio.audio.length / sampleRate;
    const words = pieces[i].split(/\s+/).length;
    if (words >= 20 && seconds < words / (6 * rate)) {
      logger.error(
        'kokoro',
        'a piece came back far shorter than its text - likely truncated at the 512-token cap',
        {
          piece: `${i + 1}/${pieces.length}`,
          chars: pieces[i].length,
          words,
          audio: secs(seconds),
          atLeast: secs(words / (6 * rate)),
          maxChars: config.kokoroMaxChars,
        }
      );
    }

    logger.debug('kokoro', `piece ${i + 1}/${pieces.length}`, {
      chars: pieces[i].length,
      audio: secs(seconds),
      took: secs(elapsed()),
    });
  }

  stopIfCancelled();

  const joinFrames =
    pieces.length > 1 ? Math.round((config.kokoroJoinSilenceMs / 1000) * sampleRate) : 0;
  carrier.audio = concatWaves(waves, joinFrames);
  await carrier.save(outputPath);

  if (!fs.existsSync(outputPath)) {
    const error = new Error('Kokoro finished but produced no audio file.');
    error.code = 'KOKORO_NO_OUTPUT';
    throw error;
  }
  return outputPath;
}

export {
  installed,
  listVoices,
  synthesize,
  splitForTokenCap,
  ID_PREFIX,
  MODEL_ID,
  DTYPE_FILES,
};
