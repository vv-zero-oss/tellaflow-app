const { systemPreferences, shell } = require('electron');

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

module.exports = {
  isTrustedAccessibility,
  promptAccessibility,
  getMicrophoneStatus,
  requestMicrophone,
  openAccessibilityPrefs,
};
