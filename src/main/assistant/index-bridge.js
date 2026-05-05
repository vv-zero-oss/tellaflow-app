/**
 * Bridge to avoid circular dependency between index.js and assistant modules.
 * index.js registers functions here during init; assistant modules call them.
 */
let _createAudioCaptureWindow = null;
let _destroyAudioCaptureWindow = null;

module.exports = {
  register({ createAudioCaptureWindow, destroyAudioCaptureWindow }) {
    _createAudioCaptureWindow = createAudioCaptureWindow;
    _destroyAudioCaptureWindow = destroyAudioCaptureWindow;
  },

  createAudioCaptureWindow() {
    if (_createAudioCaptureWindow) _createAudioCaptureWindow();
  },

  destroyAudioCaptureWindow() {
    if (_destroyAudioCaptureWindow) _destroyAudioCaptureWindow();
  },
};
