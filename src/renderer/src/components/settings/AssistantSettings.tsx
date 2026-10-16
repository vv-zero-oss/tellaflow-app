import { useEffect, useState } from 'react';
import { CheckCircle2, CircleDashed, Download, Loader2, RefreshCw } from 'lucide-react';
import { Well, WellHeader, WellTitle, WellCard, WellItem } from '@/components/ui/well';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { AssistantDownload } from '@/components/assistant/AssistantDownload';
import { useAssistant } from '@/hooks/use-assistant';
import { useAssistantRuntime } from '@/hooks/use-assistant-runtime';
import type { AssistantProvider, AssistantRuntimeStatus } from '@/lib/ipc';

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
 * The assistant (the command key), behind a switch. On, it offers one
 * download — bb, the Node it runs on and the desktop helper — and only once
 * that is done shows the rest of its settings.
 */
export function AssistantSettings() {
  const { runtime, setEnabled, install, remove } = useAssistantRuntime();
  if (!runtime) return null;
  const downloaded = runtime.state !== 'missing';
  return (
    <Well className="mb-7" data-testid="assistant-settings">
      <WellHeader>
        <WellTitle>Assistant</WellTitle>
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
                Hold the command key and say what you want. It answers, and can work in your other apps, using an AI you're signed in to.
              </p>
            </div>
            <Switch checked={runtime.enabled} onCheckedChange={setEnabled} data-testid="assistant-enabled" />
          </div>
        </WellItem>
        {runtime.enabled && (!downloaded || runtime.installing || runtime.state === 'outdated' || runtime.error) && (
          <WellItem>
            <AssistantDownload runtime={runtime} onInstall={install} />
          </WellItem>
        )}
        {runtime.enabled && downloaded && !runtime.installing && <AssistantOptions />}
        {runtime.enabled && downloaded && !runtime.installing && <DownloadedRow runtime={runtime} onRemove={remove} />}
      </WellCard>
    </Well>
  );
}

/** What is downloaded, and a way to give the disk space back. */
function DownloadedRow({ runtime, onRemove }: { runtime: AssistantRuntimeStatus; onRemove: () => Promise<void> }) {
  const [removing, setRemoving] = useState(false);
  return (
    <WellItem>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <span className="text-sm">Downloaded</span>
          <p className="text-xs text-muted-foreground/60 mt-0.5">
            bb {runtime.installed?.bb} on Node {runtime.installed?.node?.replace(/^v/, '')}
            {runtime.helperError ? ` · The desktop helper didn’t download: ${runtime.helperError}` : ''}
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
              <span className="text-sm">AI</span>
              <p className="text-xs text-muted-foreground/60 mt-0.5">Uses an AI you're signed in to on this Mac. No API keys.</p>
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
              <span className="text-sm">Run actions without asking</span>
              <p className="text-xs text-muted-foreground/60 mt-0.5">Quitting apps, deleting, and anything in a password manager always ask first.</p>
            </div>
            <Switch checked={settings.fullAccess} onCheckedChange={(v) => updateSettings({ fullAccess: v })} />
          </div>
        </WellItem>
    </>
  );
}
