import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ModelLoadState } from '@/lib/ipc';

vi.mock('@/lib/ipc', () => ({
  ipc: {
    getModelLoadState: vi.fn(),
    onModelLoadState: vi.fn(),
  },
}));

import { useModelLoad, loadProgress } from '@/hooks/use-model-load';
import { ipc } from '@/lib/ipc';

describe('loadProgress', () => {
  it('rises with elapsed time but never passes 95% before the load finishes', () => {
    expect(loadProgress(0, 2000)).toBe(0);
    expect(loadProgress(1000, 2000)).toBeGreaterThan(50);
    expect(loadProgress(2000, 2000)).toBeGreaterThan(85);
    expect(loadProgress(60_000, 2000)).toBeLessThanOrEqual(95);
  });
});

describe('useModelLoad', () => {
  let push: (s: ModelLoadState) => void = () => {};

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    vi.mocked(ipc.getModelLoadState!).mockResolvedValue({ loading: false });
    vi.mocked(ipc.onModelLoadState!).mockImplementation((cb) => { push = cb; return () => {}; });
  });
  afterEach(() => vi.useRealTimers());

  it('animates while loading, fills to 100% when done, then hides', async () => {
    const { result } = renderHook(() => useModelLoad());
    expect(result.current.loading).toBe(false);

    act(() => push({ loading: true, engine: 'whisper', startedAt: 10_000, expectedMs: 2000 }));
    expect(result.current.loading).toBe(true);
    expect(result.current.engine).toBe('whisper');
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.progress).toBeGreaterThan(50);
    expect(result.current.progress).toBeLessThan(95);

    act(() => push({ loading: false, ok: true, engine: 'whisper' }));
    expect(result.current.progress).toBe(100);
    expect(result.current.loading).toBe(true);
    act(() => { vi.advanceTimersByTime(700); });
    expect(result.current.loading).toBe(false);
  });
});
