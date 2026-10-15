import { useCallback, useEffect, useState } from 'react';
import { Loader2, SquarePen, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { THEME_TOKENS_FOR_BB, ipc } from '@/lib/ipc';

/** This page's theme, read live: the mode and the shadcn tokens bb shares. */
function currentTheme() {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const tokens: Record<string, string> = {};
  for (const name of THEME_TOKENS_FOR_BB) {
    const v = style.getPropertyValue(`--${name}`).trim();
    if (v) tokens[name] = v;
  }
  return { theme: root.classList.contains('dark') ? ('dark' as const) : ('light' as const), tokens };
}

/** Dress bb's frame as part of the app (main runs it inside the frame). */
function styleBb() {
  return ipc.assistantStyleFrame(currentTheme()).catch(() => ({ ok: false }));
}

/**
 * The assistant's chats — bb's own app, framed.
 *
 * What the command key starts runs on the island; bigger jobs it hands to a
 * chat, and those chats (and any the user starts here) live in bb. Framing
 * bb's real app rather than drawing a chat of our own means the composer,
 * the timeline, tool output, Stop and the model picker are bb's and cannot
 * drift from it (canvas's Agent panel does the same). bb serves no
 * X-Frame-Options, and it is on another origin (127.0.0.1:<port>), so the
 * frame cannot reach this page or its bridge.
 */
export function AssistantPage({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const [commandKey, setCommandKey] = useState('Right ⌥');
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [frameKey, setFrameKey] = useState(0);

  useEffect(() => {
    ipc?.getConfig?.().then((c) => { if (c.commandHotkey?.label) setCommandKey(c.commandHotkey.label); }).catch(() => {});
  }, []);

  const open = useCallback(async (opts?: { list?: boolean }) => {
    setLoading(true);
    setError(null);
    // No argument: whatever main has for us (a chat the island just opened, or
    // the list). The Chats button asks for the list itself ('').
    const r = await ipc.assistantWorkspaceUrl(opts?.list ? '' : undefined).catch((err: Error) => ({ ok: false as const, error: err.message }));
    if (r.ok) {
      setSrc(r.url);
      setFrameKey((k) => k + 1);
    } else {
      setError(r.error);
      setLoading(false);
    }
  }, []);

  // Tellaflow's theme changes (Settings, or the system's) restyle bb live.
  useEffect(() => {
    const observer = new MutationObserver(() => { styleBb(); });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    open();
    // The island's "Open chat": show the chat the work just went into.
    // Already open: take the chat from main the same way.
    return ipc.onAssistantOpenChat(() => { open(); });
  }, [open]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="px-7 pt-12 pb-3 flex items-end justify-between gap-4 [-webkit-app-region:drag]">
        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-tight">Assistant</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Hold <kbd className="font-mono text-foreground">{commandKey}</kbd> anywhere and speak — the answer appears on the island.
            Bigger jobs land in a chat here, where you can keep talking to it.
          </p>
        </div>
        <div className="flex gap-1.5 shrink-0 [-webkit-app-region:no-drag]">
          <Button variant="outline" size="sm" onClick={() => open({ list: true })} title="Start a new chat — your chats are listed beside it">
            <SquarePen className="w-3.5 h-3.5" />
            New chat
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setFrameKey((k) => k + 1)} title="Reload">
            <RotateCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div className="relative flex-1 mx-7 mb-6 rounded-xl border border-border/70 bg-card overflow-hidden [-webkit-app-region:no-drag]">
        {src && !error && (
          <iframe
            key={frameKey}
            src={src}
            title="Assistant chats"
            data-assistant-frame=""
            className="absolute inset-0 w-full h-full border-0"
            // Covered until it wears the app's theme, so bb's own never flashes.
            onLoad={() => { styleBb().finally(() => setLoading(false)); }}
          />
        )}
        {loading && !error && (
          <div className="absolute inset-0 grid place-items-center bg-card">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Starting the assistant…
            </p>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 grid place-items-center bg-card p-8">
            <div className="max-w-md text-center space-y-3">
              <p className="text-sm">The assistant couldn't start.</p>
              <p className="text-xs text-muted-foreground break-words">{error}</p>
              <div className="flex justify-center gap-2">
                <Button size="sm" onClick={() => open({ list: true })}>Try again</Button>
                {onOpenSettings && <Button size="sm" variant="outline" onClick={onOpenSettings}>Settings</Button>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
