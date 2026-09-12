import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppHeader, type AppStatus } from './components/AppHeader';
import { BackgroundPicker } from './components/BackgroundPicker';
import { BookEditor } from './components/BookEditor';
import { ControlsPanel } from './components/ControlsPanel';
import { PlayerBar } from './components/PlayerBar';
import { ReadingPanel } from './components/ReadingPanel';
import { Sidebar, type PanelView } from './components/Sidebar';
import { VoiceLibrary } from './components/VoiceLibrary';
import type { StatusTone } from './components/StatusMessage';
import { useAudioGeneration } from './hooks/useAudioGeneration';
import { useReadAloud } from './hooks/useReadAloud';
import {
  discardResult,
  fetchBackground,
  fetchVoices,
  headingLevelsOf,
  previewFirstChunk,
  rescanBook,
  uploadBook,
} from './lib/api';
import { alreadyDownloaded, autoDownload } from './lib/autoDownload';
import { loadBook, saveBook } from './lib/bookStore';
import { voiceTitle } from './lib/voice';
import { WordClock } from './lib/wordClock';
import type { BackgroundStatus, Book, Chapter, TtsEngine, Voice } from './types';

// localStorage can throw (private windows, blocked site data), and the app has
// to work without it, so both sides are guarded.
function readSetting(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(`localaudiobook.${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeSetting(key: string, value: string) {
  try {
    window.localStorage.setItem(`localaudiobook.${key}`, value);
  } catch {
    /* not fatal - the setting just will not survive a reload */
  }
}

export default function App() {
  const [book, setBook] = useState<Book | null>(null);
  const [originalText, setOriginalText] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [voices, setVoices] = useState<Voice[]>([]);
  const [engines, setEngines] = useState<Record<TtsEngine, boolean> | null>(null);
  // Remembered across reloads: a run only resumes when the text, voice AND
  // speed match, so silently resetting these strands an interrupted book.
  const [voice, setVoice] = useState(() => readSetting('voice', ''));
  const [speed, setSpeed] = useState(() => Number(readSetting('speed', '1')) || 1);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const [background, setBackground] = useState<BackgroundStatus | null>(null);

  const [view, setView] = useState<PanelView>('text');
  const [query, setQuery] = useState('');
  const [matchCount, setMatchCount] = useState(0);
  const [activeMatch, setActiveMatch] = useState(0);
  const [fontSize, setFontSize] = useState(17);
  const [followPlayback, setFollowPlayback] = useState(true);
  const [playbackFraction, setPlaybackFraction] = useState<number | null>(null);
  const [activeWord, setActiveWord] = useState(-1);
  const [scrollTarget, setScrollTarget] = useState<{ lineIndex: number; nonce: number } | null>(
    null,
  );

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);

  const [isSampling, setIsSampling] = useState(false);
  const [isSamplePlaying, setIsSamplePlaying] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const sampleRef = useRef<HTMLAudioElement | null>(null);
  const sampleUrlRef = useRef<string | null>(null);

  const sampleFrameRef = useRef(0);

  const stopSample = useCallback(() => {
    cancelAnimationFrame(sampleFrameRef.current);
    sampleRef.current?.pause();
    sampleRef.current = null;
    if (sampleUrlRef.current) {
      URL.revokeObjectURL(sampleUrlRef.current);
      sampleUrlRef.current = null;
    }
    setIsSamplePlaying(false);
    setIsSampling(false);
    setActiveWord(-1);
  }, []);

  useEffect(() => () => stopSample(), [stopSample]);

  const bookWords = useMemo(
    () => (book?.text.trim() ? book.text.trim().split(/\s+/) : []),
    [book?.text],
  );


  const [restored, setRestored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadBook()
      .then((saved) => {
        if (!cancelled && saved) setBook(saved);
      })
      .finally(() => {
        if (!cancelled) setRestored(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!restored) return;
    void saveBook(book);
  }, [book, restored]);

  const {
    isGenerating,
    isAdopted,
    isCheckingServer,
    progress,
    audio,
    error: generationError,
    run,
    generate,
    resume,
    discardRun,
    cancel,
    clear,
  } = useAudioGeneration();

  useEffect(() => {
    if (voice) writeSetting('voice', voice);
  }, [voice]);

  useEffect(() => {
    writeSetting('speed', String(speed));
  }, [speed]);

  const live = useReadAloud(book?.text ?? null, voice, speed);
  const liveActive = live.active;
  const stopLive = live.stop;

  useEffect(() => {
    if (audio && liveActive) stopLive();
  }, [audio, liveActive, stopLive]);

  const [autoSaved, setAutoSaved] = useState(false);

  useEffect(() => {
    if (!audio) {
      setAutoSaved(false);
      return;
    }
    if (autoDownload(audio, book?.filename ?? 'audiobook') || alreadyDownloaded(audio)) {
      setAutoSaved(true);
    }
  }, [audio, book?.filename]);

  const liveForBar = useMemo(
    () => ({
      ...live,
      begin: () => {
        stopSample();
        live.begin();
      },
    }),
    [live, stopSample],
  );

  useEffect(() => {
    fetchVoices()
      .then((data) => {
        setVoices(data.voices);
        setEngines(data.engines);
        // Keep a remembered voice, but only if it is still installed.
        setVoice((current) => {
          const known = data.voices.some((v) => v.id === current);
          return known ? current : data.voices[0]?.id || '';
        });

        if (!data.ttsAvailable) {
          setSetupError(
            'No TTS engine found. Install Piper or Supertonic. See the README for setup steps.',
          );
        } else if (!data.ffmpegAvailable) {
          setSetupError('ffmpeg not found. Install it using: npm install ffmpeg-static');
        } else if (data.voices.length === 0) {
          setSetupError('No voice models installed. Download at least one. See the README.');
        } else {
          setSetupError(null);
        }
      })
      .catch(() => setSetupError('Could not reach the backend. Is it running on port 3001?'));
  }, []);

  useEffect(() => {
    fetchBackground()
      .then(setBackground)
      .catch(() => setBackground(null));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
      if (e.key === 'Escape' && document.activeElement === searchRef.current) {
        setQuery('');
        searchRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleSelect = useCallback(
    async (file: File) => {
      setIsUploading(true);
      setUploadError(null);
      setQuery('');
      clear();
      try {
        const uploaded = await uploadBook(file);
        setBook(uploaded);
        setOriginalText(uploaded.text);
        setView('text');
        setSidebarOpen(false);
      } catch (err) {
        setUploadError((err as Error).message);
        setBook(null);
        setOriginalText(null);
      } finally {
        setIsUploading(false);
      }
    },
    [clear],
  );

  const handleClear = useCallback(() => {
    setBook(null);
    setOriginalText(null);
    setUploadError(null);
    setQuery('');
    stopSample();
    clear();
  }, [clear, stopSample]);

  // Deleting an interrupted run can throw away hours of synthesis, so it is
  // always confirmed and the count is named in the prompt.
  const handleStartFresh = useCallback(() => {
    if (!run || run.done === 0) return;

    const chunks = `${run.done} finished ${run.done === 1 ? 'chunk' : 'chunks'}`;
    const of = run.total ? ` of ${run.total}` : '';
    if (!window.confirm(`Delete ${chunks}${of}? This cannot be undone.`)) return;

    setSidebarOpen(false);
    void discardRun();
  }, [run, discardRun]);

  const handleSaveEdit = useCallback(
    async (edited: string) => {
      const updated = await rescanBook(edited, book ? headingLevelsOf(book) : undefined);

      stopSample();
      stopLive();
      clear();
      await discardResult();

      setBook((current) => (current ? { ...current, ...updated } : current));
      setActiveWord(-1);
      setPlaybackFraction(null);
      setScrollTarget(null);
      setQuery('');
      setEditorOpen(false);
    },
    [book, clear, stopLive, stopSample],
  );

  const handlePreviewChunk = useCallback(async () => {
    if (!book || !voice) return;
    if (sampleRef.current) return stopSample();

    stopLive();
    setSampleError(null);
    setIsSampling(true);
    try {
      const { url, timeline } = await previewFirstChunk(book.text, voice, speed);
      const element = new Audio(url);
      sampleRef.current = element;
      sampleUrlRef.current = url;
      element.onended = stopSample;
      element.onerror = () => {
        setSampleError('Could not play the preview.');
        stopSample();
      };
      await element.play();
      setIsSamplePlaying(true);

      if (timeline) {
        const clock = new WordClock(timeline, bookWords);
        let last = -1;
        const tick = () => {
          const index = clock.wordAt(element.currentTime);
          if (index !== last) {
            last = index;
            setActiveWord(index);
          }
          sampleFrameRef.current = requestAnimationFrame(tick);
        };
        sampleFrameRef.current = requestAnimationFrame(tick);
      }
    } catch (err) {
      setSampleError((err as Error).message);
    } finally {
      setIsSampling(false);
    }
  }, [book, voice, speed, stopSample, stopLive, bookWords]);

  const handleJumpToChapter = useCallback((chapter: Chapter) => {
    setView('text');
    setScrollTarget({ lineIndex: chapter.lineIndex, nonce: Date.now() });
    setSidebarOpen(false);
  }, []);

  const handleQuery = useCallback((value: string) => {
    setQuery(value);
    setActiveMatch(0);
  }, []);

  const handleNextMatch = useCallback(() => {
    setActiveMatch((current) => (matchCount > 0 ? (current + 1) % matchCount : 0));
  }, [matchCount]);

  const handleMatchCount = useCallback((count: number) => setMatchCount(count), []);
  const handlePlaybackProgress = useCallback(
    (fraction: number | null) => setPlaybackFraction(fraction),
    [],
  );
  const handleWord = useCallback((index: number) => setActiveWord(index), []);

  const canGenerate = Boolean(book && voice && !isGenerating && !setupError);
  const selectedVoice = voices.find((v) => v.id === voice);

  const appStatus = useMemo<{ status: AppStatus; label: string }>(() => {
    if (setupError || uploadError || generationError || progress.status === 'error') {
      return { status: 'error', label: 'Error' };
    }
    if (isGenerating) return { status: 'working', label: 'Generating…' };
    if (audio) return { status: 'ready', label: 'Ready' };
    return { status: 'idle', label: 'Idle' };
  }, [setupError, uploadError, generationError, progress.status, isGenerating, audio]);

  const status = useMemo<{ tone: StatusTone; message: string } | null>(() => {
    if (setupError) return { tone: 'warning', message: setupError };
    if (uploadError) return { tone: 'error', message: uploadError };
    if (generationError) return { tone: 'error', message: generationError };
    if (progress.status === 'error' && progress.message) {
      return { tone: 'error', message: progress.message };
    }
    if (progress.status === 'cancelled') {
      return { tone: 'info', message: 'Generation cancelled. Nothing was saved.' };
    }
    if (audio) {
      return {
        tone: 'success',
        message: autoSaved
          ? 'Audio ready and saved to your downloads. Press play, or download it again below.'
          : 'Audio ready. Press play, or download the MP3.',
      };
    }
    if (isUploading) return { tone: 'info', message: 'Extracting text…' };
    if (!book) return { tone: 'info', message: 'Open a book to get started.' };
    if (!isGenerating) {
      const minutes = book.estimatedMinutes;
      return {
        tone: 'info',
        message: `${book.wordCount.toLocaleString()} words roughly ${minutes} ${
          minutes === 1 ? 'minute' : 'minutes'
        } of audio. Press play to start reading aloud, or generate the MP3 to keep.`,
      };
    }
    return null;
  }, [
    setupError,
    uploadError,
    generationError,
    progress,
    audio,
    autoSaved,
    isUploading,
    book,
    isGenerating,
  ]);

  const bookTitle = book ? book.filename.replace(/\.[^.]+$/, '') : 'Audiobook';
  const drawerOpen = sidebarOpen || controlsOpen;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-base">
      <AppHeader
        status={appStatus.status}
        statusLabel={appStatus.label}
        query={query}
        matchCount={query.length >= 2 ? matchCount : null}
        searchRef={searchRef}
        searchDisabled={!book}
        onQueryChange={handleQuery}
        onNextMatch={handleNextMatch}
        onToggleSidebar={() => {
          setSidebarOpen((open) => !open);
          setControlsOpen(false);
        }}
        onToggleControls={() => {
          setControlsOpen((open) => !open);
          setSidebarOpen(false);
        }}
      />

      <div className="relative flex min-h-0 flex-1">
        {drawerOpen && (
          <button
            type="button"
            aria-label="Close panel"
            onClick={() => {
              setSidebarOpen(false);
              setControlsOpen(false);
            }}
            className="absolute inset-0 z-30 bg-ink/20 wide:hidden"
          />
        )}

        <aside
          className={`absolute inset-y-0 left-0 z-40 w-[260px] shrink-0 border-r border-line bg-panel transition-transform duration-200 wide:static wide:w-60 wide:translate-x-0 ${
            sidebarOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full'
          }`}
        >
          <Sidebar
            book={book}
            run={run}
            onResume={() => {
              setSidebarOpen(false);
              void resume();
            }}
            onStartFresh={handleStartFresh}
            isUploading={isUploading}
            disabled={isGenerating}
            view={view}
            status={appStatus.status}
            statusLabel={appStatus.label}
            onSelectFile={handleSelect}
            onClear={handleClear}
            onView={(next) => {
              setView(next);
              setSidebarOpen(false);
            }}
            onEdit={() => {
              setEditorOpen(true);
              setSidebarOpen(false);
            }}
          />
        </aside>

        <main className="min-w-0 flex-1">
          <ReadingPanel
            book={book}
            view={view}
            query={query}
            activeMatch={activeMatch}
            fontSize={fontSize}
            followPlayback={followPlayback}
            playbackFraction={playbackFraction}
            activeWord={followPlayback ? activeWord : -1}
            scrollTarget={scrollTarget}
            engines={engines}
            voices={voices}
            onFontSize={setFontSize}
            onToggleFollow={() => setFollowPlayback((on) => !on)}
            onMatchCount={handleMatchCount}
            onFocusSearch={() => searchRef.current?.focus()}
            onJumpToChapter={handleJumpToChapter}
          />
        </main>

        <aside
          className={`absolute inset-y-0 right-0 z-40 w-[300px] shrink-0 border-l border-line bg-panel transition-transform duration-200 wide:static wide:translate-x-0 ${
            controlsOpen ? 'translate-x-0 shadow-xl' : 'translate-x-full'
          }`}
        >
          <ControlsPanel
            voices={voices}
            voice={voice}
            speed={speed}
            isGenerating={isGenerating}
            isAdopted={isAdopted}
            isCheckingServer={isCheckingServer}
            canGenerate={canGenerate}
            progress={progress}
            audio={audio}
            bookName={book?.filename ?? 'audiobook'}
            status={status}
            isSampling={isSampling}
            isSamplePlaying={isSamplePlaying}
            sampleError={sampleError}
            background={background}
            hasBook={Boolean(book)}
            onBrowseBackground={() => setBackgroundOpen(true)}
            onVoice={setVoice}
            onSpeed={setSpeed}
            onBrowseVoices={() => setLibraryOpen(true)}
            onGenerate={() =>
              book &&
              generate(book.text, voice, speed, {
                title: book.filename,
                wordCount: book.wordCount,
              })
            }
            onCancel={cancel}
            onPreview={handlePreviewChunk}
          />
        </aside>
      </div>

      <PlayerBar
        audio={audio}
        live={book ? liveForBar : null}
        title={book ? bookTitle : 'LocalAudioBook'}
        voiceLabel={
          selectedVoice ? `${voiceTitle(selectedVoice)} · ${speed.toFixed(1)}×` : undefined
        }
        bookName={book?.filename ?? 'audiobook'}
        chapters={book?.chapters ?? []}
        words={bookWords}
        onProgress={handlePlaybackProgress}
        onWord={handleWord}
      />

      {backgroundOpen && book && background && (
        <BackgroundPicker
          text={book.text}
          title={bookTitle}
          chapters={book.chapters.map((chapter) => chapter.title)}
          status={background}
          onStatus={setBackground}
          onClose={() => setBackgroundOpen(false)}
        />
      )}

      {editorOpen && book && (
        <BookEditor
          text={book.text}
          originalText={originalText ?? book.text}
          filename={book.filename}
          onSave={handleSaveEdit}
          onClose={() => setEditorOpen(false)}
        />
      )}

      {libraryOpen && (
        <VoiceLibrary
          voices={voices}
          selected={voice}
          speed={speed}
          onSelect={setVoice}
          onClose={() => setLibraryOpen(false)}
        />
      )}
    </div>
  );
}
