import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { LayoutGroup, motion, useAnimationControls } from 'framer-motion';
import { Island, type IslandPosition, type IslandState } from './Island';

// Dev-only playground for the island: every state, every position, light/dark,
// blur on/off, and scripted flows. URL params (?state=&pos=&theme=&blur=&chrome=0)
// make it easy to screenshot a single frame.

const STATES: { id: IslandState; label: string; group: string }[] = [
  { id: 'idle', label: 'Idle', group: 'Ambient' },
  { id: 'idle-hint', label: 'Idle · hover hint', group: 'Ambient' },
  { id: 'dictating', label: 'Dictating', group: 'Capture' },
  { id: 'command', label: 'Command key', group: 'Capture' },
  { id: 'transcribing', label: 'Transcribing', group: 'Capture' },
  { id: 'thinking', label: 'Thinking', group: 'Agent' },
  { id: 'working', label: 'Working · steps', group: 'Agent' },
  { id: 'approval', label: 'Approval', group: 'Agent' },
  { id: 'answer-text', label: 'Answer · text', group: 'Agent' },
  { id: 'answer-media', label: 'Answer · image', group: 'Agent' },
  { id: 'voice-reply', label: 'Answer · voice', group: 'Agent' },
  { id: 'done', label: 'Done', group: 'Agent' },
  { id: 'error', label: 'Error', group: 'Agent' },
  { id: 'setup', label: 'Setup needed', group: 'Agent' },
  { id: 'meeting-prompt', label: 'Meeting · ask', group: 'Meetings' },
  { id: 'meeting-recording', label: 'Meeting · recording', group: 'Meetings' },
  { id: 'meeting-saved', label: 'Meeting · saved', group: 'Meetings' },
];

const POSITIONS: { id: IslandPosition; label: string }[] = [
  { id: 'bottom-left', label: 'Bottom left' },
  { id: 'bottom-center', label: 'Bottom center' },
  { id: 'bottom-right', label: 'Bottom right' },
  { id: 'top-center', label: 'Top (notch)' },
];

const FLOWS: Record<string, [IslandState, number][]> = {
  'Command → screenshot': [
    ['idle', 700], ['command', 2200], ['transcribing', 1100], ['thinking', 1800],
    ['approval', 2600], ['working', 1800], ['answer-media', 3200], ['idle', 800],
  ],
  'Dictation': [['idle', 600], ['idle-hint', 1500], ['dictating', 2400], ['transcribing', 1200], ['done', 1500], ['idle', 800]],
  'Meeting': [['idle', 700], ['meeting-prompt', 2600], ['meeting-recording', 3000], ['meeting-saved', 2800], ['idle', 800]],
  'Not signed in': [['idle', 600], ['command', 1800], ['thinking', 1200], ['setup', 3200], ['idle', 800]],
};

const ANCHOR: Record<IslandPosition, CSSProperties> = {
  'bottom-center': { left: 0, right: 0, bottom: 22, justifyContent: 'center', alignItems: 'flex-end' },
  'bottom-left': { left: 22, bottom: 22, justifyContent: 'flex-start', alignItems: 'flex-end' },
  'bottom-right': { right: 22, bottom: 22, justifyContent: 'flex-end', alignItems: 'flex-end' },
  'top-center': { left: 0, right: 0, top: 34, justifyContent: 'center', alignItems: 'flex-start' },
};

function param<T extends string>(name: string, fallback: T): T {
  return (new URLSearchParams(location.search).get(name) as T) || fallback;
}

export default function IslandLab() {
  const [state, setState] = useState<IslandState>(param('state', 'command'));
  const [pos, setPos] = useState<IslandPosition>(param('pos', 'bottom-center'));
  const [theme, setTheme] = useState<'dark' | 'light'>(param('theme', 'dark'));
  const [blur, setBlur] = useState(param<string>('blur', 'on') === 'on');
  const [wallpaper, setWallpaper] = useState<string>(param<string>('wall', 'sunset'));
  const chrome = param<string>('chrome', '1') !== '0';
  const [log, setLog] = useState<string[]>([]);
  const flowTimer = useRef<number[]>([]);
  const moveBlur = useAnimationControls();

  const stopFlow = () => { flowTimer.current.forEach(clearTimeout); flowTimer.current = []; };
  const runFlow = (name: string) => {
    stopFlow();
    let t = 0;
    for (const [s, ms] of FLOWS[name]) {
      flowTimer.current.push(window.setTimeout(() => setState(s), t));
      t += ms;
    }
  };
  useEffect(() => stopFlow, []);

  // A brief blur while the island travels between anchors makes the move read
  // as one fluid object rather than a jump.
  const changePos = (p: IslandPosition) => {
    if (p === pos) return;
    setPos(p);
    moveBlur.start({ filter: ['blur(0px)', 'blur(3px)', 'blur(0px)'], transition: { duration: 0.55, times: [0, 0.4, 1] } });
  };

  const onAction = (a: string) => {
    setLog((l) => [`${state} → ${a}`, ...l].slice(0, 6));
    const next: Record<string, IslandState> = {
      'approval:allow': 'working', 'approval:always': 'working', 'approval:deny': 'idle',
      'meeting-prompt:record': 'meeting-recording', 'meeting-prompt:dismiss': 'idle',
      'meeting-recording:stop': 'meeting-saved', 'setup:signin': 'thinking',
      'error:retry': 'working', 'dictating:cancel': 'idle', 'command:cancel': 'idle',
    };
    const n = next[`${state}:${a}`];
    if (n) setState(n);
  };

  return (
    <div className="fixed inset-0 flex" style={{ background: '#0b0b0e', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* ── Fake desktop ── */}
      <div className="relative flex-1 overflow-hidden" style={{ background: WALLPAPERS[wallpaper] ?? WALLPAPERS.sunset }}>
        <MenuBar light={wallpaper === 'paper'} />
        <FakeWindow />
        <LayoutGroup>
          <div className="absolute flex pointer-events-none" style={{ ...ANCHOR[pos], position: 'absolute' }}>
            <motion.div animate={moveBlur} className="pointer-events-auto">
              <Island state={state} theme={theme} blur={blur} onAction={onAction} />
            </motion.div>
          </div>
        </LayoutGroup>
      </div>

      {/* ── Controls ── */}
      {chrome && (
        <aside className="w-[260px] shrink-0 overflow-y-auto border-l border-white/10 bg-[#141418] text-white/90 p-4 text-[12.5px] space-y-5">
          <div>
            <div className="text-[15px] font-semibold">Island lab</div>
            <div className="text-white/50 mt-0.5">Tellaflow dynamic island prototype</div>
          </div>

          <Section title="Flows">
            {Object.keys(FLOWS).map((f) => (
              <Pill key={f} onClick={() => runFlow(f)}>▶ {f}</Pill>
            ))}
          </Section>

          {['Ambient', 'Capture', 'Agent', 'Meetings'].map((g) => (
            <Section key={g} title={g}>
              {STATES.filter((s) => s.group === g).map((s) => (
                <Pill key={s.id} active={state === s.id} onClick={() => { stopFlow(); setState(s.id); }}>{s.label}</Pill>
              ))}
            </Section>
          ))}

          <Section title="Position">
            {POSITIONS.map((p) => (
              <Pill key={p.id} active={pos === p.id} onClick={() => changePos(p.id)}>{p.label}</Pill>
            ))}
          </Section>

          <Section title="Look">
            <Pill active={theme === 'dark'} onClick={() => setTheme('dark')}>Dark glass</Pill>
            <Pill active={theme === 'light'} onClick={() => setTheme('light')}>Light glass</Pill>
            <Pill active={blur} onClick={() => setBlur(true)}>Backdrop blur</Pill>
            <Pill active={!blur} onClick={() => setBlur(false)}>Tint only</Pill>
          </Section>

          <Section title="Wallpaper">
            {Object.keys(WALLPAPERS).map((w) => (
              <Pill key={w} active={wallpaper === w} onClick={() => setWallpaper(w)}>{w}</Pill>
            ))}
          </Section>

          {log.length > 0 && (
            <Section title="Actions">
              <div className="w-full font-mono text-[11px] text-white/50 space-y-0.5">
                {log.map((l, i) => <div key={i}>{l}</div>)}
              </div>
            </Section>
          )}
        </aside>
      )}
    </div>
  );
}

const WALLPAPERS: Record<string, string> = {
  sunset:
    'radial-gradient(60% 70% at 15% 20%, #ff8a5b 0%, transparent 60%), radial-gradient(50% 60% at 85% 30%, #7a5cff 0%, transparent 60%), radial-gradient(70% 70% at 60% 100%, #ff4f8b 0%, transparent 60%), #2a1846',
  ocean:
    'radial-gradient(60% 70% at 20% 10%, #3bd2ff 0%, transparent 60%), radial-gradient(60% 60% at 90% 80%, #2c5bff 0%, transparent 60%), #071a3a',
  paper:
    'radial-gradient(60% 70% at 20% 10%, #ffe7d1 0%, transparent 60%), radial-gradient(60% 60% at 90% 80%, #d9e4ff 0%, transparent 60%), #f4f1ec',
  graphite: 'radial-gradient(70% 70% at 30% 20%, #3a3a44 0%, transparent 60%), #121216',
};

function MenuBar({ light }: { light: boolean }) {
  return (
    <div
      className="absolute inset-x-0 top-0 h-7 flex items-center px-4 gap-5 text-[12.5px] font-medium"
      style={{
        background: light ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.22)',
        color: light ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.92)',
        backdropFilter: 'blur(20px)',
      }}
    >
      <span></span><span className="font-semibold">Safari</span><span>File</span><span>Edit</span><span>View</span><span>History</span>
      <span className="ml-auto tabular-nums">Thu 15 Oct 14:02</span>
    </div>
  );
}

function FakeWindow() {
  return (
    <div className="absolute left-[12%] right-[12%] top-[16%] bottom-[22%] rounded-[14px] overflow-hidden bg-white shadow-2xl" style={{ boxShadow: '0 30px 80px -20px rgba(0,0,0,.5)' }}>
      <div className="h-10 flex items-center gap-2 px-3.5 bg-[#f3f3f5] border-b border-black/5">
        <span className="size-3 rounded-full bg-[#ff5f57]" /><span className="size-3 rounded-full bg-[#febc2e]" /><span className="size-3 rounded-full bg-[#28c840]" />
        <div className="mx-auto h-6 w-[45%] rounded-md bg-black/5 text-[11px] text-black/50 grid place-items-center">tellaflow.app/blog/dynamic-island</div>
      </div>
      <div className="p-8 text-black/80">
        <div className="text-[26px] font-bold tracking-tight">Designing for the edge of the screen</div>
        <div className="mt-2 text-[13px] text-black/45">October 15 · 6 min read</div>
        <div className="mt-6 grid grid-cols-3 gap-4">
          <div className="col-span-2 space-y-2.5">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="h-2.5 rounded bg-black/[0.08]" style={{ width: `${70 + ((i * 37) % 30)}%` }} />
            ))}
          </div>
          <div className="rounded-xl" style={{ background: 'linear-gradient(135deg,#ffb36b,#ff5f8f 50%,#6b5cff)' }} />
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-[0.08em] text-white/40 mb-1.5">{title}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Pill({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`h-7 px-2.5 rounded-lg text-[12px] transition-colors ${active ? 'bg-white text-black' : 'bg-white/[0.07] hover:bg-white/[0.13] text-white/85'}`}
    >
      {children}
    </button>
  );
}
