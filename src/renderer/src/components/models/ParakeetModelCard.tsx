import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Well, WellHeader, WellTitle, WellCard, WellItem } from '@/components/ui/well';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import type { ParakeetModelInfo } from '@/lib/ipc';

interface ParakeetModelCardProps {
  status: ParakeetModelInfo;
  isActive?: boolean;
  onDownload: () => void;
  onCancel: () => void;
  onDelete: () => void;
}

function fmtBytes(b: number) {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
  if (b >= 1e6) return (b / 1e6).toFixed(0) + ' MB';
  return (b / 1e3).toFixed(0) + ' KB';
}

export function ParakeetModelCard({ status, isActive = false, onDownload, onCancel, onDelete }: ParakeetModelCardProps) {
  const [cancelPending, setCancelPending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);

  const pct = status.total > 0 ? Math.round((status.downloaded / status.total) * 100) : 0;

  return (
    <>
      <Dialog open={cancelPending} onOpenChange={(open) => { if (!open) setCancelPending(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Cancel download?</DialogTitle>
            <DialogDescription>
              The partial download of <span className="font-semibold text-foreground">Parakeet TDT</span> will
              be discarded. You can restart the download at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setCancelPending(false)}>Keep downloading</Button>
            <Button variant="destructive" onClick={() => { onCancel(); setCancelPending(false); }}>Yes, cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deletePending} onOpenChange={(open) => { if (!open) setDeletePending(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove model?</DialogTitle>
            <DialogDescription>
              <span className="font-semibold text-foreground">Parakeet TDT 0.6b v2</span> will be deleted
              from your disk. You can re-download it at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeletePending(false)}>Keep it</Button>
            <Button variant="destructive" onClick={() => { onDelete(); setDeletePending(false); }}>Yes, remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Well className="mb-7">
        <WellHeader>
          <WellTitle>
            <span className="flex items-center gap-2">
              <img src={`${import.meta.env.BASE_URL}logo-nvidia.png`} alt="NVIDIA" className="w-5 h-5 rounded-full object-cover" />
              Parakeet TDT 0.6b v2
            </span>
          </WellTitle>
        </WellHeader>
        <WellCard>
          <WellItem>
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="text-sm font-semibold">parakeet-tdt-0.6b-v2</span>
                    {isActive && status.available && <Badge variant="downloaded">Active</Badge>}
                    {!isActive && status.available && <Badge variant="secondary">Downloaded</Badge>}
                    <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground border-muted-foreground/30">NVIDIA NeMo</Badge>
                  </div>
                  <div className="flex gap-3.5 mt-1 text-xs text-muted-foreground">
                    <span>{status.size}</span>
                    <span>·</span>
                    <span>600M parameters</span>
                    <span>·</span>
                    <span>English only</span>
                  </div>
                </div>
                <div className="flex gap-1.5 items-center shrink-0">
                  {status.status === 'downloaded' && !isActive && (
                    <Button variant="outline" size="sm" onClick={() => setDeletePending(true)}>Remove</Button>
                  )}
                  {status.status === 'not_downloaded' && (
                    <Button variant="outline" size="sm" onClick={onDownload}>Download</Button>
                  )}
                  {status.status === 'downloading' && (
                    <Button variant="outline" size="sm" onClick={() => setCancelPending(true)}>Cancel</Button>
                  )}
                  {status.status === 'paused' && (
                    <>
                      <Button variant="outline" size="sm" onClick={onDownload}>Resume</Button>
                      <Button variant="outline" size="sm" onClick={() => setCancelPending(true)}>Cancel</Button>
                    </>
                  )}
                </div>
              </div>

              {(status.status === 'downloading' || status.status === 'paused') && (
                <div>
                  <Progress value={pct} />
                  <div className="flex justify-between text-[11px] text-muted-foreground mt-1.5">
                    <span>{fmtBytes(status.downloaded)} / {fmtBytes(status.total)}</span>
                    <span>{status.status === 'paused' ? 'Paused' : 'Downloading'} · {pct}%</span>
                  </div>
                  {status.status === 'downloading' && (
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Large download (~632 MB). Extraction will happen automatically once complete.
                    </p>
                  )}
                </div>
              )}

              <div className="text-xs text-muted-foreground leading-relaxed border-t border-border/40 pt-3">
                <p>
                  NVIDIA&apos;s Parakeet TDT is a state-of-the-art English ASR model with significantly lower
                  word-error rates than Whisper large-v3 on most benchmarks. Uses the ONNX runtime (int8
                  quantised) — no GPU required.
                </p>
                <ul className="mt-2 space-y-0.5 list-disc list-inside text-muted-foreground/80">
                  <li>~3–4× faster than real-time on Apple Silicon (CPU)</li>
                  <li>Outputs clean text with punctuation</li>
                  <li>English only — no translation support</li>
                </ul>
              </div>
            </div>
          </WellItem>
        </WellCard>
      </Well>
    </>
  );
}
