import { splitWords } from './timeline.js';

const PROFILES = [
  {
    mood: 'contemplative',
    tags: ['ambient', 'meditation', 'chill'],
    label: 'Contemplative',
    terms: ['calm ambient', 'meditation drone', 'soft piano ambient'],
    keywords: {
      wisdom: 3, meditation: 4, stillness: 3, silence: 2, contemplation: 4, reflect: 2,
      dharma: 3, spirit: 2, soul: 2, inner: 2, mindful: 3, breath: 2, practice: 2,
      quiet: 2, patience: 2, virtue: 2, philosophy: 3, teaching: 2, monk: 3,
    },
  },
  {
    mood: 'scholarly',
    tags: ['instrumental', 'piano', 'ambient'],
    label: 'Scholarly',
    terms: ['minimal piano', 'library ambient', 'soft strings underscore'],
    keywords: {
      history: 3, economy: 3, economic: 3, capital: 2, market: 2, theory: 3, research: 3,
      evidence: 2, analysis: 3, chapter: 1, argument: 2, data: 2, study: 2, principle: 2,
      finance: 2, ledger: 2, wealth: 2, science: 3, method: 2, system: 2,
    },
  },
  {
    mood: 'epic',
    tags: ['orchestral', 'cinematic', 'epic'],
    label: 'Epic',
    terms: ['cinematic ambient', 'epic drone', 'orchestral underscore'],
    keywords: {
      war: 4, battle: 4, empire: 3, king: 2, army: 3, conquest: 3, sword: 3, throne: 3,
      hero: 3, destiny: 2, glory: 2, blood: 2, victory: 2, fall: 1, rise: 1, legend: 3,
    },
  },
  {
    mood: 'mysterious',
    tags: ['dark', 'ambient', 'experimental'],
    label: 'Mysterious',
    terms: ['dark ambient', 'mystery drone', 'suspense atmosphere'],
    keywords: {
      secret: 4, mystery: 4, shadow: 3, hidden: 3, murder: 4, clue: 3, detective: 4,
      strange: 2, unknown: 2, whisper: 2, night: 1, fear: 2, vanish: 3, ghost: 3,
    },
  },
  {
    mood: 'warm',
    tags: ['acoustic', 'folk', 'guitar'],
    label: 'Warm',
    terms: ['warm acoustic ambient', 'gentle guitar', 'soft folk instrumental'],
    keywords: {
      family: 3, mother: 2, father: 2, child: 2, home: 3, love: 3, friend: 3, kitchen: 2,
      village: 2, laughter: 3, memory: 2, garden: 2, together: 2, kindness: 3,
    },
  },
  {
    mood: 'melancholy',
    tags: ['piano', 'melancholy', 'slow'],
    label: 'Melancholy',
    terms: ['sad ambient piano', 'melancholy drone', 'slow strings'],
    keywords: {
      grief: 4, loss: 3, sorrow: 4, lonely: 3, tears: 3, death: 2, farewell: 3, regret: 3,
      empty: 2, winter: 1, rain: 1, gone: 2, mourn: 4,
    },
  },
  {
    mood: 'pastoral',
    tags: ['ambient', 'nature', 'field_recording'],
    label: 'Pastoral',
    terms: ['nature ambient', 'forest atmosphere', 'countryside ambience'],
    keywords: {
      forest: 4, river: 3, mountain: 3, field: 2, bird: 3, tree: 2, sea: 3, ocean: 3,
      farm: 3, harvest: 3, wind: 2, rain: 2, valley: 3, meadow: 3, earth: 2,
    },
  },
  {
    mood: 'uplifting',
    tags: ['uplifting', 'chill', 'positive'],
    label: 'Uplifting',
    terms: ['hopeful ambient', 'inspiring underscore', 'bright piano ambient'],
    keywords: {
      hope: 4, future: 2, growth: 3, success: 3, opportunity: 3, build: 2, dream: 3,
      freedom: 3, change: 2, begin: 2, possibility: 3, thrive: 3, joy: 3,
    },
  },
  {
    mood: 'tense',
    tags: ['dark', 'experimental', 'drone'],
    label: 'Tense',
    terms: ['tense ambient', 'dark drone atmosphere', 'suspense underscore'],
    keywords: {
      crisis: 4, danger: 4, threat: 3, collapse: 3, panic: 3, escape: 3, attack: 3,
      urgent: 3, risk: 2, trap: 3, chase: 3, warning: 2,
    },
  },
];

const DEFAULT_PROFILE = PROFILES[0];

const SAMPLE_CHARS = 20000;

function sampleText(text) {
  const source = String(text || '');
  if (source.length <= SAMPLE_CHARS) return source;

  const slice = Math.floor(SAMPLE_CHARS / 3);
  const middle = Math.floor(source.length / 2 - slice / 2);
  return [
    source.slice(0, slice),
    source.slice(middle, middle + slice),
    source.slice(source.length - slice),
  ].join('\n');
}

function stems(word) {
  const base = word.toLowerCase().replace(/[^a-z]/g, '');
  if (base.length < 3) return [];
  const out = [base];
  if (base.endsWith('s')) out.push(base.slice(0, -1));
  if (base.endsWith('es')) out.push(base.slice(0, -2));
  if (base.endsWith('ed')) out.push(base.slice(0, -2));
  if (base.endsWith('ing')) out.push(base.slice(0, -3));
  if (base.endsWith('ies')) out.push(`${base.slice(0, -3)}y`);
  return out;
}

function analyseMood(text) {
  const words = splitWords(sampleText(text));
  const scores = new Map(PROFILES.map((profile) => [profile.mood, 0]));
  let hits = 0;

  for (const word of words) {
    for (const stem of stems(word)) {
      for (const profile of PROFILES) {
        const weight = profile.keywords[stem];
        if (weight) {
          scores.set(profile.mood, scores.get(profile.mood) + weight);
          hits += 1;
        }
      }
    }
  }

  const ranked = PROFILES.map((profile) => ({ profile, score: scores.get(profile.mood) })).sort(
    (a, b) => b.score - a.score,
  );

  const best = ranked[0];
  const runnerUp = ranked[1];

  if (!best.score) {
    return {
      source: 'local',
      mood: DEFAULT_PROFILE.mood,
      label: DEFAULT_PROFILE.label,
      terms: DEFAULT_PROFILE.terms,
      reason: 'No strong signal in the text, so this falls back to a neutral calm bed.',
      confidence: 'low',
    };
  }

  const margin = runnerUp.score ? best.score / runnerUp.score : 3;
  const confidence = margin >= 1.8 ? 'high' : margin >= 1.25 ? 'medium' : 'low';

  return {
    source: 'local',
    mood: best.profile.mood,
    label: best.profile.label,
    terms: best.profile.terms,
    reason: `Matched ${hits} mood words in the text; "${best.profile.mood}" scored ${best.score} against "${runnerUp.profile.mood}" at ${runnerUp.score}.`,
    confidence,
  };
}

function knownMoods() {
  return PROFILES.map(({ mood, label, terms }) => ({ mood, label, terms }));
}

function profileFor(mood) {
  return PROFILES.find((profile) => profile.mood === mood) || null;
}

export { analyseMood, knownMoods, profileFor, sampleText, PROFILES };
