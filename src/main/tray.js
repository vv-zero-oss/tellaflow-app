const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');

let tray = null;
let onTrayClickFn = null;
let onStartRecordingFn = null;
let onCheckForUpdatesFn = null;
let onInstallUpdateFn = null;
let getUpdaterStatusFn = null;
let quitCallback = null;

const IS_MAC = process.platform === 'darwin';

function getIconPath() {
  const { app } = require('electron');
  // On macOS we use a black-on-transparent template image so the menu-bar
  // auto-inverts it for light/dark themes. On Windows the system tray is
  // typically dark in the default theme and accepts full-colour icons —
  // we ship a coloured 16/32px PNG built from the app icon.
  if (IS_MAC) {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'trayIconTemplate.png')
      : path.join(__dirname, '..', '..', 'resources', 'trayIconTemplate.png');
  }
  // Windows tray icon — use the app icon. .ico is preferred on Windows; we
  // fall back to the high-resolution PNG if no .ico is shipped.
  const winIco = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(__dirname, '..', '..', 'resources', 'icon.ico');
  const fs = require('fs');
  if (fs.existsSync(winIco)) return winIco;
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '..', '..', 'resources', 'icon.png');
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
    if (IS_MAC) icon.setTemplateImage(true);
    // On Windows, downscale large source PNGs so the tray icon renders at
    // the right size in the notification area (typically 16x16 or 24x24).
    if (!IS_MAC && !icon.isEmpty()) {
      const size = icon.getSize();
      if (size.width > 32 || size.height > 32) {
        icon = icon.resize({ width: 16, height: 16 });
      }
    }
  } catch {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('Tellaflow');

  tray.on('click', () => {
    if (IS_MAC) {
      tray.popUpContextMenu(buildTrayMenu());
    } else {
      // On Windows, a single click on the tray icon traditionally opens the
      // app; right-click shows the context menu (handled below).
      if (onTrayClickFn) onTrayClickFn();
    }
  });

  tray.on('right-click', () => {
    tray.popUpContextMenu(buildTrayMenu());
  });

  if (!IS_MAC) {
    // Also set a default context menu so the Windows shell exposes it even
    // before our right-click handler fires.
    tray.setContextMenu(buildTrayMenu());
  }

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

module.exports = { createTray, getTray };
