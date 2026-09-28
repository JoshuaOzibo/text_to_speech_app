# 📖 LocalAudioBook

Your offline audiobook studio. Upload a **PDF, TXT, or EPUB**, pick a voice, and get a
downloadable **MP3** — generated entirely on your own PC.

No API keys. No billing. No accounts. No internet needed after setup.

---

## How it works

```
Book file  →  text extraction  →  preprocess for speech  →  ~300-word chunks
                                                                  ↓
                                                          TTS (Piper / Supertonic)
                                                                  ↓
                                       per chunk: trim → level to -20 dBFS → fade → pad
                                                                  ↓
              MP3 download  ←  one ffmpeg pass: concat → highpass → compress → loudnorm
```

Progress streams back to the browser over Server-Sent Events while it runs, so you can
watch chunk-by-chunk progress and cancel at any point.

### Audio preparation

Raw TTS output is not publishable on its own, so the pipeline does real work either side of
the engine:

**Before speaking** — PDF extraction damages text in ways that are invisible on the page and
obvious in the ear, so the text is repaired first:

| What the PDF gives | What the engine is told to say |
|---|---|
| `A L E TTE R BE F ORE WE BE GI N` | `A Letter Before We Begin` |
| `HOW THI S BOOK I S ARRANGE D` | `How This Book Is Arranged` |
| `Kauti lya' s Arthas has tra` | `Kautilya's Arthashastra` |
| `Dana : The Science of Giving` | `Dana: The Science of Giving` |
| `Non - Attachment` | `Non-Attachment` |
| `Chapter` / `I` / `Why the West…` | `Chapter One. Why the West…` |
| `DharmaofWealth`, `◆◆` | *(dropped — running headers and ornaments)* |

Letter-spaced display type is rejoined and re-split against a dictionary built from the
book's own body text, so a title's proper nouns are recognised without configuring anything.
Add `backend/lexicon.txt` (one word per line) for names the book never spells out in prose.

Sentences broken across lines are rejoined — that line break was being read as a full stop,
which is what put a one to two second silence in the middle of a sentence. ALL-CAPS words
become normal case so `MAKER` isn't read out as M‑A‑K‑E‑R, while genuine acronyms (`NASA`,
`USA`) and roman numerals are left alone. Numbers are read by context: `$5.99` → "5 dollars
99 cents", `1995` → "nineteen ninety-five", `50%` → "50 percent", `3:30` → "three thirty".
URLs and email addresses are dropped. Each chunk is flattened to a single line — internal
newlines are what made the first word of every paragraph disappear.

The Text Preview still shows the book as extracted; only what the engine hears is rewritten.

**Reading aloud straight after an upload** — you do not have to generate the MP3 first. Open a
PDF, TXT or EPUB, press play in the bottom bar, and the book starts being read to you a few
seconds later (about four with a `low` voice). It narrates one small piece while preparing the
next, so it keeps going without ever building the whole file; the transport, the seek bar,
chapter skip and the word highlight all work exactly as they do for a finished MP3. The bar
shows a **LIVE** badge and an estimated total that sharpens as it goes.

Generating is still what you want for something to keep: it produces a single MP3 you can
download, seek through instantly and play anywhere. Reading aloud produces nothing on disk you
can take away — and it needs a voice that synthesizes faster than it speaks, so `low` and
`medium` Piper voices and Supertonic are comfortable while Kokoro is too slow and will pause
between pieces.

**Background music (optional)** — press Suggest in the Music panel and the app works out the
mood of the book, searches a royalty-free library, and lets you preview and pick a track. It is
**never mixed into the audiobook**: the exported MP3 is narration only, and the music is a
separate download, so you can lay it under your video yourself and keep control of the balance.
Both API keys are optional: without a Gemini key the mood is worked out on this machine, and
without a Pixabay key tracks come from Openverse (CC0). Narration itself never touches the
network — see Configuration.

**Following along** — as the book plays, the word being spoken is highlighted in the reader.
The timings are measured rather than guessed: every chunk's real duration comes from its
audio, and the pauses inside it (~480 ms after a full stop, ~280 ms after a comma) are found
in the samples and pinned to the punctuation in the text. Between two of those anchors — five
to ten words — time is shared out by word length. The highlight is driven from an animation
frame rather than the `timeupdate` event, which fires too slowly to keep up with speech.

**After speaking** — every chunk is trimmed, levelled to a common −20 dBFS, given 50 ms
fades and an 80 ms gap (2 s between chapters). Then one ffmpeg pass concatenates, removes
rumble below 80 Hz, compresses gently, and applies EBU R128 loudness normalisation to
−16 LUFS before encoding. Chunks are assembled out of whole sentences and always end on a
full stop, and sentence splitting knows about `Mr.`, `3.14` and `J. R. R.`, so a chunk
boundary never lands mid-sentence.

Everything is tunable from `backend/.env` — see `.env.example`.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite 6 + Tailwind 4 (**TypeScript**) |
| Text editor | CodeMirror 6, so chapter headings render at their real size while you edit (loaded on demand) |
| Backend | Node.js + Express (**JavaScript**, ESM) |
| TTS | [Piper](https://github.com/rhasspy/piper) (executable), plus optional [Supertonic](https://github.com/supertone-inc/supertonic) and [Kokoro](https://github.com/hexgrad/kokoro) (in-process ONNX) — all local, CPU-only, free |
| Parsing | `pdf-parse`, `epub2`, plain `fs` for TXT |
| Audio | `fluent-ffmpeg` + `ffmpeg-static` |
| Uploads | `multer` |
| Progress | Server-Sent Events |

---

## Setup

### Requirements

- Windows 10/11 (Piper binaries also exist for macOS and Linux)
- Node.js v18 or higher — https://nodejs.org
- That's it. `ffmpeg` installs automatically via `ffmpeg-static`.

### 1. Install dependencies

```bash
npm run install:all
```

### 2. Install Piper TTS

Download **`piper_windows_amd64.zip`** from the Piper releases page:

https://github.com/rhasspy/piper/releases/latest

Extract it so that `piper.exe` and its DLLs sit **directly inside** `backend/piper/`:

```
backend/piper/
├── piper.exe                 ← the executable itself, not a nested folder
├── espeak-ng.dll
├── onnxruntime.dll
├── piper_phonemize.dll
├── espeak-ng-data/
└── voices/                   ← voice models go here (next step)
```

> The zip contains a `piper/` folder — copy its **contents** into `backend/piper/`,
> not the folder itself. `backend/piper/piper/piper.exe` will not be found.

### 3. Download at least one voice

Each voice is **two files** — the model and its `.json` config. Both must go into
`backend/piper/voices/`, and both must keep their original filenames.

| Voice | Files |
|---|---|
| **Danny** — Casual American Male *(low, ~63MB, fastest)* | [.onnx](https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/danny/low/en_US-danny-low.onnx) · [.onnx.json](https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/danny/low/en_US-danny-low.onnx.json) |
| **Amy** — Clear American Female *(medium)* | [.onnx](https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx) · [.onnx.json](https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json) |
| **Ryan** — Deep American Male *(high, best quality)* | [.onnx](https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/high/en_US-ryan-high.onnx) · [.onnx.json](https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/high/en_US-ryan-high.onnx.json) |
| **Lessac** — Natural American Female *(high, best quality)* | [.onnx](https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/high/en_US-lessac-high.onnx) · [.onnx.json](https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/high/en_US-lessac-high.onnx.json) |
| **Kathleen** — Warm American Female *(low)* | [.onnx](https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/kathleen/low/en_US-kathleen-low.onnx) · [.onnx.json](https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/kathleen/low/en_US-kathleen-low.onnx.json) |
| **Joe** — Smooth American Male *(medium)* | [.onnx](https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/joe/medium/en_US-joe-medium.onnx) · [.onnx.json](https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/joe/medium/en_US-joe-medium.onnx.json) |
| **Alan** — British Male *(medium)* | [.onnx](https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx) · [.onnx.json](https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx.json) |
| **Alba** — Scottish Female *(medium)* | [.onnx](https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alba/medium/en_GB-alba-medium.onnx) · [.onnx.json](https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alba/medium/en_GB-alba-medium.onnx.json) |
| **Northern English Male** *(medium)* | [.onnx](https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/northern_english_male/medium/en_GB-northern_english_male-medium.onnx) · [.onnx.json](https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/northern_english_male/medium/en_GB-northern_english_male-medium.onnx.json) |
| **Jenny Dioco** — British Female *(medium)* | [.onnx](https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/jenny_dioco/medium/en_GB-jenny_dioco-medium.onnx) · [.onnx.json](https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/jenny_dioco/medium/en_GB-jenny_dioco-medium.onnx.json) |
| **HFC Female** — Bright American Female *(medium)* | [.onnx](https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx) · [.onnx.json](https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx.json) |

> The spec's table lists an `en_GB-emma-medium` voice — that path returns 404 on
> HuggingFace and the voice does not exist. Jenny Dioco covers the same British Female
> role.

Browse every available voice at
[huggingface.co/rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices/tree/main/en).

**Quality vs. speed.** This is the single biggest decision for a long book. Measured on this
machine, generating one 308-word chunk:

| Quality | Speed | Time per **hour of finished audio** | A ~60,000-word book (~6½ hrs audio) |
|---|---|---|---|
| `low` | 0.16× realtime | ~10 min | **~1 hour** |
| `medium` | 0.25× realtime | ~15 min | **~1¾ hours** |
| `high` | 0.97× realtime | ~58 min | **~6½ hours** |

A `high` voice takes roughly **six times longer** than `low` — close to one second of
compute per second of audio. It sounds the best, but for a full-length book plan to leave it
running. `medium` is the sweet spot for most work; use `high` for short pieces or when the
narration quality really matters.

(Piper is CPU-only, so these scale with your processor. Nothing here uses the GPU.)

The dropdown is built by **scanning `backend/piper/voices/` at runtime**, so whatever you
drop in there shows up on the next page load — no config to edit.

### Browsing voices

The dropdown is for picking a voice you already know. To find one, click **See all voices**
above it: the Voice Library lists every installed voice grouped by engine, with a play
button to audition each one, a quality chip, a line on what it suits, and the measured cost
per hour of finished audio. Searching matches names, accents and use ("british", "long
books", "female").

### 3b. (Optional) Add Supertonic voices

[Supertonic](https://github.com/supertone-inc/supertonic) is a second, newer TTS engine —
a 99M-parameter ONNX model that runs in-process via `onnxruntime-node`. It ships ten preset
styles (**M1–M5, F1–F5**) and outputs **44.1kHz** audio, which is why Supertonic books get a
true 192 kbps MP3 while Piper books cap at 160 kbps.

```bash
npm run get:supertonic
```

That downloads ~380MB of weights into `backend/supertonic/assets/`. Restart the backend and
the voices appear in the dropdown under **Supertonic (neural, 44.1kHz)**.

**Licensing matters here.** The inference code is MIT, but the model weights are
**OpenRAIL-M** — commercial use (including monetised YouTube) *is* permitted, but the licence
carries attribution requirements and use-based restrictions (no impersonation without
consent, no harmful use). Piper's voices are MIT-licensed with no such conditions. If you'd
rather not track licence obligations on published videos, stay with Piper.

**Speed.** Supertonic quality/speed is controlled by `SUPERTONIC_STEPS` (denoising steps).
Measured on this 4-core machine with a 300-word chunk, on an otherwise idle system:

| `SUPERTONIC_STEPS` | Speed | Notes |
|---|---|---|
| `2` | 0.23× realtime | comparable to Piper `medium` |
| `4` *(default)* | 0.42× realtime | balanced |
| `8` | 0.64× realtime | upstream default, best quality |

These roughly **double** when other apps are competing for CPU — ONNX inference is
CPU-bound and this is a 4-core box. Close what you can before a long run.

### 3c. (Optional) Add Kokoro voices

[Kokoro](https://github.com/hexgrad/kokoro) is an 82M-parameter model with **28 built-in
voices** (American and British, both genders) at 24kHz. Both the code and the weights are
**Apache-2.0** — unlike Supertonic there are no attribution conditions to track when
publishing.

```bash
npm run get:kokoro
```

That downloads ~310MB into `backend/kokoro/models/`. Restart the backend and the voices
appear under **Kokoro (neural, Apache-2.0)**.

**Quality varies a lot, and the model's authors say so.** Each voice carries their own
grade, shown in the Voice Library:

| Grade | Voices | Use for |
|---|---|---|
| A / A− | `af_heart`, `af_bella` | Lead narration for a full book |
| B− | `af_nicole`, `bf_emma` | Strong long-form narration |
| C | `am_michael`, `am_puck`, `am_fenrir`, `bm_george`, `bm_fable`, … | Side characters, variety |
| D / F+ | `am_adam`, `am_santa`, `bf_lily`, … | Short lines and novelty only |

**Speed.** Kokoro is the slowest of the three engines — about **1.63× realtime**, i.e.
~1.6 hours of compute per hour of audio. Counter-intuitively `fp32` is roughly **twice as
fast** as the smaller `q8` build, because int8 kernels lose to float on CPUs without VNNI,
so fp32 is the default despite being a larger download. `npm run get:kokoro q8` gets the
92MB build if disk matters more than time (set `KOKORO_DTYPE=q8` to match).

### 4. Run it

```bash
npm run dev
```

Open **http://localhost:3000**.

---

## Commands

| Command | What it does |
|---|---|
| `npm run install:all` | Install dependencies for both packages |
| `npm run dev` | Run backend (:3001) and frontend (:3000) together |
| `npm run dev:backend` / `dev:frontend` | Run just one half |
| `npm run build` | Type-check and build the frontend to `frontend/dist` |
| `npm start` | Run the backend alone (serves the built frontend when `NODE_ENV=production`) |
| `npm run lint` | Type-check the frontend |
| `npm run clean` | Delete build output and temp audio |

### Production

```bash
npm run build
NODE_ENV=production npm start
```

The backend then serves the API *and* the built frontend from
**http://localhost:3001** — one process, one port.

---

## API

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | Status plus whether Piper, ffmpeg, and voices are installed |
| `GET` | `/api/voices` | Voices from every installed engine, with labels and grouping |
| `GET` | `/api/preview?voice=&speed=` | Short WAV sample of one voice, cached per voice+speed |
| `POST` | `/api/preview-book` | Narrates only the first chunk of your book, so you can judge it before a full run |
| `GET` | `/api/preview/sample` | The paragraph used for previews |
| `POST` | `/api/clean-text` | Strips the title page and the trailing index, and adds a narrator intro and outro |
| `GET` | `/api/summary/providers` | The four summary providers, whether each is set up, and why not |
| `POST` | `/api/summary/plan` | Dry run of a summary: sections, word budgets, and how many parts are already saved |
| `POST` | `/api/summary` | Writes the summary. **Streamed NDJSON**: one progress event per line, then `done` or `error` |
| `GET` | `/api/result` | Metadata for the last MP3, so a reloaded page can recover it |
| `POST` | `/api/upload` | Multipart book file → extracted text, chapters, word count |
| `POST` | `/api/generate` | `{ text, voice, speed }` → generates the MP3 |
| `GET` | `/api/status` | **SSE** stream of generation progress |
| `POST` | `/api/cancel` | Kill the running Piper process and clean up |
| `GET` | `/api/audio/output.mp3` | Stream the MP3 (supports Range requests, so seeking works) |
| `GET` | `/api/download?name=Book` | Download the MP3 as an attachment |

---

## Configuration

Everything has a working default. To change anything, copy
`backend/.env.example` to `backend/.env`:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3001` | Backend port |
| `MAX_UPLOAD_MB` | `50` | Largest accepted book file |
| `WORDS_PER_CHUNK` | `300` | Text sent to Piper per chunk — lower gives finer progress |
| ~~`CLEANUP_DELAY_MINUTES`~~ | — | Removed 2026-09-12. Downloading no longer deletes the MP3; it is kept until the next generation replaces it |
| `MP3_BITRATE` | `192k` | MP3 encode bitrate (see note below) |
| `SUPERTONIC_STEPS` | `4` | Supertonic denoising steps, 1–10. Higher = better and slower |
| `KOKORO_DTYPE` | `fp32` | Kokoro model build. Must match what you downloaded |
| `SUMMARY_WORDS_PER_MINUTE` | `165` | Words a summary may use per requested minute. Below the voices' measured 180–187, so "30 minutes" lands under 30 |
| `ANTHROPIC_API_KEY` / `CLAUDE_MODEL` | — / `claude-opus-5` | Claude for summaries (`CLAUDE_API_KEY` also works) |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL` | — / `deepseek-chat` | DeepSeek for summaries |
| `OLLAMA_URL` / `OLLAMA_MODEL` | `http://127.0.0.1:11434` / first pulled | A local model for summaries; nothing leaves the PC |

> **Note on bitrate:** Piper outputs 16–22.05kHz audio, which MP3 encodes as MPEG-2
> Layer III — a format that caps at **160 kbps**. Requesting 192k is silently clamped to
> 160k by ffmpeg. That is expected and loses nothing: 160 kbps is well beyond transparent
> for mono speech at that sample rate. Supertonic outputs 44.1kHz, so Supertonic books do
> encode at the full 192 kbps.

---

## Clean with AI

The **Clean with AI** button in the text editor does three things in one press:

1. **Strips the title page** — copyright, ISBN, "all rights reserved", the table of
   contents. This already happened invisibly at generation time; the button makes it
   visible so you can check it, and stops an `ISBN 978-…` line showing up as a chapter.
2. **Strips the back matter** — the trailing Index, About the Author, Bibliography or
   Acknowledgements. Nothing else in the app did this: every other cleaning step scans the
   book from the top down, so a section at the *end* survived and got narrated.
3. **Adds a narrator introduction and closing** — "Welcome to *title* by *author*…" and
   "That concludes…".

**Only step 3 uses the network, and only for a ~4,000 character excerpt.** The book itself
never leaves your machine. With no `GEMINI_API_KEY` the intro falls back to a standard
template and steps 1 and 2 still run — the button never fails for want of a key.

Everything it does goes through the editor's normal undo, so **Undo cut** puts the text back
exactly, and nothing is written until you press Save. Pressing it twice is safe: it replaces
the narration rather than stacking a second copy.

> The back-matter cut refuses to run if the section it would remove contains a real chapter
> heading — that is what makes a final chapter titled "Notes" safe from a section of endnotes
> with the same name.

---

## Summaries

**Summarize** in the sidebar opens a page that turns the open book into a timed summary —
**30 minutes by default**, anything from 3 to 240 — with a spoken introduction and closing.
**Narrate this summary** then makes it the open book, so read-aloud, Preview, Test run,
Generate and Edit text all work on it; **Back to the full book** puts the original back.

- **Four providers:** Gemini, Claude, DeepSeek (cloud) and Ollama (runs on this PC). Each
  needs its own key or install; one that is not set up is greyed out and says why.
- **Two structures:** *Chapter by chapter* (default) keeps the book's own headings, each
  followed by its summary; *Continuous talk* is one flowing narrative with no headings.
- **Fits the length by construction.** Every part of the book gets words in proportion to
  its length, at 165 words per minute, and the introduction, closing and headings are
  counted. The summary can come in under the length; it cannot come in over it.
- **Written from the full text, then checked on this PC.** Every chapter is summarized
  from all of its text, not an excerpt. Afterwards every quotation is checked word for
  word against that chapter, every figure against that chapter, and every name against
  the whole book. A part that fails is sent back once with the problems listed; anything
  still unverified is highlighted on the page for you to fix.
- **Nothing is lost to a failure.** Each finished part is saved as it arrives. Cancel,
  a rate limit or a crash costs only the part in flight, and the button then reads
  *Continue: 12 of 40 parts saved*.
- **Check the title and author** on the page: they are spoken in the introduction, and a
  title guessed from a PDF's first page is often wrong. A file named
  `Title - Author.pdf` is read correctly.

**Privacy:** with Gemini, Claude or DeepSeek, the **whole book** is sent to that company
when you press Summarize, and at no other time. Ollama sends nothing anywhere. Narration
is local either way.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Piper TTS not found" | `piper.exe` must be at `backend/piper/piper.exe`, not in a nested folder |
| "No voices installed" | Download **both** files per voice into `backend/piper/voices/` |
| "Voice model not found" | The `.onnx.json` is missing — a voice needs both files |
| "This PDF appears to be scanned" | The PDF is images, not text. Run OCR on it first |
| "File is too large" | Raise `MAX_UPLOAD_MB` in `backend/.env` |
| Port 3000 or 3001 already in use | Another process has it. The dev server now fails loudly rather than silently switching ports |
| Generation feels slow | Use a `low` or `medium` voice; `high` voices are several times slower |
| "A generation is already running" | Shouldn't happen now — a run is abandoned automatically when the browser disconnects, and any live run shows in the UI with a Cancel button. If it ever sticks, restart the backend |
| First voice preview is slow | Expected: the sample is synthesised on first play, then cached. Later previews are instant |
| Reading aloud stalls between pieces | The voice is being synthesised slower than it speaks. The backend log names the culprit: `chunk N took longer than it plays … realtime=1.43x`. Switch to a `low` or `medium` Piper voice, or generate the MP3 instead |
| `http proxy error: /api/read/… ECONNRESET` in the frontend terminal | The backend restarted mid-request. If it repeats on every chunk, something is making nodemon watch `backend/audio/` — check `backend/nodemon.json` still limits the watch to `src` and `.env` |
| "Could not get music from openverse" | Openverse is rate-limited without an account and is often slow. Add a free `PIXABAY_API_KEY` to `backend/.env` |
| Downloading a track is slow | Freesound serves at ~75 KB/s here, so a 5-minute track can take ~90s. Choosing it first caches it; raise `BACKGROUND_DOWNLOAD_TIMEOUT_MS` in `backend/.env` if it times out |
| "The voice produced only … of audio for … words" (`SYNTH_TOO_SHORT`) | The engine is dropping text rather than speaking it, and the run stops on the first chunk instead of wasting hours. Nothing on disk is deleted. Try a different voice, or lower `WORDS_PER_CHUNK` in `backend/.env`, then press Resume |
| A generated MP3 is silent for its first minute or two | Fixed in this version. Kokoro occasionally emits a single corrupt sample thousands of times full scale, and the levelling pass used to divide the whole chunk by it. Chunk audio is now clamped before it is measured; the log warns `sample(s) outside +/-1 were clamped` with the raw peak when it happens |
| Narration skips a list, a verse passage or a short exchange | Fixed in this version. The table-of-contents remover ran over the whole book and deleted any run of 6+ lines under 60 characters with no punctuation — which is a contents page at the front and an ordinary **list** anywhere else. It now only ever removes front matter. Use the **As narrated** toggle in the Text Preview to see exactly what is cut and why |
| A Kokoro book skips most of its text | Fixed in this version. Kokoro truncates at 512 tokens without raising an error, so a 300-word chunk spoke only its first ~82 words. Chunks are now split at sentence boundaries before synthesis. **Any Kokoro MP3 generated before this fix is missing most of its text and needs regenerating** |
| "Gemini's daily quota … is used up" (`LLM_QUOTA`) | The free tier of `gemini-3.6-flash` allows 20 requests a day — about two long summaries. It resets at midnight Pacific time. Use another provider, or enable billing on the Google project |
| "The Anthropic account is out of credit" | The Claude key works but the account has no balance. Add credit at console.anthropic.com |
| "Ollama isn't running on this PC" | Install Ollama, then `ollama pull qwen2.5:7b`. It must be running before you open the Summarize page |
| A summary stopped halfway | The finished parts are saved. Press Summarize again with the same settings; the button reads *Continue* and only the missing parts are written |
| "Pick N minutes or less" (`SUMMARY_TOO_LONG`) | A summary may be at most 60% of the book's length. Choose a shorter summary |
| Want to see what the server is doing | Set `LOG_LEVEL=debug` in `backend/.env`. Every request, synthesis and cache hit is timed, and anything running longer than 30 seconds reports itself while it waits |

---

## Project layout

```
.
├── backend/                    Express API (JavaScript, ESM)
│   ├── src/
│   │   ├── index.js            entry point
│   │   ├── app.js              express app + middleware
│   │   ├── config/env.js       config and path resolution
│   │   ├── routes/             upload, generate, status, cancel, audio, download, voices,
│   │   │                       read (stream the book aloud), health
│   │   └── utils/
│   │       ├── pdfParser.js    PDF text extraction
│   │       ├── epubParser.js   EPUB text extraction
│   │       ├── txtParser.js    TXT reading
│   │       ├── textCleaner.js  PDF damage repair, speech preprocessing, chapter detection
│   │       ├── lexicon.js      word lists behind the letter-spacing repair
│   │       ├── narrator.js     writes the spoken intro and outro around the book
│   │       ├── narrationMarkers.js  the fixed intro/outro lines, shared with textCleaner
│   │       ├── timeline.js     word timings, measured from pauses in the audio
│   │       ├── readStore.js    read-aloud chunk plan for the open book
│   │       ├── logger.js       levelled logging, request timing, stall watchdog
│   │       ├── mood.js         works out a book's mood locally, no network
│   │       ├── gemini.js       optional AI mood suggestion (plain fetch, no SDK)
│   │       ├── summaryPlan.js  sections, word budgets and request batches for a summary
│   │       ├── summaryCheck.js checks quotes, figures and names against the book
│   │       ├── summarizer.js   writes, corrects, caches and assembles a summary
│   │       ├── llm/            summary providers: gemini, claude, deepseek, ollama
│   │       ├── soundtrack.js   music search, download and the chosen track
│   │       ├── ttsEngine.js    engine dispatcher + chunking + voice scanning
│   │       ├── engines/
│   │       │   ├── piper.js        spawns piper.exe per chunk
│   │       │   ├── supertonic.js   in-process ONNX, models loaded once
│   │       │   └── kokoro.js       in-process ONNX via kokoro-js
│   │       ├── audioMerger.js  WAV concat, voice filters, MP3 encode
│   │       ├── jobStore.js     job state + SSE broadcast
│   │       └── cleanup.js      temp file management
│   ├── nodemon.json            dev watch limited to src/ — audio/ must not trigger restarts
│   ├── piper/                  Piper binary + voices/ (downloaded during setup)
│   ├── supertonic/             vendored MIT helper.js + assets/ (downloaded)
│   ├── kokoro/                 Kokoro ONNX model (downloaded)
│   ├── uploads/                temp uploads, cleared automatically
│   └── audio/                  temp WAV chunks, read-aloud cache, and the output MP3
├── frontend/                   React + Vite + Tailwind (TypeScript)
│   └── src/
│       ├── App.tsx             three-panel shell + player bar, owns all state
│       ├── index.css           every design token, declared in @theme
│       ├── components/         AppHeader, Sidebar, ReadingPanel, ControlsPanel,
│       │                       PlayerBar, FileUploader, VoicePicker, VoiceLibrary,
│       │                       SpeedControl, ProgressBar, DownloadButton,
│       │                       StatusMessage, BackgroundPicker, SummaryPage, Logo
│       ├── hooks/              useAudioGeneration, useSSEProgress, useReadAloud
│       ├── lib/                api.ts (typed client), voice.ts (display helpers),
│       │                       wordClock.ts (time → word being spoken)
│       └── types.ts
├── scripts/dev.mjs             runs both dev servers
├── audiobook-app-spec.md       the original build spec
└── CLAUDE.md                   context for Claude Code
```

## Privacy

Narration never leaves your machine. The book is parsed locally, every TTS engine runs
locally, ffmpeg runs locally, and the MP3 is written to your own disk.

Three optional buttons use the network, and only when pressed: **Suggest music** and
**Clean with AI** send a few thousand characters of the book to Google, and **Summarize**
with Gemini, Claude or DeepSeek sends the **whole book** to that provider. Summarize with
Ollama sends nothing. Without any keys, the app never contacts an AI service at all.
