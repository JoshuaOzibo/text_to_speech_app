'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { config, paths } = require('../../config/env');

/**
 * Supertonic TTS engine (https://github.com/supertone-inc/supertonic).
 *
 * Unlike Piper, this is not an executable — it is a four-stage ONNX pipeline
 * (text encoder → duration predictor → vector estimator → vocoder) driven from
 * JavaScript via onnxruntime-node. We run it in-process and keep the loaded
 * models in memory, so a whole book pays the ~7s model load exactly once
 * instead of once per chunk.
 *
 * Consequence worth knowing: there is no child process to kill, so a cancel
 * takes effect at the next chunk boundary rather than instantly. The generate
 * loop checks for cancellation between chunks, so the wait is bounded by one
 * chunk.
 *
 * Sample code is MIT; the model weights are OpenRAIL-M (commercial use allowed,
 * with attribution and use-based restrictions). See backend/supertonic/LICENSE.
 */

const ONNX_FILES = [
  'duration_predictor.onnx',
  'text_encoder.onnx',
  'vector_estimator.onnx',
  'vocoder.onnx',
  'tts.json',
  'unicode_indexer.json',
];

// The ten preset styles. These are catalogue labels, not real speakers.
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

/** Voice ids are namespaced so they can't collide with a Piper model stem. */
const ID_PREFIX = 'supertonic-';

/** Loaded once and reused: { helper, tts }. */
let enginePromise = null;
/** Parsed voice styles are ~285KB of JSON each — parse each at most once. */
const styleCache = new Map();

/**
 * Serialises inference.
 *
 * Generation and the preview endpoints share one loaded model, so without this
 * a preview fired mid-book would run concurrently against the same ONNX session.
 * Requests queue instead — on a 4-core CPU-bound engine, running them in
 * parallel would be slower anyway.
 */
let queue = Promise.resolve();

function enqueue(task) {
  const result = queue.then(task, task);
  // Keep the chain alive after a rejection, and don't retain results.
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
        // The only engine whose 44.1kHz output clears MP3's MPEG-2 bitrate cap.
        bestFor: 'Highest-fidelity output — 44.1kHz, the only engine that reaches a true 192 kbps MP3',
        // At the default 4 denoising steps, measured on an idle 4-core machine.
        speedFactor: 0.42,
        file,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Load the ONNX pipeline once.
 *
 * helper.js is an ES module and this backend is CommonJS, so it comes in via a
 * dynamic import. A failed load clears the cached promise so a later attempt
 * can retry rather than replaying the same rejection forever.
 */
async function loadEngine() {
  if (!enginePromise) {
    enginePromise = (async () => {
      const helperUrl = pathToFileURL(path.join(paths.supertonicRoot, 'helper.js')).href;
      const helper = await import(helperUrl);
      const tts = await helper.loadTextToSpeech(paths.supertonicOnnx, false);
      return { helper, tts };
    })().catch((err) => {
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

  // A cancel that arrived during the (slow) first model load shouldn't be
  // followed by a pointless synthesis pass.
  if (isCancelled && isCancelled()) {
    const error = new Error('Generation cancelled.');
    error.code = 'CANCELLED';
    throw error;
  }

  const style = getStyle(helper, voice.name);

  // Supertonic takes speed directly (higher = faster), the opposite convention
  // to Piper's length_scale.
  const { wav, duration } = await enqueue(() =>
    tts.call(text, 'en', style, config.supertonicSteps, Number(speed) || 1)
  );

  // `wav` is a fixed-size buffer; trim it to the reported duration or the file
  // ends with a tail of silence on every chunk.
  const samples = wav.slice(0, Math.floor(tts.sampleRate * duration[0]));
  helper.writeWavFile(outputPath, samples, tts.sampleRate);

  if (!fs.existsSync(outputPath)) {
    const error = new Error('Supertonic finished but produced no audio file.');
    error.code = 'SUPERTONIC_NO_OUTPUT';
    throw error;
  }
  return outputPath;
}

module.exports = { installed, listVoices, synthesize, ID_PREFIX };
