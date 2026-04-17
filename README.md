# Tellaflow

Offline speech-to-text for desktop. Hold a hotkey, speak, release — your words appear wherever your cursor is. Powered by [OpenAI Whisper](https://github.com/openai/whisper) running locally via [whisper.cpp](https://github.com/ggerganov/whisper.cpp).

## Features

- **Push-to-talk transcription** — hold your hotkey (default: Option ⌥), speak, release. Text is pasted into the focused app.
- **Fully offline** — all processing happens on-device. No data leaves your machine.
- **Multiple Whisper models** — ships with `small` (465 MB). Download `tiny`, `base`, `medium`, or `large-v3` from the app with pause/resume support.
- **Grammar correction** — optional on-device grammar cleanup via [SmolLM2-135M-Instruct](https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct) (GGUF, ~105 MB). Disabled by default; enable in Settings.
- **Snippets** — define trigger phrases that expand into longer text (e.g. "my email" → `you@example.com`).
- **Custom dictionary** — map misheard words to correct ones based on your accent or domain vocabulary.
- **Transcription history** — browse, copy, and delete past transcriptions grouped by date.
- **Light & dark themes** — follows your preference or the system setting.
- **Floating toast** — a small pill-shaped indicator with an 8-bit waveform animation appears near your cursor while recording.
- **Programming mode** — biases the model toward technical vocabulary.

## Requirements

- macOS 12+ or Windows 10+
- Node.js 18+ and npm (for development)
- Xcode Command Line Tools (`xcode-select --install`)

## Getting Started

```bash
git clone <repo-url> && cd whisper-studio-app
npm install
npm run dev
```

`npm install` runs a postinstall script that rebuilds native addons (`better-sqlite3`, `whisper-node-addon`, `uiohook-napi`) for Electron and fixes dynamic library paths.

The dev command starts the Vite dev server and launches Electron with hot-reload for the renderer.

### First launch

On first run the app shows an onboarding flow:

1. **Welcome** — overview of how Tellaflow works.
2. **Hotkey** — choose your push-to-talk key (default: Option ⌥).
3. **Permissions** — grant Microphone and Accessibility access. In the packaged app, this is a single "Tellaflow" entry in System Settings → Privacy & Security → Accessibility. In development you grant two separate entries (`Electron` and `MacKeyServer`) — see [Accessibility in development](#accessibility-in-development) below.

> After granting Accessibility for the first time, macOS requires an app restart for the permission to take effect.

### Accessibility in development

The packaged `Tellaflow.app` is one signed bundle containing both the Electron main process **and** keyspy's native `MacKeyServer` helper (the binary that actually calls `CGEventTapCreate`). macOS treats the bundle as one TCC subject, so granting **Tellaflow** in System Settings → Privacy & Security → Accessibility authorizes both processes at once.

In `npm run dev`, those two processes live as separate binaries inside `node_modules/`:

| Binary | Path | Why it needs Accessibility |
|--------|------|----------------------------|
| `Electron.app` | `node_modules/electron/dist/Electron.app` | The main process calls `systemPreferences.isTrustedAccessibilityClient`, which determines what the in-app Settings UI's "Accessibility" badge displays. |
| `MacKeyServer` | `node_modules/keyspy/runtime/MacKeyServer` | The actual binary that calls `CGEventTapCreate` to capture the global push-to-talk hotkey. |

Both must be added to System Settings → Privacy & Security → Accessibility **once**:

1. Open System Settings → Privacy & Security → Accessibility
2. Click `+`, press `Cmd+Shift+G`, paste the path above, click Open, toggle the new row ON
3. Repeat for the second binary

The `postinstall` script ad-hoc signs both binaries with deterministic CDHashes, so once you grant them, the permission persists across `npm install` cycles — you do not need to re-grant after every dependency update. The signing happens automatically on `npm install` / `yarn install` / `pnpm install`.

If you ever need to re-sign manually (e.g. after upgrading `electron` or `keyspy` to a new version):

```bash
npm run dev:sign
```

If grants get into a bad state (toggled ON in System Settings but the hotkey still does nothing, usually after a version bump that changed a CDHash), reset and re-grant:

```bash
# Clears only Electron's Accessibility grant — leaves other apps untouched
tccutil reset Accessibility com.github.Electron
```

`MacKeyServer` does not have a reverse-DNS bundle id (its codesign identifier is a content hash), so `tccutil reset` cannot target it. Remove it manually instead: open System Settings → Privacy & Security → Accessibility, click the `MacKeyServer` row, press the `–` button. Then re-add both binaries via the steps above.

> Avoid `tccutil reset Accessibility` with no argument — that wipes the Accessibility grant for **every** app on your Mac (Raycast, Cursor, Discord, etc.), not just Tellaflow's binaries.

> The Tellaflow Settings UI's "Accessibility: Granted" badge reflects only `Electron`'s TCC status. In dev that badge confirms grant #1 but cannot verify grant #2 — the only way to verify `MacKeyServer` is granted is to actually trigger the hotkey and confirm a recording starts.

## Project Structure

```
src/
├── main/                  # Electron main process (Node.js / CommonJS)
│   ├── index.js           # App entry, IPC handlers, recording lifecycle
│   ├── whisper.js         # Whisper model loading, transcription, warmup
│   ├── grammar.js         # SmolLM2 grammar correction (child process)
│   ├── grammar-worker.js  # Isolated worker for node-llama-cpp
│   ├── hotkey.js          # Global hotkey via uiohook-napi
│   ├── db.js              # SQLite database (better-sqlite3)
│   ├── config.js          # App settings CRUD
│   ├── history.js         # Transcription history CRUD
│   ├── dictionary.js      # Custom dictionary CRUD + application
│   ├── snippets.js        # Snippet expansion CRUD + application
│   ├── models.js          # Model download manager with pause/resume
│   ├── formatter.js       # Rule-based text formatting (lists, punctuation, fillers)
│   ├── audio-preprocess.js# Volume normalization + silence trimming
│   ├── permissions.js     # Permission checks and settings deep-links
│   ├── paste.js           # Clipboard write + Cmd+V via osascript
│   ├── main-window.js     # Main BrowserWindow
│   ├── onboarding.js      # Onboarding BrowserWindow
│   ├── toast.js           # Floating toast BrowserWindow
│   └── tray.js            # Menubar tray icon + context menu
├── preload/
│   └── index.js           # contextBridge API (window.tellaflow)
└── renderer/              # Vite + React + TypeScript
    ├── src/
    │   ├── App.tsx         # Root component with page routing
    │   ├── OnboardingApp.tsx # Carousel-style onboarding
    │   ├── ToastApp.tsx    # Floating recording indicator
    │   ├── components/
    │   │   ├── ui/         # shadcn/ui primitives (button, card, dialog, well, etc.)
    │   │   ├── home/       # Transcription history page
    │   │   ├── models/     # Model selection + download page
    │   │   ├── snippets/   # Snippet management page
    │   │   ├── dictionary/ # Dictionary management page
    │   │   ├── settings/   # General, permissions, data settings
    │   │   ├── layout/     # Sidebar navigation
    │   │   └── icons/      # Custom SVG icon components
    │   ├── hooks/          # React hooks (config, history, models, permissions, etc.)
    │   └── lib/            # Utilities (ipc types, theme, cn)
    ├── index.html          # Main window entry
    ├── onboarding.html     # Onboarding window entry
    ├── toast.html          # Toast window entry
    └── audio-capture.html  # Hidden window for MediaRecorder
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Electron |
| Renderer | React 19, TypeScript, Vite |
| Styling | Tailwind CSS v4, shadcn/ui |
| Animation | Framer Motion |
| Speech-to-text | whisper.cpp via @kutalia/whisper-node-addon (Metal GPU) |
| Grammar | node-llama-cpp with SmolLM2-135M-Instruct (GGUF) |
| Storage | SQLite via better-sqlite3 |
| Hotkey | uiohook-napi (global keyboard hook) |
| Packaging | electron-builder |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server + Electron |
| `npm run build` | Build renderer + package for current platform |
| `npm run build:mac` | Build renderer + package macOS `.app` |
| `npm run build:win` | Build renderer + package Windows installer (`nsis`, x64) |
| `npm run smoke:win` | Validate Windows build artifacts + key defaults |
| `npm run build:win:qa` | Build Windows installer and print smoke checklist path |
| `npm run build:renderer` | Build only the Vite renderer |
| `npm start` | Launch Electron directly (no dev server) |
| `npm run dev:sign` | Re-sign `Electron.app` and `MacKeyServer` for dev-mode Accessibility (runs automatically on `npm install`) |
| `npm run download-model` | Download a Whisper GGML model |
| `npm run test-wav` | Test transcription with a WAV file |

## Building for Distribution

```bash
npm run build
```

This builds the renderer with Vite, then packages the app with electron-builder. The output is in `dist/`. The bundled `small` Whisper model (~465 MB) is included as an extra resource.

Native addons (`whisper-node-addon`, `uiohook-napi`, `better-sqlite3`, `node-llama-cpp`) are unpacked from the asar archive so they can load at runtime.

### Windows QA pass

After creating a Windows build, run the smoke checklist in `docs/windows-installer-smoke-checklist.md`.

## Architecture Notes

**Audio pipeline:** Hotkey press → hidden `audio-capture.html` window starts `MediaRecorder` → hotkey release → PCM float32 sent to main process → silence trimming + volume normalization → whisper.cpp transcription → formatter → dictionary replacement → snippet expansion → (optional) grammar correction → clipboard + paste.

**Model management:** Models are downloaded to `~/Library/Application Support/tellaflow/models/` with HTTP range requests for pause/resume. The bundled `small` model lives in the app resources.

**Grammar isolation:** `node-llama-cpp` runs in a forked child process (`grammar-worker.js`) to avoid symbol conflicts with the Whisper native addon and to keep the main process responsive.

**Permissions:** Microphone is requested via Electron's `systemPreferences.askForMediaAccess`. Accessibility is checked with `isTrustedAccessibilityClient` and requires the user to manually toggle the app on in System Settings. A session-aware flag tracks whether accessibility was freshly granted to avoid restart loops.

## License

MIT
