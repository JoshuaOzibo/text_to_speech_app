'use strict';

const fs = require('fs');
const path = require('path');
const { config } = require('../config/env');

/**
 * Per-chunk audio conditioning, done in-process on 16-bit PCM.
 *
 * Each TTS chunk is synthesised independently, so raw chunks differ in level and
 * start/end at arbitrary sample values. Concatenating them directly produces the
 * two most audible defects in a generated audiobook: a click at every join, and
 * words that jump in volume between chunks.
 *
 * This is deliberately not ffmpeg. A 200-chunk book would need ~400 extra
 * subprocesses (analyse + apply per chunk); reading the PCM once in Node and
 * writing it back is far cheaper and keeps the whole conditioning step in one
 * place. ffmpeg still does the final mastering pass, where its filters earn
 * their cost.
 */

const HEADER_SCAN_BYTES = 65536;

/** Full-scale value for signed 16-bit samples. */
const FULL_SCALE = 32768;

const dbToGain = (db) => 10 ** (db / 20);

/**
 * Parse a WAV header: format, geometry, and where the sample data starts.
 *
 * Walks the RIFF chunk table rather than assuming the canonical 44-byte header,
 * because writers vary in which optional chunks they emit (LIST, fact, ...).
 */
function readWavInfo(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const fileSize = fs.fstatSync(fd).size;
    if (fileSize < 44) return null;

    const headerSize = Math.min(fileSize, HEADER_SCAN_BYTES);
    const buf = Buffer.alloc(headerSize);
    fs.readSync(fd, buf, 0, headerSize, 0);

    if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
      return null;
    }

    let offset = 12;
    let info = { audioFormat: 0, channels: 0, sampleRate: 0, byteRate: 0, bitsPerSample: 0 };

    while (offset + 8 <= headerSize) {
      const chunkId = buf.toString('ascii', offset, offset + 4);
      const chunkSize = buf.readUInt32LE(offset + 4);

      if (chunkId === 'fmt ' && offset + 24 <= headerSize) {
        info.audioFormat = buf.readUInt16LE(offset + 8);
        info.channels = buf.readUInt16LE(offset + 10);
        info.sampleRate = buf.readUInt32LE(offset + 12);
        info.byteRate = buf.readUInt32LE(offset + 16);
        info.bitsPerSample = buf.readUInt16LE(offset + 22);
      } else if (chunkId === 'data') {
        // Some writers leave a placeholder size; fall back to the real length.
        const dataBytes =
          chunkSize > 0 && chunkSize !== 0xffffffff ? chunkSize : fileSize - (offset + 8);
        return {
          ...info,
          dataOffset: offset + 8,
          dataBytes: Math.min(dataBytes, fileSize - (offset + 8)),
          duration: info.byteRate > 0 ? dataBytes / info.byteRate : 0,
        };
      }

      offset += 8 + chunkSize + (chunkSize % 2); // chunks are word-aligned
    }
    return null;
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

/** Duration in seconds, or 0 if the file isn't readable as WAV. */
function readWavDuration(filePath) {
  const info = readWavInfo(filePath);
  return info ? info.duration : 0;
}

const FORMAT_PCM = 1; // WAVE_FORMAT_PCM — Piper and Supertonic (16-bit int)
const FORMAT_FLOAT = 3; // WAVE_FORMAT_IEEE_FLOAT — Kokoro (32-bit float)

/** True when we can decode this file with the fast in-process path. */
function isProcessable(info) {
  if (!info || info.channels < 1) return false;
  if (info.audioFormat === FORMAT_PCM && info.bitsPerSample === 16) return true;
  if (info.audioFormat === FORMAT_FLOAT && info.bitsPerSample === 32) return true;
  return false;
}

/**
 * Decode sample data to floats in -1..1.
 *
 * Engines disagree on WAV flavour — Piper and Supertonic write 16-bit integer
 * PCM, Kokoro writes 32-bit float — so everything is normalised to float here,
 * processed in float, and written back as 16-bit PCM. That also leaves every
 * chunk in one uniform format for the concat step.
 *
 * The copy into a fresh ArrayBuffer is required: Node hands back pooled Buffers
 * whose byteOffset can be misaligned for a typed-array view.
 */
function decodeSamples(fileBuf, info) {
  const bytesPerSample = info.bitsPerSample / 8;
  const available = Math.max(0, Math.min(info.dataBytes, fileBuf.length - info.dataOffset));
  const byteLength = available - (available % bytesPerSample);

  const arrayBuffer = new ArrayBuffer(byteLength);
  new Uint8Array(arrayBuffer).set(fileBuf.subarray(info.dataOffset, info.dataOffset + byteLength));

  if (info.audioFormat === FORMAT_FLOAT) {
    return new Float32Array(arrayBuffer);
  }

  const ints = new Int16Array(arrayBuffer);
  const floats = new Float32Array(ints.length);
  for (let i = 0; i < ints.length; i += 1) floats[i] = ints[i] / 32768;
  return floats;
}

/** Build a canonical 44-byte PCM header for the given geometry. */
function buildHeader(dataBytes, { channels, sampleRate, bitsPerSample }) {
  const header = Buffer.alloc(44);
  const blockAlign = (channels * bitsPerSample) / 8;

  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28); // byte rate
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

/**
 * Find the first and last frame whose amplitude rises above the silence floor.
 *
 * Returns frame indices (not byte offsets) so the caller can reason in samples
 * regardless of channel count.
 */
function findSpeechBounds(samples, frames, channels, floor) {
  let first = 0;
  let last = frames - 1;

  const aboveFloor = (frame) => {
    for (let c = 0; c < channels; c += 1) {
      if (Math.abs(samples[frame * channels + c]) > floor) return true;
    }
    return false;
  };

  while (first < frames && !aboveFloor(first)) first += 1;
  while (last > first && !aboveFloor(last)) last -= 1;

  return { first, last };
}

/**
 * Condition one synthesised chunk in place.
 *
 * Order matters: trim first (so level measurement isn't skewed by leading
 * silence), then normalise, then fade, then pad. Padding after the fade means
 * the appended silence is genuinely silent rather than being faded into.
 *
 * Returns a summary for logging/verification, or null if the file could not be
 * processed in-process (caller may fall back to ffmpeg).
 */
function processChunk(filePath, options = {}) {
  const {
    targetDbfs = config.chunkTargetDbfs,
    peakCeilingDbfs = config.chunkPeakCeilingDbfs,
    fadeMs = config.chunkFadeMs,
    gapMs = config.chunkGapMs,
    silenceFloorDbfs = config.silenceFloorDbfs,
    leadInMs = config.leadInMs,
  } = options;

  const info = readWavInfo(filePath);
  if (!isProcessable(info)) {
    // Never fail silently here: a skipped chunk means no levelling, no fades and
    // no chapter gap, which is audible but easy to misread as a pipeline bug.
    console.warn(
      `[wavProcessor] skipping ${path.basename(filePath)} — unsupported WAV ` +
        `(format ${info?.audioFormat}, ${info?.bitsPerSample}-bit). Audio will not be conditioned.`
    );
    return null;
  }

  const { channels, sampleRate } = info;

  const fileBuf = fs.readFileSync(filePath);
  const samples = decodeSamples(fileBuf, info);

  const frames = Math.floor(samples.length / channels);
  if (frames === 0) return null;

  // --- 1. Trim silence from both edges -------------------------------------
  // Removes the engine's lead-in (and the ". " warm-up token's pause), which is
  // what makes a chunk sound like it starts mid-word.
  const floor = dbToGain(silenceFloorDbfs);
  const { first, last } = findSpeechBounds(samples, frames, channels, floor);
  if (last <= first) return null; // chunk is entirely silence — leave it alone

  const leadFrames = Math.round((leadInMs / 1000) * sampleRate);
  const startFrame = Math.max(0, first - leadFrames);
  const endFrame = Math.min(frames - 1, last + leadFrames);
  const speechFrames = endFrame - startFrame + 1;

  // --- 2. Measure RMS over the speech region --------------------------------
  let sumSquares = 0;
  let peak = 0;
  for (let i = startFrame * channels; i < (endFrame + 1) * channels; i += 1) {
    const v = samples[i];
    sumSquares += v * v;
    const abs = Math.abs(v);
    if (abs > peak) peak = abs;
  }
  const rms = Math.sqrt(sumSquares / (speechFrames * channels));
  const rmsDbfs = rms > 0 ? 20 * Math.log10(rms) : -Infinity;

  // --- 3. Work out a gain that hits the target without clipping -------------
  let gain = Number.isFinite(rmsDbfs) ? dbToGain(targetDbfs - rmsDbfs) : 1;

  // Cap the gain so the loudest sample lands at or below the ceiling. This is
  // what prevents normalisation from turning a loud word into a clipped one.
  const ceiling = dbToGain(peakCeilingDbfs);
  if (peak > 0 && peak * gain > ceiling) gain = ceiling / peak;

  // --- 4. Build the output: speech + trailing silence -----------------------
  const gapFrames = Math.round((gapMs / 1000) * sampleRate);
  const outFrames = speechFrames + gapFrames;
  const outSamples = new Int16Array(outFrames * channels);

  const fadeFrames = Math.min(
    Math.round((fadeMs / 1000) * sampleRate),
    Math.floor(speechFrames / 2)
  );

  for (let f = 0; f < speechFrames; f += 1) {
    // Equal-power-ish linear fade is plenty at 50ms; the point is only to reach
    // zero at the edges so concatenation never steps between distant values.
    let envelope = 1;
    if (fadeFrames > 0) {
      if (f < fadeFrames) envelope = f / fadeFrames;
      else if (f >= speechFrames - fadeFrames) envelope = (speechFrames - 1 - f) / fadeFrames;
    }

    for (let c = 0; c < channels; c += 1) {
      const value = samples[(startFrame + f) * channels + c] * gain * envelope * FULL_SCALE;
      // Clamp defensively; rounding can push a ceiling-limited sample over.
      outSamples[f * channels + c] = Math.max(-32768, Math.min(32767, Math.round(value)));
    }
  }
  // Remaining frames are already zero — that is the inter-chunk gap.

  const outData = Buffer.from(outSamples.buffer, outSamples.byteOffset, outSamples.byteLength);
  // Always written back as 16-bit PCM, whatever came in, so every chunk in a run
  // shares one format for the concat step.
  const header = buildHeader(outData.length, { channels, sampleRate, bitsPerSample: 16 });
  fs.writeFileSync(filePath, Buffer.concat([header, outData]));

  return {
    sampleRate,
    channels,
    gainDb: 20 * Math.log10(gain),
    rmsDbfsBefore: rmsDbfs,
    trimmedMs: ((frames - speechFrames) / sampleRate) * 1000,
    durationSec: outFrames / sampleRate,
  };
}

module.exports = {
  readWavInfo,
  readWavDuration,
  isProcessable,
  processChunk,
};
