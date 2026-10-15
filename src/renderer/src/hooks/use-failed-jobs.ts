import { useCallback, useEffect, useState } from 'react';
import { ipc, type FailedJob } from '@/lib/ipc';

/** Recordings whose transcription failed or was cut off by a crash. */
export function useFailedJobs() {
  const [jobs, setJobs] = useState<FailedJob[]>([]);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [retryingAll, setRetryingAll] = useState(false);

  useEffect(() => {
    if (!ipc?.getFailedJobs) return;
    ipc.getFailedJobs().then(setJobs).catch(() => {});
    return ipc.onFailedJobsChanged?.(setJobs);
  }, []);

  const retry = useCallback(async (id: string) => {
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      return await ipc.retryFailedJob(id);
    } finally {
      setBusy((b) => {
        const next = { ...b };
        delete next[id];
        return next;
      });
    }
  }, []);

  const retryAll = useCallback(async () => {
    setRetryingAll(true);
    try {
      return await ipc.retryAllFailedJobs();
    } finally {
      setRetryingAll(false);
    }
  }, []);

  const discard = useCallback(async (id: string) => {
    setJobs(await ipc.discardFailedJob(id));
  }, []);

  return { jobs, busy, retryingAll, retry, retryAll, discard };
}
