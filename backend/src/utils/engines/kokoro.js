'use strict';

const fs = require('fs');
const path = require('path');
const { config, paths } = require('../../config/env');

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
  if (grade.startsWith('A')) return 'Best quality — lead narration for a full book';
  if (grade.startsWith('B')) return 'Strong and steady — good for long-form narration';
  if (grade.startsWith('C')) return 'Decent — side characters, quotes, variety';
  if (grade.startsWith('D')) return 'Rough edges — short passages rather than whole books';
  return 'Weakest of the set — novelty and very short lines only';
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

  return Object.entries(VOICES)
    .map(([key, meta]) => ({
      id: `${ID_PREFIX}${key}`,
      engine: 'kokoro',
      name: meta.name,
      locale: meta.locale,
      quality: meta.grade,
      gender: meta.gender,
      label: `${meta.name} — ${LOCALE_NAMES[meta.locale]} ${meta.gender} (grade ${meta.grade})`,
      group: 'Kokoro (neural, Apache-2.0)',
      bestFor: describeGrade(meta.grade),
      speedFactor: config.kokoroDtype === 'fp32' ? 1.63 : 3.69,
      file: key,
    }))
    .sort((a, b) => a.quality.localeCompare(b.quality) || a.name.localeCompare(b.name));
}

async function loadEngine() {
  if (!enginePromise) {
    enginePromise = (async () => {
      const { KokoroTTS, env } = require('kokoro-js');

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
        console.warn(`[kokoro] model ships voices not in the catalogue: ${missing.join(', ')}`);
      }

      return tts;
    })().catch((err) => {
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

  const audio = await enqueue(() =>
    tts.generate(text, { voice: voice.file, speed: Number(speed) || 1 })
  );

  await audio.save(outputPath);

  if (!fs.existsSync(outputPath)) {
    const error = new Error('Kokoro finished but produced no audio file.');
    error.code = 'KOKORO_NO_OUTPUT';
    throw error;
  }
  return outputPath;
}

module.exports = { installed, listVoices, synthesize, ID_PREFIX, MODEL_ID, DTYPE_FILES };
