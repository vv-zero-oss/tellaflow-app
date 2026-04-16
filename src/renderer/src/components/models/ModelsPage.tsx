import { useState, useRef, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, Check, Search, Download, Loader2, Trash2, ChevronRight, CheckCircle2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Well, WellHeader, WellTitle, WellCard, WellItem } from '@/components/ui/well';
import { ModelCards } from './ModelCards';
import { ParakeetModelCard } from './ParakeetModelCard';
import { useModels } from '@/hooks/use-models';
import { useParakeet } from '@/hooks/use-parakeet';
import type { AppConfig, TranscriptionEngine, AiModels, AiModelInfo } from '@/lib/ipc';
import { ipc } from '@/lib/ipc';
import { cn } from '@/lib/utils';
import { Badge } from '../ui/badge';

const TRANSLATION_LANGUAGES = [
  { code: 'af', name: 'Afrikaans', flag: '🇿🇦' },
  { code: 'ar', name: 'Arabic', flag: '🇸🇦' },
  { code: 'hy', name: 'Armenian', flag: '🇦🇲' },
  { code: 'az', name: 'Azerbaijani', flag: '🇦🇿' },
  { code: 'be', name: 'Belarusian', flag: '🇧🇾' },
  { code: 'bs', name: 'Bosnian', flag: '🇧🇦' },
  { code: 'bg', name: 'Bulgarian', flag: '🇧🇬' },
  { code: 'ca', name: 'Catalan', flag: '🇪🇸' },
  { code: 'zh', name: 'Chinese', flag: '🇨🇳' },
  { code: 'hr', name: 'Croatian', flag: '🇭🇷' },
  { code: 'cs', name: 'Czech', flag: '🇨🇿' },
  { code: 'da', name: 'Danish', flag: '🇩🇰' },
  { code: 'nl', name: 'Dutch', flag: '🇳🇱' },
  { code: 'et', name: 'Estonian', flag: '🇪🇪' },
  { code: 'fi', name: 'Finnish', flag: '🇫🇮' },
  { code: 'fr', name: 'French', flag: '🇫🇷' },
  { code: 'gl', name: 'Galician', flag: '🇪🇸' },
  { code: 'de', name: 'German', flag: '🇩🇪' },
  { code: 'el', name: 'Greek', flag: '🇬🇷' },
  { code: 'he', name: 'Hebrew', flag: '🇮🇱' },
  { code: 'hi', name: 'Hindi', flag: '🇮🇳' },
  { code: 'hu', name: 'Hungarian', flag: '🇭🇺' },
  { code: 'is', name: 'Icelandic', flag: '🇮🇸' },
  { code: 'id', name: 'Indonesian', flag: '🇮🇩' },
  { code: 'it', name: 'Italian', flag: '🇮🇹' },
  { code: 'ja', name: 'Japanese', flag: '🇯🇵' },
  { code: 'kn', name: 'Kannada', flag: '🇮🇳' },
  { code: 'kk', name: 'Kazakh', flag: '🇰🇿' },
  { code: 'ko', name: 'Korean', flag: '🇰🇷' },
  { code: 'lv', name: 'Latvian', flag: '🇱🇻' },
  { code: 'lt', name: 'Lithuanian', flag: '🇱🇹' },
  { code: 'mk', name: 'Macedonian', flag: '🇲🇰' },
  { code: 'ms', name: 'Malay', flag: '🇲🇾' },
  { code: 'mr', name: 'Marathi', flag: '🇮🇳' },
  { code: 'mi', name: 'Maori', flag: '🇳🇿' },
  { code: 'ne', name: 'Nepali', flag: '🇳🇵' },
  { code: 'no', name: 'Norwegian', flag: '🇳🇴' },
  { code: 'fa', name: 'Persian', flag: '🇮🇷' },
  { code: 'pl', name: 'Polish', flag: '🇵🇱' },
  { code: 'pt', name: 'Portuguese', flag: '🇵🇹' },
  { code: 'ro', name: 'Romanian', flag: '🇷🇴' },
  { code: 'ru', name: 'Russian', flag: '🇷🇺' },
  { code: 'sr', name: 'Serbian', flag: '🇷🇸' },
  { code: 'sk', name: 'Slovak', flag: '🇸🇰' },
  { code: 'sl', name: 'Slovenian', flag: '🇸🇮' },
  { code: 'es', name: 'Spanish', flag: '🇪🇸' },
  { code: 'sw', name: 'Swahili', flag: '🇰🇪' },
  { code: 'sv', name: 'Swedish', flag: '🇸🇪' },
  { code: 'tl', name: 'Tagalog', flag: '🇵🇭' },
  { code: 'ta', name: 'Tamil', flag: '🇮🇳' },
  { code: 'th', name: 'Thai', flag: '🇹🇭' },
  { code: 'tr', name: 'Turkish', flag: '🇹🇷' },
  { code: 'uk', name: 'Ukrainian', flag: '🇺🇦' },
  { code: 'ur', name: 'Urdu', flag: '🇵🇰' },
  { code: 'vi', name: 'Vietnamese', flag: '🇻🇳' },
  { code: 'cy', name: 'Welsh', flag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿' },
];

const MODEL_META: Record<string, { params: string; speed: string }> = {
  tiny:     { params: '39M params',   speed: '~10× realtime' },
  base:     { params: '74M params',   speed: '~7× realtime' },
  small:    { params: '244M params',  speed: '~4× realtime' },
  medium:   { params: '769M params',  speed: '~2× realtime' },
  large:    { params: '1.55B params', speed: '~1× realtime' },
  parakeet: { params: '600M params',  speed: '~3–4× realtime' },
};

const PARAKEET_KEY = 'parakeet';

type Tab = 'models' | 'grammar';

interface ModelsPageProps {
  config: AppConfig;
  setModel: (model: string) => void;
  setGrammarEnabled: (enabled: boolean) => void;
  setTranslationEnabled: (enabled: boolean) => void;
  setTranslationLanguage: (lang: string) => void;
  setTranscriptionEngine: (engine: TranscriptionEngine) => void;
}

interface LanguageComboboxProps {
  value: string;
  onChange: (code: string) => void;
}

function LanguageCombobox({ value, onChange }: LanguageComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = TRANSLATION_LANGUAGES.find(l => l.code === value);
  const filtered = query.trim()
    ? TRANSLATION_LANGUAGES.filter(l =>
        l.name.toLowerCase().includes(query.toLowerCase()) ||
        l.code.toLowerCase().includes(query.toLowerCase()),
      )
    : TRANSLATION_LANGUAGES;

  useEffect(() => {
    if (!open) { setQuery(''); return; }
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          'flex items-center gap-2 h-9 min-w-[180px] px-3 rounded-lg border border-input bg-transparent',
          'text-sm transition-colors hover:bg-accent/50',
          open && 'ring-1 ring-ring',
        )}
      >
        <span className="flex-1 flex items-center gap-2 text-left">
          {selected ? (
            <>
              <span>{selected.flag}</span>
              <span>{selected.name}</span>
            </>
          ) : (
            <span className="text-muted-foreground">Select language…</span>
          )}
        </span>
        <ChevronDown className={cn('w-3.5 h-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className={cn(
          'absolute right-0 z-50 mt-1 w-56 rounded-lg border border-border bg-popover shadow-lg',
          'flex flex-col overflow-hidden',
        )}>
          <div className="p-2 border-b border-border/60">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search language…"
                className="pl-8 h-8 text-sm"
              />
            </div>
          </div>
          <div className="overflow-y-auto max-h-56">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">No results</p>
            ) : (
              filtered.map(lang => (
                <button
                  key={lang.code}
                  type="button"
                  onClick={() => { onChange(lang.code); setOpen(false); }}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left',
                    'hover:bg-accent transition-colors',
                    lang.code === value && 'bg-accent/60',
                  )}
                >
                  <span className="text-base leading-none">{lang.flag}</span>
                  <span className="flex-1">{lang.name}</span>
                  {lang.code === value && <Check className="w-3.5 h-3.5 text-foreground shrink-0" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Unified AI model row ──────────────────────────────────────────────────────

function AiModelRow({ modelKey, info }: { modelKey: string; info: AiModelInfo }) {
  const [downloading, setDownloading] = useState(info.status === 'downloading');
  const [progress, setProgress] = useState<{ downloaded: number; total: number; percent: number } | null>(
    info.status === 'downloading' || info.status === 'paused'
      ? { downloaded: info.downloaded, total: info.total, percent: info.total > 0 ? Math.round((info.downloaded / info.total) * 100) : 0 }
      : null,
  );

  useEffect(() => {
    if (info.status === 'downloading') {
      setDownloading(true);
      setProgress({ downloaded: info.downloaded, total: info.total, percent: info.total > 0 ? Math.round((info.downloaded / info.total) * 100) : 0 });
    }
  }, [info.status, info.downloaded, info.total]);

  useEffect(() => {
    const offG = ipc.onGrammarModelProgress((p) => {
      if (p.modelKey === modelKey && info.source === 'grammar') {
        setDownloading(true);
        setProgress(p);
      }
    });
    const offA = ipc.onAgentModelProgress((p) => {
      if (p.modelKey === modelKey && info.source === 'agent') {
        setDownloading(true);
        setProgress(p);
      }
    });
    return () => { offG(); offA(); };
  }, [modelKey, info.source]);

  const handleDownload = () => {
    setDownloading(true);
    if (info.source === 'grammar') ipc.startGrammarDownload(modelKey);
    else ipc.startAgentDownload(modelKey);
  };

  const handlePause = () => {
    if (info.source === 'grammar') ipc.pauseGrammarDownload(modelKey);
    else ipc.pauseAgentDownload(modelKey);
    setDownloading(false);
  };

  const handleDelete = () => {
    if (info.source === 'grammar') ipc.deleteGrammarModel(modelKey);
    else ipc.deleteAgentModel(modelKey);
  };

  const fmtBytes = (b: number) => {
    if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
    if (b >= 1e6) return (b / 1e6).toFixed(0) + ' MB';
    return (b / 1e3).toFixed(0) + ' KB';
  };

  return (
    <WellItem>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">{info.name}</span>
            <Badge variant="outline" className="text-[10px] h-4 px-1.5">{info.quality}</Badge>
            <Badge variant="outline" className="text-[10px] h-4 px-1.5">{info.size}</Badge>
            <Badge variant="outline" className="text-[10px] h-4 px-1.5">{info.context} ctx</Badge>
            <Badge
              variant="outline"
              className={cn(
                'text-[10px] h-4 px-1.5',
                info.source === 'grammar' ? 'border-violet-400/50 text-violet-600 dark:text-violet-400' : 'border-blue-400/50 text-blue-600 dark:text-blue-400',
              )}
            >
              {info.source === 'grammar' ? 'Grammar' : 'Agent'}
            </Badge>
            {info.available && (
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5 gap-1">
                <CheckCircle2 className="w-2.5 h-2.5" /> Downloaded
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{info.description}</p>

          {progress && (
            <div className="mt-2">
              <div className="h-1 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progress.percent}%` }} />
              </div>
              <div className="flex justify-between text-[11px] text-muted-foreground mt-1">
                <span>{fmtBytes(progress.downloaded)} / {fmtBytes(progress.total)}</span>
                <span>{downloading ? 'Downloading' : 'Paused'} · {progress.percent}%</span>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-1.5 items-center shrink-0">
          {info.available ? (
            <button
              onClick={handleDelete}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-destructive/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <Trash2 className="w-3 h-3" /> Remove
            </button>
          ) : downloading ? (
            <button
              onClick={handlePause}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-muted hover:bg-muted/70 text-foreground transition-colors"
            >
              <Loader2 className="w-3 h-3 animate-spin" /> Pause
            </button>
          ) : info.status === 'paused' ? (
            <button
              onClick={handleDownload}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
            >
              <ChevronRight className="w-3 h-3" /> Resume
            </button>
          ) : (
            <button
              onClick={handleDownload}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
            >
              <Download className="w-3 h-3" /> Download
            </button>
          )}
        </div>
      </div>
    </WellItem>
  );
}

// ─── Hook for unified AI models ────────────────────────────────────────────────

function useAllAiModels() {
  const [models, setModels] = useState<AiModels | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await ipc.getAllAiModelsStatus();
      setModels(s);
    } catch (err) {
      console.error('Failed to get AI models status:', err);
    }
  }, []);

  useEffect(() => {
    refresh();
    const offG = ipc.onGrammarModelChanged(() => refresh());
    const offA = ipc.onAgentModelChanged(() => refresh());
    return () => { offG(); offA(); };
  }, [refresh]);

  return { models, refresh };
}

function Tab({ label, active, onClick, badge }: { label: string; active: boolean; onClick: () => void; badge?: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative pb-2.5 text-sm font-medium transition-colors whitespace-nowrap flex items-center gap-1.5',
        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
      {badge && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold tracking-wide uppercase bg-amber-400/20 text-amber-600 dark:text-amber-400 border border-amber-400/30 leading-none">
          {badge}
        </span>
      )}
      {active && (
        <motion.div
          layoutId="models-tab-indicator"
          className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground rounded-full"
        />
      )}
    </button>
  );
}

export function ModelsPage({ config, setModel, setGrammarEnabled, setTranslationEnabled, setTranslationLanguage, setTranscriptionEngine }: ModelsPageProps) {
  const [activeTab, setActiveTab] = useState<Tab>('models');
  const { models, startDownload, pauseDownload, cancelDownload, deleteModel } = useModels();
  const parakeet = useParakeet();
  const { models: aiModels } = useAllAiModels();

  const whisperAvailable = Object.entries(models).filter(([, info]) => info.available);
  const engine = config.transcriptionEngine || 'whisper';

  // Unified dropdown value: 'parakeet' when that engine is active, else the whisper model key
  const dropdownValue = engine === 'parakeet' ? PARAKEET_KEY : (config.model || 'small');
  const activeMeta = MODEL_META[dropdownValue];

  function handleModelSelect(value: string) {
    if (value === PARAKEET_KEY) {
      setTranscriptionEngine('parakeet');
    } else {
      if (engine === 'parakeet') setTranscriptionEngine('whisper');
      setModel(value);
    }
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="px-7 pt-12 pb-1 [-webkit-app-region:drag]">
        <h2 className="text-xl font-bold tracking-tight">Models</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Manage transcription and AI models.
        </p>
      </div>

      {/* Tabs */}
      <div className="px-7 [-webkit-app-region:no-drag]">
        <div className="flex gap-5 border-b border-border/50 mt-3">
          <Tab label="Transcription" active={activeTab === 'models'} onClick={() => setActiveTab('models')} />
          <Tab label="AI Models" active={activeTab === 'grammar'} onClick={() => setActiveTab('grammar')} badge="🐛 Beta" />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-7 py-5 [-webkit-app-region:no-drag]">
          {activeTab === 'models' && (
            <>
              {/* Active model selector — unified for Whisper and Parakeet */}
              <Well className="mb-5">
                <WellHeader>
                  <WellTitle>Active Model</WellTitle>
                </WellHeader>
                <WellCard>
                  <WellItem>
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <span className="text-sm font-medium">Transcription model</span>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {engine === 'parakeet'
                            ? 'English only · NVIDIA NeMo · no translation'
                            : 'Choose which Whisper model to use for speech recognition'}
                        </p>
                        {activeMeta && (
                          <p className="text-xs text-muted-foreground/70 mt-1.5 flex gap-2">
                            <span className="font-mono">{activeMeta.params}</span>
                            <span>·</span>
                            <span>{activeMeta.speed}</span>
                          </p>
                        )}
                      </div>
                      <Select value={dropdownValue} onValueChange={handleModelSelect}>
                        <SelectTrigger className="w-auto min-w-[210px] h-9 text-sm shrink-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {whisperAvailable.map(([key, info]) => (
                            <SelectItem key={key} value={key}>
                              <span className="flex items-center gap-2">
                                <img src={`${import.meta.env.BASE_URL}logo-openai.png`} alt="OpenAI" className="w-4 h-4 rounded-full shrink-0 object-cover" />
                                {key.charAt(0).toUpperCase() + key.slice(1)} ({info.size})
                              </span>
                            </SelectItem>
                          ))}
                          {parakeet.status.available && (
                            <SelectItem value={PARAKEET_KEY}>
                              <span className="flex items-center gap-2">
                                <img src={`${import.meta.env.BASE_URL}logo-nvidia.png`} alt="NVIDIA" className="w-4 h-4 rounded-full shrink-0 object-cover" />
                                Parakeet TDT ({parakeet.status.size})
                              </span>
                            </SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  </WellItem>
                </WellCard>
              </Well>

              {/* Whisper model cards */}
              <ModelCards
                models={models}
                activeModel={engine === 'parakeet' ? '' : (config.model || 'small')}
                onDownload={startDownload}
                onPause={pauseDownload}
                onCancel={cancelDownload}
                onDelete={deleteModel}
              />

              {/* Parakeet model card — always shown so users can download it */}
              <ParakeetModelCard
                status={parakeet.status}
                isActive={engine === 'parakeet'}
                onDownload={parakeet.startDownload}
                onCancel={parakeet.cancelDownload}
                onDelete={parakeet.deleteModel}
              />

              {/* Translation — disabled when Parakeet is active */}
              <Well className="mt-5">
                <WellHeader>
                  <WellTitle>Translation <Badge variant="outline" className="text-[9px] ml-1"> 🐛 Beta</Badge></WellTitle>
                </WellHeader>
                <WellCard>
                  <WellItem>
                    <div className={cn('flex items-center justify-between gap-4', engine === 'parakeet' && 'opacity-50')}>
                      <div className="min-w-0">
                        <span className="text-sm font-medium">Translate to English</span>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {engine === 'parakeet'
                            ? 'Not available — Parakeet is English only'
                            : 'Speak in another language — Whisper will transcribe and translate to English'}
                        </p>
                      </div>
                      <Switch
                        checked={config.translationEnabled ?? false}
                        onCheckedChange={setTranslationEnabled}
                        disabled={engine === 'parakeet'}
                      />
                    </div>
                  </WellItem>

                  {config.translationEnabled && engine !== 'parakeet' && (
                    <WellItem>
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <span className="text-sm font-medium">Speaking language</span>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            The language you will speak in
                          </p>
                        </div>
                        <LanguageCombobox
                          value={config.translationLanguage || 'ja'}
                          onChange={setTranslationLanguage}
                        />
                      </div>
                    </WellItem>
                  )}
                </WellCard>
              </Well>
            </>
          )}

          {activeTab === 'grammar' && (() => {
            const grammarDownloaded = aiModels
              ? Object.entries(aiModels).filter(([, m]) => m.source === 'grammar' && m.available)
              : [];
            const activeGrammarKey = config.grammarModel ?? (grammarDownloaded[0]?.[0] ?? '');
            return (
              <>
                {/* Grammar correction settings */}
                <Well className="mb-5">
                  <WellHeader>
                    <WellTitle>Grammar Correction <Badge variant="outline" className="text-[9px] ml-1">Beta</Badge></WellTitle>
                  </WellHeader>
                  <WellCard>
                    <WellItem>
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <span className="text-sm font-medium">Enable AI Grammar correction</span>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Automatically clean up transcriptions after each recording
                          </p>
                        </div>
                        <Switch checked={config.grammarEnabled ?? false} onCheckedChange={setGrammarEnabled} />
                      </div>
                    </WellItem>
                    {grammarDownloaded.length > 0 && (config.grammarEnabled ?? false) && (
                      <WellItem>
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <span className="text-sm font-medium">Grammar model</span>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Which model to use for correction
                            </p>
                          </div>
                          <Select value={activeGrammarKey} onValueChange={(k) => ipc.setGrammarModel(k)}>
                            <SelectTrigger className="w-auto min-w-[180px] h-9 text-sm shrink-0">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {grammarDownloaded.map(([key, info]) => (
                                <SelectItem key={key} value={key}>
                                  {info.name} ({info.size})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </WellItem>
                    )}
                  </WellCard>
                </Well>

                {/* Single unified model list */}
                <Well>
                  <WellHeader>
                    <WellTitle>AI Models</WellTitle>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      <span className="font-medium text-violet-600 dark:text-violet-400">Grammar</span> models correct transcriptions ·{' '}
                      <span className="font-medium text-blue-600 dark:text-blue-400">Agent</span> models power voice commands · any downloaded model works for Agent
                    </p>
                  </WellHeader>
                  <WellCard>
                    {!aiModels && (
                      <WellItem>
                        <p className="text-xs text-muted-foreground">Loading…</p>
                      </WellItem>
                    )}
                    {aiModels && Object.entries(aiModels).map(([key, info]) => (
                      <AiModelRow key={key} modelKey={key} info={info} />
                    ))}
                  </WellCard>
                </Well>
              </>
            );
          })()}
        </div>
      </ScrollArea>
    </div>
  );
}
