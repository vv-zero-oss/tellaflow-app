const { BrowserWindow, screen, app } = require('electron');
const path = require('path');

let mainWindow = null;
const IS_MAC = process.platform === 'darwin';

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

  const windowOpts = {
    width: 1076,
    height: 800,
    minWidth: 680,
    minHeight: 420,
    backgroundColor: '#222226',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  };

  if (IS_MAC) {
    // macOS-specific chrome — inset title bar with traffic-light controls.
    windowOpts.titleBarStyle = 'hiddenInset';
    windowOpts.trafficLightPosition = { x: 16, y: 18 };
  } else {
    // On Windows we use the default OS frame so users get standard
    // minimise/maximise/close controls and consistent OS theming.
    windowOpts.icon = path.join(__dirname, '..', '..', 'resources', 'icon.png');
  }

  mainWindow = new BrowserWindow(windowOpts);

  const isDev = !require('electron').app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173/index.html');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    // On macOS, tray apps keep running with hidden windows so the user can
    // reopen via the Dock or menu bar. On Windows, closing the main window
    // just hides it — the app continues running in the system tray.
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      if (IS_MAC && app.dock) app.dock.hide();
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
  if (IS_MAC && app.dock) app.dock.show();
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
