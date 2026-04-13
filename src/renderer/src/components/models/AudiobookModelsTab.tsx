import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Well, WellHeader, WellTitle, WellCard, WellItem } from '@/components/ui/well';
import { CheckCircle2, Download, Loader2, Trash2 } from 'lucide-react';
import { ipc } from '@/lib/ipc';
import type { NeuTTSStatus, NeuTTSFileStatus } from '@/lib/ipc';

function fmtBytes(b: number) {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
  if (b >= 1e6) return (b / 1e6).toFixed(0) + ' MB';
  return (b / 1e3).toFixed(0) + ' KB';
}

interface FileProgress {
  downloaded: number;
  total: number;
}

function FileRow({
  info,
  progress,
  isDownloading,
  onDelete,
}: {
  info: NeuTTSFileStatus;
  progress: FileProgress | null;
  isDownloading: boolean;
  onDelete: () => void;
}) {
  const pct = progress && progress.total > 0
    ? Math.round((progress.downloaded / progress.total) * 100)
    : isDownloading ? null : 0;

  return (
    <WellItem>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{info.label}</span>
            <Badge variant="outline" className="text-[10px] h-4 px-1.5">{info.size}</Badge>
            {info.available && (
              <Badge variant="downloaded" className="text-[10px] h-4 px-1.5 flex items-center gap-1">
                <CheckCircle2 className="w-2.5 h-2.5" />
                Downloaded
              </Badge>
            )}
          </div>
        </div>

        {info.available && (
          <Button
            variant="outline" size="sm"
            className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
            onClick={onDelete}
          >
            <Trash2 className="w-3 h-3 mr-1" />
            Remove
          </Button>
        )}
      </div>

      {isDownloading && (
        <div className="mt-3">
          {pct !== null ? (
            <Progress value={pct} />
          ) : (
            <Progress value={undefined} className="animate-pulse" />
          )}
          <div className="flex justify-between text-[11px] text-muted-foreground mt-1.5">
            <span>{isDownloading ? 'Downloading…' : ''}</span>
            {progress && progress.total > 0 && (
              <span className="shrink-0 ml-2 tabular-nums">
                {fmtBytes(progress.downloaded)} / {fmtBytes(progress.total)} · {pct ?? 0}%
              </span>
            )}
          </div>
        </div>
      )}
    </WellItem>
  );
}

export function AudiobookModelsTab() {
  const [status, setStatus] = useState<NeuTTSStatus | null>(null);
  const [fileProgress, setFileProgress] = useState<Record<string, FileProgress>>({});
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const s = await ipc.getNeuTTSStatus();
      setStatus(s);
      if (s.ready) setIsDownloading(false);
    } catch (err) {
      console.error('[AudiobookModelsTab] failed to get NeuTTS status:', err);
    }
  }, []);

  useEffect(() => {
    refresh();

    const unsubProgress = ipc.onNeuTTSProgress(({ key, downloaded, total }) => {
      setFileProgress(prev => ({ ...prev, [key]: { downloaded, total } }));
      setIsDownloading(true);
    });

    const unsubStatus = ipc.onNeuTTSStatusChanged((s) => {
      setStatus(s);
      if (s.ready) setIsDownloading(false);
    });

    const unsubError = ipc.onNeuTTSError(({ key, error }) => {
      setDownloadError(`${key}: ${error}`);
      setIsDownloading(false);
    });

    return () => {
      unsubProgress();
      unsubStatus();
      unsubError();
    };
  }, [refresh]);

  function handleDownload() {
    setDownloadError('');
    setIsDownloading(true);
    ipc.startNeuTTSDownload();
  }

  function handleCancel() {
    ipc.cancelNeuTTSDownload();
    setIsDownloading(false);
    setFileProgress({});
  }

  function handleDelete() {
    ipc.deleteNeuTTSModel();
    setFileProgress({});
    refresh();
  }

  if (!status) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const totalBytes = status.backbone.bytes + status.decoder.bytes;
  const downloadedBytes = (fileProgress.backbone?.downloaded ?? 0) + (fileProgress.decoder?.downloaded ?? 0);
  const overallPct = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0;

  return (
    <>
      {status.ready && (
        <Well className="mb-5">
          <WellHeader>
            <WellTitle>Status</WellTitle>
          </WellHeader>
          <WellCard>
            <WellItem>
              <p className="text-sm text-muted-foreground leading-relaxed">
                NeuTTS Nano is ready. Open the{' '}
                <span className="text-foreground font-medium">Audiobooks</span>{' '}
                page to create your first audiobook.
              </p>
            </WellItem>
          </WellCard>
        </Well>
      )}

      <Well>
        <WellHeader>
          <WellTitle>NeuTTS Nano Voice Model</WellTitle>
        </WellHeader>
        <WellCard>
          {/* Overall action row */}
          <WellItem>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold">NeuTTS Nano (English)</span>
                  <Badge variant="outline" className="text-[10px] h-4 px-1.5">Excellent</Badge>
                  <Badge variant="outline" className="text-[10px] h-4 px-1.5">~500 MB total</Badge>
                  <Badge variant="outline" className="text-[10px] h-4 px-1.5">5 voices</Badge>
                  {status.ready && (
                    <Badge className="text-[10px] h-4 px-1.5 bg-foreground text-background">Active</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  State-of-the-art on-device TTS by Neuphonic. GGUF backbone via llama.cpp + NeuCodec ONNX decoder. Ultra-fast on Apple Silicon.
                </p>
              </div>

              <div className="flex gap-1.5 shrink-0">
                {!status.ready && !isDownloading && (
                  <Button variant="outline" size="sm" onClick={handleDownload}>
                    <Download className="w-3 h-3 mr-1" />
                    Download
                  </Button>
                )}
                {isDownloading && (
                  <Button variant="outline" size="sm" onClick={handleCancel}>
                    Cancel
                  </Button>
                )}
                {status.ready && (
                  <Button
                    variant="outline" size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={handleDelete}
                  >
                    <Trash2 className="w-3 h-3 mr-1" />
                    Remove all
                  </Button>
                )}
              </div>
            </div>

            {/* Overall progress bar while downloading */}
            {isDownloading && downloadedBytes > 0 && (
              <div className="mt-3">
                <Progress value={overallPct} />
                <div className="flex justify-between text-[11px] text-muted-foreground mt-1.5">
                  <span>
                    {!status.backbone.available ? 'Downloading backbone…'
                      : !status.decoder.available ? 'Downloading audio decoder…'
                      : 'Finalizing…'}
                  </span>
                  <span className="tabular-nums shrink-0">
                    {fmtBytes(downloadedBytes)} / {fmtBytes(totalBytes)} · {overallPct}%
                  </span>
                </div>
              </div>
            )}

            {downloadError && (
              <p className="text-xs text-destructive mt-2">Error: {downloadError}</p>
            )}
          </WellItem>

          {/* Individual file rows */}
          <FileRow
            info={status.backbone}
            progress={fileProgress.backbone ?? null}
            isDownloading={isDownloading && !status.backbone.available}
            onDelete={() => ipc.deleteNeuTTSModel('backbone')}
          />
          <FileRow
            info={status.decoder}
            progress={fileProgress.decoder ?? null}
            isDownloading={isDownloading && status.backbone.available && !status.decoder.available}
            onDelete={() => ipc.deleteNeuTTSModel('decoder')}
          />
        </WellCard>
      </Well>

      <p className="text-[11px] text-muted-foreground mt-4 px-1 leading-relaxed">
        Downloads ~500 MB total (185 MB backbone + 312 MB NeuCodec int8 decoder). Models are stored locally and used entirely offline. Built on{' '}
        <span className="text-foreground">llama.cpp</span> for Apple Silicon acceleration.
      </p>
    </>
  );
}
