/**
 * A pretend Mac desktop for the e2e run on Linux, where Peekaboo cannot run:
 * the Finder in front, and TextEdit once something launches it. Same shape as
 * src/main/jarvis/desktop/os-actions.js. Used only when the app is started
 * with TELLAFLOW_E2E_DESKTOP=fake — never in a real build.
 */
const state = { front: 'Finder', doc: '', acts: [] };

const elements = () => (state.front === 'TextEdit'
  ? [
    { id: 'e1', role: 'AXTextArea', label: 'Untitled', value: state.doc, focused: true, bounds: { x: 200, y: 160, width: 640, height: 420 } },
    { id: 'e2', role: 'AXButton', label: 'Close', bounds: { x: 210, y: 130, width: 14, height: 14 } },
  ]
  : [
    { id: 'e1', role: 'AXIcon', label: 'Macintosh HD', bounds: { x: 1200, y: 40, width: 64, height: 64 } },
    { id: 'e2', role: 'AXMenuBarItem', label: 'File', bounds: { x: 90, y: 0, width: 40, height: 22 } },
  ]);

module.exports = {
  state,
  getOsStatus: async () => ({ supported: true, screenRecording: true, accessibility: true, peekaboo: { ok: true, version: '4.2.0 (simulated)' } }),
  requestAccessibility: async () => ({ granted: true }),
  osSee: async () => ({ ok: true, elements: elements(), app: state.front, frontmostApp: state.front, foreground: true }),
  osAct: async (a) => {
    state.acts.push(a);
    if (a.type === 'os_app' && a.action !== 'quit') state.front = a.name;
    if (a.type === 'os_type' && state.front === 'TextEdit') state.doc += a.text;
    return { ok: true };
  },
  osInspect: async () => ({ ok: false, error: 'not on this desktop' }),
  captureScreen: async () => ({ ok: false, error: 'no screen here' }),
};
