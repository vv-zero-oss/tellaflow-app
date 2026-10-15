/**
 * The voice island window: a transparent, always-on-top window that hosts the
 * VoiceIsland component (src/renderer/src/IslandApp.tsx).
 *
 * The main process owns what the island shows. Callers use:
 *   showIsland(state, { content, answerKind, correctedWord, autoRestMs })
 *   restIsland()          → back to the resting state (idle dot, or hidden)
 *   setRestOverride(view) → a view to rest on instead (e.g. a meeting recording)
 *
 * The old floating-bar names (showToast / hideToast …) still work and map the
 * legacy states onto island states.
 */

const { BrowserWindow, screen } = require('electron');
const path = require('path');
const config = require('./config');

// Big enough for the largest card (320px wide + shadow); the island anchors
// to the window edge facing the screen edge, the rest is click-through.
const WIN_W = 400;
const WIN_H = 560;
const EDGE_GAP = 8;

const LEGACY = {
  'floating-idle': 'idle',
  recording: 'listening',
  'click-recording': 'dictating',
  transcribing: 'transcribing',
};

let win = null;
let ready = false;
let view = { state: 'none' };
let restOverride = null;
let autoRestTimer = null;
let hideTimer = null;
let interactive = false;
let onRest = null;

function placement() { return config.getIslandPlacement(); }

function windowBounds() {
  const cursor = screen.getCursorScreenPoint();
  const { x, y, width, height } = screen.getDisplayNearestPoint(cursor).workArea;
  switch (placement()) {
    case 'left':
      return { x: x + EDGE_GAP, y: Math.round(y + height / 2 - WIN_H / 2) };
    case 'right':
      return { x: x + width - WIN_W - EDGE_GAP, y: Math.round(y + height / 2 - WIN_H / 2) };
    default:
      return { x: Math.round(x + width / 2 - WIN_W / 2), y: y + height - WIN_H };
  }
}

function clickThrough() {
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(true, { forward: true });
}

function createWindow() {
  if (win && !win.isDestroyed()) return win;
  ready = false;
  const pos = windowBounds();
  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
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
    // macOS: a non-activating panel — clicking the island must not bring
    // Tellaflow (and its main window) to the front over the app in use.
    ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  clickThrough();

  win.webContents.on('did-finish-load', () => {
    ready = true;
    push();
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => console.error('Island window failed to load:', code, desc));

  if (!require('electron').app.isPackaged) {
    win.loadURL(require('./dev-server').devUrl('toast.html')).catch((err) => console.error('Island loadURL error:', err.message));
  } else {
    win.loadFile(path.join(__dirname, '..', '..', 'dist', 'renderer', 'toast.html'));
  }

  win.on('closed', () => { win = null; ready = false; });
  return win;
}

function push() {
  if (!win || win.isDestroyed() || !ready) return;
  win.webContents.send('island-update', {
    ...view,
    placement: placement(),
    material: config.getIslandMaterial(),
  });
}

function clearTimers() {
  if (autoRestTimer) { clearTimeout(autoRestTimer); autoRestTimer = null; }
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
}

/** Show a state. `autoRestMs` returns to rest afterwards (paused while hovered). */
function showIsland(state, { content, answerKind, correctedWord, autoRestMs } = {}) {
  clearTimers();
  view = { state, content: content || {}, answerKind: answerKind || 'text', correctedWord };
  if (state === 'none') {
    clickThrough();
    push();
    // Let the exit animation play before hiding the window.
    hideTimer = setTimeout(() => { if (view.state === 'none' && win && !win.isDestroyed()) win.hide(); }, 450);
    return;
  }
  const w = createWindow();
  if (!w.isVisible()) {
    const pos = windowBounds();
    w.setPosition(pos.x, pos.y, false);
    w.showInactive();
  }
  push();
  if (autoRestMs) scheduleRest(autoRestMs);
}

function scheduleRest(ms) {
  autoRestTimer = setTimeout(() => {
    autoRestTimer = null;
    if (interactive) { scheduleRest(1500); return; } // don't vanish under the pointer
    restIsland();
  }, ms);
}

function restView() {
  if (restOverride) return restOverride;
  return { state: config.getFloatingBarEnabled() ? 'idle' : 'none' };
}

/** Back to rest: a pinned view (meeting recording), the idle dot, or hidden. */
function restIsland() {
  const r = restView();
  showIsland(r.state, r);
  if (onRest) { try { onRest(); } catch (err) { console.error('[island] onRest failed:', err); } }
}

function setRestOverride(next) {
  restOverride = next;
}

function isResting() {
  const r = restView();
  return view.state === r.state;
}

function getIslandState() { return view.state; }
function getIslandView() { return view; }

function setIslandInteractive(on) {
  interactive = !!on;
  if (!win || win.isDestroyed()) return;
  if (interactive) win.setIgnoreMouseEvents(false);
  else clickThrough();
}

/** Re-anchor after the placement setting changes. */
function refreshPlacement() {
  if (!win || win.isDestroyed()) return;
  const pos = windowBounds();
  win.setPosition(pos.x, pos.y, false);
  push();
}

function onIslandRest(fn) { onRest = fn; }

// ── Legacy floating-bar API ──────────────────────────────────────────────────

function showToast(state) { showIsland(LEGACY[state] || state); }
function hideToast() { restIsland(); }
function initFloatingBar() { if (config.getFloatingBarEnabled()) restIsland(); }
function setFloatingBarEnabled(enabled) {
  config.setFloatingBarEnabled(enabled);
  if (isResting() || view.state === 'none' || view.state === 'idle') restIsland();
}
function destroyToast() {
  clearTimers();
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
  ready = false;
}
function sendToToast(channel, data) {
  if (win && !win.isDestroyed() && ready) win.webContents.send(channel, data);
}
function getToastWindow() { return win; }
function getCurrentToastState() { return view.state; }
function setToastInteractive(on) { setIslandInteractive(on); }

module.exports = {
  showIsland,
  restIsland,
  setRestOverride,
  isResting,
  getIslandState,
  getIslandView,
  setIslandInteractive,
  refreshPlacement,
  onIslandRest,
  showToast,
  hideToast,
  destroyToast,
  sendToToast,
  initFloatingBar,
  setFloatingBarEnabled,
  getToastWindow,
  getCurrentToastState,
  setToastInteractive,
};
