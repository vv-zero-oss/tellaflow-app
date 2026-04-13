const { BrowserWindow } = require('electron');
const path = require('path');

let panelWindow = null;

function createPanelWindow(trayBounds) {
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.focus();
    return panelWindow;
  }

  const panelW = 340;
  const panelH = 460;

  let x = Math.round(trayBounds.x + trayBounds.width / 2 - panelW / 2);
  const y = trayBounds.y + trayBounds.height + 4;

  panelWindow = new BrowserWindow({
    width: panelW,
    height: panelH,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  panelWindow.loadFile(
    path.join(__dirname, '..', 'renderer', 'panel.html')
  );

  panelWindow.on('blur', () => {
    if (panelWindow && !panelWindow.isDestroyed()) {
      panelWindow.hide();
    }
  });

  panelWindow.on('closed', () => {
    panelWindow = null;
  });

  return panelWindow;
}

function togglePanel(trayBounds) {
  if (panelWindow && !panelWindow.isDestroyed() && panelWindow.isVisible()) {
    panelWindow.hide();
    return;
  }

  const win = createPanelWindow(trayBounds);
  win.show();
  win.focus();
}

function sendToPanel(channel, data) {
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.webContents.send(channel, data);
  }
}

function destroyPanel() {
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.destroy();
    panelWindow = null;
  }
}

module.exports = { togglePanel, sendToPanel, destroyPanel };
