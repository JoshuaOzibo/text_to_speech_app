import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  Cloud,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  Headphones,
  Loader2,
  RotateCcw,
  Sparkles,
  Square,
} from 'lucide-react';
import {
  fetchSummaryProviders,
  headingLevelsOf,
  planSummary,
  summarizeBook,
  type SummaryRequest,
} from '../lib/api';
import type {
  Book,
  ChunkRun,
  SummaryEvent,
  SummaryPlan,
  SummaryProvider,
  SummaryProviderId,
  SummaryResult,
  SummaryStructure,
  SummaryWarning,
} from '../types';

interface Props {
  /** The full book. A summary is always written from the whole text. */
  book: Book;
  speed: number;
  run: ChunkRun | null;
  onClose: () => void;
  /** Makes the summary the open book, so every narration path works on it. */
  onUse: (result: SummaryResult) => Promise<void>;
}

const PRESETS = [10, 15, 20, 30, 45, 60];
const DEFAULT_MINUTES = 30;
const MIN_MINUTES = 3;
const MAX_MINUTES = 240;

const STRUCTURES: { id: SummaryStructure; label: string; hint: string }[] = [
  { id: 'chapters', label: 'Chapter by chapter', hint: "Keeps the book's chapter headings" },
  { id: 'continuous', label: 'Continuous talk', hint: 'One flowing narrative, no headings' },
];

const WARNING_LABEL: Record<SummaryWarning['kind'], string> = {
  quote: 'Quotation not found word for word',
  number: 'Figure not found in that part',
  name: 'Name not found in the book',
  missing: 'Part missing',
};

function readSetting(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(`localaudiobook.summary.${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeSetting(key: string, value: string) {
  try {
    window.localStorage.setItem(`localaudiobook.summary.${key}`, value);
  } catch {
    // Private window or blocked storage: the choice just is not remembered.
  }
}

function duration(minutes: number): string {
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} min`;
  const hours = minutes / 60;
  return hours < 10 ? `${hours.toFixed(1)} h` : `${Math.round(hours)} h`;
}

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface Progress {
  done: number;
  total: number;
  current: string;
  note: string | null;
  phase: 'parts' | 'intro';
}

/** Splits a paragraph around the sentences a warning points at, for highlighting. */
function highlight(text: string, sentences: string[]): ReactNode {
  const hits = sentences.filter((sentence) => sentence && text.includes(sentence));
  if (!hits.length) return text;

  const parts: ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest) {
    let first = -1;
    let match = '';
    for (const sentence of hits) {
      const at = rest.indexOf(sentence);
      if (at >= 0 && (first < 0 || at < first)) {
        first = at;
        match = sentence;
      }
    }
    if (first < 0) {
      parts.push(rest);
      break;
    }
    if (first > 0) parts.push(rest.slice(0, first));
    parts.push(
      <mark key={key++} className="rounded-[3px] bg-warning-bright/35 px-0.5 text-ink">
        {match}
      </mark>,
    );
    rest = rest.slice(first + match.length);
  }
  return parts;
}

export function SummaryPage({ book, speed, run, onClose, onUse }: Props) {
  const [providers, setProviders] = useState<SummaryProvider[] | null>(null);
  const [providersError, setProvidersError] = useState<string | null>(null);
  const [providerId, setProviderId] = useState<SummaryProviderId>(
    () => readSetting('provider', 'gemini') as SummaryProviderId,
  );
  const [ollamaModel, setOllamaModel] = useState(() => readSetting('ollamaModel', ''));
  const [structure, setStructure] = useState<SummaryStructure>(() =>
    readSetting('structure', 'chapters') === 'continuous' ? 'continuous' : 'chapters',
  );
  // Always 30 on open: the default length is part of the feature, not a preference.
  const [minutes, setMinutes] = useState(DEFAULT_MINUTES);
  const [minutesDraft, setMinutesDraft] = useState(String(DEFAULT_MINUTES));
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [authorDraft, setAuthorDraft] = useState<string | null>(null);

  const [plan, setPlan] = useState<SummaryPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<SummaryResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [using, setUsing] = useState(false);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const headingLevels = useMemo(() => headingLevelsOf(book), [book]);
  const provider = providers?.find((p) => p.id === providerId) ?? null;

  useEffect(() => {
    let cancelled = false;
    fetchSummaryProviders()
      .then((list) => {
        if (cancelled) return;
        setProviders(list);
        // A remembered provider that is no longer usable gives way to the
        // first one that is, so the button is not dead on arrival.
        setProviderId((current) => {
          const remembered = list.find((p) => p.id === current);
          if (remembered?.available) return current;
          return list.find((p) => p.available)?.id ?? remembered?.id ?? list[0]?.id ?? current;
        });
      })
      .catch((err: Error) => !cancelled && setProvidersError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => writeSetting('provider', providerId), [providerId]);
  useEffect(() => writeSetting('structure', structure), [structure]);
  useEffect(() => {
    if (ollamaModel) writeSetting('ollamaModel', ollamaModel);
  }, [ollamaModel]);

  const request = useMemo<SummaryRequest>(
    () => ({
      text: book.text,
      filename: book.filename,
      minutes,
      speed,
      structure,
      provider: providerId,
      model: providerId === 'ollama' ? ollamaModel || undefined : undefined,
      title: titleDraft ?? undefined,
      author: authorDraft ?? undefined,
      headingLevels,
    }),
    [book, minutes, speed, structure, providerId, ollamaModel, titleDraft, authorDraft, headingLevels],
  );

  // The plan is free (it runs on this machine), so it follows every change,
  // debounced so typing a title does not post the book once per keystroke.
  useEffect(() => {
    if (!providers) return;
    const controller = new AbortController();
    const handle = window.setTimeout(() => {
      setPlanning(true);
      planSummary(request, controller.signal)
        .then((next) => {
          setPlan(next);
          setPlanError(null);
        })
        .catch((err: Error) => {
          if (err.name === 'AbortError') return;
          setPlan(null);
          setPlanError(err.message);
        })
        .finally(() => !controller.signal.aborted && setPlanning(false));
    }, 300);
    return () => {
      window.clearTimeout(handle);
      controller.abort();
    };
  }, [request, providers]);

  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    setElapsed(0);
    const handle = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(handle);
  }, [running]);

  // Leaving mid-run cancels it. Finished parts are saved on the server, so it
  // is not destructive, but it should never happen by accident.
  const close = useCallback(() => {
    if (running) {
      if (!window.confirm('Stop writing the summary? The parts already written are saved.')) return;
      abortRef.current?.abort();
    }
    onClose();
  }, [running, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const onEvent = useCallback((event: SummaryEvent) => {
    setProgress((current) => {
      const base: Progress = current ?? { done: 0, total: 0, current: '', note: null, phase: 'parts' };
      switch (event.type) {
        case 'unit':
          return {
            ...base,
            done: event.done,
            total: event.total,
            current: event.state === 'start' ? event.titles[0] ?? '' : base.current,
            note: null,
          };
        case 'wait':
          return { ...base, note: `${event.reason} Trying again in ${event.seconds}s.` };
        case 'check':
          return { ...base, note: `Re-checking "${event.title}" against the book.` };
        case 'intro':
          return { ...base, phase: 'intro', note: null };
        default:
          return base;
      }
    });
  }, []);

  const start = async (fresh = false) => {
    if (!plan) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setRunError(null);
    setResult(null);
    setProgress({ done: 0, total: plan.units, current: '', note: null, phase: 'parts' });
    try {
      const written = await summarizeBook({ ...request, fresh }, onEvent, controller.signal);
      setResult(written);
    } catch (err) {
      const error = err as Error;
      setRunError(
        error.name === 'AbortError' ? 'Summary cancelled. The parts already written are saved.' : error.message,
      );
      // The saved-part count changed; ask the plan again so the button says so.
      planSummary(request).then(setPlan).catch(() => undefined);
    } finally {
      abortRef.current = null;
      setRunning(false);
      setProgress(null);
    }
  };

  const cancel = () => abortRef.current?.abort();

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setRunError('Could not copy to the clipboard.');
    }
  };

  const download = () => {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([result.text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${book.filename.replace(/\.[^.]+$/, '')} - ${result.minutes}-min summary.txt`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const narrate = async () => {
    if (!result) return;
    setUsing(true);
    try {
      await onUse(result);
    } catch (err) {
      setRunError((err as Error).message);
      setUsing(false);
    }
  };

  const commitMinutes = (value: string) => {
    const parsed = Math.round(Number(value));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setMinutesDraft(String(minutes));
      return;
    }
    const clamped = Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, parsed));
    setMinutes(clamped);
    setMinutesDraft(String(clamped));
  };

  const canRun = Boolean(plan && provider?.available && !running && !planning);
  const resumable = plan && plan.cachedUnits > 0 && !result;
  const allSaved = plan && plan.cachedUnits === plan.units;
  const bookTitle = book.filename.replace(/\.[^.]+$/, '');
  const warningSentences = useMemo(
    () => (result?.warnings ?? []).map((w) => w.sentence).filter(Boolean),
    [result],
  );
  const headingSet = useMemo(() => new Set(result?.headings ?? []), [result]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-base"
      role="dialog"
      aria-modal="true"
      aria-label="Summarize this book"
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
        <button
          type="button"
          onClick={close}
          className="flex h-[34px] items-center gap-1.5 rounded-btn border border-line-strong px-3 text-[13px] font-medium text-muted hover:border-ink/30 hover:text-ink"
        >
          <ArrowLeft size={14} />
          Back to book
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-[17px] font-semibold text-ink">Summarize</h1>
          <p className="truncate text-[12px] text-muted">{bookTitle}</p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto wide:flex wide:overflow-hidden">
        <aside className="border-b border-line bg-panel p-4 sm:p-5 wide:w-[360px] wide:shrink-0 wide:overflow-y-auto wide:border-r wide:border-b-0">
          <Label>Length</Label>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                disabled={running}
                onClick={() => {
                  setMinutes(preset);
                  setMinutesDraft(String(preset));
                }}
                className={`h-8 rounded-btn border px-3 text-[13px] font-medium tabular-nums disabled:opacity-50 ${
                  minutes === preset
                    ? 'border-accent bg-accent-soft text-accent-ink'
                    : 'border-line-strong bg-base text-muted hover:border-accent hover:text-ink'
                }`}
              >
                {preset} min
              </button>
            ))}
          </div>
          <label className="mt-2 flex items-center gap-2 text-[12px] text-muted">
            Or exactly
            <input
              type="number"
              min={MIN_MINUTES}
              max={MAX_MINUTES}
              value={minutesDraft}
              disabled={running}
              onChange={(e) => setMinutesDraft(e.target.value)}
              onBlur={(e) => commitMinutes(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && commitMinutes((e.target as HTMLInputElement).value)}
              className="h-8 w-20 rounded-btn border border-line-strong bg-base px-2 text-[13px] text-ink tabular-nums"
            />
            minutes
          </label>
          <p className="mt-2 text-[12px] text-muted">
            Everything fits under {minutes} minutes, introduction and closing included.
          </p>

          <Label className="mt-6">AI</Label>
          {providersError && <p className="text-[12px] text-danger">{providersError}</p>}
          {!providers && !providersError && (
            <p className="flex items-center gap-2 text-[12px] text-muted">
              <Loader2 size={13} className="animate-spin" /> Checking which providers are set up…
            </p>
          )}
          {providers && (
            <div className="grid grid-cols-2 gap-1.5">
              {providers.map((option) => {
                const active = option.id === providerId;
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={running}
                    onClick={() => setProviderId(option.id)}
                    title={option.reason ?? `${option.label} · ${option.model}`}
                    className={`flex min-w-0 flex-col items-start rounded-btn border px-3 py-2 text-left disabled:opacity-50 ${
                      active
                        ? 'border-accent bg-accent-soft'
                        : 'border-line-strong bg-base hover:border-accent'
                    } ${option.available ? '' : 'opacity-60'}`}
                  >
                    <span className="flex w-full items-center gap-1.5 text-[13px] font-medium text-ink">
                      {option.local ? (
                        <Cpu size={13} className="shrink-0 text-faint" />
                      ) : (
                        <Cloud size={13} className="shrink-0 text-faint" />
                      )}
                      <span className="min-w-0 truncate">{option.label}</span>
                      {option.freeTier && (
                        <span className="ml-auto shrink-0 rounded-btn bg-accent-soft px-1.5 text-[10px] font-medium text-accent-ink">
                          free
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 w-full truncate text-[11px] text-muted">
                      {option.available ? option.model : 'Not set up'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {provider?.local && (provider.models?.length ?? 0) > 1 && (
            <label className="mt-2 flex items-center gap-2 text-[12px] text-muted">
              Model
              <select
                value={ollamaModel || provider.model}
                disabled={running}
                onChange={(e) => setOllamaModel(e.target.value)}
                className="h-8 min-w-0 flex-1 rounded-btn border border-line-strong bg-base px-2 text-[13px] text-ink"
              >
                {provider.models?.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </label>
          )}

          {provider && (
            <p
              className={`mt-2 rounded-btn border px-3 py-2 text-[12px] ${
                provider.available
                  ? 'border-line bg-base text-muted'
                  : 'border-warning-bright bg-warning-bright/10 text-warning'
              }`}
            >
              {!provider.available
                ? provider.reason
                : provider.local
                  ? 'Runs on this PC. Nothing leaves the machine.'
                  : `Sends the full text of this book to ${provider.vendor} when you press Summarize. Narration still runs on this PC.`}
              {provider.available && provider.note && <span className="mt-1 block">{provider.note}</span>}
              {!provider.available && provider.keyUrl && (
                <a
                  href={provider.keyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 flex w-fit items-center gap-1 font-medium text-accent-ink underline underline-offset-2"
                >
                  {provider.local
                    ? `Download ${provider.label}`
                    : provider.freeTier
                      ? `Get a free ${provider.label} API key`
                      : `Get a ${provider.label} API key`}
                  <ExternalLink size={12} className="shrink-0" />
                </a>
              )}
              {provider.available && provider.local && plan && plan.bookWords > 30000 && (
                <span className="mt-1 block text-warning">
                  On this CPU a book this long can take hours. Parts are saved as they finish.
                </span>
              )}
            </p>
          )}

          <Label className="mt-6">Structure</Label>
          <div className="grid gap-1.5">
            {STRUCTURES.map((option) => (
              <button
                key={option.id}
                type="button"
                disabled={running}
                onClick={() => setStructure(option.id)}
                className={`flex items-center gap-2.5 rounded-btn border px-3 py-2 text-left disabled:opacity-50 ${
                  structure === option.id
                    ? 'border-accent bg-accent-soft'
                    : 'border-line-strong bg-base hover:border-accent'
                }`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    structure === option.id ? 'border-accent bg-accent text-white' : 'border-line-strong'
                  }`}
                >
                  {structure === option.id && <Check size={10} strokeWidth={3} />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-ink">{option.label}</span>
                  <span className="block text-[11px] text-muted">{option.hint}</span>
                </span>
              </button>
            ))}
          </div>

          <Label className="mt-6">Spoken in the intro and closing</Label>
          <label className="block text-[11px] text-muted">
            Title
            <input
              value={titleDraft ?? plan?.title ?? ''}
              disabled={running}
              onChange={(e) => setTitleDraft(e.target.value)}
              placeholder="Book title"
              className="mt-1 h-9 w-full rounded-btn border border-line-strong bg-base px-2.5 text-[13px] text-ink"
            />
          </label>
          <label className="mt-2 block text-[11px] text-muted">
            Author
            <input
              value={authorDraft ?? plan?.author ?? ''}
              disabled={running}
              onChange={(e) => setAuthorDraft(e.target.value)}
              placeholder="Not stated"
              className="mt-1 h-9 w-full rounded-btn border border-line-strong bg-base px-2.5 text-[13px] text-ink"
            />
          </label>
          {plan && !plan.titleCertain && titleDraft === null ? (
            <p className="mt-1.5 text-[11px] text-warning">
              The title is a guess from the book&apos;s first pages. Check it: it is said out loud.
            </p>
          ) : (
            <p className="mt-1.5 text-[11px] text-faint">Both are said out loud, so check them.</p>
          )}

          {run && run.done > 0 && (
            <p className="mt-6 rounded-btn border border-warning-bright/60 bg-warning-bright/10 px-3 py-2 text-[12px] text-warning">
              An interrupted run of {run.done} chunks is saved. Finish it or clear it before generating the
              summary&apos;s MP3; read-aloud works either way.
            </p>
          )}

          {/* Pinned to the bottom of the settings column so it never scrolls out of reach. */}
          <div className="sticky bottom-0 -mx-4 mt-6 border-t border-line bg-panel px-4 py-3 sm:-mx-5 sm:px-5 wide:-mb-5">
            {running ? (
              <button
                type="button"
                onClick={cancel}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-btn border border-line-strong text-[14px] font-medium text-muted hover:border-danger hover:text-danger"
              >
                <Square size={14} />
                Cancel
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void start()}
                disabled={!canRun}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-btn bg-accent text-[14px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-line-strong disabled:text-faint"
              >
                {planning ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                {allSaved
                  ? 'Open the saved summary'
                  : resumable
                    ? `Continue: ${plan.cachedUnits} of ${plan.units} parts saved`
                    : 'Summarize'}
              </button>
            )}
          </div>
        </aside>

        <section className="px-4 py-6 sm:px-8 wide:min-w-0 wide:flex-1 wide:overflow-y-auto">
          <div className="mx-auto max-w-[760px]">
            {planError && !running && (
              <p className="mb-5 rounded-btn border border-danger/30 bg-danger/5 px-3 py-2 text-[13px] text-danger">
                {planError}
              </p>
            )}
            {runError && (
              <p className="mb-5 rounded-btn border border-danger/30 bg-danger/5 px-3 py-2 text-[13px] text-danger">
                {runError}
              </p>
            )}

            {running && progress && <ProgressCard progress={progress} elapsed={elapsed} />}

            {result ? (
              <ResultView
                result={result}
                headingSet={headingSet}
                warningSentences={warningSentences}
                using={using}
                copied={copied}
                onNarrate={() => void narrate()}
                onCopy={() => void copy()}
                onDownload={download}
                onAgain={() => void start(true)}
              />
            ) : (
              plan && (
                <div>
                  <p className="text-[11px] font-medium tracking-[0.12em] text-faint uppercase">
                    What the summary covers
                  </p>
                  <h2 className="mt-2 font-reader text-[26px] leading-tight font-medium text-ink">
                    {plan.title}
                  </h2>
                  {plan.author && <p className="mt-1 text-[14px] text-muted">{plan.author}</p>}

                  <div className="mt-5 grid grid-cols-3 gap-2">
                    <Stat label="The book" value={duration(plan.bookMinutes)} sub={`${plan.bookWords.toLocaleString()} words`} />
                    <Stat
                      label="The summary"
                      value={`≤ ${plan.minutes} min`}
                      sub={`up to ${plan.targetWords.toLocaleString()} words`}
                    />
                    <Stat
                      label={structure === 'chapters' ? 'Sections' : 'Parts'}
                      value={String(plan.sections.length)}
                      sub={`${plan.units} ${plan.units === 1 ? 'request' : 'requests'}`}
                    />
                  </div>

                  <p className="mt-4 text-[13px] leading-relaxed text-muted">
                    Every part of the book gets time in proportion to its length, summarized from its full text.
                    Quotations, figures and names are then checked against the book on this PC, and anything
                    that does not match is flagged for you.
                  </p>

                  <button
                    type="button"
                    onClick={() => setShowBreakdown((open) => !open)}
                    className="mt-4 flex items-center gap-1 text-[13px] font-medium text-accent-ink"
                  >
                    <ChevronDown size={14} className={showBreakdown ? 'rotate-180' : ''} />
                    {showBreakdown ? 'Hide' : 'Show'} the breakdown
                  </button>
                  {showBreakdown && (
                    <ol className="mt-3 divide-y divide-line rounded-card border border-line">
                      {plan.sections.map((section, i) => (
                        <li key={i} className="flex items-baseline gap-3 px-3 py-2 text-[13px]">
                          <span className="min-w-0 flex-1 text-ink">
                            {section.titles.length ? section.titles.join(' · ') : 'The opening'}
                          </span>
                          <span className="shrink-0 text-[12px] text-faint tabular-nums">
                            {section.sourceWords.toLocaleString()} → {section.budget} words
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Label({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p className={`mb-2 text-[10px] font-medium tracking-[0.12em] text-faint uppercase ${className}`}>
      {children}
    </p>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-card border border-line bg-panel px-3 py-2.5">
      <p className="text-[11px] text-faint">{label}</p>
      <p className="mt-0.5 font-display text-[18px] font-semibold text-ink tabular-nums">{value}</p>
      <p className="text-[11px] text-muted tabular-nums">{sub}</p>
    </div>
  );
}

function ProgressCard({ progress, elapsed }: { progress: Progress; elapsed: number }) {
  const share = progress.total ? progress.done / progress.total : 0;
  const width = progress.phase === 'intro' ? 100 : Math.max(4, Math.round(share * 100));
  return (
    <div className="mb-6 rounded-card border border-line bg-panel p-4">
      <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
        <Loader2 size={14} className="animate-spin text-accent" />
        {progress.phase === 'intro'
          ? 'Writing the introduction and closing…'
          : `Summarizing part ${Math.min(progress.done + 1, progress.total)} of ${progress.total}`}
        <span className="ml-auto text-[12px] font-normal text-faint tabular-nums">{clock(elapsed)}</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${width}%` }} />
      </div>
      {progress.phase === 'parts' && progress.current && (
        <p className="mt-2 truncate text-[12px] text-muted">{progress.current}</p>
      )}
      {progress.note && <p className="mt-1 text-[12px] text-warning">{progress.note}</p>}
    </div>
  );
}

interface ResultProps {
  result: SummaryResult;
  headingSet: Set<string>;
  warningSentences: string[];
  using: boolean;
  copied: boolean;
  onNarrate: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onAgain: () => void;
}

function ResultView({
  result,
  headingSet,
  warningSentences,
  using,
  copied,
  onNarrate,
  onCopy,
  onDownload,
  onAgain,
}: ResultProps) {
  const blocks = useMemo(() => result.text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean), [result.text]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onNarrate}
          disabled={using}
          className="flex h-10 items-center gap-2 rounded-btn bg-accent px-4 text-[14px] font-medium text-white hover:bg-accent-hover disabled:cursor-wait disabled:opacity-70"
        >
          {using ? <Loader2 size={15} className="animate-spin" /> : <Headphones size={15} />}
          Narrate this summary
        </button>
        <SmallButton onClick={onCopy} icon={copied ? <Check size={13} /> : <Copy size={13} />}>
          {copied ? 'Copied' : 'Copy'}
        </SmallButton>
        <SmallButton onClick={onDownload} icon={<Download size={13} />}>
          Download .txt
        </SmallButton>
        <SmallButton onClick={onAgain} icon={<RotateCcw size={13} />}>
          Write it again
        </SmallButton>
      </div>

      <p className="mt-3 text-[12px] text-muted tabular-nums">
        {result.words.toLocaleString()} words · about {duration(result.estimatedMinutes)} at {result.speed.toFixed(1)}×
        · written by {result.providerLabel} ({result.model})
        {result.cachedUnits > 0 && ` · ${result.cachedUnits} of ${result.totalUnits} parts from an earlier run`}
      </p>

      {result.intro.source === 'template' && (
        // Never let a fallback pass as the provider's own reading of the book.
        <p className="mt-3 rounded-btn border border-warning-bright bg-warning-bright/10 px-3 py-2 text-[12px] text-warning">
          The introduction and closing are the standard template: {result.intro.reason}
        </p>
      )}

      {result.warnings.length > 0 ? (
        <div className="mt-3 rounded-card border border-warning-bright bg-warning-bright/10 p-3">
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-warning">
            <AlertTriangle size={14} />
            {result.warnings.length === 1
              ? '1 passage could not be verified against the book'
              : `${result.warnings.length} passages could not be verified against the book`}
          </p>
          <ul className="mt-2 space-y-1.5">
            {result.warnings.map((warning, i) => (
              <li key={i} className="text-[12px] text-ink">
                <span className="font-medium">{WARNING_LABEL[warning.kind]}</span>
                <span className="text-muted"> in {warning.section}: </span>
                {warning.kind === 'missing' ? warning.detail : `“${warning.detail}”`}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-muted">
            Highlighted below. Fix them with Edit text after pressing Narrate, or write the summary again.
          </p>
        </div>
      ) : (
        <p className="mt-3 flex items-center gap-1.5 text-[12px] text-success">
          <Check size={13} />
          Every quotation, figure and name was found in the book.
        </p>
      )}

      <article className="mt-8 border-t border-line pt-8">
        {blocks.map((block, i) =>
          headingSet.has(block) ? (
            <h3 key={i} className="mt-10 mb-4 font-reader text-[21px] leading-snug font-medium text-ink first:mt-0">
              {block}
            </h3>
          ) : (
            <p key={i} className="mb-5 font-reader text-[16px] leading-[1.85] text-ink">
              {highlight(block, warningSentences)}
            </p>
          ),
        )}
      </article>
    </div>
  );
}

function SmallButton({
  onClick,
  icon,
  children,
}: {
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-10 items-center gap-1.5 rounded-btn border border-line-strong px-3 text-[13px] font-medium text-muted hover:border-accent hover:text-ink"
    >
      {icon}
      {children}
    </button>
  );
}
