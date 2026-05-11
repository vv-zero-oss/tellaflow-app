import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { WellItem } from '@/components/ui/well';
import type { UpdateStatus } from '@/lib/ipc';

function formatBytes(n: number) {
  if (!n || n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function UpdateRow() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    window.tellaflow.getUpdateStatus().then(setStatus).catch(() => {});
    const off = window.tellaflow.onUpdateStatus(setStatus);
    return off;
  }, []);

  const phase = status?.phase ?? 'idle';
  const checking = phase === 'checking';
  const downloading = phase === 'downloading';
  const downloaded = phase === 'downloaded';
  const available = phase === 'available';
  const upToDate = phase === 'not-available';
  const errored = phase === 'error';

  const handleCheck = () => window.tellaflow.checkForUpdates();
  const handleInstall = () => window.tellaflow.installUpdate();

  let detail: string | null = null;
  if (checking) detail = 'Checking for updates…';
  else if (available) detail = status?.updateVersion ? `Update available: v${status.updateVersion}` : 'Update available';
  else if (downloading && status?.progress) {
    const pct = Math.floor(status.progress.percent ?? 0);
    detail = `Downloading ${pct}% (${formatBytes(status.progress.transferred)} / ${formatBytes(status.progress.total)})`;
  } else if (downloaded) {
    detail = status?.updateVersion
      ? `v${status.updateVersion} ready — restart to install`
      : 'Update ready — restart to install';
  } else if (upToDate) detail = 'Up to date';
  else if (errored) detail = status?.error ? `Update check failed: ${status.error}` : 'Update check failed';

  return (
    <WellItem>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-sm">Software update</span>
          {detail && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{detail}</p>
          )}
        </div>
        {downloaded ? (
          <Button size="sm" onClick={handleInstall}>
            Restart &amp; Install
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={handleCheck}
            disabled={checking || downloading}
          >
            {checking ? 'Checking…' : downloading ? 'Downloading…' : 'Check for Updates'}
          </Button>
        )}
      </div>
    </WellItem>
  );
}
