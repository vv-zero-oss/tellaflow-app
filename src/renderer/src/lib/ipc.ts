/** What the main process asks the voice island to show. */
export interface IslandView {
  state: import('@/components/voice-island').IslandState;
  answerKind?: import('@/components/voice-island').AnswerKind;
  content?: import('@/components/voice-island').IslandContent;
  correctedWord?: string;
  placement: import('@/components/voice-island').IslandPlacement;
  material: import('@/components/voice-island').IslandMaterial;
}

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
  parakeetVariant?: ParakeetVariant;
  microphoneDeviceId?: string;
  hotkeyActivationDelay?: number;
  autoLearnEnabled?: boolean;
  contextAwarenessEnabled?: boolean;
  meetingNotesEnabled?: boolean;
  meetingBrowserDetection?: boolean;
  audioRetentionDays?: number;
  commandHotkey?: HotkeyConfig | null;
  rewriteHotkey?: HotkeyConfig | null;
  islandPlacement?: 'left' | 'bottom' | 'right';
  islandMaterial?: 'translucent' | 'opaque';
}

export type FeatureSettingKey =
  | 'islandPlacement'
  | 'islandMaterial'
  | 'commandHotkey'
  | 'rewriteHotkey'
  | 'autoLearnEnabled'
  | 'contextAwarenessEnabled'
  | 'meetingNotesEnabled'
  | 'meetingBrowserDetection'
  | 'audioRetentionDays';

export interface FailedJob {
  id: string;
  audioPath: string | null;
  source: 'dictation' | 'meeting' | 'recovered' | string;
  error: string | null;
  createdAt: number;
  durationSec: number | null;
  attempts: number;
  meetingId: string | null;
}

export interface MeetingState {
  enabled: boolean;
  active: boolean;
  app: string | null;
  since: number | null;
  historyId: number | null;
}

/** The theme tokens the Assistant page hands bb's frame — the names both
 *  apps share; main re-checks them (src/main/jarvis/bb/bb-chrome.js). */
export const THEME_TOKENS_FOR_BB = [
  'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground',
  'primary', 'primary-foreground', 'secondary', 'secondary-foreground',
  'muted', 'muted-foreground', 'accent', 'accent-foreground',
  'destructive', 'border', 'input', 'ring',
  'sidebar', 'sidebar-foreground', 'sidebar-primary', 'sidebar-primary-foreground',
  'sidebar-accent', 'sidebar-accent-foreground', 'sidebar-border', 'sidebar-ring',
  'radius',
] as const;

export interface AssistantSettings {
  /** One of bb's provider ids ("claude-code", "codex", …), or 'auto'. */
  provider: string;
  /** Plain desktop steps run without a confirmation. */
  fullAccess: boolean;
  /** The assistant may click and type in other apps. */
  desktopActions: boolean;
  /** A picture of the screen goes with each request. */
  screenVision: boolean;
}

/** How the rewrite shortcut rewrites (src/main/jarvis/rewrite.js REWRITE_STYLES). */
export type RewriteStyle = 'grammar' | 'formal' | 'casual' | 'concise' | 'custom';

export interface RewriteSettings {
  style: RewriteStyle;
  /** The user's own instructions, for the 'custom' style. */
  instructions: string;
  /** Every dictation is pasted in this style. */
  dictation: boolean;
}

/** One of bb's providers and whether it can run here. */
export interface AssistantProvider {
  id: string;
  label: string;
  status: 'ready' | 'not_installed' | 'unauthenticated' | 'expired' | 'unsupported_version' | 'unknown' | string;
  /** What to run once in Terminal to sign in, as bb says it. */
  loginCommand: string | null;
  accountEmail: string | null;
}

export interface AssistantBackendStatus {
  state: 'idle' | 'starting' | 'ready' | 'error';
  error: string | null;
  origin?: string;
}

export interface AssistantDesktopStatus {
  status: { supported: boolean; screenRecording: boolean; accessibility: boolean; peekaboo: { ok: boolean; version: string | null; error?: string } } | null;
  helper: { ok: boolean; version: string | null; source: string | null; error?: string } | null;
}

export interface AssistantTranscriptEntry {
  role: 'user' | 'mascot';
  text: string;
  actions?: string[];
  at?: number;
}

export type ParakeetVariant = 'v2' | 'unified';

export interface ParakeetModelInfo {
  variant?: ParakeetVariant;
  label?: string;
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
  kind?: 'dictation' | 'meeting' | 'assistant';
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
  variant?: ParakeetVariant;
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
  /** Present when row came from a preset pack install */
  packId?: string | null;
}

export interface DictionaryPackEntry {
  from: string;
  to: string;
}

export interface DictionaryPackCatalogItem {
  id: string;
  title: string;
  description: string;
  category: string;
  entryCount: number;
  entries: DictionaryPackEntry[];
  installed: boolean;
  installedCount: number;
}

export interface SnippetEntry {
  id: number;
  trigger: string;
  content: string;
}

export type Models = Record<string, ModelInfo>;

interface TellaflowAPI {
  onStartRecording: (cb: (data?: { deviceId?: string }) => void) => void;
  onStopRecording: (cb: () => void) => void;
  sendAudio: (pcm: ArrayBuffer) => void;
  sendCaptureReady: () => void;

  onToastState: (cb: (state: string) => void) => () => void;
  onIslandUpdate: (cb: (view: IslandView) => void) => () => void;
  islandAction: (action: string) => void;
  onAudioLevel: (cb: (level: number) => void) => () => void;
  sendAudioLevel: (level: number) => void;
  onToastHotkey: (cb: (label: string) => void) => () => void;

  clickStartRecording: () => void;
  clickCancelRecording: () => void;
  clickFinishRecording: () => void;
  recordFrontmostApp: () => void;
  suppressToastActivation: () => void;
  setToastInteractive: (interactive: boolean) => void;

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
  checkScreenPermission: () => Promise<boolean>;
  requestScreenPermission: () => Promise<boolean>;
  completeOnboarding: () => void;
  dismissOnboarding: () => void;
  warmUpModel: () => void;
  runModelTest: () => Promise<{ success?: boolean; skipped?: boolean; reason?: string }>;
  setPlaygroundMode: (on: boolean) => void;
  onPlaygroundText: (cb: (text: string) => void) => void;
  offPlaygroundText: () => void;

  getConfig: () => Promise<AppConfig>;
  setModel: (model: string) => void;
  setTheme: (theme: Theme) => void;

  getFloatingBarEnabled: () => Promise<boolean>;
  setFloatingBarEnabled: (enabled: boolean) => void;
  getSoundsEnabled: () => Promise<boolean>;
  setSoundsEnabled: (enabled: boolean) => void;
  getMuteWhileDictating: () => Promise<boolean>;
  setMuteWhileDictating: (enabled: boolean) => void;
  getHotkeyActivationDelay: () => Promise<number>;
  setHotkeyActivationDelay: (ms: number) => void;
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
  getDictionaryPacksCatalog: () => Promise<DictionaryPackCatalogItem[]>;
  installDictionaryPack: (packId: string) => Promise<DictionaryEntry[]>;
  uninstallDictionaryPack: (packId: string) => Promise<DictionaryEntry[]>;

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

  getParakeetStatus: (variant?: ParakeetVariant) => Promise<ParakeetModelInfo>;
  startParakeetDownload: (variant?: ParakeetVariant) => void;
  cancelParakeetDownload: (variant?: ParakeetVariant) => void;
  deleteParakeet: (variant?: ParakeetVariant) => void;
  setParakeetVariant: (variant: ParakeetVariant) => void;
  onParakeetDownloadProgress: (cb: (p: DownloadProgress) => void) => () => void;
  onParakeetDownloadError: (cb: (e?: { variant?: ParakeetVariant; error: string }) => void) => () => void;
  onParakeetStatusChanged: (cb: (s: ParakeetModelInfo) => void) => () => void;

  setTranscriptionEngine: (engine: TranscriptionEngine) => void;
  setMicrophoneDeviceId: (deviceId: string) => void;
  onConfigChanged: (cb: (c: Partial<AppConfig>) => void) => () => void;

  grantMic: () => Promise<boolean>;
  grantAccessibility: () => void;
  retryHotkey: () => void;
  checkNeedsRestart: () => Promise<boolean>;
  restartApp: () => void;

  getHistory: () => Promise<HistoryEntry[]>;
  clearHistory: () => void;
  deleteHistoryEntry: (id: number) => Promise<HistoryEntry[]>;
  retryTranscription: (id: number) => Promise<string>;
  getAudioData: (filePath: string) => Promise<ArrayBuffer | null>;
  copyToClipboard: (text: string) => void;
  pasteText: (text: string) => void;
  onHistoryUpdate: (cb: (entries: HistoryEntry[]) => void) => () => void;


  clearSnippets: () => Promise<SnippetEntry[]>;
  clearDictionary: () => Promise<DictionaryEntry[]>;
  resetPermissions: () => Promise<boolean>;

  getModelLoadState?: () => Promise<ModelLoadState>;
  onModelLoadState?: (cb: (state: ModelLoadState) => void) => () => void;
  onStatusChange: (cb: (status: string) => void) => () => void;
  onShowRestartBanner: (cb: () => void) => () => void;
  onAccessibilityGranted: (cb: () => void) => () => void;

  openTestWav: () => void;
  openExternal: (url: string) => void;
  getAppVersion: () => Promise<string>;

  getUpdateStatus: () => Promise<UpdateStatus>;
  checkForUpdates: () => void;
  installUpdate: () => void;
  onUpdateStatus: (cb: (status: UpdateStatus) => void) => () => void;

  getFailedJobs: () => Promise<FailedJob[]>;
  retryFailedJob: (id: string) => Promise<string>;
  retryAllFailedJobs: () => Promise<{ ok: number; failed: number }>;
  discardFailedJob: (id: string) => Promise<FailedJob[]>;
  onFailedJobsChanged: (cb: (jobs: FailedJob[]) => void) => () => void;
  getTranscriptionStats: () => Promise<Record<string, number | boolean>>;

  setFeatureSetting: (key: FeatureSettingKey, value: boolean | number | string | HotkeyConfig | null) => Promise<boolean>;
  onDictionaryChanged: (cb: (entries: DictionaryEntry[]) => void) => () => void;

  getMeetingState: () => Promise<MeetingState>;
  startMeetingNotes: () => Promise<MeetingState>;
  stopMeetingNotes: () => Promise<MeetingState>;
  onMeetingState: (cb: (s: MeetingState) => void) => () => void;

  assistantAsk: (request: string) => Promise<boolean>;
  assistantStop: () => Promise<void>;
  assistantStatus: () => Promise<{ backend: AssistantBackendStatus; desktop: AssistantDesktopStatus['status'] }>;
  assistantProviders: () => Promise<AssistantProvider[]>;
  assistantWorkspaceUrl: (threadId?: string) => Promise<{ ok: true; url: string; origin: string; projectId: string; threadId?: string } | { ok: false; error: string }>;
  assistantTranscript: () => Promise<AssistantTranscriptEntry[]>;
  assistantReset: () => Promise<void>;
  assistantStyleFrame: (options: { theme: 'light' | 'dark'; tokens: Record<string, string> }) => Promise<{ ok: boolean; applied?: number; error?: string }>;
  assistantGetSettings: () => Promise<AssistantSettings>;
  assistantSetSettings: (patch: Partial<AssistantSettings>) => Promise<AssistantSettings>;
  rewriteGetSettings: () => Promise<RewriteSettings>;
  rewriteSetSettings: (patch: Partial<RewriteSettings>) => Promise<RewriteSettings>;
  assistantInstallHelper: () => Promise<{ ok: boolean; error?: string }>;
  assistantRequestAccessibility: () => Promise<{ granted: boolean }>;
  assistantDesktopStatus: () => Promise<AssistantDesktopStatus>;
  onAssistantStatus: (cb: (s: AssistantBackendStatus) => void) => () => void;
  onAssistantTranscript: (cb: (e: AssistantTranscriptEntry) => void) => () => void;
  onAssistantOpenChat: (cb: (url: string) => void) => () => void;
  onAssistantHelperProgress: (cb: (p: { received: number; total: number | null }) => void) => () => void;
  onNavigate: (cb: (page: string) => void) => () => void;
}

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'not-available'
  | 'error';

export interface UpdateProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

export type ModelLoadState =
  | { loading: true; engine: 'whisper' | 'parakeet'; startedAt: number; expectedMs: number }
  | { loading: false; ok?: boolean; engine?: 'whisper' | 'parakeet' };

export interface UpdateStatus {
  phase: UpdatePhase;
  currentVersion: string;
  updateVersion: string | null;
  progress: UpdateProgress | null;
  error: string | null;
  userInitiated: boolean;
  checkedAt: number | null;
}

declare global {
  interface Window {
    tellaflow: TellaflowAPI;
  }
}

export const ipc = typeof window !== 'undefined' ? window.tellaflow : (null as unknown as TellaflowAPI);
