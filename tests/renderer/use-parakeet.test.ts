import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ParakeetModelInfo, DownloadProgress } from '@/lib/ipc';

// ─── Mock ipc BEFORE importing the hook ──────────────────────────────────────

vi.mock('@/lib/ipc', () => ({
  ipc: {
    getParakeetStatus: vi.fn(),
    startParakeetDownload: vi.fn(),
    cancelParakeetDownload: vi.fn(),
    deleteParakeet: vi.fn(),
    onParakeetDownloadProgress: vi.fn(),
    onParakeetStatusChanged: vi.fn(),
    onParakeetDownloadError: vi.fn(),
  },
}));

import { useParakeet } from '@/hooks/use-parakeet';
import { ipc } from '@/lib/ipc';

const downloadedStatus: ParakeetModelInfo = {
  size: '~632 MB',
  quality: 'Excellent',
  available: true,
  status: 'downloaded',
  downloaded: 662_000_000,
  total: 662_000_000,
};

const notDownloadedStatus: ParakeetModelInfo = {
  size: '~632 MB',
  quality: 'Excellent',
  available: false,
  status: 'not_downloaded',
  downloaded: 0,
  total: 662_000_000,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useParakeet', () => {
  beforeEach(() => {
    vi.mocked(ipc.getParakeetStatus).mockResolvedValue(notDownloadedStatus);
    vi.mocked(ipc.onParakeetDownloadProgress).mockImplementation(() => {});
    vi.mocked(ipc.onParakeetStatusChanged).mockImplementation(() => {});
    vi.mocked(ipc.onParakeetDownloadError).mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts with the DEFAULT_STATUS before loading', () => {
    const { result } = renderHook(() => useParakeet());
    expect(result.current.status.available).toBe(false);
    expect(result.current.status.status).toBe('not_downloaded');
  });

  it('loads status from ipc on mount', async () => {
    vi.mocked(ipc.getParakeetStatus).mockResolvedValue(downloadedStatus);
    const { result } = renderHook(() => useParakeet());
    await waitFor(() => expect(result.current.status.available).toBe(true));
    expect(ipc.getParakeetStatus).toHaveBeenCalledTimes(1);
  });

  it('refresh reloads status from ipc', async () => {
    vi.mocked(ipc.getParakeetStatus)
      .mockResolvedValueOnce(notDownloadedStatus)
      .mockResolvedValueOnce(downloadedStatus);

    const { result } = renderHook(() => useParakeet());
    await waitFor(() => expect(result.current.status.status).toBe('not_downloaded'));

    await act(() => result.current.refresh());

    expect(result.current.status.available).toBe(true);
  });

  it('startDownload calls ipc and sets status to downloading', async () => {
    const { result } = renderHook(() => useParakeet());
    await waitFor(() => expect(result.current.status.status).toBe('not_downloaded'));

    act(() => result.current.startDownload());

    expect(ipc.startParakeetDownload).toHaveBeenCalledTimes(1);
    expect(result.current.status.status).toBe('downloading');
  });

  it('cancelDownload calls ipc and resets status to not_downloaded', async () => {
    vi.mocked(ipc.getParakeetStatus).mockResolvedValue({
      ...notDownloadedStatus,
      status: 'downloading',
      downloaded: 100_000,
    });

    const { result } = renderHook(() => useParakeet());
    await waitFor(() => expect(result.current.status.downloaded).toBe(100_000));

    act(() => result.current.cancelDownload());

    expect(ipc.cancelParakeetDownload).toHaveBeenCalledTimes(1);
    expect(result.current.status.status).toBe('not_downloaded');
    expect(result.current.status.downloaded).toBe(0);
  });

  it('deleteModel calls ipc and resets status', async () => {
    vi.mocked(ipc.getParakeetStatus).mockResolvedValue(downloadedStatus);
    const { result } = renderHook(() => useParakeet());
    await waitFor(() => expect(result.current.status.available).toBe(true));

    act(() => result.current.deleteModel());

    expect(ipc.deleteParakeet).toHaveBeenCalledTimes(1);
    expect(result.current.status.available).toBe(false);
    expect(result.current.status.status).toBe('not_downloaded');
    expect(result.current.status.downloaded).toBe(0);
  });

  it('onParakeetDownloadProgress updates downloaded/total', async () => {
    let progressCallback: ((p: DownloadProgress) => void) | null = null;
    vi.mocked(ipc.onParakeetDownloadProgress).mockImplementation((cb) => { progressCallback = cb; });

    const { result } = renderHook(() => useParakeet());
    await waitFor(() => expect(result.current.status.status).toBe('not_downloaded'));

    act(() => progressCallback!({ modelKey: 'parakeet', downloaded: 200_000, total: 662_000_000, percent: 30 }));

    expect(result.current.status.status).toBe('downloading');
    expect(result.current.status.downloaded).toBe(200_000);
    expect(result.current.status.total).toBe(662_000_000);
  });

  it('onParakeetStatusChanged replaces the entire status', async () => {
    let statusCallback: ((s: ParakeetModelInfo) => void) | null = null;
    vi.mocked(ipc.onParakeetStatusChanged).mockImplementation((cb) => { statusCallback = cb; });

    const { result } = renderHook(() => useParakeet());
    await waitFor(() => expect(result.current.status.status).toBe('not_downloaded'));

    act(() => statusCallback!(downloadedStatus));

    expect(result.current.status.available).toBe(true);
    expect(result.current.status.status).toBe('downloaded');
  });

  it('onParakeetDownloadError resets status to not_downloaded', async () => {
    let errorCallback: (() => void) | null = null;
    vi.mocked(ipc.onParakeetDownloadError).mockImplementation((cb) => { errorCallback = cb as any; });

    const { result } = renderHook(() => useParakeet());
    await waitFor(() => expect(result.current.status.status).toBe('not_downloaded'));

    // Start downloading first
    act(() => result.current.startDownload());
    expect(result.current.status.status).toBe('downloading');

    // Now simulate error
    act(() => errorCallback!());
    expect(result.current.status.status).toBe('not_downloaded');
  });
});
