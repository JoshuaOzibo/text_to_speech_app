'use strict';

const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { config } = require('../config/env');
const { readWavInfo, readWavDuration } = require('./wavProcessor');

// ffmpeg-static ships a platform-specific binary, so no PATH setup is required.
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);

function ffmpegAvailable() {
  return Boolean(ffmpegPath && fs.existsSync(ffmpegPath));
}

/** Total duration in seconds across a list of WAV files. */
function totalWavDuration(wavFiles) {
  return wavFiles.reduce((sum, file) => sum + readWavDuration(file), 0);
}

/**
 * Build the mastering filter chain.
 *
 * Order is deliberate and differs from the naive "normalise then compress":
 * clean → dynamics → loudness. `loudnorm` must come last, because a compressor
 * applied after it would pull the result back off the EBU R128 target it just
 * hit.
 */
function buildFilterChain(sampleRate) {
  const filters = [];

  // Rumble and DC offset below the vocal range; harmless to speech.
  if (config.highpassHz > 0) {
    filters.push(`highpass=f=${config.highpassHz}`);
  }

  // Gentle levelling of the occasional loud word.
  if (config.compressorEnabled) {
    filters.push('acompressor=threshold=-20dB:ratio=4:attack=5:release=50');
  }

  // EBU R128 loudness, so the finished book sits at a consistent, broadcast-like
  // level rather than wherever the voice happened to land.
  filters.push(
    `loudnorm=I=${config.loudnormI}:TP=${config.loudnormTp}:LRA=${config.loudnormLra}`
  );

  // loudnorm resamples to 192kHz internally and leaves the stream there, which
  // would otherwise land the MP3 at 48kHz regardless of what the voice actually
  // produced. Put it back on the source rate so Piper books stay 22.05kHz and
  // Supertonic books stay 44.1kHz.
  if (sampleRate > 0) filters.push(`aresample=${sampleRate}`);

  return filters;
}

/**
 * Concatenate conditioned WAV chunks and master them into the final MP3.
 *
 * This is one ffmpeg invocation, not four. Writing an intermediate merged WAV
 * would cost ~2.5GB of scratch space for an eight-hour 44.1kHz book, and each
 * extra pass would re-decode the whole thing.
 *
 * The concat *demuxer* is used rather than the concat *filter*: the filter needs
 * every chunk passed as its own `-i` argument, which on a 200-chunk book risks
 * the Windows command-line length limit. Per-chunk fades and padding (see
 * wavProcessor) already make the joins seamless, so the demuxer is sufficient.
 *
 * The sample rate is deliberately not forced — each run's chunks all come from
 * one voice, and pinning a rate here would resample Supertonic's 44.1kHz down to
 * Piper's, throwing away the quality that lets those books reach a true 192kbps.
 */
function mergeWavsToMp3(wavFiles, outputMp3Path, onProgress) {
  return new Promise((resolve, reject) => {
    if (!ffmpegAvailable()) {
      const error = new Error('ffmpeg not found. Install it using: npm install ffmpeg-static');
      error.code = 'FFMPEG_NOT_FOUND';
      return reject(error);
    }
    if (!wavFiles.length) {
      const error = new Error('No audio chunks were produced.');
      error.code = 'NO_CHUNKS';
      return reject(error);
    }

    const listFile = path.join(path.dirname(outputMp3Path), 'concat_list.txt');
    const listContent = wavFiles
      .map((file) => `file '${path.resolve(file).replace(/\\/g, '/')}'`)
      .join('\n');
    fs.writeFileSync(listFile, listContent, 'utf8');

    const cleanupList = () => {
      try {
        fs.unlinkSync(listFile);
      } catch {
        /* already gone */
      }
    };

    // All chunks in a run come from one voice, so the first one's rate is the
    // run's rate.
    const sampleRate = readWavInfo(wavFiles[0])?.sampleRate || 0;

    const command = ffmpeg()
      .input(listFile)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .audioFilters(buildFilterChain(sampleRate))
      .audioCodec('libmp3lame')
      .audioBitrate(config.mp3Bitrate)
      .audioChannels(1) // both engines produce mono; keeps the file half the size
      .output(outputMp3Path);

    if (sampleRate > 0) command.audioFrequency(sampleRate);

    if (onProgress) {
      command.on('progress', (p) => {
        if (typeof p.percent === 'number' && Number.isFinite(p.percent)) {
          onProgress(Math.max(0, Math.min(100, p.percent)));
        }
      });
    }

    command
      .on('end', () => {
        cleanupList();
        resolve(outputMp3Path);
      })
      .on('error', (err) => {
        cleanupList();
        const error = new Error(`Audio merge failed: ${err.message}`);
        error.code = 'MERGE_FAILED';
        reject(error);
      })
      .run();
  });
}

module.exports = {
  ffmpegAvailable,
  ffmpegPath,
  // Re-exported from wavProcessor so existing callers keep working.
  readWavInfo,
  readWavDuration,
  totalWavDuration,
  buildFilterChain,
  mergeWavsToMp3,
};
