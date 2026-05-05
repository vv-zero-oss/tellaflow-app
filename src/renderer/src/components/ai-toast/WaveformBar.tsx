import { useEffect, useRef } from 'react';

interface WaveformBarProps {
  color?: string;
  animated?: boolean;
  barCount?: number;
}

export function WaveformBar({ color = 'rgba(255,255,255,0.35)', animated = true, barCount = 8 }: WaveformBarProps) {
  const barsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!animated || !barsRef.current) return;

    const bars = barsRef.current.children;
    const intervals: ReturnType<typeof setInterval>[] = [];

    Array.from(bars).forEach((bar, i) => {
      const el = bar as HTMLElement;
      const animate = () => {
        const h = animated ? Math.random() * 16 + 3 : 3;
        el.style.height = `${h}px`;
      };
      animate();
      intervals.push(setInterval(animate, 120 + i * 20));
    });

    return () => intervals.forEach(clearInterval);
  }, [animated]);

  return (
    <div ref={barsRef} style={{ width: '52px', height: '22px', display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
      {Array.from({ length: barCount }).map((_, i) => (
        <span
          key={i}
          style={{
            display: 'block',
            width: '2px',
            height: animated ? '3px' : '3px',
            background: color,
            borderRadius: '1px',
            transition: 'height 0.1s ease, background 0.2s',
          }}
        />
      ))}
    </div>
  );
}
