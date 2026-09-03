import { memo, type ReactNode, useEffect, useMemo, useRef } from 'react';
import { AlignLeft, BookOpen, Check, Cpu, Highlighter, Minus, Plus, Search } from 'lucide-react';
import { Logo } from './Logo';
import type { PanelView } from './Sidebar';
import type { Book, Chapter, TtsEngine } from '../types';

interface Props {
  book: Book | null;
  view: PanelView;
  query: string;
  activeMatch: number;
  fontSize: number;
  followPlayback: boolean;
  playbackFraction: number | null;
  activeWord: number;
  scrollTarget: { lineIndex: number; nonce: number } | null;
  engines: Record<TtsEngine, boolean> | null;
  voices: { engine: TtsEngine }[];
  onFontSize: (size: number) => void;
  onToggleFollow: () => void;
  onMatchCount: (count: number) => void;
  onFocusSearch: () => void;
  onJumpToChapter: (chapter: Chapter) => void;
}

interface Block {
  kind: 'heading' | 'paragraph';
  text: string;
  lineIndex: number;
  chapter?: Chapter;
  wordStart: number;
  wordEnd: number;
  matchStart: number;
  matchCount: number;
}

const MIN_FONT = 15;
const MAX_FONT = 22;

const countWords = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

function countMatches(haystack: string, needle: string): number {
  if (needle.length < 2) return 0;
  const lower = haystack.toLowerCase();
  const target = needle.toLowerCase();
  let total = 0;
  let at = lower.indexOf(target);
  while (at !== -1) {
    total += 1;
    at = lower.indexOf(target, at + target.length);
  }
  return total;
}

function buildBlocks(book: Book, query: string): { blocks: Block[]; words: number; matches: number } {
  const byLine = new Map<number, Chapter>();
  if (book.chapters.length > 1) {
    for (const chapter of book.chapters) byLine.set(chapter.lineIndex, chapter);
  }

  const lines = book.text.split('\n');
  const blocks: Block[] = [];
  let buffer: string[] = [];
  let bufferLine = 0;
  let words = 0;
  let matches = 0;

  const push = (kind: Block['kind'], text: string, lineIndex: number, chapter?: Chapter) => {
    const wordCount = countWords(text);
    const matchCount = countMatches(text, query);
    blocks.push({
      kind,
      text,
      lineIndex,
      chapter,
      wordStart: words,
      wordEnd: words + wordCount,
      matchStart: matches,
      matchCount,
    });
    words += wordCount;
    matches += matchCount;
  };

  const flush = () => {
    if (!buffer.length) return;
    push('paragraph', buffer.join(' '), bufferLine);
    buffer = [];
  };

  let index = 0;
  while (index < lines.length) {
    const chapter = byLine.get(index);

    if (chapter) {
      flush();
      push('heading', chapter.title, index, chapter);
      index += Math.max(1, chapter.lineSpan ?? 1);
      continue;
    }

    const trimmed = lines[index].trim();
    if (!trimmed) {
      flush();
      index += 1;
      continue;
    }

    if (!buffer.length) bufferLine = index;
    buffer.push(trimmed);
    index += 1;
  }

  flush();
  return { blocks, words, matches };
}

function withMatches(
  text: string,
  query: string,
  matchStart: number,
  activeMatch: number,
): ReactNode {
  if (query.length < 2) return text;

  const lower = text.toLowerCase();
  const target = query.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let n = matchStart;
  let at = lower.indexOf(target);

  while (at !== -1) {
    if (at > cursor) parts.push(text.slice(cursor, at));
    const isActive = n === activeMatch;
    parts.push(
      <mark
        key={`${at}-${n}`}
        id={`match-${n}`}
        className={
          isActive
            ? 'rounded-sm bg-accent px-0.5 text-white'
            : 'rounded-sm bg-warning-bright/45 px-0.5 text-ink'
        }
      >
        {text.slice(at, at + target.length)}
      </mark>,
    );
    n += 1;
    cursor = at + target.length;
    at = lower.indexOf(target, cursor);
  }

  parts.push(text.slice(cursor));
  return parts;
}

function withSpokenWord(text: string, activeIndex: number, query: string): ReactNode {
  const parts = text.split(/(\s+)/);
  const needle = query.length >= 2 ? query.toLowerCase() : '';
  let word = -1;

  return parts.map((part, i) => {
    if (!part || /^\s+$/.test(part)) return part;
    word += 1;

    if (word === activeIndex) {
      return (
        <span key={i} className="rounded-sm bg-accent px-0.5 text-white">
          {part}
        </span>
      );
    }
    if (needle && part.toLowerCase().includes(needle)) {
      return (
        <mark key={i} className="rounded-sm bg-warning-bright/45 px-0.5 text-ink">
          {part}
        </mark>
      );
    }
    return part;
  });
}

function eyebrowFor(chapter: Chapter, total: number): string | null {
  if (/^(chapter|part|book|section|volume|canto)\b/i.test(chapter.title)) return null;
  return `Section ${chapter.index + 1} of ${total}`;
}

interface BlockProps {
  block: Block;
  index: number;
  chapterCount: number;
  fontSize: number;
  query: string;
  activeMatch: number;
  active: boolean;
  spokenWord: number;
}

const TextBlock = memo(function TextBlock({
  block,
  index,
  chapterCount,
  fontSize,
  query,
  activeMatch,
  active,
  spokenWord,
}: BlockProps) {
  const body =
    spokenWord >= 0
      ? withSpokenWord(block.text, spokenWord, query)
      : withMatches(block.text, query, block.matchStart, activeMatch);

  const frame = `-ml-[15px] scroll-mt-6 border-l-[3px] pl-3 transition-colors duration-300 ${
    active ? 'border-accent bg-accent-soft' : 'border-transparent'
  }`;

  if (block.kind === 'heading') {
    const eyebrow = block.chapter ? eyebrowFor(block.chapter, chapterCount) : null;
    return (
      <header
        data-block={index}
        data-line={block.lineIndex}
        className={`${frame} ${index > 0 ? 'mt-14' : ''}`}
      >
        {eyebrow && (
          <p className="mb-2 text-[11px] font-medium tracking-[0.1em] text-accent-ink uppercase">
            {eyebrow}
          </p>
        )}
        <h2 className="mb-8 font-reader text-[26px] leading-snug font-medium text-ink">{body}</h2>
      </header>
    );
  }

  return (
    <p
      data-block={index}
      data-line={block.lineIndex}
      style={{ fontSize: `${fontSize}px` }}
      className={`${frame} mb-6 font-reader leading-[1.9] text-ink`}
    >
      {body}
    </p>
  );
});

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <Logo size={56} className="text-line-strong" />
      <h2 className="mt-6 text-[18px] font-medium text-muted">Open a book to begin</h2>
      <p className="mt-2 max-w-[320px] text-[14px] leading-relaxed text-faint">
        Drop a PDF, TXT, or EPUB into the sidebar to start reading and generating audio.
      </p>
    </div>
  );
}

export function ReadingPanel({
  book,
  view,
  query,
  activeMatch,
  fontSize,
  followPlayback,
  playbackFraction,
  activeWord,
  scrollTarget,
  engines,
  voices,
  onFontSize,
  onToggleFollow,
  onMatchCount,
  onFocusSearch,
  onJumpToChapter,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const { blocks, words, matches } = useMemo(
    () => (book ? buildBlocks(book, query) : { blocks: [], words: 0, matches: 0 }),
    [book, query],
  );

  useEffect(() => onMatchCount(matches), [matches, onMatchCount]);

  const activeBlock = useMemo(() => {
    if (!followPlayback) return -1;
    if (activeWord >= 0) {
      return blocks.findIndex(
        (block) => activeWord >= block.wordStart && activeWord < block.wordEnd,
      );
    }
    if (playbackFraction === null || words === 0) return -1;
    const target = playbackFraction * words;
    return blocks.findIndex((block) => target >= block.wordStart && target < block.wordEnd);
  }, [followPlayback, activeWord, playbackFraction, words, blocks]);

  useEffect(() => {
    if (activeBlock < 0) return;
    const el = scrollRef.current?.querySelector(`[data-block="${activeBlock}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeBlock]);

  useEffect(() => {
    if (!scrollTarget) return;
    const el = scrollRef.current?.querySelector(`[data-line="${scrollTarget.lineIndex}"]`);
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [scrollTarget]);

  useEffect(() => {
    if (query.length < 2 || matches === 0) return;
    document.getElementById(`match-${activeMatch}`)?.scrollIntoView({
      block: 'center',
      behavior: 'smooth',
    });
  }, [activeMatch, query, matches]);

  if (!book && view !== 'settings') {
    return (
      <div className="h-full bg-base">
        <EmptyState />
      </div>
    );
  }

  if (view === 'settings') {
    const byEngine = (engine: TtsEngine) => voices.filter((voice) => voice.engine === engine).length;
    const rows: { engine: TtsEngine; label: string; note: string }[] = [
      { engine: 'piper', label: 'Piper', note: 'Separate process per chunk · instant cancel' },
      { engine: 'supertonic', label: 'Supertonic', note: '44.1 kHz · models loaded once' },
      { engine: 'kokoro', label: 'Kokoro', note: '24 kHz · highest quality, slowest' },
    ];

    return (
      <div className="h-full overflow-y-auto bg-base">
        <div className="w-full px-10 py-12 wide:px-14">
          <h2 className="font-reader text-[26px] font-medium text-ink">Settings</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-muted">
            Everything here is read from the backend. Values are changed in{' '}
            <code className="rounded bg-surface px-1.5 py-0.5 font-ui text-[12px] text-ink">
              backend/.env
            </code>{' '}
            and take effect when the server restarts.
          </p>

          <p className="mt-10 mb-3 text-[10px] font-medium tracking-[0.12em] text-faint uppercase">
            Speech engines
          </p>
          <div className="overflow-hidden rounded-card border border-line">
            {rows.map((row, i) => (
              <div
                key={row.engine}
                className={`flex items-center gap-3 px-4 py-3.5 ${i > 0 ? 'border-t border-line' : ''}`}
              >
                <Cpu size={15} className="shrink-0 text-faint" />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium text-ink">{row.label}</p>
                  <p className="text-[12px] text-muted">{row.note}</p>
                </div>
                {engines?.[row.engine] ? (
                  <span className="flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-success">
                    <Check size={13} />
                    {byEngine(row.engine)} voices
                  </span>
                ) : (
                  <span className="shrink-0 text-[12px] text-faint">not installed</span>
                )}
              </div>
            ))}
          </div>

          <p className="mt-10 mb-3 text-[10px] font-medium tracking-[0.12em] text-faint uppercase">
            Output
          </p>
          <dl className="overflow-hidden rounded-card border border-line text-[13px]">
            {[
              ['Format', 'MP3, mono, 192 kbps (Piper voices clamp to 160k)'],
              ['Mastering', 'Highpass 80 Hz → compressor → EBU R128 at −16 LUFS'],
              ['Chunk size', '300 words, split only between sentences'],
              ['Privacy', 'No network calls at runtime. Nothing leaves this machine.'],
            ].map(([label, value], i) => (
              <div
                key={label}
                className={`flex gap-4 px-4 py-3 ${i > 0 ? 'border-t border-line' : ''}`}
              >
                <dt className="w-28 shrink-0 text-muted">{label}</dt>
                <dd className="text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    );
  }

  if (!book) return <div className="h-full bg-base">{<EmptyState />}</div>;

  if (view === 'overview') {
    const stats: [string, string][] = [
      ['Words', book.wordCount.toLocaleString()],
      ['Chapters', String(book.chapters.length)],
      ['Pages', book.pageCount ? String(book.pageCount) : 'N/A'],
      ['Reading time', `~${book.estimatedMinutes} min`],
    ];

    return (
      <div className="h-full overflow-y-auto bg-base">
        <div className="w-full px-10 py-12 wide:px-14">
          <p className="text-[10px] font-medium tracking-[0.12em] text-accent-ink uppercase">
            Now open
          </p>
          <h2 className="mt-2 font-reader text-[30px] leading-tight font-medium text-ink">
            {book.filename.replace(/\.[^.]+$/, '')}
          </h2>

          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.map(([label, value]) => (
              <div key={label} className="rounded-card border border-line px-4 py-3.5">
                <p className="text-[11px] text-muted">{label}</p>
                <p className="mt-1 text-[18px] font-medium text-ink tabular-nums">{value}</p>
              </div>
            ))}
          </div>

          {book.chapters.length > 1 && (
            <>
              <p className="mt-10 mb-3 text-[10px] font-medium tracking-[0.12em] text-faint uppercase">
                Contents
              </p>
              <ol className="overflow-hidden rounded-card border border-line">
                {book.chapters.slice(0, 8).map((chapter, i) => (
                  <li key={chapter.index}>
                    <button
                      type="button"
                      onClick={() => onJumpToChapter(chapter)}
                      className={`flex w-full items-baseline gap-3 px-4 py-3 text-left hover:bg-surface ${
                        i > 0 ? 'border-t border-line' : ''
                      }`}
                    >
                      <span className="w-5 shrink-0 text-[12px] text-faint tabular-nums">
                        {chapter.index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-reader text-[15px] text-ink">
                        {chapter.title}
                      </span>
                      <span className="shrink-0 text-[12px] text-muted tabular-nums">
                        {chapter.wordCount.toLocaleString()} w
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              {book.chapters.length > 8 && (
                <p className="mt-2 text-[12px] text-faint">
                  and {book.chapters.length - 8} more. See Chapters.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  if (view === 'chapters') {
    if (book.chapters.length <= 1) {
      return (
        <div className="flex h-full flex-col items-center justify-center bg-base px-8 text-center">
          <AlignLeft size={40} className="text-line-strong" />
          <h2 className="mt-5 text-[16px] font-medium text-muted">No chapters detected</h2>
          <p className="mt-2 max-w-[340px] text-[13px] leading-relaxed text-faint">
            This file has no headings the parser could recognise. The whole text will be narrated
            as one piece.
          </p>
        </div>
      );
    }

    return (
      <div className="h-full overflow-y-auto bg-base">
        <div className="w-full px-10 py-12 wide:px-14">
          <h2 className="font-reader text-[26px] font-medium text-ink">Chapters</h2>
          <p className="mt-2 text-[14px] text-muted">
            {book.chapters.length} detected · a 2-second gap is left between each one in the audio.
          </p>

          <ol className="mt-8 overflow-hidden rounded-card border border-line">
            {book.chapters.map((chapter, i) => (
              <li key={chapter.index}>
                <button
                  type="button"
                  onClick={() => onJumpToChapter(chapter)}
                  className={`flex w-full items-baseline gap-3 px-4 py-3.5 text-left hover:bg-surface ${
                    i > 0 ? 'border-t border-line' : ''
                  }`}
                >
                  <span className="w-6 shrink-0 text-[12px] text-faint tabular-nums">
                    {chapter.index + 1}
                  </span>
                  <span className="min-w-0 flex-1 font-reader text-[15px] text-ink">
                    {chapter.title}
                  </span>
                  <span className="shrink-0 text-[12px] text-muted tabular-nums">
                    {chapter.wordCount.toLocaleString()} w
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-base">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-3">
        {book.chapters.length > 1 && (
          <select
            aria-label="Jump to chapter"
            value=""
            onChange={(e) => {
              const chapter = book.chapters[Number(e.target.value)];
              if (chapter) onJumpToChapter(chapter);
            }}
            className="max-w-[220px] rounded-btn border border-transparent bg-transparent px-2 py-1 text-[13px] text-muted outline-none hover:border-line-strong hover:text-ink"
          >
            <option value="">Jump to chapter…</option>
            {book.chapters.map((chapter, i) => (
              <option key={chapter.index} value={i}>
                {chapter.title}
              </option>
            ))}
          </select>
        )}

        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => onFontSize(Math.max(MIN_FONT, fontSize - 1))}
            disabled={fontSize <= MIN_FONT}
            aria-label="Smaller text"
            className="rounded-btn p-1.5 text-muted hover:bg-surface hover:text-ink disabled:opacity-30"
          >
            <Minus size={14} />
          </button>
          <span className="w-8 text-center text-[12px] text-faint tabular-nums">{fontSize}</span>
          <button
            type="button"
            onClick={() => onFontSize(Math.min(MAX_FONT, fontSize + 1))}
            disabled={fontSize >= MAX_FONT}
            aria-label="Larger text"
            className="rounded-btn p-1.5 text-muted hover:bg-surface hover:text-ink disabled:opacity-30"
          >
            <Plus size={14} />
          </button>

          <span className="mx-1.5 h-4 w-px bg-line" />

          <button
            type="button"
            onClick={onToggleFollow}
            title="Highlight the paragraph being spoken"
            aria-pressed={followPlayback}
            className={`rounded-btn p-1.5 ${
              followPlayback
                ? 'bg-accent-soft text-accent-ink'
                : 'text-muted hover:bg-surface hover:text-ink'
            }`}
          >
            <Highlighter size={14} />
          </button>

          <button
            type="button"
            onClick={onFocusSearch}
            aria-label="Search in book"
            className="hidden rounded-btn p-1.5 text-muted hover:bg-surface hover:text-ink sm:inline-flex"
          >
            <Search size={14} />
          </button>
        </div>
      </div>

      {query.length >= 2 && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-4 py-2 text-[12px]">
          <Search size={12} className="text-faint" />
          <span className="text-muted">
            {matches === 0 ? (
              <>
                No matches for <span className="text-ink">“{query}”</span>
              </>
            ) : (
              <>
                <span className="text-ink tabular-nums">{activeMatch + 1}</span> of{' '}
                <span className="tabular-nums">{matches}</span> for{' '}
                <span className="text-ink">“{query}”</span> · press Enter for the next
              </>
            )}
          </span>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <article className="w-full px-10 py-12 wide:px-14">
          {blocks.map((block, i) => (
            <TextBlock
              key={i}
              block={block}
              index={i}
              chapterCount={book.chapters.length}
              fontSize={fontSize}
              query={query}
              activeMatch={activeMatch}
              active={i === activeBlock}
              spokenWord={
                activeWord >= block.wordStart && activeWord < block.wordEnd
                  ? activeWord - block.wordStart
                  : -1
              }
            />
          ))}

          {blocks.length === 0 && (
            <div className="flex flex-col items-center py-20 text-center">
              <BookOpen size={40} className="text-line-strong" />
              <p className="mt-5 text-[15px] font-medium text-muted">No readable text</p>
              <p className="mt-2 max-w-[340px] text-[13px] leading-relaxed text-faint">
                This file parsed successfully but produced nothing to read. A scanned PDF has to be
                run through OCR first.
              </p>
            </div>
          )}
        </article>
      </div>
    </div>
  );
}

