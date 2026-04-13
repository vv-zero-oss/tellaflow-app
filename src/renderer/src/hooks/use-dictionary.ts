import { useState, useEffect, useCallback } from 'react';
import { ipc, type DictionaryEntry } from '@/lib/ipc';

export function useDictionary() {
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);

  const refresh = useCallback(async () => {
    const d = await ipc.getDictionary();
    setEntries(d);
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

  const add = useCallback(async (from: string, to: string) => {
    const updated = await ipc.addDictionaryEntry(from, to);
    setEntries(updated);
  }, []);

  const remove = useCallback(async (id: number) => {
    const updated = await ipc.removeDictionaryEntry(id);
    setEntries(updated);
  }, []);

  const update = useCallback(async (id: number, from: string, to: string) => {
    const updated = await ipc.updateDictionaryEntry(id, from, to);
    setEntries(updated);
  }, []);

  return { entries, add, remove, update, refresh };
}
