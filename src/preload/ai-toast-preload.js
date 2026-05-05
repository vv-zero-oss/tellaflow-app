const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aiToast', {
  onStateChange: (callback) => {
    ipcRenderer.on('ai-toast-state', (_, state) => callback(state));
  },
  sendAction: (action) => {
    ipcRenderer.send('ai-toast-action', action);
  },
  getState: () => ipcRenderer.invoke('ai-toast-get-state'),
});
