# Tellaflow

Offline speech-to-text for macOS. Hold a hotkey, speak, release — your words appear wherever your cursor is. Powered by [OpenAI Whisper](https://github.com/openai/whisper) running locally via [whisper.cpp](https://github.com/ggerganov/whisper.cpp).

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

- macOS 12+ (Apple Silicon recommended for Metal GPU acceleration)
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
3. **Permissions** — grant Microphone and Accessibility access. Accessibility requires toggling the app ON in System Settings → Privacy & Security → Accessibility. During development the entry appears as "Electron".

> After granting Accessibility for the first time, macOS requires an app restart for the permission to take effect.

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
│   ├── permissions.js     # macOS permission checks
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
| `npm run build` | Build renderer + package macOS `.app` |
| `npm run build:renderer` | Build only the Vite renderer |
| `npm start` | Launch Electron directly (no dev server) |
| `npm run download-model` | Download a Whisper GGML model |
| `npm run test-wav` | Test transcription with a WAV file |

## Building for Distribution

```bash
npm run build
```

This builds the renderer with Vite, then packages the app with electron-builder. The output is in `dist/`. The bundled `small` Whisper model (~465 MB) is included as an extra resource.

Native addons (`whisper-node-addon`, `uiohook-napi`, `better-sqlite3`, `node-llama-cpp`) are unpacked from the asar archive so they can load at runtime.

## Architecture Notes

**Audio pipeline:** Hotkey press → hidden `audio-capture.html` window starts `MediaRecorder` → hotkey release → PCM float32 sent to main process → silence trimming + volume normalization → whisper.cpp transcription → formatter → dictionary replacement → snippet expansion → (optional) grammar correction → clipboard + paste.

**Model management:** Models are downloaded to `~/Library/Application Support/tellaflow/models/` with HTTP range requests for pause/resume. The bundled `small` model lives in the app resources.

**Grammar isolation:** `node-llama-cpp` runs in a forked child process (`grammar-worker.js`) to avoid symbol conflicts with the Whisper native addon and to keep the main process responsive.

**Permissions:** Microphone is requested via Electron's `systemPreferences.askForMediaAccess`. Accessibility is checked with `isTrustedAccessibilityClient` and requires the user to manually toggle the app on in System Settings. A session-aware flag tracks whether accessibility was freshly granted to avoid restart loops.

## License

MIT
