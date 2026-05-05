import { useState, useEffect, useCallback } from 'react';

interface AssistantConfig {
  assistantEnabled: boolean;
  assistantProvider: string;
  assistantModel: string;
  assistantHotkey: { names: string[]; label: string };
  assistantVoice: string;
  assistantAutoUnload: boolean;
  assistantStreamTTS: boolean;
  assistantMaxContext: number;
  assistantIdleTimeout: number;
}

interface TTSStatus {
  name: string;
  downloaded: boolean;
  status: string;
  totalBytes: number;
}

// Access tellaflow IPC via type assertion to avoid global redeclaration conflicts
const ipc = () => (window as any).tellaflow as Record<string, any> | undefined;

export function useAssistant() {
  const [config, setConfig] = useState<AssistantConfig | null>(null);
  const [ttsStatus, setTTSStatus] = useState<TTSStatus | null>(null);
  const [storedProviders, setStoredProviders] = useState<string[]>([]);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    ipc()?.getAssistantConfig?.()?.then(setConfig).catch(() => {});
    ipc()?.getAssistantTTSStatus?.()?.then(setTTSStatus).catch(() => {});
    ipc()?.getAssistantStoredProviders?.()?.then(setStoredProviders).catch(() => {});

    ipc()?.onAssistantConfigChanged?.((c: AssistantConfig) => setConfig(c));
  }, []);

  const setEnabled = useCallback((v: boolean) => {
    ipc()?.setAssistantEnabled(v);
    setConfig(prev => prev ? { ...prev, assistantEnabled: v } : prev);
  }, []);

  const setProvider = useCallback((v: string) => {
    ipc()?.setAssistantProvider(v);
    setConfig(prev => prev ? { ...prev, assistantProvider: v } : prev);
  }, []);

  const setModel = useCallback((v: string) => {
    ipc()?.setAssistantModel(v);
    setConfig(prev => prev ? { ...prev, assistantModel: v } : prev);
  }, []);

  const setVoice = useCallback((v: string) => {
    ipc()?.setAssistantVoice(v);
    setConfig(prev => prev ? { ...prev, assistantVoice: v } : prev);
  }, []);

  const setApiKey = useCallback((provider: string, key: string) => {
    ipc()?.setAssistantApiKey({ provider, key });
    setStoredProviders(prev => prev.includes(provider) ? prev : [...prev, provider]);
  }, []);

  const testConnection = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await ipc()?.testAssistantConnection();
      setTestResult(result);
    } catch (err) {
      setTestResult({ ok: false, error: (err as Error).message });
    }
    setTesting(false);
  }, []);

  return {
    config,
    ttsStatus,
    storedProviders,
    testResult,
    testing,
    setEnabled,
    setProvider,
    setModel,
    setVoice,
    setApiKey,
    testConnection,
  };
}
