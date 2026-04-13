import { useState, useEffect, useCallback, useRef } from 'react';
import { ipc } from '@/lib/ipc';

export function usePermissions() {
  const [mic, setMic] = useState(false);
  const [accessibility, setAccessibility] = useState(false);
  const [needsRestart, setNeedsRestart] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    const [m, a, r] = await Promise.all([
      ipc.checkMicPermission(),
      ipc.checkAccessibility(),
      ipc.checkNeedsRestart(),
    ]);
    setMic(m);
    setAccessibility(a);
    setNeedsRestart(r);
  }, []);

  useEffect(() => {
    refresh();
    const cleanups = [
      ipc.onShowRestartBanner(() => {
        setNeedsRestart(true);
        refresh();
      }),
      ipc.onAccessibilityGranted(() => {
        setNeedsRestart(true);
        refresh();
      }),
    ];
    return () => cleanups.forEach(fn => fn?.());
  }, [refresh]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(refresh, 5000);
  }, [refresh]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const grantMic = useCallback(async () => {
    const granted = await ipc.grantMic();
    if (granted) setMic(true);
    return granted;
  }, []);

  const grantAccessibility = useCallback(() => {
    ipc.grantAccessibility();
  }, []);

  const retryHotkey = useCallback(() => {
    ipc.retryHotkey();
  }, []);

  const restartApp = useCallback(() => {
    ipc.restartApp();
  }, []);

  return {
    mic,
    accessibility,
    needsRestart,
    refresh,
    startPolling,
    stopPolling,
    grantMic,
    grantAccessibility,
    retryHotkey,
    restartApp,
  };
}
