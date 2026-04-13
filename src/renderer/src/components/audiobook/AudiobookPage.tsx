import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, BookOpen, Trash2, Clock, Upload, Link, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { ipc } from '@/lib/ipc';
import type { AudiobookRecord } from '@/lib/ipc';
import { VoicePicker } from './VoicePicker';
import { AudiobookEditor } from './AudiobookEditor';
import { getVoiceById, voiceAvatarColor, DEFAULT_VOICE_ID, type VoiceEngine } from './voice-data';

/* ── helpers ─────────────────────────────────────────────────────────────── */

function readingTime(totalChunks: number) {
  const mins = Math.round(totalChunks * 0.8);
  if (mins < 60) return `~${mins} min`;
  return `~${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function BookAvatar({ title, size = 'md' }: { title: string; size?: 'sm' | 'md' | 'lg' }) {
  const color = voiceAvatarColor(title);
  const initials = title.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const sizeClass = size === 'lg' ? 'w-14 h-14 text-xl rounded-xl' : size === 'md' ? 'w-10 h-10 text-base rounded-lg' : 'w-8 h-8 text-xs rounded-md';
  return (
    <div className={cn('bg-gradient-to-br shrink-0 flex items-center justify-center font-bold text-white', color, sizeClass)}>
      {initials || '?'}
    </div>
  );
}

type CreateTab = 'upload' | 'url';

/* ── Create dialog ───────────────────────────────────────────────────────── */

interface CreateDialogProps {
  open: boolean;
  onClose: () => void;
  availableEngines: VoiceEngine[];
  onCreated: (book: AudiobookRecord) => void;
}

function CreateDialog({ open, onClose, availableEngines, onCreated }: CreateDialogProps) {
  const [tab, setTab] = useState<CreateTab>('upload');
  const [url, setUrl] = useState('');
  const [voiceId, setVoiceId] = useState(DEFAULT_VOICE_ID);
  const [engine] = useState<VoiceEngine>('neutts');
  const [autoAssign, setAutoAssign] = useState(false);
  const [showVoicePicker, setShowVoicePicker] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [preview, setPreview] = useState<{ title: string; author: string; text: string; filePath?: string } | null>(null);

  const selectedVoice = getVoiceById(voiceId);

  async function handleUpload() {
    const result = await ipc.pickPdfFile();
    if (result) setPreview(result);
  }

  async function handleFetchUrl() {
    if (!url.trim()) return;
    setIsLoading(true);
    try {
      const result = await ipc.fetchUrlText(url.trim());
      if (result) setPreview(result);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreate() {
    if (!preview) return;
    setIsLoading(true);
    try {
      const book = await ipc.createAudiobook({
        title: preview.title,
        author: preview.author,
        text: preview.text,
        filePath: preview.filePath,
        sourceUrl: tab === 'url' ? url : undefined,
        voiceId,
        engine,
      });
      onCreated(book);
      onClose();
      resetState();
    } finally {
      setIsLoading(false);
    }
  }

  function resetState() {
    setTab('upload');
    setUrl('');
    setPreview(null);
    setIsLoading(false);
    setShowVoicePicker(false);
  }

  function TabBtn({ t, label, icon }: { t: CreateTab; label: string; icon: React.ReactNode }) {
    return (
      <button
        onClick={() => { setTab(t); setPreview(null); }}
        className={cn(
          'relative pb-2.5 text-sm font-medium transition-colors flex items-center gap-1.5',
          tab === t ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        {icon}{label}
        {tab === t && (
          <motion.div
            layoutId="create-tab-indicator"
            className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground rounded-full"
          />
        )}
      </button>
    );
  }

  if (showVoicePicker) {
    return (
      <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); resetState(); } }}>
        <DialogContent className="max-w-md p-0 h-[580px] flex flex-col overflow-hidden">
          <VoicePicker
            selectedVoiceId={voiceId}
            selectedEngine={engine}
            availableEngines={availableEngines}
            onSelect={(id) => { setVoiceId(id); }}
            onClose={() => setShowVoicePicker(false)}
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); resetState(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create audiobook</DialogTitle>
          <DialogDescription>Create high-quality audio to listen to anywhere.</DialogDescription>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-5 border-b border-border/50 -mt-1">
          <TabBtn t="upload" label={preview && tab === 'upload' ? 'Document' : 'Upload a document'} icon={<Upload className="w-3.5 h-3.5" />} />
          <TabBtn t="url" label="Import URL" icon={<Link className="w-3.5 h-3.5" />} />
        </div>

        {/* Tab content */}
        <div className="min-h-[160px]">
          {tab === 'upload' && !preview && (
            <button
              onClick={handleUpload}
              className="w-full h-36 rounded-xl border-2 border-dashed border-border hover:border-foreground/30 transition-colors flex flex-col items-center justify-center gap-2.5 text-muted-foreground hover:text-foreground"
            >
              <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                <Upload className="w-5 h-5" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">Click to upload, or drag and drop</p>
                <p className="text-xs mt-0.5">.pdf, .txt, .epub</p>
              </div>
            </button>
          )}

          {tab === 'upload' && preview && (
            <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/50 border border-border">
              <BookAvatar title={preview.title} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{preview.title}</p>
                {preview.author && <p className="text-xs text-muted-foreground truncate">{preview.author}</p>}
                <p className="text-xs text-muted-foreground mt-0.5">{preview.text.split(/\s+/).length.toLocaleString()} words</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setPreview(null)} className="shrink-0">
                Change
              </Button>
            </div>
          )}

          {tab === 'url' && (
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Import URL</label>
                <div className="flex gap-2">
                  <Input
                    value={url}
                    onChange={e => setUrl(e.target.value)}
                    placeholder="https://www.gutenberg.org/..."
                    className="flex-1"
                    onKeyDown={e => e.key === 'Enter' && handleFetchUrl()}
                  />
                  <Button variant="outline" onClick={handleFetchUrl} disabled={!url.trim() || isLoading}>
                    {isLoading ? '...' : 'Fetch'}
                  </Button>
                </div>
              </div>
              {preview && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/50 border border-border">
                  <BookAvatar title={preview.title} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{preview.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{preview.text.split(/\s+/).length.toLocaleString()} words</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Voice selector */}
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Default voice</label>
            <button
              onClick={() => setShowVoicePicker(true)}
              className="w-full flex items-center gap-3 h-10 px-3 rounded-lg border border-input bg-transparent hover:bg-accent/50 transition-colors text-sm"
            >
              {selectedVoice ? (
                <>
                  <div className={cn(
                    'w-6 h-6 rounded-full bg-gradient-to-br shrink-0 flex items-center justify-center text-[10px] font-bold text-white',
                    voiceAvatarColor(selectedVoice.name),
                  )}>
                    {selectedVoice.name.slice(0, 2).toUpperCase()}
                  </div>
                  <span className="font-medium">{selectedVoice.name}</span>
                  <span className="text-muted-foreground text-xs">· {selectedVoice.language} · {selectedVoice.gender === 'female' ? 'Female' : 'Male'}</span>
                </>
              ) : (
                <span className="text-muted-foreground">Select a voice</span>
              )}
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground ml-auto" />
            </button>
          </div>

          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Auto-assign voices</span>
                <Badge variant="secondary" className="text-[10px] h-4 px-1.5">Alpha</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                Automatically detect characters and assign matching voices.
                This process can take significant time for longer content.
              </p>
            </div>
            <Switch checked={autoAssign} onCheckedChange={setAutoAssign} className="shrink-0 mt-0.5" />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end pt-1">
          <Button
            onClick={handleCreate}
            disabled={!preview || isLoading}
            className="min-w-[140px]"
          >
            {isLoading ? 'Creating...' : 'Create audiobook'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Book card ───────────────────────────────────────────────────────────── */

function BookCard({
  book,
  onOpen,
  onDelete,
}: {
  book: AudiobookRecord;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const progressPct = book.totalChunks > 0 ? Math.round((book.currentChunk / book.totalChunks) * 100) : 0;
  const voice = getVoiceById(book.voiceId);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      className="group relative bg-card rounded-xl border border-border/50 p-4 cursor-pointer hover:border-border transition-colors flex gap-3"
      onClick={onOpen}
    >
      <BookAvatar title={book.title} size="lg" />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">{book.title}</p>
        {book.author && <p className="text-xs text-muted-foreground truncate mt-0.5">{book.author}</p>}

        <div className="flex items-center gap-3 mt-2">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            {readingTime(book.totalChunks)}
          </div>
          {voice && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <div className={cn('w-3 h-3 rounded-full bg-gradient-to-br', voiceAvatarColor(voice.name))} />
              {voice.name}
            </div>
          )}
        </div>

        {progressPct > 0 && (
          <div className="mt-2.5">
            <div className="h-1 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-foreground/60 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">{progressPct}% complete</p>
          </div>
        )}
      </div>

      {/* Delete button */}
      <button
        onClick={e => { e.stopPropagation(); onDelete(); }}
        className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </motion.div>
  );
}

/* ── Main page ───────────────────────────────────────────────────────────── */

export function AudiobookPage({ onNavigateModels }: { onNavigateModels: () => void }) {
  const [books, setBooks] = useState<AudiobookRecord[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [activeBook, setActiveBook] = useState<AudiobookRecord | null>(null);
  const [availableEngines, setAvailableEngines] = useState<VoiceEngine[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  const load = useCallback(async () => {
    const [b, neuStatus] = await Promise.all([
      ipc.getAudiobooks(),
      ipc.getNeuTTSStatus(),
    ]);
    setBooks(b);
    setAvailableEngines(neuStatus?.ready ? ['neutts'] : []);
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    load();
    const unsub = ipc.onAudiobooksChanged(setBooks);
    const unsubNeu = ipc.onNeuTTSStatusChanged((s) => {
      setAvailableEngines(s?.ready ? ['neutts'] : []);
    });
    return () => { unsub(); unsubNeu(); };
  }, [load]);

  async function handleDelete(id: number) {
    await ipc.deleteAudiobook(id);
  }

  if (activeBook) {
    return (
      <AudiobookEditor
        book={activeBook}
        onBack={() => setActiveBook(null)}
      />
    );
  }

  const hasModels = availableEngines.length > 0;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="px-7 pt-12 pb-1 [-webkit-app-region:drag] flex items-end justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Audiobooks</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Turn any document into a narrated audiobook.
          </p>
        </div>
          <Button
          size="sm"
          className="[-webkit-app-region:no-drag] mb-1"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          New Audiobook
        </Button>
      </div>

      <ScrollArea className="flex-1 [-webkit-app-region:no-drag]">
        <div className="px-7 py-5">
          {/* No models banner */}
          {isLoaded && !hasModels && books.length === 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-muted/60 border border-border/60 text-sm"
            >
              <p className="text-muted-foreground leading-relaxed">
                <span className="text-foreground font-medium">No voice model downloaded yet.</span>{' '}
                You can import books now — download a voice model when you're ready to listen.
              </p>
              <Button variant="outline" size="sm" className="shrink-0" onClick={onNavigateModels}>
                Get voices
              </Button>
            </motion.div>
          )}

          {/* Empty library */}
          {isLoaded && books.length === 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center justify-center py-12 text-center gap-4"
            >
              <div className="w-16 h-16 rounded-2xl bg-muted/50 border border-border flex items-center justify-center">
                <BookOpen className="w-8 h-8 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-semibold">Your audiobook library is empty</p>
                <p className="text-xs text-muted-foreground mt-1.5">
                  Import a PDF, text file, or URL to get started.
                </p>
              </div>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="w-3.5 h-3.5 mr-1.5" />
                Create your first audiobook
              </Button>
            </motion.div>
          )}

          {/* Book grid */}
          {books.length > 0 && (
            <div className="space-y-2">
              <AnimatePresence mode="popLayout">
                {books.map(book => (
                  <BookCard
                    key={book.id}
                    book={book}
                    onOpen={() => setActiveBook(book)}
                    onDelete={() => handleDelete(book.id)}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </ScrollArea>

      <CreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        availableEngines={availableEngines}
        onCreated={(book) => {
          setBooks(prev => [book, ...prev]);
          setActiveBook(book);
        }}
      />
    </div>
  );
}
