const { getDb } = require('./db');
const { getDictionaryPacksManifest, getPackById } = require('./dictionary-packs');

const DEFAULTS = {
  hotkey: { names: ['FN'], label: 'fn' },
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
  microphoneDeviceId: 'auto',
  hotkeyActivationDelay: 0,
};

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

function removeDictionaryEntry(id) {
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
  getHotkey,
  setHotkey,
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
