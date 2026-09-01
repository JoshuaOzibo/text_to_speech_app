import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { config, paths } from '../../config/env.js';
import { logger, secs, timer } from '../logger.js';

const ONNX_FILES = [
  'duration_predictor.onnx',
  'text_encoder.onnx',
  'vector_estimator.onnx',
  'vocoder.onnx',
  'tts.json',
  'unicode_indexer.json',
];

const VOICE_DESCRIPTIONS = {
  F1: 'Female 1',
  F2: 'Female 2',
  F3: 'Female 3',
  F4: 'Female 4',
  F5: 'Female 5',
  M1: 'Male 1',
  M2: 'Male 2',
  M3: 'Male 3',
  M4: 'Male 4',
  M5: 'Male 5',
};

const ID_PREFIX = 'supertonic-';

let enginePromise = null;
const styleCache = new Map();

let queue = Promise.resolve();

function enqueue(task) {
  const result = queue.then(task, task);
  queue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function installed() {
  const helperPath = path.join(paths.supertonicRoot, 'helper.js');
  if (!fs.existsSync(helperPath)) return false;
  return ONNX_FILES.every((file) => fs.existsSync(path.join(paths.supertonicOnnx, file)));
}

function listVoices() {
  if (!installed() || !fs.existsSync(paths.supertonicVoices)) return [];

  return fs
    .readdirSync(paths.supertonicVoices)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const name = file.replace(/\.json$/, '');
      const description = VOICE_DESCRIPTIONS[name] || name;
      return {
        id: `${ID_PREFIX}${name}`,
        engine: 'supertonic',
        name,
        locale: 'multi',
        quality: 'neural',
        gender: name.startsWith('F') ? 'Female' : 'Male',
        label: `Supertonic ${name} — ${description}`,
        group: 'Supertonic (neural, 44.1kHz)',
        bestFor: 'Highest-fidelity output — 44.1kHz, the only engine that reaches a true 192 kbps MP3',
        speedFactor: 0.42,
        file,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function loadEngine() {
  if (!enginePromise) {
    enginePromise = (async () => {
      logger.info('supertonic', 'loading ONNX models (~380MB, once per server)…');
      const elapsed = timer();
      const helperUrl = pathToFileURL(path.join(paths.supertonicRoot, 'helper.js')).href;
      const helper = await import(helperUrl);
      const tts = await helper.loadTextToSpeech(paths.supertonicOnnx, false);
      logger.info('supertonic', 'models ready', { took: secs(elapsed()) });
      return { helper, tts };
    })().catch((err) => {
      logger.error('supertonic', `model load failed: ${err.message}`);
      enginePromise = null;
      throw err;
    });
  }
  return enginePromise;
}

function getStyle(helper, name) {
  if (!styleCache.has(name)) {
    const stylePath = path.join(paths.supertonicVoices, `${name}.json`);
    styleCache.set(name, helper.loadVoiceStyle([stylePath], false));
  }
  return styleCache.get(name);
}

async function synthesize({ text, voice, speed, outputPath, isCancelled }) {
  if (!installed()) {
    const error = new Error(
      'Supertonic is not installed. See the Supertonic section of README.md.'
    );
    error.code = 'SUPERTONIC_NOT_FOUND';
    throw error;
  }

  let helper;
  let tts;
  try {
    ({ helper, tts } = await loadEngine());
  } catch (err) {
    const error = new Error(`Could not load the Supertonic models: ${err.message}`);
    error.code = 'SUPERTONIC_LOAD_FAILED';
    throw error;
  }

  if (isCancelled && isCancelled()) {
    const error = new Error('Generation cancelled.');
    error.code = 'CANCELLED';
    throw error;
  }

  const style = getStyle(helper, voice.name);

  const { wav, duration } = await enqueue(() =>
    tts.call(text, 'en', style, config.supertonicSteps, Number(speed) || 1)
  );

  const samples = wav.slice(0, Math.floor(tts.sampleRate * duration[0]));
  helper.writeWavFile(outputPath, samples, tts.sampleRate);

  if (!fs.existsSync(outputPath)) {
    const error = new Error('Supertonic finished but produced no audio file.');
    error.code = 'SUPERTONIC_NO_OUTPUT';
    throw error;
  }
  return outputPath;
}

export { installed, listVoices, synthesize, ID_PREFIX };
