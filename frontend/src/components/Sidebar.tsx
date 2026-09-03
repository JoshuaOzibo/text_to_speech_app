import { PenLine } from 'lucide-react';
import { FileUploader } from './FileUploader';
import type { AppStatus } from './AppHeader';
import type { Book } from '../types';

export type PanelView = 'overview' | 'chapters' | 'text' | 'settings';

const NAV: { id: PanelView; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'chapters', label: 'Chapters' },
  { id: 'text', label: 'Text Preview' },
  { id: 'settings', label: 'Settings' },
];

interface Props {
  book: Book | null;
  isUploading: boolean;
  disabled: boolean;
  view: PanelView;
  status: AppStatus;
  statusLabel: string;
  onSelectFile: (file: File) => void;
  onClear: () => void;
  onView: (view: PanelView) => void;
  onEdit: () => void;
}

const DOT: Record<AppStatus, string> = {
  idle: 'bg-faint',
  working: 'bg-accent animate-pulse-soft',
  ready: 'bg-success-bright',
  error: 'bg-danger',
};

export function Sidebar({
  book,
  isUploading,
  disabled,
  view,
  status,
  statusLabel,
  onSelectFile,
  onClear,
  onView,
  onEdit,
}: Props) {
  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="p-4">
        <p className="mb-2.5 text-[10px] font-medium tracking-[0.12em] text-faint uppercase">
          Library
        </p>
        <FileUploader
          book={book}
          isUploading={isUploading}
          disabled={disabled}
          onSelect={onSelectFile}
          onClear={onClear}
        />

        {book && (
          <button
            type="button"
            onClick={onEdit}
            disabled={disabled}
            className="mt-2 flex w-full items-center gap-2 rounded-btn border-[1.5px] border-line-strong px-3 py-2 text-left hover:border-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line-strong"
          >
            <PenLine size={14} className="shrink-0 text-faint" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-ink">Edit text</span>
              <span className="block truncate text-[11px] text-muted">
                Trim the start, cut sections
              </span>
            </span>
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto pt-1">
        {NAV.map((item) => {
          const active = item.id === view;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onView(item.id)}
              aria-current={active ? 'page' : undefined}
              className={`flex h-10 w-full items-center border-l-[3px] pl-[13px] text-left text-[14px] ${
                active
                  ? 'border-accent bg-accent-soft/70 font-medium text-ink'
                  : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              {item.label}
              {item.id === 'chapters' && book && book.chapters.length > 1 && (
                <span className="ml-auto mr-4 text-[11px] text-faint tabular-nums">
                  {book.chapters.length}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[status]}`} aria-hidden="true" />
          <span className="truncate text-[12px] text-muted">{statusLabel}</span>
        </div>
        <p className="mt-1.5 text-[11px] text-faint">
          Runs entirely on this machine · v1.0.0
        </p>
      </div>
    </div>
  );
}
