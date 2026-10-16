# Tellaflow — notes for Claude

macOS menubar dictation app (Electron). Main process: `src/main/`, renderer
(React + Vite): `src/renderer/src/`, preload bridge: `src/preload/index.js`.
Transcription runs in a supervised worker process
(`src/main/transcription-worker.js` + `transcription-service.js`), never in
the main process.

The assistant (the command key) is canvas's Jarvis without the editor or a
voice: `src/main/jarvis/`. One warm hidden **bb** thread (`bb/` — supervisor,
client, `mascot-thread.js`, ported from canvas `electron/bb`) answers; its text
streams onto the island (`reply`/`ask` cards in `voice-island.tsx`); the
reply's ```mascot block is checked by `mascot-actions.js` (the allowlist) and
run by `mascot-dispatch.js` (the desktop tier's gates: Accessibility re-read
per action, password-field refusal, forced confirmations) through Peekaboo
(`desktop/`); desktop tasks continue as a loop verified by a fresh look
(`desktop-loop.js`). Bigger jobs go to a visible bb chat, which the Assistant
page frames. The assistant is **opt-in** (`assistantEnabled`, off by default;
the switch is Settings › General › Beta features): off, there is no command
key (`hotkey.setCommandKeyGate`), no Assistant page, no Assistant tab in
Settings, no Screen Recording permission row or onboarding ask, no menubar
"Ask the assistant" item, and nothing of bb's on disk. On but not downloaded,
the command key shows a "Download the assistant first" notice
(`commandKeyNotReady`). Neither bb nor its Node ships in the app — switched
on, Settings › Assistant offers one **Download** (`jarvis/runtime.js`): a pinned,
checksummed Node plus `npm ci` of `resources/assistant-runtime`'s lockfile on
that Node (so native prebuilds match it), staged and verified, into
`<userData>/tools/assistant`; on a Mac Peekaboo comes with it. bb runs on that
Node, never inside Electron and never on the user's PATH. Bumping bb means
bumping `BB_APP_VERSION` and regenerating that lockfile
(`npm install --package-lock-only` in it); an installed copy then reads as
"outdated" and offers Update. Files ported verbatim keep
canvas's names so they diff cleanly against it; canvas's tests for them are in
`tests/main/ported/`.

Settings is tabbed (`SettingsPage.tsx` `SETTINGS_TABS`: General, Dictation,
Meetings, Assistant, Permissions, Data & privacy, About). Main links to a tab
with `sendToMainWindow('navigate', 'settings/<tab>')` (the menubar's
Shortcuts/Microphone items open `settings/dictation`).

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
npm i --no-save --ignore-scripts playwright-core   # to drive Electron (re-run after any npm install/uninstall)
# the assistant's Node + bb, as Settings › Download installs them (optional:
# the e2e downloads its own; point the app at this copy to skip that)
node scripts/install-assistant.js /tmp/tf-assistant && export TELLAFLOW_ASSISTANT_RUNTIME_DIR=/tmp/tf-assistant

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
  worker mid-job, builds a meeting entry, asks the assistant (real bb + the
  signed-in Claude CLI), and screenshots each page.
- **Assistant, full app + real AI + screenshots:**
  `xvfb-run -a node scripts/e2e-assistant.mjs e2e-assistant` — first the setup
  through the real UI (off by default → switch on → Download, a real install
  into a throwaway folder); then the app starts real bb (throwaway data dir,
  ports 38986/7) on the Node it downloaded; answers,
  a desktop task against a pretend TextEdit (`TELLAFLOW_E2E_DESKTOP=fake`,
  `scripts/e2e-fake-desktop.js` — Peekaboo is macOS-only), a forced
  confirmation declined, a hand-off to a chat, the Assistant page and
  Settings; then Remove and switching off again. Needs `claude` signed in. In the cloud container bb reports Claude
  Code "unauthenticated" (it reads the keychain/`~/.claude/.credentials.json`
  shape a Mac login writes) but runs it when named — the script names
  `claude-code` (`E2E_PROVIDER`).
- **The assistant's island states:**
  `xvfb-run -a node scripts/e2e-island-assistant.mjs` — every assistant view
  (asking, reply short/long/streaming, steps, hand-off, confirmations with
  long payloads, questions with long options, install/sign-in/accessibility
  cards) with layout-breaking content; fails if a card leaves the window or
  anything overflows. No AI needed. Island text follows `--island-text-*` /
  `--island-weight-body` / `--island-leading-body`: labels are 600 at 1.15,
  reading text 450 at 1.45, and a long block scrolls inside the card with
  faded edges — never grows past the window.
- **The menubar menu:**
  `xvfb-run -a -s "-screen 0 1280x800x24" node scripts/e2e-tray.mjs short.wav e2e-tray`
  — the menu built by `src/main/tray-menu.js` (Paste Last Transcript + ⌃⌘V,
  Shortcuts, Microphone, Language), popped up on the main window and captured
  with ImageMagick `import` (Linux has no menubar). Radio items in a submenu
  must stay contiguous: a separator splits the group and Electron then checks
  the lone item.
- **bb's theme** follows the app: the Assistant page reads its own computed
  shadcn tokens and main injects them into bb's frame
  (`src/main/jarvis/bb/bb-chrome.js`, `assistant-style-frame`); the e2e checks
  bb's background equals the page's card colour in dark and light.
- **Real Peekaboo / Accessibility / Screen Recording** need a Mac with the
  grants — not runnable in the container.

macOS-only pieces (hotkey via keyspy, paste/AX/AppleScript via `osascript`,
meeting detection) log errors on Linux; everything else runs.
