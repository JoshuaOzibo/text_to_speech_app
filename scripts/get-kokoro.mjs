/**
 * Download the Kokoro-82M ONNX model into backend/kokoro/models/.
 *
 * kokoro-js would otherwise cache the weights inside
 * node_modules/@huggingface/transformers/.cache, where `npm ci` or a reinstall
 * silently deletes a 326MB download. Vendoring them alongside the Piper and
 * Supertonic assets keeps every model in one predictable place, and lets the
 * engine run with remote fetching disabled.
 *
 * Safe to re-run: existing files are kept.
 *
 *   node scripts/get-kokoro.mjs            # fp32 (default, fastest on CPU)
 *   node scripts/get-kokoro.mjs q8         # 92MB, but ~2x slower to generate
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const BASE = `https://huggingface.co/${MODEL_ID}/resolve/main`;
const dest = path.join(root, 'backend', 'kokoro', 'models', MODEL_ID);

const DTYPE_FILES = {
  fp32: 'model.onnx',
  fp16: 'model_fp16.onnx',
  q8: 'model_quantized.onnx',
  q4: 'model_q4.onnx',
  q4f16: 'model_q4f16.onnx',
};

const dtype = process.argv[2] || process.env.KOKORO_DTYPE || 'fp32';
const modelFile = DTYPE_FILES[dtype];

if (!modelFile) {
  console.error(`Unknown dtype "${dtype}". Choose one of: ${Object.keys(DTYPE_FILES).join(', ')}`);
  process.exit(1);
}

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

async function download(url, target) {
  if (fs.existsSync(target) && fs.statSync(target).size > 0) {
    console.log(`  skip  ${path.basename(target)} (already present)`);
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  // Write to a temp name first so an interrupted run can't leave a truncated
  // model that later looks "already present".
  const tmp = `${target}.part`;
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, target);
  console.log(`  ok    ${path.basename(target)}  ${mb(buffer.length)}`);
}

console.log(`Downloading Kokoro-82M (${dtype}) …`);

for (const file of ['config.json', 'tokenizer.json', 'tokenizer_config.json']) {
  await download(`${BASE}/${file}`, path.join(dest, file));
}
await download(`${BASE}/onnx/${modelFile}`, path.join(dest, 'onnx', modelFile));

console.log('\nDone. Restart the backend and 28 Kokoro voices will appear.');
if (dtype !== 'fp32') {
  console.log(`Set KOKORO_DTYPE=${dtype} in backend/.env so the engine loads this build.`);
}
console.log('Model and code are Apache-2.0 — no attribution conditions.');
