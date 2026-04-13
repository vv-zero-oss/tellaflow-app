import { useState, useEffect, useCallback } from 'react';
import { ipc, type ParakeetModelInfo, type DownloadProgress } from '@/lib/ipc';

const DEFAULT_STATUS: ParakeetModelInfo = {
  size: '~632 MB',
  quality: 'Excellent',
  available: false,
  status: 'not_downloaded',
  downloaded: 0,
  total: 662_000_000,
};

export function useParakeet() {
  const [status, setStatus] = useState<ParakeetModelInfo>(DEFAULT_STATUS);

  const refresh = useCallback(async () => {
    if (!ipc || !ipc.getParakeetStatus) {
      setStatus(DEFAULT_STATUS);
      return;
    }
    const s = await ipc.getParakeetStatus();
    setStatus(s);
  }, []);

  useEffect(() => {
    refresh();

    if (!ipc) return;

    const cleanups: Array<(() => void) | undefined> = [];

    if (ipc.onParakeetDownloadProgress) {
      cleanups.push(ipc.onParakeetDownloadProgress((p: DownloadProgress) => {
        setStatus(prev => ({
          ...prev,
          status: 'downloading',
          downloaded: p.downloaded,
          total: p.total,
        }));
      }));
    }

    if (ipc.onParakeetStatusChanged) {
      cleanups.push(ipc.onParakeetStatusChanged((s: ParakeetModelInfo) => {
        setStatus(s);
      }));
    }

    if (ipc.onParakeetDownloadError) {
      cleanups.push(ipc.onParakeetDownloadError(() => {
        setStatus(prev => ({ ...prev, status: 'not_downloaded' }));
      }));
    }

    return () => cleanups.forEach(fn => fn?.());
  }, [refresh]);

  const startDownload = useCallback(() => {
    ipc.startParakeetDownload();
    setStatus(prev => ({ ...prev, status: 'downloading' }));
  }, []);

  const cancelDownload = useCallback(() => {
    ipc.cancelParakeetDownload();
    setStatus(prev => ({ ...prev, status: 'not_downloaded', downloaded: 0 }));
  }, []);

  const deleteModel = useCallback(() => {
    ipc.deleteParakeet();
    setStatus(prev => ({ ...prev, available: false, status: 'not_downloaded', downloaded: 0 }));
  }, []);

  return { status, refresh, startDownload, cancelDownload, deleteModel };
}
