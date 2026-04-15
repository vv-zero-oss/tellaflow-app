import * as React from 'react';
import { cn } from '@/lib/utils';
import { ChevronUp, Command, Globe, Option, Space } from 'lucide-react';

// ─── Context ─────────────────────────────────────────────────────────────────

const KeyboardContext = React.createContext<{ activeKeys: Set<string> }>({
  activeKeys: new Set(),
});

// ─── MacKey ───────────────────────────────────────────────────────────────────

export interface MacKeyProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: React.ReactNode;
  subLabel?: React.ReactNode;
  icon?: React.ReactNode;
  iconLabel?: string;
  /** Flex-grow value (relative width within row). Default 1. */
  grow?: number;
  /** Browser KeyboardEvent.code string(s) this key maps to */
  keyCode?: string | string[];
}

export function MacKey({
  className,
  label,
  subLabel,
  icon,
  iconLabel,
  grow = 1,
  children,
  keyCode,
  ...props
}: MacKeyProps) {
  const { activeKeys } = React.useContext(KeyboardContext);

  const isActive = React.useMemo(() => {
    if (keyCode) {
      if (Array.isArray(keyCode)) return keyCode.some(c => activeKeys.has(c));
      return activeKeys.has(keyCode);
    }
    if (typeof label === 'string') {
      const l = label.toLowerCase();
      if (/^[0-9]$/.test(l)) return activeKeys.has(`Digit${l}`);
      if (/^[a-z]$/.test(l)) return activeKeys.has(`Key${l.toUpperCase()}`);
      const sym: Record<string, string> = {
        '-': 'Minus', '=': 'Equal', '[': 'BracketLeft', ']': 'BracketRight',
        '\\': 'Backslash', ';': 'Semicolon', "'": 'Quote', ',': 'Comma',
        '.': 'Period', '/': 'Slash', '`': 'Backquote',
        delete: 'Backspace', tab: 'Tab', 'caps lock': 'CapsLock',
        return: 'Enter', space: 'Space',
      };
      if (sym[l]) return activeKeys.has(sym[l]);
    }
    return false;
  }, [activeKeys, keyCode, label]);

  return (
    <div style={{ flexGrow: grow, flexShrink: 1, flexBasis: 0, minWidth: 0 }}>
      <div
        className={cn(
          'relative flex h-full w-full select-none flex-col items-center justify-between',
          'rounded-[6px] p-1.5 text-[10px] font-medium transition-all duration-100',
          // base key appearance
          'bg-white shadow-[0_2px_0_0_#a0a0a0] dark:bg-neutral-700 dark:shadow-[0_2px_0_0_#111]',
          // active = pressed down + blue tint
          isActive
            ? [
                'translate-y-[2px] shadow-none',
                'bg-blue-500/20 text-blue-500 ring-1 ring-inset ring-blue-500/40',
                'dark:bg-blue-500/25 dark:text-blue-300 dark:ring-blue-400/40',
              ]
            : 'text-neutral-600 dark:text-neutral-300',
          className,
        )}
        {...props}
      >
        {/* ── Modifier key: icon on top, label at bottom ── */}
        {icon && label && !subLabel && !children && (
          <>
            <span className={cn('opacity-70', isActive && 'opacity-100')}>{icon}</span>
            <span className="text-[8.5px] leading-none text-center w-full truncate">{label}</span>
          </>
        )}

        {/* ── Icon only (e.g. globe/space, F-keys) ── */}
        {icon && !label && !subLabel && !children && (
          <div className="flex h-full w-full flex-col items-center justify-center gap-0.5">
            <span className={cn('opacity-70', isActive && 'opacity-100')}>{icon}</span>
            {iconLabel && <span className="text-[7px] opacity-50">{iconLabel}</span>}
          </div>
        )}

        {/* ── Number/symbol keys with top sub-label ── */}
        {!icon && subLabel && !children && (
          <>
            <span className="self-start opacity-60 text-[9px]">{subLabel}</span>
            <span className="self-start">{label}</span>
          </>
        )}

        {/* ── Single character ── */}
        {!icon && !subLabel && !children && typeof label === 'string' && label.length === 1 && (
          <span className="mt-auto uppercase">{label}</span>
        )}

        {/* ── Short text label only (fn, esc, etc.) ── */}
        {!icon && !subLabel && !children && typeof label === 'string' && label.length > 1 && (
          <span className="mt-auto text-[9px]">{label}</span>
        )}

        {/* ── ReactNode label only (rare) ── */}
        {!icon && !subLabel && !children && typeof label !== 'string' && label && (
          <span className="mt-auto">{label}</span>
        )}

        {children}
      </div>
    </div>
  );
}

// ─── MacKeyboard ──────────────────────────────────────────────────────────────

interface MacKeyboardProps extends React.HTMLAttributes<HTMLDivElement> {
  soundSrc?: string;
  externalActiveKeys?: Set<string>;
}

export function MacKeyboard({
  className,
  soundSrc = '/audio/key-press.wav',
  externalActiveKeys,
  children,
  ...props
}: MacKeyboardProps) {
  const [activeKeys, setActiveKeys] = React.useState<Set<string>>(new Set());
  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const audioBufferRef = React.useRef<AudioBuffer | null>(null);

  React.useEffect(() => {
    if (!soundSrc) return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    audioCtxRef.current = ctx;
    fetch(soundSrc)
      .then(r => r.arrayBuffer())
      .then(b => ctx.decodeAudioData(b))
      .then(d => { audioBufferRef.current = d; })
      .catch(() => {});
    return () => { ctx.close().catch(() => {}); };
  }, [soundSrc]);

  const playClick = React.useCallback(() => {
    const ctx = audioCtxRef.current;
    const buf = audioBufferRef.current;
    if (!ctx || !buf) return;
    const run = () => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      gain.gain.value = 0.15;
      src.connect(gain);
      gain.connect(ctx.destination);
      src.start(0);
    };
    ctx.state === 'suspended' ? ctx.resume().then(run).catch(() => {}) : run();
  }, []);

  React.useEffect(() => {
    const dn = (e: KeyboardEvent) => {
      if (e.repeat) return;
      setActiveKeys(p => { const s = new Set(p); s.add(e.code); return s; });
      playClick();
    };
    const up = (e: KeyboardEvent) => {
      setActiveKeys(p => { const s = new Set(p); s.delete(e.code); return s; });
    };
    window.addEventListener('keydown', dn);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up); };
  }, [playClick]);

  const ctx = React.useMemo(
    () => ({ activeKeys: externalActiveKeys ?? activeKeys }),
    [externalActiveKeys, activeKeys],
  );

  return (
    <KeyboardContext.Provider value={ctx}>
      <div
        className={cn('rounded-xl bg-neutral-200 p-1.5 dark:bg-neutral-800/80', className)}
        {...props}
      >
        {children && (
          <div className="flex items-stretch gap-[3px] w-full">
            {children}
          </div>
        )}
      </div>
    </KeyboardContext.Provider>
  );
}

// ─── ModifierKeyRow ───────────────────────────────────────────────────────────

/** Isolated bottom-row modifier keys, used in the hotkey picker modal. */
const KEY_H = 'h-11';

/** Isolated bottom-row modifier keys, used in the hotkey picker modal. */
export function ModifierKeyRow({
  externalActiveKeys,
  className,
}: {
  externalActiveKeys?: Set<string>;
  className?: string;
}) {
  return (
    <MacKeyboard soundSrc="" externalActiveKeys={externalActiveKeys} className={cn('w-full', className)}>
      <MacKey label="fn"                                                         keyCode="Fn"          grow={0.75} className={KEY_H} />
      <MacKey icon={<ChevronUp className="w-3 h-3" />} label="control"          keyCode="ControlLeft" grow={1}    className={KEY_H} />
      <MacKey icon={<Option className="w-3 h-3" />}    label="option"           keyCode="AltLeft"     grow={1}    className={KEY_H} />
      <MacKey icon={<Command className="w-3 h-3" />}   label="command"          keyCode="MetaLeft"    grow={1.4}  className={KEY_H} />
      <MacKey icon={<Space className="w-3 h-3" />}    label="space"            keyCode="Space"       grow={1.4}  className={KEY_H} />
      <MacKey icon={<Command className="w-3 h-3" />}   label="command"          keyCode="MetaRight"   grow={1.4}  className={KEY_H} />
      <MacKey icon={<Option className="w-3 h-3" />}    label="option"           keyCode="AltRight"    grow={1}    className={KEY_H} />
    </MacKeyboard>
  );
}
