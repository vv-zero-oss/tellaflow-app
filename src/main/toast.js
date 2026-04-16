const { BrowserWindow, screen } = require('electron');
const path = require('path');
const config = require('./config');

let toastWindow = null;
let toastReady = false;
let pendingState = null;
// Track current state so we can restore to correct idle when needed
let currentState = 'idle';
// Remembers position after the user drags the toast (session-only)
let savedPosition = null;

const INTERACTIVE_STATES = new Set(['floating-idle', 'click-recording']);

function getToastPosition() {
  if (savedPosition) return savedPosition;
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const { x, y, width, height } = display.workArea;
  return {
    x: Math.round(x + width / 2 - 140),
    y: y + height - 80,
  };
}

function moveToast(x, y) {
  savedPosition = { x: Math.round(x), y: Math.round(y) };
  if (toastWindow && !toastWindow.isDestroyed()) {
    toastWindow.setPosition(savedPosition.x, savedPosition.y, false);
  }
}

function createToastWindow() {
  if (toastWindow && !toastWindow.isDestroyed()) return toastWindow;

  toastReady = false;
  pendingState = null;

  const pos = getToastPosition();

  toastWindow = new BrowserWindow({
    width: 280,
    height: 68,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  toastWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Default to ignoring mouse events; enabled only for interactive states
  toastWindow.setIgnoreMouseEvents(true);

  toastWindow.webContents.on('did-finish-load', () => {
    toastReady = true;
    // Send hotkey label so the floating bar can display the hint
    const hotkey = config.getHotkey();
    toastWindow.webContents.send('toast-hotkey', hotkey?.label || '');

    if (pendingState) {
      sendState(pendingState);
      pendingState = null;
    }
  });

  toastWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error('Toast window failed to load:', code, desc);
  });

  const isDev = !require('electron').app.isPackaged;
  if (isDev) {
    toastWindow.loadURL('http://localhost:5173/toast.html').catch((err) => {
      console.error('Toast loadURL error:', err.message);
    });
  } else {
    toastWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'renderer', 'toast.html'));
  }

  toastWindow.on('closed', () => {
    toastWindow = null;
    toastReady = false;
    pendingState = null;
  });

  return toastWindow;
}

function sendState(state) {
  if (!toastWindow || toastWindow.isDestroyed()) return;
  currentState = state;
  toastWindow.webContents.send('toast-state', state);

  // Toggle mouse events based on whether the state needs interaction
  const interactive = INTERACTIVE_STATES.has(state);
  toastWindow.setIgnoreMouseEvents(!interactive);
}

function showToast(state) {
  const win = createToastWindow();
  const pos = getToastPosition();
  win.setPosition(pos.x, pos.y, false);
  if (!win.isVisible()) {
    win.showInactive();
  }
  if (toastReady && !win.webContents.isLoading()) {
    sendState(state);
  } else {
    pendingState = state;
  }
}

function hideToast() {
  if (!toastWindow || toastWindow.isDestroyed()) return;
  pendingState = null;

  // If floating bar is enabled, go back to idle floating state instead of hiding
  if (config.getFloatingBarEnabled()) {
    sendState('floating-idle');
  } else {
    sendState('idle');
    toastWindow.hide();
  }
}

// Called on app startup when floating bar setting is enabled
function initFloatingBar() {
  if (!config.getFloatingBarEnabled()) return;
  showToast('floating-idle');
}

// Called when user toggles the floating bar on/off from settings
function setFloatingBarEnabled(enabled) {
  config.setFloatingBarEnabled(enabled);
  if (enabled) {
    // Only show floating-idle if not currently recording/transcribing
    const idle = currentState === 'idle' || !toastWindow || toastWindow.isDestroyed() || !toastWindow.isVisible();
    showToast('floating-idle');
    if (!idle) {
      // Already recording — leave current state, hideToast will return to floating-idle
    }
  } else {
    // Hide the bar unless we're in a recording/transcribing state
    if (currentState === 'floating-idle') {
      if (toastWindow && !toastWindow.isDestroyed()) {
        sendState('idle');
        toastWindow.hide();
      }
    }
  }
}

function destroyToast() {
  if (toastWindow && !toastWindow.isDestroyed()) {
    toastWindow.destroy();
    toastWindow = null;
  }
  toastReady = false;
  pendingState = null;
}

function sendToToast(channel, data) {
  if (toastWindow && !toastWindow.isDestroyed() && toastReady) {
    toastWindow.webContents.send(channel, data);
  }
}

function getToastWindow() {
  return toastWindow;
}

function getCurrentToastState() {
  return currentState;
}

module.exports = { showToast, hideToast, destroyToast, sendToToast, initFloatingBar, setFloatingBarEnabled, getToastWindow, getCurrentToastState, moveToast };
