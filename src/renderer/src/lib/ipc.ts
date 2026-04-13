export interface HotkeyConfig {
  /** keyspy key names: modifiers first, trigger last. E.g. ["Function"] or ["LEFT CTRL", "A"] */
  names: string[];
  label: string;
}

export type Theme = 'light' | 'dark' | 'system';

export type TranscriptionEngine = 'whisper' | 'parakeet';

export interface AppConfig {
  hotkey?: HotkeyConfig;
  model?: string;
  grammarEnabled?: boolean;
  grammarModel?: string;
  grammarTone?: string;
  grammarModelAvailable?: boolean;
  theme?: Theme;
  floatingBarEnabled?: boolean;
  soundsEnabled?: boolean;
  muteWhileDictating?: boolean;
  showInDock?: boolean;
  launchAtLogin?: boolean;
  translationEnabled?: boolean;
  translationLanguage?: string;
  transcriptionEngine?: TranscriptionEngine;
  parakeetAvailable?: boolean;
}

export interface ParakeetModelInfo {
  size: string;
  quality: string;
  available: boolean;
  status: 'downloaded' | 'not_downloaded' | 'downloading' | 'paused';
  downloaded: number;
  total: number;
}

export interface HistoryEntry {
  id: number;
  text: string;
  timestamp: string;
  audioPath?: string | null;
}

export interface ModelInfo {
  size: string;
  quality: string;
  available: boolean;
  status: 'bundled' | 'downloaded' | 'not_downloaded' | 'downloading' | 'paused';
  downloaded: number;
  total: number;
}

export interface DownloadProgress {
  modelKey: string;
  downloaded: number;
  total: number;
  percent: number;
}

export interface DownloadError {
  modelKey: string;
  error: string;
}

export interface DictionaryEntry {
  id: number;
  from: string;
  to: string;
}

export interface SnippetEntry {
  id: number;
  trigger: string;
  content: string;
}

export type Models = Record<string, ModelInfo>;

export interface GrammarModelInfo {
  name: string;
  filename: string;
  size: string;
  bytes: number;
  quality: string;
  context: string;
  description: string;
  url: string;
  available: boolean;
  status: 'downloaded' | 'not_downloaded' | 'downloading' | 'paused';
  downloaded: number;
  total: number;
}

export type GrammarModels = Record<string, GrammarModelInfo>;

/** @deprecated use GrammarModels */
export type GrammarModelStatus = GrammarModelInfo;

// ─── NeuTTS model types ──────────────────────────────────────────────────────

export interface NeuTTSFileStatus {
  key: string;
  label: string;
  filename: string;
  size: string;
  bytes: number;
  available: boolean;
  status: 'downloaded' | 'not_downloaded' | 'downloading' | 'paused';
  downloaded: number;
  total: number;
}

export interface NeuTTSStatus {
  backbone: NeuTTSFileStatus;
  decoder: NeuTTSFileStatus;
  ready: boolean;
}

// ─── Audiobook types ─────────────────────────────────────────────────────────

export interface AudiobookRecord {
  id: number;
  title: string;
  author: string;
  filePath: string | null;
  sourceUrl: string | null;
  totalChunks: number;
  currentChunk: number;
  voiceId: string;
  engine: string;
  createdAt: string;
  updatedAt: string;
}

export interface AudiobookChunk {
  id: number;
  bookId: number;
  chunkIndex: number;
  text: string;
  audioPath: string | null;
  isChapterStart: boolean;
  chapterTitle: string | null;
}

interface TellaflowAPI {
  onStartRecording: (cb: () => void) => void;
  onStopRecording: (cb: () => void) => void;
  sendAudio: (pcm: ArrayBuffer) => void;
  sendCaptureReady: () => void;

  onToastState: (cb: (state: string) => void) => () => void;
  onAudioLevel: (cb: (level: number) => void) => () => void;
  sendAudioLevel: (level: number) => void;
  onToastHotkey: (cb: (label: string) => void) => () => void;

  clickStartRecording: () => void;
  clickCancelRecording: () => void;
  clickFinishRecording: () => void;
  recordFrontmostApp: () => void;
  suppressToastActivation: () => void;

  setHotkey: (hotkey: HotkeyConfig) => void;
  startHotkeyRecording: () => void;
  stopHotkeyRecording: () => void;
  onHotkeyRecorded: (cb: (data: HotkeyConfig) => void) => void;
  onHotkeyRecordingCancelled: (cb: () => void) => void;
  requestMicPermission: () => Promise<boolean>;
  checkAccessibility: () => Promise<boolean>;
  checkMicPermission: () => Promise<boolean>;
  promptAccessibility: () => void;
  openAccessibilitySettings: () => void;
  completeOnboarding: () => void;
  dismissOnboarding: () => void;
  warmUpModel: () => void;
  runModelTest: () => Promise<{ success?: boolean; skipped?: boolean; reason?: string }>;
  setPlaygroundMode: (on: boolean) => void;
  onPlaygroundText: (cb: (text: string) => void) => void;
  offPlaygroundText: () => void;

  getConfig: () => Promise<AppConfig>;
  setModel: (model: string) => void;
  setGrammarEnabled: (enabled: boolean) => void;
  setTheme: (theme: Theme) => void;

  getFloatingBarEnabled: () => Promise<boolean>;
  setFloatingBarEnabled: (enabled: boolean) => void;
  getSoundsEnabled: () => Promise<boolean>;
  setSoundsEnabled: (enabled: boolean) => void;
  getMuteWhileDictating: () => Promise<boolean>;
  setMuteWhileDictating: (enabled: boolean) => void;
  getShowInDock: () => Promise<boolean>;
  setShowInDock: (enabled: boolean) => void;
  getLaunchAtLogin: () => Promise<boolean>;
  setLaunchAtLogin: (enabled: boolean) => void;
  getTranslationEnabled: () => Promise<boolean>;
  setTranslationEnabled: (enabled: boolean) => void;
  getTranslationLanguage: () => Promise<string>;
  setTranslationLanguage: (lang: string) => void;

  getDictionary: () => Promise<DictionaryEntry[]>;
  addDictionaryEntry: (from: string, to: string) => Promise<DictionaryEntry[]>;
  removeDictionaryEntry: (id: number) => Promise<DictionaryEntry[]>;
  updateDictionaryEntry: (id: number, from: string, to: string) => Promise<DictionaryEntry[]>;

  getSnippets: () => Promise<SnippetEntry[]>;
  addSnippet: (trigger: string, content: string) => Promise<SnippetEntry[]>;
  removeSnippet: (id: number) => Promise<SnippetEntry[]>;
  updateSnippet: (id: number, trigger: string, content: string) => Promise<SnippetEntry[]>;

  getModels: () => Promise<Models>;
  startDownload: (modelKey: string) => void;
  pauseDownload: (modelKey: string) => void;
  cancelDownload: (modelKey: string) => void;
  deleteModel: (modelKey: string) => void;
  onDownloadProgress: (cb: (p: DownloadProgress) => void) => () => void;
  onDownloadError: (cb: (e: DownloadError) => void) => () => void;
  onModelsChanged: (cb: (m: Models) => void) => () => void;

  getParakeetStatus: () => Promise<ParakeetModelInfo>;
  startParakeetDownload: () => void;
  cancelParakeetDownload: () => void;
  deleteParakeet: () => void;
  onParakeetDownloadProgress: (cb: (p: DownloadProgress) => void) => () => void;
  onParakeetDownloadError: (cb: (e: { error: string }) => void) => () => void;
  onParakeetStatusChanged: (cb: (s: ParakeetModelInfo) => void) => () => void;

  setTranscriptionEngine: (engine: TranscriptionEngine) => void;
  onConfigChanged: (cb: (c: Partial<AppConfig>) => void) => () => void;

  grantMic: () => Promise<boolean>;
  grantAccessibility: () => void;
  retryHotkey: () => void;
  checkNeedsRestart: () => Promise<boolean>;
  restartApp: () => void;

  getHistory: () => Promise<HistoryEntry[]>;
  clearHistory: () => void;
  deleteHistoryEntry: (id: number) => Promise<HistoryEntry[]>;
  getAudioData: (filePath: string) => Promise<ArrayBuffer | null>;
  copyToClipboard: (text: string) => void;
  pasteText: (text: string) => void;
  onHistoryUpdate: (cb: (entries: HistoryEntry[]) => void) => () => void;

  getGrammarModelsStatus: () => Promise<GrammarModels>;
  startGrammarDownload: (modelKey: string) => void;
  pauseGrammarDownload: (modelKey: string) => void;
  cancelGrammarDownload: (modelKey: string) => void;
  deleteGrammarModel: (modelKey: string) => void;
  setGrammarModel: (modelKey: string) => void;
  getGrammarTone: () => Promise<string>;
  setGrammarTone: (tone: string) => void;
  onGrammarModelProgress: (cb: (p: { modelKey: string; downloaded: number; total: number; percent: number }) => void) => () => void;
  onGrammarModelChanged: (cb: (s: GrammarModels) => void) => () => void;
  onGrammarModelError: (cb: (e: { modelKey: string; error: string }) => void) => () => void;

  clearSnippets: () => Promise<SnippetEntry[]>;
  clearDictionary: () => Promise<DictionaryEntry[]>;
  resetPermissions: () => Promise<boolean>;

  // NeuTTS model management
  getNeuTTSStatus: () => Promise<NeuTTSStatus>;
  getNeuTTSDecoderInfo: () => Promise<{ isLegacy: boolean; decoderPath: string }>;
  upgradeNeuTTSDecoder: () => Promise<{ started: boolean }>;
  startNeuTTSDownload: () => void;
  pauseNeuTTSDownload: (key?: string) => void;
  cancelNeuTTSDownload: (key?: string) => void;
  deleteNeuTTSModel: (key?: string) => void;
  onNeuTTSProgress: (cb: (p: { key: string; downloaded: number; total: number }) => void) => () => void;
  onNeuTTSStatusChanged: (cb: (s: NeuTTSStatus) => void) => () => void;
  onNeuTTSError: (cb: (e: { key: string; error: string }) => void) => () => void;

  // Audiobook management
  getAudiobooks: () => Promise<AudiobookRecord[]>;
  createAudiobook: (opts: { title: string; author: string; text: string; filePath?: string; sourceUrl?: string; voiceId: string; engine: string }) => Promise<AudiobookRecord>;
  deleteAudiobook: (id: number) => Promise<void>;
  getAudiobookChunks: (bookId: number) => Promise<AudiobookChunk[]>;
  updateAudiobookProgress: (bookId: number, chunkIndex: number) => Promise<void>;
  pickPdfFile: () => Promise<{ title: string; author: string; text: string; filePath: string } | null>;
  fetchUrlText: (url: string) => Promise<{ title: string; author: string; text: string } | null>;
  synthesizeChunk: (opts: { text: string; voiceName: string }) => Promise<{ pcmBase64: string; sampleRate: number }>;
  onAudiobooksChanged: (cb: (books: AudiobookRecord[]) => void) => () => void;

  onStatusChange: (cb: (status: string) => void) => () => void;
  onShowRestartBanner: (cb: () => void) => () => void;
  onAccessibilityGranted: (cb: () => void) => () => void;

  openTestWav: () => void;
  openExternal: (url: string) => void;
  getAppVersion: () => Promise<string>;
}

declare global {
  interface Window {
    tellaflow: TellaflowAPI;
  }
}

export const ipc = typeof window !== 'undefined' ? window.tellaflow : (null as unknown as TellaflowAPI);
