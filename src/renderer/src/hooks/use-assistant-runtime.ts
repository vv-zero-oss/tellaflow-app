import { useCallback, useEffect, useState } from 'react';
import { ipc, type AssistantRuntimeStatus } from '@/lib/ipc';

/**
 * Whether the assistant is on, and whether what it runs on (Node + bb) is
 * downloaded — the switch and the Download button in Settings › Assistant, and
 * what the sidebar and the command key setting follow.
 */
export function useAssistantRuntime() {
  const [runtime, setRuntime] = useState<AssistantRuntimeStatus | null>(null);

  useEffect(() => {
    if (!ipc?.assistantRuntimeStatus) return;
    ipc.assistantRuntimeStatus().then(setRuntime).catch(() => {});
    return ipc.onAssistantRuntime(setRuntime);
  }, []);

  const setEnabled = useCallback(async (enabled: boolean) => {
    setRuntime((prev) => (prev ? { ...prev, enabled, ready: enabled && prev.state !== 'missing' } : prev));
    await ipc.assistantSetSettings({ enabled });
    setRuntime(await ipc.assistantRuntimeStatus());
  }, []);

  const install = useCallback(async () => {
    setRuntime((prev) => (prev ? { ...prev, installing: true, error: null, progress: { phase: 'node', received: 0, total: null } } : prev));
    await ipc.assistantRuntimeInstall();
    setRuntime(await ipc.assistantRuntimeStatus());
  }, []);

  const remove = useCallback(async () => {
    await ipc.assistantRuntimeRemove();
    setRuntime(await ipc.assistantRuntimeStatus());
  }, []);

  return { runtime, setEnabled, install, remove };
}
