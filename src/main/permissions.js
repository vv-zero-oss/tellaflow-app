const { systemPreferences, shell } = require('electron');

const IS_MAC = process.platform === 'darwin';

// On Windows there is no Accessibility-style permission gate for global key
// hooks — the low-level keyboard hook used by keyspy's WinKeyServer just works.
// We expose the same API surface so callers don't need to branch, and return
// values that mean "no gate; nothing to do".

function isTrustedAccessibility() {
  if (!IS_MAC) return true;
  return systemPreferences.isTrustedAccessibilityClient(false);
}

function promptAccessibility() {
  if (!IS_MAC) return;
  systemPreferences.isTrustedAccessibilityClient(true);
}

function getMicrophoneStatus() {
  // getMediaAccessStatus is supported on macOS and Windows.
  if (IS_MAC || process.platform === 'win32') {
    try {
      return systemPreferences.getMediaAccessStatus('microphone');
    } catch {
      return 'granted';
    }
  }
  return 'granted';
}

async function requestMicrophone() {
  if (IS_MAC) {
    const granted = await systemPreferences.askForMediaAccess('microphone');
    return granted;
  }
  // On Windows the OS-level Microphone privacy toggle is user-managed in
  // Settings; askForMediaAccess is not available. Treat as granted and let
  // any actual capture failure surface through the Web Audio API.
  return true;
}

function openAccessibilityPrefs() {
  if (IS_MAC) {
    shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
    );
    return;
  }
  if (process.platform === 'win32') {
    // No accessibility gate on Windows. As a friendly fallback, open the
    // Microphone privacy page in case the user is debugging permissions.
    shell.openExternal('ms-settings:privacy-microphone');
  }
}

module.exports = {
  isTrustedAccessibility,
  promptAccessibility,
  getMicrophoneStatus,
  requestMicrophone,
  openAccessibilityPrefs,
};
