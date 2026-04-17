import { useEffect, useRef, useState, useCallback } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X, Check } from 'lucide-react';
import { ipc } from '@/lib/ipc';
import { LiveWaveform } from '@/components/ui/live-waveform';

type ToastState = 'idle' | 'floating-idle' | 'recording' | 'click-recording' | 'transcribing';

// ─── Per-transition spring bounce values (SmoothUI Dynamic Island pattern) ───
const BOUNCE_VARIANTS: Record<string, number> = {
  'floating-idle':                      0.5,
  'floating-idle_click-recording':      0.38,
  'click-recording_floating-idle':      0.42,
  'floating-idle_recording':            0.45,
  'recording_floating-idle':            0.40,
  'recording_transcribing':             0.20,
  'transcribing_floating-idle':         0.35,
  'click-recording_transcribing':       0.20,
};
const DEFAULT_BOUNCE = 0.5;

function getBounce(variantKey: string): number {
  return BOUNCE_VARIANTS[variantKey] ?? DEFAULT_BOUNCE;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function ToastApp() {
  const [state, setState] = useState<ToastState>('idle');
  const [hotkeyLabel, setHotkeyLabel] = useState('');
  const [isHovered, setIsHovered] = useState(false);
  const [variantKey, setVariantKey] = useState('idle');
  const audioLevelRef = useRef(0);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    const cleanups = [
      ipc.onToastState((s) => {
        setState((prev) => {
          const next = s as ToastState;
          if (prev !== next) {
            setVariantKey(`${prev}_${next}`);
          }
          return next;
        });
      }),
      ipc.onAudioLevel((level) => {
        audioLevelRef.current = level;
      }),
      ipc.onToastHotkey((label) => {
        setHotkeyLabel(label);
      }),
    ];
    return () => cleanups.forEach(fn => fn?.());
  }, []);

  const handleClick = useCallback(() => {
    if (state === 'floating-idle') {
      ipc.clickStartRecording();
    }
  }, [state]);

  const handleCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    ipc.clickCancelRecording();
  }, []);

  const handleFinish = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    ipc.clickFinishRecording();
  }, []);

  const isInteractive = state === 'floating-idle' || state === 'click-recording';
  const bounce = getBounce(variantKey);

  // Fire as soon as the mouse enters the bar — at this point the other app
  // is still the frontmost, so the main process can record its name before
  // the click activates Electron and steals focus.
  const handleHoverStart = useCallback(() => {
    setIsHovered(true);
    if (state === 'floating-idle') {
      ipc.recordFrontmostApp();
    }
  }, [state]);

  // Content transition props — respect reduced motion
  const contentTransition = shouldReduceMotion
    ? { duration: 0 }
    : { duration: 0.18, ease: 'easeOut' };

  const contentInitial = shouldReduceMotion
    ? { opacity: 0 }
    : { opacity: 0, filter: 'blur(4px)', scale: 0.92 };

  const contentAnimate = shouldReduceMotion
    ? { opacity: 1 }
    : { opacity: 1, filter: 'blur(0px)', scale: 1 };

  const contentExit = shouldReduceMotion
    ? { opacity: 0 }
    : { opacity: 0, filter: 'blur(4px)', scale: 0.92 };

  if (state === 'idle') return null;

  // Show the pill whenever hovered (floating-idle) or in an active state
  const showPill = isHovered || state !== 'floating-idle';

  return (
    /*
     * Outer container fills the entire window (280×68).
     * Mouse-leave on this wrapper collapses the pill back in floating-idle.
     * Layout (bottom to top):
     *   8px  — trigger strip  (floating-idle only, always visible)
     *   8px  — gap
     *   32px — pill           (fades in/out, NEVER changes size)
     *   20px — transparent buffer at top
     */
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
      onMouseLeave={state === 'floating-idle' ? () => setIsHovered(false) : undefined}
    >

      {/* ── DIV 2: The pill — opacity-only transition, fixed 32px height ── */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
        <AnimatePresence mode="wait" initial={false}>
          {showPill && (
            <motion.div
              key={state === 'floating-idle' ? 'hint' : state}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.16, ease: 'easeOut' }}
              style={{
                height: 32,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                paddingLeft: 12,
                paddingRight: 12,
                borderRadius: 999,
                cursor: isInteractive ? 'pointer' : 'default',
                background: state === 'floating-idle' ? 'rgba(0,0,0,0.60)' : 'rgba(0,0,0,0.92)',
                border: state === 'floating-idle'
                  ? '1px solid rgba(255,255,255,0.12)'
                  : '1px solid rgba(255,255,255,0.06)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
              } as React.CSSProperties}
              onClick={handleClick}
            >

              {/* Floating idle hint */}
              {state === 'floating-idle' && (
                <span style={{ fontSize: 10, fontWeight: 500, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.01em' }}>
                  Click or hold{hotkeyLabel ? ` ${hotkeyLabel}` : ''} to dictate
                </span>
              )}

              {/* Hotkey recording */}
              {state === 'recording' && (
                <LiveWaveform
                  externalAudioLevel={audioLevelRef}
                  mode="static"
                  barColor="rgba(220,214,255,0.92)"
                  height={20}
                  barWidth={3}
                  barGap={1.5}
                  barRadius={2}
                  barHeight={3}
                  fadeEdges={true}
                  fadeWidth={12}
                  updateRate={40}
                  className="w-[120px]"
                />
              )}

              {/* Click recording */}
              {state === 'click-recording' && (
                <>
                  <motion.button
                    onClick={handleCancel}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.92 }}
                    className="w-6 h-6 rounded-full flex items-center justify-center bg-white/10 hover:bg-red-500/60 transition-colors shrink-0"
                    aria-label="Cancel recording"
                  >
                    <X className="w-3 h-3 text-white" strokeWidth={2.5} />
                  </motion.button>

                  <LiveWaveform
                    externalAudioLevel={audioLevelRef}
                    mode="static"
                    barColor="rgba(220,214,255,0.92)"
                    height={20}
                    barWidth={3}
                    barGap={1.5}
                    barRadius={2}
                    barHeight={3}
                    fadeEdges={true}
                    fadeWidth={12}
                    updateRate={40}
                    className="w-[100px]"
                  />

                  <motion.button
                    onClick={handleFinish}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.92 }}
                    className="w-6 h-6 rounded-full flex items-center justify-center bg-violet-500/70 hover:bg-violet-400/90 transition-colors shrink-0"
                    aria-label="Finish and transcribe"
                  >
                    <Check className="w-3 h-3 text-white" strokeWidth={2.5} />
                  </motion.button>
                </>
              )}

              {/* Transcribing */}
              {state === 'transcribing' && (
                <>
                  <span className="text-[9px] font-medium tracking-wide text-white/40">
                    Transcribing…
                  </span>
                </>
              )}

            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── DIV 1: Trigger strip — 8px at the very bottom, detects hover ── */}
      {state === 'floating-idle' && (
        <div
          onMouseEnter={() => { setIsHovered(true); handleHoverStart(); }}
          onMouseDown={() => ipc.suppressToastActivation()}
          onClick={handleClick}
          style={{
            height: 8,
            display: 'flex',
            justifyContent: 'center',
            borderRadius: '4px 4px 0 0',
            transition: 'background 0.2s ease',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <div style={{ width: 64, height: 8, borderWidth: 1, borderStyle: 'solid', borderRadius: 5, borderColor: isHovered ? 'rgba(255,255,255,0.20)' : 'rgba(255,255,255,0.10)' }} />
        </div>
      )}
    </div>
  );
}
