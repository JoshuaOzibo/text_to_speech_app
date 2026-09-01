import { useMemo, useState } from 'react';
import { BookOpen, ChevronDown, ChevronUp } from 'lucide-react';
import type { Book } from '../types';

interface Props {
  book: Book;
}

/**
 * Scrollable view of the extracted text, so the user can confirm the parser got
 * it right before spending minutes narrating it.
 */
export function TextPreview({ book }: Props) {
  const [expanded, setExpanded] = useState(true);

  // Paragraphs are cheap to compute once and keep the markup readable.
  const paragraphs = useMemo(
    () => book.text.split(/\n{2,}/).filter((p) => p.trim().length > 0),
    [book.text],
  );

  return (
    <section className="rounded-card border border-line bg-surface">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span className="flex items-center gap-2 font-medium text-ink">
          <BookOpen size={16} className="text-muted" />
          Text Preview
          <span className="text-sm font-normal text-muted">
            ({book.wordCount.toLocaleString()} words)
          </span>
        </span>
        {expanded ? (
          <ChevronUp size={16} className="text-muted" />
        ) : (
          <ChevronDown size={16} className="text-muted" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-line px-5 py-4">
          <div className="max-h-96 overflow-y-auto pr-2">
            <article className="font-reader text-[15px] leading-relaxed text-ink/90">
              {paragraphs.map((paragraph, i) => (
                <p key={i} className="mb-4 last:mb-0 whitespace-pre-wrap">
                  {paragraph}
                </p>
              ))}
            </article>
          </div>

          {book.chapters.length > 1 && (
            <div className="mt-4 border-t border-line pt-4">
              <p className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">
                Detected chapters
              </p>
              <ol className="max-h-40 space-y-1 overflow-y-auto pr-2 text-sm">
                {book.chapters.map((chapter) => (
                  <li key={chapter.index} className="flex justify-between gap-4 text-muted">
                    <span className="truncate text-ink/80">{chapter.title}</span>
                    <span className="shrink-0 tabular-nums">
                      {chapter.wordCount.toLocaleString()} w
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
