/**
 * Imports chunk audio rendered on a GPU box back into audio/chunks/, so that
 * POST /api/generate/resume can condition, time and merge it locally.
 *
 *   npm run gpu:import --prefix backend -- <folder>
 *
 * The folder is whatever the Kaggle output zip extracted to. Nothing here touches
 * text, chunking or the manifest's identity: audio/chunks/run.json was written by
 * POST /api/gpu/export before the job left, and this only fills in the WAVs it is
 * still waiting for.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { paths } from '../src/config/env.js';
import { readWavInfo, isProcessable } from '../src/utils/wavProcessor.js';
import { renameWithRetry } from '../src/utils/atomicFile.js';
import { readManifest, chunkWav, chunkSidecar } from '../src/utils/runManifest.js';

const AUDIO_EXTENSIONS = ['.flac', '.wav'];
const CHUNK_NAME = /^chunk-(\d{4})\.(flac|wav)$/i;

const bail = (message) => {
  console.error(`\n  ${message}\n`);
  process.exit(1);
};

/** Kaggle zips often carry one wrapper folder; look one level down before giving up. */
function findChunkDir(root) {
  const hasChunks = (dir) =>
    fs.readdirSync(dir).some((entry) => CHUNK_NAME.test(entry));

  if (hasChunks(root)) return root;

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const nested = path.join(root, entry.name);
    try {
      if (hasChunks(nested)) return nested;
    } catch {
      // unreadable subdirectory, keep looking
    }
  }
  return null;
}

function decodeToWav(source, target) {
  // -f wav because the target carries a .part extension while it is being written,
  // so ffmpeg cannot infer the container from the name.
  const result = spawnSync(
    ffmpegPath,
    ['-nostdin', '-v', 'error', '-y', '-i', source, '-c:a', 'pcm_s16le', '-f', 'wav', target],
    { encoding: 'utf8' }
  );
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `ffmpeg exited ${result.status}`);
  }
}

const sourceArg = process.argv[2];
if (!sourceArg) {
  bail('Usage: npm run gpu:import --prefix backend -- <folder of chunk-NNNN.flac files>');
}

const sourceRoot = path.resolve(sourceArg);
if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
  bail(`Not a folder: ${sourceRoot}`);
}

const manifest = readManifest();
if (!manifest) {
  bail(
    'There is no run.json in audio/chunks/. Run POST /api/gpu/export for this book, voice and\n' +
      '  speed first - that is what creates the run these chunks belong to.'
  );
}

const sourceDir = findChunkDir(sourceRoot);
if (!sourceDir) {
  bail(`No chunk-NNNN.flac or chunk-NNNN.wav files found in ${sourceRoot} or its subfolders.`);
}

const entries = fs.readdirSync(sourceDir);

// A sidecar written remotely would be catastrophic and silent: generate.js trusts any
// sidecar that has no `bytes` field as legacy work, so conditioning would be skipped
// for ever - no levelling, no fades, no gap padding, and an empty `pauses` array that
// leaves the chunk with no word timeline.
const strayCars = entries.filter((entry) => /^chunk-\d{4}\.json$/i.test(entry));
if (strayCars.length) {
  bail(
    `${strayCars.length} chunk-NNNN.json sidecar(s) are in the import folder. Delete them and\n` +
      '  re-run: a sidecar makes the local pass skip conditioning for that chunk permanently.\n' +
      '  Measurements are made here, from the audio, not on the GPU box.'
  );
}

const found = new Map();
for (const entry of entries) {
  const match = CHUNK_NAME.exec(entry);
  if (!match) continue;
  const index = Number(match[1]) - 1;
  if (index < 0 || index >= manifest.total) {
    console.warn(`  skipping ${entry}: outside the manifest's 1..${manifest.total}`);
    continue;
  }
  // Prefer .flac when both are present; either decodes to the same WAV.
  const existing = found.get(index);
  if (!existing || path.extname(existing).toLowerCase() === '.wav') {
    found.set(index, path.join(sourceDir, entry));
  }
}

if (!found.size) bail(`No usable chunk files in ${sourceDir}.`);

console.log(`\n  run      ${manifest.key}  (${manifest.total} chunks)`);
console.log(`  voice    ${manifest.voice} @ ${manifest.speed}x`);
console.log(`  source   ${sourceDir}`);
console.log(`  target   ${paths.chunks}\n`);

fs.mkdirSync(paths.chunks, { recursive: true });

let imported = 0;
let skipped = 0;
let failed = 0;
const rates = new Set();

for (const index of [...found.keys()].sort((a, b) => a - b)) {
  const target = chunkWav(index);
  const label = `chunk-${String(index + 1).padStart(4, '0')}`;

  if (fs.existsSync(target)) {
    skipped += 1;
    continue;
  }

  const source = found.get(index);
  const partPath = `${target}.part`;

  try {
    decodeToWav(source, partPath);

    const info = readWavInfo(partPath);
    if (!isProcessable(info)) {
      fs.rmSync(partPath, { force: true });
      throw new Error('decoded to a WAV the conditioning pass cannot read');
    }
    rates.add(`${info.sampleRate}Hz/${info.channels}ch`);

    // Rename last, so an interrupted import can never leave a truncated file that
    // later looks like a finished chunk.
    renameWithRetry(partPath, target);

    // A leftover sidecar from an earlier local attempt would be measured against the
    // wrong bytes; drop it and let the local pass rebuild it.
    fs.rmSync(chunkSidecar(index), { force: true });

    imported += 1;
    if (imported % 50 === 0) console.log(`  ${imported} imported…`);
  } catch (error) {
    failed += 1;
    fs.rmSync(partPath, { force: true });
    console.error(`  ${label} failed: ${error.message}`);
  }
}

const onDisk = fs
  .readdirSync(paths.chunks)
  .filter((entry) => /^chunk-\d{4}\.wav$/i.test(entry)).length;

console.log(`\n  imported ${imported}   already present ${skipped}   failed ${failed}`);
console.log(`  formats  ${[...rates].join(', ') || 'n/a'}`);
console.log(`  on disk  ${onDisk}/${manifest.total}\n`);

if (onDisk < manifest.total) {
  console.log(
    `  ${manifest.total - onDisk} chunk(s) still missing. Resume will synthesise those locally,\n` +
      '  so import the rest first if the GPU run is not finished.\n'
  );
} else {
  console.log('  Complete. Press Resume in the sidebar (or POST /api/generate/resume) to\n' +
    '  condition, time and merge it - no synthesis will run.\n');
}

process.exit(failed && !imported ? 1 : 0);
