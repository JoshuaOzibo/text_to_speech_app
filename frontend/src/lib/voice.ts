import type { Voice } from '../types';

function titleCase(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

export function voiceTitle(voice: Voice): string {
  const head = voice.label?.split('|')[0]?.trim();
  return head || titleCase(voice.name);
}

export function voiceSubtitle(voice: Voice): string {
  const rest = voice.label?.split('|').slice(1).join('|').trim();
  if (rest) return rest;
  return [voice.gender, voice.quality].filter(Boolean).join(' · ');
}

export function voiceInitials(voice: Voice): string {
  return voiceTitle(voice)
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/** Voices downloaded within an hour of each other count as one install batch. */
const BATCH_WINDOW_MS = 60 * 60 * 1000;

/**
 * Ids of the most recently installed batch of voices.
 *
 * Deliberately relative to the library rather than to the clock. A "added in the
 * last 7 days" rule looked fine and was useless in practice: on a machine set up
 * last week it flagged all 59 voices as new. Comparing against the newest voice
 * instead means the badge always answers "what did I add last", whenever that was.
 *
 * Returns empty when the batch *is* the whole library - on a fresh install
 * everything arrived at once, and marking all of it new says nothing.
 */
export function newestBatch(voices: Voice[]): Set<string> {
  const dated = voices.filter((v) => typeof v.addedAt === 'number');
  if (!dated.length) return new Set();

  const newest = Math.max(...dated.map((v) => v.addedAt as number));
  const batch = dated.filter((v) => newest - (v.addedAt as number) < BATCH_WINDOW_MS);

  return batch.length === voices.length ? new Set() : new Set(batch.map((v) => v.id));
}

/** Newest first. Voices with no date sort last. */
export function byNewest(a: Voice, b: Voice): number {
  return (b.addedAt ?? 0) - (a.addedAt ?? 0);
}

/** "today" / "yesterday" / "6 days ago" / a plain date beyond a month. */
export function addedWhen(voice: Voice, now = Date.now()): string | null {
  if (typeof voice.addedAt !== 'number') return null;
  const days = Math.floor((now - voice.addedAt) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(voice.addedAt).toLocaleDateString();
}

export function voiceGradient(voice: Voice): string {
  if ((voice.locale ?? '').includes('GB')) return 'linear-gradient(135deg,#00b894,#0f766e)';

  const female =
    (voice.gender ?? '').toLowerCase().startsWith('f') || /\bfemale\b/i.test(voice.label ?? '');

  return female
    ? 'linear-gradient(135deg,#a29bfe,#6c5ce7)'
    : 'linear-gradient(135deg,#6c5ce7,#3b3486)';
}
