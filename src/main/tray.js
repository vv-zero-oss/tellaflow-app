const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');

let tray = null;
let onTrayClickFn = null;
let onStartRecordingFn = null;
let onCheckForUpdatesFn = null;
let onInstallUpdateFn = null;
let getUpdaterStatusFn = null;
let quitCallback = null;

function getIconPath() {
  const { app } = require('electron');
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'trayIconTemplate.png');
  }
  return path.join(__dirname, '..', '..', 'resources', 'trayIconTemplate.png');
}

function createTray({
  onQuit,
  onChangeHotkeyFn,
  onRetryHotkeyFn,
  onTrayClick,
  onStartRecording,
  onCheckForUpdates,
  onInstallUpdate,
  getUpdaterStatus,
}) {
  onTrayClickFn = onTrayClick;
  onStartRecordingFn = onStartRecording;
  onCheckForUpdatesFn = onCheckForUpdates;
  onInstallUpdateFn = onInstallUpdate;
  getUpdaterStatusFn = getUpdaterStatus;
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
  const status = getUpdaterStatusFn ? getUpdaterStatusFn() : null;
  const updateDownloaded = status && status.phase === 'downloaded';
  const updateChecking = status && status.phase === 'checking';

  const template = [
    {
      label: 'Open Tellaflow',
      click: () => { if (onTrayClickFn) onTrayClickFn(); },
    },
    {
      label: 'Start Recording',
      click: () => { if (onStartRecordingFn) onStartRecordingFn(); },
    },
    { type: 'separator' },
  ];

  if (updateDownloaded) {
    const ver = status.updateVersion ? ` (v${status.updateVersion})` : '';
    template.push({
      label: `Restart to install update${ver}`,
      click: () => { if (onInstallUpdateFn) onInstallUpdateFn(); },
    });
  } else {
    template.push({
      label: updateChecking ? 'Checking for Updates…' : 'Check for Updates…',
      enabled: !updateChecking,
      click: () => { if (onCheckForUpdatesFn) onCheckForUpdatesFn(); },
    });
  }

  template.push(
    { type: 'separator' },
    {
      label: 'Quit Tellaflow',
      click: () => { if (quitCallback) quitCallback(); },
    },
  );

  return Menu.buildFromTemplate(template);
}

function getTray() {
  return tray;
}

function destroyTray() {
  if (tray && !tray.isDestroyed()) {
    try { tray.destroy(); } catch {}
  }
  tray = null;
}

module.exports = { createTray, getTray, destroyTray };
