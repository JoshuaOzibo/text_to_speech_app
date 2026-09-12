import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import { config } from '../config/env.js';
import { readWavInfo, readWavDuration } from './wavProcessor.js';

if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);

function ffmpegAvailable() {
  return Boolean(ffmpegPath && fs.existsSync(ffmpegPath));
}

function totalWavDuration(wavFiles) {
  return wavFiles.reduce((sum, file) => sum + readWavDuration(file), 0);
}

function voiceFilters() {
  const filters = [];
  if (config.highpassHz > 0) filters.push(`highpass=f=${config.highpassHz}`);
  if (config.compressorEnabled) {
    filters.push('acompressor=threshold=-20dB:ratio=4:attack=5:release=50');
  }
  return filters;
}

function masterFilters(sampleRate) {
  const filters = [
    `loudnorm=I=${config.loudnormI}:TP=${config.loudnormTp}:LRA=${config.loudnormLra}`,
  ];
  if (sampleRate > 0) filters.push(`aresample=${sampleRate}`);
  return filters;
}

function buildFilterChain(sampleRate) {
  return [...voiceFilters(), ...masterFilters(sampleRate)];
}

/** ffmpeg's "HH:MM:SS.mm" position into seconds; NaN if it is not a timemark. */
function timemarkToSeconds(timemark) {
  const match = /^(\d+):(\d\d):(\d\d(?:\.\d+)?)$/.exec(String(timemark || '').trim());
  if (!match) return NaN;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

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
      }
    };

    const sampleRate = readWavInfo(wavFiles[0])?.sampleRate || 0;

    const command = ffmpeg().input(listFile).inputOptions(['-f', 'concat', '-safe', '0']);


    command.audioFilters(buildFilterChain(sampleRate));

    command
      .audioCodec('libmp3lame')
      .audioBitrate(config.mp3Bitrate)
      .audioChannels(1)
      .output(outputMp3Path);

    if (sampleRate > 0) command.audioFrequency(sampleRate);

    if (onProgress) {
      // ffmpeg cannot report a percentage for a concat input - it does not know
      // the total duration when it starts, so fluent-ffmpeg leaves p.percent
      // undefined and the bar used to sit frozen at 80% for the whole merge
      // (25 minutes on a 7-hour book, which reads exactly like a hang).
      //
      // timemark IS always reported, and the total duration is already known
      // from the WAV headers, so derive the percentage here and treat
      // p.percent as the preferred value only when ffmpeg supplies a real one.
      const totalSeconds = totalWavDuration(wavFiles);

      command.on('progress', (p) => {
        let percent = typeof p.percent === 'number' && Number.isFinite(p.percent) ? p.percent : NaN;

        if (!Number.isFinite(percent) && totalSeconds > 0) {
          const done = timemarkToSeconds(p.timemark);
          if (Number.isFinite(done)) percent = (done / totalSeconds) * 100;
        }

        if (Number.isFinite(percent)) onProgress(Math.max(0, Math.min(100, percent)));
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

export {
  ffmpegAvailable,
  ffmpegPath,
  readWavInfo,
  readWavDuration,
  totalWavDuration,
  buildFilterChain,
  mergeWavsToMp3,
};
