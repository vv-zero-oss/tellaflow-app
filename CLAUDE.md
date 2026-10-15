# Tellaflow — notes for Claude

macOS menubar dictation app (Electron). Main process: `src/main/`, renderer
(React + Vite): `src/renderer/src/`, preload bridge: `src/preload/index.js`.
Transcription runs in a supervised worker process
(`src/main/transcription-worker.js` + `transcription-service.js`), never in
the main process.

## Rules

- **After building anything, show it working.** Run the real app or the real
  models (not just unit tests) and send the user screenshots of every UI you
  changed. Use the steps below; they work in a Linux cloud container.
- Before pushing: `npm run typecheck`, `npm test`, `npm run build:renderer`.
- Bump `package.json` `version` for releases. Releases are built by
  `.github/workflows/release.yml` (macOS 15 runner, signed + notarized).
  Dispatch it on `main` to create the `v<version>` tag and release.

## Running things locally (cloud container / Linux)

```bash
# deps without macOS-only postinstall steps
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --ignore-scripts
node node_modules/electron/install.js              # Electron binary
(cd node_modules/better-sqlite3 && npx prebuild-install --runtime electron --target "$(node -p "require('electron/package.json').version")")
npm i --no-save --ignore-scripts playwright-core   # to drive Electron

# models (Parakeet is the default engine; Whisper base.en is small)
npm run download-parakeet
curl -L -o resources/models/ggml-base.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
```

Test audio: YouTube blocks datacenter IPs ("sign in to confirm you're not a
bot"), so use public-domain audio from archive.org, e.g.
`https://archive.org/download/jfks19610525/jfk_1961_0525_moon_64kb.mp3`
(8 min) or a LibriVox chapter (45+ min). Convert to the format the app
writes: `ffmpeg -i in.mp3 -ac 1 -ar 16000 -map_metadata -1 -fflags +bitexact -c:a pcm_s16le out.wav`.

- **Real models, no Electron:**
  `node scripts/real-transcription-test.js short.wav long.wav [very-long.wav]`
  — real worker process + Whisper/Parakeet, long-file windowing, SIGKILL
  crash recovery, failed-job → retry-after-restart.
- **Full app + screenshots:**
  `xvfb-run -a node scripts/e2e-electron.mjs short.wav 45s.wav 30s-a.wav 30s-b.wav e2e-screenshots`
  — launches Electron with `TELLAFLOW_E2E=1` (test hook in `src/main/index.js`
  that feeds WAVs through the real `audio-captured` path), dictates, kills the
  worker mid-job, builds a meeting entry, runs the Assistant against the
  signed-in Claude CLI, and screenshots each page.
- **Assistant against a real AI:** `npm run test:assistant-e2e` (needs the
  `claude` CLI signed in; skipped otherwise).

macOS-only pieces (hotkey via keyspy, paste/AX/AppleScript via `osascript`,
meeting detection) log errors on Linux; everything else runs.
