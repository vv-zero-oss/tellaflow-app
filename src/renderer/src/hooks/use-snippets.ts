import { useState, useEffect, useCallback } from 'react';
import type { SnippetEntry } from '@/lib/ipc';

export function useSnippets() {
  const [entries, setEntries] = useState<SnippetEntry[]>([]);

  const refresh = useCallback(async () => {
    const data = await window.tellaflow.getSnippets();
    setEntries(data);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.snippets) refresh();
    };
    window.addEventListener('tellaflow:data-reset', handler);
    return () => window.removeEventListener('tellaflow:data-reset', handler);
  }, [refresh]);

  const add = useCallback(async (trigger: string, content: string) => {
    const updated = await window.tellaflow.addSnippet(trigger, content);
    setEntries(updated);
  }, []);

  const remove = useCallback(async (id: number) => {
    const updated = await window.tellaflow.removeSnippet(id);
    setEntries(updated);
  }, []);

  const update = useCallback(async (id: number, trigger: string, content: string) => {
    const updated = await window.tellaflow.updateSnippet(id, trigger, content);
    setEntries(updated);
  }, []);

  return { entries, add, remove, update, refresh };
}
