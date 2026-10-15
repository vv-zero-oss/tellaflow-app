const { BrowserWindow, screen, app } = require('electron');
const path = require('path');

let mainWindow = null;

function createMainWindow({ showOnReady = true } = {}) {
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
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    if (showOnReady) mainWindow.show();
  });

  // Anti-crash: if the renderer dies (OOM, GPU reset), reload it instead of
  // leaving a blank window.
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[main-window] renderer gone:', details.reason);
    if (details.reason === 'clean-exit') return;
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
    }, 500);
  });

  mainWindow.on('close', (e) => {
    if (!app.isQuitting && process.platform === 'darwin') {
      e.preventDefault();
      mainWindow.hide();
      if (app.dock) app.dock.hide();
      return;
    }
    mainWindow = null;
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function showMainWindow() {
  if (app.dock) app.dock.show();
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    createMainWindow();
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
