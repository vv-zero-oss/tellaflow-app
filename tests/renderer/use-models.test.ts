import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { Models, DownloadProgress, DownloadError } from '@/lib/ipc';

// ─── Mock ipc BEFORE importing the hook ──────────────────────────────────────

vi.mock('@/lib/ipc', () => ({
  ipc: {
    getModels: vi.fn(),
    startDownload: vi.fn(),
    pauseDownload: vi.fn(),
    cancelDownload: vi.fn(),
    deleteModel: vi.fn(),
    onDownloadProgress: vi.fn(),
    onDownloadError: vi.fn(),
    onModelsChanged: vi.fn(),
  },
}));

import { useModels } from '@/hooks/use-models';
import { ipc } from '@/lib/ipc';

const mockModels: Models = {
  tiny: { size: 'Tiny', quality: 'Basic', available: true, status: 'downloaded', downloaded: 0, total: 0 },
  small: { size: 'Small', quality: 'Good', available: false, status: 'not_downloaded', downloaded: 0, total: 500_000_000 },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useModels', () => {
  beforeEach(() => {
    vi.mocked(ipc.getModels).mockResolvedValue(mockModels);
    vi.mocked(ipc.onDownloadProgress).mockImplementation(() => {});
    vi.mocked(ipc.onDownloadError).mockImplementation(() => {});
    vi.mocked(ipc.onModelsChanged).mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts with an empty models object', () => {
    const { result } = renderHook(() => useModels());
    expect(result.current.models).toEqual({});
  });

  it('loads models from ipc on mount', async () => {
    const { result } = renderHook(() => useModels());
    await waitFor(() => expect(Object.keys(result.current.models)).toHaveLength(2));
    expect(ipc.getModels).toHaveBeenCalledTimes(1);
    expect(result.current.models.tiny.available).toBe(true);
    expect(result.current.models.small.status).toBe('not_downloaded');
  });

  it('uses FALLBACK_MODELS when ipc.getModels is not a function', async () => {
    // Temporarily remove getModels from the mock object
    const original = ipc.getModels;
    (ipc as any).getModels = undefined;

    const { result } = renderHook(() => useModels());
    await waitFor(() => expect(Object.keys(result.current.models).length).toBeGreaterThan(0));
    // Fallback includes at least tiny and base as downloaded
    expect(result.current.models).toHaveProperty('tiny');

    (ipc as any).getModels = original;
  });

  it('refresh reloads models from ipc', async () => {
    const updatedModels: Models = {
      ...mockModels,
      small: { ...mockModels.small, available: true, status: 'downloaded' },
    };
    vi.mocked(ipc.getModels)
      .mockResolvedValueOnce(mockModels)
      .mockResolvedValueOnce(updatedModels);

    const { result } = renderHook(() => useModels());
    await waitFor(() => expect(Object.keys(result.current.models)).toHaveLength(2));

    await act(() => result.current.refresh());

    expect(result.current.models.small.status).toBe('downloaded');
  });

  it('startDownload calls ipc and sets model status to downloading', async () => {
    const { result } = renderHook(() => useModels());
    await waitFor(() => expect(Object.keys(result.current.models)).toHaveLength(2));

    act(() => result.current.startDownload('small'));

    expect(ipc.startDownload).toHaveBeenCalledWith('small');
    expect(result.current.models.small.status).toBe('downloading');
  });

  it('pauseDownload calls ipc and sets model status to paused', async () => {
    const { result } = renderHook(() => useModels());
    await waitFor(() => expect(Object.keys(result.current.models)).toHaveLength(2));

    act(() => result.current.startDownload('small'));
    act(() => result.current.pauseDownload('small'));

    expect(ipc.pauseDownload).toHaveBeenCalledWith('small');
    expect(result.current.models.small.status).toBe('paused');
  });

  it('cancelDownload calls ipc and resets model to not_downloaded with 0 progress', async () => {
    const { result } = renderHook(() => useModels());
    await waitFor(() => expect(Object.keys(result.current.models)).toHaveLength(2));

    act(() => result.current.startDownload('small'));
    act(() => result.current.cancelDownload('small'));

    expect(ipc.cancelDownload).toHaveBeenCalledWith('small');
    expect(result.current.models.small.status).toBe('not_downloaded');
    expect(result.current.models.small.downloaded).toBe(0);
  });

  it('deleteModel calls ipc and marks model as unavailable/not_downloaded', async () => {
    const { result } = renderHook(() => useModels());
    await waitFor(() => expect(Object.keys(result.current.models)).toHaveLength(2));

    act(() => result.current.deleteModel('tiny'));

    expect(ipc.deleteModel).toHaveBeenCalledWith('tiny');
    expect(result.current.models.tiny.available).toBe(false);
    expect(result.current.models.tiny.status).toBe('not_downloaded');
    expect(result.current.models.tiny.downloaded).toBe(0);
  });

  it('onDownloadProgress updates the specific model progress', async () => {
    let progressCb: ((p: DownloadProgress) => void) | null = null;
    vi.mocked(ipc.onDownloadProgress).mockImplementation((cb) => { progressCb = cb; });

    const { result } = renderHook(() => useModels());
    await waitFor(() => expect(Object.keys(result.current.models)).toHaveLength(2));

    act(() => progressCb!({ modelKey: 'small', downloaded: 100_000, total: 500_000_000, percent: 20 }));

    expect(result.current.models.small.status).toBe('downloading');
    expect(result.current.models.small.downloaded).toBe(100_000);
    expect(result.current.models.small.total).toBe(500_000_000);
  });

  it('onDownloadError resets the specific model to not_downloaded', async () => {
    let errorCb: ((e: DownloadError) => void) | null = null;
    vi.mocked(ipc.onDownloadError).mockImplementation((cb) => { errorCb = cb; });

    const { result } = renderHook(() => useModels());
    await waitFor(() => expect(Object.keys(result.current.models)).toHaveLength(2));

    act(() => result.current.startDownload('small'));
    expect(result.current.models.small.status).toBe('downloading');

    act(() => errorCb!({ modelKey: 'small', error: 'Network error' }));
    expect(result.current.models.small.status).toBe('not_downloaded');
  });

  it('onModelsChanged replaces models with new data', async () => {
    let changedCb: ((m: Models) => void) | null = null;
    vi.mocked(ipc.onModelsChanged).mockImplementation((cb) => { changedCb = cb; });

    const { result } = renderHook(() => useModels());
    await waitFor(() => expect(Object.keys(result.current.models)).toHaveLength(2));

    const newModels: Models = {
      large: { size: 'Large', quality: 'Best', available: true, status: 'downloaded', downloaded: 0, total: 0 },
    };
    act(() => changedCb!(newModels));

    expect(Object.keys(result.current.models)).toHaveLength(1);
    expect(result.current.models.large.available).toBe(true);
  });

  it('onModelsChanged calls refresh when payload is falsy', async () => {
    let changedCb: ((m: Models) => void) | null = null;
    vi.mocked(ipc.onModelsChanged).mockImplementation((cb) => { changedCb = cb; });

    const { result } = renderHook(() => useModels());
    await waitFor(() => expect(Object.keys(result.current.models)).toHaveLength(2));

    const callsBefore = vi.mocked(ipc.getModels).mock.calls.length;
    act(() => changedCb!(null as any));

    await waitFor(() => {
      expect(vi.mocked(ipc.getModels).mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });
});
