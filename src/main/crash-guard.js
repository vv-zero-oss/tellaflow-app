/**
 * Anti-crash guards for the main process.
 *
 *   - Uncaught exceptions / unhandled rejections are logged to
 *     userData/error-log.txt instead of showing Electron's fatal dialog. If
 *     they storm (main process clearly wedged) the app relaunches itself.
 *   - Memory watchdog: if the main process grows past a ceiling and the app
 *     is idle (no recording, no transcription), relaunch quietly in the
 *     background — the same "periodic restart" other long-running dictation
 *     apps do, but only when it is needed and never mid-dictation.
 *
 * Heavy native work already runs in the supervised transcription worker, so
 * these are a last line of defence for the main process itself.
 */

const fs = require('fs');
const path = require('path');

const STORM_WINDOW_MS = 60_000;
const STORM_LIMIT = 20;

function createCrashGuard({
  getLogDir,
  relaunch,
  isIdle = () => true,
  memoryUsage = () => process.memoryUsage(),
  maxRssBytes = 1.5 * 1024 * 1024 * 1024,
  checkEveryMs = 5 * 60 * 1000,
  timers = { setInterval, clearInterval },
  now = () => Date.now(),
  log = console,
}) {
  const recent = [];
  let watchdog = null;
  let relaunching = false;

  function writeLog(kind, err) {
    try {
      const dir = getLogDir();
      if (!dir) return;
      const line = `[${new Date(now()).toISOString()}] ${kind}: ${(err && (err.stack || err.message)) || String(err)}\n`;
      const file = path.join(dir, 'error-log.txt');
      // Keep the log bounded (~512 KB).
      try { if (fs.statSync(file).size > 512 * 1024) fs.renameSync(file, `${file}.1`); } catch {}
      fs.appendFileSync(file, line);
    } catch {}
  }

  function doRelaunch(reason) {
    if (relaunching) return;
    relaunching = true;
    log.warn?.(`[crash-guard] relaunching: ${reason}`);
    writeLog('relaunch', reason);
    try { relaunch(reason); } catch (err) { log.error?.('[crash-guard] relaunch failed', err); }
  }

  function onUncaught(err) {
    // keyspy's native helper can exit abruptly (fn/Globe key on Apple
    // Silicon), producing a synchronous EPIPE on its stdin. The hotkey
    // listener restarts itself; nothing to do.
    if (err && err.code === 'EPIPE') {
      log.warn?.('[keyspy] Suppressed uncaught EPIPE – native process likely exited:', err.message);
      return;
    }
    log.error?.('[crash-guard] uncaught exception:', err);
    writeLog('uncaughtException', err);
    const t = now();
    recent.push(t);
    while (recent.length && t - recent[0] > STORM_WINDOW_MS) recent.shift();
    if (recent.length >= STORM_LIMIT) doRelaunch(`${recent.length} uncaught exceptions in a minute`);
  }

  function onRejection(reason) {
    log.warn?.('[crash-guard] unhandled rejection:', reason);
    writeLog('unhandledRejection', reason);
  }

  function checkMemory() {
    let rss = 0;
    try { rss = memoryUsage().rss; } catch { return false; }
    if (rss > maxRssBytes && isIdle()) {
      doRelaunch(`main process RSS ${(rss / 1024 / 1024).toFixed(0)} MB over ${(maxRssBytes / 1024 / 1024).toFixed(0)} MB`);
      return true;
    }
    return false;
  }

  function install(proc = process) {
    proc.on('uncaughtException', onUncaught);
    proc.on('unhandledRejection', onRejection);
    if (checkEveryMs > 0) {
      watchdog = timers.setInterval(checkMemory, checkEveryMs);
      watchdog?.unref?.();
    }
  }

  function uninstall(proc = process) {
    proc.removeListener('uncaughtException', onUncaught);
    proc.removeListener('unhandledRejection', onRejection);
    if (watchdog) timers.clearInterval(watchdog);
    watchdog = null;
  }

  return { install, uninstall, onUncaught, onRejection, checkMemory, writeLog };
}

module.exports = { createCrashGuard };
