import { useState, useMemo } from 'react';
import { Search, X, ArrowRight, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { DictionaryPackCatalogItem } from '@/lib/ipc';

const BOOK_SPINES: string[] = [
  'bg-[#c8c5be] dark:bg-[#444240]',
  'bg-[#b8bfb8] dark:bg-[#3a403a]',
  'bg-[#c8c0b8] dark:bg-[#443e38]',
  'bg-[#bfbcc8] dark:bg-[#3a3844]',
  'bg-[#b8c2c8] dark:bg-[#383e44]',
  'bg-[#c8c4b0] dark:bg-[#44422e]',
];

const BOOK_ILLU: string[] = [
  'from-[#e8e5df] to-[#f0eee9] dark:from-[#2a2926] dark:to-[#222120]',
  'from-[#dfe5df] to-[#eaf0ea] dark:from-[#262a26] dark:to-[#202320]',
  'from-[#e8e2da] to-[#f0ece6] dark:from-[#2a2622] dark:to-[#221f1c]',
  'from-[#dedce6] to-[#eae8f0] dark:from-[#26252a] dark:to-[#201f24]',
  'from-[#dce2e8] to-[#e8eef0] dark:from-[#242828] dark:to-[#1e2224]',
  'from-[#e8e4d4] to-[#f0eee2] dark:from-[#2a2820] dark:to-[#22211a]',
];

function toRoman(n: number): string {
  const numerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  return numerals[n % numerals.length];
}

type DictionaryPacksCarouselProps = {
  packs: DictionaryPackCatalogItem[];
  loading: boolean;
  error: string | null;
  packBusy: string | null;
  onPreview: (pack: DictionaryPackCatalogItem) => void;
  onInstall: (packId: string) => void;
  onUninstall: (packId: string) => void;
};

function BookCard({
  pack,
  index,
  busy,
  onPreview,
  onInstall,
  onUninstall,
}: {
  pack: DictionaryPackCatalogItem;
  index: number;
  busy: boolean;
  onPreview: () => void;
  onInstall: () => void;
  onUninstall: () => void;
}) {
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onPreview}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPreview(); } }}
      className="
        bg-[#f5f4f1] dark:bg-[#1e1e1c] flex w-full min-h-[200px] cursor-pointer
        overflow-hidden select-none
        rounded-tl-[3px] rounded-tr-[9px] rounded-br-[9px] rounded-bl-[3px]
        shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_2px_4px_rgba(0,0,0,0.04)]
        dark:shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_2px_6px_rgba(0,0,0,0.3)]
        transition-all duration-200
        hover:shadow-[0_0_0_1px_rgba(0,0,0,0.12),0_3px_8px_rgba(0,0,0,0.07)]
        dark:hover:shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_4px_12px_rgba(0,0,0,0.4)]
        hover:-translate-y-0.5
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
      "
    >
      {/* Spine */}
      <div className={`w-[5px] shrink-0 ${BOOK_SPINES[index % BOOK_SPINES.length]}`} />
      <div className="w-[6px] shrink-0 flex flex-col justify-center gap-[2px] opacity-30 dark:opacity-20 py-3">
        {Array.from({ length: 14 }).map((_, i) => (
          <div key={i} className="h-px bg-foreground/30 mx-0.5" />
        ))}
      </div>

      {/* Content */}
      <div className="flex flex-col grow min-w-0">
        <div className="pt-3.5 pb-2.5 px-3">
          <h4 className="text-[12px] font-semibold leading-[16px] tracking-[-0.15px] text-foreground/90 line-clamp-2">
            {pack.title}
          </h4>
        </div>

        <div className="px-3">
          <div className="h-px bg-foreground/[0.08]" />
        </div>

        <div className="mt-1.5 px-3">
          <span className="text-[6.5px] font-semibold tracking-[0.06em] text-foreground/40 uppercase font-mono">
            {pack.category} {toRoman(index)}
          </span>
        </div>

        <div className="mt-1.5 px-3 flex-1 min-h-0">
          <div className={`w-full h-full min-h-[58px] rounded-md bg-gradient-to-br ${BOOK_ILLU[index % BOOK_ILLU.length]} flex items-center justify-center`}>
            <span className="text-lg font-semibold text-foreground/20 select-none">
              {pack.title.charAt(0).toUpperCase()}
            </span>
          </div>
        </div>

        <div className="flex justify-between items-center pt-1.5 pb-2 px-3">
          <span className="text-[6.5px] font-medium font-mono text-foreground/40 leading-[10px]">
            {pack.entryCount} terms
            {pack.installed && (
              <span className="text-emerald-600 dark:text-emerald-400"> · added</span>
            )}
          </span>
          {pack.installed ? (
            <button
              type="button"
              className="text-[7px] font-mono font-medium text-foreground/35 hover:text-foreground/60 transition-colors"
              disabled={busy}
              onClick={(e) => { e.stopPropagation(); onUninstall(); }}
            >
              Remove
            </button>
          ) : (
            <button
              type="button"
              className="text-[7px] font-mono font-bold text-foreground/55 hover:text-foreground/80 transition-colors"
              disabled={busy}
              onClick={(e) => { e.stopPropagation(); onInstall(); }}
            >
              Install
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

export function DictionaryPacksCarousel({
  packs,
  loading,
  error,
  packBusy,
  onPreview,
  onInstall,
  onUninstall,
}: DictionaryPacksCarouselProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return packs;
    return packs.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q),
    );
  }, [packs, search]);

  if (loading || error || packs.length === 0) return null;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => setOpen(true)}
      >
        <BookOpen className="w-3.5 h-3.5" />
        Browse dictionaries
      </Button>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setSearch(''); }}>
        <DialogContent className="max-w-[620px] h-[80vh] flex flex-col p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-5 pt-5 pb-0">
            <DialogTitle>Handpicked dictionaries</DialogTitle>
          </DialogHeader>

          {/* Search */}
          <div className="px-5 pt-3 pb-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <input
                className="w-full h-8 rounded-md bg-muted/50 border border-input pl-8 pr-8 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="Search packs..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setSearch('')}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Grid */}
          <ScrollArea className="flex-1 overflow-y-auto">
            <div className="px-5 pb-5">
              {filtered.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No packs match "{search}"
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  {filtered.map((pack, index) => (
                    <BookCard
                      key={pack.id}
                      pack={pack}
                      index={index}
                      busy={packBusy === pack.id}
                      onPreview={() => { setOpen(false); onPreview(pack); }}
                      onInstall={() => onInstall(pack.id)}
                      onUninstall={() => onUninstall(pack.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
