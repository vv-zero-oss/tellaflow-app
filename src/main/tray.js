const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');

let tray = null;
let onTrayClickFn = null;
let onStartRecordingFn = null;
let quitCallback = null;

function getIconPath() {
  const { app } = require('electron');
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'trayIconTemplate.png');
  }
  return path.join(__dirname, '..', '..', 'resources', 'trayIconTemplate.png');
}

function createTray({ onQuit, onChangeHotkeyFn, onRetryHotkeyFn, onTrayClick, onStartRecording }) {
  onTrayClickFn = onTrayClick;
  onStartRecordingFn = onStartRecording;
  quitCallback = onQuit;

  const iconPath = getIconPath();
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
    icon.setTemplateImage(true);
  } catch {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('Tellaflow');

  tray.on('click', () => {
    tray.popUpContextMenu(buildTrayMenu());
  });

  tray.on('right-click', () => {
    tray.popUpContextMenu(buildTrayMenu());
  });

  return tray;
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'Open Tellaflow',
      click: () => { if (onTrayClickFn) onTrayClickFn(); },
    },
    {
      label: 'Start Recording',
      click: () => { if (onStartRecordingFn) onStartRecordingFn(); },
    },
    { type: 'separator' },
    {
      label: 'Quit Tellaflow',
      click: () => { if (quitCallback) quitCallback(); },
    },
  ]);
}

function getTray() {
  return tray;
}

module.exports = { createTray, getTray };
