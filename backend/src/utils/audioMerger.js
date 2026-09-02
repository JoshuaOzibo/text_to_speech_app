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

function buildBackgroundGraph(sampleRate, levelDb, durationSec) {
  const mono = 'aformat=sample_fmts=fltp:channel_layouts=mono';
  const rate = sampleRate > 0 ? `,aresample=${sampleRate}` : '';
  const fade = Math.max(0, config.backgroundFadeSec);
  const voice = voiceFilters();

  const bedFades = [`afade=t=in:st=0:d=${fade}`];
  if (durationSec > fade * 2) {
    bedFades.push(`afade=t=out:st=${(durationSec - fade).toFixed(2)}:d=${fade}`);
  }

  return [
    `[0:a]${mono}${rate}${voice.length ? `,${voice.join(',')}` : ''},asplit=2[v][vkey]`,
    `[1:a]${mono}${rate},volume=${levelDb}dB,${bedFades.join(',')}[bed]`,
    `[bed][vkey]sidechaincompress=threshold=0.02:ratio=8:attack=25:release=450:makeup=1[ducked]`,
    `[v][ducked]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mixed]`,
    `[mixed]${masterFilters(sampleRate).join(',')}[out]`,
  ];
}

function mergeWavsToMp3(wavFiles, outputMp3Path, onProgress, background = null) {
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

    const bed = background?.file && fs.existsSync(background.file) ? background : null;

    const command = ffmpeg().input(listFile).inputOptions(['-f', 'concat', '-safe', '0']);

    if (bed) {
      const durationSec = totalWavDuration(wavFiles);
      const levelDb = Number.isFinite(bed.levelDb) ? bed.levelDb : config.backgroundLevelDb;
      command
        .input(bed.file)
        .inputOptions(['-stream_loop', '-1'])
        .complexFilter(buildBackgroundGraph(sampleRate, levelDb, durationSec), 'out');
    } else {
      command.audioFilters(buildFilterChain(sampleRate));
    }

    command
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

export {
  ffmpegAvailable,
  ffmpegPath,
  readWavInfo,
  readWavDuration,
  totalWavDuration,
  buildFilterChain,
  buildBackgroundGraph,
  mergeWavsToMp3,
};
