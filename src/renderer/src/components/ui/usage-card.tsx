/**
 * Usage card with segmented “pill” progress (Gamma UI @gammaui/usage-card).
 * Registry: https://gammaui.com — adapted for framer-motion + app theme tokens.
 */
import { useEffect, useRef, useState } from 'react';
import { animate, motion } from 'framer-motion';

export interface UsageCardProps {
  title: string;
  percentage: number;
  pillCount?: number;
  accentColor?: string;
  icon?: React.ReactNode;
  className?: string;
}

function useAnimatedCounter(target: number, duration = 1.2) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    const controls = animate(from, target, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(Math.round(v)),
      onComplete: () => {
        fromRef.current = target;
      },
    });
    return () => controls.stop();
  }, [target, duration]);

  return display;
}

function Pill({
  active,
  index,
  accent,
}: {
  active: boolean;
  index: number;
  accent: string;
}) {
  return (
    <motion.div
      initial={{ scaleY: 0.3, opacity: 0 }}
      animate={{ scaleY: 1, opacity: 1 }}
      transition={{
        delay: index * 0.04,
        duration: 0.45,
        ease: [0.16, 1, 0.3, 1],
      }}
      style={{ originY: 1, flex: 1 }}
      className="relative h-full overflow-hidden rounded-sm"
    >
      <div className="absolute inset-0 rounded-sm bg-black/5 dark:bg-white/5" />
      <motion.div
        className="absolute inset-0 rounded-sm"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: active ? 1 : 0 }}
        transition={{
          delay: index * 0.055 + 0.25,
          duration: 0.4,
          ease: [0.16, 1, 0.3, 1],
        }}
        style={{
          originX: 0,
          background: active ? `linear-gradient(90deg, ${accent}bb, ${accent})` : 'transparent',
          boxShadow: active ? `0 0 6px ${accent}99, 0 0 12px ${accent}44` : 'none',
        }}
      />
      {active && (
        <motion.div
          className="absolute inset-0 rounded-sm"
          style={{
            background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.16) 50%, transparent 100%)',
            backgroundSize: '200% 100%',
          }}
          animate={{ backgroundPositionX: ['0%', '200%'] }}
          transition={{
            repeat: Infinity,
            duration: 2,
            ease: 'linear',
            delay: index * 0.08,
          }}
        />
      )}
    </motion.div>
  );
}

export function UsageCard({
  title,
  percentage,
  pillCount = 10,
  accentColor = '#00f5ff',
  icon,
  className,
}: UsageCardProps) {
  const pct = Math.max(0, Math.min(100, percentage));
  const display = useAnimatedCounter(pct);
  const activePills = Math.round((pct / 100) * pillCount);
  const accent = pct >= 75 ? '#ff2d55' : accentColor;

  return (
    <div className={className ?? 'relative w-full max-w-full select-none'}>
      <div
        className="pointer-events-none absolute -inset-px rounded-2xl opacity-20 blur-sm dark:opacity-30"
        style={{
          background: `linear-gradient(135deg, ${accent}66, transparent 60%)`,
        }}
      />
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-xxl" style={{ boxShadow: 'var(--card-shadow)' }}>
        <div className="flex flex-col gap-3 p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
              {icon}
              <span className="truncate text-[11px] font-semibold uppercase tracking-widest">{title}</span>
            </div>
            <div className="flex shrink-0 items-baseline gap-0.5">
              <motion.span
                className="text-xl font-semibold leading-none tabular-nums"
                style={{ color: accent, textShadow: `0 0 12px ${accent}88` }}
              >
                {display}
              </motion.span>
              <span className="text-[10px] text-muted-foreground">%</span>
            </div>
          </div>
          <div className="flex gap-1" style={{ height: 28 }}>
            {Array.from({ length: pillCount }).map((_, i) => (
              <Pill key={i} index={i} active={i < activePills} accent={accent} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
