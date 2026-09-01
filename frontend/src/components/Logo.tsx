interface Props {
  size?: number;
  className?: string;
}

/**
 * The LocalAudioBook mark: an open book with a sound wave rising off the pages.
 *
 * Line art only, so it inherits the surrounding text colour and stays legible at
 * 20px in the header and 28px in an empty state.
 */
export function Logo({ size = 24, className = '' }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {/* the wave, rising from the spine */}
      <path d="M4.6 7.1q2.4-3 4.8 0t4.8 0 4.8 0" opacity={0.85} />
      {/* left page */}
      <path d="M12 13.4c0-1.1-1.6-1.9-3.5-1.9H4.4A1.2 1.2 0 0 0 3.2 12.7v6.3a1.2 1.2 0 0 0 1.2 1.2h4.1c1.9 0 3.5.8 3.5 1.9" />
      {/* right page */}
      <path d="M12 13.4c0-1.1 1.6-1.9 3.5-1.9h4.1a1.2 1.2 0 0 1 1.2 1.2v6.3a1.2 1.2 0 0 1-1.2 1.2h-4.1c-1.9 0-3.5.8-3.5 1.9" />
    </svg>
  );
}
