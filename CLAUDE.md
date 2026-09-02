# CLAUDE.md

Context for Claude Code working in this repo. Read this first, then
[README.md](README.md) for setup and [audiobook-app-spec.md](audiobook-app-spec.md) for the
original spec.

**Owner:** Joshua Ozibo — HND Computer Science, React + Node.js developer, Windows PC.
Building this to produce audiobook content for a YouTube channel. Comfortable with React,
Node, npm, and the terminal — no need to over-explain basics.

---

## What this is

**LocalAudioBook** — a local web app that turns any PDF/TXT/EPUB into a downloadable MP3
audiobook using Piper TTS. Narration runs entirely on the user's PC: no accounts, no cloud
TTS, no internet needed to generate a book. The one exception is the optional background-music
feature added on 2026-09-02 — see the amendment below.

The build is **complete and verified end to end** — upload, parse, chunk, narrate, merge,
stream, seek, download, and cancel all work against real Piper output.

### History — do not resurrect this

This folder previously held "Dharma of Wealth", a reader for one hardcoded book narrated by
the **paid Gemini cloud API**. On Joshua's instruction that is entirely gone: the Gemini
client, both AI routes, `bookData.ts`, and all six book-specific components were deleted.
The spec's hard constraints forbid cloud TTS. **Never narrate through a cloud service, and
never reintroduce `@google/genai`.** If a task seems to need cloud TTS, that is a signal the
task is wrong.

**Amended 2026-09-02.** Joshua asked for background music, chosen by AI from the book's
content. So there is now exactly one optional, user-initiated cloud call — Gemini suggesting
a *mood*, over plain `fetch`, no SDK — plus a music download. Read the boundary carefully:

- Narration, chunking, timing, mixing and playback are still **100% local**. No text is sent
  anywhere to be spoken, ever.
- The network is touched **only** when the user presses "Suggest a background", and again to
  download the one track they pick. After that the book generates offline like always.
- Every key is **optional**. With no `GEMINI_API_KEY` the mood comes from `mood.js` on this
  machine; with no music key the provider cascade falls through to the keyless libraries. The
  feature degrades, it never hard-fails.
- Pressing Suggest sends an **excerpt of the open book** to Google. That is the one place
  user content leaves the machine, it happens only on that click, and it must stay that way.

---

## Decisions Joshua made explicitly

These are settled. Don't relitigate them.

1. **Piper offline only.** Gemini and every cloud TTS option are out.
2. **Generic.** Works for any book; nothing is hardcoded to a specific title.
3. **Frontend TypeScript, backend JavaScript.** This split is deliberate. The backend was
   CommonJS until Joshua asked for ESM on 2026-09-01; it is now `"type": "module"`
   throughout. Don't convert it back.
4. **Folders are `backend/` and `frontend/`**, not the spec's `server/` and `client/`.
5. **Ports: frontend 3000, backend 3001.** The spec says Express on 3000; superseded.

---

## Conventions

| Area | Rule |
|---|---|
| Backend language | **JavaScript, ESM** (`import`/`export`, `"type": "module"`). Relative imports **must** carry the `.js` extension and a directory import must name `index.js`. Modules that export several names are imported as a namespace (`import * as jobStore`); route files `export default router`. |
| CJS dependencies | `pdf-parse` is imported as **`pdf-parse/lib/pdf-parse.js`**, never `'pdf-parse'`. Its index.js runs a debug branch when `module.parent` is undefined — which is always true under ESM — and tries to read a test PDF that isn't shipped. `epub2`, `express`, `multer`, `cors`, `fluent-ffmpeg` and `ffmpeg-static` are CJS and take default imports. `kokoro-js` is loaded with `await import()` inside `loadEngine`. |
| Frontend language | **TypeScript, ESM**, React 19 function components with named exports (`App.tsx` is the one default export). |
| Config | Backend reads config **only** through `src/config/env.js`. Never scatter `process.env`. It resolves paths from `__dirname`, so the server runs from any cwd. |
| Route files | Thin. Validate input, call a util, shape the response. Logic lives in `src/utils/`. |
| API URLs | Frontend always uses **relative** `/api/...`. Vite proxies to 3001 in dev; the backend serves both in production. Never hardcode an origin. |
| Styling | Tailwind v4 via `@tailwindcss/vite`. **Every** token is declared in `@theme` in `src/index.css` — surfaces `bg-base` (white) / `bg-panel` / `bg-surface` / `bg-card`, lines `border-line` / `border-line-strong`, text `text-ink` / `text-muted` / `text-faint`, accent `bg-accent` / `text-accent-ink` / `bg-accent-soft`, status `text-success` / `text-danger` / `text-warning` (+ `-bright` variants for fills), radii `rounded-card` / `rounded-btn`, fonts `font-ui` / `font-display` / `font-reader`. No `tailwind.config.js` exists and none is needed. |
| Breakpoint | `wide:` = 900px, declared as `--breakpoint-wide` in `@theme`. Below it the two side panels become drawers. Tailwind's own `sm:`/`lg:` still exist; use `wide:` for panel layout. |
| Fonts | Self-hosted via `@fontsource-variable/*`, imported in `main.tsx`. **Never** add a Google Fonts or Fontshare `<link>` — the app has to look the same offline. |
| Logging | Everything goes through `src/utils/logger.js` — never bare `console.log`. `logger.info/warn/error/debug(tag, message, fields)`, plus `timer()`, `secs()`, `watchdog()` (warns every 30s while something is still running) and `requestLogger` (mounted on `/api`). `LOG_LEVEL` defaults to `info`; `debug` adds per-synthesis timings and cache hits. Read-aloud logs a realtime ratio per chunk and warns above 0.9× — that ratio is the single best signal when playback stalls. Timings on this machine swing with load; re-measure before blaming a change. |
| Errors | Backend errors carry a `code` (`PIPER_NOT_FOUND`, `PDF_NO_TEXT`, `CANCELLED`, …) plus a message written for the end user. The UI displays `error` directly, so phrase it for a human. |

## Commands

| Command | Does |
|---|---|
| `npm run install:all` | install both packages |
| `npm run dev` | both dev servers, prefixed output |
| `npm run build` | type-check + build frontend |
| `NODE_ENV=production npm start` | backend serves API **and** built frontend on 3001 |
| `npm run lint` | `tsc --noEmit` (frontend only — backend is plain JS) |

There is no root `node_modules`; each package installs its own.

---

## Architecture notes that matter

**The UI is three fixed panels plus a pinned transport bar, and `App.tsx` owns all of the
state.** Left sidebar (library + view switcher), centre reading column, right controls —
each scrolls independently — with `PlayerBar` spanning the full window width underneath all
three. Below `wide:` (900px) the two side panels become drawers over the reader; the bar
stays. The panels are presentational; every piece of state lives in `App.tsx` and comes down
as props, which is what lets the reading column highlight the paragraph the player is
speaking.

- **`PlayerBar` owns the only `<audio>` element** and is rendered outside the panel row, so
  playback keeps going while the centre panel switches views and can never scroll out of
  sight. Its transport sits in a `grid-cols-[1fr_auto_1fr]` centre cell, so the play button
  is centred on the *window*, not on the reading panel. Don't move playback back into a
  panel — that was the old layout and it moved when the view changed.
- **The reading column is full width by request.** No `max-w` measure on the article; A− /
  A+ in the toolbar is the reader's control over line length. Don't "fix" this by
  reintroducing a 680px column.

- **The reader renders blocks, not raw text.** `ReadingPanel.buildBlocks()` turns the
  extracted text into headings and paragraphs using the chapter `lineIndex` list, and
  consumes `lineSpan` lines per heading — that is how `Chapter` / `I` / the title become one
  heading instead of a fragment plus two orphan lines.
- **Word highlighting runs off a measured timeline, not a guess.** No engine emits word
  timings, so `utils/timeline.js` builds them from two things that are exact: each chunk's
  real duration, and the pauses found inside its PCM. Piper leaves a measurable gap at every
  prosodic break — **~480ms after a full stop, ~280ms after a comma** on this machine — so
  `wavProcessor.findPauses` locates them and `segmentChunk` pins them to the punctuation in
  the text. Between two anchors (5-10 words) time is shared out by word length.
  - The pairing is **only accepted when the counts agree**: pauses vs punctuation breaks,
    then a sentences-only retry, then the whole chunk as one segment. A wrong pairing would
    put every later word in the chunk on the wrong line, so never loosen that check.
  - `findPauses` discards runs under 40ms **before** bridging. Bridging first chains the
    micro-gaps between ordinary words end to end and returns one pause covering everything —
    that bug cost an afternoon; the comment at the call site says so.
  - Indices in the timeline are **display words, not spoken ones**. `alignToDisplay` walks
    the extracted text and the spoken text together with a bounded forward-only window, so an
    expanded number (`1995` → "nineteen ninety-five") or a dropped running header shifts
    nothing after it. Segment keys are short (`s`/`e`/`a`/`b`) because a full book is ~14,000
    of them.
  - The client drives the highlight from `requestAnimationFrame`, not `timeupdate` —
    `timeupdate` fires ~4x/second, slower than speech, and the highlight visibly stutters a
    word behind. State only changes when the word does.
  - `ReadingPanel`'s blocks are `memo`ised and only the spoken block is given a real word
    index. Without that, every block in the book re-renders several times a second.
- **The chapter name and chapter-skip targets in `PlayerBar` are still estimates**, mapped
  from elapsed/total onto chapter word counts. They land within a few seconds of the
  heading. The paragraph highlight falls back to the same estimate when audio is recovered
  without a timeline.
- **The Text Preview still shows the book as extracted** — `preprocessText` runs at
  generation time only. Decorations and running headers you can see in the reader are
  removed on the way to the engine, not on screen. That is intended.

**Generation is one long request plus a side channel.** `POST /api/generate` stays open for
the entire book (minutes) and returns the final result. Progress arrives separately over
SSE at `GET /api/status`. The client opens the SSE connection *before* POSTing, and
`jobStore` replays its current snapshot to every new subscriber, so no event is lost in the
gap. Preserve both halves of that arrangement.

**`jobStore` is a module-level singleton.** One job at a time; a second `POST /api/generate`
gets a 409. This is a single-user local tool — that is sufficient and intentional.

**Read-aloud is a second audio path: streaming, not a file.** `POST /api/generate` produces an
MP3 and takes minutes to hours. The player bar can instead narrate the book as it goes, starting
a few seconds after an upload — `readStore.js` cuts the uploaded text into small chunks,
`routes/read.js` serves them one at a time, and `useReadAloud.ts` plays chunk N while prefetching
N+1 and N+2. Pressing play with a book open and no MP3 is what starts it.

- **Chunks are 60 words, not 300** (`READ_WORDS_PER_CHUNK`), and the *first* is 25
  (`READ_LEAD_WORDS`). That first number is the entire wait between pressing play and hearing a
  word: a 300-word chunk is nearly two minutes of audio and needs ~27s from a medium Piper voice.
  Measured end to end on this machine: **first audio ~4s** with `danny-low`. Don't raise these to
  match `WORDS_PER_CHUNK`.
- **The plan is a module-level singleton keyed by a hash of the text**, like `jobStore`. The
  client posts the book once and afterwards sends only the id, so a per-chunk request stays tiny.
  A restarted server answers `READ_PLAN_UNKNOWN`; the client re-posts the text and retries once,
  which is what lets reading survive a nodemon reload mid-sentence.
- **Every chunk carries its own timeline** in `X-Word-Timeline`: times are chunk-local, word
  indices are absolute in the displayed text. That is why `alignToDisplay` takes a `startWord` —
  it begins at the chunk's own display offset rather than at word 0, which is what keeps the
  bounded forward window meaningful for chunk 900 of a book.
- **Measurements are cached in a sidecar `.json` beside each WAV.** `processChunk` conditions the
  file **in place**, so a cache hit must never re-run it — that would level and fade an already
  levelled and faded file. Serve the cached measurements, never re-measure.
- **The seek bar is an estimate that sharpens as you listen.** Unsynthesized chunks are priced at
  a words-per-second rate learned from the chunks already measured, so the total converges on the
  truth (`~02:35` → `~02:05` during a test read). It is rendered with a leading `~` to say so.
- Like `/api/preview` this **bypasses the job slot deliberately**: reading works during a
  generation, and a cancel can never kill it. Chunks live in `audio/read/<id>/`, which
  `clearChunks()` does *not* sweep — a new book wipes the previous id's folder instead, and only
  `READ_CACHE_CHUNKS` (40) WAVs are kept per book.
- `PlayerBar` still owns the only `<audio>`; live mode just swaps its `src` per chunk. **The
  chunk change is applied from an effect keyed on `epoch`, not from `onLoadedMetadata`** —
  seeking back into an already-cached chunk reuses the same blob URL, so the element never
  reloads and that event never fires again. Doing it the obvious way stalled playback on every
  backward seek.

**The SSE stream is always connected, and that is load-bearing.** `useSSEProgress` opens on
mount and stays open for the life of the page — it is not gated on this tab having started a
run. Combined with jobStore replaying its snapshot to new subscribers, that is what lets a
reloaded page discover a run already in flight and show its progress bar and Cancel button.
`isGenerating` therefore means *the server is busy*, not *this tab started something*. Don't
"optimise" the stream to only connect while generating — that reintroduces the bug where a
user has a running job they can neither see nor cancel.

**Client disconnect cancels the run** — see the `res.on('close')` handler in `generate.js`,
and the warning about `req` vs `res` below.

**`GET /api/result`** returns the last MP3's metadata so a tab that never received the
`/api/generate` response (reloaded, or a different tab) can still show the player.

**Cancel kills the child process.** `jobStore.cancel()` kills the running Piper process; the
generate loop unwinds, deletes partial chunks, and reports `CANCELLED`. Verified: no orphan
`piper.exe`, no leftover WAVs.

**Range requests are load-bearing.** 206 Partial Content is implemented by hand in
`utils/httpRange.js` and shared by `/api/audio/output.mp3` and the background-bed preview.
Without it the seek bar cannot work on a multi-hour file, and the per-track scrubber in the
background picker cannot start a bed from its middle — a browser will only seek into a
response the server will serve a range of. Don't replace it with `res.sendFile`, and don't
drop `Accept-Ranges` from the preview. Measured against the real endpoint: after seeking to
the centre of a cached bed, Chrome plays 11.4s of audio in 12s of wall clock at
`readyState=4`, matching `res.sendFile` (12.1s).

**There are three TTS engines behind one dispatcher.** `ttsEngine.js` routes by the `engine`
field on a voice; `engines/piper.js`, `engines/supertonic.js` and `engines/kokoro.js` each
expose `installed()` / `listVoices()` / `synthesize()`. Adding a fourth means one new file
plus an entry in `ENGINES`. Voice ids are namespaced (`supertonic-M5`, `kokoro-af_heart`) so
an id alone routes. Every voice also carries `bestFor` and `speedFactor`, which the Voice
Library UI shows — keep populating them.

- **Kokoro** (28 voices, Apache-2.0, 24kHz) is the quality pick but the slowest: **1.63x
  realtime at fp32**. Counter-intuitively fp32 is ~2x *faster* than q8 here — int8 kernels
  lose to float on CPUs without VNNI. Weights live in `backend/kokoro/models/` because
  transformers.js otherwise caches inside `node_modules`, where a reinstall deletes 310MB.
  Its voice table is hardcoded in the engine (the embeddings are inside the model, so there
  is nothing to scan); it is checked against `tts.voices` on load and warns on drift.

- **Piper** spawns `piper.exe` per chunk → hard-killable, so cancel is instant.
- **Supertonic** runs in-process via `onnxruntime-node`, loading ~380MB of ONNX models
  **once** per server lifetime (a `enginePromise` singleton) rather than per chunk. There is
  no child process to kill, so cancel lands at the next chunk boundary — `generate.js` passes
  `jobStore.isCancelled` down for that, and `supertonic.js` also checks it after the model
  load. Bounded by one chunk; verified working.
- Supertonic outputs **44.1kHz**, so those books encode at the full 192 kbps MP3 while Piper's
  16–22.05kHz books clamp to 160k. Don't "fix" either — both are correct for their source.

**What counts as a usable bed is specified, not a matter of taste.** Joshua's rule (2026-09-02):
the bed has to disappear under the narration — no vocals, drums, beats, melodic hooks, swells,
cinematic or orchestral scoring, lofi or jazz; flat, steady volume start to finish; "the room
the listener is sitting in, not a performance". What is wanted instead is a sustained drone
(tanpura, shruti box, singing bowl), very sparse distant piano, pure nature ambience, deep-space
texture, or long-held string tones. This lives in three places and all three have to agree: the
`terms` and `tags` on every profile in `mood.js`, the rule list in the Gemini prompt in
`gemini.js`, and the filters in `soundtrack.js` — `sungLikely` hard-rejects anything whose title
reads as sung (every provider, not just ccMixter), and `rankForNarration` scores calm words up
and drum/beat/melody words down so the closest matches sort first. Don't reintroduce
`cinematic ambient` / `orchestral underscore` style terms; they were removed for breaking this.

**The background picker's scrubber runs off `requestAnimationFrame`**, like the reader's word
highlight, and only moves state when the position has changed by 50ms. `TrackRow` and `Scrubber`
are `memo`ised and **only the playing row is handed a live position** — give all twelve rows a
live position, or a fresh `onSeek` arrow per render, and the whole list re-renders ~20x/second.
That starved the media clock badly enough that a seeked bed advanced 1 second in 20; the same
seek plays in realtime once the memo actually holds.

**Background music is mixed in the existing single ffmpeg pass, not a second one.** When a bed
is selected, `mergeWavsToMp3` switches from `audioFilters` to a `complexFilter` graph built by
`buildBackgroundGraph`. The order in that graph is load-bearing:

```
[0:a] mono, resample, highpass, acompressor, asplit  -> [v][vkey]
[1:a] mono, resample, volume=<level>dB, fade in/out  -> [bed]
[bed][vkey] sidechaincompress                        -> [ducked]
[v][ducked] amix=duration=first:normalize=0          -> [mixed]
[mixed] loudnorm, aresample                          -> out
```

- **`loudnorm` moved to the end, onto the mix.** Normalising the voice alone and then adding a
  bed would push the delivered file past its target. Measured: narration sits at −16.8 dB with
  and without a bed, so adding music does not change how loud the voice is.
- **`sidechaincompress` is what makes it listenable** — the bed is keyed off the voice, so it
  drops while words are spoken and recovers between them. Measured 6.1 dB of duck (−38.2 dB
  under speech, −32.1 dB released). A flat bed fights the narration; don't remove this.
- **`amix` must carry `duration=first` and `normalize=0`.** `duration=first` ends the file with
  the narration even though the bed input is `-stream_loop -1` (verified: identical duration
  with and without a bed — an infinite loop would otherwise never end). `normalize=0` stops
  amix halving both inputs.
- The bed is looped rather than stretched, and faded `BACKGROUND_FADE_SEC` at each end.

**Audio quality is a pipeline, and the order is load-bearing.**

```
preprocessText → splitIntoChunks → per chunk: TTS → wavProcessor.processChunk
              → one ffmpeg pass: concat → highpass → acompressor → loudnorm → aresample → MP3
```

- `textCleaner.preprocessText()` runs at **generation time only**, so the Text Preview keeps
  showing the book as extracted. It is a **13-step pipeline and the order is load-bearing** —
  the step list is in the docblock above the function. It fixes ALL CAPS (`MAKER`→`Maker`,
  keeping real acronyms and roman numerals), expands symbols, and handles numbers **by
  context** — money as money, years as years (`1995`→`nineteen ninety-five`). Don't swap this
  for a blanket number-to-words library; that mispronounces every year and ordinal.
  Two ordering traps: standalone roman numerals must not be dropped before step 5, which
  needs the `I` in `Chapter\nI\nTitle`; and every punctuation-spacing regex uses `[ \t]`, not
  `\s`, because `\s` matches `\n` and would splice two lines together.
- **PDF text is broken in ways a regex alone can't fix.** `A L E TTE R BE F ORE WE BE GI N`
  has fragments of one, two and three letters, so it is repaired by *detecting* the line as
  broken (short, low mean token length, ≥2 short non-words, ≥50% unknown tokens), joining it,
  and re-splitting it — at lowercase→uppercase seams first (which is how
  `Kautilya'sArthashastra` becomes two words with no dictionary at all), then by dynamic
  programming over a word list. The list is `lexicon.js` (~1000 base forms plus morphology)
  **plus the book's own vocabulary**, harvested from every line ≥70 chars — long lines are
  body prose, where extraction gets spacing right, so the book supplies its own proper nouns.
  `backend/lexicon.txt` (optional, absent by default) is the escape hatch for names that
  appear only in headings. Don't hardcode book-specific terms anywhere else.
- **The repair is a heuristic with a known failure mode**: a short heading made entirely of
  names the book never uses in prose ("The Tao of Wu Wei") looks exactly like a broken line.
  The gates are tuned so a false positive needs all of those conditions at once. If it ever
  fires wrongly, the fix is `lexicon.txt`, not loosening the gates.
- `normaliseForSpeech()` flattens each chunk to a **single line**. This is the fix for first
  words vanishing: Piper reads stdin line by line and treats each line as its own utterance,
  so an internal `\n` silently broke the audio at every paragraph. It terminates a line with
  a full stop **only when the next line doesn't continue it** — a line ending mid-sentence is
  joined instead. Terminating unconditionally is what put a 1-2s silence inside sentences
  that extraction had wrapped ("The one that built the." / "modern financial world…").
- **Chunks are assembled from whole sentences and end on `.`/`!`/`?`.** `splitIntoChunks`
  never cuts inside a sentence — a sentence longer than the budget overshoots instead — and
  `ensureChunkEndsCleanly` replaces a trailing `,`/`;`/`:` so the engine finishes the phrase
  rather than trailing off into the inter-chunk silence.
- `wavProcessor.processChunk()` does levelling, fades and gap padding **in Node on raw PCM**,
  not via ffmpeg — a 200-chunk book would otherwise spawn ~400 extra processes. Measured
  effect: chunk-to-chunk RMS spread 1.41 dB → 0.09 dB, and peaks off 0 dBFS (raw Piper output
  really does hit full scale and clip).
- `loudnorm` resamples to 192kHz internally, so `buildFilterChain` appends
  `aresample=<source rate>`. **Without it every MP3 comes out 48kHz** regardless of voice.

**Voices are discovered, never hardcoded.** `ttsEngine.listVoices()` scans
`backend/piper/voices/` for `.onnx` files that have a matching `.onnx.json`, and parses
`locale-name-quality` out of the filename. The voice `id` is the full stem
(`en_US-ryan-high`), not just `ryan`, so two qualities of one voice can coexist. The spec's
sample code hardcodes `en_US-${voiceId}-medium.onnx`; that is wrong and was not followed.

**Piper speed is inverted.** `--length_scale` = `1 / speed`. Higher length scale is slower.

**Duration comes from WAV headers.** `audioMerger.readWavDuration()` parses the RIFF chunk
table rather than shelling out to ffprobe — one less binary to install. Verified accurate.

## Gotchas

- **Never use `req.on('close')` to detect a disconnect on `/api/generate`.** `express.json()`
  drains the request body before the handler runs, so `req` emits `'close'` **immediately**
  on every call — using it aborted every single generation. Use `res.on('close')` guarded by
  `!res.writableFinished`, which distinguishes "response fully sent" from "client hung up".
  This was a real bug; the comment in `generate.js` explains it at the call site.
- **This is a 4-core machine, and ONNX inference is CPU-bound.** Benchmarks vary by
  1.3–1.9× depending on what else is running — the identical Supertonic benchmark measured
  0.23×/0.42×/0.64× realtime idle and 0.44×/0.55×/0.82× with the dev servers busy. Never
  quote a single timing as authoritative without saying what else was running, and re-measure
  before concluding a change made something slower.
- **`onnxruntime-node` is pinned to exactly 1.21.0 and overridden tree-wide.** Supertonic
  loads it directly; Kokoro loads it through `@huggingface/transformers`, which depends on
  exactly 1.21.0. Two copies means two native bindings, and whichever engine loads second
  dies with *"The requested API version [29] is not available"* — it crashed the server the
  first time both were installed. Never relax that pin without testing both engines in one
  process.
- **Supertonic weights are OpenRAIL-M, not MIT.** Commercial use is allowed (Joshua monetises
  on YouTube) but there are attribution requirements and use-based restrictions. Piper's
  voices carry no such conditions. Mention this if he asks about publishing or licensing.
- **Chapter gaps and global silence-removal are mutually exclusive.** `CHAPTER_GAP_MS`
  inserts 2s between chapters; an ffmpeg `silenceremove` pass with a 2s threshold would strip
  exactly those gaps. Silence is trimmed per chunk at the edges only — don't add a global one.
- **`CHUNK_GAP_MS` is 80, not 150.** Chunk boundaries land between sentences, where the voice
  has already left a pause of its own; the padding stacks on top of that, and at 150ms it read
  as a stall mid-paragraph. The gap only has to keep the join from sounding clipped. Note this
  is a Node-side pad in `wavProcessor.processChunk`, not an ffmpeg `apad` — there is no
  `audioProcessor.js` in this repo.
- **Supertonic inference is serialised** by a promise queue in `engines/supertonic.js`.
  Generation and both preview endpoints share one loaded ONNX session, so concurrent
  `tts.call()`s would race. Piper is unaffected (a process per call).
- **Only ever add a music source whose licence is unambiguous, because Joshua monetises.**
  Every provider is either CC0 (Freesound, Openverse), CC BY (ccMixter, credit surfaced in the
  UI with a copy button), or an explicit commercial licence. **The Internet Archive was
  evaluated and rejected**: fast and keyless, but its audio carries mixed and often missing
  licences — a sample returned CC BY-NC-ND, which is non-commercial *and* no-derivatives, and
  mixing a bed into narration is a derivative work. That is a copyright claim waiting to happen.
- **`PIXABAY_API_KEY` does not work and never did.** Pixabay's public API covers images and
  videos only. `/api/audio/` looked real because it answers 400 "invalid key" while a bogus
  path 404s — but with a *valid* key it answers **403 Access denied**. The provider is kept in
  the chain in case they open it up; it is not a source today. Don't re-recommend it.
- **Music providers are a cascade, not a choice** (`providerChain`): Pixabay → Freesound →
  ccMixter → Openverse, first one with results wins. This exists because every free music API
  tested was down or blocked at some point during one afternoon. Never collapse it back to a
  single provider.
- **Openverse is rate-limited without an account and goes down for hours.** It worked, then
  timed out for the rest of the session. It is last in the chain for that reason.
- **ccMixter needs two non-obvious things.** Its response headers exceed undici's 16KB cap, so
  `fetch` fails with `UND_ERR_HEADERS_OVERFLOW` — it is fetched through `node:https` with
  `maxHeaderSize` raised instead, which is what `requestJson` is for. And its CDN hotlink-blocks
  downloads with 403 unless a **`Referer`** header is sent; a browser User-Agent alone does not
  help, and the honest UA plus a Referer does. Both were found the hard way.
- **ccMixter's `file_filesize` is a display string, not a number.** It reads `" (6.52MB)"`, so
  `Number()` gives NaN and every track came back as `0` seconds — which leaves the picker's
  scrubber with no duration to scrub. The real length is `file_format_info.ps` (`"5:07"`), with
  `file_rawsize` (actual bytes) as the fallback. With real durations the 15s–900s filter finally
  applies to ccMixter results at all.
- **Search by tag for ccMixter, by phrase for the rest.** Its API matches user tags, so a phrase
  like "soft strings underscore" returns nothing. Each mood profile carries a `tags` list for
  tag-based providers; `searchTracks(terms, tags)` picks per provider via `byTag`.
- **ccMixter results are filtered for vocals.** It is a remix community, so most uploads are
  songs — anything tagged vocals/lyrics/rap/choir is dropped and instrumentals sort first. A
  vocal track under narration is unusable.
- **Gemini model names go stale.** `gemini-2.5-flash` started returning 404 "no longer available
  to new users"; the API's own error names the replacement. Trust that message over anything
  written here, and update `geminiModel` in `env.js`.
- **`backend/nodemon.json` exists for a reason: do not delete it, and never widen its watch.**
  nodemon's defaults watch the whole backend folder for `js,mjs,cjs,json` — and read-aloud
  writes a `.json` sidecar beside every narrated chunk under `audio/read/`. That restarted the
  dev server on **every chunk**, killing the in-flight response (`ECONNRESET` at the Vite
  proxy), dropping the SSE stream, and wiping the in-memory read plan, so the client re-posted
  the book and the next chunk restarted it again. It reads as "the voice hangs". The config
  watches only `src` and `.env`.
- **Read-aloud needs an engine faster than realtime, and one isn't.** Piper `low` (0.16×) and
  `medium` (0.25×) and Supertonic stay well ahead of playback; Piper `high` (0.97×) is marginal;
  **Kokoro at 1.63× cannot keep up** and will stall between chunks — it renders a chunk slower
  than the chunk takes to speak, so no amount of prefetching rescues it. The bar shows
  "preparing the next part…" while it waits. Generate the MP3 instead for Kokoro.
- **Voice previews bypass the job slot deliberately.** `/api/preview` spawns Piper without
  registering the child in `jobStore`, so previewing works during a generation and a cancel
  can never kill a preview (or vice versa). Samples are cached at
  `audio/previews/{voice}-{speed}.wav` — first play ~7s, cached ~0.2s.
- **MP3 bitrate clamps to 160k.** Piper outputs 16–22.05kHz, so MP3 uses MPEG-2 Layer III,
  which maxes out at 160 kbps. Requesting 192k is silently reduced by ffmpeg. Expected, not
  a bug — don't "fix" it by resampling.
- **`strictPort: true` in the Vite config is deliberate.** Without it Vite silently falls
  forward onto 3001 when 3000 is taken and collides with the backend, which is maddening to
  debug. Leave it on.
- **Killing dev servers can leave orphans.** Stopping the runner doesn't always reap the
  nodemon/vite children on Windows. If a port is stuck:
  `netstat -ano | grep ":3000 "` then `taskkill //F //PID <pid>`.
- **`ffmpeg-static` downloads a binary on install** — the only step that needs the network
  besides voice downloads.
- **`epub2` pulls in a vulnerable `adm-zip`** (GHSA-xcpc-8h2w-3j85, no upstream fix). Low
  risk here: local tool, user-chosen files. Revisit if epub2 ever updates.
- **Piper and the voice models are gitignored** — hundreds of megabytes. A fresh clone must
  redo README steps 2 and 3.
- This is **not a git repo** yet (`git init` has not been run).

## Currently installed

**49 voices across three engines**, all verified to synthesize.

`backend/kokoro/` has the fp32 Kokoro-82M ONNX model (310MB, Apache-2.0) giving 28 voices
at 24kHz. Re-fetch with `npm run get:kokoro` (idempotent). The model author's own grades
run A down to F+ — only `af_heart` (A), `af_bella` (A-), `af_nicole` and `bf_emma` (B-) are
really lead-narration quality; most of the rest are C/D.

`backend/supertonic/` has the vendored MIT `helper.js` plus ~380MB of OpenRAIL-M ONNX
weights, giving 10 neural styles (**M1–M5, F1–F5**) at 44.1kHz. Re-fetch with
`npm run get:supertonic` (idempotent).

`backend/piper/` has a working Piper install plus **11 voices** (767MB): `amy-medium`, `danny-low`, `hfc_female-medium`, `joe-medium`, `kathleen-low`,
`lessac-high`, `ryan-high` (en_US) and `alan-medium`, `alba-medium`, `jenny_dioco-medium`,
`northern_english_male-medium` (en_GB).

**Generation speed scales hard with quality** — measured, not estimated: `low` runs at 0.16×
realtime, `medium` 0.25×, `high` 0.97×. A `high` voice is ~6× slower than `low` and takes
about a second of compute per second of audio. Relevant whenever advising on voice choice or
estimating a run. The README carries the full table.

Note: the spec's `en_GB-emma-medium` does not exist (404 on HuggingFace); `jenny_dioco`
fills the British Female slot.

---

## Working agreements

- Build complete, working code — **no `// TODO` placeholders**.
- Verify before reporting done: `npm run lint`, `npm run build`, and actually exercise the
  endpoint or UI path that changed. Report real output, including failures.
- Comment the non-obvious parts: Piper spawning, SSE lifecycle, Range handling.
- Keep `backend/.env.example` in sync when a config option is added.
- Preserve the error `code` contract — the frontend and the README troubleshooting table
  both depend on those messages.
