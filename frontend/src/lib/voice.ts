import type { Voice } from '../types';

function titleCase(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

export function voiceTitle(voice: Voice): string {
  const head = voice.label?.split('—')[0]?.trim();
  return head || titleCase(voice.name);
}

export function voiceSubtitle(voice: Voice): string {
  const rest = voice.label?.split('—').slice(1).join('—').trim();
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

export function voiceGradient(voice: Voice): string {
  if ((voice.locale ?? '').includes('GB')) return 'linear-gradient(135deg,#00b894,#0f766e)';

  const female =
    (voice.gender ?? '').toLowerCase().startsWith('f') || /\bfemale\b/i.test(voice.label ?? '');

  return female
    ? 'linear-gradient(135deg,#a29bfe,#6c5ce7)'
    : 'linear-gradient(135deg,#6c5ce7,#3b3486)';
}
