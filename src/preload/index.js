const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tellaflow', {
  // Audio capture IPC
  onStartRecording: (callback) => ipcRenderer.on('start-recording', (_, data) => callback(data)),
  onStopRecording: (callback) => ipcRenderer.on('stop-recording', callback),
  sendAudio: (pcmBuffer) => ipcRenderer.send('audio-captured', pcmBuffer),
  sendCaptureReady: () => ipcRenderer.send('capture-ready'),

  // Toast IPC
  onToastState: (callback) => { const h = (_, state) => callback(state); ipcRenderer.on('toast-state', h); return () => ipcRenderer.removeListener('toast-state', h); },
  onAudioLevel: (callback) => { const h = (_, level) => callback(level); ipcRenderer.on('audio-level', h); return () => ipcRenderer.removeListener('audio-level', h); },
  sendAudioLevel: (level) => ipcRenderer.send('audio-level', level),
  onToastHotkey: (callback) => { const h = (_, label) => callback(label); ipcRenderer.on('toast-hotkey', h); return () => ipcRenderer.removeListener('toast-hotkey', h); },

  // Floating bar click-to-dictate
  clickStartRecording: () => ipcRenderer.send('click-start-recording'),
  clickCancelRecording: () => ipcRenderer.send('click-cancel-recording'),
  clickFinishRecording: () => ipcRenderer.send('click-finish-recording'),
  recordFrontmostApp: () => ipcRenderer.send('record-frontmost-app'),
  suppressToastActivation: () => ipcRenderer.send('suppress-toast-activation'),
  setToastInteractive: (interactive) => ipcRenderer.send('set-toast-interactive', !!interactive),

  // Onboarding IPC
  setHotkey: (hotkey) => ipcRenderer.send('set-hotkey', hotkey),
  requestMicPermission: () => ipcRenderer.invoke('request-mic-permission'),
  checkAccessibility: () => ipcRenderer.invoke('check-accessibility'),
  checkMicPermission: () => ipcRenderer.invoke('check-mic-permission'),
  promptAccessibility: () => ipcRenderer.send('prompt-accessibility'),
  openAccessibilitySettings: () => ipcRenderer.send('open-accessibility-settings'),
  completeOnboarding: () => ipcRenderer.send('complete-onboarding'),
  dismissOnboarding: () => ipcRenderer.send('dismiss-onboarding'),
  warmUpModel: () => ipcRenderer.send('warm-up-model'),
  runModelTest: () => ipcRenderer.invoke('run-model-test'),
  setPlaygroundMode: (on) => ipcRenderer.send(on ? 'playground-mode-on' : 'playground-mode-off'),
  onPlaygroundText: (cb) => ipcRenderer.on('playground-text', (_, text) => cb(text)),
  offPlaygroundText: () => ipcRenderer.removeAllListeners('playground-text'),

  // Settings IPC
  getConfig: () => ipcRenderer.invoke('get-config'),
  setModel: (model) => ipcRenderer.send('set-model', model),
  setGrammarEnabled: (enabled) => ipcRenderer.send('set-grammar-enabled', enabled),
  setTheme: (theme) => ipcRenderer.send('set-theme', theme),

  // System settings
  getFloatingBarEnabled: () => ipcRenderer.invoke('get-floating-bar-enabled'),
  setFloatingBarEnabled: (enabled) => ipcRenderer.send('set-floating-bar-enabled', enabled),
  getSoundsEnabled: () => ipcRenderer.invoke('get-sounds-enabled'),
  setSoundsEnabled: (enabled) => ipcRenderer.send('set-sounds-enabled', enabled),
  getMuteWhileDictating: () => ipcRenderer.invoke('get-mute-while-dictating'),
  setMuteWhileDictating: (enabled) => ipcRenderer.send('set-mute-while-dictating', enabled),
  getShowInDock: () => ipcRenderer.invoke('get-show-in-dock'),
  setShowInDock: (enabled) => ipcRenderer.send('set-show-in-dock', enabled),
  getLaunchAtLogin: () => ipcRenderer.invoke('get-launch-at-login'),
  setLaunchAtLogin: (enabled) => ipcRenderer.send('set-launch-at-login', enabled),
  getTranslationEnabled: () => ipcRenderer.invoke('get-translation-enabled'),
  setTranslationEnabled: (enabled) => ipcRenderer.send('set-translation-enabled', enabled),
  getTranslationLanguage: () => ipcRenderer.invoke('get-translation-language'),
  setTranslationLanguage: (lang) => ipcRenderer.send('set-translation-language', lang),

  // Dictionary management
  getDictionary: () => ipcRenderer.invoke('get-dictionary'),
  addDictionaryEntry: (from, to) => ipcRenderer.invoke('add-dictionary-entry', { from, to }),
  removeDictionaryEntry: (id) => ipcRenderer.invoke('remove-dictionary-entry', id),
  updateDictionaryEntry: (id, from, to) => ipcRenderer.invoke('update-dictionary-entry', { id, from, to }),
  getDictionaryPacksCatalog: () => ipcRenderer.invoke('get-dictionary-packs-catalog'),
  installDictionaryPack: (packId) => ipcRenderer.invoke('install-dictionary-pack', packId),
  uninstallDictionaryPack: (packId) => ipcRenderer.invoke('uninstall-dictionary-pack', packId),

  // Snippets management
  getSnippets: () => ipcRenderer.invoke('get-snippets'),
  addSnippet: (trigger, content) => ipcRenderer.invoke('add-snippet', { trigger, content }),
  removeSnippet: (id) => ipcRenderer.invoke('remove-snippet', id),
  updateSnippet: (id, trigger, content) => ipcRenderer.invoke('update-snippet', { id, trigger, content }),

  // Model management
  getModels: () => ipcRenderer.invoke('get-models'),
  startDownload: (modelKey) => ipcRenderer.send('start-download', modelKey),
  pauseDownload: (modelKey) => ipcRenderer.send('pause-download', modelKey),
  cancelDownload: (modelKey) => ipcRenderer.send('cancel-download', modelKey),
  deleteModel: (modelKey) => ipcRenderer.send('delete-model', modelKey),
  onDownloadProgress: (callback) => { const h = (_, p) => callback(p); ipcRenderer.on('download-progress', h); return () => ipcRenderer.removeListener('download-progress', h); },
  onDownloadError: (callback) => { const h = (_, e) => callback(e); ipcRenderer.on('download-error', h); return () => ipcRenderer.removeListener('download-error', h); },
  onModelsChanged: (callback) => { const h = (_, m) => callback(m); ipcRenderer.on('models-changed', h); return () => ipcRenderer.removeListener('models-changed', h); },

  // Parakeet model management
  getParakeetStatus: () => ipcRenderer.invoke('get-parakeet-status'),
  startParakeetDownload: () => ipcRenderer.send('start-parakeet-download'),
  cancelParakeetDownload: () => ipcRenderer.send('cancel-parakeet-download'),
  deleteParakeet: () => ipcRenderer.send('delete-parakeet'),
  onParakeetDownloadProgress: (cb) => { const h = (_, p) => cb(p); ipcRenderer.on('parakeet-download-progress', h); return () => ipcRenderer.removeListener('parakeet-download-progress', h); },
  onParakeetDownloadError: (cb) => { const h = (_, e) => cb(e); ipcRenderer.on('parakeet-download-error', h); return () => ipcRenderer.removeListener('parakeet-download-error', h); },
  onParakeetStatusChanged: (cb) => { const h = (_, s) => cb(s); ipcRenderer.on('parakeet-status-changed', h); return () => ipcRenderer.removeListener('parakeet-status-changed', h); },

  // Microphone device selection
  setMicrophoneDeviceId: (deviceId) => ipcRenderer.send('set-microphone-device-id', deviceId),

  // Transcription engine
  setTranscriptionEngine: (engine) => ipcRenderer.send('set-transcription-engine', engine),
  onConfigChanged: (cb) => { const h = (_, c) => cb(c); ipcRenderer.on('config-changed', h); return () => ipcRenderer.removeListener('config-changed', h); },

  // Permission grant actions
  grantMic: () => ipcRenderer.invoke('grant-mic'),
  grantAccessibility: () => ipcRenderer.send('grant-accessibility'),
  retryHotkey: () => ipcRenderer.send('retry-hotkey'),
  checkNeedsRestart: () => ipcRenderer.invoke('check-needs-restart'),
  restartApp: () => ipcRenderer.send('restart-app'),

  // History IPC
  getHistory: () => ipcRenderer.invoke('get-history'),
  clearHistory: () => ipcRenderer.send('clear-history'),
  deleteHistoryEntry: (id) => ipcRenderer.invoke('delete-history-entry', id),
  getAudioData: (filePath) => ipcRenderer.invoke('get-audio-data', filePath),
  copyToClipboard: (text) => ipcRenderer.send('copy-to-clipboard', text),
  pasteText: (text) => ipcRenderer.send('paste-text', text),
  onHistoryUpdate: (callback) => { const h = (_, entries) => callback(entries); ipcRenderer.on('history-update', h); return () => ipcRenderer.removeListener('history-update', h); },

  // Status updates
  onStatusChange: (callback) => { const h = (_, status) => callback(status); ipcRenderer.on('status-change', h); return () => ipcRenderer.removeListener('status-change', h); },
  onShowRestartBanner: (callback) => { const h = () => callback(); ipcRenderer.on('show-restart-banner', h); return () => ipcRenderer.removeListener('show-restart-banner', h); },
  onAccessibilityGranted: (callback) => { const h = () => callback(); ipcRenderer.on('accessibility-granted', h); return () => ipcRenderer.removeListener('accessibility-granted', h); },

  // Grammar model management
  getGrammarModelsStatus: () => ipcRenderer.invoke('get-grammar-models-status'),
  startGrammarDownload: (modelKey) => ipcRenderer.send('start-grammar-download', modelKey),
  pauseGrammarDownload: (modelKey) => ipcRenderer.send('pause-grammar-download', modelKey),
  cancelGrammarDownload: (modelKey) => ipcRenderer.send('cancel-grammar-download', modelKey),
  deleteGrammarModel: (modelKey) => ipcRenderer.send('delete-grammar-model', modelKey),
  setGrammarModel: (modelKey) => ipcRenderer.send('set-grammar-model', modelKey),
  getGrammarTone: () => ipcRenderer.invoke('get-grammar-tone'),
  setGrammarTone: (tone) => ipcRenderer.send('set-grammar-tone', tone),
  onGrammarModelProgress: (cb) => { const h = (_, p) => cb(p); ipcRenderer.on('grammar-model-progress', h); return () => ipcRenderer.removeListener('grammar-model-progress', h); },
  onGrammarModelChanged: (cb) => { const h = (_, s) => cb(s); ipcRenderer.on('grammar-model-changed', h); return () => ipcRenderer.removeListener('grammar-model-changed', h); },
  onGrammarModelError: (cb) => { const h = (_, e) => cb(e); ipcRenderer.on('grammar-model-error', h); return () => ipcRenderer.removeListener('grammar-model-error', h); },

  // Bulk data reset
  clearSnippets: () => ipcRenderer.invoke('clear-snippets'),
  clearDictionary: () => ipcRenderer.invoke('clear-dictionary'),
  resetPermissions: () => ipcRenderer.invoke('reset-permissions'),

  // Open external URL in default browser
  openExternal: (url) => ipcRenderer.send('open-external', url),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Auto-update
  getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),
  checkForUpdates: () => ipcRenderer.send('check-for-updates'),
  installUpdate: () => ipcRenderer.send('install-update'),
  onUpdateStatus: (cb) => {
    const h = (_, status) => cb(status);
    ipcRenderer.on('update-status', h);
    return () => ipcRenderer.removeListener('update-status', h);
  },

  // Test WAV
  openTestWav: () => ipcRenderer.send('open-test-wav'),

  // Hotkey recording (main-process keyspy — supports fn and all system keys)
  startHotkeyRecording: () => ipcRenderer.send('start-hotkey-recording'),
  stopHotkeyRecording: () => ipcRenderer.send('stop-hotkey-recording'),
  onHotkeyRecorded: (cb) => {
    ipcRenderer.removeAllListeners('hotkey-recorded');
    ipcRenderer.once('hotkey-recorded', (_, data) => cb(data));
  },
  onHotkeyRecordingCancelled: (cb) => {
    ipcRenderer.removeAllListeners('hotkey-recording-cancelled');
    ipcRenderer.once('hotkey-recording-cancelled', () => cb());
  },
});
