import { useState } from 'react';
import { AlertTriangle, RotateCcw, PlayIcon, PauseIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Well, WellHeader, WellTitle, WellCard, WellItem } from '@/components/ui/well';
import { TrashIcon } from '@/components/icons/TrashIcon';
import { useFailedJobs } from '@/hooks/use-failed-jobs';
import { ipc, type FailedJob } from '@/lib/ipc';
import { cn } from '@/lib/utils';

function describe(job: FailedJob) {
  const when = new Date(job.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const len = job.durationSec ? ` · ${job.durationSec >= 60 ? `${Math.floor(job.durationSec / 60)}m ${Math.round(job.durationSec % 60)}s` : `${Math.round(job.durationSec)}s`}` : '';
  const kind = job.source === 'meeting' ? 'Meeting segment' : job.source === 'recovered' ? 'Recovered recording' : 'Dictation';
  return `${kind} · ${when}${len}`;
}

function Spinner() {
  return <span className="border-muted border-t-foreground size-3 animate-spin rounded-full border-2 inline-block" />;
}

/** Failed / crash-interrupted recordings with their audio, retryable after restarts. */
export function NeedsAttention() {
  const { jobs, busy, retryingAll, retry, retryAll, discard } = useFailedJobs();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [playing, setPlaying] = useState<{ id: string; audio: HTMLAudioElement; url: string } | null>(null);

  if (jobs.length === 0) return null;

  const stopPlayback = () => {
    if (!playing) return;
    playing.audio.pause();
    URL.revokeObjectURL(playing.url);
    setPlaying(null);
  };

  const togglePlay = async (job: FailedJob) => {
    if (playing?.id === job.id) { stopPlayback(); return; }
    stopPlayback();
    if (!job.audioPath) return;
    const data = await ipc.getAudioData(job.audioPath);
    if (!data) return;
    const url = URL.createObjectURL(new Blob([data], { type: 'audio/wav' }));
    const audio = new Audio(url);
    audio.onended = () => { URL.revokeObjectURL(url); setPlaying(null); };
    setPlaying({ id: job.id, audio, url });
    audio.play().catch(() => {});
  };

  const onRetry = async (id: string) => {
    setErrors((e) => ({ ...e, [id]: '' }));
    try {
      await retry(id);
    } catch (err) {
      setErrors((e) => ({ ...e, [id]: (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }));
    }
  };

  return (
    <Well className="mb-6">
      <WellHeader>
        <div className="flex items-center justify-between w-full">
          <WellTitle>
            <span className="inline-flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
              Needs attention ({jobs.length})
            </span>
          </WellTitle>
          {jobs.length > 1 && (
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => retryAll()} disabled={retryingAll}>
              {retryingAll ? <Spinner /> : <RotateCcw className="w-3 h-3 mr-1" />}
              Retry all
            </Button>
          )}
        </div>
      </WellHeader>
      <WellCard>
        {jobs.map((job) => (
          <WellItem key={job.id} className="group">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm">{describe(job)}</p>
                <p className={cn('text-xs mt-0.5', errors[job.id] ? 'text-destructive' : 'text-muted-foreground')}>
                  {errors[job.id] || job.error || 'Transcription failed — audio saved.'}
                </p>
              </div>
              <div className="flex gap-1 shrink-0">
                {job.audioPath && (
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" title={playing?.id === job.id ? 'Stop' : 'Play recording'} onClick={() => togglePlay(job)}>
                    {playing?.id === job.id ? <PauseIcon className="w-3.5 h-3.5" /> : <PlayIcon className="w-3.5 h-3.5" />}
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-blue-500" title="Retry transcription" disabled={!!busy[job.id] || retryingAll} onClick={() => onRetry(job.id)}>
                  {busy[job.id] ? <Spinner /> : <RotateCcw className="w-3.5 h-3.5" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  title="Discard recording"
                  disabled={!!busy[job.id]}
                  onClick={() => { if (playing?.id === job.id) stopPlayback(); discard(job.id); }}
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </WellItem>
        ))}
      </WellCard>
    </Well>
  );
}
