import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { config, paths } from '../config/env.js';
import { logger, secs, timer } from './logger.js';
import { probeAll } from './audioProbe.js';

const MAX_BYTES = 40 * 1024 * 1024;

const MIN_SECONDS = config.backgroundMinSeconds;
const MAX_SECONDS = config.backgroundMaxSeconds;
const MAX_FLATNESS_DB = config.backgroundMaxFlatnessDb;
const MAX_RANGE_DB = config.backgroundMaxRangeDb;

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
  const hq = hit?.previews?.['preview-hq-mp3'];
  const lq = hit?.previews?.['preview-lq-mp3'];
  const audioUrl = hq || lq;
  if (!hit?.id || !audioUrl) return null;
  if (hasVocalTag(Array.isArray(hit.tags) ? hit.tags.join(',') : '')) return null;

  return {
    auditionUrl: lq || hq,
    provider: 'freesound',
    id: String(hit.id),
    title: String(hit.name || `Freesound ${hit.id}`).replace(/\.[a-z0-9]+$/i, '').slice(0, 90),
    author: String(hit.username || 'Unknown'),
    durationSec: Math.round(Number(hit.duration) || 0),
    license: 'CC0',
    licenseNote: 'CC0, public domain, commercial use, no credit required.',
    attribution: null,
    pageUrl: `https://freesound.org/s/${hit.id}/`,
    audioUrl,
  };
}

const VOCAL_TAGS = [
  'vocals', 'vocal', 'lyrics', 'rap', 'song', 'singing', 'acappella', 'a_capella',
  'spoken_word', 'male_vocals', 'female_vocals', 'choir',
];

function hasVocalTag(tags) {
  const list = String(tags || '').toLowerCase();
  return VOCAL_TAGS.some((tag) => list.includes(tag));
}

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
  if (hasVocalTag(tags)) return null;

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
    licenseNote: 'Creative Commons Attribution, commercial use allowed, credit required.',
    attribution: `"${title}" by ${author} (${hit.license_url || 'https://creativecommons.org/licenses/by/3.0/'})`,
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
    licenseNote: 'CC0, public domain dedication, commercial use allowed.',
    attribution: null,
    pageUrl: hit.foreign_landing_url || hit.detail_url || '',
    audioUrl: hit.url,
  };
}

const USER_AGENT = 'LocalAudioBook/1.0 (local audiobook tool)';
const SEARCH_TIMEOUT_MS = 9000;
const ENOUGH_TRACKS = 16;

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
  const filter = `license:"Creative Commons 0" duration:[${MIN_SECONDS} TO ${MAX_SECONDS}]`;
  const url =
    'https://freesound.org/apiv2/search/text/' +
    `?query=${encodeURIComponent(term)}` +
    `&filter=${encodeURIComponent(filter)}` +
    '&fields=id,name,username,duration,previews,license,tags&page_size=25' +
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

function usable(track) {
  if (!track.durationSec) return true;
  return track.durationSec >= MIN_SECONDS && track.durationSec <= MAX_SECONDS;
}

function screenReason(track, probe) {
  if (!probe.measured) return null;

  const duration = probe.durationSec || track.durationSec;
  if (duration && (duration < MIN_SECONDS || duration > MAX_SECONDS)) {
    return `${Math.round(duration)}s is outside ${MIN_SECONDS}-${MAX_SECONDS}s`;
  }
  if (probe.flatnessDb > MAX_FLATNESS_DB) {
    return `loudness moves ${probe.flatnessDb} dB (limit ${MAX_FLATNESS_DB})`;
  }
  if (probe.rangeDb > MAX_RANGE_DB) {
    return `dynamic range ${probe.rangeDb} dB (limit ${MAX_RANGE_DB})`;
  }
  return null;
}

async function screenTracks(tracks) {
  const probes = await probeAll(tracks);
  const kept = [];
  const rejected = [];

  for (let i = 0; i < tracks.length; i += 1) {
    const track = tracks[i];
    const probe = probes[i];
    const reason = screenReason(track, probe);

    if (reason) {
      rejected.push(`${track.title} (${reason})`);
      continue;
    }

    kept.push({
      ...track,
      durationSec: probe.measured ? probe.durationSec || track.durationSec : track.durationSec,
      flatnessDb: probe.measured ? probe.flatnessDb : null,
      rangeDb: probe.measured ? probe.rangeDb : null,
      measured: probe.measured,
    });
  }

  if (rejected.length) {
    logger.info('sound', `rejected ${rejected.length} track(s) on measurement`, {
      why: rejected.slice(0, 6).join(' | '),
    });
  }

  return kept.sort((a, b) => {
    if (a.measured !== b.measured) return a.measured ? -1 : 1;
    if (!a.measured) return 0;
    return a.flatnessDb - b.flatnessDb;
  });
}

function providerChain() {
  const chain = [];
  if (config.freesoundApiKey) chain.push({ name: 'freesound', search: searchFreesound });
  chain.push({ name: 'ccmixter', search: searchCcMixter, byTag: true });
  chain.push({ name: 'openverse', search: searchOpenverse });
  if (config.pixabayApiKey) chain.push({ name: 'pixabay', search: searchPixabay });
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
        if (seen.has(key) || !usable(track)) continue;
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
      const tracks = (await screenTracks(found.slice(0, 14))).slice(0, 12);

      if (tracks.length) {
        logger.info('sound', 'search finished', {
          provider: provider.name,
          found: found.length,
          kept: tracks.length,
          skipped: failures.length ? failures.map((f) => f.split(' ')[0]).join(',') : undefined,
          took: secs(elapsed()),
        });
        remember(tracks);
        return { provider: provider.name, tracks };
      }

      failures.push(`${provider.name} (${found.length} found, none steady enough)`);
      continue;
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

function cachePath(track, audition = false) {
  const safe = `${track.provider}-${String(track.id).replace(/[^A-Za-z0-9_-]/g, '')}`;
  return path.join(paths.beds, `${safe}${audition ? '-audition' : ''}.mp3`);
}

function sourceUrl(track, audition) {
  if (audition) return track.auditionUrl || track.audioUrl;
  return track.audioUrl || track.auditionUrl;
}

async function downloadTrack(track, { audition = false } = {}) {
  const target = cachePath(track, audition);
  if (fs.existsSync(target) && fs.statSync(target).size > 0) {
    logger.debug('sound', 'bed already cached', { file: path.basename(target) });
    return target;
  }

  const elapsed = timer();
  const url = sourceUrl(track, audition);
  const referer = track.pageUrl || new URL(url).origin;

  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'audio/*,*/*', Referer: referer },
    redirect: 'follow',
    signal: AbortSignal.timeout(config.backgroundDownloadTimeoutMs),
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
  } catch (cause) {
    fs.rmSync(temp, { force: true });

    const stalled = cause.name === 'TimeoutError' || cause.name === 'AbortError';
    const failure = new Error(
      stalled
        ? `"${track.title}" was still downloading after ${Math.round(config.backgroundDownloadTimeoutMs / 1000)}s. ` +
          'The library is serving it slowly — try another track, or raise BACKGROUND_DOWNLOAD_TIMEOUT_MS.'
        : cause.message || 'That track could not be downloaded.',
    );
    failure.code = typeof cause.code === 'string' ? cause.code : 'SOUNDTRACK_DOWNLOAD_FAILED';
    failure.cause = cause;
    throw failure;
  }

  const bytes = fs.statSync(target).size;
  logger.info('sound', audition ? 'audition copy downloaded' : 'bed downloaded', {
    title: track.title,
    provider: track.provider,
    kb: Math.round(bytes / 1024),
    kbPerSec: Math.round(bytes / 1024 / Math.max(elapsed(), 0.001)),
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
  const { file, audioUrl, auditionUrl, term, ...rest } = track;
  return rest;
}

export {
  searchTracks,
  screenTracks,
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
