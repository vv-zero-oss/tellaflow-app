import { useEffect, useState } from 'react';
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
import { GeneralSettings } from './GeneralSettings';
import { PermissionsSettings } from './PermissionsSettings';
import { SystemSettings } from './SystemSettings';
import { UpdateRow } from './UpdateRow';
import { usePermissions } from '@/hooks/use-permissions';
import type { AppConfig, Theme } from '@/lib/ipc';
import { Check } from 'lucide-react';

interface SettingsPageProps {
  visible: boolean;
  config: AppConfig;
  setTheme: (theme: Theme) => void;
  refreshConfig: () => Promise<void>;
  onClearHistory: () => void;
}

type ResetKey = 'transcripts' | 'whisperModels' | 'snippets' | 'dictionary' | 'grammarModels' | 'permissions';

const RESET_OPTIONS: { key: ResetKey; label: string; description: string }[] = [
  { key: 'transcripts', label: 'Transcripts', description: 'All recorded transcription history' },
  { key: 'whisperModels', label: 'Whisper Models', description: 'All downloaded speech recognition models' },
  { key: 'snippets', label: 'Snippets', description: 'All custom text expansion snippets' },
  { key: 'dictionary', label: 'Dictionary', description: 'All custom word replacements' },
  { key: 'grammarModels', label: 'AI Grammar Models', description: 'All downloaded grammar correction models' },
  { key: 'permissions', label: 'Permissions', description: 'Reset permission grants and onboarding state' },
];

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
  config,
  setTheme,
  refreshConfig,
  onClearHistory,
}: SettingsPageProps) {
  const { mic, accessibility, needsRestart, grantMic, grantAccessibility, retryHotkey, restartApp, startPolling, stopPolling, refresh: refreshPerms } = usePermissions();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetSelections, setResetSelections] = useState<Record<ResetKey, boolean>>({
    transcripts: false,
    whisperModels: false,
    snippets: false,
    dictionary: false,
    grammarModels: false,
    permissions: false,
  });
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

  const allSelected = RESET_OPTIONS.every((o) => resetSelections[o.key]);
  const someSelected = RESET_OPTIONS.some((o) => resetSelections[o.key]);

  const toggleAll = () => {
    const next = !allSelected;
    setResetSelections({
      transcripts: next,
      whisperModels: next,
      snippets: next,
      dictionary: next,
      grammarModels: next,
      permissions: next,
    });
  };

  const toggleOne = (key: ResetKey, value: boolean) => {
    setResetSelections((prev) => ({ ...prev, [key]: value }));
  };

  const openResetModal = () => {
    setResetSelections({
      transcripts: false,
      whisperModels: false,
      snippets: false,
      dictionary: false,
      grammarModels: false,
      permissions: false,
    });
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
      if (resetSelections.grammarModels) {
        const grammarModels = await window.tellaflow.getGrammarModelsStatus();
        for (const [key, info] of Object.entries(grammarModels)) {
          if (info.status === 'downloaded') {
            window.tellaflow.deleteGrammarModel(key);
          }
        }
      }
      if (resetSelections.permissions) {
        await window.tellaflow.resetPermissions();
      }
      window.dispatchEvent(new CustomEvent('tellaflow:data-reset', {
        detail: { ...resetSelections },
      }));
    } finally {
      setResetting(false);
      setResetOpen(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="px-7 pt-12 pb-4 [-webkit-app-region:drag]">
        <h2 className="text-xl font-bold tracking-tight">Settings</h2>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-7 py-6">
        <PermissionsSettings
            mic={mic}
            accessibility={accessibility}
            needsRestart={needsRestart}
            onGrantMic={grantMic}
            onGrantAccessibility={grantAccessibility}
            onRecheck={handleRecheck}
            onRestart={restartApp}
          />
           <GeneralSettings
            config={config}
            onSetTheme={setTheme}
            refreshConfig={refreshConfig}
          />
          <SystemSettings
            config={config}
            refreshConfig={refreshConfig}
          />

          <Well className="mb-7">
            <WellHeader>
              <WellTitle>Data</WellTitle>
            </WellHeader>
            <WellCard>
              <WellItem>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm">Clear all transcriptions</span>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Permanently delete your entire transcription history
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setConfirmOpen(true)}
                  >
                    Clear all
                  </Button>
                </div>
              </WellItem>
              <WellItem>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm">Reset app</span>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Selectively clear models, history, snippets and more
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={openResetModal}
                  >
                    Reset…
                  </Button>
                </div>
              </WellItem>
            </WellCard>
          </Well>

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

            {RESET_OPTIONS.map((opt) => (
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
