import { useEffect, useState } from 'react';
import { ipc, type ModelLoadState } from '@/lib/ipc';

// Model loads report no real progress, so this eases toward 95% over the
// expected duration (last measured load time) and snaps to 100% when done.
export function loadProgress(elapsedMs: number, expectedMs: number): number {
  const t = Math.max(0, elapsedMs) / Math.max(1, expectedMs);
  return Math.min(95, 95 * (1 - Math.exp(-2.5 * t)));
}

export function useModelLoad() {
  const [state, setState] = useState<ModelLoadState>({ loading: false });
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!ipc?.onModelLoadState) return;
    ipc.getModelLoadState?.().then(setState).catch(() => {});
    return ipc.onModelLoadState(setState);
  }, []);

  useEffect(() => {
    if (state.loading) {
      setVisible(true);
      const tick = () => setProgress(loadProgress(Date.now() - state.startedAt, state.expectedMs));
      tick();
      const id = setInterval(tick, 100);
      return () => clearInterval(id);
    }
    if (!visible) return;
    // Finished: show the full bar briefly before hiding it.
    setProgress(state.ok ? 100 : 0);
    const id = setTimeout(() => { setVisible(false); setProgress(0); }, 600);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return { loading: visible, engine: state.engine, progress: Math.round(progress) };
}
