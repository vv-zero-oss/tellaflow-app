import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { Mic, Search, X, PlayIcon, PauseIcon, RotateCcw, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { TrashIcon } from '@/components/icons/TrashIcon';
import { CopyIcon } from '@/components/icons/CopyIcon';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Well, WellHeader, WellTitle, WellCard, WellItem } from '@/components/ui/well';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { HistoryEntry, HotkeyConfig } from '@/lib/ipc';
import { ipc } from '@/lib/ipc';
import {
  AudioPlayerProvider,
  AudioPlayerProgress,
  AudioPlayerTime,
  AudioPlayerDuration,
  AudioPlayerSpeed,
  useAudioPlayer,
} from '@/components/ui/audio-player';

interface HomePageProps {
  entries: HistoryEntry[];
  totalWords: number;
  onCopy: (text: string) => void;
  onDelete: (id: number) => void;
  onRetry: (id: number) => void;
  hotkey?: HotkeyConfig;
  missingMic?: boolean;
  missingAccessibility?: boolean;
  onGoToSettings?: () => void;
  onGoToDashboard?: () => void;
}

const TYPING_WPM = 40;
const SPEAKING_WPM = 150;

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
}

function getWeekBounds(): { start: number; end: number } {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const start = new Date(now);
  start.setDate(now.getDate() - diff);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return { start: start.getTime(), end: end.getTime() };
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

function formatTimeSaved(minutes: number): string {
  if (minutes < 1) return `${Math.round(minutes * 60)}s`;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatBigNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return `${n}`;
}

function getStreakDays(entries: HistoryEntry[]): number {
  if (!entries.length) return 0;
  const days = new Set(
    entries.map(e => new Date(typeof e.timestamp === 'number' ? e.timestamp : Number(e.timestamp)).toDateString())
  );
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    if (days.has(d.toDateString())) streak++;
    else if (i > 0) break;
  }
  return streak;
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(ts: string) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

function groupByDate(entries: HistoryEntry[]) {
  const groups: { label: string; items: HistoryEntry[] }[] = [];
  let current = '';
  for (const e of entries) {
    const label = formatDate(e.timestamp);
    if (label !== current) {
      groups.push({ label, items: [] });
      current = label;
    }
    groups[groups.length - 1].items.push(e);
  }
  return groups;
}


// ─── Main component ───────────────────────────────────────────────────────────

function highlight(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let last = 0;
  let idx = lower.indexOf(q);
  while (idx !== -1) {
    if (idx > last) parts.push(text.slice(last, idx));
    parts.push(
      <mark key={idx} className="bg-yellow-200 dark:bg-yellow-500/40 text-inherit rounded-sm px-0">
        {text.slice(idx, idx + query.length)}
      </mark>
    );
    last = idx + query.length;
    idx = lower.indexOf(q, last);
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? <>{parts}</> : text;
}

// ─── Permission Banner ────────────────────────────────────────────────────────

function PermissionBanner({
  missingMic,
  missingAccessibility,
  onGoToSettings,
}: {
  missingMic: boolean;
  missingAccessibility: boolean;
  onGoToSettings?: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || (!missingMic && !missingAccessibility)) return null;

  const label = missingMic && missingAccessibility
    ? 'Microphone & Accessibility access required'
    : missingMic
    ? 'Microphone access required'
    : 'Accessibility access required';

  return (
    <div className="relative flex h-10 shrink-0 items-center justify-center px-4 gap-2 w-full border-b border-border/60 bg-amber-500/[0.07] [-webkit-app-region:no-drag]">
      <div className="flex min-w-0 items-center gap-2">
        {/* badge */}
        <span className="shrink-0 inline-flex items-center rounded-[5px] px-1.5 py-px text-[9px] font-semibold uppercase tracking-[0.18px] leading-[1.3] bg-amber-500/15 text-amber-600 dark:text-amber-400">
          PERMISSIONS
        </span>
        {/* message */}
        <span className="text-xs text-muted-foreground truncate">{label} — voice commands won't work</span>
        {/* separator + link */}
        <span className="hidden md:flex items-center gap-2 shrink-0 pl-1">
          <span className="h-px w-4 bg-border/70" />
          <button
            type="button"
            onClick={onGoToSettings}
            className="inline-flex items-center gap-0.5 text-xs font-medium text-amber-600 dark:text-amber-400 underline decoration-transparent underline-offset-[3px] hover:decoration-current transition-all"
          >
            Open Settings
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" className="shrink-0">
              <path d="M5.636 19.778L4.222 18.364 15.657 6.929l-5.586-.001V4.928l9 .001.001 9h-2l-.001-5.586L5.636 19.778z" />
            </svg>
          </button>
        </span>
      </div>
      {/* close */}
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="absolute top-1/2 right-3 -translate-y-1/2 flex items-center justify-center w-5 h-5 rounded text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── Per-entry audio controls (needs to be inside AudioPlayerProvider) ────────

interface AudioEntryItemProps {
  entry: HistoryEntry;
  blobUrlsRef: React.MutableRefObject<Record<number, string>>;
  searchQuery: string;
  onCopy: (text: string) => void;
  onDelete: (id: number) => void;
  onRetry: (id: number) => void;
}

function AudioEntryItem({ entry, blobUrlsRef, searchQuery, onCopy, onDelete, onRetry }: AudioEntryItemProps) {
  const player = useAudioPlayer();
  const isActive = player.isItemActive(entry.id);
  const isFailed = entry.text === '[Transcription failed]';
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const handlePlayToggle = useCallback(async () => {
    if (isActive) {
      if (player.isPlaying) player.pause();
      else player.play();
      return;
    }
    let src = blobUrlsRef.current[entry.id];
    if (!src) {
      if (!entry.audioPath || !ipc) return;
      setLoadingAudio(true);
      try {
        const data = await ipc.getAudioData(entry.audioPath);
        if (!data) return;
        const blob = new Blob([data], { type: 'audio/wav' });
        src = URL.createObjectURL(blob);
        blobUrlsRef.current[entry.id] = src;
      } catch {
        return;
      } finally {
        setLoadingAudio(false);
      }
    }
    player.play({ id: entry.id, src });
  }, [isActive, player, blobUrlsRef, entry]);

  const showingPlay = !isActive || !player.isPlaying;

  return (
    <WellItem className="group">
      <div className="flex items-start gap-4">
        <span className="shrink-0 text-xs font-medium text-muted-foreground min-w-[76px] pt-0.5 tabular-nums">
          {formatTime(entry.timestamp)}
        </span>
        <p className={cn(
          'flex-1 min-w-0 text-sm leading-relaxed whitespace-pre-wrap break-words',
          isFailed && 'italic text-muted-foreground'
        )}>
          {isFailed ? 'Transcription failed — audio saved' : highlight(entry.text, searchQuery)}
        </p>
        <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {entry.audioPath && (
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-7 w-7',
                isActive
                  ? 'text-blue-500 hover:text-blue-600 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950 dark:hover:bg-blue-900'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={handlePlayToggle}
              disabled={loadingAudio}
              title={isActive && player.isPlaying ? 'Pause' : 'Play recording'}
            >
              {loadingAudio ? (
                <span className="border-muted border-t-foreground size-3 animate-spin rounded-full border-2 inline-block" />
              ) : showingPlay ? (
                <PlayIcon className="w-3.5 h-3.5" />
              ) : (
                <PauseIcon className="w-3.5 h-3.5" />
              )}
            </Button>
          )}
          {isFailed && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950"
              onClick={async () => {
                setRetrying(true);
                try { await onRetry(entry.id); } catch {} finally { setRetrying(false); }
              }}
              disabled={retrying}
              title="Retry transcription"
            >
              {retrying ? (
                <span className="border-muted border-t-foreground size-3 animate-spin rounded-full border-2 inline-block" />
              ) : (
                <RotateCcw className="w-3.5 h-3.5" />
              )}
            </Button>
          )}
          {!isFailed && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => onCopy(entry.text)}
              title="Copy"
            >
              <CopyIcon className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            onClick={() => {
              if (isActive) player.pause();
              if (blobUrlsRef.current[entry.id]) {
                URL.revokeObjectURL(blobUrlsRef.current[entry.id]);
                delete blobUrlsRef.current[entry.id];
              }
              onDelete(entry.id);
            }}
            title="Delete"
          >
            <TrashIcon className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Inline audio player — expands when this entry is active */}
      <AnimatePresence>
        {isActive && (
          <motion.div
            key="player"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/30">
              <AudioPlayerTime className="text-xs w-8 shrink-0" />
              <AudioPlayerProgress className="flex-1" />
              <AudioPlayerDuration className="text-xs w-8 shrink-0 text-right" />
              <AudioPlayerSpeed
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                speeds={[0.5, 0.75, 1, 1.25, 1.5, 2]}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </WellItem>
  );
}

const INITIAL_VISIBLE_DAYS = 3;
const LOAD_MORE_STEP = 3;

const MARQUEE_ROW_1 = [
  { name: 'Slack',      logo: `${import.meta.env.BASE_URL}logos/slack.svg` },
  { name: 'Discord',    logo: `${import.meta.env.BASE_URL}logos/discord.svg` },
  { name: 'Chrome',     logo: `${import.meta.env.BASE_URL}logos/chrome.svg` },
  { name: 'Notion',     logo: `${import.meta.env.BASE_URL}logos/notion.svg` },
  { name: 'Figma',      logo: `${import.meta.env.BASE_URL}logos/figma.svg` },
  { name: 'Linear',     logo: `${import.meta.env.BASE_URL}logos/linear.svg` },
  { name: 'Safari',     logo: `${import.meta.env.BASE_URL}logos/safari.svg` },
];

const MARQUEE_ROW_2 = [
  { name: 'Word',       logo: `${import.meta.env.BASE_URL}logos/microsoft-word.svg` },
  { name: 'Teams',      logo: `${import.meta.env.BASE_URL}logos/microsoft-teams.svg` },
  { name: 'WhatsApp',   logo: `${import.meta.env.BASE_URL}logos/whatsapp-icon.svg` },
  { name: 'Arc',        logo: `${import.meta.env.BASE_URL}logos/arc_browser.svg` },
  { name: 'Slides',     logo: `${import.meta.env.BASE_URL}logos/google-slides.svg` },
  { name: 'PowerPoint', logo: `${import.meta.env.BASE_URL}logos/microsoft-powerpoint.svg` },
  { name: 'Opera',      logo: `${import.meta.env.BASE_URL}logos/opera.svg` },
];

function AppPill({ name, logo }: { name: string; logo: string }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 7,
      background: 'var(--well)', border: '1px solid var(--border)',
      borderRadius: 100, padding: '5px 10px 5px 5px',
      flexShrink: 0,
    }}>
      <div style={{
        width: 18, height: 18, borderRadius: 5, flexShrink: 0,
        background: 'rgba(128,128,128,0.12)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      }}>
        <img src={logo} alt={name} width={14} height={14} style={{ width: 14, height: 14, objectFit: 'contain' }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-muted-foreground)', whiteSpace: 'nowrap', letterSpacing: '-0.01em' }}>
        {name}
      </span>
    </div>
  );
}

function MarqueeRow({ items, reverse = false }: { items: typeof MARQUEE_ROW_1; reverse?: boolean }) {
  const doubled = [...items, ...items];
  return (
    <div style={{
      overflow: 'hidden', width: '100%',
      maskImage: 'linear-gradient(to right, transparent 0%, black 12%, black 88%, transparent 100%)',
      WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 12%, black 88%, transparent 100%)',
    }}>
      <div className={reverse ? 'hs-marquee-rev' : 'hs-marquee'} style={{ display: 'flex', gap: 6, paddingRight: 6, width: 'max-content' }}>
        {doubled.map((app, i) => <AppPill key={`${app.name}-${i}`} {...app} />)}
      </div>
    </div>
  );
}

function HotkeyEmptyState({ hotkey }: { hotkey?: HotkeyConfig }) {
  const label = hotkey?.label ?? 'Option';

  return (
    <div className="flex-1 flex flex-col overflow-hidden select-none">
      <style>{`
        @keyframes keyPress {
          0%   {
            transform: rotateX(20deg) translateY(0px);
            box-shadow: 0 8px 0 0 #1a1a1a, 0 10px 20px rgba(0,0,0,0.5);
            background: linear-gradient(160deg, #3a3a3a 0%, #242424 100%);
            border-color: rgba(255,255,255,0.08);
          }
          18%  {
            transform: rotateX(20deg) translateY(5px);
            box-shadow: 0 3px 0 0 #1a1a1a, 0 4px 8px rgba(0,0,0,0.4);
            background: linear-gradient(160deg, #3a3a3a 0%, #242424 100%);
            border-color: rgba(255,255,255,0.08);
          }
          22%  {
            transform: rotateX(20deg) translateY(5px);
            box-shadow: 0 3px 0 0 #4a90e2, 0 6px 20px rgba(74,144,226,0.55), inset 0 0 14px rgba(74,144,226,0.15);
            background: linear-gradient(160deg, #2a3f5f 0%, #1a2c45 100%);
            border-color: rgba(74,144,226,0.5);
          }
          65%  {
            transform: rotateX(20deg) translateY(5px);
            box-shadow: 0 3px 0 0 #4a90e2, 0 6px 20px rgba(74,144,226,0.55), inset 0 0 14px rgba(74,144,226,0.15);
            background: linear-gradient(160deg, #2a3f5f 0%, #1a2c45 100%);
            border-color: rgba(74,144,226,0.5);
          }
          80%  {
            transform: rotateX(20deg) translateY(0px);
            box-shadow: 0 8px 0 0 #1a1a1a, 0 10px 20px rgba(0,0,0,0.5);
            background: linear-gradient(160deg, #3a3a3a 0%, #242424 100%);
            border-color: rgba(255,255,255,0.08);
          }
          100% {
            transform: rotateX(20deg) translateY(0px);
            box-shadow: 0 8px 0 0 #1a1a1a, 0 10px 20px rgba(0,0,0,0.5);
            background: linear-gradient(160deg, #3a3a3a 0%, #242424 100%);
            border-color: rgba(255,255,255,0.08);
          }
        }
        @keyframes keyLabelPress {
          0%   { color: rgba(255,255,255,0.75); text-shadow: none; }
          22%  { color: rgba(255,255,255,1);    text-shadow: 0 0 10px rgba(74,144,226,0.9); }
          65%  { color: rgba(255,255,255,1);    text-shadow: 0 0 10px rgba(74,144,226,0.9); }
          80%  { color: rgba(255,255,255,0.75); text-shadow: none; }
          100% { color: rgba(255,255,255,0.75); text-shadow: none; }
        }
        @keyframes ripple {
          0%   { transform: scale(0.85); opacity: 0; }
          22%  { transform: scale(0.85); opacity: 0.5; }
          75%  { transform: scale(1.3);  opacity: 0; }
          100% { transform: scale(1.3);  opacity: 0; }
        }
        .key-3d {
          animation: keyPress 2.8s ease-in-out infinite;
          transform: rotateX(20deg);
        }
        .key-label {
          animation: keyLabelPress 2.8s ease-in-out infinite;
        }
        .key-ripple {
          animation: ripple 2.8s ease-out infinite;
        }
        @keyframes hs-marquee {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
        @keyframes hs-marquee-rev {
          from { transform: translateX(-50%); }
          to   { transform: translateX(0); }
        }
        .hs-marquee     { animation: hs-marquee     26s linear infinite; }
        .hs-marquee-rev { animation: hs-marquee-rev 26s linear infinite; }
      `}</style>

      {/* Key animation — centered in remaining space */}
      <div className="flex-1 flex flex-col items-center justify-center gap-5 px-8">

      <div style={{ perspective: '400px' }} className="flex items-center justify-center">
        <div className="relative flex items-center justify-center" style={{ width: 160, height: 120 }}>
          {/* ripple ring */}
          <div
            className="key-ripple absolute rounded-2xl border border-blue-400/30"
            style={{ width: 116, height: 116 }}
          />

          {/* 3D key cap */}
          <div
            className="key-3d relative flex items-center justify-center rounded-xl font-semibold tracking-wide"
            style={{
              width: 96,
              height: 96,
              fontSize: 15,
              background: 'linear-gradient(160deg, #3a3a3a 0%, #242424 100%)',
              border: '1px solid rgba(255,255,255,0.08)',
              boxShadow: '0 8px 0 0 #1a1a1a, 0 10px 20px rgba(0,0,0,0.5)',
              transformOrigin: 'center bottom',
            }}
          >
            {/* inner shine */}
            <div
              className="absolute inset-0 rounded-xl pointer-events-none"
              style={{
                background: 'linear-gradient(135deg, rgba(255,255,255,0.07) 0%, transparent 60%)',
              }}
            />
            <span className="key-label relative z-10" style={{ fontSize: 13, letterSpacing: '0.04em' }}>
              {label}
            </span>
          </div>
        </div>
      </div>

      <div className="text-center space-y-1">
        <p className="text-sm font-medium text-foreground/60">
          Hold <span className="font-mono text-foreground/80">{label}</span> and speak to transcribe
        </p>
        <p className="text-xs text-muted-foreground/35">Works everywhere you type</p>
      </div>

      </div>{/* end center section */}

      {/* Marquee — anchored to bottom */}
      <div className="pb-5 flex flex-col gap-1.5">
        <p className="text-center text-[10px] text-muted-foreground/30 tracking-wide mb-0.5">
          Works with Slack, Chrome, Notion, Figma and every other app
        </p>
        <MarqueeRow items={MARQUEE_ROW_1} />
        <MarqueeRow items={MARQUEE_ROW_2} reverse />
      </div>
    </div>
  );
}

export function HomePage({ entries, totalWords, onCopy, onDelete, onRetry, hotkey, missingMic = false, missingAccessibility = false, onGoToSettings, onGoToDashboard }: HomePageProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [visibleDays, setVisibleDays] = useState(INITIAL_VISIBLE_DAYS);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const blobUrlsRef = useRef<Record<number, string>>({});

  // Revoke all blob URLs on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      for (const url of Object.values(blobUrlsRef.current)) {
        URL.revokeObjectURL(url);
      }
      blobUrlsRef.current = {};
    };
  }, []);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    setTimeout(() => searchInputRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'f' && (e.metaKey || e.ctrlKey) && entries.length > 0) {
        e.preventDefault();
        if (searchOpen) {
          searchInputRef.current?.focus();
        } else {
          openSearch();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [entries.length, searchOpen, openSearch]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery('');
    setVisibleDays(INITIAL_VISIBLE_DAYS);
  }, []);

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(e => e.text.toLowerCase().includes(q));
  }, [entries, searchQuery]);

  const isSearching = searchQuery.trim().length > 0;
  const allGroups = groupByDate(filteredEntries);
  const visibleGroups = isSearching ? allGroups : allGroups.slice(0, visibleDays);
  const hiddenGroupCount = isSearching ? 0 : Math.max(0, allGroups.length - visibleDays);

  const stats = useMemo(() => {
    const { start, end } = getWeekBounds();
    let weekWords = 0;
    for (const e of entries) {
      const ts = typeof e.timestamp === 'number' ? e.timestamp : Number(e.timestamp);
      if (ts >= start && ts < end) weekWords += wordCount(e.text);
    }

    const typingMinutes = totalWords / TYPING_WPM;
    const speakingMinutes = totalWords / SPEAKING_WPM;
    const timeSaved = Math.max(0, typingMinutes - speakingMinutes);
    const streak = getStreakDays(entries);
    const avgWpm = entries.length > 0
      ? Math.round(totalWords / Math.max(1, entries.length * (45 / 60)))
      : 0;

    return { weekWords, timeSaved, streak, avgWpm };
  }, [entries, totalWords]);

  return (
    <AudioPlayerProvider>
    <div className="flex flex-col flex-1 overflow-hidden">
      <PermissionBanner
        missingMic={missingMic}
        missingAccessibility={missingAccessibility}
        onGoToSettings={onGoToSettings}
      />
      {/* Header */}
      <div className="px-7 pt-12 pb-2 [-webkit-app-region:drag]">
        <p className="text-[11px] text-muted-foreground font-medium tracking-wide uppercase mb-1">
          {new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>

        {/* Greeting + stats pill on same row */}
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-[26px] font-semibold tracking-tight leading-snug">
            {getGreeting()}.
          </h1>

          <div className="[-webkit-app-region:no-drag] shrink-0 flex items-center gap-2">
            {entries.length > 0 && (
              <button
                onClick={onGoToDashboard}
                className="flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-accent/50 hover:bg-accent/80 border border-border/40 transition-colors text-[12px] font-medium text-foreground"
              >
                <span>🔥 {stats.streak}d</span>
                <span className="w-px h-3 bg-border/60" />
                <span>🚀 {formatBigNum(totalWords)}</span>
                <span className="w-px h-3 bg-border/60" />
                <span>⏱️ {formatTimeSaved(stats.timeSaved)}</span>
              </button>
            )}
            {entries.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex items-center justify-center w-7 h-7 rounded-full bg-accent/50 hover:bg-accent/80 border border-border/40 transition-colors text-muted-foreground hover:text-foreground"
                    title="Export transcriptions"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => ipc.exportHistory('markdown')}>
                    Export as Markdown
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => ipc.exportHistory('text')}>
                    Export as Plain Text
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {entries.length > 0 && (
              <button
                onClick={searchOpen ? closeSearch : openSearch}
                className="flex items-center justify-center w-7 h-7 rounded-full bg-accent/50 hover:bg-accent/80 border border-border/40 transition-colors text-muted-foreground hover:text-foreground"
                title="Search transcriptions"
              >
                {searchOpen ? <X className="w-3.5 h-3.5" /> : <Search className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>
        </div>

        {entries.length > 0 && (
          <p className="text-[14px] text-muted-foreground leading-snug mt-0.5">
            {isSearching ? (
              <>
                <strong className="text-foreground">{filteredEntries.length}</strong> result{filteredEntries.length !== 1 ? 's' : ''} across all history
              </>
            ) : (
              <>
                <strong className="text-foreground">{entries.length}</strong> transcription{entries.length !== 1 ? 's' : ''} ·{' '}
                <strong className="text-foreground">{stats.weekWords}</strong> words this week
              </>
            )}
          </p>
        )}

        <AnimatePresence>
          {searchOpen && (
            <motion.div
              key="search-bar"
              initial={{ opacity: 0, height: 0, marginTop: 0 }}
              animate={{ opacity: 1, height: 'auto', marginTop: 8 }}
              exit={{ opacity: 0, height: 0, marginTop: 0 }}
              transition={{ duration: 0.18, ease: 'easeInOut' }}
              className="[-webkit-app-region:no-drag] overflow-hidden"
            >
              <div className="relative flex items-center">
                <Search className="absolute left-3 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Escape' && closeSearch()}
                  placeholder="Search transcriptions…"
                  className="w-full pl-8 pr-8 py-1.5 text-sm rounded-lg border border-border/60 bg-background/60 focus:bg-background focus:border-border focus:outline-none placeholder:text-muted-foreground/50 transition-colors"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {entries.length === 0 ? (
        <HotkeyEmptyState hotkey={hotkey} />
      ) : filteredEntries.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground p-10">
          <Search className="w-10 h-10 opacity-20" strokeWidth={1.2} />
          <p className="text-sm">No results found</p>
          <p className="text-xs opacity-60">Try a different search term</p>
        </div>
      ) : (
        <div className="flex-1 relative overflow-hidden">
          {/* Top fade */}
          <div className="absolute top-0 left-0 right-0 h-8 z-10 pointer-events-none bg-gradient-to-b from-background/60 dark:from-background/30 to-transparent" />
          {/* Bottom fade */}
          <div className="absolute bottom-0 left-0 right-0 h-10 z-10 pointer-events-none bg-gradient-to-t from-background/60 dark:from-background/30 to-transparent" />

        <ScrollArea className="h-full">
          <div className="px-7 py-5 [-webkit-app-region:no-drag]">
            <div className="space-y-6">
              {visibleGroups.map((group) => (
                <Well key={group.label}>
                  <WellHeader>
                    <WellTitle>{group.label}</WellTitle>
                  </WellHeader>
                  <WellCard>
                    {group.items.map((entry) => (
                      <AudioEntryItem
                        key={entry.id}
                        entry={entry}
                        blobUrlsRef={blobUrlsRef}
                        searchQuery={searchQuery.trim()}
                        onCopy={onCopy}
                        onDelete={onDelete}
                        onRetry={onRetry}
                      />
                    ))}
                  </WellCard>
                </Well>
              ))}

              {hiddenGroupCount > 0 && (
                <button
                  onClick={() => setVisibleDays(d => d + LOAD_MORE_STEP)}
                  className="w-full py-2.5 rounded-xl border border-dashed border-border/50 text-[13px] text-muted-foreground hover:text-foreground hover:border-border hover:bg-accent/30 transition-all"
                >
                  Load more — {hiddenGroupCount} older day{hiddenGroupCount !== 1 ? 's' : ''}
                </button>
              )}
            </div>
          </div>
        </ScrollArea>
        </div>
      )}

    </div>
    </AudioPlayerProvider>
  );
}
