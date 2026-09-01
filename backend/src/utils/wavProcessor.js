import fs from 'fs';
import path from 'path';
import { config } from '../config/env.js';

const HEADER_SCAN_BYTES = 65536;

const FULL_SCALE = 32768;

const dbToGain = (db) => 10 ** (db / 20);

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
        const dataBytes =
          chunkSize > 0 && chunkSize !== 0xffffffff ? chunkSize : fileSize - (offset + 8);
        return {
          ...info,
          dataOffset: offset + 8,
          dataBytes: Math.min(dataBytes, fileSize - (offset + 8)),
          duration: info.byteRate > 0 ? dataBytes / info.byteRate : 0,
        };
      }

      offset += 8 + chunkSize + (chunkSize % 2);
    }
    return null;
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

function readWavDuration(filePath) {
  const info = readWavInfo(filePath);
  return info ? info.duration : 0;
}

const FORMAT_PCM = 1;
const FORMAT_FLOAT = 3;

function isProcessable(info) {
  if (!info || info.channels < 1) return false;
  if (info.audioFormat === FORMAT_PCM && info.bitsPerSample === 16) return true;
  if (info.audioFormat === FORMAT_FLOAT && info.bitsPerSample === 32) return true;
  return false;
}

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

function buildHeader(dataBytes, { channels, sampleRate, bitsPerSample }) {
  const header = Buffer.alloc(44);
  const blockAlign = (channels * bitsPerSample) / 8;

  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

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

function findPauses(samples, startFrame, endFrame, channels, sampleRate, options = {}) {
  const {
    floorDbfs = -45,
    minPauseMs = 90,
    minRunMs = 40,
    bridgeMs = 60,
  } = options;

  const floor = dbToGain(floorDbfs);
  const minFrames = Math.round((minPauseMs / 1000) * sampleRate);
  const minRunFrames = Math.round((minRunMs / 1000) * sampleRate);
  const bridgeFrames = Math.round((bridgeMs / 1000) * sampleRate);

  const isQuiet = (frame) => {
    for (let c = 0; c < channels; c += 1) {
      if (Math.abs(samples[frame * channels + c]) > floor) return false;
    }
    return true;
  };

  const runs = [];
  let runStart = -1;

  for (let f = startFrame; f <= endFrame; f += 1) {
    if (isQuiet(f)) {
      if (runStart < 0) runStart = f;
    } else if (runStart >= 0) {
      runs.push({ from: runStart, to: f });
      runStart = -1;
    }
  }
  if (runStart >= 0) runs.push({ from: runStart, to: endFrame + 1 });

  const merged = [];
  for (const run of runs) {
    if (run.to - run.from < minRunFrames) continue;
    const last = merged[merged.length - 1];
    if (last && run.from - last.to <= bridgeFrames) last.to = run.to;
    else merged.push({ ...run });
  }

  return merged
    .filter(
      (run) =>
        run.to - run.from >= minFrames && run.from > startFrame && run.to <= endFrame
    )
    .map((run) => ({
      start: (run.from - startFrame) / sampleRate,
      end: (run.to - startFrame) / sampleRate,
      durationMs: ((run.to - run.from) / sampleRate) * 1000,
    }));
}

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

  const floor = dbToGain(silenceFloorDbfs);
  const { first, last } = findSpeechBounds(samples, frames, channels, floor);
  if (last <= first) return null;

  const leadFrames = Math.round((leadInMs / 1000) * sampleRate);
  const startFrame = Math.max(0, first - leadFrames);
  const endFrame = Math.min(frames - 1, last + leadFrames);
  const speechFrames = endFrame - startFrame + 1;

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

  const pauses = findPauses(samples, startFrame, endFrame, channels, sampleRate);

  let gain = Number.isFinite(rmsDbfs) ? dbToGain(targetDbfs - rmsDbfs) : 1;

  const ceiling = dbToGain(peakCeilingDbfs);
  if (peak > 0 && peak * gain > ceiling) gain = ceiling / peak;

  const gapFrames = Math.round((gapMs / 1000) * sampleRate);
  const outFrames = speechFrames + gapFrames;
  const outSamples = new Int16Array(outFrames * channels);

  const fadeFrames = Math.min(
    Math.round((fadeMs / 1000) * sampleRate),
    Math.floor(speechFrames / 2)
  );

  for (let f = 0; f < speechFrames; f += 1) {
    let envelope = 1;
    if (fadeFrames > 0) {
      if (f < fadeFrames) envelope = f / fadeFrames;
      else if (f >= speechFrames - fadeFrames) envelope = (speechFrames - 1 - f) / fadeFrames;
    }

    for (let c = 0; c < channels; c += 1) {
      const value = samples[(startFrame + f) * channels + c] * gain * envelope * FULL_SCALE;
      outSamples[f * channels + c] = Math.max(-32768, Math.min(32767, Math.round(value)));
    }
  }

  const outData = Buffer.from(outSamples.buffer, outSamples.byteOffset, outSamples.byteLength);
  const header = buildHeader(outData.length, { channels, sampleRate, bitsPerSample: 16 });
  fs.writeFileSync(filePath, Buffer.concat([header, outData]));

  return {
    sampleRate,
    channels,
    gainDb: 20 * Math.log10(gain),
    rmsDbfsBefore: rmsDbfs,
    trimmedMs: ((frames - speechFrames) / sampleRate) * 1000,
    durationSec: outFrames / sampleRate,
    speechSec: speechFrames / sampleRate,
    pauses,
  };
}

export { readWavInfo, readWavDuration, isProcessable, processChunk, findPauses };
