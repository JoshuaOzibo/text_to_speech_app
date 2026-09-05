import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Loader2,
  RotateCcw,
  Save,
  Scissors,
  Sparkles,
  Undo2,
  WrapText,
  X,
} from 'lucide-react';
import { cleanBookText, type CleanedBook } from '../lib/api';

interface Props {
  text: string;
  originalText: string;
  filename: string;
  onSave: (text: string) => Promise<void>;
  onClose: () => void;
}

const WORDS_PER_MINUTE = 150;
const MAX_HISTORY = 50;

function countWords(value: string): number {
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

interface Stats {
  words: number;
  minutes: number;
  chars: number;
  wrapped: boolean;
}

interface Snapshot {
  value: string;
  caret: number;
}

const HEADING_WORD =
  /^(chapter|part|book|section|prologue|epilogue|introduction|foreword|preface|afterword|conclusion)\b/i;
const LIST_START = /^([•·●○▪*–—-]\s|\(?\d+[.)]\s)/;
const ENDS_SENTENCE = /[.!?]["'”’)\]]?$/;
const ENDS_COLON = /:["'”’)\]]?$/;
const ENDS_HYPHEN = /[a-z]-$/;
const CONTINUES = /^[a-z(“‘"'\d]/;

// A wrapped line stops a word or so short of the margin, so it still counts as
// wrapped this far under the measured width.
const WRAP_SLACK = 15;
// Above this median line length the text is already paragraph-per-line.
const FLOWED_MEDIAN = 110;

function lineLengths(text: string): number[] {
  const lengths: number[] = [];
  for (const raw of text.split('\n')) {
    const n = raw.trim().length;
    if (n) lengths.push(n);
  }
  return lengths.sort((a, b) => a - b);
}

// Mirrors the heading test in the backend's detectChapters, so a line that will
// become a chapter mark is never swallowed into the paragraph around it.
function isHeadingLike(line: string): boolean {
  if (line.length < 3 || line.length > 80) return false;
  if (HEADING_WORD.test(line)) return true;
  return (
    line.split(/\s+/).length <= 12 &&
    line === line.toUpperCase() &&
    /[A-Z]/.test(line) &&
    !/[.,;:]$/.test(line)
  );
}

// PDF and EPUB extraction keeps one line per printed line, so a book arrives
// hard-wrapped at ~90 characters and only fills the left of a wide editor.
// This unwraps it into whole paragraphs the way the reader already displays it
// and the way preprocessText joins it at generation time.
//
// A line continues the one above it when that line ran to the measured wrap
// width, or when it stopped mid-sentence and this one carries on in lower case.
// Lower case alone — all the first version tested — misses a quarter of the wrap
// points in a real book, because a wrapped line so often continues with a name:
// "…supporting writers and allowing" / "Penguin to continue to publish…".
// Measured on the extracted text of a 14,857-word PDF: 1,074 lines end
// mid-sentence and only 806 of them are followed by a lower-case line.
//
// The width is measured per book rather than assumed, because extraction wraps
// anywhere from 55 to 110 characters depending on the source. Headings are left
// alone in both directions, so detectChapters still finds them after a save —
// verified on three PDFs: identical word counts and identical chapter titles.
function reflowParagraphs(text: string): string {
  const lengths = lineLengths(text);
  if (lengths.length < 20) return text;

  const p90 = lengths[Math.min(lengths.length - 1, Math.floor(lengths.length * 0.9))];
  const wrapAt = Math.max(50, p90 - WRAP_SLACK);

  const out: string[] = [];
  // The length test has to look at the last *source* line, not the paragraph
  // built so far — that grows past the wrap width immediately and would chain
  // the whole book onto one line.
  let tail = '';

  for (const raw of text.split('\n')) {
    const line = raw.trim();

    if (!line) {
      if (out.length && out[out.length - 1] !== '') out.push('');
      tail = '';
      continue;
    }

    if (tail && !isHeadingLike(tail) && !isHeadingLike(line) && !LIST_START.test(line)) {
      if (ENDS_HYPHEN.test(tail) && /^[a-z]/.test(line)) {
        out[out.length - 1] = out[out.length - 1].slice(0, -1) + line;
        tail = line;
        continue;
      }
      // A colon ends the line for good: it usually introduces the list below it.
      const open = !ENDS_SENTENCE.test(tail) && !ENDS_COLON.test(tail);
      if (!ENDS_COLON.test(tail) && (tail.length >= wrapAt || (open && CONTINUES.test(line)))) {
        out[out.length - 1] = `${out[out.length - 1]} ${line}`;
        tail = line;
        continue;
      }
    }

    out.push(line);
    tail = line;
  }

  return out.join('\n');
}

function isHardWrapped(text: string): boolean {
  const lengths = lineLengths(text);
  if (lengths.length < 20) return false;
  return lengths[Math.floor(lengths.length / 2)] < FLOWED_MEDIAN;
}

function statsFor(value: string): Stats {
  const words = countWords(value);
  return {
    words,
    minutes: Math.round(words / WORDS_PER_MINUTE),
    chars: value.length,
    wrapped: isHardWrapped(value),
  };
}

export function BookEditor({ text, originalText, filename, onSave, onClose }: Props) {
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const caretRef = useRef<number | null>(null);

  // The editor opens on the unwrapped text, so the book fills the width without
  // anyone having to know about the button. It is a buffer, not a save: the
  // notice below says it happened, Undo puts the printed line breaks back, and
  // nothing reaches /api/book/rescan until Save is pressed.
  const opened = useMemo(() => {
    const flowed = isHardWrapped(text) ? reflowParagraphs(text) : text;
    return { value: flowed, joined: flowed !== text };
  }, [text]);

  const [value, setValue] = useState(opened.value);
  const [stats, setStats] = useState<Stats>(() => statsFor(opened.value));
  const [caretPercent, setCaretPercent] = useState(0);
  const [history, setHistory] = useState<Snapshot[]>(() =>
    opened.joined ? [{ value: text, caret: 0 }] : [],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [cleaned, setCleaned] = useState<CleanedBook | null>(null);

  const dirty = value !== text;
  // Only work the user did themselves is worth a "discard?" prompt on the way
  // out — the join on open is not.
  const unsavedEdits = dirty && value !== opened.value;

  const refreshCaret = useCallback(() => {
    const el = areaRef.current;
    if (!el || !el.value.length) return setCaretPercent(0);
    setCaretPercent(Math.round((el.selectionStart / el.value.length) * 100));
  }, []);

  // Counting words on a full book is too slow to do on every keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => setStats(statsFor(value)), 150);
    return () => window.clearTimeout(timer);
  }, [value]);

  // The textarea is controlled, so a programmatic edit has to restore the caret
  // after React commits the new value.
  useLayoutEffect(() => {
    if (caretRef.current === null) return;
    const el = areaRef.current;
    if (el) {
      const at = Math.max(0, Math.min(caretRef.current, el.value.length));
      el.focus();
      el.setSelectionRange(at, at);
    }
    caretRef.current = null;
    refreshCaret();
  });

  const replaceValue = useCallback(
    (next: string, caret: number) => {
      const previous = { value, caret: areaRef.current?.selectionStart ?? 0 };
      caretRef.current = caret;
      setHistory((past) => [...past.slice(-(MAX_HISTORY - 1)), previous]);
      setValue(next);
    },
    [value],
  );

  const startHere = () => {
    const el = areaRef.current;
    if (!el) return;
    replaceValue(value.slice(el.selectionStart).replace(/^\s+/, ''), 0);
  };

  const endHere = () => {
    const el = areaRef.current;
    if (!el) return;
    const kept = value.slice(0, el.selectionEnd).replace(/\s+$/, '');
    replaceValue(kept, kept.length);
  };

  const cutSelection = () => {
    const el = areaRef.current;
    if (!el || el.selectionStart === el.selectionEnd) return;
    const { selectionStart: from, selectionEnd: to } = el;
    replaceValue(`${value.slice(0, from)}${value.slice(to)}`, from);
  };

  const undo = () => {
    if (!history.length) return;
    const previous = history[history.length - 1];
    caretRef.current = previous.caret;
    setValue(previous.value);
    setHistory((past) => past.slice(0, -1));
  };

  const reflow = () => {
    const next = reflowParagraphs(value);
    if (next === value) return;
    replaceValue(next, Math.min(areaRef.current?.selectionStart ?? 0, next.length));
  };

  const restore = () => replaceValue(originalText, 0);

  // Strips the trailing Index / About the Author locally, then adds the two
  // sentences a narrator speaks. Routed through replaceValue so the existing
  // Undo button puts it straight back — there is no second undo stack.
  const clean = async () => {
    setCleaning(true);
    setError(null);
    try {
      const result = await cleanBookText(value, filename);
      setCleaned(result);
      replaceValue(result.text, 0);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCleaning(false);
    }
  };

  const undoClean = () => {
    undo();
    setCleaned(null);
  };

  const close = useCallback(() => {
    if (unsavedEdits && !window.confirm('Discard your changes to the text?')) return;
    onClose();
  }, [unsavedEdits, onClose]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(value);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    areaRef.current?.focus();
  }, []);

  const originalWords = useMemo(() => countWords(originalText), [originalText]);
  const removed = originalWords - stats.words;
  const wrapped = stats.wrapped;
  const justJoined = opened.joined && value === opened.value;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-base" role="dialog" aria-modal="true" aria-label="Edit book text">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-[16px] font-semibold text-ink">
            Editing {filename}
          </h2>
          <p className="mt-0.5 text-[12px] text-muted tabular-nums">
            {stats.words.toLocaleString()} words · about {stats.minutes}{' '}
            {stats.minutes === 1 ? 'minute' : 'minutes'} of audio
            {removed > 0 && <span className="text-warning"> · {removed.toLocaleString()} removed</span>}
            {removed < 0 && <span className="text-muted"> · {(-removed).toLocaleString()} added</span>}
            {justJoined && <span className="text-accent-ink"> · line breaks joined</span>}
            {dirty && !justJoined && <span className="text-accent-ink"> · unsaved</span>}
          </p>
        </div>

        <button
          type="button"
          onClick={close}
          disabled={saving}
          className="flex h-[34px] items-center gap-1.5 rounded-btn border border-line-strong px-3 text-[13px] font-medium text-muted hover:border-ink/30 hover:text-ink disabled:opacity-50"
        >
          <X size={14} />
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !dirty}
          className="flex h-[34px] items-center gap-1.5 rounded-btn bg-accent px-3.5 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-line-strong disabled:text-faint"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {saving ? 'Saving…' : 'Save and go back'}
        </button>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-panel px-5 py-2">
        <button
          type="button"
          onClick={startHere}
          className="flex h-[30px] items-center gap-1.5 rounded-btn border border-line-strong bg-base px-2.5 text-[12px] font-medium text-muted hover:border-accent hover:text-ink"
          title="Delete everything above the cursor, so narration starts here"
        >
          <ArrowUpToLine size={13} />
          Start here
        </button>
        <button
          type="button"
          onClick={endHere}
          className="flex h-[30px] items-center gap-1.5 rounded-btn border border-line-strong bg-base px-2.5 text-[12px] font-medium text-muted hover:border-accent hover:text-ink"
          title="Delete everything below the cursor, so narration ends here"
        >
          <ArrowDownToLine size={13} />
          End here
        </button>
        <button
          type="button"
          onClick={cutSelection}
          className="flex h-[30px] items-center gap-1.5 rounded-btn border border-line-strong bg-base px-2.5 text-[12px] font-medium text-muted hover:border-accent hover:text-ink"
          title="Delete the selected text"
        >
          <Scissors size={13} />
          Cut selection
        </button>

        <span className="mx-1 h-4 w-px bg-line-strong" aria-hidden="true" />

        <button
          type="button"
          onClick={reflow}
          disabled={!wrapped}
          className={`flex h-[30px] items-center gap-1.5 rounded-btn border px-2.5 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
            wrapped
              ? 'border-accent bg-accent-soft text-accent-ink hover:bg-accent-soft/70'
              : 'border-line-strong bg-base text-muted'
          }`}
          title="Join the line breaks the PDF left behind, so paragraphs run the full width"
        >
          <WrapText size={13} />
          Fill width
        </button>

        <button
          type="button"
          onClick={() => void clean()}
          disabled={cleaning || !value.trim()}
          className="flex h-[30px] items-center gap-1.5 rounded-btn border border-accent bg-accent-soft px-2.5 text-[12px] font-medium text-accent-ink hover:bg-accent-soft/70 disabled:cursor-not-allowed disabled:opacity-40"
          title="Remove the index and author notes at the end, and add a narrator introduction and closing"
        >
          {cleaning ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Sparkles size={13} />
          )}
          {cleaning ? 'Cleaning…' : 'Clean with AI'}
        </button>

        <span className="mx-1 h-4 w-px bg-line-strong" aria-hidden="true" />

        <button
          type="button"
          onClick={undo}
          disabled={!history.length}
          className="flex h-[30px] items-center gap-1.5 rounded-btn border border-line-strong bg-base px-2.5 text-[12px] font-medium text-muted hover:border-accent hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          title="Undo the last Start here / End here / Cut / Fill width"
        >
          <Undo2 size={13} />
          Undo cut
        </button>
        <button
          type="button"
          onClick={restore}
          className="flex h-[30px] items-center gap-1.5 rounded-btn border border-line-strong bg-base px-2.5 text-[12px] font-medium text-muted hover:border-danger/40 hover:text-danger"
          title="Put back the text exactly as it was extracted from the file"
        >
          <RotateCcw size={13} />
          Restore original
        </button>

        <p className="ml-auto text-[11px] text-faint tabular-nums">
          cursor at {caretPercent}% · {stats.chars.toLocaleString()} characters
        </p>
      </div>

      {cleaned && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-accent-soft px-5 py-2">
          <Sparkles size={13} className="shrink-0 text-accent-ink" />
          <p className="min-w-0 text-[12px] text-accent-ink">
            {cleaned.removedWords > 0 ? (
              <>
                Removed {cleaned.removedWords.toLocaleString()} words of{' '}
                {cleaned.heading ? `“${cleaned.heading}”` : 'back matter'} from the end, and added
              </>
            ) : (
              <>No index or author notes were found at the end. Added</>
            )}{' '}
            {cleaned.source === 'gemini' ? (
              <>an introduction and closing written for this book.</>
            ) : (
              <>a standard introduction and closing.</>
            )}
            {cleaned.reason && (
              // Never let a silent fallback pass as a real reading of the book.
              <span className="text-warning"> {cleaned.reason}</span>
            )}
          </p>
          <button
            type="button"
            onClick={undoClean}
            className="ml-auto shrink-0 text-[12px] font-medium text-accent-ink underline underline-offset-2 hover:no-underline"
          >
            Undo the clean-up
          </button>
        </div>
      )}

      {justJoined && !cleaned && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-accent-soft px-5 py-2">
          <WrapText size={13} className="shrink-0 text-accent-ink" />
          <p className="text-[12px] text-accent-ink">
            Joined the line breaks the file left mid-paragraph, so the text fills the width. Nothing
            is saved until you press Save.
          </p>
          <button
            type="button"
            onClick={undo}
            className="ml-auto text-[12px] font-medium text-accent-ink underline underline-offset-2 hover:no-underline"
          >
            Keep the original line breaks
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1">
        <textarea
          ref={areaRef}
          value={value}
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onSelect={refreshCaret}
          onClick={refreshCaret}
          onKeyUp={refreshCaret}
          aria-label="Book text"
          className="block h-full w-full resize-none border-0 bg-base px-6 py-5 font-reader text-[15px] leading-relaxed text-ink outline-none"
        />
      </div>

      {error && (
        <footer className="shrink-0 border-t border-line px-5 py-3">
          <p className="rounded-btn border border-danger/30 bg-danger/5 px-3 py-2 text-[12px] text-danger">
            {error}
          </p>
        </footer>
      )}
    </div>
  );
}
