import { useCallback, useEffect, useState } from 'react';
import type { DictionaryPackCatalogItem } from '@/lib/ipc';

/** Preload is only loaded when Electron starts; read live API from window (not a stale module snapshot). */
function packsApi() {
  if (typeof window === 'undefined') return null;
  const api = window.tellaflow;
  if (!api || typeof api.getDictionaryPacksCatalog !== 'function') return null;
  return api;
}

const RESTART_HINT =
  'Quit the app completely and start it again (npm run dev). Preset packs use an updated preload script, which Electron only loads on a cold start.';

export function useDictionaryPacks() {
  const [packs, setPacks] = useState<DictionaryPackCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const api = packsApi();
      if (!api) {
        setError(RESTART_HINT);
        setPacks([]);
        return;
      }
      const list = await api.getDictionaryPacksCatalog();
      setPacks(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load packs');
      setPacks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.dictionary) refresh();
    };
    window.addEventListener('tellaflow:data-reset', handler);
    return () => window.removeEventListener('tellaflow:data-reset', handler);
  }, [refresh]);

  const installPack = useCallback(
    async (packId: string) => {
      const api = packsApi();
      if (!api || typeof api.installDictionaryPack !== 'function') {
        setError(RESTART_HINT);
        return;
      }
      await api.installDictionaryPack(packId);
      await refresh();
    },
    [refresh],
  );

  const uninstallPack = useCallback(
    async (packId: string) => {
      const api = packsApi();
      if (!api || typeof api.uninstallDictionaryPack !== 'function') {
        setError(RESTART_HINT);
        return;
      }
      await api.uninstallDictionaryPack(packId);
      await refresh();
    },
    [refresh],
  );

  return { packs, loading, error, refresh, installPack, uninstallPack };
}
