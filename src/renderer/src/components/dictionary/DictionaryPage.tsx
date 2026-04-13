import { useState, type KeyboardEvent } from 'react';
import { ArrowRight, BookOpen } from 'lucide-react';
import { TrashIcon } from '@/components/icons/TrashIcon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Well, WellHeader, WellTitle, WellCard, WellItem } from '@/components/ui/well';
import { useDictionary } from '@/hooks/use-dictionary';

export function DictionaryPage() {
  const { entries, add, remove, update } = useDictionary();
  const [newFrom, setNewFrom] = useState('');
  const [newTo, setNewTo] = useState('');

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

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="px-7 pt-12 pb-4 [-webkit-app-region:drag]">
        <h2 className="text-xl font-bold tracking-tight">Dictionary</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Add word replacements for commonly misheard words due to accent or pronunciation.
        </p>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-7 py-6">
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
                  <Button variant="outline" size="sm" onClick={handleAdd}>Add</Button>
                </div>
              </WellItem>
            </WellCard>
          </Well>

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
      </ScrollArea>
    </div>
  );
}

function DictionaryRow({
  entry,
  onRemove,
  onUpdate,
}: {
  entry: { id: number; from: string; to: string };
  onRemove: (id: number) => void;
  onUpdate: (id: number, from: string, to: string) => void;
}) {
  const [from, setFrom] = useState(entry.from);
  const [to, setTo] = useState(entry.to);

  const handleBlur = () => {
    if (from.trim() && (from !== entry.from || to !== entry.to)) {
      onUpdate(entry.id, from.trim(), to.trim());
    }
  };

  return (
    <WellItem>
      <div className="flex items-center gap-2">
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
