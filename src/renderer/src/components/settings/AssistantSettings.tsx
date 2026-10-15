import { useEffect } from 'react';
import { CheckCircle2, CircleDashed, RefreshCw } from 'lucide-react';
import { Well, WellHeader, WellTitle, WellCard, WellItem } from '@/components/ui/well';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAssistant } from '@/hooks/use-assistant';
import type { AssistantSettings as Settings } from '@/lib/ipc';

/**
 * Assistant settings. No API keys: the assistant uses an AI you're already
 * signed in to on this Mac (Claude Code, Codex or Gemini CLI) or local Ollama.
 */
export function AssistantSettings() {
  const { providers, settings, refreshProviders, updateSettings } = useAssistant();

  useEffect(() => { refreshProviders(); }, [refreshProviders]);

  if (!settings) return null;
  const ollama = providers?.find((p) => p.id === 'ollama');

  return (
    <Well className="mb-7">
      <WellHeader>
        <WellTitle>Assistant</WellTitle>
      </WellHeader>
      <WellCard>
        <WellItem>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="text-sm">AI</span>
              <p className="text-xs text-muted-foreground/60 mt-0.5">Uses an AI you're signed in to on this Mac. No API keys.</p>
            </div>
            <Select value={settings.provider} onValueChange={(v) => updateSettings({ provider: v as Settings['provider'] })}>
              <SelectTrigger className="w-[240px] h-8 text-sm shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Automatic (first available)</SelectItem>
                <SelectItem value="claude">Claude</SelectItem>
                <SelectItem value="codex">ChatGPT (Codex)</SelectItem>
                <SelectItem value="gemini">Gemini</SelectItem>
                <SelectItem value="ollama">Ollama (local)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </WellItem>
        <WellItem>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 space-y-1.5">
              {providers === null ? (
                <p className="text-xs text-muted-foreground">Checking…</p>
              ) : (
                providers.map((p) => (
                  <div key={p.id} className="flex items-start gap-2 text-xs">
                    {p.available ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-px" /> : <CircleDashed className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-px" />}
                    <div className="min-w-0">
                      <span className={p.available ? '' : 'text-muted-foreground'}>{p.label}</span>
                      {!p.available && p.detail && <p className="text-muted-foreground/70">{p.detail}</p>}
                    </div>
                  </div>
                ))
              )}
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="Check again" onClick={refreshProviders}>
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </WellItem>
        {ollama?.available && ollama.models && ollama.models.length > 0 && (
          <WellItem>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm">Ollama model</span>
              <Select value={settings.ollamaModel || ollama.models[0]} onValueChange={(v) => updateSettings({ ollamaModel: v })}>
                <SelectTrigger className="w-[200px] h-8 text-sm shrink-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ollama.models.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </WellItem>
        )}
        <WellItem>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="text-sm">Full access</span>
              <p className="text-xs text-muted-foreground/60 mt-0.5">The assistant runs every action without asking, scripts included. Turn off to approve each change first.</p>
            </div>
            <Switch checked={settings.fullAccess} onCheckedChange={(v) => updateSettings({ fullAccess: v })} />
          </div>
        </WellItem>
      </WellCard>
    </Well>
  );
}
