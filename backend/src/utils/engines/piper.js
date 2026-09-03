import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { paths } from '../../config/env.js';

const MODEL_PATTERN = /^([a-z]{2}_[A-Z]{2})-(.+)-(x_low|low|medium|high)\.onnx$/;

const VOICE_LABELS = {
  amy: 'Clear American Female',
  kathleen: 'Warm American Female',
  lessac: 'Natural American Female',
  ryan: 'Deep American Male',
  danny: 'Casual American Male',
  joe: 'Smooth American Male',
  hfc_female: 'Bright American Female',
  hfc_male: 'Even American Male',
  kristin: 'Soft American Female',
  bryce: 'Relaxed American Male',
  john: 'Measured American Male',
  norman: 'Older American Male',
  ljspeech: 'Neutral American Female',
  alba: 'Scottish Female',
  alan: 'British Male',
  jenny_dioco: 'British Female',
  cori: 'Refined British Female',
  northern_english_male: 'Northern British Male',
  southern_english_female: 'Southern British Female',
  semaine: 'Expressive British',
  aru: 'Indian English',
};

const DESCRIPTIVE_STEMS = new Set([
  'hfc_female',
  'hfc_male',
  'northern_english_male',
  'southern_english_female',
  'ljspeech',
  'semaine',
  'aru',
  'libritts',
  'libritts_r',
  'arctic',
  'l2arctic',
  'vctk',
]);

const LOCALE_GROUPS = {
  en_US: 'American English',
  en_GB: 'British English',
};

const QUALITY_GUIDE = {
  low: { bestFor: 'Fastest, long books and draft runs (~10 min per hour of audio)', speedFactor: 0.16 },
  medium: { bestFor: 'Best balance, the default choice for full books (~15 min per hour)', speedFactor: 0.25 },
  high: { bestFor: 'Most natural Piper voice, but slow (~1 hour per hour of audio)', speedFactor: 0.97 },
  x_low: { bestFor: 'Very fast, noticeably robotic, drafts only', speedFactor: 0.12 },
};

const titleCase = (s) =>
  s
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

function installed() {
  return fs.existsSync(paths.piperExe);
}

function listVoices() {
  if (!installed() || !fs.existsSync(paths.voicesDir)) return [];

  return fs
    .readdirSync(paths.voicesDir)
    .filter((file) => file.endsWith('.onnx'))
    .filter((file) => fs.existsSync(path.join(paths.voicesDir, `${file}.json`)))
    .map((file) => {
      const match = file.match(MODEL_PATTERN);
      const id = file.replace(/\.onnx$/, '');
      if (!match) {
        return {
          id,
          engine: 'piper',
          name: id,
          locale: null,
          quality: 'unknown',
          label: id,
          group: 'Other',
          file,
        };
      }
      const [, locale, name, quality] = match;
      const description = VOICE_LABELS[name] || `${locale.replace('_', '-')} Voice`;
      const label = DESCRIPTIVE_STEMS.has(name)
        ? `${description} (${quality})`
        : `${titleCase(name)} | ${description} (${quality})`;
      const guide = QUALITY_GUIDE[quality] || {};
      return {
        id,
        engine: 'piper',
        name,
        locale,
        quality,
        label,
        group: LOCALE_GROUPS[locale] || locale.replace('_', '-'),
        bestFor: guide.bestFor || 'General narration',
        speedFactor: guide.speedFactor ?? null,
        file,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

function synthesize({ text, voice, speed, outputPath, onSpawn }) {
  return new Promise((resolve, reject) => {
    if (!installed()) {
      const error = new Error(
        'Piper TTS not found. Please follow the setup instructions in README.md.'
      );
      error.code = 'PIPER_NOT_FOUND';
      return reject(error);
    }

    const lengthScale = String(1 / Number(speed || 1));

    const piper = spawn(paths.piperExe, [
      '--model', path.join(paths.voicesDir, voice.file),
      '--output_file', outputPath,
      '--length_scale', lengthScale,
      '--sentence_silence', '0.3',
    ]);

    if (onSpawn) onSpawn(piper);

    let stderr = '';
    piper.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    piper.stdin.on('error', () => {
    });
    piper.stdin.write(text, 'utf8');
    piper.stdin.end();

    piper.on('error', (err) => {
      const error = new Error(`Could not run Piper TTS: ${err.message}`);
      error.code = 'PIPER_SPAWN_FAILED';
      reject(error);
    });

    piper.on('close', (code, signal) => {
      if (signal) {
        const error = new Error('Generation cancelled.');
        error.code = 'CANCELLED';
        return reject(error);
      }
      if (code !== 0) {
        const error = new Error(
          `Piper exited with code ${code}. ${stderr.trim().split('\n').slice(-3).join(' ')}`
        );
        error.code = 'PIPER_FAILED';
        return reject(error);
      }
      if (!fs.existsSync(outputPath)) {
        const error = new Error('Piper finished but produced no audio file.');
        error.code = 'PIPER_NO_OUTPUT';
        return reject(error);
      }
      resolve(outputPath);
    });
  });
}

export { installed, listVoices, synthesize };
