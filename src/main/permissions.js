const { systemPreferences, shell, desktopCapturer } = require('electron');
const mac = require('./mac-automation');

// Accessibility / TCC prompts are macOS concepts. Elsewhere (Linux CI, the
// e2e runner) there is nothing to grant, so report "granted" instead of
// throwing on the missing systemPreferences APIs.
const isMac = process.platform === 'darwin';

function isTrustedAccessibility() {
  return isMac ? systemPreferences.isTrustedAccessibilityClient(false) : true;
}

function promptAccessibility() {
  if (isMac) systemPreferences.isTrustedAccessibilityClient(true);
}

function getMicrophoneStatus() {
  return systemPreferences.getMediaAccessStatus?.('microphone') ?? 'granted';
}

const MIC_PREFS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone';

function openMicrophonePrefs() {
  if (!isMac) return;
  shell.openExternal(MIC_PREFS_URL);
}

/**
 * macOS shows its microphone prompt only once, while the status is
 * "not-determined". After the user has denied it (or MDM restricts it),
 * askForMediaAccess resolves false without any UI — so open the Microphone
 * pane instead, where the switch can be turned on.
 */
async function requestMicrophone() {
  if (!isMac) return true;
  const status = getMicrophoneStatus();
  if (status === 'granted') return true;
  if (status === 'not-determined') {
    return systemPreferences.askForMediaAccess('microphone');
  }
  openMicrophonePrefs();
  return false;
}

function openAccessibilityPrefs() {
  if (!isMac) return;
  shell.openExternal(
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
  );
}

// ─── Screen Recording ─────────────────────────────────────────────────────────

function isScreenRecordingGranted() {
  return isMac ? systemPreferences.getMediaAccessStatus('screen') === 'granted' : true;
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

module.exports = {
  isTrustedAccessibility,
  promptAccessibility,
  getMicrophoneStatus,
  requestMicrophone,
  openMicrophonePrefs,
  openAccessibilityPrefs,
  isScreenRecordingGranted,
  requestScreenRecording,
};
