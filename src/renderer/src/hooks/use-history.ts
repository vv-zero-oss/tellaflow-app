import { useState, useEffect, useCallback, useMemo } from 'react';
import { ipc, type HistoryEntry } from '@/lib/ipc';

export function useHistory() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    if (!ipc) return;
    ipc.getHistory().then(setEntries);
    return ipc.onHistoryUpdate(setEntries);
  }, []);

  const clearHistory = useCallback(() => {
    ipc.clearHistory();
    setEntries([]);
  }, []);

  const deleteEntry = useCallback(async (id: number) => {
    const updated = await ipc.deleteHistoryEntry(id);
    setEntries(updated);
  }, []);

  const copy = useCallback((text: string) => ipc.copyToClipboard(text), []);
  const paste = useCallback((text: string) => ipc.pasteText(text), []);

  const totalWords = useMemo(
    () => entries.reduce((sum, e) => sum + e.text.split(/\s+/).filter(w => w.length > 0).length, 0),
    [entries],
  );

  return { entries, totalWords, clearHistory, deleteEntry, copy, paste };
}
