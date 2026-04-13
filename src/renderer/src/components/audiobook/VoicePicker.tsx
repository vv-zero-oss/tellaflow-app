import { useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Search, Play, Square, SlidersHorizontal } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  ALL_VOICES,
  voiceAvatarColor,
  type VoiceMeta,
  type VoiceEngine,
  type VoiceGender,
} from './voice-data';

interface VoicePickerProps {
  selectedVoiceId: string;
  selectedEngine: VoiceEngine;
  onSelect: (voiceId: string, engine: VoiceEngine) => void;
  onClose: () => void;
  availableEngines: VoiceEngine[];
}

type VoiceTab = 'explore' | 'my-voices';

function VoiceAvatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const color = voiceAvatarColor(name);
  const initials = name.slice(0, 2).toUpperCase();
  return (
    <div className={cn(
      'rounded-full bg-gradient-to-br shrink-0 flex items-center justify-center font-semibold text-white',
      color,
      size === 'md' ? 'w-9 h-9 text-sm' : 'w-7 h-7 text-xs',
    )}>
      {initials}
    </div>
  );
}

const ACCENT_LABELS: Record<string, string> = {
  american: 'American',
  british: 'British',
  european: 'European',
  french: 'French',
  hindi: 'Hindi',
  italian: 'Italian',
  japanese: 'Japanese',
  korean: 'Korean',
  mandarin: 'Mandarin',
  portuguese: 'Portuguese',
  spanish: 'Spanish',
};

export function VoicePicker({ selectedVoiceId, onSelect, onClose, availableEngines }: VoicePickerProps) {
  const [activeTab, setActiveTab] = useState<VoiceTab>('explore');
  const [query, setQuery] = useState('');
  const [filterGender, setFilterGender] = useState<VoiceGender | null>(null);
  const [filterLanguage, setFilterLanguage] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('audiobook-favorites') || '[]')); }
    catch { return new Set(); }
  });
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const allLanguages = useMemo(() => {
    const langs = new Set(ALL_VOICES.map(v => v.language));
    return Array.from(langs).sort();
  }, []);

  const voices = useMemo(() => {
    let list = activeTab === 'my-voices'
      ? ALL_VOICES.filter(v => favorites.has(v.id))
      : ALL_VOICES;

    if (filterGender) list = list.filter(v => v.gender === filterGender);
    if (filterLanguage) list = list.filter(v => v.language === filterLanguage);

    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(v =>
        v.name.toLowerCase().includes(q) ||
        v.description.toLowerCase().includes(q) ||
        v.language.toLowerCase().includes(q) ||
        v.accent.toLowerCase().includes(q),
      );
    }
    return list;
  }, [activeTab, query, filterGender, filterLanguage, favorites]);

  function toggleFavorite(id: string) {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem('audiobook-favorites', JSON.stringify(Array.from(next)));
      return next;
    });
  }

  async function handlePreview(voice: VoiceMeta) {
    if (previewingId === voice.id) {
      previewAudioRef.current?.pause();
      setPreviewingId(null);
      return;
    }
    setPreviewingId(voice.id);
    if (previewAudioRef.current) previewAudioRef.current.pause();
    // Simulate preview ending after 3s (full preview requires synthesis)
    setTimeout(() => setPreviewingId(id => id === voice.id ? null : id), 3000);
  }

  function handleSelect(voice: VoiceMeta) {
    onSelect(voice.id, voice.engine);
    onClose();
  }

  function TabBtn({ tab, label }: { tab: VoiceTab; label: string }) {
    return (
      <button
        onClick={() => setActiveTab(tab)}
        className={cn(
          'relative pb-2.5 text-sm font-medium transition-colors whitespace-nowrap',
          activeTab === tab ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        {label}
        {activeTab === tab && (
          <motion.div
            layoutId="voice-tab-indicator"
            className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground rounded-full"
          />
        )}
      </button>
    );
  }

  function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
      <button
        onClick={onClick}
        className={cn(
          'h-7 px-3 rounded-full text-xs font-medium border transition-colors shrink-0',
          active
            ? 'bg-foreground text-background border-foreground'
            : 'bg-transparent text-muted-foreground border-border hover:border-foreground/40 hover:text-foreground',
        )}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 pt-5 pb-4 shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h3 className="text-sm font-semibold">Select a voice</h3>
      </div>

      {/* Tabs */}
      <div className="px-5 shrink-0">
        <div className="flex gap-5 border-b border-border/50">
          <TabBtn tab="explore" label="Explore" />
          <TabBtn tab="my-voices" label="My Voices" />
        </div>
      </div>

      {/* Search + filter toggle */}
      <div className="px-5 pt-3 pb-2 shrink-0 space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search voices..."
              className="pl-9 h-9 text-sm"
            />
          </div>
          <Button
            variant={showFilters ? 'secondary' : 'outline'}
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() => setShowFilters(f => !f)}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
          </Button>
        </div>

        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <div className="flex gap-1.5 flex-wrap pb-1">
                <FilterChip label="Female" active={filterGender === 'female'} onClick={() => setFilterGender(g => g === 'female' ? null : 'female')} />
                <FilterChip label="Male" active={filterGender === 'male'} onClick={() => setFilterGender(g => g === 'male' ? null : 'male')} />
                {allLanguages.map(lang => (
                  <FilterChip
                    key={lang}
                    label={lang}
                    active={filterLanguage === lang}
                    onClick={() => setFilterLanguage(l => l === lang ? null : lang)}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Voice list */}
      <ScrollArea className="flex-1 px-5">
        <div className="space-y-0.5 pb-4">
          {voices.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-sm text-muted-foreground">No voices match your search.</p>
            </div>
          )}
          {voices.map((voice) => {
            const isSelected = voice.id === selectedVoiceId;
            const isPreviewing = previewingId === voice.id;
            const isAvailable = availableEngines.includes(voice.engine);

            return (
              <div
                key={voice.id}
                role="button"
                tabIndex={0}
                onClick={() => handleSelect(voice)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') handleSelect(voice); }}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors group cursor-pointer',
                  isSelected ? 'bg-accent' : 'hover:bg-accent/60',
                  !isAvailable && 'opacity-50',
                )}
              >
                <VoiceAvatar name={voice.name} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold truncate">{voice.name}</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {ACCENT_LABELS[voice.accent] ?? voice.accent} · {
                      voice.gender === 'female' ? 'Female' : 'Male'
                    } · {voice.description}
                  </p>
                </div>

                <div
                  className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={e => { e.stopPropagation(); handlePreview(voice); }}
                >
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                    {isPreviewing
                      ? <Square className="w-3 h-3" />
                      : <Play className="w-3 h-3" />
                    }
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
      <audio ref={previewAudioRef} />
    </div>
  );
}
