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

function buildFilterChain(sampleRate) {
  const filters = [];

  if (config.highpassHz > 0) {
    filters.push(`highpass=f=${config.highpassHz}`);
  }

  if (config.compressorEnabled) {
    filters.push('acompressor=threshold=-20dB:ratio=4:attack=5:release=50');
  }

  filters.push(
    `loudnorm=I=${config.loudnormI}:TP=${config.loudnormTp}:LRA=${config.loudnormLra}`
  );

  if (sampleRate > 0) filters.push(`aresample=${sampleRate}`);

  return filters;
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

    const command = ffmpeg()
      .input(listFile)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .audioFilters(buildFilterChain(sampleRate))
      .audioCodec('libmp3lame')
      .audioBitrate(config.mp3Bitrate)
      .audioChannels(1)
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

export { ffmpegAvailable, ffmpegPath, readWavInfo, readWavDuration, totalWavDuration, buildFilterChain, mergeWavsToMp3 };
