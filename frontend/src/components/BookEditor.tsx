import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Loader2,
  RotateCcw,
  Save,
  Scissors,
  Undo2,
  WrapText,
  X,
} from 'lucide-react';

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

// PDF and EPUB extraction keeps one line per printed line, so a book arrives
// hard-wrapped at ~70 characters and only fills the left of a wide editor.
// This unwraps it into whole paragraphs the way the reader already displays it
// and the way preprocessText joins it at generation time.
function reflowParagraphs(text: string): string {
  const out: string[] = [];

  for (const raw of text.split('\n')) {
    const line = raw.trim();

    if (!line) {
      if (out.length && out[out.length - 1] !== '') out.push('');
      continue;
    }

    const previous = out.length ? out[out.length - 1] : '';

    if (previous) {
      if (/[a-z]-$/.test(previous) && /^[a-z]/.test(line)) {
        out[out.length - 1] = previous.slice(0, -1) + line;
        continue;
      }
      if (!/[.!?:;]["'”’)]?$/.test(previous) && /^[a-z(“‘"']/.test(line)) {
        out[out.length - 1] = `${previous} ${line}`;
        continue;
      }
    }

    out.push(line);
  }

  return out.join('\n');
}

function isHardWrapped(text: string): boolean {
  const lines = text.split('\n').filter((line) => line.trim());
  if (lines.length < 20) return false;
  const short = lines.filter((line) => line.trim().length < 90).length;
  return short / lines.length > 0.8;
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

  const [value, setValue] = useState(text);
  const [stats, setStats] = useState<Stats>(() => statsFor(text));
  const [caretPercent, setCaretPercent] = useState(0);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = value !== text;

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

  const close = useCallback(() => {
    if (dirty && !window.confirm('Discard your changes to the text?')) return;
    onClose();
  }, [dirty, onClose]);

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
            {dirty && <span className="text-accent-ink"> · unsaved</span>}
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

        <span className="mx-1 h-4 w-px bg-line-strong" aria-hidden="true" />

        <button
          type="button"
          onClick={undo}
          disabled={!history.length}
          className="flex h-[30px] items-center gap-1.5 rounded-btn border border-line-strong bg-base px-2.5 text-[12px] font-medium text-muted hover:border-accent hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          title="Undo the last Start here / End here / Cut"
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
