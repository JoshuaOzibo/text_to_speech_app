import { splitWords } from './timeline.js';

const PROFILES = [
  {
    mood: 'contemplative',
    tags: ['ambient', 'meditation', 'drone'],
    label: 'Contemplative',
    terms: [
      'tanpura drone meditation',
      'tibetan singing bowl ambient',
      'shruti box drone',
      'sustained drone calm',
      'sparse ambient silence',
      'deep theta wave ambient',
    ],
    keywords: {
      wisdom: 3, meditation: 4, stillness: 3, silence: 2, contemplation: 4, reflect: 2,
      dharma: 3, spirit: 2, soul: 2, inner: 2, mindful: 3, breath: 2, practice: 2,
      quiet: 2, patience: 2, virtue: 2, philosophy: 3, teaching: 2, monk: 3,
    },
  },
  {
    mood: 'scholarly',
    tags: ['ambient', 'minimal', 'drone'],
    label: 'Scholarly',
    terms: [
      'sparse piano ambient silence',
      'minimal sustained tone',
      'soft string drone sustained',
      'quiet room ambience',
      'distant piano ambient',
      'low ambient texture',
    ],
    keywords: {
      history: 3, economy: 3, economic: 3, capital: 2, market: 2, theory: 3, research: 3,
      evidence: 2, analysis: 3, chapter: 1, argument: 2, data: 2, study: 2, principle: 2,
      finance: 2, ledger: 2, wealth: 2, science: 3, method: 2, system: 2,
    },
  },
  {
    mood: 'epic',
    tags: ['drone', 'ambient', 'experimental'],
    label: 'Epic',
    terms: [
      'deep space ambient drone',
      'vast sustained drone',
      'low sustained tone',
      'distant wind ambience',
      'wide ambient texture',
      'slow drone atmosphere',
    ],
    keywords: {
      war: 4, battle: 4, empire: 3, king: 2, army: 3, conquest: 3, sword: 3, throne: 3,
      hero: 3, destiny: 2, glory: 2, blood: 2, victory: 2, fall: 1, rise: 1, legend: 3,
    },
  },
  {
    mood: 'mysterious',
    tags: ['dark', 'ambient', 'drone'],
    label: 'Mysterious',
    terms: [
      'dark ambient drone',
      'deep space ambient texture',
      'sparse dark piano',
      'low drone atmosphere',
      'night wind ambience',
      'sustained dark tone',
    ],
    keywords: {
      secret: 4, mystery: 4, shadow: 3, hidden: 3, murder: 4, clue: 3, detective: 4,
      strange: 2, unknown: 2, whisper: 2, night: 1, fear: 2, vanish: 3, ghost: 3,
    },
  },
  {
    mood: 'warm',
    tags: ['ambient', 'chill', 'drone'],
    label: 'Warm',
    terms: [
      'warm sustained drone',
      'gentle rain ambience',
      'soft room tone warm',
      'distant piano warm ambient',
      'singing bowl warm resonance',
      'soft wind ambience',
    ],
    keywords: {
      family: 3, mother: 2, father: 2, child: 2, home: 3, love: 3, friend: 3, kitchen: 2,
      village: 2, laughter: 3, memory: 2, garden: 2, together: 2, kindness: 3,
    },
  },
  {
    mood: 'melancholy',
    tags: ['ambient', 'drone', 'minimal'],
    label: 'Melancholy',
    terms: [
      'sparse slow piano ambient',
      'soft sustained string tone',
      'gentle rain ambience',
      'slow ambient drone',
      'singing bowl slow fade',
      'quiet ambient texture',
    ],
    keywords: {
      grief: 4, loss: 3, sorrow: 4, lonely: 3, tears: 3, death: 2, farewell: 3, regret: 3,
      empty: 2, winter: 1, rain: 1, gone: 2, mourn: 4,
    },
  },
  {
    mood: 'pastoral',
    tags: ['field_recording', 'ambient', 'nature'],
    label: 'Pastoral',
    terms: [
      'gentle rain forest calm',
      'quiet forest ambience',
      'soft wind ambience',
      'distant river ambience',
      'nature rain meditation',
      'meadow wind ambient',
    ],
    keywords: {
      forest: 4, river: 3, mountain: 3, field: 2, bird: 3, tree: 2, sea: 3, ocean: 3,
      farm: 3, harvest: 3, wind: 2, rain: 2, valley: 3, meadow: 3, earth: 2,
    },
  },
  {
    mood: 'uplifting',
    tags: ['ambient', 'chill', 'minimal'],
    label: 'Uplifting',
    terms: [
      'bright sustained drone',
      'airy ambient texture',
      'sparse bright piano ambient',
      'open air ambience',
      'soft light rain ambience',
      'warm ambient tone',
    ],
    keywords: {
      hope: 4, future: 2, growth: 3, success: 3, opportunity: 3, build: 2, dream: 3,
      freedom: 3, change: 2, begin: 2, possibility: 3, thrive: 3, joy: 3,
    },
  },
  {
    mood: 'tense',
    tags: ['dark', 'drone', 'experimental'],
    label: 'Tense',
    terms: [
      'low drone tension ambient',
      'dark sustained tone',
      'deep space ambient low',
      'sparse dark texture',
      'distant wind unsettling',
      'sustained low hum',
    ],
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

const ALL_KEYWORDS = new Set(PROFILES.flatMap((profile) => Object.keys(profile.keywords)));

const STOPWORDS = new Set([
  'the', 'and', 'with', 'for', 'that', 'this', 'from', 'into', 'than', 'then', 'they', 'them',
  'their', 'there', 'here', 'what', 'when', 'which', 'while', 'would', 'could', 'should', 'about',
  'some', 'very', 'more', 'most', 'like', 'want', 'please', 'make', 'made', 'just', 'feel', 'feels',
  'feeling', 'something', 'sounds', 'style', 'kind', 'type', 'book', 'audiobook',
]);

const SOUND_WORDS = new Set([
  'ambient', 'ambience', 'ambiance', 'drone', 'music', 'musical', 'sound', 'background', 'tone',
  'texture', 'atmosphere', 'track', 'bed', 'audio', 'noise', 'underscore',
  'singing', 'sings', 'sung', 'vocal', 'vocals', 'voice', 'choir', 'song', 'songs', 'lyrics',
]);

function moodFromDescription(description) {
  const raw = String(description || '').trim();
  if (!raw) return null;

  const words = splitWords(raw);
  const lower = raw.toLowerCase();

  let profile = PROFILES.find(
    (entry) => lower.includes(entry.mood) || lower.includes(entry.label.toLowerCase()),
  );

  if (!profile) {
    const scores = new Map(PROFILES.map((entry) => [entry.mood, 0]));
    for (const word of words) {
      for (const stem of stems(word)) {
        for (const entry of PROFILES) {
          const weight = entry.keywords[stem];
          if (weight) scores.set(entry.mood, scores.get(entry.mood) + weight);
        }
      }
    }
    const ranked = PROFILES.map((entry) => ({ entry, score: scores.get(entry.mood) })).sort(
      (a, b) => b.score - a.score,
    );
    profile = ranked[0].score ? ranked[0].entry : DEFAULT_PROFILE;
  }

  const distinctive = [];
  for (const word of words) {
    const base = word.toLowerCase().replace(/[^a-z]/g, '');
    if (base.length < 4 || distinctive.includes(base)) continue;
    if (STOPWORDS.has(base) || SOUND_WORDS.has(base) || ALL_KEYWORDS.has(base)) continue;
    if (PROFILES.some((entry) => entry.mood === base)) continue;
    distinctive.push(base);
    if (distinctive.length === 2) break;
  }

  const derived = distinctive.flatMap((word, index) =>
    index === 0 ? [`${word} drone`, `${word} ambient`] : [`${word} ambient`],
  );

  return {
    source: 'manual',
    mood: profile.mood,
    label: profile.label,
    tags: [...distinctive, ...profile.tags].slice(0, 4),
    terms: [...derived, ...profile.terms].slice(0, 6),
    reason: distinctive.length
      ? `Read as ${profile.label.toLowerCase()}, searching for ${distinctive.join(' and ')} alongside the ${profile.label.toLowerCase()} beds.`
      : `Read as ${profile.label.toLowerCase()}.`,
    confidence: 'manual',
  };
}

function knownMoods() {
  return PROFILES.map(({ mood, label, terms }) => ({ mood, label, terms }));
}

function profileFor(mood) {
  return PROFILES.find((profile) => profile.mood === mood) || null;
}

export { analyseMood, moodFromDescription, knownMoods, profileFor, sampleText, PROFILES };
