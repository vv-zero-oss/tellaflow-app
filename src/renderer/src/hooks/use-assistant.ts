import { useCallback, useEffect, useState } from 'react';
import { ipc, type AssistantRun, type AssistantProviderStatus, type AssistantSettings } from '@/lib/ipc';

/** Assistant runs, live step updates, provider status and settings. */
export function useAssistant() {
  const [runs, setRuns] = useState<AssistantRun[]>([]);
  const [providers, setProviders] = useState<AssistantProviderStatus[] | null>(null);
  const [settings, setSettings] = useState<AssistantSettings | null>(null);

  useEffect(() => {
    if (!ipc?.assistantListRuns) return;
    ipc.assistantListRuns().then(setRuns).catch(() => {});
    ipc.assistantGetSettings().then(setSettings).catch(() => {});
    const offRun = ipc.onAssistantRun((run) => {
      setRuns((prev) => {
        const i = prev.findIndex((r) => r.id === run.id);
        if (i === -1) return [run, ...prev];
        const next = [...prev];
        // Keep locally accumulated steps if the summary is behind.
        next[i] = { ...run, steps: run.steps.length >= prev[i].steps.length ? run.steps : prev[i].steps };
        return next;
      });
    });
    const offStep = ipc.onAssistantStep(({ runId, step }) => {
      setRuns((prev) => prev.map((r) => (r.id === runId && !r.steps.some((s) => s.id === step.id) ? { ...r, steps: [...r.steps, step] } : r)));
    });
    return () => { offRun(); offStep(); };
  }, []);

  const refreshProviders = useCallback(async () => {
    setProviders(null);
    setProviders(await ipc.assistantDetect());
  }, []);

  const start = useCallback((request: string) => ipc.assistantStart(request), []);
  const approve = useCallback((runId: string, actionId: number, ok: boolean) => ipc.assistantApprove(runId, actionId, ok), []);
  const cancel = useCallback((runId: string) => ipc.assistantCancel(runId), []);
  const updateSettings = useCallback(async (patch: Partial<AssistantSettings>) => {
    setSettings(await ipc.assistantSetSettings(patch));
  }, []);

  return { runs, providers, settings, refreshProviders, start, approve, cancel, updateSettings };
}
