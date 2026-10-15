import { useState, useEffect, useCallback } from 'react';
import { ipc, type ParakeetModelInfo, type ParakeetVariant, type DownloadProgress } from '@/lib/ipc';

const DEFAULT_STATUS: Record<ParakeetVariant, ParakeetModelInfo> = {
  v2: { variant: 'v2', size: '~632 MB', quality: 'Excellent', available: false, status: 'not_downloaded', downloaded: 0, total: 662_000_000 },
  unified: { variant: 'unified', size: '~500 MB', quality: 'Best', available: false, status: 'not_downloaded', downloaded: 0, total: 501_350_460 },
};

/** Download state of one Parakeet variant. Events for other variants are ignored. */
export function useParakeet(variant: ParakeetVariant = 'v2') {
  const [status, setStatus] = useState<ParakeetModelInfo>(DEFAULT_STATUS[variant]);
  const mine = (v?: ParakeetVariant) => (v ?? 'v2') === variant;

  const refresh = useCallback(async () => {
    if (!ipc || !ipc.getParakeetStatus) {
      setStatus(DEFAULT_STATUS[variant]);
      return;
    }
    const s = await ipc.getParakeetStatus(variant);
    setStatus(s);
  }, [variant]);

  useEffect(() => {
    refresh();

    if (!ipc) return;

    const cleanups: Array<(() => void) | undefined> = [];

    if (ipc.onParakeetDownloadProgress) {
      cleanups.push(ipc.onParakeetDownloadProgress((p: DownloadProgress) => {
        if (!mine(p.variant)) return;
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
        if (!mine(s.variant)) return;
        setStatus(s);
      }));
    }

    if (ipc.onParakeetDownloadError) {
      cleanups.push(ipc.onParakeetDownloadError((e) => {
        if (!mine(e?.variant)) return;
        setStatus(prev => ({ ...prev, status: 'not_downloaded' }));
      }));
    }

    return () => cleanups.forEach(fn => fn?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  const startDownload = useCallback(() => {
    ipc.startParakeetDownload(variant);
    setStatus(prev => ({ ...prev, status: 'downloading' }));
  }, [variant]);

  const cancelDownload = useCallback(() => {
    ipc.cancelParakeetDownload(variant);
    setStatus(prev => ({ ...prev, status: 'not_downloaded', downloaded: 0 }));
  }, [variant]);

  const deleteModel = useCallback(() => {
    ipc.deleteParakeet(variant);
    setStatus(prev => ({ ...prev, available: false, status: 'not_downloaded', downloaded: 0 }));
  }, [variant]);

  return { status, refresh, startDownload, cancelDownload, deleteModel };
}
