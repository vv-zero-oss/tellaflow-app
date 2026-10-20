import { AlertCircle, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import type { AssistantRuntimeStatus } from '@/lib/ipc';

/** Measured: Node's tarball (~50 MB) plus bb's locked packages (~55 MB). */
export const ASSISTANT_DOWNLOAD_SIZE = 'about 110 MB';

const pct = (p: { received: number; total: number | null }) => (p.total ? p.received / p.total : 0);

/** One bar across every step of the download, and what it is doing now. */
function progressOf(runtime: AssistantRuntimeStatus): { value: number; label: string } {
  const p = runtime.progress;
  if (!p) return { value: 2, label: 'Starting…' };
  switch (p.phase) {
    case 'node': return { value: 2 + pct(p) * 48, label: `Downloading Node${p.total ? ` — ${Math.round(pct(p) * 100)}%` : '…'}` };
    case 'bb': return { value: 70, label: 'Installing the assistant (bb)…' };
    case 'verify': return { value: 92, label: 'Checking it works…' };
    case 'helper': return { value: 94 + pct(p) * 6, label: `Downloading the desktop helper${p.total ? ` — ${Math.round(pct(p) * 100)}%` : '…'}` };
  }
}

/**
 * The Download button for everything the assistant runs on: Node, bb and (on
 * a Mac) the desktop helper. Nothing of it ships in the app — it is fetched
 * once the assistant is switched on.
 */
export function AssistantDownload({ runtime, onInstall }: { runtime: AssistantRuntimeStatus; onInstall: () => void }) {
  const outdated = runtime.state === 'outdated';
  if (!runtime.supported) {
    return <p className="text-xs text-muted-foreground">The assistant isn’t available on this computer.</p>;
  }
  if (runtime.installing) {
    const { value, label } = progressOf(runtime);
    return (
      <div className="space-y-2" data-testid="assistant-download-progress">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
          <span>{label}</span>
        </div>
        <Progress value={value} className="h-1.5" />
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <span className="text-sm">{outdated ? 'Update available' : 'Download the assistant'}</span>
        {runtime.error ? (
          <p className="flex items-start gap-1.5 text-xs text-destructive mt-0.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
            <span className="break-words min-w-0">The download failed: {runtime.error}</span>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground/60 mt-0.5">
            {outdated
              ? `This version of Tellaflow uses bb ${runtime.want.bb}. Download it to keep the assistant up to date (${ASSISTANT_DOWNLOAD_SIZE}).`
              : `The assistant runs on bb and its own copy of Node, downloaded once (${ASSISTANT_DOWNLOAD_SIZE}). Nothing else to install.`}
          </p>
        )}
      </div>
      <Button size="sm" className="shrink-0" onClick={onInstall} data-testid="assistant-download">
        <Download className="w-3.5 h-3.5" />
        {runtime.error ? 'Try again' : outdated ? 'Update' : 'Download'}
      </Button>
    </div>
  );
}

/** The Assistant page before there is anything to run: the same download. */
export function AssistantNotReady({ runtime, onInstall }: { runtime: AssistantRuntimeStatus; onInstall: () => void }) {
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="px-7 pt-12 pb-3 [-webkit-app-region:drag]">
        <h2 className="text-xl font-bold tracking-tight">Assistant</h2>
        <p className="text-sm text-muted-foreground mt-1">One download and the command key is ready.</p>
      </div>
      <div className="flex-1 grid place-items-center px-7 pb-12">
        <div className="w-full max-w-md rounded-xl border border-border/70 bg-card p-5">
          <AssistantDownload runtime={runtime} onInstall={onInstall} />
        </div>
      </div>
    </div>
  );
}
