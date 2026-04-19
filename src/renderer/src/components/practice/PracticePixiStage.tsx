import { useEffect, useRef } from 'react';
import type { Application, Graphics } from 'pixi.js';

export type PracticePixiBurst = 'none' | 'pass' | 'fail';

type Props = {
  /** 0..1 RMS-ish level while listening */
  audioLevel: number;
  burst: PracticePixiBurst;
  reduceMotion: boolean;
  /** Tailwind height class for the stage (default full practice height). */
  heightClass?: string;
};

/**
 * PixiJS layer: listening bars + simple burst particles (game plan).
 */
export function PracticePixiStage({ audioLevel, burst, reduceMotion, heightClass = 'h-[120px]' }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const barsRef = useRef<Graphics | null>(null);
  const burstGRef = useRef<Graphics | null>(null);
  const burstFramesRef = useRef(0);
  const roRef = useRef<ResizeObserver | null>(null);
  const levelRef = useRef(0);
  const burstKindRef = useRef<PracticePixiBurst>('none');
  levelRef.current = audioLevel;
  burstKindRef.current = burst;

  useEffect(() => {
    if (burst === 'pass' || burst === 'fail') {
      burstFramesRef.current = 30;
    }
  }, [burst]);

  useEffect(() => {
    if (reduceMotion) return;
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;

    void (async () => {
      const { Application: App, Graphics: G } = await import('pixi.js');
      if (cancelled || !hostRef.current) return;

      const app = new App();
      await app.init({
        width: Math.max(280, host.clientWidth),
        height: 120,
        backgroundAlpha: 0,
        antialias: true,
        resolution: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
        autoDensity: true,
      });
      if (cancelled) {
        app.destroy(true);
        return;
      }

      host.innerHTML = '';
      host.appendChild(app.canvas as HTMLCanvasElement);
      appRef.current = app;

      const bars = new G();
      const burstG = new G();
      barsRef.current = bars;
      burstGRef.current = burstG;
      app.stage.addChild(burstG);
      app.stage.addChild(bars);

      const ro = new ResizeObserver(() => {
        if (!hostRef.current || !app.renderer) return;
        const w = Math.max(280, hostRef.current.clientWidth);
        app.renderer.resize(w, 120);
      });
      ro.observe(host);
      roRef.current = ro;

      app.ticker.add(() => {
        const b = barsRef.current;
        if (!b || !app.renderer) return;
        b.clear();
        const w = app.renderer.width;
        const n = 28;
        const gap = 3;
        const bw = (w - gap * (n + 1)) / n;
        const baseH = 8;
        const lvl = Math.min(1, Math.max(0, levelRef.current));
        for (let i = 0; i < n; i++) {
          const x = gap + i * (bw + gap);
          const jitter = 0.65 + 0.35 * Math.sin(app.ticker.lastTime * 0.004 + i * 0.4);
          const h = baseH + lvl * 72 * jitter * (0.5 + (i % 5) / 10);
          b.roundRect(x, 110 - h, bw, h, 2);
          b.fill({ color: 0x1cb0f6, alpha: 0.45 + lvl * 0.45 });
        }

        const br = burstGRef.current;
        const kind = burstKindRef.current;
        if (br && burstFramesRef.current > 0) {
          br.clear();
          const t = burstFramesRef.current;
          const col = kind === 'pass' ? 0x58cc02 : 0xff5555;
          for (let k = 0; k < 18; k++) {
            const ang = (k / 18) * Math.PI * 2 + t * 0.08;
            const r = 6 + (30 - t) * 1.2;
            const px = w / 2 + Math.cos(ang) * r * 0.6;
            const py = 55 + Math.sin(ang) * r * 0.35;
            br.circle(px, py, 3 + (t % 5) * 0.15);
            br.fill({ color: col, alpha: t / 30 });
          }
          burstFramesRef.current -= 1;
        } else if (br) {
          br.clear();
        }
      });
    })();

    return () => {
      cancelled = true;
      roRef.current?.disconnect();
      roRef.current = null;
      const a = appRef.current;
      if (a) {
        a.destroy(true);
        appRef.current = null;
      }
      barsRef.current = null;
      burstGRef.current = null;
      if (hostRef.current) hostRef.current.innerHTML = '';
    };
  }, [reduceMotion]);

  if (reduceMotion) {
    return (
      <div
        className={`flex w-full min-w-0 select-none items-end justify-center gap-0.5 rounded-[inherit] bg-card px-2 pb-2 pt-4 shadow-xxl ${heightClass}`}
        style={{ boxShadow: 'var(--card-shadow)' }}
      >
        {Array.from({ length: 20 }).map((_, i) => {
          const h = 10 + audioLevel * 60 * (0.6 + (i % 4) * 0.1);
          return (
            <div
              key={i}
              className="w-1.5 rounded-sm"
              style={{
                height: h,
                opacity: 0.4 + audioLevel * 0.5,
                background: '#f97316',
              }}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div
      ref={hostRef}
      className={`w-full min-w-0 overflow-hidden rounded-[inherit] bg-card shadow-xxl ${heightClass}`}
      style={{ boxShadow: 'var(--card-shadow)' }}
    />
  );
}
