import { useRef } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DictionaryPackCatalogItem } from '@/lib/ipc';

/** Opaque pastel card fills (light + dark) */
const PASTEL_CARD: string[] = [
  'bg-[#E8E4F0] dark:bg-[#2f2b3d]',
  'bg-[#E8F0EA] dark:bg-[#26332a]',
  'bg-[#E2E8F4] dark:bg-[#252e3d]',
  'bg-[#F0E6E4] dark:bg-[#3a2c2c]',
  'bg-[#F3EFE6] dark:bg-[#353028]',
  'bg-[#E6F2F4] dark:bg-[#243338]',
];

type DictionaryPacksCarouselProps = {
  packs: DictionaryPackCatalogItem[];
  loading: boolean;
  error: string | null;
  packBusy: string | null;
  onPreview: (pack: DictionaryPackCatalogItem) => void;
  onInstall: (packId: string) => void;
  onUninstall: (packId: string) => void;
};

export function DictionaryPacksCarousel({
  packs,
  loading,
  error,
  packBusy,
  onPreview,
  onInstall,
  onUninstall,
}: DictionaryPacksCarouselProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  const scrollBy = (direction: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const delta = Math.min(240, Math.floor(el.clientWidth * 0.62));
    el.scrollBy({ left: direction * delta, behavior: 'smooth' });
  };

  if (error) {
    return (
      <div className="mb-6 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mb-6 py-8 text-center text-sm text-muted-foreground">Loading preset packs…</div>
    );
  }

  if (packs.length === 0) {
    return (
      <div className="mb-6 py-6 text-center text-sm text-muted-foreground">No preset packs available.</div>
    );
  }

  return (
    <section className="mb-6 min-w-0 w-full max-w-full">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-2 [-webkit-app-region:no-drag]">
        <h3 className="text-sm font-semibold tracking-tight text-foreground">
          Handpicked for your dictionary
        </h3>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            aria-label="Scroll packs left"
            onClick={() => scrollBy(-1)}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-6 w-6 rounded-md"
            aria-label="Scroll packs right"
            onClick={() => scrollBy(1)}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="relative min-h-[120px] min-w-0 w-full max-w-full [-webkit-app-region:no-drag]">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-[2] w-10 sm:w-14" aria-hidden>
          <div className="absolute inset-0 bg-gradient-to-r from-background to-transparent" />
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 z-[2] w-10 sm:w-14" aria-hidden>
          <div className="absolute inset-0 bg-gradient-to-l from-background to-transparent" />
        </div>

        <div
          ref={scrollerRef}
          className="flex min-w-0 w-full max-w-full snap-x snap-mandatory gap-3 overflow-x-auto overflow-y-hidden scroll-smooth pb-0.5 pl-0.5 pr-0.5 pt-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          style={{
            maskImage:
              'linear-gradient(90deg, transparent 0%, black min(40px, 7%), black calc(100% - min(40px, 7%)), transparent 100%)',
            WebkitMaskImage:
              'linear-gradient(90deg, transparent 0%, black min(40px, 7%), black calc(100% - min(40px, 7%)), transparent 100%)',
          }}
        >
          {packs.map((pack, index) => {
            const cardBg = PASTEL_CARD[index % PASTEL_CARD.length];
            const busy = packBusy === pack.id;

            return (
              <article
                key={pack.id}
                role="button"
                tabIndex={0}
                onClick={() => onPreview(pack)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onPreview(pack);
                  }
                }}
                className={`${cardBg} flex w-[min(100%,200px)] shrink-0 cursor-pointer snap-start flex-col gap-2 rounded-2xl p-3 text-left shadow-sm ring-1 ring-black/[0.06] transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:ring-white/[0.08]`}
              >
                <div className="min-w-0">
                  <span className="text-[8px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {pack.category}
                  </span>
                  <h4 className="mt-1 line-clamp-2 text-sm font-bold leading-5 tracking-tight text-foreground">
                    {pack.title}
                  </h4>
                  <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-muted-foreground">
                    {pack.description}
                  </p>
                </div>
                <div className="mt-auto flex items-end justify-between gap-2 border-t border-border/40 pt-2">
                  <div className="min-w-0 text-[9px] leading-tight text-muted-foreground">
                    {pack.entryCount} term{pack.entryCount === 1 ? '' : 's'}
                    {pack.installed ? (
                      <span className="ml-1 font-medium text-emerald-600 dark:text-emerald-400">
                        · Installed
                      </span>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {pack.installed ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-6 min-h-6 rounded-full px-2 text-[10px] bg-background text-foreground hover:bg-accent"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          onUninstall(pack.id);
                        }}
                      >
                        Remove
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-6 min-h-6 rounded-full px-2 text-[10px] font-medium bg-background text-foreground hover:bg-accent"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          onInstall(pack.id);
                        }}
                      >
                        Install
                      </Button>
                    )}
                    <button
                      type="button"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-sm transition-transform hover:bg-accent active:scale-95"
                      aria-label={`Preview ${pack.title}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onPreview(pack);
                      }}
                    >
                      <ArrowRight className="h-3 w-3" strokeWidth={2.5} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
