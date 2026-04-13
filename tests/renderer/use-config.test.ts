import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { AppConfig } from '@/lib/ipc';

// ─── Mock ipc and theme BEFORE importing the hook ─────────────────────────────

vi.mock('@/lib/ipc', () => ({
  ipc: {
    getConfig: vi.fn(),
    setModel: vi.fn(),
    setGrammarEnabled: vi.fn(),
    setGrammarTone: vi.fn(),
    setTheme: vi.fn(),
    setTranslationEnabled: vi.fn(),
    setTranslationLanguage: vi.fn(),
    setTranscriptionEngine: vi.fn(),
    onConfigChanged: vi.fn(),
  },
}));

vi.mock('@/lib/theme', () => ({
  applyTheme: vi.fn(),
}));

import { useConfig } from '@/hooks/use-config';
import { ipc } from '@/lib/ipc';
import { applyTheme } from '@/lib/theme';

const defaultConfig: AppConfig = {
  model: 'small',
  grammarEnabled: false,
  grammarTone: 'casual',
  theme: 'dark',
  translationEnabled: false,
  translationLanguage: 'ja',
  transcriptionEngine: 'whisper',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useConfig', () => {
  beforeEach(() => {
    vi.mocked(ipc.getConfig).mockResolvedValue(defaultConfig);
    vi.mocked(ipc.onConfigChanged).mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts with loading=true and empty config', () => {
    const { result } = renderHook(() => useConfig());
    expect(result.current.loading).toBe(true);
  });

  it('loads config on mount and sets loading=false', async () => {
    const { result } = renderHook(() => useConfig());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.config.model).toBe('small');
    expect(ipc.getConfig).toHaveBeenCalledTimes(1);
  });

  it('applies the theme after loading config', async () => {
    const { result } = renderHook(() => useConfig());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(applyTheme).toHaveBeenCalledWith('dark');
  });

  it('subscribes to onConfigChanged on mount', async () => {
    const { result } = renderHook(() => useConfig());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(ipc.onConfigChanged).toHaveBeenCalledTimes(1);
  });

  it('setModel updates local config and calls ipc', async () => {
    const { result } = renderHook(() => useConfig());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setModel('large'));

    expect(ipc.setModel).toHaveBeenCalledWith('large');
    expect(result.current.config.model).toBe('large');
  });

  it('setGrammarEnabled updates local config and calls ipc', async () => {
    const { result } = renderHook(() => useConfig());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setGrammarEnabled(true));

    expect(ipc.setGrammarEnabled).toHaveBeenCalledWith(true);
    expect(result.current.config.grammarEnabled).toBe(true);
  });

  it('setGrammarTone updates local config and calls ipc', async () => {
    const { result } = renderHook(() => useConfig());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setGrammarTone('formal'));

    expect(ipc.setGrammarTone).toHaveBeenCalledWith('formal');
    expect(result.current.config.grammarTone).toBe('formal');
  });

  it('setTheme updates local config, calls ipc, and applies theme', async () => {
    const { result } = renderHook(() => useConfig());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setTheme('light'));

    expect(ipc.setTheme).toHaveBeenCalledWith('light');
    expect(result.current.config.theme).toBe('light');
    expect(applyTheme).toHaveBeenCalledWith('light');
  });

  it('setTranslationEnabled updates local config and calls ipc', async () => {
    const { result } = renderHook(() => useConfig());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setTranslationEnabled(true));

    expect(ipc.setTranslationEnabled).toHaveBeenCalledWith(true);
    expect(result.current.config.translationEnabled).toBe(true);
  });

  it('setTranslationLanguage updates local config and calls ipc', async () => {
    const { result } = renderHook(() => useConfig());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setTranslationLanguage('fr'));

    expect(ipc.setTranslationLanguage).toHaveBeenCalledWith('fr');
    expect(result.current.config.translationLanguage).toBe('fr');
  });

  it('setTranscriptionEngine updates local config and calls ipc', async () => {
    const { result } = renderHook(() => useConfig());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setTranscriptionEngine('parakeet'));

    expect(ipc.setTranscriptionEngine).toHaveBeenCalledWith('parakeet');
    expect(result.current.config.transcriptionEngine).toBe('parakeet');
  });

  it('merges partial config when onConfigChanged fires', async () => {
    let changeCallback: ((partial: Partial<AppConfig>) => void) | null = null;
    vi.mocked(ipc.onConfigChanged).mockImplementation((cb) => { changeCallback = cb; });

    const { result } = renderHook(() => useConfig());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => changeCallback!({ model: 'medium', theme: 'light' }));

    expect(result.current.config.model).toBe('medium');
    expect(result.current.config.theme).toBe('light');
    // unchanged fields preserved
    expect(result.current.config.grammarEnabled).toBe(false);
  });

  it('refresh reloads config from ipc', async () => {
    vi.mocked(ipc.getConfig)
      .mockResolvedValueOnce(defaultConfig)
      .mockResolvedValueOnce({ ...defaultConfig, model: 'large' });

    const { result } = renderHook(() => useConfig());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.refresh());

    expect(result.current.config.model).toBe('large');
    expect(ipc.getConfig).toHaveBeenCalledTimes(2);
  });
});
