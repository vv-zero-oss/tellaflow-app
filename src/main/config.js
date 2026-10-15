const { getDb } = require('./db');
const { getDictionaryPacksManifest, getPackById } = require('./dictionary-packs');

const DEFAULTS = {
  hotkey: { names: ['FN'], label: 'fn' },
  // Hold to speak a command to the assistant instead of dictating text.
  commandHotkey: { names: ['RIGHT ALT'], label: 'Right ⌥' },
  islandPlacement: 'bottom',
  islandMaterial: 'translucent',
  model: 'small',
  programmingMode: false,
  grammarEnabled: false,
  onboardingComplete: false,
  accessibilityGrantedOnce: false,
  floatingBarEnabled: false,
  soundsEnabled: true,
  muteWhileDictating: false,
  showInDock: true,
  translationEnabled: false,
  translationLanguage: 'ja',
  transcriptionEngine: 'parakeet',
  // Which Parakeet model the parakeet engine uses: 'v2' (bundled) or 'unified'.
  parakeetVariant: 'v2',
  microphoneDeviceId: 'auto',
  hotkeyActivationDelay: 0,
  autoLearnEnabled: true,
  autoLearnBlocklist: [],
  contextAwarenessEnabled: true,
  meetingNotesEnabled: false,
  meetingBrowserDetection: true,
  audioRetentionDays: 30,
  assistantProvider: 'auto',
  // Full access: the assistant runs every action without asking first.
  assistantFullAccess: true,
  ollamaModel: '',
  automationGranted: false,
};

const AUTO_LEARN_PACK_ID = 'auto-learned';

// Map from uiohook scan codes to keyspy key names (for migrating old configs)
const UIOHOOK_TO_KEYSPY = {
  3640: 'RIGHT ALT', 56: 'LEFT ALT',
  29: 'LEFT CTRL', 3613: 'RIGHT CTRL',
  42: 'LEFT SHIFT', 54: 'RIGHT SHIFT',
  3675: 'LEFT META', 3676: 'RIGHT META',
  57: 'SPACE', 28: 'RETURN', 14: 'BACKSPACE', 15: 'TAB', 1: 'ESCAPE',
  59: 'F1', 60: 'F2', 61: 'F3', 62: 'F4', 63: 'F5', 64: 'F6',
  65: 'F7', 66: 'F8', 67: 'F9', 68: 'F10', 87: 'F11', 88: 'F12',
};

function migrateHotkey(raw) {
  // Old format: { keycode, ctrlKey, altKey, shiftKey, metaKey, label }
  if (raw && typeof raw.keycode === 'number') {
    const names = [];
    if (raw.ctrlKey) names.push('LEFT CTRL');
    if (raw.altKey) names.push('LEFT ALT');
    if (raw.shiftKey) names.push('LEFT SHIFT');
    if (raw.metaKey) names.push('LEFT META');
    const mainKey = UIOHOOK_TO_KEYSPY[raw.keycode] || raw.label || 'RIGHT ALT';
    names.push(mainKey);
    return { names, label: raw.label || mainKey };
  }
  return raw;
}

function getSetting(key) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return DEFAULTS[key];
  try { return JSON.parse(row.value); } catch { return row.value; }
}

function setSetting(key, value) {
  getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
}

function getHotkey() {
  const raw = getSetting('hotkey');
  const hk = migrateHotkey(raw);
  if (!hk || !Array.isArray(hk.names) || hk.names.length === 0) return DEFAULTS.hotkey;
  return hk;
}
function setHotkey(hotkey) { setSetting('hotkey', hotkey); }

/** The command key, or null when the user turned it off. */
function getCommandHotkey() {
  const v = getSetting('commandHotkey');
  if (v === null) return null;
  if (!v || !Array.isArray(v.names) || v.names.length === 0) return DEFAULTS.commandHotkey;
  return v;
}
function setCommandHotkey(hotkey) {
  setSetting('commandHotkey', hotkey && Array.isArray(hotkey.names) && hotkey.names.length ? hotkey : null);
}

const ISLAND_PLACEMENTS = ['left', 'bottom', 'right'];
const ISLAND_MATERIALS = ['translucent', 'opaque'];
function getIslandPlacement() {
  const v = getSetting('islandPlacement');
  return ISLAND_PLACEMENTS.includes(v) ? v : DEFAULTS.islandPlacement;
}
function setIslandPlacement(v) { if (ISLAND_PLACEMENTS.includes(v)) setSetting('islandPlacement', v); }
function getIslandMaterial() {
  const v = getSetting('islandMaterial');
  return ISLAND_MATERIALS.includes(v) ? v : DEFAULTS.islandMaterial;
}
function setIslandMaterial(v) { if (ISLAND_MATERIALS.includes(v)) setSetting('islandMaterial', v); }

function getModel() { return getSetting('model'); }
function setModel(model) { setSetting('model', model); }

function getProgrammingMode() { return getSetting('programmingMode'); }
function setProgrammingMode(enabled) { setSetting('programmingMode', enabled); }

function getGrammarEnabled() { return getSetting('grammarEnabled'); }
function setGrammarEnabled(enabled) { setSetting('grammarEnabled', enabled); }

function getGrammarModel() { return getSetting('grammarModel') || 'qwen2.5-0.5b'; }
function setGrammarModel(key) { setSetting('grammarModel', key); }

function getGrammarTone() { return getSetting('grammarTone') || 'casual'; }
function setGrammarTone(tone) { setSetting('grammarTone', tone); }

function isOnboardingComplete() { return getSetting('onboardingComplete'); }
function setOnboardingComplete(complete) { setSetting('onboardingComplete', complete); }

function getAutomationGranted() { return getBool('automationGranted'); }
function setAutomationGranted(v) { setSetting('automationGranted', !!v); }
function getAccessibilityGrantedOnce() { return getSetting('accessibilityGrantedOnce'); }
function setAccessibilityGrantedOnce(value) { setSetting('accessibilityGrantedOnce', value); }

function getTheme() { return getSetting('theme') || 'dark'; }
function setTheme(theme) { setSetting('theme', theme); }

function getFloatingBarEnabled() { return getSetting('floatingBarEnabled'); }
function setFloatingBarEnabled(enabled) { setSetting('floatingBarEnabled', enabled); }

function getSoundsEnabled() { return getSetting('soundsEnabled'); }
function setSoundsEnabled(enabled) { setSetting('soundsEnabled', enabled); }

function getMuteWhileDictating() { return getSetting('muteWhileDictating'); }
function setMuteWhileDictating(enabled) { setSetting('muteWhileDictating', enabled); }

function getShowInDock() { return getSetting('showInDock'); }
function setShowInDock(enabled) { setSetting('showInDock', enabled); }

function getTranslationEnabled() { return getSetting('translationEnabled'); }
function setTranslationEnabled(enabled) { setSetting('translationEnabled', enabled); }

function getTranslationLanguage() { return getSetting('translationLanguage') || 'ja'; }
function setTranslationLanguage(lang) { setSetting('translationLanguage', lang); }

const PARAKEET_VARIANT_IDS = ['v2', 'unified'];
function getParakeetVariant() {
  const v = getSetting('parakeetVariant');
  return PARAKEET_VARIANT_IDS.includes(v) ? v : DEFAULTS.parakeetVariant;
}
function setParakeetVariant(v) { if (PARAKEET_VARIANT_IDS.includes(v)) setSetting('parakeetVariant', v); }

function getTranscriptionEngine() { return getSetting('transcriptionEngine') || 'parakeet'; }
function setTranscriptionEngine(engine) { setSetting('transcriptionEngine', engine); }

function getMicrophoneDeviceId() { return getSetting('microphoneDeviceId') || 'auto'; }
function setMicrophoneDeviceId(deviceId) { setSetting('microphoneDeviceId', deviceId); }

function getHotkeyActivationDelay() {
  const val = getSetting('hotkeyActivationDelay');
  const ms = typeof val === 'number' && isFinite(val) ? val : 0;
  return Math.max(0, Math.min(ms, 5000));
}
function setHotkeyActivationDelay(ms) { setSetting('hotkeyActivationDelay', ms); }

function getBool(key) { const v = getSetting(key); return typeof v === 'boolean' ? v : DEFAULTS[key]; }

function getAutoLearnEnabled() { return getBool('autoLearnEnabled'); }
function setAutoLearnEnabled(v) { setSetting('autoLearnEnabled', !!v); }
function getContextAwarenessEnabled() { return getBool('contextAwarenessEnabled'); }
function setContextAwarenessEnabled(v) { setSetting('contextAwarenessEnabled', !!v); }
function getMeetingNotesEnabled() { return getBool('meetingNotesEnabled'); }
function setMeetingNotesEnabled(v) { setSetting('meetingNotesEnabled', !!v); }
function getMeetingBrowserDetection() { return getBool('meetingBrowserDetection'); }
function setMeetingBrowserDetection(v) { setSetting('meetingBrowserDetection', !!v); }

// Last measured model load time (ms) per model, keyed by engine + path.
// Drives the time-based "Loading model" progress bar.
function getModelLoadTimes() {
  const v = getSetting('modelLoadTimes');
  return v && typeof v === 'object' ? v : {};
}
function setModelLoadTime(id, ms) {
  setSetting('modelLoadTimes', { ...getModelLoadTimes(), [id]: ms });
}

function getAudioRetentionDays() {
  const v = getSetting('audioRetentionDays');
  // 0 = keep forever
  return typeof v === 'number' && isFinite(v) && v >= 0 ? Math.min(Math.round(v), 3650) : DEFAULTS.audioRetentionDays;
}
function setAudioRetentionDays(days) { setSetting('audioRetentionDays', Number(days)); }

const ASSISTANT_PROVIDERS = ['auto', 'claude', 'codex', 'gemini', 'ollama'];
function getAssistantSettings() {
  const provider = getSetting('assistantProvider');
  return {
    provider: ASSISTANT_PROVIDERS.includes(provider) ? provider : 'auto',
    fullAccess: getBool('assistantFullAccess'),
    ollamaModel: typeof getSetting('ollamaModel') === 'string' ? getSetting('ollamaModel') : '',
  };
}
function setAssistantSettings(patch = {}) {
  if (patch.provider !== undefined && ASSISTANT_PROVIDERS.includes(patch.provider)) setSetting('assistantProvider', patch.provider);
  if (patch.fullAccess !== undefined) setSetting('assistantFullAccess', !!patch.fullAccess);
  if (typeof patch.ollamaModel === 'string') setSetting('ollamaModel', patch.ollamaModel.trim().slice(0, 100));
  return getAssistantSettings();
}

function blockKey(from, to) { return `${String(from).toLowerCase()}\u2192${to}`; }

function getAutoLearnBlocklist() {
  const v = getSetting('autoLearnBlocklist');
  return Array.isArray(v) ? v : [];
}

/**
 * Add corrections learned from the user's edits. Skips anything already in
 * the dictionary and anything the user previously deleted (blocklist).
 * Returns the entries actually added.
 */
function addLearnedEntries(corrections) {
  const blocked = new Set(getAutoLearnBlocklist());
  const findExisting = getDb().prepare('SELECT id, pack_id FROM dictionary WHERE lower(from_word) = lower(?)');
  const insert = getDb().prepare('INSERT INTO dictionary (from_word, to_word, pack_id) VALUES (?, ?, ?)');
  const added = [];
  for (const c of corrections || []) {
    const from = String(c.from || '').trim();
    const to = String(c.to || '').trim();
    if (!from || !to || blocked.has(blockKey(from, to))) continue;
    if (findExisting.get(from)) continue;
    insert.run(from, to, AUTO_LEARN_PACK_ID);
    added.push({ from, to });
  }
  return added;
}

function getDictionary() {
  const rows = getDb()
    .prepare('SELECT id, from_word, to_word, pack_id FROM dictionary ORDER BY id')
    .all();
  return rows.map((r) => ({
    id: r.id,
    from: r.from_word,
    to: r.to_word,
    packId: r.pack_id ?? null,
  }));
}

function setDictionary(entries) {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM dictionary').run();
    const insert = db.prepare(
      'INSERT INTO dictionary (from_word, to_word, pack_id) VALUES (?, ?, ?)',
    );
    for (const e of entries) {
      insert.run(e.from, e.to || '', e.packId ?? null);
    }
  });
  tx();
}

function addDictionaryEntry(from, to) {
  getDb()
    .prepare('INSERT INTO dictionary (from_word, to_word, pack_id) VALUES (?, ?, ?)')
    .run(from, to || '', null);
  return getDictionary();
}

/** The user said "No" to learning these: never offer them again. */
function blockLearnedEntries(corrections = []) {
  const list = getAutoLearnBlocklist();
  const keys = corrections.map((c) => blockKey(c.from, c.to)).filter((k) => !list.includes(k));
  if (keys.length) setSetting('autoLearnBlocklist', [...list, ...keys].slice(-500));
}

function removeDictionaryEntry(id) {
  // Deleting an auto-learned word means "stop learning this" — remember it.
  const row = getDb().prepare('SELECT from_word, to_word, pack_id FROM dictionary WHERE id = ?').get(id);
  if (row && row.pack_id === AUTO_LEARN_PACK_ID) {
    const list = getAutoLearnBlocklist();
    const k = blockKey(row.from_word, row.to_word);
    if (!list.includes(k)) setSetting('autoLearnBlocklist', [...list, k].slice(-500));
  }
  getDb().prepare('DELETE FROM dictionary WHERE id = ?').run(id);
  return getDictionary();
}

function updateDictionaryEntry(id, from, to) {
  getDb().prepare('UPDATE dictionary SET from_word = ?, to_word = ? WHERE id = ?').run(from, to || '', id);
  return getDictionary();
}

function clearDictionary() {
  getDb().prepare('DELETE FROM dictionary').run();
  return getDictionary();
}

function getDictionaryPacksCatalog() {
  const packs = getDictionaryPacksManifest();
  const rows = getDb()
    .prepare(
      'SELECT pack_id, COUNT(*) as cnt FROM dictionary WHERE pack_id IS NOT NULL GROUP BY pack_id',
    )
    .all();
  const installed = new Map(rows.map((r) => [r.pack_id, r.cnt]));
  return packs.map((p) => ({
    ...p,
    installed: (installed.get(p.id) || 0) > 0,
    installedCount: installed.get(p.id) || 0,
  }));
}

function installDictionaryPack(packId) {
  const pack = getPackById(packId);
  if (!pack || !Array.isArray(pack.entries)) {
    throw new Error(`Unknown dictionary pack: ${packId}`);
  }
  const findExisting = getDb().prepare(
    'SELECT id, pack_id FROM dictionary WHERE lower(from_word) = lower(?)',
  );
  const insert = getDb().prepare(
    'INSERT INTO dictionary (from_word, to_word, pack_id) VALUES (?, ?, ?)',
  );
  const update = getDb().prepare('UPDATE dictionary SET to_word = ? WHERE id = ?');

  const tx = getDb().transaction(() => {
    for (const e of pack.entries) {
      const from = (e.from || '').trim();
      if (!from) continue;
      const to = (e.to ?? '').toString();
      const ex = findExisting.get(from);
      if (ex) {
        if (ex.pack_id == null) continue;
        if (ex.pack_id === packId) {
          update.run(to, ex.id);
        }
        continue;
      }
      insert.run(from, to, packId);
    }
  });
  tx();
  return getDictionary();
}

function uninstallDictionaryPack(packId) {
  getDb().prepare('DELETE FROM dictionary WHERE pack_id = ?').run(packId);
  return getDictionary();
}

module.exports = {
  AUTO_LEARN_PACK_ID,
  getAutoLearnEnabled,
  setAutoLearnEnabled,
  getContextAwarenessEnabled,
  setContextAwarenessEnabled,
  getMeetingNotesEnabled,
  setMeetingNotesEnabled,
  getMeetingBrowserDetection,
  setMeetingBrowserDetection,
  getAudioRetentionDays,
  getModelLoadTimes,
  setModelLoadTime,
  setAudioRetentionDays,
  getAssistantSettings,
  setAssistantSettings,
  getAutoLearnBlocklist,
  addLearnedEntries,
  blockLearnedEntries,
  getHotkey,
  setHotkey,
  getCommandHotkey,
  setCommandHotkey,
  getParakeetVariant,
  setParakeetVariant,
  getIslandPlacement,
  setIslandPlacement,
  getIslandMaterial,
  setIslandMaterial,
  getModel,
  setModel,
  getProgrammingMode,
  setProgrammingMode,
  getGrammarEnabled,
  setGrammarEnabled,
  getGrammarModel,
  setGrammarModel,
  getGrammarTone,
  setGrammarTone,
  isOnboardingComplete,
  setOnboardingComplete,
  getAccessibilityGrantedOnce,
  setAccessibilityGrantedOnce,
  getAutomationGranted,
  setAutomationGranted,
  getTheme,
  setTheme,
  getFloatingBarEnabled,
  setFloatingBarEnabled,
  getSoundsEnabled,
  setSoundsEnabled,
  getMuteWhileDictating,
  setMuteWhileDictating,
  getShowInDock,
  setShowInDock,
  getTranslationEnabled,
  setTranslationEnabled,
  getTranslationLanguage,
  setTranslationLanguage,
  getTranscriptionEngine,
  setTranscriptionEngine,
  getMicrophoneDeviceId,
  setMicrophoneDeviceId,
  getHotkeyActivationDelay,
  setHotkeyActivationDelay,
  getDictionary,
  setDictionary,
  addDictionaryEntry,
  removeDictionaryEntry,
  updateDictionaryEntry,
  clearDictionary,
  getDictionaryPacksCatalog,
  installDictionaryPack,
  uninstallDictionaryPack,
};
