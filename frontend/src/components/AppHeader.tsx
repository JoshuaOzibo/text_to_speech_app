import { type RefObject } from 'react';
import { PanelLeft, Search, SlidersHorizontal, X } from 'lucide-react';
import { Logo } from './Logo';

export type AppStatus = 'idle' | 'working' | 'ready' | 'error';

interface Props {
  status: AppStatus;
  statusLabel: string;
  query: string;
  matchCount: number | null;
  searchRef: RefObject<HTMLInputElement | null>;
  searchDisabled: boolean;
  onQueryChange: (value: string) => void;
  onToggleSidebar: () => void;
  onToggleControls: () => void;
}

const DOT: Record<AppStatus, string> = {
  idle: 'bg-faint',
  working: 'bg-accent animate-pulse-soft',
  ready: 'bg-success-bright',
  error: 'bg-danger',
};

/**
 * Full-width bar above the three panels.
 *
 * The two panel toggles only exist below 900px, where the side panels become
 * drawers; above that they are hidden and the panels are always on screen.
 */
export function AppHeader({
  status,
  statusLabel,
  query,
  matchCount,
  searchRef,
  searchDisabled,
  onQueryChange,
  onToggleSidebar,
  onToggleControls,
}: Props) {
  return (
    <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-line bg-base px-3 wide:px-5">
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label="Toggle library panel"
        className="rounded-btn p-2 text-muted hover:bg-surface hover:text-ink wide:hidden"
      >
        <PanelLeft size={17} />
      </button>

      <div className="flex min-w-0 items-center gap-2.5">
        <Logo size={22} className="shrink-0 text-accent" />
        <span className="truncate font-display text-[18px] font-semibold tracking-tight text-ink">
          LocalAudioBook
        </span>
      </div>

      {/* Search is a find-in-book, so it is disabled until there is a book. */}
      <div className="mx-auto hidden w-[320px] wide:block">
        <div className="relative">
          <Search
            size={14}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
          />
          <input
            ref={searchRef}
            type="text"
            value={query}
            disabled={searchDisabled}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={searchDisabled ? 'Open a book to search' : 'Search in book…'}
            aria-label="Search in book"
            className="h-9 w-full rounded-btn border border-line bg-panel pr-16 pl-8 text-[13px] text-ink outline-none placeholder:text-faint hover:border-line-strong focus:border-accent focus:bg-base disabled:cursor-not-allowed disabled:opacity-60"
          />
          {query ? (
            <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1.5">
              <span className="text-[11px] text-muted tabular-nums">
                {matchCount === 0 ? 'none' : matchCount}
              </span>
              <button
                type="button"
                onClick={() => onQueryChange('')}
                aria-label="Clear search"
                className="rounded p-0.5 text-faint hover:text-ink"
              >
                <X size={13} />
              </button>
            </div>
          ) : (
            <kbd className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded border border-line bg-surface px-1.5 py-0.5 font-ui text-[10px] text-faint">
              ⌘K
            </kbd>
          )}
        </div>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[status]}`} aria-hidden="true" />
          <span className="hidden text-[13px] text-muted wide:inline">{statusLabel}</span>
        </div>

        <button
          type="button"
          onClick={onToggleControls}
          aria-label="Toggle controls panel"
          className="rounded-btn p-2 text-muted hover:bg-surface hover:text-ink wide:hidden"
        >
          <SlidersHorizontal size={17} />
        </button>
      </div>
    </header>
  );
}
