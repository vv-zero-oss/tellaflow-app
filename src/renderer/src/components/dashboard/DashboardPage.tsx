import { useMemo, useEffect, useRef, useState } from 'react';
import { motion, type Variants } from 'framer-motion';
import { useHistory } from '@/hooks/use-history';
import { useConfig } from '@/hooks/use-config';

/* ── helpers ───────────────────────────────────────────────────────── */

function toDateKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function wordCount(text: string) {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

function formatTime(mins: number) {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/* ── count-up hook ─────────────────────────────────────────────────── */

function useCountUp(target: number, duration = 900) {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>(0);
  useEffect(() => {
    const start = performance.now();
    function tick(now: number) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);
  return value;
}

/* ── card entrance variants ────────────────────────────────────────── */

const card = {
  hidden: { opacity: 0, y: 18 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.36, ease: 'easeOut', delay: i * 0.065 },
  }),
} as Variants;

/* ── donut ring ────────────────────────────────────────────────────── */

function DonutRing({ pct, stroke }: { pct: number; stroke: string }) {
  const r = 26;
  const circ = 2 * Math.PI * r;
  const filled = (Math.min(pct, 100) / 100) * circ;
  return (
    <svg width="68" height="68" viewBox="0 0 68 68" className="shrink-0">
      <circle cx="34" cy="34" r={r} fill="none" stroke="currentColor" strokeWidth="7" className="text-border" />
      <motion.circle
        cx="34" cy="34" r={r}
        fill="none"
        stroke={stroke}
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circ}`}
        transform="rotate(-90 34 34)"
        initial={{ strokeDasharray: `0 ${circ}` }}
        animate={{ strokeDasharray: `${filled} ${circ}` }}
        transition={{ duration: 1.1, ease: 'easeOut', delay: 0.3 }}
      />
    </svg>
  );
}

/* ── hero "words today" card ───────────────────────────────────────── */

function HeroCard({ wordsToday, avgPerDay, goal = 500 }: { wordsToday: number; avgPerDay: number; goal?: number }) {
  const animWords = useCountUp(wordsToday, 1100);
  const pct = Math.min(Math.round((wordsToday / goal) * 100), 100);
  const diffPct = avgPerDay > 0 ? Math.round(((wordsToday - avgPerDay) / avgPerDay) * 100) : 0;
  const isUp = diffPct >= 0;

  return (
    <motion.div
      custom={0} variants={card} initial="hidden" animate="show"
      className="bg-card rounded-lg p-5 select-none shadow-xxl"
    >
      <div className="flex items-start justify-between gap-4">
        {/* left */}
        <div className="flex flex-col gap-1 min-w-0">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">Today's Voice Flow</div>
          <div className="text-[48px] font-black leading-none text-foreground tabular-nums">
            {animWords.toLocaleString()}
          </div>
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Words</div>

          <div className="flex flex-col gap-1 mt-2">
            {/* vs avg */}
            <div className="flex items-center gap-1.5">
              {isUp ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 11V3M7 3L3 7M7 3L11 7" stroke="#22c55e" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 3V11M7 11L3 7M7 11L11 7" stroke="#ef4444" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
              <span className="text-[13px] font-bold" style={{ color: isUp ? '#22c55e' : '#ef4444' }}>
                {Math.abs(diffPct)}%
              </span>
              <span className="text-[11px] text-muted-foreground">{isUp ? 'above' : 'below'} avg</span>
            </div>
            {/* avg/day */}
            <div className="flex items-center gap-1.5">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 7h2M4 7l2-3 2 4 2-2 2 1" stroke="#f59e0b" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="text-[13px] font-bold" style={{ color: '#f59e0b' }}>
                {avgPerDay.toLocaleString()}
              </span>
              <span className="text-[11px] text-muted-foreground">avg / day</span>
            </div>
          </div>
        </div>

        {/* right — donut */}
        <div className="flex flex-col items-center gap-1 shrink-0">
          <div className="relative">
            <DonutRing pct={pct} stroke={pct >= 100 ? '#22c55e' : '#f97316'} />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[13px] font-black text-foreground">{pct}%</span>
            </div>
          </div>
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Goal</span>
        </div>
      </div>
    </motion.div>
  );
}

/* ── streak card (solid accent color) ─────────────────────────────── */

function StreakCard({ streak }: { streak: number }) {
  const animStreak = useCountUp(streak, 700);
  return (
    <motion.div
      custom={1} variants={card} initial="hidden" animate="show"
      className="rounded-lg p-4 select-none flex flex-col justify-between shadow-xxl"
      style={{ background: '#EDFF47', minHeight: 130 }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-bold text-black/80">Daily Streak</span>
        <picture>
          <source srcSet={`${import.meta.env.BASE_URL}emojis/fire.webp`} type="image/webp" />
          <img src={`${import.meta.env.BASE_URL}emojis/fire.gif`} alt="🔥" width="32" height="32" />
        </picture>
      </div>
      <div className="flex flex-col gap-0.5 mt-2">
        <div className="text-[40px] font-black leading-none text-black tabular-nums">{animStreak}</div>
        <div className="text-[11px] font-semibold text-black/50 uppercase tracking-widest">
          {streak === 1 ? 'day' : 'days'}
        </div>
      </div>
      {/* barcode stripe at bottom */}
      <div className="mt-3 flex items-end gap-[2px] h-6 overflow-hidden rounded-sm">
        {Array.from({ length: 28 }).map((_, i) => (
          <div
            key={i}
            className="flex-1 rounded-[1px]"
            style={{
              height: `${40 + Math.sin(i * 1.3) * 40}%`,
              background: 'rgba(0,0,0,0.25)',
            }}
          />
        ))}
      </div>
    </motion.div>
  );
}

/* ── small metric card ─────────────────────────────────────────────── */

function MetricCard({
  index, label, value, sub, accentColor, icon,
}: {
  index: number;
  label: string;
  value: string | number;
  sub: string;
  accentColor: string;
  icon: React.ReactNode;
}) {
  return (
    <motion.div
      custom={index} variants={card} initial="hidden" animate="show"
      className="bg-card rounded-lg p-4 select-none flex flex-col gap-3 shadow-xxl"
    >
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold text-muted-foreground uppercase tracking-widest">{label}</span>
        <span className="text-base">{icon}</span>
      </div>
      <div>
        <div className="text-[30px] font-black leading-none tabular-nums" style={{ color: accentColor }}>
          {value}
        </div>
        <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>
      </div>
    </motion.div>
  );
}

/* ── bar chart (orange → pink → purple, like image 4) ─────────────── */

const BAR_COLORS = [
  '#f97316', // orange
  '#fb923c', // lighter orange
  '#f472b6', // pink
  '#c084fc', // purple
  '#a78bfa', // violet
  '#818cf8', // indigo
  '#60a5fa', // blue
];

const BAR_MAX_PX = 56;

function WeeklyBarChart({ data, labels }: { data: number[]; labels: string[] }) {
  const max = Math.max(...data, 1);
  return (
    <div className="flex items-end gap-2 h-20 w-full">
      {data.map((v, i) => {
        const heightPx = Math.max((v / max) * BAR_MAX_PX, v > 0 ? 6 : 2);
        const isToday = i === data.length - 1;
        const color = v > 0 ? BAR_COLORS[i % BAR_COLORS.length] : undefined;
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
            <motion.div
              className="w-full rounded-t-lg"
              style={{ background: color ?? 'var(--color-border)' }}
              initial={{ height: 0 }}
              animate={{ height: heightPx }}
              transition={{ duration: 0.5, ease: 'easeOut', delay: 0.25 + i * 0.05 }}
            />
            <span
              className="text-[9px] font-semibold uppercase tracking-wide"
              style={{ color: isToday ? 'var(--color-foreground)' : 'var(--color-muted-foreground)' }}
            >
              {labels[i]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── level / XP card ───────────────────────────────────────────────── */

function LevelCard({ index, xp, level, nextLevelXp }: { index: number; xp: number; level: number; nextLevelXp: number }) {
  const prevLevelXp = (level - 1) * 500;
  const pct = Math.min(((xp - prevLevelXp) / (nextLevelXp - prevLevelXp)) * 100, 100);
  const animXp = useCountUp(xp, 950);

  return (
    <motion.div
      custom={index} variants={card} initial="hidden" animate="show"
      className="bg-card rounded-lg p-4 select-none flex flex-col gap-3 shadow-xxl"
      style={{ boxShadow: 'var(--card-shadow)' }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold text-muted-foreground uppercase tracking-widest">Level</span>
        <picture>
          <source srcSet={`${import.meta.env.BASE_URL}emojis/gold-medal.webp`} type="image/webp" />
          <img src={`${import.meta.env.BASE_URL}emojis/gold-medal.gif`} alt="🥇" width="32" height="32" />
        </picture>
      </div>

      <div className="flex items-end justify-between gap-2">
        <div>
          <div className="text-[36px] font-black leading-none text-foreground">{level}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            <span className="font-bold tabular-nums" style={{ color: '#a78bfa' }}>{animXp.toLocaleString()}</span> XP
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 pb-0.5">
          <span className="text-[10px] text-muted-foreground">Next level</span>
          <span className="text-[11px] font-bold text-foreground">{(nextLevelXp - xp).toLocaleString()} XP</span>
        </div>
      </div>

      {/* XP bar */}
      <div className="flex flex-col gap-1">
        <div className="h-2.5 rounded-full overflow-hidden bg-border">
          <motion.div
            className="h-full rounded-full"
            style={{ background: 'linear-gradient(90deg, #f97316, #f472b6, #a78bfa)' }}
            initial={{ width: '0%' }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 1.0, ease: 'easeOut', delay: 0.4 }}
          />
        </div>
        <div className="flex justify-between text-[9px] text-muted-foreground">
          <span>{xp - prevLevelXp} / {nextLevelXp - prevLevelXp}</span>
          <span>{Math.round(pct)}%</span>
        </div>
      </div>
    </motion.div>
  );
}

/* ── recent sessions list ──────────────────────────────────────────── */

function RecentSessions({ entries }: { entries: Array<{ id: number; text: string; timestamp?: string }> }) {
  const recent = entries.slice(0, 5);
  if (recent.length === 0) return null;

  return (
    <motion.div
      custom={7} variants={card} initial="hidden" animate="show"
      className="bg-card rounded-lg overflow-hidden select-none shadow-xxl"
    >
      <div className="px-4 pt-4 pb-2 flex items-center gap-2">
        <span className="text-sm">🎙️</span>
        <span className="text-[12px] font-bold text-muted-foreground uppercase tracking-widest">Recent Sessions</span>
      </div>
      <div className="divide-y divide-border">
        {recent.map((e, i) => {
          const wc = wordCount(e.text);
          const preview = e.text.length > 52 ? e.text.slice(0, 52) + '…' : e.text;
          return (
            <motion.div
              key={e.id}
              className="flex items-center justify-between px-4 py-2.5 gap-3"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.45 + i * 0.05, duration: 0.28 }}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black shrink-0"
                  style={{
                    background: BAR_COLORS[i % BAR_COLORS.length] + '22',
                    color: BAR_COLORS[i % BAR_COLORS.length],
                  }}
                >
                  {i + 1}
                </div>
                <span className="text-[12px] text-muted-foreground truncate">{preview}</span>
              </div>
              <span
                className="shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: 'var(--color-muted)', color: 'var(--color-muted-foreground)' }}
              >
                {wc}w
              </span>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

/* ── main page ─────────────────────────────────────────────────────── */

export function DashboardPage() {
  const { entries, totalWords } = useHistory();
  const { config } = useConfig();

  const todayKey = toDateKey(new Date());

  const stats = useMemo(() => {
    const todayEntries = entries.filter((e) => {
      if (!e.timestamp) return false;
      const d = new Date(e.timestamp);
      return toDateKey(d) === todayKey;
    });
    const wordsToday = todayEntries.reduce((s, e) => s + wordCount(e.text), 0);
    const sessionsToday = todayEntries.length;

    /* streak */
    const daySets = new Set(
      entries.map((e) => {
        if (!e.timestamp) return '';
        return toDateKey(new Date(e.timestamp));
      }).filter(Boolean),
    );
    let streak = 0;
    const cur = new Date();
    while (daySets.has(toDateKey(cur))) {
      streak++;
      cur.setDate(cur.getDate() - 1);
    }

    /* weekly data */
    const weekLabels: string[] = [];
    const weekData: number[] = [];
    const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = toDateKey(d);
      const dayWords = entries
        .filter((e) => {
          if (!e.timestamp) return false;
          return toDateKey(new Date(e.timestamp)) === key;
        })
        .reduce((s, e) => s + wordCount(e.text), 0);
      weekLabels.push(i === 0 ? 'Today' : dayNames[d.getDay()]);
      weekData.push(dayWords);
    }

    /* avg words per active day */
    const activeDays = weekData.filter((v) => v > 0).length || 1;
    const weekTotal = weekData.reduce((s, v) => s + v, 0);
    const avgPerDay = Math.round(weekTotal / activeDays);

    /* time saved */
    const timeSavedMins = Math.round(totalWords / 150);

    /* XP / level */
    const xp = Math.floor(totalWords / 10);
    const level = Math.floor(xp / 500) + 1;
    const nextLevelXp = level * 500;

    return { wordsToday, sessionsToday, streak, weekLabels, weekData, avgPerDay, timeSavedMins, xp, level, nextLevelXp };
  }, [entries, totalWords, todayKey]);

  const animSessions = useCountUp(stats.sessionsToday, 750);
  const animTimeSaved = useCountUp(stats.timeSavedMins, 900);
  const animTotal = useCountUp(totalWords, 1000);

  return (
    <div
      className="flex flex-col h-full overflow-y-auto bg-background"
      style={{ scrollbarWidth: 'none' }}
    >
      {/* header */}
      <motion.div
        className="px-4 pt-[50px] pb-2 flex items-center justify-between"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div>
          <h1 className="text-[16px] font-black text-foreground tracking-tight">Dashboard</h1>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full">
          <img
            src={`${import.meta.env.BASE_URL}${config.transcriptionEngine === 'parakeet' ? 'logo-nvidia.png' : 'logo-openai.png'}`}
            alt={config.transcriptionEngine === 'parakeet' ? 'Parakeet' : 'Whisper'}
            title={config.transcriptionEngine === 'parakeet' ? 'Currently using: Parakeet Model' : 'Currently using: Whisper Model'}
            className="w-8 h-8 rounded-full object-cover"
          />
        </div>
      </motion.div>

      <div className="flex flex-col gap-3 px-4 pb-4">

        {/* hero */}
        <HeroCard wordsToday={stats.wordsToday} avgPerDay={stats.avgPerDay} goal={500} />

        {/* streak + time saved + sessions */}
        <div className="grid grid-cols-3 gap-3">
          <StreakCard streak={stats.streak} />
          <MetricCard
            index={2}
            label="Time Saved"
            value={formatTime(animTimeSaved)}
            sub="at 150 wpm"
            accentColor="#22c55e"
            icon={<picture><source srcSet={`${import.meta.env.BASE_URL}emojis/racing-car.webp`} type="image/webp" /><img src={`${import.meta.env.BASE_URL}emojis/racing-car.gif`} alt="🏎" width="32" height="32" /></picture>}
          />
          <MetricCard
            index={3}
            label="Sessions"
            value={animSessions}
            sub="today"
            accentColor="#f97316"
            icon={<picture><source srcSet={`${import.meta.env.BASE_URL}emojis/rock-on.webp`} type="image/webp" /><img src={`${import.meta.env.BASE_URL}emojis/rock-on.gif`} alt="🤘" width="32" height="32" /></picture>}
          />
        </div>

        {/* weekly chart */}
        <motion.div
          custom={4} variants={card} initial="hidden" animate="show"
          className="bg-card rounded-lg p-4 select-none shadow-xxl"
        >
          <div className="flex items-center justify-between mb-1.5">
            <div>
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">Weekly Words</div>
              <div className="text-[22px] font-black text-foreground leading-tight">
                {stats.weekData.reduce((s, v) => s + v, 0).toLocaleString()}
              </div>
            </div>
          </div>
          <WeeklyBarChart data={stats.weekData} labels={stats.weekLabels} />
        </motion.div>

        {/* total words + level side by side */}
        <div className="grid grid-cols-2 gap-3">
          {/* all-time */}
          <motion.div
            custom={5} variants={card} initial="hidden" animate="show"
            className="bg-card rounded-lg p-4 select-none flex flex-col gap-2 shadow-xxl"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">All-Time</span>
              <picture>
                <source srcSet={`${import.meta.env.BASE_URL}emojis/campsite.webp`} type="image/webp" />
                <img src={`${import.meta.env.BASE_URL}emojis/campsite.gif`} alt="🏕" width="32" height="32" />
              </picture>
            </div>
            <div>
              <div className="text-[28px] font-black leading-none tabular-nums" style={{ color: '#a78bfa' }}>
                {animTotal.toLocaleString()}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5 uppercase tracking-wide font-medium">Words</div>
            </div>
            <div className="text-[11px] text-muted-foreground">
              <span className="font-bold text-foreground">{entries.length}</span> sessions total
            </div>
          </motion.div>

          {/* level */}
          <LevelCard
            index={6}
            xp={stats.xp}
            level={stats.level}
            nextLevelXp={stats.nextLevelXp}
          />
        </div>

        {/* recent sessions */}
        <RecentSessions entries={entries} />

        <div className="h-1" />
      </div>
    </div>
  );
}
