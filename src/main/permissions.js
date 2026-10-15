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

async function requestMicrophone() {
  if (!isMac) return true;
  const granted = await systemPreferences.askForMediaAccess('microphone');
  return granted;
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
  openAccessibilityPrefs,
  isScreenRecordingGranted,
  requestScreenRecording,
};
