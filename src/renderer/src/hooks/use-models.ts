import { useState, useEffect, useCallback } from 'react';
import { ipc, type Models, type DownloadProgress } from '@/lib/ipc';

// Fallback models for browser preview
const FALLBACK_MODELS: Models = {
  tiny: { available: true, status: 'downloaded', downloaded: 0, total: 0, size: '75 MB', quality: 'Basic' },
  base: { available: true, status: 'downloaded', downloaded: 0, total: 0, size: '145 MB', quality: 'Fair' },
  small: { available: false, status: 'not_downloaded', downloaded: 0, total: 0, size: '460 MB', quality: 'Good' },
  medium: { available: false, status: 'not_downloaded', downloaded: 0, total: 0, size: '1.5 GB', quality: 'Great' },
  large: { available: false, status: 'not_downloaded', downloaded: 0, total: 0, size: '3 GB', quality: 'Best' },
};

export function useModels() {
  const [models, setModels] = useState<Models>({});

  const refresh = useCallback(async () => {
    if (!ipc || !ipc.getModels) {
      setModels(FALLBACK_MODELS);
      return;
    }
    const m = await ipc.getModels();
    setModels(m);
  }, []);

  useEffect(() => {
    refresh();

    if (!ipc || !ipc.onDownloadProgress) return;

    const cleanups = [
      ipc.onDownloadProgress((p: DownloadProgress) => {
        setModels(prev => ({
          ...prev,
          [p.modelKey]: {
            ...prev[p.modelKey],
            downloaded: p.downloaded,
            total: p.total,
            status: 'downloading' as const,
          },
        }));
      }),

      ipc.onModelsChanged((m: Models) => {
        if (m) setModels(m);
        else refresh();
      }),

      ipc.onDownloadError((e) => {
        setModels(prev => ({
          ...prev,
          [e.modelKey]: { ...prev[e.modelKey], status: 'not_downloaded' as const },
        }));
      }),
    ];

    return () => cleanups.forEach(fn => fn?.());
  }, [refresh]);

  const startDownload = useCallback((key: string) => {
    ipc.startDownload(key);
    setModels(prev => ({
      ...prev,
      [key]: { ...prev[key], status: 'downloading' as const, downloaded: prev[key]?.downloaded || 0 },
    }));
  }, []);

  const pauseDownload = useCallback((key: string) => {
    ipc.pauseDownload(key);
    setModels(prev => ({
      ...prev,
      [key]: { ...prev[key], status: 'paused' as const },
    }));
  }, []);

  const cancelDownload = useCallback((key: string) => {
    ipc.cancelDownload(key);
    setModels(prev => ({
      ...prev,
      [key]: { ...prev[key], status: 'not_downloaded' as const, downloaded: 0 },
    }));
  }, []);

  const deleteModel = useCallback((key: string) => {
    ipc.deleteModel(key);
    setModels(prev => ({
      ...prev,
      [key]: { ...prev[key], available: false, status: 'not_downloaded' as const, downloaded: 0 },
    }));
  }, []);

  return { models, refresh, startDownload, pauseDownload, cancelDownload, deleteModel };
}
