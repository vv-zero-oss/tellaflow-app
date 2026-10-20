import { useEffect, useRef, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Well, WellHeader, WellTitle, WellCard, WellItem } from '@/components/ui/well';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { GeneralSettings, DictationSettings } from './GeneralSettings';
import { PermissionsSettings } from './PermissionsSettings';
import { IslandSettings } from './SystemSettings';
import { SmartDictationSettings, MeetingSettings, RetentionRow } from './SmartFeaturesSettings';
import { AssistantSettings, BetaFeatures } from './AssistantSettings';
import { UpdateRow } from './UpdateRow';
import { usePermissions } from '@/hooks/use-permissions';
import { useAssistantRuntime } from '@/hooks/use-assistant-runtime';
import type { AppConfig, Theme } from '@/lib/ipc';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

/** Settings' tabs, in order. 'assistant' exists only while the assistant is on. */
export const SETTINGS_TABS = [
  { id: 'general', label: 'General' },
  { id: 'dictation', label: 'Dictation' },
  { id: 'meetings', label: 'Meetings' },
  { id: 'assistant', label: 'Assistant' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'data', label: 'Data & privacy' },
  { id: 'about', label: 'About' },
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number]['id'];
export function isSettingsTab(v: unknown): v is SettingsTab {
  return SETTINGS_TABS.some((t) => t.id === v);
}

interface SettingsPageProps {
  visible: boolean;
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  config: AppConfig;
  setTheme: (theme: Theme) => void;
  refreshConfig: () => Promise<void>;
  onClearHistory: () => void;
}

type ResetKey = 'transcripts' | 'whisperModels' | 'snippets' | 'dictionary' | 'permissions' | 'assistant';

const RESET_OPTIONS: { key: ResetKey; label: string; description: string }[] = [
  { key: 'transcripts', label: 'Transcripts', description: 'All recorded transcription history' },
  { key: 'whisperModels', label: 'Whisper Models', description: 'All downloaded speech recognition models' },
  { key: 'snippets', label: 'Snippets', description: 'All custom text expansion snippets' },
  { key: 'dictionary', label: 'Dictionary', description: 'All custom word replacements' },
  { key: 'permissions', label: 'Permissions', description: 'Reset permission grants and onboarding state' },
  { key: 'assistant', label: 'Assistant', description: 'Turn the assistant off and delete its download' },
];
const NO_RESET: Record<ResetKey, boolean> = {
  transcripts: false, whisperModels: false, snippets: false, dictionary: false, permissions: false, assistant: false,
};

function ResetCheckbox({
  checked,
  indeterminate,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      className="flex items-start gap-3 w-full text-left group"
      onClick={() => onChange(!checked)}
    >
      <span
        className={[
          'mt-0.5 flex-shrink-0 w-4 h-4 rounded border transition-colors flex items-center justify-center',
          checked || indeterminate
            ? 'bg-destructive border-destructive'
            : 'border-input bg-background group-hover:border-muted-foreground',
        ].join(' ')}
      >
        {indeterminate && !checked ? (
          <span className="w-2 h-0.5 bg-background rounded-full" />
        ) : checked ? (
          <Check className="w-2.5 h-2.5 text-destructive-foreground" strokeWidth={3} />
        ) : null}
      </span>
      <span className="flex flex-col min-w-0">
        <span className="text-sm leading-none">{label}</span>
        {description && (
          <span className="text-xs text-muted-foreground mt-0.5 leading-snug">{description}</span>
        )}
      </span>
    </button>
  );
}

export function SettingsPage({
  visible,
  tab: requestedTab,
  onTabChange,
  config,
  setTheme,
  refreshConfig,
  onClearHistory,
}: SettingsPageProps) {
  const { mic, accessibility, screen, needsRestart, grantMic, grantAccessibility, grantScreen, retryHotkey, restartApp, startPolling, stopPolling, refresh: refreshPerms } = usePermissions();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetSelections, setResetSelections] = useState<Record<ResetKey, boolean>>(NO_RESET);
  const { runtime: assistantRuntime, setEnabled: setAssistantEnabled, remove: removeAssistant } = useAssistantRuntime();
  const assistantOn = !!assistantRuntime?.enabled;
  // The Assistant tab while the assistant is off (a stale link, or it was just
  // turned off) falls back to General, where its switch is.
  const tab: SettingsTab = requestedTab === 'assistant' && assistantRuntime && !assistantOn ? 'general' : requestedTab;
  const tabs = SETTINGS_TABS.filter((t) => t.id !== 'assistant' || assistantOn);
  // Reset offers the assistant only when there is something of it to reset.
  const resetOptions = RESET_OPTIONS.filter((o) => o.key !== 'assistant' || (assistantRuntime && (assistantRuntime.enabled || assistantRuntime.state !== 'missing')));
  const [resetting, setResetting] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [appVersion, setAppVersion] = useState<string>('');

  useEffect(() => {
    window.tellaflow.getAppVersion().then(setAppVersion);
  }, []);

  useEffect(() => {
    if (visible) {
      refreshConfig();
      startPolling();
    } else {
      stopPolling();
    }
    return stopPolling;
  }, [visible, refreshConfig, startPolling, stopPolling]);

  const handleRecheck = async () => {
    const ok = await window.tellaflow.checkAccessibility();
    if (ok) retryHotkey();
    refreshPerms();
  };

  const handleConfirmClear = () => {
    onClearHistory();
    setConfirmOpen(false);
  };

  const allSelected = resetOptions.every((o) => resetSelections[o.key]);
  const someSelected = resetOptions.some((o) => resetSelections[o.key]);

  const toggleAll = () => {
    const next = !allSelected;
    setResetSelections(Object.fromEntries(resetOptions.map((o) => [o.key, next])) as Record<ResetKey, boolean>);
  };

  const toggleOne = (key: ResetKey, value: boolean) => {
    setResetSelections((prev) => ({ ...prev, [key]: value }));
  };

  const openResetModal = () => {
    setResetSelections(NO_RESET);
    setResetOpen(true);
  };

  const handleReset = async () => {
    setResetConfirmOpen(false);
    setResetting(true);
    try {
      if (resetSelections.transcripts) {
        window.tellaflow.clearHistory();
        onClearHistory();
      }
      if (resetSelections.whisperModels) {
        const models = await window.tellaflow.getModels();
        for (const [key, info] of Object.entries(models)) {
          if (info.status !== 'bundled' && info.available) {
            window.tellaflow.deleteModel(key);
          }
        }
      }
      if (resetSelections.snippets) {
        await window.tellaflow.clearSnippets();
      }
      if (resetSelections.dictionary) {
        await window.tellaflow.clearDictionary();
      }
      if (resetSelections.permissions) {
        await window.tellaflow.resetPermissions();
      }
      if (resetSelections.assistant) {
        await setAssistantEnabled(false);
        await removeAssistant();
      }
      window.dispatchEvent(new CustomEvent('tellaflow:data-reset', {
        detail: { ...resetSelections },
      }));
    } finally {
      setResetting(false);
      setResetOpen(false);
    }
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  // Each tab opens at its top.
  useEffect(() => { scrollRef.current?.querySelector('[data-radix-scroll-area-viewport]')?.scrollTo({ top: 0 }); }, [tab]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="px-7 pt-12 pb-3 [-webkit-app-region:drag]">
        <h2 className="text-xl font-bold tracking-tight">Settings</h2>
      </div>
      <div className="px-7 pb-3 border-b border-border/60 [-webkit-app-region:no-drag]">
        <div role="tablist" aria-label="Settings" className="flex flex-wrap gap-1" data-testid="settings-tabs">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => onTabChange(t.id)}
              className={cn(
                'rounded-full px-3 py-1 text-sm font-medium transition-colors',
                tab === t.id ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="px-7 py-6" role="tabpanel">
          {tab === 'general' && (
            <>
              <GeneralSettings config={config} onSetTheme={setTheme} refreshConfig={refreshConfig} />
              <BetaFeatures onOpenAssistant={() => onTabChange('assistant')} />
            </>
          )}
          {tab === 'dictation' && (
            <>
              <DictationSettings config={config} refreshConfig={refreshConfig} commandHotkey={assistantOn ? config.commandHotkey ?? null : null} />
              <IslandSettings config={config} refreshConfig={refreshConfig} />
              <SmartDictationSettings config={config} refreshConfig={refreshConfig} />
            </>
          )}
          {tab === 'meetings' && <MeetingSettings config={config} refreshConfig={refreshConfig} />}
          {tab === 'assistant' && assistantOn && (
            <AssistantSettings config={config} refreshConfig={refreshConfig} onTurnedOff={() => onTabChange('general')} />
          )}
          {tab === 'permissions' && (
            <PermissionsSettings
              mic={mic}
              accessibility={accessibility}
              screen={screen}
              needsRestart={needsRestart}
              showScreen={assistantOn}
              onGrantMic={grantMic}
              onGrantAccessibility={grantAccessibility}
              onGrantScreen={grantScreen}
              onRecheck={handleRecheck}
              onRestart={restartApp}
            />
          )}
          {tab === 'data' && (
          <Well className="mb-7">
            <WellHeader>
              <WellTitle>Your data</WellTitle>
            </WellHeader>
            <WellCard>
              <RetentionRow config={config} refreshConfig={refreshConfig} />
              <WellItem>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <span className="text-sm">Clear all transcriptions</span>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Permanently delete your entire transcription history
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setConfirmOpen(true)}
                  >
                    Clear all
                  </Button>
                </div>
              </WellItem>
              <WellItem>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <span className="text-sm">Reset app</span>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Choose what to clear: models, history, snippets and more
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={openResetModal}
                  >
                    Reset…
                  </Button>
                </div>
              </WellItem>
            </WellCard>
          </Well>
          )}

          {tab === 'about' && (
          <Well>
            <WellHeader>
              <WellTitle>About</WellTitle>
            </WellHeader>
            <WellCard>
              <WellItem>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Version</span>
                  <span className="text-sm text-muted-foreground">{appVersion}</span>
                </div>
              </WellItem>
              <UpdateRow />
              <WellItem>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Help &amp; Support</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.tellaflow.openExternal('https://tellaflow.com/contact')}
                  >
                    Contact us
                  </Button>
                </div>
              </WellItem>
              <WellItem>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    <button
                      className="hover:text-foreground underline underline-offset-2 transition-colors"
                      onClick={() => window.tellaflow.openExternal('https://tellaflow.com/privacy')}
                    >
                      Privacy Policy
                    </button>
                    <span className="mx-2">·</span>
                    <button
                      className="hover:text-foreground underline underline-offset-2 transition-colors"
                      onClick={() => window.tellaflow.openExternal('https://tellaflow.com/terms')}
                    >
                      Terms of Service
                    </button>
                  </span>
                </div>
              </WellItem>
            </WellCard>
          </Well>
          )}
        </div>
      </ScrollArea>

      {/* Clear transcriptions confirmation */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Clear all transcriptions?</DialogTitle>
            <DialogDescription>
              This will permanently delete all your transcription history. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={handleConfirmClear}
            >
              Delete all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset app modal */}
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Reset app</DialogTitle>
            <DialogDescription>
              Choose what to reset. All selected data will be permanently deleted and cannot be recovered.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1 py-1">
            {/* Select all */}
            <div className="pb-2 mb-1 border-b border-border">
              <ResetCheckbox
                checked={allSelected}
                indeterminate={someSelected && !allSelected}
                onChange={toggleAll}
                label="Select all"
              />
            </div>

            {resetOptions.map((opt) => (
              <div key={opt.key} className="py-1">
                <ResetCheckbox
                  checked={resetSelections[opt.key]}
                  onChange={(v) => toggleOne(opt.key, v)}
                  label={opt.label}
                  description={opt.description}
                />
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setResetOpen(false)} disabled={resetting}>
              Cancel
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10 disabled:opacity-50"
              onClick={() => setResetConfirmOpen(true)}
              disabled={!someSelected || resetting}
            >
              {resetting ? 'Resetting…' : 'Reset'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset confirmation */}
      <Dialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>Are you sure?</DialogTitle>
            <DialogDescription>
              This will permanently delete the selected data. There is no way to recover it once reset.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setResetConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={handleReset}
            >
              Yes, reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
