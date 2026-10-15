const { systemPreferences, shell, desktopCapturer } = require('electron');
const mac = require('./mac-automation');

function isTrustedAccessibility() {
  return systemPreferences.isTrustedAccessibilityClient(false);
}

function promptAccessibility() {
  systemPreferences.isTrustedAccessibilityClient(true);
}

function getMicrophoneStatus() {
  return systemPreferences.getMediaAccessStatus('microphone');
}

async function requestMicrophone() {
  const granted = await systemPreferences.askForMediaAccess('microphone');
  return granted;
}

function openAccessibilityPrefs() {
  shell.openExternal(
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
  );
}

// ─── Screen Recording ─────────────────────────────────────────────────────────

function isScreenRecordingGranted() {
  return systemPreferences.getMediaAccessStatus('screen') === 'granted';
}

/**
 * macOS has no "ask" API for Screen Recording. Touching desktopCapturer adds
 * Tellaflow to the list (and shows the system prompt the first time); then we
 * open the pane so the user can flip the switch.
 */
async function requestScreenRecording() {
  if (isScreenRecordingGranted()) return true;
  try {
    await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
  } catch { /* ignore — we only need the side effect */ }
  if (!isScreenRecordingGranted()) {
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  }
  return isScreenRecordingGranted();
}

// ─── Automation (Apple Events) ────────────────────────────────────────────────

// Apps the assistant scripts. macOS asks "Tellaflow wants to control X" the
// first time each one is scripted — we trigger all of those prompts up front,
// during setup, so they never interrupt a task later.
const AUTOMATION_TARGETS = [
  { app: 'System Events', probe: 'count processes' },
  { app: 'Finder', probe: 'count windows' },
  { app: 'Notes', probe: 'count accounts', background: true },
  { app: 'Reminders', probe: 'count lists', background: true },
  { app: 'Calendar', probe: 'count calendars', background: true },
  { app: 'Music', probe: 'count playlists', background: true },
];

const NOT_AUTHORIZED = /-1743|not authori[sz]ed/i;

async function isRunning(app) {
  try {
    const out = await mac.runAppleScript(
      'tell application "System Events" to return exists (process (item 1 of argv))',
      [app],
    );
    return out.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Ask for Automation access to every app the assistant controls, one prompt at
 * a time. Apps we had to launch for the prompt are quit again afterwards.
 * @returns {Promise<{ granted: boolean, results: { app: string, ok: boolean, error?: string }[] }>}
 */
async function requestAutomation({ targets = AUTOMATION_TARGETS, runScript = mac.runRawAppleScript } = {}) {
  const results = [];
  for (const t of targets) {
    const wasRunning = t.background ? await isRunning(t.app) : true;
    try {
      // The user may take a while to answer the system prompt.
      await runScript(`tell application "${t.app}" to ${t.probe}`, { timeout: 120_000 });
      results.push({ app: t.app, ok: true });
    } catch (err) {
      const msg = String(err?.message || err);
      results.push({ app: t.app, ok: false, error: NOT_AUTHORIZED.test(msg) ? 'not-authorized' : msg });
    }
    if (!wasRunning) {
      try { await runScript(`tell application "${t.app}" to quit`, { timeout: 5000 }); } catch { /* ignore */ }
    }
  }
  // Only a refusal counts against "granted"; an app that isn't installed is fine.
  const granted = results.every((r) => r.ok || r.error !== 'not-authorized');
  return { granted, results };
}

function openAutomationPrefs() {
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Automation');
}

module.exports = {
  isTrustedAccessibility,
  promptAccessibility,
  getMicrophoneStatus,
  requestMicrophone,
  openAccessibilityPrefs,
  isScreenRecordingGranted,
  requestScreenRecording,
  AUTOMATION_TARGETS,
  requestAutomation,
  openAutomationPrefs,
};
