const { app, Menu } = require('electron');

let onCheckForUpdatesFn = null;
let onInstallUpdateFn = null;
let getUpdaterStatusFn = null;

function buildAppMenu() {
  const status = getUpdaterStatusFn ? getUpdaterStatusFn() : null;
  const downloaded = status && status.phase === 'downloaded';
  const checking = status && status.phase === 'checking';

  const updateItem = downloaded
    ? {
        label: status.updateVersion
          ? `Restart to Install Update (v${status.updateVersion})`
          : 'Restart to Install Update',
        click: () => { if (onInstallUpdateFn) onInstallUpdateFn(); },
      }
    : {
        label: checking ? 'Checking for Updates…' : 'Check for Updates…',
        enabled: !checking,
        click: () => { if (onCheckForUpdatesFn) onCheckForUpdatesFn(); },
      };

  return Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        updateItem,
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [],
    },
  ]);
}

function applyAppMenu() {
  Menu.setApplicationMenu(buildAppMenu());
}

function createAppMenu({ onCheckForUpdates, onInstallUpdate, getUpdaterStatus }) {
  onCheckForUpdatesFn = onCheckForUpdates;
  onInstallUpdateFn = onInstallUpdate;
  getUpdaterStatusFn = getUpdaterStatus;
  applyAppMenu();
}

module.exports = { createAppMenu, refreshAppMenu: applyAppMenu };
