# Natural Voice Assistant — Implementation Plan

## Overview

Add a conversational voice assistant to Tellaflow that runs **entirely offline** by default. The user holds a dedicated hotkey, speaks a command or question, and the assistant responds with synthesized speech — executing actions on the system.

**Core Architecture (4 layers):**

```
┌─────────────────────────────────────────────────────────┐
│  1. VOICE I/O                                            │
│     IN:  Whisper (existing) — local STT                  │
│     OUT: Pocket TTS (sherpa-onnx) — local speech output  │
├─────────────────────────────────────────────────────────┤
│  2. AGENT RUNTIME — ZeroClaw (Rust binary, subprocess)   │
│     Single compiled binary ships inside the .app         │
│     27 model providers, 80+ tools, voice built-in        │
│     OpenAI-compatible API at localhost:port               │
│     Model-agnostic: swap any model via config            │
├─────────────────────────────────────────────────────────┤
│  3. TOOLBOX (CUA)                                        │
│     Computer control: mouse, keyboard, screenshots,      │
│     window management, file system, accessibility        │
├─────────────────────────────────────────────────────────┤
│  4. INTEGRATIONS & SKILLS (ZeroClaw + OpenClaw)          │
│     ZeroClaw: 40+ channels, 80+ tools, WASM plugins     │
│     OpenClaw (optional): npm-based skill marketplace     │
│     Integrations page: connect apps (Slack, Discord,     │
│     Calendar, Notes, Reminders, Spotify, etc.)           │
└─────────────────────────────────────────────────────────┘
```

**What provides what:**
- **Whisper (existing)** — Voice input (STT)
- **Pocket TTS** (via sherpa-onnx) — Voice output (talks back to user)
- **ZeroClaw** (Rust binary) — Agent runtime, model routing, tool calling, 27 providers, voice wake
- **CUA** (`@trycua/computer`) — Toolbox for computer interaction (mouse, keyboard, screenshots)
- **OpenClaw** (optional, npm) — Extended skill marketplace + npm plugin ecosystem

### Why ZeroClaw over OpenClaw as primary runtime?

| Factor | ZeroClaw | OpenClaw |
|--------|----------|----------|
| **Ships as** | Single compiled binary (~20-50 MB) | 500+ npm modules + Node.js |
| **Electron integration** | Subprocess, talks via HTTP/WS | Native Node.js import (but heavy) |
| **Voice** | Built-in (TTS, STT, wake word, voice calls) | Via plugins only |
| **Performance** | Native Rust (microsecond overhead) | Node.js interpreted |
| **App size impact** | +50 MB binary | +200 MB node_modules |
| **Model providers** | 27 (comparable) | 30+ |
| **Channels** | 40+ | ~30 |
| **Tool calling** | 80+ tools + MCP client | Equivalent |

**Decision:** Use ZeroClaw as the subprocess agent runtime. It compiles to a single macOS binary that ships inside `Tellaflow.app/Contents/Resources/zeroclaw`. No extra runtime needed. OpenClaw remains available as optional npm-based skill marketplace for users who want its extension ecosystem.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         ELECTRON APP (Main Process)                        │
│                                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │  LAYER 1: VOICE I/O                                                  │  │
│  │                                                                       │  │
│  │  ┌──────────┐   ┌──────────────┐   ┌────────────────────────────┐   │  │
│  │  │ Hotkey   │──▶│ Audio Capture │──▶│ Whisper STT (existing)     │   │  │
│  │  │ (keyspy) │   │ (existing)   │   └─────────────┬──────────────┘   │  │
│  │  └──────────┘   └──────────────┘                 │                   │  │
│  │                                                    │                   │  │
│  │  ┌──────────────────────────┐   ┌────────────────┴───────────────┐  │  │
│  │  │ Audio Playback (Web API) │◀──│ Pocket TTS (sherpa-onnx-node)  │  │  │
│  │  └──────────────────────────┘   │ Kokoro-82M, 24kHz, streaming   │  │  │
│  │                                  └────────────────────────────────┘  │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │  LAYER 2: AGENT RUNTIME (ZeroClaw — compiled Rust binary)            │  │
│  │                                                                       │  │
│  │  Electron ──HTTP/WebSocket──▶ localhost:{port}                        │  │
│  │                                                                       │  │
│  │  ┌─────────────────────────────────────────────────────────────┐     │  │
│  │  │ ZeroClaw Gateway (single binary, ships in .app Resources)    │     │  │
│  │  │                                                              │     │  │
│  │  │  • 27 Model Providers (local + cloud, swap via config)       │     │  │
│  │  │  • 80+ Tools (file, browser, memory, git, search, etc.)      │     │  │
│  │  │  • Tool calling + function calling (OpenAI-compatible API)    │     │  │
│  │  │  • Session management + context compaction                    │     │  │
│  │  │  • Security sandbox (tool allowlists)                         │     │  │
│  │  │  • MCP client (Model Context Protocol)                        │     │  │
│  │  │  • Voice wake + voice call channels (built-in)                │     │  │
│  │  └─────────────────────────────────────────────────────────────┘     │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │  LAYER 3: TOOLBOX (CUA — compiled Python binary)                     │  │
│  │                                                                       │  │
│  │  ZeroClaw ──WebSocket──▶ localhost:{port} ──▶ CUA Server             │  │
│  │                                                                       │  │
│  │  ┌────────┐ ┌──────────┐ ┌────────────┐ ┌───────────────────────┐   │  │
│  │  │ Mouse  │ │ Keyboard │ │ Screenshot │ │ Window Mgmt / Files   │   │  │
│  │  │ click  │ │ type     │ │ capture    │ │ open, close, resize   │   │  │
│  │  │ drag   │ │ hotkey   │ │ OCR read   │ │ list, read, write     │   │  │
│  │  │ scroll │ │ press    │ │            │ │ accessibility tree    │   │  │
│  │  └────────┘ └──────────┘ └────────────┘ └───────────────────────┘   │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │  LAYER 4: INTEGRATIONS & SKILLS                                      │  │
│  │                                                                       │  │
│  │  ┌─────────────────────────────┐  ┌────────────────────────────────┐│  │
│  │  │ INTEGRATIONS (40+ built-in) │  │ SKILLS (marketplace)            ││  │
│  │  │                             │  │                                  ││  │
│  │  │ • Slack        • GitHub     │  │ • Coding Assistant               ││  │
│  │  │ • Discord      • Linear     │  │ • Email Composer                 ││  │
│  │  │ • Telegram     • Notion     │  │ • Meeting Summarizer             ││  │
│  │  │ • WhatsApp     • Jira       │  │ • File Organizer                 ││  │
│  │  │ • Signal       • LinkedIn   │  │ • Web Researcher                 ││  │
│  │  │ • Calendar     • Spotify    │  │ • System Admin                   ││  │
│  │  │ • Apple Notes  • Bear       │  │ • Custom user skills             ││  │
│  │  │ • Reminders    • Email      │  │                                  ││  │
│  │  │ • iMessage     • Matrix     │  │ ZeroClaw WASM plugins (future)   ││  │
│  │  │ + 30 more via ZeroClaw      │  │ + OpenClaw npm skills (optional) ││  │
│  │  └─────────────────────────────┘  └────────────────────────────────┘│  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘

  BUNDLED BINARIES (inside Tellaflow.app/Contents/Resources/):
  ┌───────────────────────────────┐  ┌──────────────────────────────────┐
  │ zeroclaw (Rust binary ~20 MB) │  │ cua-server (PyInstaller ~50 MB)  │
  │ Agent runtime + gateway       │  │ Desktop control (macOS native)   │
  │ No Rust/Cargo needed          │  │ No Python needed                 │
  └───────────────────────────────┘  └──────────────────────────────────┘
```

---

## Layer Details

### Layer 1: Voice I/O
- **Input:** Existing Whisper STT (no changes needed)
- **Output:** Pocket TTS via `sherpa-onnx-node` (already installed for Parakeet)
- Handles: microphone capture, transcription, speech synthesis, audio playback

### Layer 2: Agent Runtime (ZeroClaw)

ZeroClaw is a **compiled Rust binary** that ships inside the app. Our Electron main process communicates with it via HTTP/WebSocket on localhost.

**How it works:**
1. On assistant activation → Electron spawns `zeroclaw gateway --bind loopback --port {port}`
2. Electron sends user transcript to `POST /api/chat/completions` (OpenAI-compatible)
3. ZeroClaw routes to configured provider (local llama.cpp, Ollama, OpenAI, Claude, etc.)
4. ZeroClaw handles tool calling loop internally (80+ built-in tools)
5. Response streams back to Electron → piped to TTS

**Why this is better than a custom Model Function:**
- ZeroClaw already implements 27 providers with failover, streaming, tool calling
- Session management + context compaction built-in
- No need to write `model-function.js` with 6 provider implementations
- Change model/provider via ZeroClaw config (no code changes)
- Security sandbox for tool execution built-in

```js
// src/main/assistant/zeroclaw-client.js
// Simple HTTP client — talks to the local ZeroClaw binary

async function query(transcript, tools) {
  const response = await fetch(`http://localhost:${port}/api/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.getAssistantModel(),  // e.g. "ollama/qwen3:4b" or "anthropic/claude-sonnet-4-6"
      messages: session.getMessages().concat({ role: 'user', content: transcript }),
      tools: tools,
      stream: true,
    }),
  });
  // Stream response chunks → TTS
  for await (const chunk of response.body) { /* ... */ }
}
```

### Layer 3: Toolbox (CUA)
- Computer control via CUA server (PyInstaller binary)
- **Bundled as a compiled binary** — no Python required on user's machine
- ZeroClaw calls CUA tools via WebSocket when the LLM requests computer actions
- Registered as tools in ZeroClaw's tool registry
- CUA sidecar auto-starts when first computer-use tool is called

### Layer 4: Integrations & Skills (OpenClaw)

**Integrations page:** User connects apps — each is an OpenClaw channel/plugin. OpenClaw has 100+ extensions:

*Model Providers:*
- Anthropic (Claude), OpenAI (GPT), Google (Gemini), DeepSeek, Mistral, Groq, Fireworks
- xAI (Grok), Qwen, Moonshot/Kimi, StepFun, MiniMax, Volcengine, Alibaba
- Amazon Bedrock, Microsoft Foundry, Nvidia, Venice, Chutes
- HuggingFace, OpenRouter, LiteLLM, vLLM, sglang, Together
- GitHub Copilot, Cloudflare AI Gateway, Vercel AI Gateway
- llama.cpp (local), Ollama (local)

*App Integrations:*
- Messaging: Slack, Discord, Telegram, WhatsApp, Signal, iMessage, Matrix, IRC, Mattermost, MS Teams, Nostr, Line, Feishu, QQBot, Zalo
- Media: ElevenLabs (TTS), Deepgram (STT), Runway (video), Fal (image), ComfyUI
- Search: Brave, DuckDuckGo, Exa, Perplexity, Tavily, SearXNG
- Tools: Browser, Firecrawl, Phone Control, Computer Use
- Notes/Tasks: via macOS native (Notes, Reminders, Calendar) + custom integrations

**Skills marketplace:** Browse and install skill packs from OpenClaw's registry
- Skills are markdown files with YAML frontmatter
- Users can create custom skills (just add a markdown file to the skills folder)
- Install/uninstall from the UI like a marketplace

---

### Seamless Action Execution (Zero-Think Wiring)

The assistant should feel **instant** for common commands — not "let me think about what tool to use." This requires:

**1. Pre-loaded tool context:** OpenClaw knows ALL available tools/integrations BEFORE the user speaks. The system prompt includes a concise tool manifest so the LLM doesn't need to "discover" tools.

**2. Direct wiring for common actions** (no LLM reasoning needed):
```
"open Safari"         → directly calls open_app("Safari") — pattern match, skip LLM
"set volume to 50"    → directly calls set_volume(50)
"what time is it"     → directly calls get_time()
"play music"          → directly calls open_app("Music")
```

These are **hot-wired shortcuts** — regex/keyword patterns that bypass the LLM for common commands. Saves 2-3 seconds of inference time.

**3. Context-aware routing for complex queries:**
```
"summarize what's on my screen"  → LLM + screenshot tool
"write an email to John about.." → LLM + compose + integration
"find that PDF I opened yesterday" → LLM + file_search + history
```

**4. History-aware tool selection:**
- The session context includes recent actions and their results
- If user says "do that again" → LLM sees history, replays last action
- If user says "open the same app" → LLM infers from context

**Implementation:**
```js
// src/main/assistant/action-router.js

// Fast path: pattern-matched commands (no LLM needed)
const DIRECT_WIRES = [
  { pattern: /^open (.+)/i, action: 'open_app', extract: (m) => ({ name: m[1] }) },
  { pattern: /^search (?:for )?(.+)/i, action: 'search_web', extract: (m) => ({ query: m[1] }) },
  { pattern: /^set volume (?:to )?(\d+)/i, action: 'set_volume', extract: (m) => ({ level: parseInt(m[1]) }) },
  { pattern: /^what(?:'s| is) the time/i, action: 'get_time', extract: () => ({}) },
  { pattern: /^type (.+)/i, action: 'type_text', extract: (m) => ({ text: m[1] }) },
  // ... more patterns
];

async function route(transcript, session) {
  // 1. Try direct wire (instant, no LLM)
  for (const wire of DIRECT_WIRES) {
    const match = transcript.match(wire.pattern);
    if (match) {
      const params = wire.extract(match);
      const result = await executeAction(wire.action, params);
      return { response: generateConfirmation(wire.action, params), result };
    }
  }
  
  // 2. Fall through to LLM (complex reasoning needed)
  return await modelFunction.query({
    messages: session.getMessages(),
    tools: getToolSchemas(),
    userMessage: transcript,
  });
}
```

This means:
- **Simple commands:** ~200ms (pattern match + action + TTS confirmation)
- **Complex queries:** ~2-4s (LLM inference + action + TTS response)

---

## Step-by-Step Technical Execution Plan

### Step 1: Project Setup & Dependencies
**What:** Install OpenClaw, CUA SDK, and configure the project.

| # | Task | Details |
|---|------|---------|
| 1.1 | Install OpenClaw | `npm install openclaw` — adds Pi agent runtime as library |
| 1.2 | Install CUA TypeScript SDK | `npm install @trycua/computer @trycua/core` |
| 1.3 | Bundle CUA Python server | Clone CUA's `libs/python/computer/` into `resources/cua-server/`, create a `requirements.txt`, bundle with PyInstaller or use embedded Python |
| 1.4 | Add `.research/` to gitignore | Already done |
| 1.5 | Create workspace dirs | `~/.tellaflow/assistant/` for sessions, skills, config |
| 1.6 | Create branch structure | Organize new files under `src/main/assistant/` |

**Output:** Dependencies installed, CUA server bundleable, directory structure ready.

---

### Step 2: CUA Computer Server (Bundled Binary — No Python Required)
**What:** Bundle CUA's computer server as a standalone macOS binary. User installs ONLY the Electron app — no Python, no pip, no Docker.

| # | Task | Details |
|---|------|---------|
| 2.1 | Build CUA server binary | Use PyInstaller to compile `cua/libs/python/computer/` into a single macOS binary (`cua-server`) |
| 2.2 | Bundle in `resources/` | Ship binary in `resources/cua-server/cua-server` (unpacked from asar, same as whisper addon) |
| 2.3 | Create `src/main/assistant/cua-server.js` | Manages sidecar lifecycle: spawn binary, health check, restart on crash |
| 2.4 | Port detection | Find available port, start on `ws://localhost:{port}` |
| 2.5 | Process management | Start on first assistant activation (lazy), stop on app quit, auto-restart on crash |
| 2.6 | Health check | WebSocket ping before routing commands, retry with backoff |
| 2.7 | Code signing | Ad-hoc sign the binary for macOS Accessibility permission (same pattern as keyspy's MacKeyServer) |
| 2.8 | Build script | `scripts/build-cua-server.sh` — automates PyInstaller build for arm64 + x64 |

**Bundle size:** ~50 MB (PyInstaller includes Python runtime + dependencies in a single binary)

**Output:** User installs Tellaflow → CUA server binary is already inside → `startCuaServer()` / `stopCuaServer()` just work. No Python installation required.

---

### Step 3: ZeroClaw Agent Runtime (Subprocess Binary)
**What:** Bundle ZeroClaw as a compiled Rust binary, manage its lifecycle, and communicate via HTTP/WebSocket.

| # | Task | Details |
|---|------|---------|
| 3.1 | Build ZeroClaw for macOS | Compile `zeroclaw` binary from source for arm64 + x64 (cross-compile or universal) |
| 3.2 | Bundle in `resources/zeroclaw/` | Ship binary in app Resources (same pattern as whisper addon, keyspy MacKeyServer) |
| 3.3 | Create `src/main/assistant/zeroclaw-process.js` | Manage subprocess lifecycle: spawn, health check, restart, kill |
| 3.4 | Create `src/main/assistant/zeroclaw-client.js` | HTTP/WebSocket client to talk to ZeroClaw gateway API |
| 3.5 | Port allocation | Find available port, start ZeroClaw on `--bind loopback --port {port}` |
| 3.6 | Config generation | Generate ZeroClaw config file from Tellaflow settings (provider, model, API keys, tools) |
| 3.7 | Provider switching | Update ZeroClaw config + hot-reload when user changes provider in UI |
| 3.8 | API key passthrough | Read from Electron safeStorage → write to ZeroClaw config/env vars |
| 3.9 | Register CUA as tool | Add CUA computer-use endpoint to ZeroClaw's tool registry |
| 3.10 | Streaming response | Parse SSE stream from ZeroClaw → pipe partial text to TTS engine |
| 3.11 | Session management | ZeroClaw handles sessions internally; Electron reads session files for UI |
| 3.12 | Abort/interrupt | Send cancel request to ZeroClaw API when user presses hotkey |
| 3.13 | Code signing | Ad-hoc sign binary for macOS Gatekeeper (same as keyspy) |
| 3.14 | Build script | `scripts/build-zeroclaw.sh` — automates Rust compilation for release |

**Output:** ZeroClaw binary runs as subprocess, handles ALL model routing (27 providers), tool calling, and session management. Electron just sends transcripts and receives responses. Zero provider-specific code in our app.

**No `model-function.js` needed** — ZeroClaw IS the model function. It already supports:
- llama.cpp, Ollama (local)
- OpenAI, Anthropic, Google, DeepSeek, Groq, xAI, Mistral (cloud)
- OpenRouter, HuggingFace, Bedrock, Azure, Nvidia, + 15 more
- Failover chains, streaming, tool calling normalization

---

### Step 4: TTS Engine (Pocket TTS via sherpa-onnx)
**What:** Add voice synthesis using Kokoro model through the existing sherpa-onnx-node dependency.

| # | Task | Details |
|---|------|---------|
| 4.1 | Create `src/main/assistant/tts.js` | TTS wrapper — load model, synthesize, stream audio |
| 4.2 | Model download | Add Kokoro ONNX model to download manager (same pattern as Whisper models) |
| 4.3 | Streaming synthesis | Split response text by sentences, synthesize each, play sequentially |
| 4.4 | Create `src/renderer/assistant-playback.html` | Hidden BrowserWindow that receives PCM via IPC and plays via Web Audio API |
| 4.5 | Voice selection | Support multiple Kokoro voices (alba, george, etc.) |
| 4.6 | Register as OpenClaw speech provider | Use `openclaw/plugin-sdk/speech` to register pocket-tts as the TTS backend |

**Output:** `synthesizeAndPlay("Hello, I opened Safari for you")` → user hears spoken response.

---

### Step 5: Hotkey & Audio Pipeline
**What:** Add assistant hotkey alongside existing dictation hotkey.

| # | Task | Details |
|---|------|---------|
| 5.1 | Modify `src/main/hotkey.js` | Support dual-hotkey: check both dictation and assistant configs in the listener |
| 5.2 | Add config keys | `assistantHotkey`, `assistantEnabled`, `assistantModel`, `assistantVoice` in `src/main/config.js` |
| 5.3 | Create assistant recording flow in `src/main/index.js` | On assistant hotkey: start recording → on release: STT → OpenClaw agent → TTS |
| 5.4 | State machine | `idle` → `listening` → `transcribing` → `thinking` → `speaking` → `idle` |
| 5.5 | Interrupt handling | If user presses hotkey while assistant is speaking: stop TTS, start new recording |

**Output:** User holds Right Option → speaks → releases → hears response. Fully wired end-to-end.

---

### Step 6: UI — Assistant Page + Models Page Extension
**What:** Add conversation UI and model/provider management.

| # | Task | Details |
|---|------|---------|
| 6.1 | Create `src/renderer/src/components/assistant/AssistantPage.tsx` | Conversation view with chat bubbles + hotkey config |
| 6.2 | Create `src/renderer/src/hooks/use-assistant.ts` | React hook for assistant state, history, config via IPC |
| 6.3 | Add to `Sidebar.tsx` | New nav item "Assistant" in `navItems` array |
| 6.4 | Add to `App.tsx` | New page route for assistant |
| 6.5 | Extend `ModelsPage.tsx` | Add "Voice Assistant" section with provider selector + model cards |
| 6.6 | Provider selector UI | Dropdown: Local (Offline), OpenAI, Claude, HuggingFace, OpenRouter |
| 6.7 | Local model cards | Download/pause/delete with RAM-based recommendations (detect system RAM via `os.totalmem()`) |
| 6.8 | API key inputs | Secure input fields with "Test Connection" button for each cloud provider |
| 6.9 | TTS model card | Kokoro download + voice selector dropdown with preview button |
| 6.10 | Hotkey recorder | Reuse onboarding hotkey recording component for assistant hotkey |

**Output:** Full conversation UI in sidebar, all model/provider config on existing Models page.

---

### Step 7: Toast/Overlay States
**What:** Visual feedback during assistant interaction.

| # | Task | Details |
|---|------|---------|
| 7.1 | Extend `src/main/toast.js` | Add states: `assistant-listening`, `assistant-thinking`, `assistant-speaking` |
| 7.2 | Different visual style | Purple accent for assistant (vs blue for dictation) to distinguish modes |
| 7.3 | Speaking waveform | Visualize TTS audio output in the toast bar |

**Output:** User sees visual feedback for each assistant state.

---

### Step 8: IPC Bridge
**What:** Connect renderer UI to main process assistant functionality.

| # | Task | Details |
|---|------|---------|
| 8.1 | Extend `src/preload/index.js` | Add ~15 new methods for assistant config, history, model management |
| 8.2 | Add IPC handlers in `src/main/index.js` | Handle all assistant-related invoke/send/on patterns |
| 8.3 | Type definitions | Add TypeScript types in `src/renderer/src/lib/ipc.ts` |
| 8.4 | Event broadcasting | `assistant-state-changed`, `assistant-response`, `assistant-model-progress` |

**Output:** UI ↔ main process communication fully wired.

---

### Step 9: Skills Marketplace
**What:** Browsable/installable skill packs from OpenClaw's ecosystem.

| # | Task | Details |
|---|------|---------|
| 9.1 | Create bundled skills in `resources/assistant-skills/` | Markdown + YAML frontmatter (OpenClaw format) |
| 9.2 | Built-in skills | `open_app`, `search_web`, `get_time`, `type_text`, `get_clipboard`, `set_volume`, etc. |
| 9.3 | CUA computer skills | `screenshot`, `click_at`, `scroll`, `read_screen` (via CUA toolbox) |
| 9.4 | Skill install/uninstall | Load skills from OpenClaw registry, save to `~/.tellaflow/assistant/skills/` |
| 9.5 | Skills UI on Integrations page | Card grid showing installed skills, browse available, install button |
| 9.6 | Custom skill creation | Users can add their own `.md` skill files to the skills folder |
| 9.7 | Skill permissions | Toggle skill categories on/off, destructive actions require confirmation |

**Output:** User can browse, install, and manage skills like a marketplace.

---

### Step 10: Integrations Page
**What:** Connect external apps via OpenClaw's channel plugins.

| # | Task | Details |
|---|------|---------|
| 10.1 | Create `src/renderer/src/components/integrations/IntegrationsPage.tsx` | Grid of available app integrations |
| 10.2 | Add to Sidebar + App.tsx | New "Integrations" nav item |
| 10.3 | Integration cards | Each shows: app icon, name, status (connected/disconnected), configure button |
| 10.4 | Built-in integrations | Apple Notes, Apple Reminders, Calendar, Spotify (via osascript) |
| 10.5 | OpenClaw channel integrations | Slack, Discord, Telegram, GitHub, Linear, Notion, Bear Notes |
| 10.6 | OAuth/API key flow | Per-integration auth (some need API keys, some need OAuth) |
| 10.7 | Integration settings | Per-app config (e.g., which Slack workspace, which calendar) |
| 10.8 | Enable/disable per integration | User controls which integrations the assistant can access |

**Output:** User can connect apps, assistant gains abilities to interact with them.

---

### Step 11: Testing & Polish
**What:** Verify everything works end-to-end.

---

| # | Task | Details |
|---|------|---------|
| 11.1 | Integration test | Hotkey → STT → Model Function → CUA → TTS → playback |
| 11.2 | Memory profiling | Verify total RAM < 7GB on 8GB machine |
| 11.3 | Regression tests | Existing dictation pipeline still works |
| 11.4 | Error handling | CUA server crash recovery, LLM timeout, TTS failure graceful fallback |
| 11.5 | Streaming polish | Sentence-by-sentence TTS for perceived speed |
| 11.6 | Context compaction test | Long conversations don't overflow context window |
| 11.7 | Provider switching test | Switch between local and cloud providers mid-session |
| 11.8 | Skills install/uninstall test | Install a skill, use it, uninstall it |

**Output:** Production-ready feature.

---

## Execution Order & Dependencies

```
Step 1 (Setup + deps)
  ├── Step 2 (CUA Server binary) ──────────────┐
  ├── Step 3 (ZeroClaw binary + client) ───────┤── Step 5 (Hotkey + Pipeline) ── Step 7 (Toast)
  └── Step 4 (TTS Engine) ────────────────────┘          │
                                                           ▼
                                              Step 8 (IPC) ── Step 6 (UI + Models Page)
                                                           │
                                                           ▼
                                              Step 9 (Skills Marketplace)
                                                           │
                                                           ▼
                                              Step 10 (Integrations Page)
                                                           │
                                                           ▼
                                              Step 11 (Testing & Polish)
```

**Parallel tracks:**
- Steps 2, 3, 4 can be developed in parallel (independent subsystems)
- Step 5 merges them (depends on 2+3+4 — all binary sidecars + TTS ready)
- Steps 6, 7, 8 are UI layer (depends on Step 5 for state machine)
- Steps 9, 10 extend functionality (depends on Step 3 for ZeroClaw channels/tools)
- Step 11 is final verification

---

## Key Technical Decisions

### Why ZeroClaw as agent runtime (not OpenClaw or custom code)?
- **Single binary** — compiles to one file, ships in .app, no runtime dependencies
- **27 model providers built-in** — no need to write provider code ourselves
- **80+ tools + tool calling** — already handles the full agent loop
- **Voice-first** — built-in TTS, STT, voice wake, voice call channels
- **Lighter** — 51 MB repo vs 193 MB (OpenClaw), ~20 MB compiled binary
- **Faster** — native Rust vs interpreted Node.js
- **Session management** — built-in conversation persistence + compaction
- **Security sandbox** — tool allowlists, no accidental destructive actions
- **OpenAI-compatible API** — our Electron code just does `fetch()` to localhost

### Why CUA for computer control (not ZeroClaw's browser tools)?
- CUA has FULL desktop control: mouse, keyboard, windows, file system, accessibility tree
- Screenshot-based reasoning: LLM can "see" the screen and click elements
- ZeroClaw's tools are browser-only (WebDriver) — no native desktop automation
- Sidecar pattern: start on demand, kill on quit, reconnect on crash
- PyInstaller binary — no Python needed on user machine

### Why keep OpenClaw (optional)?
- Mature npm plugin marketplace (100+ extensions)
- Users who want extended integrations can install OpenClaw skills
- WASM plugin system in ZeroClaw is still experimental (v1.0.0 target)
- Bridge: OpenClaw skills can be exposed as tools to ZeroClaw

### Why Pocket TTS via sherpa-onnx (not ZeroClaw's built-in TTS)?
- `sherpa-onnx-node` is ALREADY installed (for Parakeet STT)
- Supports Kokoro-82M TTS models natively
- Runs in-process (no subprocess overhead for audio)
- ZeroClaw's TTS would add latency (cross-process audio transfer)
- CPU-only, 24kHz output, streaming capable

---

## Model & Dependency Summary

### NPM Dependencies (new)
```json
{
  "ws": "^8.x"                  // WebSocket client for CUA sidecar communication (if not already available)
}
```

**No other new npm dependencies.** ZeroClaw is a binary (no npm). CUA is a binary (no npm). OpenClaw is Phase 3+ optional only.

### Bundled Binaries (no npm, no runtime install)
```
resources/zeroclaw/zeroclaw          — Compiled Rust binary (~20-50 MB)
resources/cua-server/cua-server      — Compiled Python binary (~80-120 MB, stripped)
```

**Note:** ZeroClaw handles ALL 27 model providers internally. No `openai`, `anthropic`, etc. npm packages needed. CUA is talked to via raw WebSocket (no @trycua/computer SDK).

### Existing Dependencies (reused)
```json
{
  "sherpa-onnx-node": "^1.12.35",   // TTS (Kokoro) + existing Parakeet STT
  "node-llama-cpp": "^3.18.1",      // LLM inference (used by OpenClaw llamacpp provider)
  "keyspy": "^1.1.1",               // Hotkey capture
  "better-sqlite3": "^12.8.0"       // Database
}
```

### Local Models (downloaded on-demand by user)
| Model | Size | RAM Needed | Purpose |
|-------|------|-----------|---------|
| Qwen3 4B Q4_K_M | ~2.5 GB | 16 GB+ | Best local assistant (recommended) |
| Qwen3 0.6B Q4_K_M | ~480 MB | 8 GB+ | Lightweight, basic commands |
| Kokoro-82M ONNX | ~170 MB | Any | TTS voice synthesis |

### Cloud Providers (no download, API key required)
| Provider | Models | Notes |
|----------|--------|-------|
| OpenAI | GPT-4o, GPT-4o-mini | Best for low-RAM machines |
| Claude (Anthropic) | Sonnet 4.6, Opus 4.6, Haiku 4.5 | Best reasoning |
| HuggingFace | Any Inference API model | Free tier available |
| OpenRouter | 100+ models unified | Single key, flexible |

### Bundled Binaries (ship inside the .app — no user setup required)
| Component | Language | Size | Purpose |
|-----------|----------|------|---------|
| ZeroClaw Gateway (Rust, compiled) | Rust | ~20-50 MB | Agent runtime — 27 providers, 80+ tools, sessions, tool calling |
| CUA Computer Server (PyInstaller) | Python | ~50 MB | Desktop control — mouse, keyboard, screenshots, windows, files, accessibility |

**Total app size impact:** +70-100 MB for both binaries.

**Why compiled binaries:** The user downloads ONE app (Tellaflow.app). Both binaries are inside `Tellaflow.app/Contents/Resources/`. No Rust, no Python, no Cargo, no pip, no terminal commands. Same pattern as the existing keyspy MacKeyServer binary and whisper native addon.

---

## Model Provider Strategy (Offline + Online)

The assistant supports **both local (offline) and cloud (online) models** via OpenClaw's multi-provider plugin system. Users with limited RAM can use cloud APIs; users who want privacy/offline use local models.

### Provider Options (from OpenClaw ecosystem — 30+ providers)

**Local (Offline — no API key, no internet):**
| Provider | Models | Notes |
|----------|--------|-------|
| **llama.cpp** | Qwen3 0.6B/4B, Gemma 4, Phi-4, Llama 3.2 | Direct GGUF, fastest local |
| **Ollama** | Any Ollama-supported model | Easy management UI |
| **vLLM** | Any supported model | For power users with GPU |
| **sglang** | Any supported model | High-throughput local |

**Cloud (Online — API key required):**
| Provider | Models | Notes |
|----------|--------|-------|
| **OpenAI** | GPT-5.4, GPT-4o, GPT-4o-mini | Best all-around |
| **Anthropic** | Claude Opus 4.6, Sonnet 4.6, Haiku 4.5 | Best reasoning |
| **Google** | Gemini 2.5 Pro/Flash | Multimodal, long context |
| **DeepSeek** | DeepSeek-V3, DeepSeek-R1 | Cost-effective reasoning |
| **xAI** | Grok-3, Grok-3-mini | Real-time web access |
| **Mistral** | Mistral Large, Medium, Small | European, fast |
| **Groq** | Llama, Mixtral (ultra-fast inference) | Fastest cloud |
| **Fireworks** | Open models (fast inference) | Low latency |
| **Together** | Open models | Good pricing |
| **Qwen** | Qwen3 series | Chinese + English |
| **Moonshot/Kimi** | Kimi models | Long context specialist |
| **MiniMax** | MiniMax models | Multimodal |
| **HuggingFace** | Any Inference API model | Free tier available |
| **OpenRouter** | 100+ models unified | Single key, any model |
| **Amazon Bedrock** | Claude, Titan, Llama | AWS integration |
| **Microsoft Foundry** | Azure OpenAI models | Azure integration |
| **Nvidia** | Nvidia NIM models | Enterprise GPU |
| **GitHub Copilot** | GPT-4o via Copilot | If user has Copilot sub |
| **Cloudflare AI** | Workers AI models | Edge inference |
| **Vercel AI** | Multiple providers | Vercel users |
| **Venice** | Privacy-focused models | No data retention |
| **LiteLLM** | Any LiteLLM proxy | Custom proxy |
| **StepFun** | StepFun models | Chinese market |

All providers are available via OpenClaw's plugin system — no custom code needed per provider.

### RAM-Based Recommendations (shown in Models page)

```
┌──────────────────────────────────────────────────────────┐
│  Your system: 8 GB RAM                                    │
│                                                           │
│  ⭐ Recommended: Qwen3 0.6B (offline, 480 MB)            │
│     Good for simple commands. Low memory usage.           │
│                                                           │
│  💡 Or use online APIs (no RAM needed):                   │
│     Connect OpenAI, Claude, or OpenRouter API key         │
│     for best performance with zero local memory cost.     │
└──────────────────────────────────────────────────────────┘
```

| System RAM | Recommended Local Model | Alternative |
|-----------|------------------------|-------------|
| 8 GB | Qwen3 0.6B (480 MB) | Use online API |
| 16 GB | Qwen3 4B (2.5 GB) | Gemma 4 2.3B |
| 32 GB+ | Qwen3 4B or larger | Any model |

### UI: Models Page Integration

All assistant model management lives on the **existing Models page** (not a separate page). Add a new "Voice Assistant" section:

```
┌─────────────────────────────────────────────────────────────┐
│  Models                                                      │
│                                                              │
│  ── Transcription ──────────────────────────────────────     │
│  [Existing Whisper/Parakeet model cards]                     │
│                                                              │
│  ── AI Grammar ─────────────────────────────────────────     │
│  [Existing grammar model cards]                              │
│                                                              │
│  ── Voice Assistant ────────────────────────────────────     │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Your RAM: 16 GB                                       │   │
│  │ Recommended: Qwen3 4B (local) or any cloud provider   │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  Provider: [▼ Select Provider                    ]           │
│            ┌─────────────────────────────────────┐           │
│            │ LOCAL (OFFLINE)                      │           │
│            │   llama.cpp (GGUF models)           │           │
│            │   Ollama                            │           │
│            │ ─────────────────────────────────── │           │
│            │ CLOUD (API KEY)                     │           │
│            │   OpenAI                            │           │
│            │   Anthropic (Claude)                │           │
│            │   Google (Gemini)                   │           │
│            │   DeepSeek                          │           │
│            │   Groq                              │           │
│            │   OpenRouter (100+ models)          │           │
│            │   HuggingFace                       │           │
│            │   xAI (Grok)                        │           │
│            │   Mistral                           │           │
│            │   + 20 more...                      │           │
│            └─────────────────────────────────────┘           │
│                                                              │
│  [Provider-specific config shown below based on selection]   │
│                                                              │
│  ── TTS Voice ──────────────────────────────────────────     │
│  Kokoro-82M         170 MB    [Downloaded ✓]                 │
│  Voice: [Alba ▼]              [▶ Preview]                    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### API Key Storage

API keys stored securely in the existing SQLite config (same pattern as other settings):
- `assistantProvider`: "llamacpp" | "ollama" | "openai" | "anthropic" | "huggingface" | "openrouter"
- `assistantApiKey`: encrypted string (or use macOS Keychain via `safeStorage`)
- `assistantModelId`: provider-specific model identifier

### OpenClaw Provider Registration

OpenClaw already has plugins for most providers. We configure them at runtime:

```js
// For local (llama.cpp) — uses our existing node-llama-cpp
import { runEmbeddedPiAgent } from 'openclaw';

await runEmbeddedPiAgent({
  provider: "llamacpp",
  model: "qwen3-4b",
  // OpenClaw's llamacpp plugin routes to local server
  ...
});

// For cloud (OpenAI, Anthropic, etc.) — OpenClaw handles natively
await runEmbeddedPiAgent({
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  // API key from config
  ...
});

// For OpenRouter — single endpoint, many models
await runEmbeddedPiAgent({
  provider: "openrouter",
  model: "qwen/qwen3-4b",
  ...
});
```

---

---

## Gaps & Polyfills (Architect Review Fixes)

These address all identified gaps without compromising the plan:

### GAP-1 FIX: Remove OpenClaw npm dependency from Steps 1-5
- **Polyfill:** ZeroClaw is the ONLY runtime. Remove `openclaw` from Step 1.1.
- OpenClaw is Layer 4 ONLY (optional skill marketplace, Phase 3+).
- Steps 1-5 have zero reference to OpenClaw.

### GAP-2 FIX: Dual-hotkey architecture
- **Polyfill:** Refactor `hotkey.js` to support a `mode` concept:
  ```js
  // Track which mode is active (only one at a time)
  let activeMode = null; // 'dictation' | 'assistant' | null
  
  listener.addListener((e, down) => {
    if (e.state === 'DOWN' && !activeMode) {
      if (matchesHotkey(e, down, config.getHotkey())) {
        activeMode = 'dictation';
        onDictationStart();
      } else if (matchesHotkey(e, down, config.getAssistantHotkey())) {
        activeMode = 'assistant';
        onAssistantStart();
      }
    } else if (e.state === 'UP' && activeMode) {
      // Release trigger for whichever mode is active
      if (activeMode === 'dictation' && matchesTrigger(e, config.getHotkey())) {
        activeMode = null;
        onDictationStop();
      } else if (activeMode === 'assistant' && matchesTrigger(e, config.getAssistantHotkey())) {
        activeMode = null;
        onAssistantStop();
      }
    }
  });
  ```
  Only one mode active at a time — no state conflicts.

### GAP-3 FIX: Secure API key storage
- **Polyfill:** Use `electron.safeStorage.encryptString()` / `decryptString()` wrapper:
  ```js
  // src/main/assistant/secure-store.js
  const { safeStorage } = require('electron');
  const config = require('../config');
  
  function setApiKey(provider, key) {
    const encrypted = safeStorage.encryptString(key).toString('base64');
    config.setSetting(`apiKey_${provider}`, encrypted);
  }
  function getApiKey(provider) {
    const encrypted = config.getSetting(`apiKey_${provider}`);
    if (!encrypted) return null;
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  }
  ```
  Keys stored encrypted in existing SQLite; decrypted at runtime via macOS Keychain.

### GAP-4 FIX: Extract shared DownloadManager
- **Polyfill:** Create `src/main/download-manager.js` FIRST (Step 1), then refactor existing grammar.js/models.js to use it:
  ```js
  class DownloadManager {
    constructor({ url, dest, onProgress, headers }) { ... }
    async start() { /* resume-aware, redirect-following, progress-emitting */ }
    pause() { ... }
    cancel() { ... }
  }
  ```
  All future downloads (TTS model, assistant model) use this. Existing code migrated.

### GAP-5 FIX: Add sherpa-onnx-node to asarUnpack
- **Polyfill:** Add to `electron-builder.yml`:
  ```yaml
  asarUnpack:
    - "node_modules/@kutalia/whisper-node-addon/**"
    - "node_modules/node-llama-cpp/**"  
    - "node_modules/better-sqlite3/**"
    - "node_modules/sherpa-onnx-node/**"   # ← ADD THIS
  ```

### GAP-6 FIX: New AI toast window registration
- **Polyfill:** The AI toast is a SEPARATE window (`src/renderer/ai-toast.html`). Add to electron-builder files + register in index.js window creation.

### GAP-7 FIX: node-llama-cpp conflict (grammar + ZeroClaw local)
- **Polyfill:** Mutual exclusion — when assistant uses LOCAL model:
  1. Send `dispose` to grammar-worker (unload grammar model from RAM)
  2. ZeroClaw loads its own llama.cpp instance
  3. When assistant goes idle (5 min timeout), re-init grammar worker
  4. If user is using CLOUD provider, grammar worker stays loaded (no conflict)
  ```js
  // Before starting local assistant:
  if (config.getAssistantProvider() === 'llamacpp') {
    await grammarWorker.send({ type: 'dispose' });
  }
  ```

### GAP-8 FIX: AI toast is a completely NEW window (not extending existing toast)
- **Polyfill:** Create `src/main/ai-toast.js` + `src/renderer/ai-toast.html` as an independent system. The existing dictation toast (`toast.js` + `toast.html`) is untouched. Two separate floating windows with different purposes.

### GAP-9 FIX: Remove @trycua/computer npm package
- **Polyfill:** CUA is a binary sidecar only. Electron talks to it via plain WebSocket (`ws` package, already available). No TypeScript SDK needed:
  ```js
  const ws = new WebSocket(`ws://localhost:${cuaPort}`);
  ws.send(JSON.stringify({ action: 'screenshot' }));
  ```

### GAP-10 FIX: Add extraResources to electron-builder
- **Polyfill:** Add to `electron-builder.yml`:
  ```yaml
  extraResources:
    - from: "resources/models/"
      to: "models/"
    - from: "resources/zeroclaw/"
      to: "zeroclaw/"
      filter: ["**/*"]
    - from: "resources/cua-server/"
      to: "cua-server/"
      filter: ["**/*"]
  ```

### RISK-1 FIX: ZeroClaw instability fallback
- **Polyfill:** Build a thin `src/main/assistant/fallback-agent.js` (~200 lines) that does direct `fetch()` to Ollama/OpenAI with tool calling. If ZeroClaw binary fails to start or crashes 3x, automatically switch to fallback mode. User sees "Running in simplified mode" in the AI toast.

### RISK-2 FIX: CUA binary size (150-250 MB realistic)
- **Polyfill:** Strip Playwright from CUA build (we don't need browser automation — ZeroClaw has its own). Target only: `pynput` + `pyobjc-framework-Quartz` + `pyobjc-framework-ApplicationServices` + `fastapi` + `uvicorn`. Expected: ~80-120 MB.

### RISK-3 FIX: Code signing for bundled binaries
- **Polyfill:** Add `scripts/sign-sidecars.js` as `afterPack` hook in electron-builder. Signs each binary with Developer ID before the outer app is packaged:
  ```js
  // scripts/sign-sidecars.js
  const { execSync } = require('child_process');
  exports.default = async function(context) {
    const binaries = ['zeroclaw/zeroclaw', 'cua-server/cua-server'];
    for (const bin of binaries) {
      const path = `${context.appOutDir}/.../Resources/${bin}`;
      execSync(`codesign --force --sign "${identity}" --options runtime "${path}"`);
    }
  };
  ```

### RISK-4 FIX: Screen Recording permission
- **Polyfill:** Add to `build/entitlements.mac.plist`:
  ```xml
  <key>com.apple.security.cs.allow-screen-recording</key>
  <true/>
  ```
  And handle the permission prompt gracefully in CUA — if denied, screenshot tools return "Permission needed" and the AI toast shows a "Grant Screen Recording" button.

### RISK-5 FIX: Memory management
- **Polyfill:** Lazy-start EVERYTHING. At app launch, only existing systems run (Whisper, grammar = 1.2 GB). On first assistant hotkey press:
  1. Unload grammar model (saves 500 MB)
  2. Start ZeroClaw subprocess (~50-100 MB)
  3. Load TTS model (~170 MB)
  4. CUA only starts when a computer-use tool is called
  Total on 8 GB: 1.2 - 0.5 + 0.1 + 0.17 + 2.5 (local) = ~3.5 GB for assistant mode

### RISK-7 FIX: IPC namespace
- **Polyfill:** All assistant IPC uses `assistant-` prefix:
  - `assistant-state-changed` (not `status-change`)
  - `assistant-config` (not `config-changed`)  
  - `assistant-*` for all new events. Zero collision with existing events.

---

## AI Toast System (New Window)

The AI assistant has its own **floating island** window (`ai-toast.html`), completely separate from the existing dictation toast. It's a Dynamic Island-style overlay that adapts its shape and content to the current state.

### States

| State | Visual | Interaction |
|-------|--------|-------------|
| **idle** | Minimal pill, "Ready" + hotkey chip | Press hotkey to activate |
| **listening** | Blue waveform + "Listening..." | Esc to stop |
| **thinking** | Violet dots + "Thinking..." | Esc to cancel |
| **speaking** | Green waveform + word highlight | Pause, Skip, Repeat |
| **acting** | Spinner + action label | Esc to cancel |
| **confirm** | Question + Yes/No chips | Y/N keyboard shortcuts |
| **choice** | Question + numbered options | 1/2/3 keyboard shortcuts |
| **tool-permission** | Lock icon + Once/Always/No | Keyboard or click |
| **notify** | Bell + message + action chips | Click actions |
| **typing** | Text input field + send button | Enter to send |
| **background** | Progress bar + count | Expand for details |
| **success** | Green check + message | Auto-dismisses (3s) |
| **error** | Red icon + message + Retry | Click retry |
| **offline** | Wifi-off + "Reconnecting..." | "Work offline" button |
| **live-transcript** | Rolling text with caret (large) | Fading older lines |
| **tts-reading** | Word-by-word highlight (large) | Pause, skip, speed |
| **summary** | Numbered points (large) | "Show full" button |
| **dictation-review** | Full text + Send/Edit/Discard (large) | Action buttons |
| **attachment** | File pill + "attached" | "Ask about it" |
| **context** | Memory chip + "Still on [topic]" | "New topic" button |
| **handoff** | Model switch indicator | Informational |

### Window Properties
```js
// src/main/ai-toast.js
const aiToastWindow = new BrowserWindow({
  width: 620,
  height: 200, // auto-resizes based on state
  frame: false,
  transparent: true,
  alwaysOnTop: true,
  skipTaskbar: true,
  hasShadow: false,
  resizable: false,
  focusable: false, // click-through for idle states
  webPreferences: { preload: aiToastPreload },
});
// Position: bottom-center of screen, 60px from bottom
```

### State Machine
```
idle ──[hotkey down]──▶ listening
listening ──[hotkey up]──▶ thinking
thinking ──[response start]──▶ speaking | acting | confirm | choice
speaking ──[done]──▶ idle
speaking ──[interrupt]──▶ listening
acting ──[tool result]──▶ speaking | confirm
confirm ──[yes/no]──▶ acting | idle
success ──[3s timeout]──▶ idle
error ──[retry]──▶ acting
```

### File Structure
```
src/main/ai-toast.js           — Window creation, state management, IPC
src/renderer/ai-toast.html     — HTML entry point
src/renderer/src/AiToastApp.tsx — React app for the floating island
src/renderer/src/components/ai-toast/
  ├── AiIsland.tsx             — Main container (dynamic sizing)
  ├── states/
  │   ├── IdleState.tsx
  │   ├── ListeningState.tsx
  │   ├── ThinkingState.tsx
  │   ├── SpeakingState.tsx
  │   ├── ActingState.tsx
  │   ├── ConfirmState.tsx
  │   ├── ChoiceState.tsx
  │   ├── SuccessState.tsx
  │   ├── ErrorState.tsx
  │   ├── TypingState.tsx
  │   ├── NotifyState.tsx
  │   ├── PermissionState.tsx
  │   ├── BackgroundState.tsx
  │   ├── OfflineState.tsx
  │   └── LiveTextState.tsx    — transcript, tts-reading, summary
  ├── WaveformBar.tsx          — Animated waveform (reuse 8-bit style)
  ├── ChipButton.tsx           — Action chip component
  └── HotkeyChip.tsx           — Hotkey display chip
```

---

## Open Questions for Review

1. **Default assistant hotkey:** Right Option? Globe key? Cmd+Shift+Space?
2. **Direct wiring threshold:** How many pattern-matched shortcuts should we pre-wire? (currently ~10 common commands)
3. **Skill permissions:** All actions enabled by default, or require user opt-in per category?
4. **Screen context:** Should every query include a screenshot for better context? (adds ~100ms latency)
5. **Default voice:** Which Kokoro voice as default? (alba = female, george = male)
6. **Integrations priority:** Which app integrations to ship first? (Apple Notes, Reminders, Calendar are easiest via osascript)

---

## References

| Repo | What We Use | How |
|------|-------------|-----|
| `.research/zeroclaw/` | Agent runtime (27 providers, 80+ tools, sessions) | Compiled Rust binary, subprocess + HTTP/WS API |
| `.research/cua/` | Computer control (desktop automation) | PyInstaller binary, WebSocket from ZeroClaw |
| `.research/AtomicBot/` | Skill marketplace, npm plugin ecosystem | Optional `openclaw` npm package for extended skills |
| `.research/pocket-tts/` | TTS model architecture reference | Via `sherpa-onnx-node` (Kokoro ONNX model) |
| `.research/clicky/` | UX patterns (push-to-talk, state machine) | Adapted interaction model, not code |
