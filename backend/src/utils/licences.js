// Per-voice licensing, because "free to download" and "free to publish" are not
// the same thing and nothing in the voice files says which you have.
//
// Piper's .onnx.json carries no licence field at all - only a `dataset` name - so
// the terms live here, read from each voice's MODEL_CARD on HuggingFace and, where
// that only linked out, from the source dataset's own licence page. Checked
// 2026-09-04. A voice missing from this table reports 'unknown', which is the
// honest answer and deliberately not 'yes'.
//
// The table is keyed by **dataset**, not by voice id: a licence covers every
// quality of a voice, so `ryan` covers ryan-low/medium/high together.

// use:
//   'yes'     - publish freely, monetised or not, nothing owed
//   'credit'  - commercial use allowed, but you must credit
//   'no'      - not licensed for monetised or commercial use
//   'unknown' - the MODEL_CARD does not say, or points somewhere that does not
const PIPER = {
  // --- public domain / CC0: no strings ---------------------------------------
  cori: { id: 'Public domain', use: 'yes' },
  bryce: { id: 'Public domain', use: 'yes' },
  john: { id: 'Public domain', use: 'yes' },
  kristin: { id: 'Public domain', use: 'yes' },
  norman: { id: 'Public domain', use: 'yes' },
  ljspeech: { id: 'Public domain', use: 'yes' },
  joe: { id: 'CC0', use: 'yes' },
  mike: { id: 'CC0', use: 'yes' },
  reza_ibrahim: { id: 'CC0', use: 'yes' },
  sam: { id: 'Apache-2.0', use: 'yes' },

  // --- commercial allowed, attribution required ------------------------------
  alba: { id: 'CC BY 4.0', use: 'credit', credit: 'the Alba voice dataset' },
  aru: { id: 'CC BY 4.0', use: 'credit', credit: 'the ARU speech corpus' },
  vctk: { id: 'CC BY 4.0', use: 'credit', credit: 'the VCTK corpus' },
  libritts: { id: 'CC BY 4.0', use: 'credit', credit: 'LibriTTS' },
  libritts_r: { id: 'CC BY 4.0', use: 'credit', credit: 'LibriTTS-R' },
  northern_english_male: { id: 'CC BY-SA 4.0', use: 'credit', credit: 'the source dataset (share-alike)' },
  southern_english_female: { id: 'CC BY-SA 4.0', use: 'credit', credit: 'the source dataset (share-alike)' },
  // Its licence names the exact wording it wants, so pass that through verbatim.
  jenny_dioco: { id: 'Custom (commercial OK)', use: 'credit', credit: 'Jenny (Dioco)' },

  // --- not licensed for monetised use ----------------------------------------
  ryan: { id: 'CC BY-NC-SA 4.0', use: 'no' },
  hfc_female: { id: 'CC BY-NC-SA 4.0', use: 'no' },
  hfc_male: { id: 'CC BY-NC-SA 4.0', use: 'no' },
  semaine: { id: 'CC BY-NC-SA 4.0', use: 'no' },
  l2arctic: { id: 'CC BY-NC 4.0', use: 'no' },
  // Blizzard 2013: a research licence, granted per named person after manual
  // approval. Narrower than CC BY-NC, not broader.
  lessac: { id: 'Blizzard 2013 research licence', use: 'no' },

  // --- genuinely unclear, listed so they are not silently treated as safe -----
  // Mycroft's mimic3 datasets: the MODEL_CARD says only "See URL", and the source
  // folder for apope (alan) carries "Copyright 2022 Mycroft AI, All Rights
  // Reserved".
  amy: { id: 'Mycroft mimic3 - unstated', use: 'unknown' },
  danny: { id: 'Mycroft mimic3 - unstated', use: 'unknown' },
  alan: { id: 'Mycroft mimic3 - "All Rights Reserved"', use: 'unknown' },
  kusal: { id: 'Mycroft mimic3 - unstated', use: 'unknown' },
  kathleen: { id: 'No licence stated', use: 'unknown' },
  arctic: { id: 'CMU ARCTIC - see LICENSE', use: 'unknown' },
};

// Whole-engine licences: these ship one licence covering every voice.
const BY_ENGINE = {
  kokoro: { id: 'Apache-2.0', use: 'yes' },
  // Weights are OpenRAIL-M: commercial use is permitted, but there are
  // attribution requirements and use-based restrictions attached.
  supertonic: { id: 'OpenRAIL-M', use: 'credit', credit: 'Supertonic (OpenRAIL-M, use restrictions apply)' },
};

const UNKNOWN = { id: 'Unknown', use: 'unknown' };

function licenceFor(voice) {
  if (!voice) return UNKNOWN;
  if (voice.engine === 'piper') return PIPER[voice.name] || UNKNOWN;
  return BY_ENGINE[voice.engine] || UNKNOWN;
}

// Attaches the licence without mutating the engine's own object.
function withLicence(voice) {
  return { ...voice, licence: licenceFor(voice) };
}

export { licenceFor, withLicence, PIPER, BY_ENGINE };
