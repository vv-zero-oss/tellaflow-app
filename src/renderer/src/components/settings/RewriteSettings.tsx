import { useEffect, useState } from 'react';
import { Well, WellHeader, WellTitle, WellCard, WellItem } from '@/components/ui/well';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ipc, type AppConfig, type HotkeyConfig, type RewriteSettings as Settings, type RewriteStyle } from '@/lib/ipc';
import { HotkeyEditor } from './GeneralSettings';

const DEFAULT_REWRITE_HOTKEY: HotkeyConfig = { names: ['LEFT CTRL', 'LEFT ALT', 'F'], label: '⌃⌥F' };

/** Mirrors src/main/jarvis/rewrite.js REWRITE_STYLES. */
export const REWRITE_STYLES: { id: RewriteStyle; label: string; description: string }[] = [
  { id: 'grammar', label: 'Fix grammar', description: 'Fixes grammar, spelling and punctuation. Keeps your words and tone.' },
  { id: 'formal', label: 'Formal', description: 'Polished and professional, for email and work.' },
  { id: 'casual', label: 'Casual', description: 'Friendly and relaxed, for chats and messages.' },
  { id: 'concise', label: 'Concise', description: 'Shorter and clearer, with every point kept.' },
  { id: 'custom', label: 'Custom', description: 'Your own instructions.' },
];

/**
 * Rewrite text: a shortcut that takes the text you selected (or, with none,
 * the whole field you're typing in), has the assistant's AI rewrite it in the
 * chosen style, and puts it back. Never runs on its own.
 * Runs on the assistant, so it is off while the command key is.
 */
export function RewriteSettings({ config, refreshConfig }: { config: AppConfig; refreshConfig: () => Promise<void> }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    ipc?.rewriteGetSettings?.().then((s) => { setSettings(s); setDraft(s.instructions); }).catch(() => {});
  }, []);

  const update = async (patch: Partial<Settings>) => {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    setSettings(await ipc.rewriteSetSettings(patch));
  };

  const setHotkey = async (hotkey: HotkeyConfig | null) => {
    await ipc.setFeatureSetting('rewriteHotkey', hotkey);
    ipc.retryHotkey();
    await refreshConfig();
  };

  if (!settings) return null;
  const assistantOn = !!config.commandHotkey;
  const shortcut = config.rewriteHotkey ?? null;
  const style = REWRITE_STYLES.find((s) => s.id === settings.style) ?? REWRITE_STYLES[0];

  return (
    <Well className="mb-7">
      <WellHeader>
        <WellTitle>Rewrite text</WellTitle>
      </WellHeader>
      <WellCard>
        <WellItem>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="text-sm">Rewrite shortcut</span>
              <p className="text-xs text-muted-foreground/60 mt-0.5">
                {assistantOn
                  ? 'Select text and press it: the selection is rewritten in this style and put back. With nothing selected, the whole field is. ⌘Z undoes it.'
                  : 'Uses the assistant’s AI. Set a Command key under General to turn it on.'}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {shortcut && (
                <HotkeyEditor
                  currentHotkey={shortcut}
                  defaultHotkey={DEFAULT_REWRITE_HOTKEY}
                  disabled={!assistantOn}
                  onSave={(hk) => void setHotkey(hk)}
                />
              )}
              <Switch
                aria-label="Rewrite shortcut"
                disabled={!assistantOn}
                checked={assistantOn && !!shortcut}
                onCheckedChange={(v) => void setHotkey(v ? DEFAULT_REWRITE_HOTKEY : null)}
              />
            </div>
          </div>
        </WellItem>
        <WellItem>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="text-sm">Style</span>
              <p className="text-xs text-muted-foreground/60 mt-0.5">{style.description}</p>
            </div>
            <Select value={settings.style} onValueChange={(v) => void update({ style: v as RewriteStyle })} disabled={!assistantOn}>
              <SelectTrigger className="w-[180px] h-8 text-sm shrink-0" aria-label="Rewrite style">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REWRITE_STYLES.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </WellItem>
        {settings.style === 'custom' && (
          <WellItem>
            <div className="space-y-2">
              <span className="text-sm">Your instructions</span>
              <textarea
                aria-label="Custom rewrite instructions"
                placeholder="e.g. Make it sound warm but professional, and end with a question."
                value={draft}
                maxLength={500}
                disabled={!assistantOn}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => { if (draft !== settings.instructions) void update({ instructions: draft }); }}
                className="w-full min-h-[72px] rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 resize-y"
              />
            </div>
          </WellItem>
        )}
      </WellCard>
    </Well>
  );
}
