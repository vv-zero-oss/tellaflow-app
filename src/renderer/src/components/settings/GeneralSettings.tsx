import { useState, useEffect, useRef, useCallback } from 'react';
import { Sun, Moon, Monitor, Pencil, RotateCcw, Check, X, Minus, Plus } from 'lucide-react';
import { Well, WellHeader, WellTitle, WellCard, WellItem } from '@/components/ui/well';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ModifierKeyRow } from '@/components/ui/mac-keyboard';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { ipc, type AppConfig, type HotkeyConfig, type Theme } from '@/lib/ipc';
import { MicrophoneSelectDialog } from './MicrophoneSelectDialog';

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_HOTKEY: HotkeyConfig = {
  names: ['FN'],
  label: 'fn',
};

const KEYSPY_TO_BROWSER_CODE: Record<string, string> = {
  'LEFT ALT':    'AltLeft',
  'RIGHT ALT':   'AltRight',
  'LEFT META':   'MetaLeft',
  'RIGHT META':  'MetaRight',
  'LEFT CTRL':   'ControlLeft',
  'RIGHT CTRL':  'ControlRight',
  'LEFT SHIFT':  'ShiftLeft',
  'RIGHT SHIFT': 'ShiftRight',
  'FN':          'Fn',
  'SPACE':       'Space',
  'RETURN':      'Enter',
  'ESCAPE':      'Escape',
  'BACKSPACE':   'Backspace',
  'TAB':         'Tab',
};

function namesToCodes(names: string[]): Set<string> {
  const out = new Set<string>();
  for (const n of names) {
    const code = KEYSPY_TO_BROWSER_CODE[n];
    if (code) out.add(code);
    else if (n.length === 1) out.add(`Key${n.toUpperCase()}`);
  }
  return out;
}

// ─── Theme options ────────────────────────────────────────────────────────────

const themeOptions: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light',  label: 'Light',  icon: Sun },
  { value: 'dark',   label: 'Dark',   icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

// ─── Hotkey dialog ────────────────────────────────────────────────────────────

function HotkeyDialog({
  open,
  currentHotkey,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  currentHotkey: HotkeyConfig | undefined;
  onOpenChange: (v: boolean) => void;
  onSave: (hotkey: HotkeyConfig) => void;
}) {
  const [listening, setListening] = useState(false);
  const [captured, setCaptured] = useState<HotkeyConfig | null>(null);
  const [highlightCodes, setHighlightCodes] = useState<Set<string>>(new Set());
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearFlash = () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
  };

  const flashCodes = useCallback((codes: Set<string>) => {
    setHighlightCodes(codes);
    clearFlash();
    flashTimer.current = setTimeout(() => setHighlightCodes(new Set()), 1400);
  }, []);

  // Re-usable: start a fresh recording session AND register a fresh listener
  const startRecording = useCallback(() => {
    setListening(true);
    // Re-register both listeners every time so `once` always has a live callback
    ipc.onHotkeyRecorded((data: HotkeyConfig) => {
      setCaptured(data);
      setListening(false);
      flashCodes(namesToCodes(data.names));
    });
    ipc.onHotkeyRecordingCancelled(() => {
      setListening(false);
    });
    ipc.startHotkeyRecording();
  }, [flashCodes]);

  // Open → reset everything and start listening immediately
  useEffect(() => {
    if (!open) return;
    setCaptured(null);
    setHighlightCodes(new Set());
    startRecording();
    return () => {
      clearFlash();
      ipc.stopHotkeyRecording();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleReset = () => {
    ipc.stopHotkeyRecording();
    setListening(false);
    setCaptured(DEFAULT_HOTKEY);
    flashCodes(namesToCodes(DEFAULT_HOTKEY.names));
  };

  const handleChange = () => {
    setCaptured(null);
    setHighlightCodes(new Set());
    startRecording();
  };

  const handleSave = () => {
    const hotkey = captured ?? currentHotkey ?? DEFAULT_HOTKEY;
    onSave(hotkey);
    onOpenChange(false);
  };

  const handleCancel = () => {
    ipc.stopHotkeyRecording();
    onOpenChange(false);
  };

  const displayLabel = captured?.label ?? currentHotkey?.label ?? DEFAULT_HOTKEY.label;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[420px] max-w-[calc(100vw-32px)] p-5" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Change Hotkey</DialogTitle>
        </DialogHeader>

        {/* Keyboard + status */}
        <div className="flex flex-col gap-3 py-1">

          <p className='text-sm text-muted-foreground'>Press a Key for making it a shortcut</p>
          <ModifierKeyRow externalActiveKeys={highlightCodes} />

          {/* Status strip */}
          <div className="w-ful flex-col gap-2 flex  justify-center">
            {listening ? (
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                </span>
                Press a Key for making it a shortcut
              </span>
            ) : (
              <div className="flex items-center gap-2.5">
              Active Key:  <kbd className={cn(
                  'inline-flex items-center rounded-md border px-3 py-1 text-sm font-mono font-semibold',
                  captured
                    ? 'border-blue-500/40 bg-blue-500/10 text-blue-500 dark:text-blue-300'
                    : 'border-input bg-muted/40 text-foreground',
                )}>
                
                  {displayLabel}
                  
                </kbd>
               
              </div>
            )}
             
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-1 border-t border-border/40">
          {/* Left side */}
          <div className="flex items-center gap-1">
            <button
              onClick={handleReset}
              title="Reset to fn"
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              Reset
            </button>
           
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleCancel}
              className="flex items-center gap-1 rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <X className="w-3 h-3" />
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Check className="w-3 h-3" />
              Save
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Inline hotkey display ────────────────────────────────────────────────────

/** Two shortcuts made of the same keys (in any order). */
export function sameHotkey(a: HotkeyConfig | null | undefined, b: HotkeyConfig | null | undefined) {
  if (!a?.names?.length || !b?.names?.length) return false;
  return [...a.names].sort().join('+') === [...b.names].sort().join('+');
}

export function HotkeyEditor({
  currentHotkey,
  onSave,
  taken,
}: {
  currentHotkey: HotkeyConfig | undefined;
  onSave?: (hotkey: HotkeyConfig) => void;
  /** Another shortcut this one must not equal — the dictation key and the
   *  command key share one listener, and the dictation key wins a tie. */
  taken?: { hotkey: HotkeyConfig | null | undefined; label: string };
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = (hotkey: HotkeyConfig) => {
    if (taken && sameHotkey(hotkey, taken.hotkey)) {
      setError(`${hotkey.label} is already the ${taken.label} — pick another key.`);
      return;
    }
    setError(null);
    if (onSave) { onSave(hotkey); return; }
    ipc.setHotkey(hotkey);
    ipc.retryHotkey();
  };

  return (
    <>
      <div className="flex flex-col items-end gap-1">
      {error && <p className="text-xs text-destructive max-w-[260px] text-right">{error}</p>}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground font-mono">
          {currentHotkey?.label || DEFAULT_HOTKEY.label}
        </span>
        <button
          onClick={() => setDialogOpen(true)}
          className="flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors rounded px-1.5 py-0.5 hover:bg-muted/50"
        >
          <Pencil className="w-3 h-3" />
          Edit
        </button>
      </div>
      </div>
      <HotkeyDialog
        open={dialogOpen}
        currentHotkey={currentHotkey}
        onOpenChange={setDialogOpen}
        onSave={handleSave}
      />
    </>
  );
}

// ─── Microphone label ─────────────────────────────────────────────────────────

function useMicLabel(deviceId: string | undefined) {
  const [label, setLabel] = useState('Auto-detect');

  const resolve = useCallback(async () => {
    const id = deviceId || 'auto';
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = allDevices.filter((d) => d.kind === 'audioinput');

      if (id === 'auto') {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const track = stream.getAudioTracks()[0];
          const micName = track.label || 'System default';
          track.stop();
          setLabel(`Auto-detect (${micName})`);
        } catch {
          setLabel('Auto-detect');
        }
      } else {
        const match = audioInputs.find((d) => d.deviceId === id);
        setLabel(match?.label || 'Unknown device');
      }
    } catch {
      setLabel(id === 'auto' ? 'Auto-detect' : 'Unknown device');
    }
  }, [deviceId]);

  useEffect(() => { resolve(); }, [resolve]);

  return label;
}

// ─── General: appearance and how the app runs ────────────────────────────────

interface GeneralSettingsProps {
  config: AppConfig;
  onSetTheme: (theme: Theme) => void;
  refreshConfig: () => Promise<void>;
}

function SwitchRow({ label, description, checked, onCheckedChange }: { label: string; description?: string; checked: boolean; onCheckedChange: (v: boolean) => void }) {
  return (
    <WellItem>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <span className="text-sm">{label}</span>
          {description && <p className="text-xs text-muted-foreground/60 mt-0.5">{description}</p>}
        </div>
        <Switch checked={checked} onCheckedChange={onCheckedChange} />
      </div>
    </WellItem>
  );
}

export function GeneralSettings({ config, onSetTheme, refreshConfig }: GeneralSettingsProps) {
  const currentTheme = config.theme || 'dark';
  const run = (fn: () => unknown) => async () => { await fn(); await refreshConfig(); };
  return (
    <>
      <Well className="mb-7">
        <WellHeader>
          <WellTitle>App</WellTitle>
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
          <SwitchRow
            label="Open at login"
            description="Start Tellaflow when you log in to your Mac, so the shortcut always works."
            checked={config.launchAtLogin ?? false}
            onCheckedChange={(v) => run(() => ipc.setLaunchAtLogin(v))()}
          />
          <SwitchRow
            label="Show in the Dock"
            description="Off, Tellaflow lives only in the menu bar."
            checked={config.showInDock ?? true}
            onCheckedChange={(v) => run(() => ipc.setShowInDock(v))()}
          />
        </WellCard>
      </Well>

      <Well className="mb-7">
        <WellHeader>
          <WellTitle>Sound</WellTitle>
        </WellHeader>
        <WellCard>
          <SwitchRow
            label="Play sounds"
            description="A short sound when dictation starts and stops."
            checked={config.soundsEnabled ?? true}
            onCheckedChange={(v) => run(() => ipc.setSoundsEnabled(v))()}
          />
          <SwitchRow
            label="Pause music while dictating"
            description="Pauses Apple Music and Spotify while you speak, and resumes after."
            checked={config.muteWhileDictating ?? false}
            onCheckedChange={(v) => run(() => ipc.setMuteWhileDictating(v))()}
          />
        </WellCard>
      </Well>
    </>
  );
}

// ─── Dictation: the shortcut, the microphone ─────────────────────────────────

const DEFAULT_ACTIVATION_DELAY = 0;
const MIN_DELAY = 0;
const MAX_DELAY = 2000;
const DELAY_STEP = 100;

export function DictationSettings({ config, refreshConfig, commandHotkey }: {
  config: AppConfig;
  refreshConfig: () => Promise<void>;
  /** The assistant's key while the assistant is on: the shortcut can't be it. */
  commandHotkey: HotkeyConfig | null;
}) {
  const [micDialogOpen, setMicDialogOpen] = useState(false);
  const micLabel = useMicLabel(config.microphoneDeviceId);
  const activationDelay = config.hotkeyActivationDelay ?? DEFAULT_ACTIVATION_DELAY;
  const setDelay = (ms: number) => { ipc.setHotkeyActivationDelay(ms); refreshConfig(); };

  return (
    <>
    <Well className="mb-7">
      <WellHeader>
        <WellTitle>Dictation</WellTitle>
      </WellHeader>
      <WellCard>
        <WellItem>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="text-sm">Dictation shortcut</span>
              <p className="text-xs text-muted-foreground/60 mt-0.5">Hold to dictate and release to type it. Press twice to keep dictating hands-free.</p>
            </div>
            <HotkeyEditor
              currentHotkey={config.hotkey}
              taken={commandHotkey ? { hotkey: commandHotkey, label: 'assistant’s command key' } : undefined}
              onSave={async (hotkey) => { await ipc.setHotkey(hotkey); ipc.retryHotkey(); await refreshConfig(); }}
            />
          </div>
        </WellItem>

        <WellItem>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="text-sm">Hold delay</span>
              <p className="text-xs text-muted-foreground/60 mt-0.5">
                How long to hold the shortcut before recording starts. Raise it if you start dictating by accident.
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
            {activationDelay !== DEFAULT_ACTIVATION_DELAY && (
                <button
                  onClick={() => setDelay(DEFAULT_ACTIVATION_DELAY)}
                  title="Reset to no delay"
                  className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors ml-1"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              )}
              <button
                onClick={() => setDelay(Math.max(MIN_DELAY, activationDelay - DELAY_STEP))}
                disabled={activationDelay <= MIN_DELAY}
                title="Shorter"
                className="flex items-center justify-center w-7 h-7 rounded-md border border-input text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-30 disabled:pointer-events-none"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="text-sm font-mono w-14 text-center tabular-nums">
                {activationDelay === 0 ? 'None' : activationDelay >= 1000 ? `${(activationDelay / 1000).toFixed(1)}s` : `${activationDelay}ms`}
              </span>
              <button
                onClick={() => setDelay(Math.min(MAX_DELAY, activationDelay + DELAY_STEP))}
                disabled={activationDelay >= MAX_DELAY}
                title="Longer"
                className="flex items-center justify-center w-7 h-7 rounded-md border border-input text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-30 disabled:pointer-events-none"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </WellItem>

        <WellItem>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="text-sm">Microphone</span>
              <p className="text-xs text-muted-foreground/60 mt-0.5 truncate">{micLabel}</p>
            </div>
            <Button variant="outline" size="sm" className="shrink-0" onClick={() => setMicDialogOpen(true)}>
              Change
            </Button>
          </div>
        </WellItem>
      </WellCard>
    </Well>

    <MicrophoneSelectDialog
      open={micDialogOpen}
      onOpenChange={setMicDialogOpen}
      currentDeviceId={config.microphoneDeviceId || 'auto'}
      onSelect={(deviceId) => ipc.setMicrophoneDeviceId(deviceId)}
    />
  </>
  );
}
