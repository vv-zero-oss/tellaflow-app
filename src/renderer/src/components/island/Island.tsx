import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion, type Transition } from 'framer-motion';
import {
  Camera, Check, ChevronDown, CircleAlert, Copy, ExternalLink, FileText, FolderOpen,
  KeyRound, Mic, Pause, RotateCw, Sparkles, Square, Video, X,
} from 'lucide-react';
import './island.css';

// Every state the island can be in. Grouped by the job it does:
//   ambient   — idle, idle-hint
//   capture   — dictating, command, transcribing
//   agent     — thinking, working, approval, answer-text, answer-media, voice-reply, done, error, setup
//   meetings  — meeting-prompt, meeting-recording, meeting-saved
export type IslandState =
  | 'idle'
  | 'idle-hint'
  | 'dictating'
  | 'command'
  | 'transcribing'
  | 'thinking'
  | 'working'
  | 'approval'
  | 'answer-text'
  | 'answer-media'
  | 'voice-reply'
  | 'done'
  | 'error'
  | 'setup'
  | 'meeting-prompt'
  | 'meeting-recording'
  | 'meeting-saved';

export type IslandPosition = 'bottom-center' | 'bottom-left' | 'bottom-right' | 'top-center';

export interface IslandProps {
  state: IslandState;
  theme?: 'dark' | 'light';
  blur?: boolean;
  onAction?: (action: string) => void;
}

// Corner radius per size class. Compact pills are fully rounded; expanded
// cards use a squircle-ish radius so text blocks don't crowd the curve.
const RADIUS: Record<IslandState, number> = {
  idle: 8,
  'idle-hint': 18,
  dictating: 20,
  command: 20,
  transcribing: 20,
  thinking: 22,
  working: 26,
  approval: 26,
  'answer-text': 26,
  'answer-media': 26,
  'voice-reply': 22,
  done: 20,
  error: 22,
  setup: 26,
  'meeting-prompt': 24,
  'meeting-recording': 22,
  'meeting-saved': 22,
};

const SPRING: Transition = { type: 'spring', bounce: 0.28, duration: 0.55 };

export function Island({ state, theme = 'dark', blur = true, onAction }: IslandProps) {
  const reduce = useReducedMotion();
  const act = (a: string) => () => onAction?.(a);
  const showBeam = state === 'thinking' || state === 'command' || state === 'working';

  return (
    <motion.div
      layout
      transition={reduce ? { duration: 0 } : SPRING}
      className="island"
      data-theme={theme}
      data-blur={blur ? 'on' : 'off'}
      style={{ borderRadius: RADIUS[state] }}
    >
      <AnimatePresence>
        {showBeam && (
          <motion.div
            key="beam"
            className="pointer-events-none absolute inset-0"
            style={{ borderRadius: 'inherit' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="island-beam-glow" />
            <div className="island-beam" />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={state}
          layout="position"
          initial={reduce ? { opacity: 0 } : { opacity: 0, filter: 'blur(8px)', scale: 0.94 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, filter: 'blur(0px)', scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, filter: 'blur(8px)', scale: 0.96 }}
          transition={reduce ? { duration: 0.1 } : { duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <Content state={state} act={act} />
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Content per state ───────────────────────────────────────────────────────

function Content({ state, act }: { state: IslandState; act: (a: string) => () => void }) {
  switch (state) {
    case 'idle':
      return <div style={{ width: 44, height: 8 }} />;

    case 'idle-hint':
      return (
        <Row className="h-9 px-3.5 gap-2.5 text-[12px]" >
          <span className="text-[var(--ink-2)]">Hold</span>
          <span className="island-kbd">fn</span>
          <span className="text-[var(--ink-2)]">to dictate</span>
          <Dot />
          <span className="island-kbd">⌥ right</span>
          <span className="text-[var(--ink-2)]">for commands</span>
        </Row>
      );

    case 'dictating':
      return (
        <Row className="h-10 pl-3 pr-1.5 gap-2.5">
          <Mic size={14} className="text-[var(--ink-2)]" />
          <MiniWave bars={14} color="var(--ink)" />
          <IconBtn label="Cancel" onClick={act('cancel')}><X size={14} /></IconBtn>
        </Row>
      );

    case 'command':
      return (
        <Row className="h-10 pl-3 pr-1.5 gap-2.5">
          <Sparkles size={14} style={{ color: 'var(--command)' }} />
          <span className="text-[12.5px] font-medium">Command</span>
          <MiniWave bars={12} color="var(--command)" />
          <IconBtn label="Cancel" onClick={act('cancel')}><X size={14} /></IconBtn>
        </Row>
      );

    case 'transcribing':
      return (
        <Row className="h-10 px-4 gap-2">
          <ThinkingDots />
          <span className="text-[12.5px] island-shimmer font-medium">Transcribing</span>
        </Row>
      );

    case 'thinking':
      return (
        <div className="px-4 py-3 w-[340px]">
          <div className="flex items-center gap-2 text-[12px] text-[var(--ink-2)]">
            <Sparkles size={13} style={{ color: 'var(--command)' }} />
            <span className="island-shimmer font-medium">Thinking</span>
            <span className="ml-auto text-[var(--ink-3)]">Claude</span>
          </div>
          <div className="mt-1.5 text-[14px] leading-snug">“Take a screenshot of this and save it to my desktop”</div>
        </div>
      );

    case 'working':
      return (
        <div className="px-4 py-3.5 w-[340px]">
          <div className="text-[13.5px] font-semibold">Taking a screenshot</div>
          <ul className="mt-2.5 space-y-2 text-[12.5px]">
            <Step status="done">Understood your request</Step>
            <Step status="active">Capturing the screen</Step>
            <Step status="todo">Saving to Desktop</Step>
          </ul>
        </div>
      );

    case 'approval':
      return <Approval act={act} />;

    case 'answer-text':
      return (
        <div className="px-4 pt-3.5 pb-3 w-[380px]">
          <Caption icon={<Sparkles size={12} />} text="Your afternoon" />
          <p className="mt-1.5 text-[14px] leading-relaxed">
            Two things left today: <b>Design review</b> at 2:00 (30 min) and a <b>1:1 with Sam</b> at 4:30.
            You’re free between 2:30 and 4:30.
          </p>
          <div className="mt-3 flex gap-1.5">
            <button className="island-btn" onClick={act('open')}><ExternalLink size={13} />Open Calendar</button>
            <button className="island-btn" onClick={act('copy')}><Copy size={13} />Copy</button>
            <button className="island-btn ml-auto" data-variant="ghost" onClick={act('followup')}><Sparkles size={13} />Follow up</button>
          </div>
        </div>
      );

    case 'answer-media':
      return (
        <div className="p-3 w-[380px] flex gap-3">
          <FakeScreenshot />
          <div className="flex flex-col min-w-0 flex-1 py-0.5">
            <Caption icon={<Check size={12} />} text="Saved to Desktop" tone="ok" />
            <div className="mt-1 text-[13.5px] font-semibold truncate">Screenshot 2026-10-15 at 14.02.png</div>
            <div className="text-[12px] text-[var(--ink-3)]">2880 × 1800 · 1.4 MB</div>
            <div className="mt-auto flex gap-1.5">
              <button className="island-btn" data-variant="primary" onClick={act('open')}>Open</button>
              <button className="island-btn" data-size="icon" aria-label="Copy" onClick={act('copy')}><Copy size={13} /></button>
              <button className="island-btn" data-size="icon" aria-label="Show in Finder" onClick={act('reveal')}><FolderOpen size={13} /></button>
            </div>
          </div>
        </div>
      );

    case 'voice-reply':
      return (
        <div className="px-3 py-2.5 w-[360px]">
          <Row className="gap-2.5">
            <IconBtn label="Pause" onClick={act('pause')} solid><Pause size={13} /></IconBtn>
            <MiniWave bars={28} color="var(--ink)" />
            <span className="text-[11.5px] tabular-nums text-[var(--ink-3)] ml-auto">0:04</span>
          </Row>
          <p className="mt-2 px-1 text-[12.5px] leading-snug text-[var(--ink-2)]">
            It’s 18° and sunny in Amsterdam, with light rain expected after 6.
          </p>
        </div>
      );

    case 'done':
      return (
        <Row className="h-10 pl-2 pr-4 gap-2">
          <span className="grid place-items-center size-6 rounded-full" style={{ background: 'var(--ok)' }}>
            <Check size={14} color="#fff" strokeWidth={3} />
          </span>
          <span className="text-[12.5px] font-medium">Opened Safari</span>
        </Row>
      );

    case 'error':
      return (
        <Row className="h-11 pl-3 pr-1.5 gap-2.5 w-[360px]">
          <CircleAlert size={16} style={{ color: 'var(--warn)' }} />
          <span className="text-[12.5px] leading-tight flex-1">Couldn’t reach Notes. It may be closed.</span>
          <button className="island-btn" onClick={act('retry')}><RotateCw size={12} />Retry</button>
        </Row>
      );

    case 'setup':
      return (
        <div className="px-4 pt-3.5 pb-3 w-[380px]">
          <div className="flex gap-3">
            <span className="grid place-items-center size-9 rounded-xl shrink-0" style={{ background: 'var(--chip)' }}>
              <KeyRound size={16} />
            </span>
            <div>
              <div className="text-[13.5px] font-semibold">Sign in to Claude to continue</div>
              <div className="mt-0.5 text-[12.5px] leading-snug text-[var(--ink-2)]">
                Takes a minute in your browser. We’ll run “open safari” as soon as you’re done.
              </div>
            </div>
          </div>
          <div className="mt-3 flex gap-1.5 justify-end">
            <button className="island-btn" data-variant="ghost" onClick={act('other')}>Use another AI</button>
            <button className="island-btn" data-variant="primary" onClick={act('signin')}>Sign in</button>
          </div>
        </div>
      );

    case 'meeting-prompt':
      return (
        <div className="pl-3 pr-2 py-2 w-[420px] flex items-center gap-3 whitespace-nowrap">
          <span className="grid place-items-center size-9 rounded-xl shrink-0" style={{ background: '#2d8cff' }}>
            <Video size={16} color="#fff" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold">Zoom meeting started</div>
            <div className="text-[12px] text-[var(--ink-2)]">Record and take notes?</div>
          </div>
          <button className="island-btn" data-variant="ghost" onClick={act('dismiss')}>Not now</button>
          <button className="island-btn" data-variant="record" onClick={act('record')}>
            <span className="size-2 rounded-full bg-white" />Record
          </button>
        </div>
      );

    case 'meeting-recording':
      return (
        <Row className="h-10 pl-3.5 pr-1.5 gap-2.5">
          <span className="size-2 rounded-full island-pulse" style={{ background: 'var(--record)' }} />
          <span className="text-[12.5px] font-medium tabular-nums">12:04</span>
          <MiniWave bars={10} color="var(--ink-2)" />
          <button className="island-btn" onClick={act('stop')} style={{ height: 28 }}>
            <Square size={10} fill="currentColor" />Stop
          </button>
        </Row>
      );

    case 'meeting-saved':
      return (
        <Row className="h-12 pl-2.5 pr-2 gap-3 w-[360px]">
          <span className="grid place-items-center size-8 rounded-xl" style={{ background: 'var(--chip)' }}>
            <FileText size={15} />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold">Meeting notes ready</div>
            <div className="text-[11.5px] text-[var(--ink-2)]">42 min · 6 action items</div>
          </div>
          <button className="island-btn" data-variant="primary" onClick={act('open')}>Open</button>
        </Row>
      );
  }
}

// ─── Approval: plain-language summary first, script on demand ─────────────

function Approval({ act }: { act: (a: string) => () => void }) {
  const [showScript, setShowScript] = useState(false);
  return (
    <div className="px-4 pt-3.5 pb-3 w-[400px]">
      <div className="flex gap-3">
        <span className="grid place-items-center size-9 rounded-xl shrink-0" style={{ background: 'var(--chip)' }}>
          <Camera size={16} />
        </span>
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold">Take a screenshot?</div>
          <div className="mt-0.5 text-[12.5px] leading-snug text-[var(--ink-2)]">
            Captures the whole screen and saves it to your Desktop.
          </div>
        </div>
      </div>

      <button
        className="mt-2.5 flex items-center gap-1 text-[11.5px] text-[var(--ink-3)] hover:text-[var(--ink-2)]"
        onClick={() => setShowScript((s) => !s)}
      >
        <motion.span animate={{ rotate: showScript ? 180 : 0 }} className="inline-flex"><ChevronDown size={12} /></motion.span>
        {showScript ? 'Hide script' : 'Show script'}
      </button>
      <AnimatePresence initial={false}>
        {showScript && (
          <motion.div
            initial={{ height: 0, opacity: 0, filter: 'blur(4px)' }}
            animate={{ height: 'auto', opacity: 1, filter: 'blur(0px)' }}
            exit={{ height: 0, opacity: 0, filter: 'blur(4px)' }}
            transition={{ type: 'spring', bounce: 0.15, duration: 0.4 }}
            className="overflow-hidden"
          >
            <div className="island-code mt-2">{`do shell script "screencapture -x " & quoted form of p`}</div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-3 flex items-center gap-1.5">
        <button className="island-btn" data-variant="ghost" onClick={act('deny')}>Deny</button>
        <button className="island-btn ml-auto" onClick={act('always')}>Always allow screenshots</button>
        <button className="island-btn" data-variant="primary" onClick={act('allow')}>Allow</button>
      </div>
    </div>
  );
}

// ─── Small building blocks ──────────────────────────────────────────────────

function Row({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`flex items-center whitespace-nowrap ${className}`}>{children}</div>;
}

function Dot() {
  return <span className="size-[3px] rounded-full bg-[var(--ink-3)]" />;
}

function Caption({ icon, text, tone }: { icon: ReactNode; text: string; tone?: 'ok' }) {
  return (
    <div
      className="flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-[0.04em]"
      style={{ color: tone === 'ok' ? 'var(--ok)' : 'var(--ink-3)' }}
    >
      {icon}
      {text}
    </div>
  );
}

function IconBtn({ label, onClick, children, solid }: { label: string; onClick: () => void; children: ReactNode; solid?: boolean }) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className="island-btn"
      data-size="icon"
      data-variant={solid ? 'primary' : undefined}
      style={{ height: 28, width: 28 }}
    >
      {children}
    </button>
  );
}

function Step({ status, children }: { status: 'done' | 'active' | 'todo'; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2.5">
      <span className="grid place-items-center size-4">
        {status === 'done' && <Check size={14} style={{ color: 'var(--ok)' }} strokeWidth={3} />}
        {status === 'active' && (
          <motion.span
            className="block size-3.5 rounded-full border-2"
            style={{ borderColor: 'var(--command)', borderTopColor: 'transparent' }}
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }}
          />
        )}
        {status === 'todo' && <span className="block size-1.5 rounded-full bg-[var(--ink-3)]" />}
      </span>
      <span className={status === 'todo' ? 'text-[var(--ink-3)]' : status === 'active' ? 'island-shimmer' : 'text-[var(--ink-2)]'}>
        {children}
      </span>
    </li>
  );
}

function ThinkingDots() {
  return (
    <span className="flex gap-1">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="block size-1.5 rounded-full bg-[var(--ink)]"
          animate={{ opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
          transition={{ repeat: Infinity, duration: 1, delay: i * 0.15 }}
        />
      ))}
    </span>
  );
}

// Compact, rounded-bar waveform driven by a simulated level. In the app this
// reads the real mic level the main process already sends over `audio-level`.
function MiniWave({ bars, color }: { bars: number; color: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const kids = Array.from(el.children) as HTMLElement[];
    const tick = (t: number) => {
      const level = 0.45 + 0.35 * Math.sin(t / 380) * Math.sin(t / 1270);
      kids.forEach((k, i) => {
        const center = 1 - Math.abs(i - (bars - 1) / 2) / (bars / 2);
        const n = 0.5 + 0.5 * Math.sin(t / 90 + i * 1.7) * Math.cos(t / 210 + i);
        const h = 3 + 13 * Math.max(0, level) * (0.35 + 0.65 * center) * (0.4 + 0.6 * n);
        k.style.height = `${h.toFixed(1)}px`;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [bars]);
  return (
    <div ref={ref} className="flex items-center gap-[2.5px] h-4">
      {Array.from({ length: bars }).map((_, i) => (
        <span key={i} className="block w-[2.5px] rounded-full" style={{ background: color, height: 3 }} />
      ))}
    </div>
  );
}

function FakeScreenshot() {
  return (
    <div
      className="relative w-[120px] h-[76px] rounded-xl overflow-hidden shrink-0"
      style={{
        background: 'linear-gradient(135deg, #ff9a62 0%, #e24f8f 45%, #5b4bdb 100%)',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.2)',
      }}
    >
      <div className="absolute left-2 top-2 right-6 bottom-3 rounded-md bg-white/85">
        <div className="h-2.5 rounded-t-md bg-black/10" />
        <div className="m-1.5 space-y-1">
          <div className="h-1 w-3/4 rounded bg-black/20" />
          <div className="h-1 w-1/2 rounded bg-black/15" />
          <div className="h-1 w-2/3 rounded bg-black/15" />
        </div>
      </div>
    </div>
  );
}
