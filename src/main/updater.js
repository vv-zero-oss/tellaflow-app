const { app, dialog, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');

// State broadcast to renderer windows so the Settings UI can display it.
// Phases:
//   'idle'        — no check in progress, no update pending
//   'checking'    — actively checking GitHub
//   'available'   — update found; download starting
//   'downloading' — download in progress (progress carried in `progress`)
//   'downloaded'  — update downloaded; restart required to install
//   'not-available' — most recent check found nothing newer
//   'error'       — most recent check or download failed
let state = {
  phase: 'idle',
  currentVersion: app.getVersion(),
  updateVersion: null,
  progress: null, // { percent, bytesPerSecond, transferred, total }
  error: null,
  // true when the latest check was user-initiated; lets us surface
  // a dialog only when the user explicitly asked for the result.
  userInitiated: false,
  checkedAt: null,
};

let sendStatus = () => {};
let periodicTimer = null;
let initialized = false;

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

function setState(patch) {
  state = { ...state, ...patch };
  try { sendStatus(state); } catch {}
}

function getStatus() {
  return state;
}

function initAutoUpdater({ broadcast } = {}) {
  if (initialized) return;
  if (!app.isPackaged) {
    console.log('[updater] Skipping autoUpdater in dev (app is not packaged).');
    return;
  }
  initialized = true;
  if (typeof broadcast === 'function') sendStatus = broadcast;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (msg) => console.log('[updater]', msg),
    warn: (msg) => console.warn('[updater]', msg),
    error: (msg) => console.error('[updater]', msg),
    debug: () => {},
  };

  autoUpdater.on('checking-for-update', () => {
    setState({ phase: 'checking', error: null, checkedAt: Date.now() });
  });

  autoUpdater.on('update-available', (info) => {
    setState({
      phase: 'available',
      updateVersion: info && info.version ? info.version : null,
      error: null,
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    const wasUserInitiated = state.userInitiated;
    setState({
      phase: 'not-available',
      updateVersion: info && info.version ? info.version : null,
      error: null,
      userInitiated: false,
    });
    if (wasUserInitiated) {
      dialog.showMessageBox({
        type: 'info',
        title: 'Tellaflow',
        message: 'You’re up to date',
        detail: `Tellaflow ${app.getVersion()} is the latest version.`,
        buttons: ['OK'],
        defaultId: 0,
      }).catch(() => {});
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    setState({
      phase: 'downloading',
      progress: {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      },
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    setState({
      phase: 'downloaded',
      updateVersion: info && info.version ? info.version : state.updateVersion,
      progress: null,
      error: null,
    });

    try {
      new Notification({
        title: 'Tellaflow update ready',
        body: `Version ${info && info.version ? info.version : ''} is ready to install. Restart Tellaflow to apply.`,
      }).show();
    } catch {}

    dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: `Tellaflow ${info && info.version ? info.version : ''} is ready to install.`,
      detail: 'Restart now to apply the update, or it will install automatically the next time you quit.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    }).then((result) => {
      if (result.response === 0) quitAndInstall();
    }).catch(() => {});
  });

  autoUpdater.on('error', (err) => {
    const wasUserInitiated = state.userInitiated;
    const message = err && err.message ? err.message : String(err);
    console.error('[updater] error:', message);
    setState({
      phase: 'error',
      error: message,
      userInitiated: false,
    });
    if (wasUserInitiated) {
      dialog.showMessageBox({
        type: 'error',
        title: 'Update check failed',
        message: 'Tellaflow could not check for updates.',
        detail: message,
        buttons: ['OK'],
        defaultId: 0,
      }).catch(() => {});
    }
  });

  // First silent check ~30s after launch so it never competes with startup work,
  // then every 4 hours while the app stays running.
  setTimeout(() => { checkForUpdates({ silent: true }); }, 30 * 1000);
  periodicTimer = setInterval(() => { checkForUpdates({ silent: true }); }, FOUR_HOURS_MS);
  if (periodicTimer.unref) periodicTimer.unref();
}

function checkForUpdates({ silent = true } = {}) {
  if (!app.isPackaged) {
    if (!silent) {
      dialog.showMessageBox({
        type: 'info',
        title: 'Tellaflow',
        message: 'Auto-update is disabled in development builds.',
        buttons: ['OK'],
      }).catch(() => {});
    }
    return;
  }
  state.userInitiated = !silent || state.userInitiated;
  try {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[updater] checkForUpdates rejected:', err && err.message ? err.message : err);
    });
  } catch (err) {
    console.error('[updater] checkForUpdates threw:', err && err.message ? err.message : err);
  }
}

function quitAndInstall() {
  if (!app.isPackaged) return;
  try {
    setImmediate(() => {
      // isSilent=false so macOS shows the standard progress; isForceRunAfter=true
      // so the app relaunches automatically after install completes.
      autoUpdater.quitAndInstall(false, true);
    });
  } catch (err) {
    console.error('[updater] quitAndInstall failed:', err && err.message ? err.message : err);
  }
}

function isUpdateDownloaded() {
  return state.phase === 'downloaded';
}

module.exports = {
  initAutoUpdater,
  checkForUpdates,
  quitAndInstall,
  getStatus,
  isUpdateDownloaded,
};
