import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSnippets } from '@/hooks/use-snippets';
import type { SnippetEntry } from '@/lib/ipc';

// ─── Mock window.tellaflow ───────────────────────────────────────────────────

const mockSnippets: SnippetEntry[] = [
  { id: 1, trigger: 'brb', content: 'be right back' },
  { id: 2, trigger: 'omw', content: 'on my way' },
];

const getSnippets = vi.fn().mockResolvedValue(mockSnippets);
const addSnippet = vi.fn();
const removeSnippet = vi.fn();
const updateSnippet = vi.fn();

Object.defineProperty(window, 'tellaflow', {
  value: { getSnippets, addSnippet, removeSnippet, updateSnippet },
  writable: true,
  configurable: true,
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useSnippets', () => {
  beforeEach(() => {
    getSnippets.mockResolvedValue(mockSnippets);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('loads snippets on mount', async () => {
    const { result } = renderHook(() => useSnippets());
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    expect(getSnippets).toHaveBeenCalledTimes(1);
  });

  it('refreshes when tellaflow:data-reset fires with snippets=true', async () => {
    getSnippets
      .mockResolvedValueOnce(mockSnippets)  // initial load
      .mockResolvedValueOnce([]);            // after reset

    const { result } = renderHook(() => useSnippets());
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    act(() => {
      window.dispatchEvent(
        new CustomEvent('tellaflow:data-reset', { detail: { snippets: true } })
      );
    });

    await waitFor(() => expect(result.current.entries).toHaveLength(0));
    expect(getSnippets).toHaveBeenCalledTimes(2);
  });

  it('does NOT refresh when tellaflow:data-reset fires with snippets=false', async () => {
    const { result } = renderHook(() => useSnippets());
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    act(() => {
      window.dispatchEvent(
        new CustomEvent('tellaflow:data-reset', { detail: { snippets: false } })
      );
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(getSnippets).toHaveBeenCalledTimes(1);
  });

  it('removes the event listener on unmount', async () => {
    const { result, unmount } = renderHook(() => useSnippets());
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    unmount();
    vi.clearAllMocks();

    act(() => {
      window.dispatchEvent(
        new CustomEvent('tellaflow:data-reset', { detail: { snippets: true } })
      );
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(getSnippets).not.toHaveBeenCalled();
  });
});
