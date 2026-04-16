const { BrowserWindow, screen, app } = require('electron');
const path = require('path');

let mainWindow = null;

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1076,
    height: 800,
    minWidth: 680,
    minHeight: 420,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: '#222226',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const isDev = !require('electron').app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173/index.html');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });


  mainWindow.on('close', (e) => {
    if (!app.isQuitting && process.platform === 'darwin') {
      e.preventDefault();
      mainWindow.hide();
      // Only hide the dock icon when the user has opted out of showing it there.
      // Always hiding it causes showMainWindow() to need to restore it, which
      // is async — hiding selectively avoids that race entirely.
      const config = require('./config');
      if (app.dock && !config.getShowInDock()) app.dock.hide();
      return;
    }
    mainWindow = null;
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

async function showMainWindow() {
  // On macOS, dock.show() is async. We must await it so the dock icon is
  // restored before calling win.show() — otherwise the OS silently blocks
  // an app-without-dock-presence from becoming the frontmost window.
  const config = require('./config');
  const wantsDock = config.getShowInDock();

  if (app.dock) await app.dock.show();

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    if (process.platform === 'darwin') app.focus({ steal: true });
  } else {
    createMainWindow();
  }

  // If the user has chosen to keep the dock hidden, hide it again after
  // the window has had a chance to come to front (~200 ms is enough).
  if (app.dock && !wantsDock) {
    setTimeout(() => { if (app.dock) app.dock.hide(); }, 200);
  }
}

function getMainWindow() {
  return mainWindow;
}

function sendToMainWindow(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function destroyMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
    mainWindow = null;
  }
}

module.exports = { createMainWindow, showMainWindow, getMainWindow, sendToMainWindow, destroyMainWindow };
