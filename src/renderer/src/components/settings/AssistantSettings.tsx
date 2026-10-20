import { useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, CircleDashed, Download, Loader2, RefreshCw, Zap } from 'lucide-react';
import { Well, WellHeader, WellTitle, WellCard, WellItem } from '@/components/ui/well';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { AssistantDownload } from '@/components/assistant/AssistantDownload';
import { useAssistant } from '@/hooks/use-assistant';
import { useAssistantRuntime } from '@/hooks/use-assistant-runtime';
import { ipc, type AppConfig, type AssistantProvider, type AssistantQuickCommand, type AssistantRuntimeStatus } from '@/lib/ipc';
import { HotkeyEditor } from './GeneralSettings';

/** What a provider's state means to the person, in their words. */
function providerLine(p: AssistantProvider): string {
  switch (p.status) {
    case 'ready': return p.accountEmail ? `Signed in as ${p.accountEmail}` : 'Signed in';
    case 'unauthenticated':
    case 'expired': return p.loginCommand ? `Not signed in — run \`${p.loginCommand}\` once in Terminal` : 'Not signed in';
    case 'not_installed': return 'Not installed on this Mac';
    case 'unsupported_version': return 'Needs an update';
    default: return 'Checking…';
  }
}

/**
 * The switch for the assistant, in Settings › General. It is a beta: off, the
 * rest of the app shows nothing of it — no Assistant page, no Assistant tab
 * in Settings, no command key, nothing downloaded.
 */
export function BetaFeatures({ onOpenAssistant }: { onOpenAssistant: () => void }) {
  const { runtime, setEnabled, remove } = useAssistantRuntime();
  const [removing, setRemoving] = useState(false);
  if (!runtime) return null;
  // Off, but its download is still on disk (it was on once): say so, and
  // offer the space back.
  const leftover = !runtime.enabled && runtime.state !== 'missing' && !runtime.installing;
  return (
    <Well className="mb-7" data-testid="beta-features">
      <WellHeader>
        <WellTitle>Beta features</WellTitle>
      </WellHeader>
      <WellCard>
        <WellItem>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="text-sm flex items-center gap-2">
                AI assistant
                <Badge variant="outline" className="text-[10px] font-normal px-1.5 py-0">Beta</Badge>
              </span>
              <p className="text-xs text-muted-foreground/60 mt-0.5">
                Hold a second key and say what you want — it answers, and can work in your other apps, using an AI you're already signed in to. Needs a one-time download (about 110 MB).
              </p>
            </div>
            <Switch
              checked={runtime.enabled}
              disabled={runtime.installing}
              onCheckedChange={async (v) => { await setEnabled(v); if (v) onOpenAssistant(); }}
              data-testid="assistant-enabled"
            />
          </div>
        </WellItem>
        {runtime.enabled && (
          <WellItem>
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs text-muted-foreground min-w-0">
                {runtime.ready ? 'Its settings are in the Assistant tab.' : 'Download it and choose its settings in the Assistant tab.'}
              </p>
              <Button variant="outline" size="sm" className="shrink-0" onClick={onOpenAssistant}>
                Open Assistant settings
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </WellItem>
        )}
        {leftover && (
          <WellItem>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <span className="text-sm">Assistant download</span>
                <p className="text-xs text-muted-foreground/60 mt-0.5">Still on this Mac (bb and its Node, about 380 MB). Remove it to free the space; turning the assistant on again downloads it again.</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                disabled={removing}
                onClick={async () => { setRemoving(true); try { await remove(); } finally { setRemoving(false); } }}
              >
                {removing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Remove
              </Button>
            </div>
          </WellItem>
        )}
      </WellCard>
    </Well>
  );
}

/**
 * Settings › Assistant (the tab exists only while the assistant is on): the
 * download until there is one, then its settings, the command key, and a way
 * to remove it or turn it off.
 */
export function AssistantSettings({ config, refreshConfig, onTurnedOff }: {
  config: AppConfig;
  refreshConfig: () => Promise<void>;
  onTurnedOff: () => void;
}) {
  const { runtime, setEnabled, install, remove } = useAssistantRuntime();
  if (!runtime) return null;
  const downloaded = runtime.state !== 'missing';
  const needsDownload = !downloaded || runtime.installing || runtime.state === 'outdated' || !!runtime.error;
  return (
    <div data-testid="assistant-settings">
      {needsDownload && (
        <Well className="mb-7">
          <WellHeader>
            <WellTitle>{runtime.state === 'outdated' ? 'Update' : 'Set up'}</WellTitle>
          </WellHeader>
          <WellCard>
            <WellItem>
              <AssistantDownload runtime={runtime} onInstall={install} />
            </WellItem>
          </WellCard>
        </Well>
      )}
      {downloaded && !runtime.installing && (
        <Well className="mb-7">
          <WellHeader>
            <WellTitle>Assistant</WellTitle>
          </WellHeader>
          <WellCard>
            <WellItem>
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <span className="text-sm">Command key</span>
                  <p className="text-xs text-muted-foreground/60 mt-0.5">Hold it anywhere and say what you want; the answer appears on the island.</p>
                </div>
                <HotkeyEditor
                  currentHotkey={config.commandHotkey ?? { names: ['RIGHT ALT'], label: 'Right ⌥' }}
                  taken={{ hotkey: config.hotkey, label: 'dictation shortcut' }}
                  onSave={async (hotkey) => {
                    await ipc.setFeatureSetting('commandHotkey', hotkey);
                    ipc.retryHotkey();
                    await refreshConfig();
                  }}
                />
              </div>
            </WellItem>
            <AssistantOptions />
          </WellCard>
        </Well>
      )}
      <Well className="mb-7">
        <WellHeader>
          <WellTitle>Manage</WellTitle>
        </WellHeader>
        <WellCard>
          {downloaded && !runtime.installing && <DownloadedRow runtime={runtime} onRemove={remove} />}
          <WellItem>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <span className="text-sm">Turn off the assistant</span>
                <p className="text-xs text-muted-foreground/60 mt-0.5">Hides the Assistant page and this tab, and frees the command key. Turn it back on in General › Beta features.</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={runtime.installing}
                onClick={async () => { await setEnabled(false); onTurnedOff(); }}
                data-testid="assistant-turn-off"
              >
                Turn off
              </Button>
            </div>
          </WellItem>
        </WellCard>
      </Well>
    </div>
  );
}

/** What is downloaded, and a way to give the disk space back. */
function DownloadedRow({ runtime, onRemove }: { runtime: AssistantRuntimeStatus; onRemove: () => Promise<void> }) {
  const [removing, setRemoving] = useState(false);
  return (
    <WellItem>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <span className="text-sm">Download</span>
          <p className="text-xs text-muted-foreground/60 mt-0.5">
            bb {runtime.installed?.bb} on Node {runtime.installed?.node?.replace(/^v/, '')}, about 380 MB. Remove it to free the space; you can download it again here.
            {runtime.helperError ? ` The desktop helper didn’t download: ${runtime.helperError}` : ''}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
          disabled={removing}
          onClick={async () => { setRemoving(true); try { await onRemove(); } finally { setRemoving(false); } }}
        >
          {removing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Remove
        </Button>
      </div>
    </WellItem>
  );
}

/** The assistant's own settings, once it can run. */
function AssistantOptions() {
  const {
    settings, providers, backend, desktop, installing, installError,
    refreshProviders, refreshDesktop, updateSettings, installHelper, requestAccessibility,
  } = useAssistant();

  useEffect(() => { refreshProviders(); refreshDesktop(); }, [refreshProviders, refreshDesktop]);
  const [commands, setCommands] = useState<AssistantQuickCommand[]>([]);
  const [showCommands, setShowCommands] = useState(false);
  useEffect(() => { ipc?.assistantQuickCommands?.().then(setCommands).catch(() => {}); }, []);

  if (!settings) return null;
  const usable = (providers ?? []).filter((p) => p.status !== 'not_installed');
  const chosen = settings.provider === 'auto'
    ? (providers ?? []).find((p) => p.status === 'ready')
    : (providers ?? []).find((p) => p.id === settings.provider);
  const helper = desktop?.helper;
  const status = desktop?.status;
  const helperMissing = !!helper && !helper.ok && !/macOS/i.test(helper.error ?? '');
  const unsupported = !!helper && !helper.ok && /macOS/i.test(helper.error ?? '');
  const pct = installing?.total ? Math.round((installing.received / installing.total) * 100) : null;

  return (
    <>
        <WellItem>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="text-sm">Which AI</span>
              <p className="text-xs text-muted-foreground/60 mt-0.5">One you're already signed in to on this Mac, like Claude Code or Codex. No API keys.</p>
            </div>
            <Select value={settings.provider} onValueChange={(v) => updateSettings({ provider: v })}>
              <SelectTrigger className="w-[240px] h-8 text-sm shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Automatic</SelectItem>
                {usable.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
                {settings.provider !== 'auto' && !usable.some((p) => p.id === settings.provider) && (
                  <SelectItem value={settings.provider}>{settings.provider}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        </WellItem>
        <WellItem>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 space-y-1.5 text-xs">
              {backend?.state === 'error' ? (
                <p className="text-destructive">The assistant couldn't start: {backend.error}</p>
              ) : providers === null ? (
                <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" />Starting the assistant…</p>
              ) : chosen ? (
                <div className="flex items-start gap-2">
                  {chosen.status === 'ready'
                    ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-px" />
                    : <CircleDashed className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-px" />}
                  <div className="min-w-0">
                    <span>{chosen.label}</span>
                    <p className="text-muted-foreground/70">{providerLine(chosen)}</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <CircleDashed className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-px" />
                  <p className="text-muted-foreground">
                    No AI is signed in. Install Claude Code or Codex, then run it once in Terminal to sign in.
                  </p>
                </div>
              )}
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="Check again" onClick={() => { refreshProviders(); refreshDesktop(); }}>
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </WellItem>
        <WellItem>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="text-sm">Work in other apps</span>
              <p className="text-xs text-muted-foreground/60 mt-0.5">
                {unsupported
                  ? 'Needs macOS 15 or later.'
                  : 'Clicks, types and opens things for you, one step at a time, and checks each step on screen.'}
              </p>
            </div>
            <Switch disabled={unsupported} checked={settings.desktopActions && !unsupported} onCheckedChange={(v) => updateSettings({ desktopActions: v })} />
          </div>
        </WellItem>
        {settings.desktopActions && !unsupported && (helperMissing || (status && status.supported && !status.accessibility)) && (
          <WellItem>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 text-xs">
                {helperMissing ? (
                  <>
                    <span className="text-sm">Desktop helper</span>
                    <p className="text-muted-foreground/60 mt-0.5">
                      {installError ?? (installing ? `Downloading${pct !== null ? ` — ${pct}%` : '…'}` : 'A small download (Peekaboo) that lets the assistant see and use your apps.')}
                    </p>
                  </>
                ) : (
                  <>
                    <span className="text-sm">Accessibility</span>
                    <p className="text-muted-foreground/60 mt-0.5">Needed to click and type in your other apps.</p>
                  </>
                )}
              </div>
              {helperMissing ? (
                <Button variant="outline" size="sm" disabled={!!installing} onClick={installHelper}>
                  {installing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  Install
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={requestAccessibility}>Allow</Button>
              )}
            </div>
          </WellItem>
        )}
        <WellItem>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="text-sm">See your screen</span>
              <p className="text-xs text-muted-foreground/60 mt-0.5">Sends a picture of your screen with each request, so it can answer about what you're looking at.</p>
            </div>
            <Switch checked={settings.screenVision} onCheckedChange={(v) => updateSettings({ screenVision: v })} />
          </div>
        </WellItem>
        <WellItem>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="text-sm">Instant commands</span>
              <p className="text-xs text-muted-foreground/60 mt-0.5">
                Simple requests run the moment you let go of the key — no AI, no waiting.{' '}
                {commands.length > 0 && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowCommands((v) => !v)}
                    aria-expanded={showCommands}
                  >
                    {showCommands ? 'Hide list' : 'What can I say?'}
                    <ChevronDown className={`w-3 h-3 transition-transform ${showCommands ? 'rotate-180' : ''}`} />
                  </button>
                )}
              </p>
            </div>
            <Switch checked={settings.instantCommands} onCheckedChange={(v) => updateSettings({ instantCommands: v })} />
          </div>
          {showCommands && (
            <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2" data-quick-commands="">
              {commands.map((c) => (
                <li key={c.say} className="flex min-w-0 items-start gap-2">
                  <Zap className="w-3 h-3 mt-0.5 shrink-0 text-muted-foreground/60" />
                  <div className="min-w-0">
                    <span className="text-foreground">“{c.say}”</span>
                    <p className="text-muted-foreground/70">{c.does}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </WellItem>
        <WellItem>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="text-sm">Run actions without asking</span>
              <p className="text-xs text-muted-foreground/60 mt-0.5">Quitting apps, deleting, and anything in a password manager always ask first.</p>
            </div>
            <Switch checked={settings.fullAccess} onCheckedChange={(v) => updateSettings({ fullAccess: v })} />
          </div>
        </WellItem>
    </>
  );
}
