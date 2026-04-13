import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { HistoryEntry } from '@/lib/ipc';

// ─── Mock ipc BEFORE importing the hook ──────────────────────────────────────

vi.mock('@/lib/ipc', () => ({
  ipc: {
    getHistory: vi.fn(),
    clearHistory: vi.fn(),
    deleteHistoryEntry: vi.fn(),
    copyToClipboard: vi.fn(),
    pasteText: vi.fn(),
    onHistoryUpdate: vi.fn(),
  },
}));

import { useHistory } from '@/hooks/use-history';
import { ipc } from '@/lib/ipc';

const mockEntries: HistoryEntry[] = [
  { id: 1, text: 'hello world', timestamp: '2024-01-01T00:00:00Z' },
  { id: 2, text: 'good morning everyone', timestamp: '2024-01-02T00:00:00Z' },
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useHistory', () => {
  beforeEach(() => {
    vi.mocked(ipc.getHistory).mockResolvedValue(mockEntries);
    vi.mocked(ipc.onHistoryUpdate).mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('loads history on mount', async () => {
    const { result } = renderHook(() => useHistory());
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    expect(ipc.getHistory).toHaveBeenCalledTimes(1);
  });

  it('subscribes to onHistoryUpdate on mount', async () => {
    const { result } = renderHook(() => useHistory());
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    expect(ipc.onHistoryUpdate).toHaveBeenCalledTimes(1);
  });

  it('calculates totalWords correctly', async () => {
    const { result } = renderHook(() => useHistory());
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    // "hello world" = 2 words, "good morning everyone" = 3 words
    expect(result.current.totalWords).toBe(5);
  });

  it('clearHistory clears entries locally and calls ipc', async () => {
    const { result } = renderHook(() => useHistory());
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    act(() => result.current.clearHistory());

    expect(ipc.clearHistory).toHaveBeenCalledTimes(1);
    expect(result.current.entries).toHaveLength(0);
    expect(result.current.totalWords).toBe(0);
  });

  it('deleteEntry calls ipc and updates entries', async () => {
    const remaining: HistoryEntry[] = [mockEntries[1]];
    vi.mocked(ipc.deleteHistoryEntry).mockResolvedValue(remaining);

    const { result } = renderHook(() => useHistory());
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    await act(() => result.current.deleteEntry(1));

    expect(ipc.deleteHistoryEntry).toHaveBeenCalledWith(1);
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].id).toBe(2);
  });

  it('copy calls ipc.copyToClipboard with the text', async () => {
    const { result } = renderHook(() => useHistory());
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    act(() => result.current.copy('hello'));

    expect(ipc.copyToClipboard).toHaveBeenCalledWith('hello');
  });

  it('paste calls ipc.pasteText with the text', async () => {
    const { result } = renderHook(() => useHistory());
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    act(() => result.current.paste('hello'));

    expect(ipc.pasteText).toHaveBeenCalledWith('hello');
  });

  it('updates entries when onHistoryUpdate fires', async () => {
    let updateCallback: ((entries: HistoryEntry[]) => void) | null = null;
    vi.mocked(ipc.onHistoryUpdate).mockImplementation((cb) => { updateCallback = cb; });

    const { result } = renderHook(() => useHistory());
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    const newEntries: HistoryEntry[] = [
      { id: 3, text: 'new dictation', timestamp: '2024-01-03T00:00:00Z' },
    ];
    act(() => updateCallback!(newEntries));

    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].id).toBe(3);
  });

  it('totalWords is 0 when there are no entries', () => {
    vi.mocked(ipc.getHistory).mockResolvedValue([]);
    const { result } = renderHook(() => useHistory());
    expect(result.current.totalWords).toBe(0);
  });
});
