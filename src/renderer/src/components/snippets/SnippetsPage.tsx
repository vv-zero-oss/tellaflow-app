import { useState, useEffect } from 'react';
import { Plus, ArrowRight, Zap, Pencil } from 'lucide-react';
import { TrashIcon } from '@/components/icons/TrashIcon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Well, WellHeader, WellTitle, WellCard, WellItem } from '@/components/ui/well';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useSnippets } from '@/hooks/use-snippets';

interface SnippetFormState {
  id: number | null;
  trigger: string;
  content: string;
}

export function SnippetsPage() {
  const { entries, add, remove, update } = useSnippets();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<SnippetFormState>({ id: null, trigger: '', content: '' });

  const isEditing = form.id !== null;

  const openAdd = () => {
    setForm({ id: null, trigger: '', content: '' });
    setDialogOpen(true);
  };

  const openEdit = (entry: { id: number; trigger: string; content: string }) => {
    setForm({ id: entry.id, trigger: entry.trigger, content: entry.content });
    setDialogOpen(true);
  };

  const handleSave = () => {
    const trigger = form.trigger.trim();
    const content = form.content.trim();
    if (!trigger || !content) return;

    if (isEditing) {
      update(form.id!, trigger, content);
    } else {
      add(trigger, content);
    }
    setDialogOpen(false);
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="px-7 pt-12 pb-4 [-webkit-app-region:drag]">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight">Snippets</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Say a trigger phrase and it expands into the full content.
            </p>
          </div>
          <div className="[-webkit-app-region:no-drag]">
            <Button variant="outline" size="sm" onClick={openAdd}>
              <Plus className="w-3.5 h-3.5" />
              Add new
            </Button>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-7 py-6">
          <Well>
            <WellHeader>
              <WellTitle>Snippets ({entries.length})</WellTitle>
            </WellHeader>

            {entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Zap className="w-10 h-10 opacity-25 mb-3" strokeWidth={1.2} />
                <p className="text-sm">No snippets yet</p>
                <p className="text-xs opacity-60 mt-1 text-center max-w-[300px]">
                  Create a snippet so when you say a trigger phrase, it gets replaced with the expanded content.
                </p>
                <Button variant="outline" size="sm" className="mt-4" onClick={openAdd}>
                  <Plus className="w-3.5 h-3.5" />
                  Add your first snippet
                </Button>
              </div>
            ) : (
              <WellCard>
                {entries.map((entry) => (
                  <SnippetRow
                    key={entry.id}
                    entry={entry}
                    onEdit={openEdit}
                    onRemove={remove}
                  />
                ))}
              </WellCard>
            )}
          </Well>
        </div>
      </ScrollArea>

      <SnippetDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        form={form}
        setForm={setForm}
        isEditing={isEditing}
        onSave={handleSave}
      />
    </div>
  );
}

function SnippetDialog({
  open,
  onOpenChange,
  form,
  setForm,
  isEditing,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: SnippetFormState;
  setForm: React.Dispatch<React.SetStateAction<SnippetFormState>>;
  isEditing: boolean;
  onSave: () => void;
}) {
  const [triggerRef, setTriggerRef] = useState<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open && triggerRef) {
      setTimeout(() => triggerRef.focus(), 50);
    }
  }, [open, triggerRef]);

  const canSave = form.trigger.trim().length > 0 && form.content.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit snippet' : 'Add snippet'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update the trigger phrase or its expansion.'
              : 'When this phrase appears in your transcription, it will be replaced with the expansion.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <label className="text-sm font-medium mb-2 block">Trigger phrase</label>
            <Input
              ref={setTriggerRef}
              placeholder='e.g. "USA"'
              value={form.trigger}
              onChange={(e) => setForm((f) => ({ ...f, trigger: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const next = (e.target as HTMLElement).closest('.space-y-4')?.querySelector('textarea');
                  next?.focus();
                }
              }}
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-2 block">Expansion</label>
            <textarea
              placeholder="e.g. United States of America"
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.metaKey && canSave) {
                  e.preventDefault();
                  onSave();
                }
              }}
              rows={4}
              className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="outline" size="sm" onClick={onSave} disabled={!canSave}>
            {isEditing ? 'Save changes' : 'Add snippet'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SnippetRow({
  entry,
  onEdit,
  onRemove,
}: {
  entry: { id: number; trigger: string; content: string };
  onEdit: (entry: { id: number; trigger: string; content: string }) => void;
  onRemove: (id: number) => void;
}) {
  return (
    <WellItem className="group">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          <Badge variant="secondary" className="shrink-0 mt-0.5">{entry.trigger}</Badge>
          <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-1" />
          <p className="text-sm text-muted-foreground min-w-0 break-words leading-relaxed">
            {entry.content}
          </p>
        </div>
        <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => onEdit(entry)}
          >
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            onClick={() => onRemove(entry.id)}
          >
            <TrashIcon className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </WellItem>
  );
}
