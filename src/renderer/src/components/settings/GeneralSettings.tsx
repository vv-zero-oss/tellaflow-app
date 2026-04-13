import { useState, useEffect } from 'react';
import { Sun, Moon, Monitor, Pencil, X, Check } from 'lucide-react';
import { Well, WellHeader, WellTitle, WellCard, WellItem } from '@/components/ui/well';
import { cn } from '@/lib/utils';
import { ipc, type AppConfig, type HotkeyConfig, type Theme } from '@/lib/ipc';

interface GeneralSettingsProps {
  config: AppConfig;
  onSetTheme: (theme: Theme) => void;
}

const themeOptions: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

function HotkeyEditor({ currentHotkey }: { currentHotkey: HotkeyConfig | undefined }) {
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<HotkeyConfig | null>(null);
  const [listening, setListening] = useState(false);

  // Start/stop recording session when editing begins/ends
  useEffect(() => {
    if (!editing) return;
    setListening(true);
    ipc.startHotkeyRecording();

    ipc.onHotkeyRecorded((data: HotkeyConfig) => {
      setPending(data);
      setListening(false);
    });
    ipc.onHotkeyRecordingCancelled(() => {
      setListening(false);
    });

    return () => {
      ipc.stopHotkeyRecording();
    };
  }, [editing]);

  const save = () => {
    if (pending) {
      ipc.setHotkey(pending);
      ipc.retryHotkey();
    }
    setEditing(false);
    setPending(null);
    setListening(false);
  };

  const cancel = () => {
    ipc.stopHotkeyRecording();
    setEditing(false);
    setPending(null);
    setListening(false);
  };

  const startEdit = () => {
    setPending(null);
    setEditing(true);
  };

  const displayLabel = pending?.label ?? currentHotkey?.label ?? '—';

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground font-mono">{currentHotkey?.label || '—'}</span>
        <button
          onClick={startEdit}
          className="flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors rounded px-1.5 py-0.5 hover:bg-muted/50"
        >
          <Pencil className="w-3 h-3" />
          Edit
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {/* Key capture zone */}
      <button
        onClick={() => { if (!listening) { ipc.startHotkeyRecording(); setListening(true); } }}
        className={cn(
          'flex items-center justify-center rounded-lg border px-3 py-1 text-sm font-mono min-w-[100px] transition-all',
          listening
            ? 'border-primary/50 bg-primary/[0.07] text-primary animate-pulse cursor-default'
            : 'border-input bg-muted/40 text-foreground hover:bg-muted/60 cursor-pointer',
        )}
      >
        {listening ? (
          <span className="text-xs">press a key…</span>
        ) : (
          <span>{displayLabel}</span>
        )}
      </button>

      {/* Save */}
      <button
        onClick={save}
        disabled={!pending}
        className="p-1.5 rounded-md text-green-500 hover:bg-green-500/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        title="Save"
      >
        <Check className="w-3.5 h-3.5" />
      </button>

      {/* Cancel */}
      <button
        onClick={cancel}
        className="p-1.5 rounded-md text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/50 transition-colors"
        title="Cancel"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function GeneralSettings({
  config,
  onSetTheme,
}: GeneralSettingsProps) {
  const currentTheme = config.theme || 'dark';

  return (
    <Well className="mb-7">
      <WellHeader>
        <WellTitle>General</WellTitle>
      </WellHeader>
      <WellCard>
        <WellItem>
          <div className="flex items-center justify-between">
            <span className="text-sm">Appearance</span>
            <div className="flex items-center gap-1 rounded-full border border-input p-0.5">
              {themeOptions.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => onSetTheme(value)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                    currentTheme === value
                      ? 'bg-secondary text-secondary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </WellItem>

        <WellItem>
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm">Hotkey</span>
              <p className="text-xs text-muted-foreground/60 mt-0.5">Hold to record · supports fn, combos</p>
            </div>
            <HotkeyEditor currentHotkey={config.hotkey} />
          </div>
        </WellItem>

      </WellCard>
    </Well>
  );
}
