// The menubar menu, as a plain Electron menu template. Pure: everything it
// shows comes in as `state` and everything it does goes out through
// `actions`, so it is tested without Electron (tests/main/tray-menu.test.js).

// Global shortcut for "Paste Last Transcript" (registered in index.js).
const PASTE_LAST_ACCELERATOR = 'Control+Command+V';

// Speaking languages offered straight from the menu; the rest are on the
// Models page. Whisper transcribes these and translates to English.
const MENU_LANGUAGES = ['es', 'fr', 'de', 'hi', 'ja', 'zh', 'pt', 'ko'];

const PREVIEW_CHARS = 48;

/** One line, at most PREVIEW_CHARS, for the transcript preview. */
function previewOf(text) {
  const line = String(text || '').replace(/\s+/g, ' ').trim();
  return line.length > PREVIEW_CHARS ? `${line.slice(0, PREVIEW_CHARS - 1).trimEnd()}…` : line;
}

function languageName(code) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code;
  } catch {
    return code;
  }
}

function microphoneMenu({ microphoneId, microphones }, actions) {
  const id = microphoneId || 'auto';
  const devices = (microphones || []).filter((d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
  const def = (microphones || []).find((d) => d.deviceId === 'default');
  const defName = def ? def.label.replace(/^Default - /, '') : '';
  const items = [
    {
      label: defName ? `Auto-detect (${defName})` : 'Auto-detect',
      type: 'radio',
      checked: id === 'auto',
      click: () => actions.setMicrophone('auto'),
    },
  ];
  // One radio group: a separator between radio items would split it, and
  // Electron always checks a group's only item.
  for (const d of devices) {
    items.push({ label: d.label || 'Microphone', type: 'radio', checked: d.deviceId === id, click: () => actions.setMicrophone(d.deviceId) });
  }
  // A chosen device that isn't plugged in now still shows, so the check mark
  // never silently moves to something the app isn't using.
  if (id !== 'auto' && !devices.some((d) => d.deviceId === id)) {
    items.push({ label: 'Selected microphone (not connected)', type: 'radio', checked: true, enabled: false });
  }
  items.push({ type: 'separator' }, { label: 'Microphone Settings…', click: () => actions.openPage('settings/dictation') });
  return items;
}

function languageMenu({ translation }, actions) {
  const t = translation || {};
  if (!t.available) {
    return [
      { label: 'English', type: 'radio', checked: true },
      { label: t.unavailableReason || 'This model is English only', enabled: false },
      { type: 'separator' },
      { label: 'Choose a Model…', click: () => actions.openPage('models') },
    ];
  }
  const current = t.enabled ? t.language : 'en';
  const codes = [...MENU_LANGUAGES];
  if (current !== 'en' && !codes.includes(current)) codes.unshift(current);
  return [
    { label: 'Language you speak', enabled: false },
    // English and the others are one radio group (nothing in between).
    { label: 'English', type: 'radio', checked: current === 'en', click: () => actions.setLanguage('en') },
    ...codes.map((code) => ({
      label: languageName(code),
      type: 'radio',
      checked: current === code,
      click: () => actions.setLanguage(code),
    })),
    { type: 'separator' },
    { label: 'Other languages are translated to English', enabled: false },
    { label: 'More Languages…', click: () => actions.openPage('models') },
  ];
}

function shortcutsMenu({ shortcuts }, actions) {
  const s = shortcuts || {};
  return [
    { label: 'Dictate', sublabel: s.dictate || 'fn', enabled: false },
    // Only while the assistant is on (Settings › General › Beta features).
    ...(s.assistant ? [
      { label: 'Ask the assistant', sublabel: s.command || 'Off', enabled: false },
      // Rewriting runs on the assistant's AI.
      { label: 'Rewrite text', sublabel: s.rewrite || 'Off', enabled: false },
    ] : []),
    { label: 'Paste last transcript', sublabel: '⌃⌘V', enabled: false },
    { type: 'separator' },
    { label: 'Change Shortcuts…', click: () => actions.openPage('settings/dictation') },
  ];
}

/**
 * @param {object} state
 *   recording, meeting: { enabled, active, app }, failedCount,
 *   update: { phase, version }, lastTranscript, shortcuts: { dictate, command, assistant, rewrite },
 *   microphoneId, microphones: [{ deviceId, label }],
 *   translation: { available, unavailableReason, enabled, language }
 * @param {object} actions
 *   open, startRecording, stopRecording, startMeeting, stopMeeting,
 *   checkForUpdates, installUpdate, pasteLast, openPage(page),
 *   setMicrophone(id), setLanguage(code), quit
 */
function buildTrayTemplate(state, actions) {
  const s = state || {};
  const template = [];

  template.push(
    s.recording
      ? { label: 'Stop Recording', click: actions.stopRecording }
      : { label: 'Start Recording', click: actions.startRecording },
  );
  if (s.meeting?.active) {
    template.push({ label: `Stop Meeting Notes (${s.meeting.app || 'Meeting'})`, click: actions.stopMeeting });
  } else if (s.meeting?.enabled) {
    template.push({ label: 'Start Meeting Notes', click: actions.startMeeting });
  }
  template.push({ label: 'Open Tellaflow', click: actions.open });

  template.push({ type: 'separator' });
  const update = s.update || {};
  if (update.phase === 'downloaded') {
    template.push({ label: `Restart to Install Update${update.version ? ` (v${update.version})` : ''}`, click: actions.installUpdate });
  } else {
    const checking = update.phase === 'checking';
    template.push({ label: checking ? 'Checking for Updates…' : 'Check for Updates…', enabled: !checking, click: actions.checkForUpdates });
  }

  template.push({ type: 'separator' });
  const last = previewOf(s.lastTranscript);
  template.push({
    label: 'Paste Last Transcript',
    accelerator: PASTE_LAST_ACCELERATOR,
    // The shortcut is global (registered in main); the menu only shows it.
    registerAccelerator: false,
    enabled: !!last,
    click: actions.pasteLast,
  });
  template.push({ label: last ? `“${last}”` : 'Nothing dictated yet', enabled: false });

  template.push({ type: 'separator' });
  if (s.failedCount > 0) {
    template.push({
      label: `${s.failedCount} Recording${s.failedCount === 1 ? '' : 's'} Need Attention…`,
      click: () => actions.openPage('transcripts'),
    });
  }
  template.push(
    { label: 'Shortcuts', submenu: shortcutsMenu(s, actions) },
    { label: 'Microphone', submenu: microphoneMenu(s, actions) },
    { label: 'Language', submenu: languageMenu(s, actions) },
    { label: 'Settings…', accelerator: 'Command+,', registerAccelerator: false, click: () => actions.openPage('settings') },
  );

  template.push(
    { type: 'separator' },
    { label: 'Quit Tellaflow', accelerator: 'Command+Q', registerAccelerator: false, click: actions.quit },
  );
  return template;
}

module.exports = { buildTrayTemplate, previewOf, PASTE_LAST_ACCELERATOR, MENU_LANGUAGES };
