# Pending UI changes — apply when no generation is running

These files fix the reloaded page showing nothing while a generation is in
flight. They are staged **here** rather than in `frontend/src` on purpose: Vite
watches `frontend/`, and a hot update can remount `useAudioGeneration`, whose
unmount cleanup runs

```ts
useEffect(() => () => abortRef.current?.abort(), []);
```

That aborts the open `POST /api/generate`. The backend treats a client hangup as
a **cancel**, and cancel is the one path that deletes every finished chunk. So
applying these while a run is going can cost the whole run.

## Apply

Only once the MP3 is finished and downloaded (or you are happy to lose the run):

```bash
cd c:/Users/user/Desktop/text_to_speech_app
bash pending-ui/apply.sh
```

It copies five files into `frontend/src` and then runs `npm run lint`.

## What changes

| file | change |
|---|---|
| `lib/bookStore.ts` | **new** — keeps the open book in IndexedDB so a reload restores it |
| `lib/autoDownload.ts` | **new** — saves the MP3 to the downloads folder the moment it exists, once per file |
| `App.tsx` | loads the saved book on mount, saves it whenever it changes, auto-downloads the finished MP3 |
| `hooks/useSSEProgress.ts` | reports whether the server has answered yet, with a 60s give-up |
| `hooks/useAudioGeneration.ts` | exposes `isCheckingServer` — "we have not heard back", distinct from idle |
| `components/ControlsPanel.tsx` | shows "Checking whether a generation is already running…" instead of the Generate button while unknown |

Nothing in `backend/` is touched.

## Why the page looked dead

Two things, neither of them a lost run:

1. `jobStore.subscribe()` does replay the current state to every new subscriber —
   measured returning `{"status":"generating","progress":12,"chunk":160,"totalChunks":912}`.
   But it took **28.5 seconds** to arrive, because Piper has both cores and
   Express barely gets scheduled. A plain `GET /api/voices` took 12.3s in the
   same conditions. Until that first frame lands, `progress.status` is `idle`,
   so `isGenerating` is false and the panel renders the normal idle UI.
2. The book lived only in React state, so a reload came back with an empty
   reader and no way to show what was being generated.

## Note

Restoring the book means `useReadAloud` re-plans it on load — one
`POST /api/read/plan`, about 1.2s of server CPU for a 260,000-word book. That is
the same cost as having the book open normally; it just now happens after a
reload too.
