import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { DictionaryEntry } from '@/lib/ipc';

// ─── Mock ipc module BEFORE importing the hook ───────────────────────────────

vi.mock('@/lib/ipc', () => ({
  ipc: {
    getDictionary: vi.fn(),
    addDictionaryEntry: vi.fn(),
    removeDictionaryEntry: vi.fn(),
    updateDictionaryEntry: vi.fn(),
  },
}));

// Import after mock is set up
import { useDictionary } from '@/hooks/use-dictionary';
import { ipc } from '@/lib/ipc';

const mockEntries: DictionaryEntry[] = [
  { id: 1, from: 'colour', to: 'color' },
  { id: 2, from: 'favour', to: 'favor' },
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useDictionary', () => {
  beforeEach(() => {
    vi.mocked(ipc.getDictionary).mockResolvedValue(mockEntries);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('loads entries on mount', async () => {
    const { result } = renderHook(() => useDictionary());
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    expect(ipc.getDictionary).toHaveBeenCalledTimes(1);
  });

  it('refreshes entries when tellaflow:data-reset fires with dictionary=true', async () => {
    vi.mocked(ipc.getDictionary)
      .mockResolvedValueOnce(mockEntries)
      .mockResolvedValueOnce([]);

    const { result } = renderHook(() => useDictionary());
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    act(() => {
      window.dispatchEvent(
        new CustomEvent('tellaflow:data-reset', { detail: { dictionary: true } })
      );
    });

    await waitFor(() => expect(result.current.entries).toHaveLength(0));
    expect(ipc.getDictionary).toHaveBeenCalledTimes(2);
  });

  it('does NOT refresh when tellaflow:data-reset fires with dictionary=false', async () => {
    const { result } = renderHook(() => useDictionary());
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    act(() => {
      window.dispatchEvent(
        new CustomEvent('tellaflow:data-reset', { detail: { dictionary: false } })
      );
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(ipc.getDictionary).toHaveBeenCalledTimes(1);
  });

  it('removes the event listener on unmount (no refresh after unmount)', async () => {
    const { result, unmount } = renderHook(() => useDictionary());
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    unmount();
    vi.clearAllMocks();

    act(() => {
      window.dispatchEvent(
        new CustomEvent('tellaflow:data-reset', { detail: { dictionary: true } })
      );
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(ipc.getDictionary).not.toHaveBeenCalled();
  });
});
