import { useState } from 'react';
import { Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Well, WellHeader, WellTitle, WellCard, WellItem } from '@/components/ui/well';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import type { Models } from '@/lib/ipc';

interface ModelCardsProps {
  models: Models;
  activeModel: string;
  onDownload: (key: string) => void;
  onPause: (key: string) => void;
  onCancel: (key: string) => void;
  onDelete: (key: string) => void;
}

function fmtBytes(b: number) {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
  if (b >= 1e6) return (b / 1e6).toFixed(0) + ' MB';
  return (b / 1e3).toFixed(0) + ' KB';
}

const MODEL_INFO: Record<string, { params: string; speed: string; description: string; languages: { flag: string; name: string }[] }> = {
  tiny: {
    params: '39M parameters',
    speed: '~10× faster than large',
    description: 'Smallest model. Great for quick drafts or low-power devices. Lower accuracy on accents or technical terms.',
    languages: [
      { flag: '🇺🇸', name: 'English' },
      { flag: '🇪🇸', name: 'Spanish' },
      { flag: '🇫🇷', name: 'French' },
      { flag: '🇩🇪', name: 'German' },
      { flag: '🇮🇹', name: 'Italian' },
      { flag: '🇵🇹', name: 'Portuguese' },
    ],
  },
  base: {
    params: '74M parameters',
    speed: '~7× faster than large',
    description: 'Lightweight with decent accuracy. Good balance of speed and quality for everyday dictation.',
    languages: [
      { flag: '🇺🇸', name: 'English' },
      { flag: '🇪🇸', name: 'Spanish' },
      { flag: '🇫🇷', name: 'French' },
      { flag: '🇩🇪', name: 'German' },
      { flag: '🇮🇹', name: 'Italian' },
      { flag: '🇵🇹', name: 'Portuguese' },
      { flag: '🇳🇱', name: 'Dutch' },
      { flag: '🇵🇱', name: 'Polish' },
    ],
  },
  small: {
    params: '244M parameters',
    speed: '~4× faster than large',
    description: 'Best all-around choice. Solid accuracy across accents and vocabulary with fast inference.',
    languages: [
      { flag: '🇺🇸', name: 'English' },
      { flag: '🇪🇸', name: 'Spanish' },
      { flag: '🇫🇷', name: 'French' },
      { flag: '🇩🇪', name: 'German' },
      { flag: '🇮🇹', name: 'Italian' },
      { flag: '🇵🇹', name: 'Portuguese' },
      { flag: '🇳🇱', name: 'Dutch' },
      { flag: '🇷🇺', name: 'Russian' },
      { flag: '🇨🇳', name: 'Chinese' },
      { flag: '🇯🇵', name: 'Japanese' },
    ],
  },
  medium: {
    params: '769M parameters',
    speed: '~2× faster than large',
    description: 'Near state-of-the-art accuracy. Handles complex vocabulary and accents well.',
    languages: [
      { flag: '🇺🇸', name: 'English' },
      { flag: '🇪🇸', name: 'Spanish' },
      { flag: '🇫🇷', name: 'French' },
      { flag: '🇩🇪', name: 'German' },
      { flag: '🇮🇹', name: 'Italian' },
      { flag: '🇵🇹', name: 'Portuguese' },
      { flag: '🇷🇺', name: 'Russian' },
      { flag: '🇨🇳', name: 'Chinese' },
      { flag: '🇯🇵', name: 'Japanese' },
      { flag: '🇰🇷', name: 'Korean' },
      { flag: '🇸🇦', name: 'Arabic' },
      { flag: '🇮🇳', name: 'Hindi' },
      { flag: '🇹🇷', name: 'Turkish' },
      { flag: '🇵🇱', name: 'Polish' },
    ],
  },
  large: {
    params: '1.55B parameters',
    speed: 'Baseline speed',
    description: 'Highest accuracy, lowest word-error rate. Ideal for professional or multilingual transcription.',
    languages: [
      { flag: '🇺🇸', name: 'English' },
      { flag: '🇪🇸', name: 'Spanish' },
      { flag: '🇫🇷', name: 'French' },
      { flag: '🇩🇪', name: 'German' },
      { flag: '🇮🇹', name: 'Italian' },
      { flag: '🇵🇹', name: 'Portuguese' },
      { flag: '🇷🇺', name: 'Russian' },
      { flag: '🇨🇳', name: 'Chinese' },
      { flag: '🇯🇵', name: 'Japanese' },
      { flag: '🇰🇷', name: 'Korean' },
      { flag: '🇸🇦', name: 'Arabic' },
      { flag: '🇮🇳', name: 'Hindi' },
      { flag: '🇹🇷', name: 'Turkish' },
      { flag: '🇵🇱', name: 'Polish' },
      { flag: '🇸🇪', name: 'Swedish' },
      { flag: '🇺🇦', name: 'Ukrainian' },
      { flag: '🇮🇱', name: 'Hebrew' },
      { flag: '🇹🇭', name: 'Thai' },
      { flag: '🇻🇳', name: 'Vietnamese' },
      { flag: '🇮🇩', name: 'Indonesian' },
    ],
  },
};

export function ModelCards({ models, activeModel, onDownload, onPause, onCancel, onDelete }: ModelCardsProps) {
  const [cancelPending, setCancelPending] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState<string | null>(null);

  return (
    <>
    <Dialog open={cancelPending !== null} onOpenChange={(open) => { if (!open) setCancelPending(null); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Cancel download?</DialogTitle>
          <DialogDescription>
            The partial download of the{' '}
            <span className="font-semibold capitalize text-foreground">{cancelPending}</span> model
            will be discarded. You can restart the download at any time.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => setCancelPending(null)}>
            Keep downloading
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (cancelPending) onCancel(cancelPending);
              setCancelPending(null);
            }}
          >
            Yes, cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={deletePending !== null} onOpenChange={(open) => { if (!open) setDeletePending(null); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Remove model?</DialogTitle>
          <DialogDescription>
            The{' '}
            <span className="font-semibold capitalize text-foreground">{deletePending}</span> model
            will be deleted from your disk. You can re-download it at any time.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => setDeletePending(null)}>
            Keep it
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (deletePending) onDelete(deletePending);
              setDeletePending(null);
            }}
          >
            Yes, remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <TooltipProvider delayDuration={200}>
      <Well className="mb-7">
        <WellHeader>
          <WellTitle>
            <span className="flex items-center gap-2">
              <img src={`${import.meta.env.BASE_URL}logo-openai.png`} alt="OpenAI" className="w-5 h-5 rounded-full object-cover" />
              Whisper Models
            </span>
          </WellTitle>
        </WellHeader>
        <WellCard>
          {Object.entries(models).map(([key, info]) => {
            const isActive = key === activeModel;
            const pct = info.total > 0 ? Math.round((info.downloaded / info.total) * 100) : 0;
            const meta = MODEL_INFO[key];

            return (
              <WellItem key={key}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <span className="text-sm font-semibold capitalize">{key}</span>
                      {isActive && info.available && <Badge variant="downloaded">Active</Badge>}
                      {!isActive && info.available && <Badge variant="secondary">Downloaded</Badge>}
                      {meta && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                            >
                              <Info className="w-3.5 h-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-[240px] space-y-1.5 py-2.5 px-3">
                            <p className="font-semibold text-[11px] uppercase tracking-wide text-foreground/70">
                              {key.charAt(0).toUpperCase() + key.slice(1)} model
                            </p>
                            <p className="text-[12px] font-medium">{meta.params}</p>
                            <p className="text-[11px] text-muted-foreground">{meta.speed}</p>
                            <p className="text-[11px] text-muted-foreground leading-relaxed border-t border-border/50 pt-1.5 mt-1.5">
                              {meta.description}
                            </p>
                            {meta.languages && (
                              <div className="border-t border-border/50 pt-1.5 mt-1.5">
                                <p className="text-[10px] uppercase tracking-wide text-foreground/50 mb-1.5">Languages</p>
                                <div className="flex flex-wrap gap-1">
                                  {meta.languages.map(({ flag, name }) => (
                                    <span key={name} title={name} className="text-[13px] leading-none">
                                      {flag}
                                    </span>
                                  ))}
                                  {key === 'large' && (
                                    <span className="text-[10px] text-muted-foreground self-center">+79 more</span>
                                  )}
                                </div>
                              </div>
                            )}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    <div className="flex gap-3.5 mt-1 text-xs text-muted-foreground">
                      <span>{info.size}</span>
                      <span>Quality: {info.quality}</span>
                    </div>
                  </div>
                  <div className="flex gap-1.5 items-center">
                    {info.status === 'downloaded' && !isActive && (
                      <Button variant="outline" size="sm" onClick={() => setDeletePending(key)}>Remove</Button>
                    )}
                    {info.status === 'not_downloaded' && (
                      <Button variant="outline" size="sm" onClick={() => onDownload(key)}>Download</Button>
                    )}
                    {info.status === 'downloading' && (
                      <Button variant="outline" size="sm" onClick={() => onPause(key)}>Pause</Button>
                    )}
                    {info.status === 'paused' && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => onDownload(key)}>Resume</Button>
                        <Button variant="outline" size="sm" onClick={() => setCancelPending(key)}>Cancel</Button>
                      </>
                    )}
                  </div>
                </div>
                {(info.status === 'downloading' || info.status === 'paused') && (
                  <div className="mt-3">
                    <Progress value={pct} />
                    <div className="flex justify-between text-[11px] text-muted-foreground mt-1.5">
                      <span>{fmtBytes(info.downloaded)} / {fmtBytes(info.total)}</span>
                      <span>{info.status === 'paused' ? 'Paused' : 'Downloading'} · {pct}%</span>
                    </div>
                  </div>
                )}
              </WellItem>
            );
          })}
        </WellCard>
      </Well>
    </TooltipProvider>
    </>
  );
}
