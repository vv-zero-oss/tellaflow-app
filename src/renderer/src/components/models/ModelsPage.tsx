import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, Check, Search } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Well, WellHeader, WellTitle, WellCard, WellItem } from '@/components/ui/well';
import { ModelCards } from './ModelCards';
import { ParakeetModelCard, type ParakeetCardMeta } from './ParakeetModelCard';
import { useModels } from '@/hooks/use-models';
import { useParakeet } from '@/hooks/use-parakeet';
import { ipc, type AppConfig, type TranscriptionEngine } from '@/lib/ipc';
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
  turbo:    { params: '809M params',  speed: '~6× faster than large' },
  large:    { params: '1.55B params', speed: '~1× realtime' },
  parakeet: { params: '600M params',  speed: '~3–4× realtime' },
  'parakeet-unified': { params: '600M params', speed: '~3–4× realtime · most accurate English' },
};

// Dropdown values for the two Parakeet variants (the engine is 'parakeet').
const PARAKEET_KEY = 'parakeet';
const PARAKEET_UNIFIED_KEY = 'parakeet-unified';

const PARAKEET_UNIFIED_META: ParakeetCardMeta = {
  title: 'Parakeet Unified 0.6b',
  name: 'parakeet-unified-en-0.6b',
  badge: 'New',
  description:
    "NVIDIA's newest English Parakeet (April 2026). Slightly more accurate than TDT v2 at the same speed, with punctuation and casing. Runs on the ONNX runtime (int8) — no GPU required.",
  bullets: ['Lower word-error rate than TDT v2 (5.9 vs 6.0 on the Open ASR leaderboard)', 'Smaller download than v2 (~500 MB)', 'English only — no translation support'],
};

interface ModelsPageProps {
  config: AppConfig;
  setModel: (model: string) => void;
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

export function ModelsPage({ config, setModel, setTranslationEnabled, setTranslationLanguage, setTranscriptionEngine }: ModelsPageProps) {
  const { models, startDownload, pauseDownload, cancelDownload, deleteModel } = useModels();
  const parakeet = useParakeet('v2');
  const parakeetUnified = useParakeet('unified');
  const parakeetVariant = config.parakeetVariant ?? 'v2';

  const whisperAvailable = Object.entries(models).filter(([, info]) => info.available);
  const engine = config.transcriptionEngine || 'parakeet';

  // Unified dropdown value: 'parakeet' when that engine is active, else the whisper model key
  const dropdownValue = engine === 'parakeet'
    ? (parakeetVariant === 'unified' ? PARAKEET_UNIFIED_KEY : PARAKEET_KEY)
    : (config.model || 'small');
  const activeMeta = MODEL_META[dropdownValue];

  // Parakeet is English only; Whisper turbo was trained without translation.
  const noTranslation = engine === 'parakeet' || config.model === 'turbo';

  function handleModelSelect(value: string) {
    if (value === PARAKEET_KEY || value === PARAKEET_UNIFIED_KEY) {
      ipc.setParakeetVariant(value === PARAKEET_UNIFIED_KEY ? 'unified' : 'v2');
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
          The speech recognition model Tellaflow transcribes with, on this Mac.
        </p>
      </div>


      <ScrollArea className="flex-1">
        <div className="px-7 py-5 [-webkit-app-region:no-drag]">
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
                          {parakeetUnified.status.available && (
                            <SelectItem value={PARAKEET_UNIFIED_KEY}>
                              <span className="flex items-center gap-2">
                                <img src={`${import.meta.env.BASE_URL}logo-nvidia.png`} alt="NVIDIA" className="w-4 h-4 rounded-full shrink-0 object-cover" />
                                Parakeet Unified ({parakeetUnified.status.size})
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

              {/* Parakeet model cards — always shown so users can download them */}
              <ParakeetModelCard
                status={parakeetUnified.status}
                meta={PARAKEET_UNIFIED_META}
                isActive={engine === 'parakeet' && parakeetVariant === 'unified'}
                onDownload={parakeetUnified.startDownload}
                onCancel={parakeetUnified.cancelDownload}
                onDelete={parakeetUnified.deleteModel}
              />
              <ParakeetModelCard
                status={parakeet.status}
                isActive={engine === 'parakeet' && parakeetVariant !== 'unified'}
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
                    <div className={cn('flex items-center justify-between gap-4', noTranslation && 'opacity-50')}>
                      <div className="min-w-0">
                        <span className="text-sm font-medium">Translate to English</span>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {engine === 'parakeet'
                            ? 'Not available — Parakeet is English only'
                            : config.model === 'turbo'
                              ? 'Not available with Whisper Turbo — pick another Whisper model to translate'
                              : 'Speak in another language — Whisper will transcribe and translate to English'}
                        </p>
                      </div>
                      <Switch
                        checked={config.translationEnabled ?? false}
                        onCheckedChange={setTranslationEnabled}
                        disabled={noTranslation}
                      />
                    </div>
                  </WellItem>

                  {config.translationEnabled && !noTranslation && (
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
        </div>
      </ScrollArea>
    </div>
  );
}
