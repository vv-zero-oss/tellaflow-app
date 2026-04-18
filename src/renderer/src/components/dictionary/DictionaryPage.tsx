import { useEffect, useState, type KeyboardEvent } from 'react';
import { ArrowRight, BookOpen } from 'lucide-react';
import { TrashIcon } from '@/components/icons/TrashIcon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { DictionaryPacksCarousel } from '@/components/dictionary/DictionaryPacksCarousel';
import { Well, WellHeader, WellTitle, WellCard, WellItem } from '@/components/ui/well';
import { useDictionary } from '@/hooks/use-dictionary';
import { useDictionaryPacks } from '@/hooks/use-dictionary-packs';
import type { DictionaryPackCatalogItem } from '@/lib/ipc';

export function DictionaryPage() {
  const { entries, add, remove, update, refresh: refreshEntries } = useDictionary();
  const { packs, loading: packsLoading, error: packsError, installPack, uninstallPack } =
    useDictionaryPacks();
  const [newFrom, setNewFrom] = useState('');
  const [newTo, setNewTo] = useState('');
  const [previewPack, setPreviewPack] = useState<DictionaryPackCatalogItem | null>(null);
  const [packBusy, setPackBusy] = useState<string | null>(null);

  const handleAdd = () => {
    const from = newFrom.trim();
    if (!from) return;
    add(from, newTo.trim());
    setNewFrom('');
    setNewTo('');
  };

  const handleFromKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).nextElementSibling?.nextElementSibling?.querySelector?.('input')?.focus?.();
  };

  const handleToKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') handleAdd();
  };

  const runInstall = async (packId: string) => {
    setPackBusy(packId);
    try {
      await installPack(packId);
      await refreshEntries();
    } finally {
      setPackBusy(null);
    }
  };

  const runUninstall = async (packId: string) => {
    setPackBusy(packId);
    try {
      await uninstallPack(packId);
      await refreshEntries();
    } finally {
      setPackBusy(null);
    }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="px-7 pt-12 pb-4 [-webkit-app-region:drag]">
        <h2 className="text-xl font-bold tracking-tight">Dictionary</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Add word replacements for commonly misheard words due to accent or pronunciation.
        </p>
      </div>

        <div className="min-w-0 max-w-full px-7 pb-6 overflow-scroll">
      
        
          <Well className="mb-7">
            <WellHeader>
              <WellTitle>Add Entry</WellTitle>
            </WellHeader>
            <WellCard>
              <WellItem>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Misheard word"
                    value={newFrom}
                    onChange={(e) => setNewFrom(e.target.value)}
                    onKeyDown={handleFromKeyDown}
                    className="flex-1"
                  />
                  <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  <Input
                    placeholder="Correct word"
                    value={newTo}
                    onChange={(e) => setNewTo(e.target.value)}
                    onKeyDown={handleToKeyDown}
                    className="flex-1"
                  />
                  <Button variant="outline" size="sm" onClick={handleAdd}>
                    Add
                  </Button>
                </div>
              </WellItem>
            </WellCard>
          </Well>
          <DictionaryPacksCarousel
            packs={packs}
            loading={packsLoading}
            error={packsError}
            packBusy={packBusy}
            onPreview={setPreviewPack}
            onInstall={runInstall}
            onUninstall={runUninstall}
          />
          <Well>
            <WellHeader>
              <WellTitle>Entries ({entries.length})</WellTitle>
            </WellHeader>

            {entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <BookOpen className="w-10 h-10 opacity-25 mb-3" strokeWidth={1.2} />
                <p className="text-sm">No entries yet</p>
                <p className="text-xs opacity-60 mt-1">Add misheard words above to improve transcription accuracy</p>
              </div>
            ) : (
              <WellCard>
                {entries.map((entry) => (
                  <DictionaryRow
                    key={entry.id}
                    entry={entry}
                    onRemove={remove}
                    onUpdate={update}
                  />
                ))}
              </WellCard>
            )}
          </Well>
        </div>
  

      <Dialog open={!!previewPack} onOpenChange={(open) => !open && setPreviewPack(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{previewPack?.title}</DialogTitle>
            <DialogDescription>{previewPack?.description}</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[50vh] pr-3 border rounded-md">
            <div className="p-3 space-y-1.5 text-sm font-mono">
              {previewPack?.entries.map((e, i) => (
                <div key={`${e.from}-${i}`} className="flex gap-2 break-all">
                  <span className="text-muted-foreground shrink-0">{i + 1}.</span>
                  <span>{e.from}</span>
                  <ArrowRight className="w-3 h-3 shrink-0 mt-1 text-muted-foreground" />
                  <span>{e.to}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setPreviewPack(null)}>
              Close
            </Button>
            {previewPack && !previewPack.installed && (
              <Button
                disabled={packBusy === previewPack.id}
                onClick={async () => {
                  const id = previewPack.id;
                  setPreviewPack(null);
                  await runInstall(id);
                }}
              >
                Install this pack
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DictionaryRow({
  entry,
  onRemove,
  onUpdate,
}: {
  entry: { id: number; from: string; to: string; packId?: string | null };
  onRemove: (id: number) => void;
  onUpdate: (id: number, from: string, to: string) => void;
}) {
  const [from, setFrom] = useState(entry.from);
  const [to, setTo] = useState(entry.to);

  useEffect(() => {
    setFrom(entry.from);
    setTo(entry.to);
  }, [entry.from, entry.to, entry.id]);

  const handleBlur = () => {
    if (from.trim() && (from !== entry.from || to !== entry.to)) {
      onUpdate(entry.id, from.trim(), to.trim());
    }
  };

  return (
    <WellItem>
      <div className="flex items-center gap-2">
        {entry.packId ? (
          <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0" title="From preset pack">
            pack
          </Badge>
        ) : null}
        <Input value={from} onChange={(e) => setFrom(e.target.value)} onBlur={handleBlur} className="flex-1" />
        <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
        <Input value={to} onChange={(e) => setTo(e.target.value)} onBlur={handleBlur} className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
          onClick={() => onRemove(entry.id)}
        >
          <TrashIcon className="w-3.5 h-3.5" />
        </Button>
      </div>
    </WellItem>
  );
}
