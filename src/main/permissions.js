const { systemPreferences, shell } = require('electron');

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

module.exports = {
  isTrustedAccessibility,
  promptAccessibility,
  getMicrophoneStatus,
  requestMicrophone,
  openAccessibilityPrefs,
};
