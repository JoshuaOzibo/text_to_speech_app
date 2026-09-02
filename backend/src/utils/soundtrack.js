import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { config, paths } from '../config/env.js';
import { logger, secs, timer } from './logger.js';

const MIN_SECONDS = 15;
const MAX_SECONDS = 900;
const MAX_BYTES = 40 * 1024 * 1024;

let selected = null;
const catalogue = new Map();

function remember(tracks) {
  catalogue.clear();
  for (const track of tracks) catalogue.set(`${track.provider}:${track.id}`, track);
}

function findCandidate(provider, id) {
  return catalogue.get(`${provider}:${id}`) || null;
}

function pixabayAvailable() {
  return Boolean(config.pixabayApiKey);
}

function normalisePixabay(hit) {
  const id = hit?.id ?? hit?.audio_id;
  const audioUrl = hit?.audio || hit?.audio_url || hit?.preview || hit?.previewURL;
  if (!id || !audioUrl) return null;

  return {
    provider: 'pixabay',
    id: String(id),
    title: String(hit.title || hit.tags || `Pixabay ${id}`).slice(0, 90),
    author: String(hit.user || 'Pixabay contributor'),
    durationSec: Number(hit.duration) || 0,
    license: 'Pixabay Content License',
    licenseNote: 'Commercial use allowed, no attribution required.',
    attribution: null,
    pageUrl: hit.pageURL || `https://pixabay.com/music/-${id}/`,
    audioUrl,
  };
}

function normaliseFreesound(hit) {
  const audioUrl = hit?.previews?.['preview-hq-mp3'] || hit?.previews?.['preview-lq-mp3'];
  if (!hit?.id || !audioUrl) return null;

  return {
    provider: 'freesound',
    id: String(hit.id),
    title: String(hit.name || `Freesound ${hit.id}`).replace(/\.[a-z0-9]+$/i, '').slice(0, 90),
    author: String(hit.username || 'Unknown'),
    durationSec: Math.round(Number(hit.duration) || 0),
    license: 'CC0',
    licenseNote: 'CC0 — public domain, commercial use, no credit required.',
    attribution: null,
    pageUrl: `https://freesound.org/s/${hit.id}/`,
    audioUrl,
  };
}

const VOCAL_TAGS = [
  'vocals', 'vocal', 'lyrics', 'rap', 'song', 'singing', 'acappella', 'a_capella',
  'spoken_word', 'male_vocals', 'female_vocals', 'choir',
];

function ccMixterTags(hit) {
  return `${hit?.upload_tags || ''},${hit?.upload_extra?.usertags || ''}`.toLowerCase();
}

function parsePlayTime(value) {
  const raw = String(value || '').trim();
  if (!/^\d+(:\d{1,2})*$/.test(raw)) return 0;
  return raw.split(':').reduce((total, part) => total * 60 + Number(part), 0);
}

function ccMixterDuration(file) {
  let info = file?.file_format_info;
  if (typeof info === 'string') {
    try {
      info = JSON.parse(info);
    } catch {
      info = null;
    }
  }

  const played = parsePlayTime(info?.ps);
  if (played) return played;

  const bytes = Number(file?.file_rawsize) || 0;
  return bytes ? Math.round(bytes / 16000) : 0;
}

function normaliseCcMixter(hit) {
  const files = Array.isArray(hit?.files) ? hit.files : [];
  const file =
    files.find((entry) => /\.mp3$/i.test(entry.download_url || entry.file_name || '')) || files[0];
  const audioUrl = file?.download_url;
  if (!hit?.upload_id || !audioUrl) return null;

  const tags = ccMixterTags(hit);
  if (VOCAL_TAGS.some((tag) => tags.includes(tag))) return null;

  const title = String(hit.upload_name || `ccMixter ${hit.upload_id}`).slice(0, 90);
  const author = String(hit.user_name || 'Unknown');

  return {
    provider: 'ccmixter',
    id: String(hit.upload_id),
    title,
    author,
    instrumental: tags.includes('instrumental'),
    durationSec: ccMixterDuration(file),
    license: String(hit.license_name || 'CC BY'),
    licenseNote: 'Creative Commons Attribution — commercial use allowed, credit required.',
    attribution: `"${title}" by ${author} — ${hit.license_url || 'https://creativecommons.org/licenses/by/3.0/'}`,
    pageUrl: hit.file_page_url || `http://ccmixter.org/files/${author}/${hit.upload_id}`,
    audioUrl,
  };
}

function normaliseOpenverse(hit) {
  if (!hit?.id || !hit?.url) return null;

  return {
    provider: 'openverse',
    id: String(hit.id),
    title: String(hit.title || 'Untitled').slice(0, 90),
    author: String(hit.creator || 'Unknown'),
    durationSec: hit.duration ? Math.round(hit.duration / 1000) : 0,
    license: `${String(hit.license || 'cc0').toUpperCase()}${hit.license_version ? ` ${hit.license_version}` : ''}`,
    licenseNote: 'CC0 — public domain dedication, commercial use allowed.',
    attribution: null,
    pageUrl: hit.foreign_landing_url || hit.detail_url || '',
    audioUrl: hit.url,
  };
}

const USER_AGENT = 'LocalAudioBook/1.0 (local audiobook tool)';
const SEARCH_TIMEOUT_MS = 9000;
const ENOUGH_TRACKS = 8;

async function fetchJson(url, label, attempt = 0) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const error = new Error(`${label} returned ${response.status}: ${detail.slice(0, 160)}`);
      error.code = 'SOUNDTRACK_SEARCH_FAILED';
      error.status = response.status;
      throw error;
    }
    return await response.json();
  } catch (error) {
    const network = !error.status && error.name !== 'TimeoutError';
    if (!network) throw error;

    const reason = error.cause?.code || error.cause?.message || error.message;
    if (attempt === 0) {
      logger.debug('sound', `${label} connection failed, retrying once`, { why: reason });
      await new Promise((resolve) => setTimeout(resolve, 500));
      return fetchJson(url, label, 1);
    }

    const wrapped = new Error(`${label} could not be reached (${reason})`);
    wrapped.code = 'SOUNDTRACK_SEARCH_FAILED';
    throw wrapped;
  }
}

async function searchPixabay(term) {
  const url =
    `https://pixabay.com/api/audio/?key=${encodeURIComponent(config.pixabayApiKey)}` +
    `&q=${encodeURIComponent(term)}&per_page=20&safesearch=true`;

  const body = await fetchJson(url, 'Pixabay');
  const hits = Array.isArray(body?.hits) ? body.hits : [];

  if (hits.length && !normalisePixabay(hits[0])) {
    logger.warn('sound', 'Pixabay hit did not match the expected shape', {
      keys: Object.keys(hits[0]).join(','),
    });
  }

  return hits.map(normalisePixabay).filter(Boolean);
}

async function searchFreesound(term) {
  const url =
    'https://freesound.org/apiv2/search/text/' +
    `?query=${encodeURIComponent(term)}` +
    `&filter=${encodeURIComponent('license:"Creative Commons 0"')}` +
    '&fields=id,name,username,duration,previews,license&page_size=20' +
    `&token=${encodeURIComponent(config.freesoundApiKey)}`;

  const body = await fetchJson(url, 'Freesound');
  const hits = Array.isArray(body?.results) ? body.results : [];
  return hits.map(normaliseFreesound).filter(Boolean);
}

function requestJson(url, label) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === 'https:' ? https : http;

    const request = client.request(
      target,
      {
        method: 'GET',
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        maxHeaderSize: 256 * 1024,
        timeout: SEARCH_TIMEOUT_MS,
      },
      (response) => {
        if (response.statusCode >= 400) {
          response.resume();
          const error = new Error(`${label} returned ${response.statusCode}`);
          error.code = 'SOUNDTRACK_SEARCH_FAILED';
          error.status = response.statusCode;
          return reject(error);
        }

        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            const error = new Error(`${label} sent a malformed response`);
            error.code = 'SOUNDTRACK_SEARCH_FAILED';
            reject(error);
          }
        });
      },
    );

    request.on('timeout', () => request.destroy(new Error(`${label} timed out`)));
    request.on('error', (error) => {
      const wrapped = new Error(`${label} could not be reached (${error.code || error.message})`);
      wrapped.code = 'SOUNDTRACK_SEARCH_FAILED';
      reject(wrapped);
    });
    request.end();
  });
}

async function searchCcMixter(tag) {
  const url =
    'https://ccmixter.org/api/query?f=json&lic=open&limit=30' +
    `&tags=${encodeURIComponent(tag)}`;

  const body = await requestJson(url, 'ccMixter');
  const hits = Array.isArray(body) ? body : [];
  return hits
    .map(normaliseCcMixter)
    .filter(Boolean)
    .sort((a, b) => Number(b.instrumental) - Number(a.instrumental));
}

async function searchOpenverse(term) {
  const url =
    'https://api.openverse.org/v1/audio/' +
    `?q=${encodeURIComponent(term)}&license=cc0&page_size=20&mature=false`;

  const body = await fetchJson(url, 'Openverse');
  const hits = Array.isArray(body?.results) ? body.results : [];
  return hits.map(normaliseOpenverse).filter(Boolean);
}

const SUNG_RE =
  /\b(vocals?|vox|lyrics?|sung|singing|singer|sings|choir|chorus|acapella|acappella|a cappella|rap|rapper|karaoke|spoken word|voice ?over|narration)\b/i;

const CALM_RE =
  /\b(drone|ambient|ambience|ambiance|atmosphere|atmospheric|texture|pad|sustained|sustain|meditat\w*|singing bowl|bowl|tanpura|shruti|binaural|theta|rain|forest|wind|ocean|waves|water|space|calm|quiet|soft|sparse|minimal|slow|deep|underscore|field recording|nature|hum|tone)\b/gi;

const BUSY_RE =
  /\b(drums?|drumming|beats?|percussion|bass|bassline|techno|house|dubstep|trap|edm|dance|groove|funk|rock|metal|punk|remix|melody|melodic|song|anthem|riff|solo)\b/gi;

function searchable(track) {
  return `${track.title} ${track.author}`.toLowerCase();
}

function sungLikely(track) {
  return SUNG_RE.test(searchable(track));
}

function bedScore(track) {
  const text = searchable(track);
  const calm = (text.match(CALM_RE) || []).length;
  const busy = (text.match(BUSY_RE) || []).length;
  return calm * 2 - busy * 3 + (track.instrumental ? 1 : 0);
}

function rankForNarration(tracks) {
  return tracks
    .map((track, order) => ({ track, order, score: bedScore(track) }))
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((entry) => entry.track);
}

function usable(track) {
  if (!track.durationSec) return true;
  return track.durationSec >= MIN_SECONDS && track.durationSec <= MAX_SECONDS;
}

function providerChain() {
  const chain = [];
  if (config.pixabayApiKey) chain.push({ name: 'pixabay', search: searchPixabay });
  if (config.freesoundApiKey) chain.push({ name: 'freesound', search: searchFreesound });
  chain.push({ name: 'ccmixter', search: searchCcMixter, byTag: true });
  chain.push({ name: 'openverse', search: searchOpenverse });
  return chain;
}

async function searchProvider({ name, search }, terms, seen) {
  const results = [];
  let failures = 0;

  for (const term of terms.slice(0, 6)) {
    if (results.length >= ENOUGH_TRACKS || failures >= 2) break;

    try {
      for (const track of await search(term)) {
        const key = `${track.provider}:${track.id}`;
        if (seen.has(key) || !usable(track) || sungLikely(track)) continue;
        seen.add(key);
        results.push({ ...track, term });
      }
    } catch (error) {
      failures += 1;
      logger.warn('sound', `${name} search for "${term}" failed`, { why: error.message });
      if (results.length === 0 && failures >= 2) throw error;
    }
  }

  return results;
}

async function searchTracks(terms, tags = []) {
  const elapsed = timer();
  const seen = new Set();
  const chain = providerChain();
  const failures = [];

  for (const provider of chain) {
    let found = [];
    try {
      const queries = provider.byTag && tags.length ? tags : terms;
      found = await searchProvider(provider, queries, seen);
    } catch (error) {
      failures.push(`${provider.name} (${error.message})`);
      continue;
    }

    if (found.length) {
      logger.info('sound', 'search finished', {
        provider: provider.name,
        found: found.length,
        skipped: failures.length ? failures.map((f) => f.split(' ')[0]).join(',') : undefined,
        took: secs(elapsed()),
      });
      const tracks = rankForNarration(found).slice(0, 12);
      remember(tracks);
      return { provider: provider.name, tracks };
    }

    failures.push(`${provider.name} (no matches)`);
  }

  const error = new Error(
    `No music library answered. Tried ${failures.join(', ')}. ` +
      'Add a free FREESOUND_API_KEY to backend/.env for the most reliable source.',
  );
  error.code = 'SOUNDTRACK_SEARCH_FAILED';
  throw error;
}

function cachePath(track) {
  const safe = `${track.provider}-${String(track.id).replace(/[^A-Za-z0-9_-]/g, '')}`;
  return path.join(paths.beds, `${safe}.mp3`);
}

async function downloadTrack(track) {
  const target = cachePath(track);
  if (fs.existsSync(target) && fs.statSync(target).size > 0) {
    logger.debug('sound', 'bed already cached', { file: path.basename(target) });
    return target;
  }

  const elapsed = timer();
  const referer = track.pageUrl || new URL(track.audioUrl).origin;

  const response = await fetch(track.audioUrl, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'audio/*,*/*', Referer: referer },
    redirect: 'follow',
    signal: AbortSignal.timeout(Math.max(config.suggestTimeoutMs, 60000)),
  });

  if (!response.ok || !response.body) {
    const error = new Error(`Could not download that track (${response.status}).`);
    error.code = 'SOUNDTRACK_DOWNLOAD_FAILED';
    throw error;
  }

  const declared = Number(response.headers.get('content-length')) || 0;
  if (declared > MAX_BYTES) {
    const error = new Error('That track is too large to use as a background bed.');
    error.code = 'SOUNDTRACK_TOO_LARGE';
    throw error;
  }

  fs.mkdirSync(paths.beds, { recursive: true });
  const temp = `${target}.part`;

  try {
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temp));
    const { size } = fs.statSync(temp);
    if (!size) throw new Error('The download was empty.');
    if (size > MAX_BYTES) throw new Error('That track is too large to use as a background bed.');
    fs.renameSync(temp, target);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    error.code = error.code || 'SOUNDTRACK_DOWNLOAD_FAILED';
    throw error;
  }

  logger.info('sound', 'bed downloaded', {
    title: track.title,
    provider: track.provider,
    kb: Math.round(fs.statSync(target).size / 1024),
    took: secs(elapsed()),
  });

  return target;
}

function setSelected(track, filePath, levelDb) {
  selected = {
    ...track,
    file: filePath,
    levelDb: typeof levelDb === 'number' ? levelDb : config.backgroundLevelDb,
  };
  return selected;
}

function getSelected() {
  if (selected && !fs.existsSync(selected.file)) {
    logger.warn('sound', 'cached bed disappeared, clearing the selection');
    selected = null;
  }
  return selected;
}

function clearSelected() {
  selected = null;
}

function setLevel(levelDb) {
  if (!selected) return null;
  selected.levelDb = levelDb;
  return selected;
}

function publicTrack(track) {
  if (!track) return null;
  const { file, audioUrl, term, ...rest } = track;
  return rest;
}

export {
  searchTracks,
  rankForNarration,
  sungLikely,
  providerChain,
  downloadTrack,
  findCandidate,
  setSelected,
  getSelected,
  clearSelected,
  setLevel,
  publicTrack,
  cachePath,
  pixabayAvailable,
};
