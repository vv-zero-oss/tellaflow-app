const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('audioPlayback', {
  onPlayAudio: (callback) => {
    ipcRenderer.on('play-audio', (_, data) => callback(data));
  },
  onStopAudio: (callback) => {
    ipcRenderer.on('stop-audio', () => callback());
  },
});
