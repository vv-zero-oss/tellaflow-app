const { systemPreferences, shell } = require('electron');
const platform = require('./platform');

function isTrustedAccessibility() {
  if (!platform.isMac) return true;
  return systemPreferences.isTrustedAccessibilityClient(false);
}

function promptAccessibility() {
  if (!platform.isMac) return;
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
  if (platform.isMac) {
    shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
    );
    return;
  }
  if (platform.isWindows) {
    shell.openExternal('ms-settings:privacy-accessibility');
  }
}

module.exports = {
  isTrustedAccessibility,
  promptAccessibility,
  getMicrophoneStatus,
  requestMicrophone,
  openAccessibilityPrefs,
};
