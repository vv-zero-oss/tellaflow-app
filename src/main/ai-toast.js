/**
 * AI Assistant Toast — Floating island window.
 * Separate from the existing dictation toast (toast.js).
 * Shows assistant state: idle, listening, thinking, speaking, acting, confirm, etc.
 */
const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

let window = null;
let currentState = 'idle';
let stateData = {};

// ─── Window creation ────────────────────────────────────────────────────────────

function create() {
  if (window) return;

  const display = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = display.workAreaSize;

  // Position: bottom-center, 60px from bottom
  const winW = 620;
  const winH = 200;
  const x = Math.round((screenW - winW) / 2);
  const y = screenH - winH - 60;

  window = new BrowserWindow({
    x, y,
    width: winW,
    height: winH,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    focusable: false,
    vibrancy: undefined,
    roundedCorners: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'ai-toast-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.setIgnoresMouseEvents(false);
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Load the AI toast renderer
  const isDev = !require('electron').app.isPackaged;
  if (isDev) {
    // Dev: load from Vite dev server
    window.loadURL('http://localhost:5173/ai-toast.html').catch(() => {
      // Fallback to file
      window.loadFile(path.join(__dirname, '..', 'renderer', 'ai-toast.html'));
    });
  } else {
    window.loadFile(path.join(__dirname, '..', 'renderer', 'ai-toast.html'));
  }

  window.on('closed', () => { window = null; });
}

function destroy() {
  if (window) {
    window.close();
    window = null;
  }
}

// ─── State management ───────────────────────────────────────────────────────────

/**
 * All possible AI toast states:
 * - idle: ready, showing hotkey hint
 * - listening: blue waveform, microphone active
 * - thinking: violet animation, LLM processing
 * - speaking: green waveform, TTS playing
 * - acting: spinner, tool executing
 * - confirm: yes/no question
 * - choice: multiple options
 * - permission: tool access request (once/always/no)
 * - notify: notification with actions
 * - typing: text input mode
 * - background: progress indicator
 * - success: green check, auto-dismiss
 * - error: red icon, retry option
 * - offline: reconnecting indicator
 * - live-transcript: rolling text with caret
 * - tts-reading: word-by-word highlight
 * - summary: numbered points, collapsible
 * - dictation-review: full text with send/edit/discard
 * - attachment: file/screenshot attached
 * - context: memory/topic indicator
 * - handoff: model switch
 */

function setState(state, data = {}) {
  currentState = state;
  stateData = data;

  if (!window) {
    if (state !== 'idle') create();
    else return;
  }

  // Send state to renderer
  window.webContents.send('ai-toast-state', { state, data });

  // Auto-size window based on state
  resizeForState(state);

  // Show/hide based on state
  if (state === 'idle') {
    // Keep visible but minimal
    window.show();
  } else {
    window.show();
  }
}

function resizeForState(state) {
  if (!window) return;

  // Large states need more height
  const largeStates = ['live-transcript', 'tts-reading', 'summary', 'dictation-review', 'attachment'];
  const mediumStates = ['confirm', 'choice', 'permission', 'typing', 'background'];

  let height = 52; // Compact pill
  if (largeStates.includes(state)) height = 180;
  else if (mediumStates.includes(state)) height = 60;

  const [w] = window.getSize();
  window.setSize(w, height, true);
}

function getState() {
  return { state: currentState, data: stateData };
}

// ─── Convenience state setters ──────────────────────────────────────────────────

function idle() { setState('idle'); }
function listening() { setState('listening'); }
function thinking() { setState('thinking'); }
function speaking(text) { setState('speaking', { text }); }
function acting(label) { setState('acting', { label }); }
function confirm(question, options) { setState('confirm', { question, options }); }
function choice(question, choices) { setState('choice', { question, choices }); }
function permission(tool) { setState('permission', { tool }); }
function success(message) {
  setState('success', { message });
  // Auto-dismiss after 3s
  setTimeout(() => { if (currentState === 'success') idle(); }, 3000);
}
function error(message) { setState('error', { message }); }
function offline() { setState('offline'); }
function liveTranscript(lines) { setState('live-transcript', { lines }); }
function ttsReading(words, currentIndex) { setState('tts-reading', { words, currentIndex }); }
function summary(points) { setState('summary', { points }); }

// ─── IPC handlers ───────────────────────────────────────────────────────────────

function setupIPC() {
  // Renderer → Main: user interactions from the toast
  ipcMain.on('ai-toast-action', (_, action) => {
    // Forward to the assistant orchestrator
    const { emit } = require('./assistant/events');
    emit('toast-action', action);
  });

  ipcMain.handle('ai-toast-get-state', () => getState());
}

// ─── Hide/Show ──────────────────────────────────────────────────────────────────

function show() {
  if (!window) create();
  window.show();
}

function hide() {
  if (window) window.hide();
}

function isVisible() {
  return window?.isVisible() ?? false;
}

module.exports = {
  create, destroy, setState, getState, setupIPC, show, hide, isVisible,
  // State shortcuts
  idle, listening, thinking, speaking, acting, confirm, choice,
  permission, success, error, offline, liveTranscript, ttsReading, summary,
};
