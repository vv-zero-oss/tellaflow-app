import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ipc, type MeetingState } from '@/lib/ipc';

/** Shown while automatic meeting notes are recording. */
export function MeetingBanner() {
  const [state, setState] = useState<MeetingState | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!ipc?.getMeetingState) return;
    ipc.getMeetingState().then(setState).catch(() => {});
    return ipc.onMeetingState?.(setState);
  }, []);

  useEffect(() => {
    if (!state?.active) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [state?.active]);

  if (!state?.active) return null;
  const secs = state.since ? Math.max(0, Math.floor((Date.now() - state.since) / 1000)) : 0;
  const elapsed = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

  return (
    <div className="mx-7 mt-3 flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 [-webkit-app-region:no-drag]">
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
      </span>
      <p className="flex-1 text-[13px]">
        Taking meeting notes{state.app ? <> — <strong>{state.app}</strong></> : null} · <span className="tabular-nums">{elapsed}</span>
        <span className="text-muted-foreground"> · transcribed on this Mac every ~30 s</span>
      </p>
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => ipc.stopMeetingNotes().then(setState)}>
        Stop
      </Button>
    </div>
  );
}
