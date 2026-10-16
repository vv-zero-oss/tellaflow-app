const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');

let tray = null;

function getIconPath() {
  const { app } = require('electron');
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'trayIconTemplate.png');
  }
  return path.join(__dirname, '..', '..', 'resources', 'trayIconTemplate.png');
}

/**
 * The menubar icon. Its menu is rebuilt on every click from `getTemplate()`
 * (see tray-menu.js); `beforeOpen()` may refresh what it shows first — it is
 * given at most `beforeOpenMs` so a slow refresh never holds the menu back.
 */
function createTray({ getTemplate, beforeOpen, beforeOpenMs = 300 }) {
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

  const open = async () => {
    if (beforeOpen) {
      await Promise.race([
        Promise.resolve().then(beforeOpen).catch(() => {}),
        new Promise((r) => setTimeout(r, beforeOpenMs)),
      ]);
    }
    if (!tray || tray.isDestroyed()) return;
    tray.popUpContextMenu(Menu.buildFromTemplate(getTemplate()));
  };
  tray.on('click', open);
  tray.on('right-click', open);

  return tray;
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
