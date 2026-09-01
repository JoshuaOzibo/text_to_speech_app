# 📖 LocalAudioBook — Full App Specification

> Written for Claude Opus to understand, plan, and build completely.

---

## 🎯 Project Goal

Build a **local web application** that runs entirely on the user's PC (no internet required after setup). The app allows the user to:

1. Upload a book file (PDF, TXT, EPUB)
2. Extract the full text from the file
3. Select an AI voice from a dropdown
4. Play the book aloud in the app (with playback controls)
5. Download the full audio as an MP3 file

**Everything must be free. No API keys. No billing. No subscriptions. No internet required after setup.**

---

## 👤 Who Is Building This

- Developer: Joshua Ozibo
- Background: HND Computer Science, React + Node.js frontend/backend developer
- Purpose: To create audiobook content for a YouTube channel
- Device: Windows PC
- Comfort level: Comfortable with React, Node.js, npm, terminal commands

---

## 🏗️ App Architecture

### Stack

| Layer | Technology | Reason |
|-------|-----------|--------|
| Frontend | React (Vite) | Joshua's primary frontend stack |
| Backend | Node.js + Express | Joshua's primary backend stack |
| TTS Engine | Piper TTS (Windows executable) | Free, local, high-quality, called via Node child_process |
| PDF Parsing | pdf-parse (npm) | Best free Node.js PDF text extractor |
| EPUB Parsing | epub2 (npm) | Free EPUB parser for Node.js |
| Audio Joining | fluent-ffmpeg (npm) + ffmpeg binary | Joins WAV chunks and converts to MP3 |
| File Uploads | multer (npm) | Handles multipart file uploads in Express |
| Real-time Progress | Server-Sent Events (SSE) | Push progress updates from Node to React |

### How Piper TTS Works With Node.js

Piper TTS is a standalone Windows `.exe` file. Node.js calls it using `child_process.spawn()`:

```js
const { spawn } = require('child_process');

// Piper reads text from stdin, outputs WAV to stdout
const piper = spawn('./piper/piper.exe', [
  '--model', `./voices/${voiceModel}`,
  '--output_file', outputWavPath,
  '--length_scale', String(1.0 / speed) // speed control
]);

piper.stdin.write(textChunk);
piper.stdin.end();

piper.on('close', (code) => {
  // WAV chunk is ready
});
```

### Folder Structure

```
audiobook-app/
├── server/
│   ├── index.js              # Express entry point
│   ├── routes/
│   │   ├── upload.js         # POST /api/upload
│   │   ├── generate.js       # POST /api/generate
│   │   ├── download.js       # GET /api/download
│   │   ├── voices.js         # GET /api/voices
│   │   └── status.js         # GET /api/status (SSE)
│   ├── utils/
│   │   ├── pdfParser.js      # PDF text extraction
│   │   ├── epubParser.js     # EPUB text extraction
│   │   ├── txtParser.js      # TXT text extraction
│   │   ├── textCleaner.js    # Fix letter spacing, clean text
│   │   ├── ttsEngine.js      # Piper TTS wrapper
│   │   └── audioMerger.js    # Join WAV chunks, export MP3
│   ├── uploads/              # Temp uploaded book files
│   ├── audio/                # Temp generated audio files
│   └── piper/
│       ├── piper.exe         # Piper TTS Windows binary
│       └── voices/           # Voice model files (.onnx + .json)
│           ├── en_US-amy-medium.onnx
│           ├── en_US-amy-medium.onnx.json
│           ├── en_US-ryan-high.onnx
│           ├── en_US-ryan-high.onnx.json
│           └── ... (more voice models)
├── client/                   # React app (Vite)
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   ├── components/
│   │   │   ├── FileUploader.jsx
│   │   │   ├── VoiceSelector.jsx
│   │   │   ├── SpeedControl.jsx
│   │   │   ├── AudioPlayer.jsx
│   │   │   ├── ProgressBar.jsx
│   │   │   ├── TextPreview.jsx
│   │   │   ├── StatusMessage.jsx
│   │   │   └── DownloadButton.jsx
│   │   ├── hooks/
│   │   │   ├── useAudioGeneration.js
│   │   │   └── useSSEProgress.js
│   │   └── styles/
│   │       └── index.css
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── package.json              # Root package.json (runs both server + client)
├── .env                      # Environment variables
└── README.md                 # Full setup guide
```

---

## 🖥️ Frontend UI — What It Should Look Like

### Design Vibe

- Dark theme (deep navy/charcoal background)
- Clean, minimal, book-like aesthetic
- Large readable typography
- Feels like a personal desktop tool, not a SaaS product
- Smooth transitions and loading states

### Layout — Single Page React App

```
┌─────────────────────────────────────────────┐
│         📖 LocalAudioBook                   │
│         Your offline audiobook studio       │
├─────────────────────────────────────────────┤
│                                             │
│   [ Upload File ]  ← drag & drop or click   │
│   Supports: PDF, TXT, EPUB                  │
│   "Why the West Got Money Wrong.pdf" ✓      │
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│   Voice:  [ Dropdown ▾ select voice ]       │
│                                             │
│   Speed:  ──────●────── [ 1.0x ]            │
│           0.5x                  2.0x        │
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│   [ 🎙 Generate Audio ]                     │
│                                             │
│   Generating... ██████░░░░░░  45%           │
│   Processing chunk 9 of 20...               │
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│   [ ▶ Play ]  [ ⏸ Pause ]  [ ⏹ Stop ]      │
│                                             │
│   ●───────────────────────────  02:14       │
│                                             │
│   Chapter 2 of 12: Why Money Matters        │
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│   [ ⬇ Download MP3 ]                        │
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│   📄 Text Preview (scroll)                  │
│   ┌───────────────────────────────────────┐ │
│   │ Why the West Got Money Wrong          │ │
│   │ And to the reader who carries a       │ │
│   │ faint, persistent guilt about         │ │
│   │ wanting prosperity at all...          │ │
│   └───────────────────────────────────────┘ │
│                                             │
└─────────────────────────────────────────────┘
```

### React Components Breakdown

#### `FileUploader.jsx`

- Drag and drop zone
- Click to open file browser
- Accepts: `.pdf`, `.txt`, `.epub`
- Shows filename + file size after upload
- Calls `POST /api/upload` on file select
- Shows error if wrong file type

#### `VoiceSelector.jsx`

- Dropdown populated from `GET /api/voices`
- Shows voice name + accent/gender label
- Default: first voice in list

#### `SpeedControl.jsx`

- Range slider from 0.5 to 2.0, step 0.1
- Shows current speed value (e.g. "1.0x")
- Updates in real time as slider moves

#### `AudioPlayer.jsx`

- Uses HTML5 `<audio>` element under the hood
- Custom styled Play / Pause / Stop buttons
- Seek bar (click to jump to position)
- Current time + total duration display
- Audio source: streamed from `/api/audio/output.mp3`

#### `ProgressBar.jsx`

- Shows generation progress (0–100%)
- Connected to SSE stream from `/api/status`
- Shows current chunk being processed
- Disappears when generation is done

#### `TextPreview.jsx`

- Scrollable panel showing extracted book text
- Highlights current sentence being spoken (optional)
- Lets user verify text was extracted correctly

#### `StatusMessage.jsx`

- Single line at bottom of UI
- Shows current app state:
  - "Upload a file to get started"
  - "Extracting text..."
  - "Generating audio — chunk 4 of 18..."
  - "Audio ready! Press Play or Download."
  - "Error: Could not extract text from this PDF."

#### `DownloadButton.jsx`

- Disabled until audio is generated
- On click: triggers download of MP3 from `/api/download`
- Shows file size when ready

---

## 🎙 Voice Options (Piper TTS)

Piper voice models are free `.onnx` files downloaded from the official Piper releases.
The voice dropdown must include these voices (all free, all English):

| Voice ID | Model File | Description |
|----------|-----------|-------------|
| amy | en_US-amy-medium | Clear American Female |
| kathleen | en_US-kathleen-low | Warm American Female |
| lessac | en_US-lessac-high | Natural American Female (best quality) |
| ryan | en_US-ryan-high | Deep American Male (best quality) |
| danny | en_US-danny-low | Casual American Male |
| joe | en_US-joe-medium | Smooth American Male |
| emma | en_GB-emma-medium | British Female |
| alba | en_GB-alba-medium | Scottish Female |
| alan | en_GB-alan-medium | British Male |
| northern_english | en_GB-northern_english_male-medium | Northern British Male |

All voice model files (.onnx + .onnx.json) are downloaded once during setup from:
`https://huggingface.co/rhasspy/piper-voices`

The README must include direct download links for each voice file.

---

## ⚙️ Backend — Express API Endpoints

### `POST /api/upload`

- Uses **multer** to accept multipart file upload
- Detects file type from extension
- Calls appropriate parser (pdfParser, epubParser, txtParser)
- Runs text through textCleaner (fix letter spacing etc.)
- Detects chapters from headings
- Returns:

```json
{
  "success": true,
  "text": "Full extracted text here...",
  "chapters": [
    { "index": 0, "title": "Introduction", "wordCount": 450 },
    { "index": 1, "title": "Chapter 1: Why Money Matters", "wordCount": 1200 }
  ],
  "wordCount": 42000,
  "estimatedMinutes": 140,
  "filename": "why-the-west.pdf"
}
```

### `POST /api/generate`

- Accepts:

```json
{
  "text": "Full book text...",
  "voice": "ryan",
  "speed": 1.0
}
```

- Splits text into chunks of ~300 words
- For each chunk: calls Piper TTS via child_process, saves as WAV
- Sends real-time progress via SSE (`/api/status`)
- After all chunks done: merges WAVs into one file using fluent-ffmpeg
- Converts merged WAV to MP3 at 192k bitrate
- Returns:

```json
{
  "success": true,
  "audioUrl": "/api/audio/output.mp3",
  "duration": 8420
}
```

### `GET /api/download`

- Streams the generated MP3 file to browser as download
- Sets headers: `Content-Disposition: attachment; filename="audiobook.mp3"`
- After streaming: schedules file cleanup (delete temp files after 5 mins)

### `GET /api/voices`

- Reads available `.onnx` files from `server/piper/voices/` folder
- Returns list of available voices with labels:

```json
{
  "voices": [
    { "id": "ryan", "label": "Ryan — Deep American Male", "quality": "high" },
    { "id": "lessac", "label": "Lessac — Natural American Female", "quality": "high" }
  ]
}
```

### `GET /api/status`

- Server-Sent Events (SSE) endpoint
- Pushes progress updates during generation:

```json
{ "status": "generating", "progress": 45, "chunk": 9, "totalChunks": 20 }
{ "status": "merging", "progress": 90 }
{ "status": "done", "progress": 100 }
{ "status": "error", "message": "Piper failed on chunk 4" }
```

### `GET /api/audio/output.mp3`

- Streams the generated MP3 for in-browser playback
- Supports HTTP Range requests (so the HTML5 audio player can seek)

---

## 📄 File Parsing Logic (Node.js)

### PDF Files — `pdfParser.js`

```js
const pdfParse = require('pdf-parse');
const fs = require('fs');

async function parsePDF(filePath) {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);
  let text = data.text;
  text = fixLetterSpacing(text);
  text = cleanText(text);
  const chapters = detectChapters(text);
  return { text, chapters };
}
```

### EPUB Files — `epubParser.js`

```js
const epub = require('epub2');

async function parseEPUB(filePath) {
  const book = await epub.createAsync(filePath);
  let fullText = '';
  for (const chapter of book.flow) {
    const content = await book.getChapterRawAsync(chapter.id);
    // Strip HTML tags
    const text = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    fullText += text + '\n\n';
  }
  return { text: fullText, chapters: detectChapters(fullText) };
}
```

### TXT Files — `txtParser.js`

```js
const fs = require('fs');

function parseTXT(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const chapters = detectChapters(text);
  return { text, chapters };
}
```

### Text Cleaner — `textCleaner.js`

MUST fix ALL of these common PDF problems:

```js
function fixLetterSpacing(text) {
  // Fix "W h y  t h e  W e s t" → "Why the West"
  return text.replace(/\b([A-Za-z] ){2,}[A-Za-z]\b/g, (match) => {
    return match.replace(/ /g, '');
  });
}

function cleanText(text) {
  return text
    .replace(/\f/g, '\n')           // form feeds → newlines
    .replace(/\r\n/g, '\n')         // normalize line endings
    .replace(/[ \t]+/g, ' ')        // collapse spaces
    .replace(/\n{3,}/g, '\n\n')     // max 2 blank lines
    .replace(/^\d+\s*$/gm, '')      // remove lone page numbers
    .trim();
}

function detectChapters(text) {
  const lines = text.split('\n');
  const chapters = [];
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    // Detect chapter headings: short lines, all caps, or starts with "Chapter"
    if (
      (trimmed.length > 3 && trimmed.length < 80) &&
      (trimmed === trimmed.toUpperCase() || /^chapter\s+\d+/i.test(trimmed))
    ) {
      chapters.push({ title: trimmed, lineIndex: i });
    }
  });
  return chapters;
}
```

---

## 🎵 TTS Engine — Piper Integration (`ttsEngine.js`)

```js
const { spawn } = require('child_process');
const path = require('path');

const PIPER_EXE = path.join(__dirname, '../piper/piper.exe');
const VOICES_DIR = path.join(__dirname, '../piper/voices');

function generateChunkAudio(text, voiceId, speed, outputWavPath) {
  return new Promise((resolve, reject) => {
    const modelPath = path.join(VOICES_DIR, `en_US-${voiceId}-medium.onnx`);
    // Note: Piper speed is controlled by length_scale (inverse of speed)
    const lengthScale = String(1.0 / speed);

    const piper = spawn(PIPER_EXE, [
      '--model', modelPath,
      '--output_file', outputWavPath,
      '--length_scale', lengthScale,
      '--sentence_silence', '0.3'
    ]);

    piper.stdin.write(text, 'utf8');
    piper.stdin.end();

    piper.stderr.on('data', (data) => {
      // Piper logs to stderr — this is normal, not an error
      console.log('Piper:', data.toString());
    });

    piper.on('close', (code) => {
      if (code === 0) resolve(outputWavPath);
      else reject(new Error(`Piper exited with code ${code}`));
    });

    piper.on('error', reject);
  });
}

// Split text into ~300 word chunks (respecting sentence boundaries)
function splitIntoChunks(text, wordsPerChunk = 300) {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const chunks = [];
  let current = '';
  let wordCount = 0;

  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/).length;
    if (wordCount + words > wordsPerChunk && current) {
      chunks.push(current.trim());
      current = sentence;
      wordCount = words;
    } else {
      current += ' ' + sentence;
      wordCount += words;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

module.exports = { generateChunkAudio, splitIntoChunks };
```

---

## 🔗 Audio Merging — `audioMerger.js`

```js
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static'); // or path to downloaded ffmpeg
const path = require('path');
const fs = require('fs');

ffmpeg.setFfmpegPath(ffmpegPath);

function mergeWavsToMp3(wavFiles, outputMp3Path) {
  return new Promise((resolve, reject) => {
    // Write a concat list file for ffmpeg
    const listFile = path.join(path.dirname(outputMp3Path), 'concat_list.txt');
    const listContent = wavFiles.map(f => `file '${f}'`).join('\n');
    fs.writeFileSync(listFile, listContent);

    ffmpeg()
      .input(listFile)
      .inputOptions(['-f concat', '-safe 0'])
      .audioCodec('libmp3lame')
      .audioBitrate('192k')
      .output(outputMp3Path)
      .on('end', () => {
        fs.unlinkSync(listFile); // cleanup list file
        resolve(outputMp3Path);
      })
      .on('error', reject)
      .run();
  });
}

module.exports = { mergeWavsToMp3 };
```

---

## 📡 Real-Time Progress with SSE

The frontend connects to SSE as soon as generation starts:

```js
// React — useSSEProgress.js hook
import { useEffect, useState } from 'react';

export function useSSEProgress(isGenerating) {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('idle');
  const [chunk, setChunk] = useState({ current: 0, total: 0 });

  useEffect(() => {
    if (!isGenerating) return;
    const eventSource = new EventSource('/api/status');

    eventSource.onmessage = (e) => {
      const data = JSON.parse(e.data);
      setProgress(data.progress);
      setStatus(data.status);
      if (data.chunk) setChunk({ current: data.chunk, total: data.totalChunks });
      if (data.status === 'done' || data.status === 'error') {
        eventSource.close();
      }
    };

    return () => eventSource.close();
  }, [isGenerating]);

  return { progress, status, chunk };
}
```

---

## 📦 Setup & Installation

The README must include ALL of these steps clearly:

### Requirements

- Windows 10 or 11
- Node.js v18 or higher (nodejs.org)
- npm (comes with Node.js)
- ffmpeg (for audio merging + MP3 export)

### One-Time Setup

```bash
# 1. Clone or download the project folder

# 2. Install all Node.js dependencies
npm install

# 3. Install ffmpeg
# Option A: npm package (easiest)
npm install ffmpeg-static

# Option B: Download manually from https://ffmpeg.org/download.html
# Extract and add ffmpeg.exe to PATH

# 4. Download Piper TTS binary for Windows
# Go to: https://github.com/rhasspy/piper/releases/latest
# Download: piper_windows_amd64.zip
# Extract piper.exe into: server/piper/piper.exe

# 5. Download voice models (pick at least 2-3)
# Go to: https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_US
# For each voice, download BOTH files:
#   - en_US-ryan-high.onnx
#   - en_US-ryan-high.onnx.json
# Place all voice files into: server/piper/voices/

# Direct download links for recommended voices:
# Ryan (Male, High Quality):
#   https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/high/en_US-ryan-high.onnx
#   https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/high/en_US-ryan-high.onnx.json
#
# Lessac (Female, High Quality):
#   https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/high/en_US-lessac-high.onnx
#   https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/high/en_US-lessac-high.onnx.json
#
# Amy (Female, Medium Quality):
#   https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx
#   https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json

# 6. Start the app
npm run dev

# 7. Open browser and go to:
# http://localhost:3000
```

### package.json Scripts

```json
{
  "scripts": {
    "dev": "concurrently \"npm run server\" \"npm run client\"",
    "server": "nodemon server/index.js",
    "client": "vite client/",
    "build": "vite build client/",
    "start": "node server/index.js"
  }
}
```

---

## ⚡ Performance Requirements

- App must handle books up to **500 pages** without crashing
- Text extraction must complete in under **10 seconds**
- Audio generation will take time for long books (roughly 2–5 mins for a full book) — show **real-time progress**
- Allow user to **cancel** generation mid-way (kill the Piper child_process)
- Generated audio files must be **cleaned up** after download (save disk space)
- App must run smoothly on **8GB RAM Windows PC, no GPU required**
- Piper TTS is CPU-only — no CUDA/GPU needed

---

## 🎨 Styling Guidelines

Use Tailwind CSS (via CDN or Vite plugin) or plain CSS with these tokens:

```css
:root {
  --bg-base: #0f1117;
  --bg-surface: #1a1d27;
  --bg-card: #22253a;
  --accent: #6c63ff;
  --accent-hover: #5a52e0;
  --text-primary: #e8e8f0;
  --text-secondary: #8888aa;
  --success: #4ade80;
  --error: #f87171;
  --warning: #facc15;
  --border: #2e3148;
  --radius-card: 12px;
  --radius-btn: 8px;
  --font-ui: 'Inter', sans-serif;
  --font-reader: 'Lora', Georgia, serif;
}
```

- Import Inter and Lora from Google Fonts
- Use `--font-reader` only in the text preview panel
- Buttons: solid purple on primary, ghost (border only) on secondary
- Hover states on all interactive elements
- Smooth transitions: `transition: all 0.2s ease`
- Progress bar: animated fill with `--accent` color
- Loading spinner on generate button while processing

---

## ✅ Features Checklist

Claude Opus must build ALL of the following — no placeholders:

### Backend (Node.js + Express)

- [ ] Express server on port 3000 (or configurable via .env)
- [ ] `POST /api/upload` — file upload with multer
- [ ] PDF text extraction with pdf-parse
- [ ] EPUB text extraction with epub2
- [ ] TXT file reading
- [ ] Letter-spacing fix and full text cleaning
- [ ] Chapter detection algorithm
- [ ] `POST /api/generate` — triggers TTS generation
- [ ] Piper TTS called via child_process for each text chunk
- [ ] Text splitting into ~300 word chunks at sentence boundaries
- [ ] WAV chunks merged into single file via fluent-ffmpeg
- [ ] WAV to MP3 conversion at 192k bitrate
- [ ] `GET /api/status` — SSE endpoint for real-time progress
- [ ] `GET /api/download` — streams MP3 as download
- [ ] `GET /api/voices` — returns available voice models
- [ ] `GET /api/audio/output.mp3` — streams audio for in-browser playback
- [ ] Cancel generation endpoint `POST /api/cancel`
- [ ] Temp file cleanup after download
- [ ] Error handling for all edge cases

### Frontend (React + Vite)

- [ ] FileUploader component with drag-and-drop
- [ ] VoiceSelector dropdown (populated from API)
- [ ] SpeedControl slider (0.5x–2.0x)
- [ ] Generate button with loading state
- [ ] ProgressBar connected to SSE
- [ ] AudioPlayer with Play/Pause/Stop + seek bar
- [ ] Chapter indicator
- [ ] TextPreview scrollable panel
- [ ] DownloadButton (disabled until audio ready)
- [ ] StatusMessage component
- [ ] useSSEProgress custom hook
- [ ] useAudioGeneration custom hook
- [ ] Error state UI (wrong file type, corrupt PDF, etc.)
- [ ] Dark theme matching design tokens above
- [ ] Fully responsive layout
- [ ] Smooth transitions and loading states

### Project Files

- [ ] `package.json` with all dependencies and scripts
- [ ] `vite.config.js` with proxy to backend (`/api` → `localhost:3000`)
- [ ] `.env.example` file
- [ ] Complete `README.md` with setup steps and voice download links
- [ ] `.gitignore` (ignore node_modules, uploads/, audio/, piper/)

---

## ❌ Hard Constraints

- **NO** paid APIs — everything free
- **NO** internet calls during use (after initial setup)
- **NO** Python — pure Node.js + React stack
- **NO** ElevenLabs, OpenAI, or any cloud TTS service
- **NO** database — stateless per session
- **NO** user accounts or login
- **NO** Electron — runs in the browser at localhost
- Piper TTS binary + voice models are the ONLY external files needed

---

## 🧯 Error Handling Requirements

| Scenario | Expected Behavior |
|----------|-----------------|
| Wrong file type uploaded | Show error: "Only PDF, TXT, and EPUB files are supported" |
| Image-only PDF (no extractable text) | Show warning: "This PDF appears to be scanned. Text could not be extracted." |
| Piper EXE not found | Show error: "Piper TTS not found. Please follow setup instructions in README." |
| Voice model file missing | Show error: "Voice model not found. Download it using the link in README." |
| Book text is empty after extraction | Show error: "No readable text was found in this file." |
| Generation cancelled by user | Clean up temp files, reset UI to ready state |
| ffmpeg not found | Show error: "ffmpeg not found. Install it using: npm install ffmpeg-static" |
| File too large (>50MB) | Show error: "File is too large. Maximum size is 50MB." |

---

## 📝 Final Notes for Claude Opus

- Build **complete, working code** for every single file — absolutely no placeholders like `// TODO` or `// implement this`
- Include **all imports and requires** at the top of every file
- Write **inline comments** explaining key logic (especially Piper spawning and SSE)
- The UI must look **genuinely polished** — Joshua will use this professionally for YouTube content creation
- The most critical feature is **reliable MP3 download** — make sure this works perfectly before anything else
- The second most critical feature is **real-time progress** — long books take time and the user needs feedback
- Handle the **vite proxy** correctly so React dev server forwards `/api` calls to Express
- Make sure **CORS** is configured on Express for localhost development
- The `server/piper/` folder will be empty in the repo — README must tell user exactly what to download and where to put it
- Voice model filenames must match exactly what the API returns from `/api/voices` — scan the actual folder, don't hardcode
- Test that the audio player can **seek** (requires Range request support on the streaming endpoint)

---

*Spec written by Claude Sonnet 4.6 — August 2026*
*Stack: React (Vite) + Node.js (Express) + Piper TTS*
*Build target: Claude Opus 4.6*
