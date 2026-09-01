import { useRef, useState } from 'react';
import { FileText, Loader2, Upload, X } from 'lucide-react';
import type { Book } from '../types';

const ACCEPTED = ['.pdf', '.txt', '.epub'];

interface Props {
  book: Book | null;
  isUploading: boolean;
  disabled: boolean;
  onSelect: (file: File) => void;
  onClear: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Compact drop zone for the sidebar, which becomes a file card once a book is
 * loaded.
 *
 * An unsupported extension is rejected in the browser — the zone flashes red for
 * 600ms — so the answer is instant instead of a round trip to the server.
 */
export function FileUploader({ book, isUploading, disabled, onSelect, onClear }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!ACCEPTED.includes(ext)) {
      setLocalError('Only PDF, TXT, and EPUB files are supported');
      setRejected(true);
      window.setTimeout(() => setRejected(false), 600);
      return;
    }
    setLocalError(null);
    onSelect(file);
  };

  if (book) {
    return (
      <div className="rounded-card border border-line-strong bg-card p-3">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-btn bg-accent-soft text-accent">
            <FileText size={15} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-ink" title={book.filename}>
              {book.filename}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              {formatSize(book.sizeBytes)} · {book.wordCount.toLocaleString()} words
              {book.pageCount ? ` · ${book.pageCount} pages` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClear}
            disabled={disabled}
            aria-label="Remove this book"
            className="-mt-0.5 -mr-0.5 shrink-0 rounded p-1 text-faint hover:bg-surface hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        disabled={disabled || isUploading}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          if (!disabled) handleFile(e.dataTransfer.files?.[0]);
        }}
        className={`flex h-[88px] w-full flex-col items-center justify-center gap-1.5 rounded-card border-[1.5px] border-dashed text-center disabled:cursor-not-allowed disabled:opacity-60 ${
          rejected ? 'animate-reject' : ''
        } ${
          isDragging
            ? 'border-accent bg-accent-soft shadow-[0_0_0_3px_rgba(108,92,231,0.18)]'
            : 'border-line-strong hover:border-accent hover:bg-accent-soft/60'
        }`}
      >
        {isUploading ? (
          <>
            <Loader2 size={16} className="animate-spin text-accent" />
            <span className="text-[13px] font-medium text-ink">Extracting text…</span>
            <span className="text-[11px] text-faint">Large PDFs take a moment</span>
          </>
        ) : (
          <>
            <Upload size={16} className={isDragging ? 'text-accent' : 'text-muted'} />
            <span className="text-[13px] font-medium text-ink">
              {isDragging ? 'Drop to open' : 'Open file'}
            </span>
            <span className="text-[11px] text-faint">PDF · TXT · EPUB</span>
          </>
        )}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(',')}
        className="hidden"
        onChange={(e) => {
          handleFile(e.target.files?.[0]);
          // Reset so re-selecting the same file still fires onChange.
          e.target.value = '';
        }}
      />

      {localError && <p className="mt-2 text-[11px] leading-snug text-danger">{localError}</p>}
    </div>
  );
}
