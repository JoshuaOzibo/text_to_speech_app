/**
 * Download the Supertonic ONNX weights and voice styles.
 *
 * The vendored inference code (backend/supertonic/helper.js) is in the repo,
 * but the ~380MB of model weights are not — this fetches them from HuggingFace
 * into the layout the engine expects. Safe to re-run: existing files are kept.
 *
 *   node scripts/get-supertonic.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'backend', 'supertonic', 'assets');
const BASE = 'https://huggingface.co/Supertone/supertonic-3/resolve/main';

const ONNX = [
  'duration_predictor.onnx',
  'text_encoder.onnx',
  'vector_estimator.onnx',
  'vocoder.onnx',
  'tts.json',
  'unicode_indexer.json',
];
const STYLES = ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'];

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

async function download(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    console.log(`  skip  ${path.basename(dest)} (already present)`);
    return;
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  // Write to a temp name first so an interrupted run can't leave a truncated
  // model that later looks "already present".
  const tmp = `${dest}.part`;
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, dest);
  console.log(`  ok    ${path.basename(dest)}  ${mb(buffer.length)}`);
}

const onnxDir = path.join(assets, 'onnx');
const stylesDir = path.join(assets, 'voice_styles');
fs.mkdirSync(onnxDir, { recursive: true });
fs.mkdirSync(stylesDir, { recursive: true });

console.log('Downloading Supertonic models (~380MB) …');
for (const file of ONNX) {
  await download(`${BASE}/onnx/${file}`, path.join(onnxDir, file));
}

console.log('Downloading voice styles …');
for (const style of STYLES) {
  await download(`${BASE}/voice_styles/${style}.json`, path.join(stylesDir, `${style}.json`));
}

console.log('\nDone. Restart the backend and the Supertonic voices will appear.');
console.log('Model weights are OpenRAIL-M licensed — see backend/supertonic/LICENSE.');
