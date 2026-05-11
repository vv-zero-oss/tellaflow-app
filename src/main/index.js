// Safety net: keyspy's native binary can exit abruptly (e.g. fn/Globe key on Apple Silicon),
// causing a synchronous EPIPE when writing its stdin acknowledgment. Suppress those so
// Electron doesn't show the fatal error dialog — the onError callback will restart the listener.
process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE') {
    console.warn('[keyspy] Suppressed uncaught EPIPE – native process likely exited:', err.message);
    return;
  }
  // Re-throw anything else so Electron's default handler shows the dialog.
  throw err;
});

const { app, ipcMain, BrowserWindow, Notification, clipboard, dialog, shell } = require('electron');
const path = require('path');
const config = require('./config');
const { createTray, getTray } = require('./tray');
const { createOnboardingWindow, closeOnboarding, getOnboardingWindow } = require('./onboarding');
const hotkey = require('./hotkey');
const whisper = require('./whisper');
const parakeet = require('./parakeet');
const { pasteText } = require('./paste');
const permissions = require('./permissions');
const models = require('./models');
const { trimSilence, normalizeVolume } = require('./audio-preprocess');
const { encodePcmToWav } = require('./audio-utils');
const { formatTranscription } = require('./formatter');
const grammar = require('./grammar');
const { applyDictionary } = require('./dictionary');
const snippets = require('./snippets');
const { showToast, hideToast, destroyToast, sendToToast, initFloatingBar, setFloatingBarEnabled: toastSetFloatingBarEnabled, getToastWindow, getCurrentToastState, setToastInteractive } = require('./toast');
const { showMainWindow, sendToMainWindow, destroyMainWindow, createMainWindow } = require('./main-window');
const { getFrontmostAppSync, getFrontmostAppAsync } = require('./platform-shell');
const history = require('./history');
const { closeDb } = require('./db');
const { registerDictionaryPackIpc } = require('./dictionary-pack-ipc');
const sounds = require('./sounds');
const { runStartupSmokeTest } = require('./startup-smoke-test');
const updater = require('./updater');
const { createAppMenu, refreshAppMenu } = require('./app-menu');

// Whisper outputs non-speech annotations in several forms — strip them all
// so they never reach history or clipboard.
//   [BLANK_AUDIO], [NOISE], etc.  — bracketed uppercase tokens
//   (wind blowing), (heartbeat)   — parenthesised sound descriptions
//   *singing*, *laughing*         — asterisk-wrapped action notes
const WHISPER_ARTIFACT_RE =
  /\[\s*(?:BLANK_AUDIO|INAUDIBLE|NOISE|MUSIC|APPLAUSE|LAUGHTER|SILENCE|NO_SPEECH|inaudible|blank_audio)\s*\]|\([^)]+\)|\*[^*]+\*/gi;

function stripWhisperArtifacts(text) {
  if (!text) return '';
  const cleaned = text.replace(WHISPER_ARTIFACT_RE, '').trim();
  return cleaned;
}

// Throttles a progress callback so it fires at most once per `intervalMs`. The
// terminal event (downloaded === total) is always forwarded so the UI doesn't
// stall at 99% just because the previous tick fell inside the throttle window.
// Without this, multi-GB model downloads can fire thousands of IPC messages.
function throttleProgress(fn, intervalMs = 100) {
  let lastSent = 0;
  return (progress) => {
    const now = Date.now();
    const isTerminal = progress && progress.total > 0 && progress.downloaded >= progress.total;
    if (isTerminal || now - lastSent >= intervalMs) {
      lastSent = now;
      fn(progress);
    }
  };
}

let audioCaptureWindow = null;
let isQuitting = false;
let pendingStop = false;
let recordingTimeout = null;
// Grace period after hotkey release — keeps the mic open a little longer so the
// user's last word isn't clipped when they lift the key slightly before finishing.
const RELEASE_GRACE_MS = 400;
// Safety cap for *click-to-record* only. The hotkey path is bounded by key
// release, so it has no auto-stop. Click mode has no terminator, so without
// this an accidental click would leave the mic running until the app quits.
const CLICK_MODE_MAX_RECORDING_MS = 30 * 60 * 1000;
let accessibilityInitialState = null; // null = not yet checked

// App captured at recording-start (before Electron stole focus).
// Used as a fallback if Electron is still frontmost when paste fires.
let clickPasteTargetApp = null;

// Returns the name of the current frontmost application asynchronously.
// EC2 — resolves null after 800 ms if the underlying OS query hangs, preventing
// the audio-captured handler from stalling indefinitely. Cross-platform:
// osascript on macOS, PowerShell + Win32 GetForegroundWindow on Windows.
function getFrontmostApp() {
  return getFrontmostAppAsync(800);
}

// True when the given app name is our own Electron process (not a real user app).
function isOwnApp(name) {
  if (!name) return true;
  const own = app.getName();
  return name === 'Electron' || name === own;
}

// Suppresses the app.on('activate') → showMainWindow() call that fires
// when the user clicks the toast window and Electron becomes frontmost.
let suppressActivationShow = false;
let suppressActivationTimer = null;

function suppressNextActivation() {
  if (suppressActivationTimer) clearTimeout(suppressActivationTimer);
  suppressActivationShow = true;
  suppressActivationTimer = setTimeout(() => {
    suppressActivationShow = false;
    suppressActivationTimer = null;
  }, 5000);
}

app.setName('Tellaflow');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on('second-instance', () => {
  showMainWindow();
});

function performCleanup() {
  try { parakeet.free(); } catch (e) { console.error('parakeet.free error:', e); }
  try { hotkey.stop(); } catch (e) { console.error('hotkey.stop error:', e); }
  try { grammar.dispose(); } catch (e) { console.error('grammar.dispose error:', e); }
  try { destroyToast(); } catch (e) { console.error('destroyToast error:', e); }
  try { destroyAudioCaptureWindow(); } catch (e) { console.error('destroyAudioCaptureWindow error:', e); }
  try { destroyMainWindow(); } catch (e) { console.error('destroyMainWindow error:', e); }
  try { closeDb(); } catch (e) { console.error('closeDb error:', e); }
}

function gracefulQuit() {
  if (isQuitting) return;
  isQuitting = true;
  app.isQuitting = true;
  performCleanup();

  // Force-exit after 3s if cleanup or app.quit() hangs (e.g. native addon keeps event loop alive)
  setTimeout(() => {
    console.warn('Graceful quit timed out, forcing exit.');
    process.exit(0);
  }, 3000).unref();

  app.quit();
}

app.whenReady().then(async () => {
  createAppMenu({
    onCheckForUpdates: () => updater.checkForUpdates({ silent: false }),
    onInstallUpdate: () => updater.quitAndInstall(),
    getUpdaterStatus: () => updater.getStatus(),
  });

  createTray({
    onQuit: gracefulQuit,
    onChangeHotkeyFn: () => {
      createOnboardingWindow();
    },
    onRetryHotkeyFn: () => {
      startHotkeyListener();
    },
    onTrayClick: () => {
      showMainWindow();
    },
    onCheckForUpdates: () => {
      updater.checkForUpdates({ silent: false });
    },
    onInstallUpdate: () => {
      updater.quitAndInstall();
    },
    getUpdaterStatus: () => updater.getStatus(),
    onStartRecording: () => {
      // Capture frontmost app synchronously before the menu click steals focus
      clickPasteTargetApp = null;
      const name = getFrontmostAppSync(800);
      if (name && !isOwnApp(name)) clickPasteTargetApp = name;
      startClickRecording();
    },
  });

  accessibilityInitialState = permissions.isTrustedAccessibility();
  console.log('Accessibility initial state:', accessibilityInitialState);

  // Clean boot: accessibility already granted, so clear any stale "needs restart" flag
  if (accessibilityInitialState) {
    config.setAccessibilityGrantedOnce(false);
  }

  registerIPC();
  registerDictionaryPackIpc();

  // Ensure recordings directory exists
  const fs = require('fs');
  const recordingsDir = path.join(app.getPath('userData'), 'recordings');
  if (!fs.existsSync(recordingsDir)) fs.mkdirSync(recordingsDir, { recursive: true });

  if (!config.isOnboardingComplete()) {
    const onboardingWin = createOnboardingWindow();
    // Safety net: if the onboarding window is closed by any means that bypasses
    // the IPC handlers (Cmd+W, force-close, etc.) still start the app so it
    // remains functional in the tray for this session.
    // complete-onboarding sets onboardingComplete=true BEFORE closing the window,
    // so the check below correctly skips calling startApp() a second time.
    onboardingWin.once('closed', () => {
      if (!config.isOnboardingComplete()) {
        startApp().catch(err => console.error('[onboarding] startApp after unexpected close:', err));
      }
    });
  } else {
    await startApp();
  }
});

app.on('activate', () => {
  if (isQuitting) return;
  // Never show the main window when the toast bar is interactive — the click
  // that activated Electron came from the floating bar, not the Dock/app icon.
  // Using the current toast state (not a timer) means this is reliable even
  // if the user pauses on the bar for longer than any fixed timeout.
  const toastState = getCurrentToastState();
  if (toastState === 'floating-idle' || toastState === 'click-recording') return;
  if (!suppressActivationShow) showMainWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
  app.isQuitting = true;
});

app.on('will-quit', () => {
  performCleanup();

  // Safety net: force exit if native addons (keyspy, etc.) keep the event loop alive
  setTimeout(() => {
    console.warn('will-quit cleanup timed out, forcing exit.');
    process.exit(0);
  }, 3000).unref();
});

app.on('window-all-closed', () => {
  // Tellaflow is a tray-resident app on every platform — when the last window
  // closes the app keeps running so the user can dictate via the hotkey and
  // reopen the main window from the tray icon.
});

async function startApp() {
  createMainWindow();

  // Wire updater listeners BEFORE the slow model load below so the tray's
  // "Check for Updates…" works even during startup. initAutoUpdater is a no-op
  // in dev (app is not packaged), and the first silent check is delayed 30s
  // internally so it never competes with startup work.
  updater.initAutoUpdater({
    broadcast: (status) => {
      sendToMainWindow('update-status', status);
      // Rebuild the app menu so the item flips between "Check for Updates…"
      // and "Restart to Install Update (vX.Y.Z)" as state changes.
      refreshAppMenu();
    },
  });

  if (app.dock) app.dock.show();

  let modelKey = config.getModel();

  if (!models.isModelAvailable(modelKey)) {
    const configuredKey = modelKey;

    if (models.isModelAvailable('small')) {
      // Silently fall back to small and persist the change
      config.setModel('small');
      modelKey = 'small';
      new Notification({
        title: 'Tellaflow — Model Changed',
        body: `"${configuredKey}" model not found. Switched to the Small model automatically.`,
      }).show();
      broadcastStatus('Switched to Small model');
      sendToMainWindow('models-changed', models.getModelsStatus());
    } else {
      // No model available at all — prompt the user to download one
      broadcastStatus('No model downloaded');
      new Notification({
        title: 'Tellaflow — No Model Found',
        body: 'No transcription model is available. Please download one from Settings → Models.',
      }).show();
    }
  }

  if (models.isModelAvailable(modelKey)) {
    broadcastStatus('Loading model...');
    try {
      await whisper.loadModel(modelKey);
      await whisper.warmup();
      broadcastStatus('Ready');

      // Run first-install smoke test in the background — never blocks startup.
      const testAudioPath = app.isPackaged
        ? path.join(process.resourcesPath, 'test.mp3')
        : path.join(__dirname, '..', '..', 'resources', 'test.mp3');

      runStartupSmokeTest({
        userDataPath: app.getPath('userData'),
        audioPath: testAudioPath,
        transcribeFn: (pcm) => whisper.transcribe(pcm),
      }).then(() => {
        console.log('[smoke-test] Test complete.');
      }).catch((err) => {
        // Absolute last-resort guard — should never reach here since
        // runStartupSmokeTest already swallows all internal errors.
        console.error('[smoke-test] Unexpected error:', err.message);
      });
    } catch (err) {
      console.error('Model load failed:', err);
      broadcastStatus('Model load failed');
    }
  }

  // Pre-load the grammar model in the background so the first correction
  // doesn't stall waiting for the worker to fork and mmap the GGUF file.
  if (config.getGrammarEnabled() && grammar.isModelAvailable()) {
    grammar.warmup().catch(err => console.warn('Grammar warmup failed:', err.message));
  }

  startHotkeyListener();
  initFloatingBar();

  // Respect showInDock setting on startup
  if (!config.getShowInDock()) {
    if (app.dock) app.dock.hide();
  }
}

function broadcastStatus(text) {
  sendToMainWindow('status-change', text);
}

function clearRecordingTimeout() {
  if (recordingTimeout) {
    clearTimeout(recordingTimeout);
    recordingTimeout = null;
  }
}

function forceStopRecording() {
  console.warn('Force-stopping click-mode recording (30-min safety cap reached).');
  clearRecordingTimeout();
  pendingStop = false;
  hotkey.resetRecordingState();
  sounds.unmuteMusic();
  // Long click-mode recording: the captured target app is stale; let
  // getFrontmostApp() at paste time pick the current window instead.
  clickPasteTargetApp = null;

  if (audioCaptureWindow && !audioCaptureWindow.isDestroyed()) {
    try { audioCaptureWindow.webContents.send('stop-recording'); } catch {}
  }
  setTimeout(() => {
    destroyAudioCaptureWindow();
    hideToast();
    broadcastStatus('Ready');
  }, 500);
}

function startClickRecording() {
  pendingStop = false;
  clearRecordingTimeout();
  sounds.playStart();
  sounds.muteMusic();
  broadcastStatus('Recording...');
  showToast('click-recording');
  createAudioCaptureWindow();
  recordingTimeout = setTimeout(forceStopRecording, CLICK_MODE_MAX_RECORDING_MS);
}

function startHotkeyListener() {
  try {
    hotkey.start({
      onStart: () => {
        // Capture the frontmost app SYNCHRONOUSLY and BEFORE createAudioCaptureWindow().
        // An async query races with window creation — creating a new BrowserWindow
        // can briefly activate Electron, corrupting a concurrent foreground query
        // and making it return 'Electron' instead of the user's app.
        clickPasteTargetApp = null;
        const name = getFrontmostAppSync(500);
        if (name && !isOwnApp(name)) {
          clickPasteTargetApp = name;
        }

        pendingStop = false;
        clearRecordingTimeout();
        sounds.playStart();
        sounds.muteMusic();
        broadcastStatus('Recording...');
        showToast('recording');
        createAudioCaptureWindow();
      },
      onStop: ({ cancelled, reason }) => {
        clearRecordingTimeout();
        sounds.playStop();
        sounds.unmuteMusic();

        if (cancelled) {
          pendingStop = false;
          clickPasteTargetApp = null;
          destroyAudioCaptureWindow();
          hideToast();
          broadcastStatus('Ready');
          return;
        }

        // Keep the mic open briefly after key release so the user's last
        // syllable isn't clipped — they often lift the key a split-second
        // before finishing the final word.
        setTimeout(() => {
          if (audioCaptureWindow && !audioCaptureWindow.isDestroyed()) {
            if (audioCaptureWindow.webContents.isLoading()) {
              console.log('Audio window still loading — deferring stop.');
              pendingStop = true;
            } else {
              audioCaptureWindow.webContents.send('stop-recording');
            }
          } else {
            hideToast();
            broadcastStatus('Ready');
          }
        }, RELEASE_GRACE_MS);
      },
    });
    // Hotkey started successfully.
    // Only clear the restart-needed flag when accessibility was already trusted at
    // launch (accessibilityInitialState === true). If accessibility was just granted
    // mid-session (accessibilityInitialState === false), the native event tap may
    // not have activated yet on this process — keep the flag so the main window's
    // restart prompt stays visible and the user is guided to restart.
    if (accessibilityInitialState) {
      config.setAccessibilityGrantedOnce(false);
    } else if (config.getAccessibilityGrantedOnce()) {
      // Accessibility was granted during this session; the hotkey listener started
      // but the event tap might not capture keys until the app restarts.
      broadcastStatus('Restart required');
      // Slight delay so the main window has time to mount its IPC listeners
      // before we send the banner event.
      setTimeout(() => sendToMainWindow('show-restart-banner'), 1500);
    }
  } catch (err) {
    console.warn('Hotkey listener failed:', err.message);

    const accGranted = permissions.isTrustedAccessibility();
    if (accGranted) {
      config.setAccessibilityGrantedOnce(true);
      broadcastStatus('Restart required');
      sendToMainWindow('show-restart-banner');
      new Notification({
        title: 'Tellaflow',
        body: 'Accessibility is granted but a restart is needed for the hotkey to work.',
      }).show();
    } else {
      broadcastStatus('Accessibility required');
      new Notification({
        title: 'Tellaflow',
        body: 'Grant Accessibility permission to enable the hotkey. Use the tray menu to retry.',
      }).show();
    }
  }
}

function createAudioCaptureWindow() {
  if (audioCaptureWindow && !audioCaptureWindow.isDestroyed()) {
    audioCaptureWindow.webContents.send('start-recording', { deviceId: config.getMicrophoneDeviceId() });
    return;
  }

  audioCaptureWindow = new BrowserWindow({
    show: false,
    focusable: false,
    width: 1,
    height: 1,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  audioCaptureWindow.loadFile(
    path.join(__dirname, '..', 'renderer', 'audio-capture.html')
  );
}

function destroyAudioCaptureWindow() {
  pendingStop = false;
  if (audioCaptureWindow && !audioCaptureWindow.isDestroyed()) {
    audioCaptureWindow.destroy();
  }
  audioCaptureWindow = null;
}

function registerIPC() {
  // Onboarding
  ipcMain.on('set-hotkey', (_, hotkeyData) => {
    config.setHotkey(hotkeyData);
    // Notify the settings UI so the displayed label updates immediately
    sendToMainWindow('config-changed', { hotkey: hotkeyData });
    // Update the floating bar hint label
    sendToToast('toast-hotkey', hotkeyData?.label || '');
  });

  ipcMain.handle('request-mic-permission', async () => {
    return await permissions.requestMicrophone();
  });

  ipcMain.handle('check-accessibility', () => {
    const granted = permissions.isTrustedAccessibility();
    if (accessibilityInitialState === null) {
      accessibilityInitialState = granted;
    }
    // Accessibility was just granted this session (wasn't granted at launch)
    if (granted && !accessibilityInitialState && !config.getAccessibilityGrantedOnce()) {
      config.setAccessibilityGrantedOnce(true);
      // Broadcast to all windows so they can show a restart prompt
      BrowserWindow.getAllWindows().forEach(w => {
        if (!w.isDestroyed()) w.webContents.send('accessibility-granted');
      });
    }
    return granted;
  });

  ipcMain.handle('check-mic-permission', () => {
    return permissions.getMicrophoneStatus() === 'granted';
  });

  ipcMain.on('prompt-accessibility', () => {
    permissions.promptAccessibility();
  });

  ipcMain.on('open-accessibility-settings', () => {
    permissions.openAccessibilityPrefs();
  });

  ipcMain.on('complete-onboarding', async () => {
    // Clear playground mode immediately — the onboarding window is about to be
    // destroyed and its renderer can no longer send 'playground-mode-off', so
    // we must reset the flag here before startApp() registers the hotkey listener.
    playgroundMode = false;
    config.setOnboardingComplete(true);
    closeOnboarding();
    await startApp();
  });

  ipcMain.on('dismiss-onboarding', () => {
    closeOnboarding();
  });

  // Triggered by the onboarding renderer when the user reaches the final step.
  // Loads + warms up the active model in the background using the bundled
  // test.mp3 so model weights are in memory before the first real dictation.
  ipcMain.on('warm-up-model', () => {
    const { warmUpModel } = require('./model-warmup');
    const { decodeWithFfmpeg } = require('./startup-smoke-test');

    const testAudioPath = app.isPackaged
      ? path.join(process.resourcesPath, 'test.mp3')
      : path.join(__dirname, '..', '..', 'resources', 'test.mp3');

    const engine = config.getTranscriptionEngine();
    const useParakeet = engine === 'parakeet' && parakeet.isAvailable();

    const opts = useParakeet
      ? {
          audioPath: testAudioPath,
          decodeFn: decodeWithFfmpeg,
          isAvailableFn: () => parakeet.isAvailable(),
          isLoadedFn: () => parakeet.isLoaded(),
          loadFn: () => parakeet.loadModel(),
          transcribeFn: (pcm) => parakeet.transcribe(pcm),
        }
      : {
          audioPath: testAudioPath,
          decodeFn: decodeWithFfmpeg,
          isAvailableFn: () => models.isModelAvailable(config.getModel()),
          isLoadedFn: () => !!require('./whisper').isLoaded?.(),
          transcribeFn: async (pcm) => {
            await whisper.loadModel(config.getModel());
            return whisper.transcribe(pcm);
          },
        };

    warmUpModel(opts).catch((err) => {
      console.error('[warm-up] Unexpected top-level error:', err.message);
    });
  });

  // Returns the model test result so the onboarding playground can confirm
  // the transcription pipeline is working before the user does a live dry-run.
  // A dedup promise ensures React StrictMode's double-invoke (and any other
  // rapid-fire calls) share a single in-flight test rather than crashing the
  // native addon with concurrent transcriptions.
  let _modelTestPromise = null;
  ipcMain.handle('run-model-test', async () => {
    if (_modelTestPromise) return _modelTestPromise;

    const { warmUpModel } = require('./model-warmup');
    const { decodeWithFfmpeg } = require('./startup-smoke-test');

    const testAudioPath = app.isPackaged
      ? path.join(process.resourcesPath, 'test.mp3')
      : path.join(__dirname, '..', '..', 'resources', 'test.mp3');

    const engine = config.getTranscriptionEngine();
    const useParakeet = engine === 'parakeet' && parakeet.isAvailable();

    const opts = useParakeet
      ? {
          audioPath: testAudioPath,
          decodeFn: decodeWithFfmpeg,
          isAvailableFn: () => parakeet.isAvailable(),
          isLoadedFn: () => parakeet.isLoaded(),
          loadFn: () => parakeet.loadModel(),
          transcribeFn: (pcm) => parakeet.transcribe(pcm),
        }
      : {
          audioPath: testAudioPath,
          decodeFn: decodeWithFfmpeg,
          isAvailableFn: () => models.isModelAvailable(config.getModel()),
          isLoadedFn: () => !!require('./whisper').isLoaded?.(),
          transcribeFn: async (pcm) => {
            await whisper.loadModel(config.getModel());
            return whisper.transcribe(pcm);
          },
        };

    _modelTestPromise = warmUpModel(opts)
      .catch((err) => ({ skipped: true, reason: 'error', error: err.message }))
      .finally(() => { _modelTestPromise = null; });

    return _modelTestPromise;
  });

  // Playground mode: when active, transcription results are routed back to the
  // onboarding window instead of being pasted into external apps.
  let playgroundMode = false;
  ipcMain.on('playground-mode-on',  () => { playgroundMode = true; });
  ipcMain.on('playground-mode-off', () => { playgroundMode = false; });

  // Settings
  ipcMain.handle('get-config', () => {
    return {
      hotkey: config.getHotkey(),
      model: config.getModel(),
      programmingMode: config.getProgrammingMode(),
      grammarEnabled: config.getGrammarEnabled(),
      grammarModel: config.getGrammarModel(),
      grammarTone: config.getGrammarTone(),
      grammarModelAvailable: grammar.isModelAvailable(),
      theme: config.getTheme(),
      floatingBarEnabled: config.getFloatingBarEnabled(),
      soundsEnabled: config.getSoundsEnabled(),
      muteWhileDictating: config.getMuteWhileDictating(),
      showInDock: config.getShowInDock(),
      launchAtLogin: app.getLoginItemSettings().openAtLogin,
      translationEnabled: config.getTranslationEnabled(),
      translationLanguage: config.getTranslationLanguage(),
      transcriptionEngine: config.getTranscriptionEngine(),
      parakeetAvailable: models.isParakeetAvailable(),
      microphoneDeviceId: config.getMicrophoneDeviceId(),
    };
  });

  ipcMain.on('set-model', (_, model) => {
    config.setModel(model);
    broadcastStatus('Loading model...');
    whisper.loadModel(model).then(() => {
      broadcastStatus('Ready');
    }).catch((err) => {
      console.error('Model load failed:', err);
      broadcastStatus('Model load failed');
    });
  });

  ipcMain.on('set-transcription-engine', (_, engine) => {
    config.setTranscriptionEngine(engine);
    if (engine === 'parakeet') {
      // Pre-load Parakeet model if available so first transcription is fast
      if (parakeet.isAvailable() && !parakeet.isLoaded()) {
        try { parakeet.loadModel(); } catch (err) {
          console.warn('Parakeet pre-load failed:', err.message);
        }
      }
    }
    sendToMainWindow('config-changed', {
      transcriptionEngine: engine,
      parakeetAvailable: models.isParakeetAvailable(),
    });
  });

  ipcMain.on('set-microphone-device-id', (_, deviceId) => {
    config.setMicrophoneDeviceId(deviceId);
    sendToMainWindow('config-changed', { microphoneDeviceId: deviceId });
  });

  ipcMain.handle('get-parakeet-status', () => models.getParakeetStatus());

  ipcMain.on('start-parakeet-download', () => {
    models.startParakeetDownload({
      onProgress: throttleProgress((p) => sendToMainWindow('parakeet-download-progress', p)),
      onComplete: () => {
        sendToMainWindow('parakeet-status-changed', models.getParakeetStatus());
        // Auto-load model after download
        try { parakeet.loadModel(); } catch (err) {
          console.warn('Parakeet post-download load failed:', err.message);
        }
      },
      onError: (err) => {
        console.error('Parakeet download error:', err.message);
        sendToMainWindow('parakeet-download-error', { error: err.message });
        sendToMainWindow('parakeet-status-changed', models.getParakeetStatus());
      },
    });
    sendToMainWindow('parakeet-status-changed', models.getParakeetStatus());
  });

  ipcMain.on('cancel-parakeet-download', () => {
    models.cancelParakeetDownload();
    sendToMainWindow('parakeet-status-changed', models.getParakeetStatus());
  });

  ipcMain.on('delete-parakeet', () => {
    parakeet.free();
    models.deleteParakeet();
    // If Parakeet was active engine, fall back to Whisper
    if (config.getTranscriptionEngine() === 'parakeet') {
      config.setTranscriptionEngine('whisper');
    }
    sendToMainWindow('parakeet-status-changed', models.getParakeetStatus());
    sendToMainWindow('config-changed', {
      transcriptionEngine: config.getTranscriptionEngine(),
      parakeetAvailable: false,
    });
  });

  ipcMain.on('set-programming-mode', (_, enabled) => {
    config.setProgrammingMode(enabled);
  });

  ipcMain.on('set-grammar-enabled', (_, enabled) => {
    config.setGrammarEnabled(enabled);
    if (enabled && grammar.isModelAvailable()) {
      grammar.warmup();
    }
  });

  ipcMain.on('set-theme', (_, theme) => {
    config.setTheme(theme);
  });

  // Dictionary management
  ipcMain.handle('get-dictionary', () => {
    return config.getDictionary();
  });

  ipcMain.handle('add-dictionary-entry', (_, { from, to }) => {
    return config.addDictionaryEntry(from, to);
  });

  ipcMain.handle('remove-dictionary-entry', (_, id) => {
    return config.removeDictionaryEntry(id);
  });

  ipcMain.handle('update-dictionary-entry', (_, { id, from, to }) => {
    return config.updateDictionaryEntry(id, from, to);
  });

  // Snippets management
  ipcMain.handle('get-snippets', () => {
    return snippets.getSnippets();
  });

  ipcMain.handle('add-snippet', (_, { trigger, content }) => {
    return snippets.addSnippet(trigger, content);
  });

  ipcMain.handle('remove-snippet', (_, id) => {
    return snippets.removeSnippet(id);
  });

  ipcMain.handle('update-snippet', (_, { id, trigger, content }) => {
    return snippets.updateSnippet(id, trigger, content);
  });

  ipcMain.handle('clear-snippets', () => {
    return snippets.clearSnippets();
  });

  ipcMain.handle('clear-dictionary', () => {
    return config.clearDictionary();
  });

  ipcMain.handle('reset-permissions', () => {
    config.setAccessibilityGrantedOnce(false);
    config.setOnboardingComplete(false);
    return true;
  });

  // Model management
  ipcMain.handle('get-models', () => {
    return models.getModelsStatus();
  });

  ipcMain.on('start-download', (_, modelKey) => {
    models.startDownload(modelKey, {
      onProgress: throttleProgress((progress) => {
        sendToMainWindow('download-progress', progress);
      }),
      onComplete: () => {
        sendToMainWindow('models-changed', models.getModelsStatus());
      },
      onError: (err) => {
        console.error(`Download ${modelKey} failed:`, err.message);
        sendToMainWindow('download-error', { modelKey, error: err.message });
        sendToMainWindow('models-changed', models.getModelsStatus());
      },
    });
  });

  ipcMain.on('pause-download', (_, modelKey) => {
    models.pauseDownload(modelKey);
    sendToMainWindow('models-changed', models.getModelsStatus());
  });

  ipcMain.on('cancel-download', (_, modelKey) => {
    models.cancelDownload(modelKey);
    sendToMainWindow('models-changed', models.getModelsStatus());
  });

  ipcMain.on('delete-model', (_, modelKey) => {
    models.deleteModel(modelKey);
    sendToMainWindow('models-changed', models.getModelsStatus());
  });

  // Grammar model management (multi-model)
  ipcMain.handle('get-grammar-models-status', () => {
    return grammar.getGrammarModelsStatus();
  });

  ipcMain.on('start-grammar-download', (_, modelKey) => {
    grammar.startGrammarDownload(modelKey, {
      onProgress: throttleProgress((p) => {
        sendToMainWindow('grammar-model-progress', p);
      }),
      onComplete: () => {
        console.log(`Grammar model ${modelKey} downloaded successfully`);
        sendToMainWindow('grammar-model-changed', grammar.getGrammarModelsStatus());
      },
      onError: (err) => {
        console.error(`Grammar model ${modelKey} download failed:`, err.message);
        sendToMainWindow('grammar-model-error', { modelKey, error: err.message });
        sendToMainWindow('grammar-model-changed', grammar.getGrammarModelsStatus());
      },
    });
  });

  ipcMain.on('pause-grammar-download', (_, modelKey) => {
    grammar.pauseGrammarDownload(modelKey);
    sendToMainWindow('grammar-model-changed', grammar.getGrammarModelsStatus());
  });

  ipcMain.on('cancel-grammar-download', (_, modelKey) => {
    grammar.cancelGrammarDownload(modelKey);
    sendToMainWindow('grammar-model-changed', grammar.getGrammarModelsStatus());
  });

  ipcMain.on('delete-grammar-model', (_, modelKey) => {
    grammar.deleteGrammarModel(modelKey);
    // If we deleted the active model, auto-disable grammar
    if (config.getGrammarModel() === modelKey && !grammar.isModelAvailable()) {
      config.setGrammarEnabled(false);
    }
    sendToMainWindow('grammar-model-changed', grammar.getGrammarModelsStatus());
  });

  ipcMain.on('set-grammar-model', async (_, modelKey) => {
    config.setGrammarModel(modelKey);
    // Restart the worker so it loads the newly-selected model
    await grammar.restartWorker();
    sendToMainWindow('grammar-model-changed', grammar.getGrammarModelsStatus());
    // Eagerly warm up so the model is in memory before the next transcription.
    // Awaited so the worker is fully ready before this handler exits.
    if (config.getGrammarEnabled() && grammar.isModelAvailable()) {
      await grammar.warmup();
    }
  });

  // Grammar tone
  ipcMain.handle('get-grammar-tone', () => config.getGrammarTone());

  ipcMain.on('set-grammar-tone', (_, tone) => {
    config.setGrammarTone(tone);
  });

  // Permission grant actions
  ipcMain.handle('grant-mic', async () => {
    const granted = await permissions.requestMicrophone();
    return granted;
  });

  ipcMain.on('grant-accessibility', () => {
    permissions.promptAccessibility();
    permissions.openAccessibilityPrefs();
  });

  ipcMain.on('retry-hotkey', () => {
    startHotkeyListener();
  });

  // ── Hotkey recording session ──────────────────────────────────────────────
  // The renderer cannot detect fn/system keys via DOM — use keyspy in main.
  let recordingSession = null; // { listener, senderWebContents, timer }

  function stopRecordingSession() {
    if (!recordingSession) return;
    clearTimeout(recordingSession.timer);
    try { recordingSession.listener.kill(); } catch {}
    recordingSession = null;
  }

  ipcMain.on('start-hotkey-recording', (event) => {
    stopRecordingSession(); // cancel any previous session
    hotkey.stop(); // pause main hotkey listener to avoid conflicts

    let GlobalKeyboardListener;
    try {
      ({ GlobalKeyboardListener } = require('keyspy'));
    } catch (err) {
      console.error('keyspy unavailable for hotkey recording:', err.message);
      if (!event.sender.isDestroyed()) event.sender.send('hotkey-recording-cancelled');
      startHotkeyListener();
      return;
    }

    let tempListener;
    try {
      tempListener = new GlobalKeyboardListener({ mac: { appName: 'Tellaflow' } });
    } catch (err) {
      console.error('Failed to create hotkey recording listener:', err.message);
      if (!event.sender.isDestroyed()) event.sender.send('hotkey-recording-cancelled');
      startHotkeyListener();
      return;
    }

    // Keys to ignore as the sole trigger (pure modifiers pressed alone are fine
    // only as part of a combo — but we DO allow them as single-key hotkeys too).
    // We filter out keys that would be disruptive (e.g. mouse events).
    const IGNORED_SOLO = new Set(['MOUSE LEFT', 'MOUSE RIGHT', 'MOUSE MIDDLE']);

    tempListener.addListener((e, down) => {
      if (e.state !== 'DOWN') return;
      if (IGNORED_SOLO.has(e.name)) return;

      // Collect all currently held key names (modifiers + the trigger)
      const heldModifiers = Object.entries(down)
        .filter(([name, isDown]) => isDown && name !== e.name)
        .map(([name]) => name)
        // Only keep recognized modifier-like names
        .filter(n => /CTRL|SHIFT|ALT|META|FUNCTION|FN/i.test(n));

      const names = [...heldModifiers, e.name];

      // Build human-readable label
      const LABEL_MAP = {
        'LEFT CTRL': 'Left Control (^)', 'RIGHT CTRL': 'Right Control (^)',
        'LEFT ALT': 'Left Option (⌥)', 'RIGHT ALT': 'Right Option (⌥)',
        'LEFT SHIFT': 'Left Shift (⇧)', 'RIGHT SHIFT': 'Right Shift (⇧)',
        'LEFT META': 'Left Command (⌘)', 'RIGHT META': 'Right Command (⌘)',
        'FN': 'fn',
        'SPACE': 'Space', 'RETURN': 'Return', 'ESCAPE': 'Esc',
        'BACKSPACE': 'Backspace', 'TAB': 'Tab',
      };
      const labelParts = names.map(n => LABEL_MAP[n] || n);
      const label = labelParts.join(' + ');

      if (!event.sender.isDestroyed()) {
        event.sender.send('hotkey-recorded', { names, label });
      }
      stopRecordingSession();
      startHotkeyListener(); // resume main hotkey listener
    });

    const timer = setTimeout(() => {
      stopRecordingSession();
      startHotkeyListener(); // resume main hotkey listener on timeout
      if (!event.sender.isDestroyed()) {
        event.sender.send('hotkey-recording-cancelled');
      }
    }, 10000);

    recordingSession = { listener: tempListener, senderWebContents: event.sender, timer };
  });

  ipcMain.on('stop-hotkey-recording', () => {
    stopRecordingSession();
    startHotkeyListener(); // resume main hotkey listener
  });

  ipcMain.handle('check-needs-restart', () => {
    // Stable: accessibility was absent at launch and has since been granted this session
    return config.getAccessibilityGrantedOnce() && !accessibilityInitialState;
  });

  ipcMain.on('restart-app', () => {
    // If the restart is triggered from the onboarding "Restart Now" button,
    // permissions are already granted — mark onboarding complete so the app
    // starts normally after the restart instead of showing onboarding again.
    if (!config.isOnboardingComplete()) {
      config.setOnboardingComplete(true);
    }
    performCleanup();
    app.relaunch();
    app.exit(0);
  });

  // History
  ipcMain.handle('get-history', () => {
    return history.getEntries();
  });

  ipcMain.on('clear-history', () => {
    history.clearHistory();
  });

  ipcMain.handle('delete-history-entry', (_, id) => {
    history.deleteEntry(id);
    return history.getEntries();
  });

  ipcMain.handle('get-audio-data', async (_, filePath) => {
    const fsp = require('fs').promises;
    if (!filePath || typeof filePath !== 'string') return null;
    // Prevent path traversal — only allow files inside the recordings directory
    const recordingsDir = path.join(app.getPath('userData'), 'recordings');
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(recordingsDir)) return null;
    let buf;
    try {
      buf = await fsp.readFile(resolved);
    } catch {
      return null;
    }
    // buf.buffer returns the underlying ArrayBuffer from Node's pool, which may
    // be larger than the file contents. Slice to the exact byte range.
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  });

  ipcMain.on('copy-to-clipboard', (_, text) => {
    clipboard.writeText(text);
  });

  ipcMain.on('paste-text', (_, text) => {
    pasteText(text);
  });

  // Open test WAV file dialog
  ipcMain.on('open-external', (_, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
  });

  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  // Auto-update IPC
  ipcMain.handle('get-update-status', () => updater.getStatus());
  ipcMain.on('check-for-updates', () => {
    updater.checkForUpdates({ silent: false });
  });
  ipcMain.on('install-update', () => {
    updater.quitAndInstall();
  });

  ipcMain.on('open-test-wav', async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'm4a'] }],
      properties: ['openFile'],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      processWavFile(result.filePaths[0]);
    }
  });

  ipcMain.on('audio-level', (_, level) => {
    sendToToast('audio-level', level);
  });

  // ── Floating bar: capture frontmost app before click steals focus ─────────
  // Called from the renderer on hover-start (before the click activates Electron)
  // so we know which app to re-focus when pasting the transcription result.
  ipcMain.on('record-frontmost-app', () => {
    // Suppress the activate→showMainWindow handler so clicking the toast
    // doesn't bring the main settings window to the front.
    suppressNextActivation();

    // EC1 — always reset first so a failed capture (Electron frontmost) never
    // leaves a stale value from a previous recording session in place.
    clickPasteTargetApp = null;

    // Sync call on hover: blocks briefly but that's invisible to the user
    // since no animation has started yet. Eliminates the race where the user
    // clicks before the async result returns and clickPasteTargetApp is still null.
    const name = getFrontmostAppSync(800);
    if (name && !isOwnApp(name)) {
      clickPasteTargetApp = name;
    }
  });

  // Fired on mousedown on the trigger strip — runs suppressNextActivation again
  // right before the click activates Electron, as a belt-and-suspenders guard
  // in case the hover timer already expired.
  ipcMain.on('suppress-toast-activation', () => {
    suppressNextActivation();
  });

  // Renderer hover signal — captures the mouse only while the cursor is over a
  // visibly-rendered element (pill or trigger strip). Outside those elements
  // the floating bar stays click-through so apps behind it stay usable.
  ipcMain.on('set-toast-interactive', (_, interactive) => {
    setToastInteractive(!!interactive);
  });

  // ── Floating bar click-to-dictate ─────────────────────────────────────────
  ipcMain.on('click-start-recording', () => {
    // clickPasteTargetApp is set by record-frontmost-app (fired on hover, before
    // the click activates Electron). No extra capture needed here.
    startClickRecording();
  });

  ipcMain.on('click-cancel-recording', () => {
    clearRecordingTimeout();
    sounds.playStop();
    sounds.unmuteMusic();
    pendingStop = false;
    clickPasteTargetApp = null;
    destroyAudioCaptureWindow();
    hideToast();
    broadcastStatus('Ready');
  });

  ipcMain.on('click-finish-recording', () => {
    clearRecordingTimeout();
    sounds.playStop();
    sounds.unmuteMusic();
    if (audioCaptureWindow && !audioCaptureWindow.isDestroyed()) {
      if (audioCaptureWindow.webContents.isLoading()) {
        pendingStop = true;
      } else {
        audioCaptureWindow.webContents.send('stop-recording');
      }
    } else {
      hideToast();
      broadcastStatus('Ready');
    }
  });

  // ── System settings IPC ───────────────────────────────────────────────────
  ipcMain.handle('get-floating-bar-enabled', () => config.getFloatingBarEnabled());
  ipcMain.on('set-floating-bar-enabled', (_, enabled) => {
    toastSetFloatingBarEnabled(enabled);
  });

  ipcMain.handle('get-sounds-enabled', () => config.getSoundsEnabled());
  ipcMain.on('set-sounds-enabled', (_, enabled) => {
    config.setSoundsEnabled(enabled);
  });

  ipcMain.handle('get-mute-while-dictating', () => config.getMuteWhileDictating());
  ipcMain.on('set-mute-while-dictating', (_, enabled) => {
    config.setMuteWhileDictating(enabled);
  });

  ipcMain.handle('get-show-in-dock', () => config.getShowInDock());
  ipcMain.on('set-show-in-dock', (_, enabled) => {
    config.setShowInDock(enabled);
    if (app.dock) {
      if (enabled) {
        app.dock.show();
      } else {
        app.dock.hide();
      }
    }
  });

  ipcMain.handle('get-launch-at-login', () => app.getLoginItemSettings().openAtLogin);
  ipcMain.on('set-launch-at-login', (_, enabled) => {
    app.setLoginItemSettings({ openAtLogin: enabled });
  });

  ipcMain.handle('get-translation-enabled', () => config.getTranslationEnabled());
  ipcMain.on('set-translation-enabled', (_, enabled) => {
    config.setTranslationEnabled(enabled);
  });

  ipcMain.handle('get-translation-language', () => config.getTranslationLanguage());
  ipcMain.on('set-translation-language', (_, lang) => {
    config.setTranslationLanguage(lang);
  });

  // Audio capture window signals it's loaded and ready
  ipcMain.on('capture-ready', () => {
    if (!audioCaptureWindow || audioCaptureWindow.isDestroyed()) return;

    if (pendingStop) {
      console.log('Audio window ready but stop was pending — start+stop immediately.');
      pendingStop = false;
      audioCaptureWindow.webContents.send('start-recording', { deviceId: config.getMicrophoneDeviceId() });
      setTimeout(() => {
        if (audioCaptureWindow && !audioCaptureWindow.isDestroyed()) {
          audioCaptureWindow.webContents.send('stop-recording');
        }
      }, 150);
    } else {
      audioCaptureWindow.webContents.send('start-recording', { deviceId: config.getMicrophoneDeviceId() });
    }
  });

  // Audio captured from renderer -> preprocess -> transcribe -> format -> paste
  ipcMain.on('audio-captured', async (_, pcmArray) => {
    destroyAudioCaptureWindow();

    // Renderer sends a Float32Array (preserved across IPC by structured clone).
    // Older callers may still send a plain Array; normalise once here so the
    // rest of the pipeline can avoid redundant typed-array allocations.
    const pcm = pcmArray instanceof Float32Array
      ? pcmArray
      : (pcmArray && pcmArray.length ? new Float32Array(pcmArray) : null);

    if (!pcm || pcm.length === 0) {
      console.log('Empty audio received — skipping transcription.');
      clickPasteTargetApp = null;
      hideToast();
      broadcastStatus('Ready');
      if (playgroundMode) {
        const win = getOnboardingWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('playground-text', '');
        } else {
          playgroundMode = false; // window gone — clear stale flag
        }
      }
      return;
    }

    showToast('transcribing');
    broadcastStatus('Transcribing...');

    // Save the raw audio to disk before transcription so it is always preserved.
    // Async write keeps the event loop responsive — transcription only needs
    // `savedAudioPath` for the unlink-on-failure paths, not the bytes on disk.
    const fs = require('fs');
    const recordingsDir = path.join(app.getPath('userData'), 'recordings');
    const audioPath = path.join(recordingsDir, `recording-${Date.now()}.wav`);
    let savedAudioPath = null;
    let writePromise = Promise.resolve();
    try {
      const wavBuf = encodePcmToWav(pcm, 16000);
      writePromise = fs.promises.writeFile(audioPath, wavBuf)
        .then(() => { savedAudioPath = audioPath; })
        .catch((writeErr) => {
          console.warn('Failed to save audio file:', writeErr.message);
        });
    } catch (encErr) {
      console.warn('Failed to encode WAV:', encErr.message);
    }

    try {
      let processed = trimSilence(pcm);
      processed = normalizeVolume(processed);

      let rawText;
      if (config.getTranscriptionEngine() === 'parakeet' && parakeet.isAvailable()) {
        rawText = await parakeet.transcribe(processed);
      } else {
        rawText = await whisper.transcribe(processed);
        rawText = stripWhisperArtifacts(rawText);
      }
      // Make sure the async WAV write completed before any downstream branch
      // either persists `savedAudioPath` in history or attempts to unlink it.
      await writePromise;
      if (!rawText) {
        clickPasteTargetApp = null;
        hideToast();
        broadcastStatus('Ready');
        if (savedAudioPath) {
          fs.promises.unlink(savedAudioPath).catch(() => {});
        }
        if (playgroundMode) {
          const win = getOnboardingWindow();
          if (win && !win.isDestroyed()) {
            win.webContents.send('playground-text', '');
          } else {
            playgroundMode = false; // window gone — clear stale flag
          }
        }
        return;
      }
      rawText = applyDictionary(rawText);

      if (config.getGrammarEnabled() && grammar.isModelAvailable()) {
        broadcastStatus('Formatting...');
        try {
          rawText = await grammar.correctGrammar(rawText, config.getGrammarTone());
        } catch (err) {
          console.warn('Grammar formatting failed, using raw text:', err.message);
        }
      }

      let text = formatTranscription(rawText);
      text = snippets.applySnippets(text);

      hideToast();

      // In playground (onboarding dry-run) mode: send the result back to the
      // onboarding window and skip paste, history, and notifications.
      // playgroundMode stays true so repeated dictations work without re-enabling it.
      if (playgroundMode) {
        const win = getOnboardingWindow();
        if (win && !win.isDestroyed()) {
          clickPasteTargetApp = null;
          broadcastStatus('Ready');
          if (savedAudioPath) { fs.promises.unlink(savedAudioPath).catch(() => {}); }
          // Always send (even empty text) so the renderer can reset its recording state.
          // Re-focus the onboarding window so subsequent hotkey presses are captured.
          win.webContents.send('playground-text', text || '');
          win.focus();
          return;
        }
        // Onboarding window is gone (e.g. user closed it while playground was active).
        // Auto-clear the stale flag so this and future transcriptions paste normally.
        playgroundMode = false;
      }

      if (text && text.length > 0) {
        history.addEntry(text, savedAudioPath);
        const entries = history.getEntries();
        sendToMainWindow('history-update', entries);

        const recordedTarget = clickPasteTargetApp;
        clickPasteTargetApp = null;

        // recordedTarget was captured synchronously at key-press time (before any
        // Electron window creation could corrupt the query). Use it directly.
        // As a bonus, if the user deliberately switched to a different real app
        // during transcription, honour that switch by pasting there instead.
        const currentFrontmost = await getFrontmostApp();
        const pasteTarget = (!isOwnApp(currentFrontmost) && currentFrontmost !== recordedTarget)
          ? currentFrontmost
          : recordedTarget;
        pasteText(text, pasteTarget);
      } else {
        clickPasteTargetApp = null;
      }
    } catch (err) {
      console.error('Transcription failed:', err);
      clickPasteTargetApp = null;
      hideToast();

      // Await any in-flight WAV write so the unlink targets the real file
      // rather than racing against the writer.
      try { await writePromise; } catch (_) {}
      if (savedAudioPath) {
        fs.promises.unlink(savedAudioPath).catch(() => {});
      }

      const isModelMissing = err.message && err.message.includes('not found');
      new Notification({
        title: isModelMissing ? 'Tellaflow — Model Not Found' : 'Transcription Failed',
        body: isModelMissing
          ? `${err.message} Go to Settings → Models to download one.`
          : (err.message || 'Unknown error'),
      }).show();

      if (isModelMissing) broadcastStatus('No model downloaded');
    }

    broadcastStatus('Ready');
  });
}

async function processWavFile(filePath) {
  const fs = require('fs');
  try {
    showToast('transcribing');
    broadcastStatus('Transcribing file...');

    const buf = fs.readFileSync(filePath);

    // Validate WAV header
    if (buf.length < 44) throw new Error('File too small to be a valid WAV');
    const riff = buf.toString('ascii', 0, 4);
    const wave = buf.toString('ascii', 8, 12);
    if (riff !== 'RIFF' || wave !== 'WAVE') throw new Error('Not a valid WAV file');

    const numChannels = buf.readUInt16LE(22);
    const sampleRate = buf.readUInt32LE(24);
    const bitsPerSample = buf.readUInt16LE(34);

    if (numChannels < 1) throw new Error(`Invalid channel count: ${numChannels}`);
    if (sampleRate < 1) throw new Error(`Invalid sample rate: ${sampleRate}`);
    if (![8, 16, 24, 32].includes(bitsPerSample)) throw new Error(`Unsupported bit depth: ${bitsPerSample}`);

    let dataOffset = 12;
    let pcmBuf = null;
    while (dataOffset < buf.length - 8) {
      const chunkId = buf.toString('ascii', dataOffset, dataOffset + 4);
      const chunkSize = buf.readUInt32LE(dataOffset + 4);
      if (chunkId === 'data') {
        dataOffset += 8;
        pcmBuf = buf.slice(dataOffset, Math.min(dataOffset + chunkSize, buf.length));
        break;
      }
      dataOffset += 8 + chunkSize;
      if (chunkSize % 2 !== 0) dataOffset++;
    }

    if (!pcmBuf) throw new Error('No data chunk in WAV');

    const numSamples = pcmBuf.length / (bitsPerSample / 8) / numChannels;
    const mono16k = new Float32Array(Math.floor(numSamples * 16000 / sampleRate));
    for (let i = 0; i < mono16k.length; i++) {
      const srcIdx = Math.floor(i * sampleRate / 16000);
      const byteOffset = srcIdx * numChannels * (bitsPerSample / 8);
      if (byteOffset + 1 < pcmBuf.length) {
        mono16k[i] = pcmBuf.readInt16LE(byteOffset) / 32768.0;
      }
    }

    console.log(`WAV loaded: ${sampleRate}Hz -> 16kHz, ${mono16k.length} samples`);

    let pcm = trimSilence(mono16k);
    pcm = normalizeVolume(pcm);
    let rawText;
    if (config.getTranscriptionEngine() === 'parakeet' && parakeet.isAvailable()) {
      rawText = await parakeet.transcribe(pcm);
    } else {
      rawText = await whisper.transcribe(pcm);
      rawText = stripWhisperArtifacts(rawText);
    }
    if (!rawText) {
      hideToast();
      broadcastStatus('Ready');
      return;
    }
    rawText = applyDictionary(rawText);

    if (config.getGrammarEnabled() && grammar.isModelAvailable()) {
      broadcastStatus('Formatting...');
      try {
        rawText = await grammar.correctGrammar(rawText, config.getGrammarTone());
      } catch (err) {
        console.warn('Grammar formatting failed, using raw text:', err.message);
      }
    }

    let text = formatTranscription(rawText);
    text = snippets.applySnippets(text);

    hideToast();

    if (text && text.length > 0) {
      history.addEntry(text);
      const entries = history.getEntries();
      sendToMainWindow('history-update', entries);
      pasteText(text);
      new Notification({ title: 'Tellaflow', body: text.length > 80 ? text.substring(0, 80) + '...' : text }).show();
    } else {
      new Notification({ title: 'Tellaflow', body: 'No speech detected.' }).show();
    }

    broadcastStatus('Ready');
  } catch (err) {
    console.error('WAV test failed:', err);
    hideToast();
    broadcastStatus('Ready');
    new Notification({ title: 'Test Failed', body: err.message }).show();
  }
}
