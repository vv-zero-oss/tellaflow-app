import { useState, useEffect, useCallback } from 'react';
import { ipc, type AppConfig, type Theme, type TranscriptionEngine } from '@/lib/ipc';
import { applyTheme } from '@/lib/theme';

export function useConfig() {
  const [config, setConfig] = useState<AppConfig>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!ipc) { setLoading(false); return; }
    const c = await ipc.getConfig();
    setConfig(c);
    applyTheme(c.theme || 'dark');
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();

    if (!ipc || !ipc.onConfigChanged) return;
    return ipc.onConfigChanged((partial) => {
      setConfig(prev => ({ ...prev, ...partial }));
    });
  }, [refresh]);

  const setModel = useCallback((model: string) => {
    ipc.setModel(model);
    setConfig(prev => ({ ...prev, model }));
  }, []);

  const setGrammarEnabled = useCallback((enabled: boolean) => {
    ipc.setGrammarEnabled(enabled);
    setConfig(prev => ({ ...prev, grammarEnabled: enabled }));
  }, []);

  const setGrammarTone = useCallback((tone: string) => {
    ipc.setGrammarTone(tone);
    setConfig(prev => ({ ...prev, grammarTone: tone }));
  }, []);

  const setTheme = useCallback((theme: Theme) => {
    ipc.setTheme(theme);
    setConfig(prev => ({ ...prev, theme }));
    applyTheme(theme);
  }, []);

  const setTranslationEnabled = useCallback((enabled: boolean) => {
    ipc.setTranslationEnabled(enabled);
    setConfig(prev => ({ ...prev, translationEnabled: enabled }));
  }, []);

  const setTranslationLanguage = useCallback((lang: string) => {
    ipc.setTranslationLanguage(lang);
    setConfig(prev => ({ ...prev, translationLanguage: lang }));
  }, []);

  const setTranscriptionEngine = useCallback((engine: TranscriptionEngine) => {
    ipc.setTranscriptionEngine(engine);
    setConfig(prev => ({ ...prev, transcriptionEngine: engine }));
  }, []);

  return {
    config, loading, refresh,
    setModel, setGrammarEnabled, setGrammarTone, setTheme,
    setTranslationEnabled, setTranslationLanguage,
    setTranscriptionEngine,
  };
}
