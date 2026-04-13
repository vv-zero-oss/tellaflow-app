const { BrowserWindow } = require('electron');
const path = require('path');

let onboardingWindow = null;

function createOnboardingWindow() {
  if (onboardingWindow && !onboardingWindow.isDestroyed()) {
    onboardingWindow.focus();
    return onboardingWindow;
  }

  onboardingWindow = new BrowserWindow({
    width: 500,
    height: 700,
    resizable: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    frame: false,
    transparent: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const isDev = !require('electron').app.isPackaged;
  if (isDev) {
    onboardingWindow.loadURL('http://localhost:5173/onboarding.html');
  } else {
    onboardingWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'renderer', 'onboarding.html'));
  }

  onboardingWindow.once('ready-to-show', () => {
    onboardingWindow.show();
  });

  onboardingWindow.on('closed', () => {
    onboardingWindow = null;
  });

  return onboardingWindow;
}

function closeOnboarding() {
  if (onboardingWindow && !onboardingWindow.isDestroyed()) {
    onboardingWindow.close();
    onboardingWindow = null;
  }
}

function getOnboardingWindow() { return onboardingWindow; }

module.exports = { createOnboardingWindow, closeOnboarding, getOnboardingWindow };
