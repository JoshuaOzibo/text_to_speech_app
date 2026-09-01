import type { Voice } from '../types';

/**
 * Display helpers for a voice.
 *
 * The backend already composes a full label — "Alan — British Male (medium)" —
 * so the list splits that rather than showing the raw model name, which is a
 * filename stem like `northern_english_male`.
 */

function titleCase(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** "Alan", "Jenny Dioco", "Heart". */
export function voiceTitle(voice: Voice): string {
  const head = voice.label?.split('—')[0]?.trim();
  return head || titleCase(voice.name);
}

/** "British Male (medium)", "American Female (grade A)". */
export function voiceSubtitle(voice: Voice): string {
  const rest = voice.label?.split('—').slice(1).join('—').trim();
  if (rest) return rest;
  return [voice.gender, voice.quality].filter(Boolean).join(' · ');
}

/** Up to two initials for the avatar. */
export function voiceInitials(voice: Voice): string {
  return voiceTitle(voice)
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/** Avatar tint, so a list of 49 is scannable by accent and gender at a glance. */
export function voiceGradient(voice: Voice): string {
  if ((voice.locale ?? '').includes('GB')) return 'linear-gradient(135deg,#00b894,#0f766e)';

  // Piper voices carry no gender field, but the label says so in words.
  const female =
    (voice.gender ?? '').toLowerCase().startsWith('f') || /\bfemale\b/i.test(voice.label ?? '');

  return female
    ? 'linear-gradient(135deg,#a29bfe,#6c5ce7)'
    : 'linear-gradient(135deg,#6c5ce7,#3b3486)';
}
