const { ipcMain } = require('electron');
const config = require('./config');

/**
 * Preset dictionary packs — registered after core IPC so these channels are always present.
 */
function registerDictionaryPackIpc() {
  ipcMain.handle('get-dictionary-packs-catalog', () => {
    return config.getDictionaryPacksCatalog();
  });
  ipcMain.handle('install-dictionary-pack', (_, packId) => {
    return config.installDictionaryPack(packId);
  });
  ipcMain.handle('uninstall-dictionary-pack', (_, packId) => {
    return config.uninstallDictionaryPack(packId);
  });
}

module.exports = { registerDictionaryPackIpc };
