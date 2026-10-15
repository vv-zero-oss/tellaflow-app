import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, Brain, Check, CircleAlert, Hand, Loader2, Square, Wrench, X, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Well, WellCard } from '@/components/ui/well';
import { useAssistant } from '@/hooks/use-assistant';
import { ipc, type AssistantRun, type AssistantStep } from '@/lib/ipc';
import { cn } from '@/lib/utils';

const EXAMPLES = [
  'Open Safari and go to news.ycombinator.com',
  'Turn on dark mode and set volume to 30',
  'Remind me to call Sam tomorrow at 10am',
  'What is playing in Spotify?',
];

const PROVIDER_NAMES: Record<string, string> = { claude: 'Claude', codex: 'ChatGPT (Codex)', gemini: 'Gemini', ollama: 'Ollama' };

function formatArgs(args: Record<string, unknown>) {
  const entries = Object.entries(args || {});
  if (!entries.length) return '';
  return entries.map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' · ');
}

function formatOutput(v: unknown) {
  if (v == null) return '';
  return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
}

function StepRow({ step, run, onApprove }: { step: AssistantStep; run: AssistantRun; onApprove: (actionId: number, ok: boolean) => void }) {
  if (step.type === 'thought') {
    return (
      <div className="flex gap-2.5 text-[13px] text-muted-foreground">
        <Brain className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <p className="italic">{step.text}</p>
      </div>
    );
  }
  if (step.type === 'action') {
    return (
      <div className="flex gap-2.5 text-[13px]">
        <Wrench className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
        <div className="min-w-0">
          <p>
            <code className="font-mono text-[12px] rounded bg-accent/60 px-1 py-px">{step.tool}</code>
            {step.readOnly && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">read-only</span>}
          </p>
          {formatArgs(step.args) && !step.preview && <p className="text-xs text-muted-foreground mt-0.5 break-words">{formatArgs(step.args)}</p>}
          {step.preview && (
            <pre className="mt-1.5 max-h-48 overflow-auto rounded-md border border-border/60 bg-background/70 p-2 text-[11px] font-mono whitespace-pre-wrap">{step.preview}</pre>
          )}
        </div>
      </div>
    );
  }
  if (step.type === 'approval') {
    if (step.status !== 'pending') {
      return (
        <div className={cn('flex gap-2.5 text-xs', step.status === 'approved' ? 'text-muted-foreground' : 'text-destructive')}>
          <Hand className="w-3.5 h-3.5 shrink-0" />
          <p>{step.status === 'approved' ? 'You approved this action.' : 'You denied this action.'}</p>
        </div>
      );
    }
    // Hide the prompt once a later approval record resolved it.
    const resolved = run.steps.some((s) => s.type === 'approval' && s.actionId === step.actionId && s.status !== 'pending');
    if (resolved) return null;
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[13px]">
        <Hand className="w-3.5 h-3.5 shrink-0 text-amber-500" />
        <p className="flex-1">
          Allow <code className="font-mono text-[12px]">{step.tool}</code>?
          {step.tool === 'run_applescript' && <span className="text-muted-foreground"> Review the script above first.</span>}
        </p>
        {run.status === 'running' && (
          <>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onApprove(step.actionId, false)}>
              <X className="w-3 h-3 mr-1" /> Deny
            </Button>
            <Button size="sm" className="h-7 text-xs" onClick={() => onApprove(step.actionId, true)}>
              <Check className="w-3 h-3 mr-1" /> Allow
            </Button>
          </>
        )}
      </div>
    );
  }
  if (step.type === 'result') {
    return (
      <div className={cn('flex gap-2.5 text-xs', step.ok ? 'text-muted-foreground' : 'text-destructive')}>
        {step.ok ? <Check className="w-3.5 h-3.5 shrink-0 text-emerald-500" /> : <CircleAlert className="w-3.5 h-3.5 shrink-0" />}
        <pre className="whitespace-pre-wrap break-words font-sans max-h-32 overflow-auto">{step.ok ? formatOutput(step.output) : step.error}</pre>
      </div>
    );
  }
  if (step.type === 'final') {
    return (
      <div className="flex gap-2.5 text-sm">
        <Sparkles className="w-3.5 h-3.5 mt-1 shrink-0 text-primary" />
        <p className="whitespace-pre-wrap">{step.text}</p>
      </div>
    );
  }
  return (
    <div className="flex gap-2.5 text-[13px] text-destructive">
      <CircleAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <p>{step.text}</p>
    </div>
  );
}

function RunCard({ run, onApprove, onCancel }: { run: AssistantRun; onApprove: (runId: string, actionId: number, ok: boolean) => void; onCancel: (runId: string) => void }) {
  return (
    <Well>
      <WellCard className="p-4">
        <div className="flex items-start gap-3">
          <p className="flex-1 text-sm font-medium">{run.request}</p>
          <span className="text-[11px] text-muted-foreground shrink-0">
            {run.source === 'voice' ? 'voice · ' : ''}
            {run.provider ? PROVIDER_NAMES[run.provider] : ''}
          </span>
          {run.status === 'running' && (
            <Button size="icon" variant="ghost" className="h-6 w-6" title="Stop" onClick={() => onCancel(run.id)}>
              <Square className="w-3 h-3" />
            </Button>
          )}
        </div>
        <div className="mt-3 space-y-2.5 border-l border-dashed border-border pl-3">
          {run.steps.map((s) => (
            <StepRow key={s.id} step={s} run={run} onApprove={(actionId, ok) => onApprove(run.id, actionId, ok)} />
          ))}
          {run.status === 'running' && !run.steps.some((s) => s.type === 'approval' && s.status === 'pending' && !run.steps.some((x) => x.type === 'approval' && x.actionId === s.actionId && x.status !== 'pending')) && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Thinking…
            </div>
          )}
        </div>
      </WellCard>
    </Well>
  );
}

export function AssistantPage({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const { runs, providers, settings, refreshProviders, start, approve, cancel } = useAssistant();
  // The key that sends speech to the assistant (Settings → General → Command key).
  const [commandKey, setCommandKey] = useState('Right ⌥');
  useEffect(() => {
    ipc?.getConfig?.().then((c) => { if (c.commandHotkey?.label) setCommandKey(c.commandHotkey.label); }).catch(() => {});
  }, []);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { refreshProviders(); }, [refreshProviders]);

  const available = providers?.filter((p) => p.available) || [];
  const active = settings?.provider && settings.provider !== 'auto'
    ? providers?.find((p) => p.id === settings.provider)
    : available[0];

  const submit = async () => {
    const text = input.trim();
    if (!text) return;
    setError('');
    try {
      await start(text);
      setInput('');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="px-7 pt-12 pb-3 [-webkit-app-region:drag]">
        <h2 className="text-xl font-bold tracking-tight">Assistant</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Type below, or hold <kbd className="font-mono text-foreground">{commandKey}</kbd> anywhere and speak.
          Your signed-in AI plans each step; Tellaflow runs it on this Mac and asks before changing anything.
        </p>
      </div>

      <div className="px-7 [-webkit-app-region:no-drag]">
        <div className="rounded-xl border border-border/70 bg-card focus-within:border-primary/60 transition-colors">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder="What should I do? e.g. “Create a note called Groceries with eggs and milk”"
            className="w-full resize-none bg-transparent px-3.5 pt-3 text-sm outline-none placeholder:text-muted-foreground/60"
          />
          <div className="flex items-center justify-between px-3 pb-2.5">
            <span className="text-[11px] text-muted-foreground">
              {providers === null
                ? 'Checking for signed-in AI…'
                : active?.available
                  ? <>Using <strong className="text-foreground">{PROVIDER_NAMES[active.id]}</strong> · no API key needed</>
                  : <>No AI found — <button className="underline" onClick={onOpenSettings}>set one up</button></>}
            </span>
            <Button size="icon" className="h-7 w-7 rounded-full" disabled={!input.trim()} onClick={submit} title="Run">
              <ArrowUp className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
        {error && <p className="text-xs text-destructive mt-2">{error}</p>}
      </div>

      <ScrollArea className="flex-1 mt-4">
        <div className="px-7 pb-6 space-y-4 [-webkit-app-region:no-drag]">
          {runs.length === 0 ? (
            <div className="pt-6 text-center">
              <p className="text-xs text-muted-foreground mb-3">Try</p>
              <div className="flex flex-wrap justify-center gap-2">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => { setInput(ex); inputRef.current?.focus(); }}
                    className="rounded-full border border-border/60 px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            runs.map((run) => <RunCard key={run.id} run={run} onApprove={approve} onCancel={cancel} />)
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
