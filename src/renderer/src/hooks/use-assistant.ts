import { useCallback, useEffect, useState } from 'react';
import {
  ipc,
  type AssistantBackendStatus,
  type AssistantDesktopStatus,
  type AssistantProvider,
  type AssistantSettings,
} from '@/lib/ipc';

/** The assistant's settings, bb's providers, and the desktop helper's state. */
export function useAssistant() {
  const [settings, setSettings] = useState<AssistantSettings | null>(null);
  const [providers, setProviders] = useState<AssistantProvider[] | null>(null);
  const [backend, setBackend] = useState<AssistantBackendStatus | null>(null);
  const [desktop, setDesktop] = useState<AssistantDesktopStatus | null>(null);
  const [installing, setInstalling] = useState<{ received: number; total: number | null } | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  useEffect(() => {
    if (!ipc?.assistantGetSettings) return;
    ipc.assistantGetSettings().then(setSettings).catch(() => {});
    ipc.assistantStatus().then((s) => setBackend(s.backend)).catch(() => {});
    const offs = [
      ipc.onAssistantStatus(setBackend),
      ipc.onAssistantHelperProgress((p) => setInstalling(p)),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  const refreshProviders = useCallback(async () => {
    setProviders(null);
    try { setProviders(await ipc.assistantProviders()); } catch { setProviders([]); }
  }, []);

  const refreshDesktop = useCallback(async () => {
    try { setDesktop(await ipc.assistantDesktopStatus()); } catch { setDesktop(null); }
  }, []);

  const updateSettings = useCallback(async (patch: Partial<AssistantSettings>) => {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    setSettings(await ipc.assistantSetSettings(patch));
  }, []);

  const installHelper = useCallback(async () => {
    setInstallError(null);
    setInstalling({ received: 0, total: null });
    const r = await ipc.assistantInstallHelper();
    setInstalling(null);
    if (!r.ok) setInstallError(r.error ?? 'The download failed.');
    await refreshDesktop();
  }, [refreshDesktop]);

  const requestAccessibility = useCallback(async () => {
    await ipc.assistantRequestAccessibility();
    await refreshDesktop();
  }, [refreshDesktop]);

  return {
    settings,
    providers,
    backend,
    desktop,
    installing,
    installError,
    refreshProviders,
    refreshDesktop,
    updateSettings,
    installHelper,
    requestAccessibility,
  };
}
