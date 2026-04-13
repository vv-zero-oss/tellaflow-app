import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Well, WellHeader, WellTitle, WellCard, WellItem } from '@/components/ui/well';
import { ipc } from '@/lib/ipc';
import type { GrammarModels, GrammarModelInfo } from '@/lib/ipc';

interface GrammarModelCardProps {
  grammarEnabled: boolean;
  activeGrammarModel?: string;
  onSetGrammarEnabled: (enabled: boolean) => void;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmtBytes(b: number) {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
  if (b >= 1e6) return (b / 1e6).toFixed(0) + ' MB';
  return (b / 1e3).toFixed(0) + ' KB';
}

// ─── Model row ─────────────────────────────────────────────────────────────────

function ModelRow({
  modelKey,
  info,
  isActive,
  isEnabled,
}: {
  modelKey: string;
  info: GrammarModelInfo;
  isActive: boolean;
  isEnabled: boolean;
}) {
  const pct = info.total > 0 ? Math.round((info.downloaded / info.total) * 100) : 0;

  return (
    <WellItem>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">{info.name}</span>
            <Badge variant="outline" className="text-[10px] h-4 px-1.5">{info.quality}</Badge>
            <Badge variant="outline" className="text-[10px] h-4 px-1.5">{info.size}</Badge>
            <Badge variant="outline" className="text-[10px] h-4 px-1.5">{info.context} ctx</Badge>
            {isActive && info.available && (
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                {isEnabled ? 'Active · Enabled' : 'Active'}
              </Badge>
            )}
            {!info.available && info.status !== 'downloading' && info.status !== 'paused' && (
              <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-muted-foreground">
                Not downloaded
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{info.description}</p>
        </div>

        <div className="flex gap-1.5 items-center shrink-0">
          {info.status === 'not_downloaded' && (
            <Button variant="outline" size="sm" onClick={() => ipc.startGrammarDownload(modelKey)}>
              Download
            </Button>
          )}
          {info.status === 'downloading' && (
            <Button variant="outline" size="sm" onClick={() => ipc.pauseGrammarDownload(modelKey)}>
              Pause
            </Button>
          )}
          {info.status === 'paused' && (
            <>
              <Button variant="outline" size="sm" onClick={() => ipc.startGrammarDownload(modelKey)}>
                Resume
              </Button>
              <Button variant="outline" size="sm" onClick={() => ipc.cancelGrammarDownload(modelKey)}>
                Cancel
              </Button>
            </>
          )}
          {info.status === 'downloaded' && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => ipc.deleteGrammarModel(modelKey)}
            >
              Remove
            </Button>
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
}

// ─── Main component ────────────────────────────────────────────────────────────

export function GrammarModelCard({
  grammarEnabled,
  activeGrammarModel,
  onSetGrammarEnabled,
}: GrammarModelCardProps) {
  const [models, setModels] = useState<GrammarModels | null>(null);
  const [activeKey, setActiveKey] = useState<string>(activeGrammarModel || 'qwen2.5-0.5b');

  const refresh = useCallback(async () => {
    try {
      const s = await ipc.getGrammarModelsStatus();
      setModels(s);
    } catch (err) {
      console.error('Failed to get grammar models status:', err);
    }
  }, []);

  useEffect(() => {
    refresh();

    ipc.onGrammarModelProgress((p) => {
      setModels((prev) => {
        if (!prev || !prev[p.modelKey]) return prev;
        return {
          ...prev,
          [p.modelKey]: { ...prev[p.modelKey], status: 'downloading', downloaded: p.downloaded, total: p.total },
        };
      });
    });

    ipc.onGrammarModelChanged((s) => setModels(s));
    ipc.onGrammarModelError(() => refresh());
  }, [refresh]);

  useEffect(() => { if (activeGrammarModel) setActiveKey(activeGrammarModel); }, [activeGrammarModel]);

  if (!models) return null;

  const downloadedModels = Object.entries(models).filter(([, info]) => info.available);
  const hasAnyDownloaded = downloadedModels.length > 0;
  const activeModelInfo = models[activeKey];

  function handleSetActiveModel(key: string) {
    setActiveKey(key);
    ipc.setGrammarModel(key);
  }

  return (
    <>
      {/* 1. Settings — enable toggle only */}
      {hasAnyDownloaded && (
        <Well className="mb-5">
          <WellHeader>
            <WellTitle>Settings</WellTitle>
          </WellHeader>
          <WellCard>
            <WellItem>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium">Enable AI Grammar correction</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Automatically clean up transcriptions after each recording
                  </p>
                </div>
                <Switch checked={grammarEnabled} onCheckedChange={onSetGrammarEnabled} />
              </div>
            </WellItem>
          </WellCard>
        </Well>
      )}

      {/* 2. Active Model selector — only when enabled */}
      {hasAnyDownloaded && grammarEnabled && (
        <Well className="mb-5">
          <WellHeader>
            <WellTitle>Active Model</WellTitle>
          </WellHeader>
          <WellCard>
            <WellItem>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium">AI Grammar model</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Select which model to use for correction
                  </p>
                </div>
                <Select value={activeKey} onValueChange={handleSetActiveModel}>
                  <SelectTrigger className="w-auto min-w-[180px] h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {downloadedModels.map(([key, info]) => (
                      <SelectItem key={key} value={key}>
                        {info.name} ({info.size})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </WellItem>

            {activeModelInfo && (
              <WellItem>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {activeModelInfo.description}{' '}
                  <span className="opacity-60">· {activeModelInfo.size} · {activeModelInfo.context} context · On-device</span>
                </p>
              </WellItem>
            )}
          </WellCard>
        </Well>
      )}

      {/* 3. Available Grammar Models — always visible */}
      <Well>
        <WellHeader>
          <WellTitle>Available AI Grammar Models</WellTitle>
        </WellHeader>
        <WellCard>
          {Object.entries(models).map(([key, info]) => (
            <ModelRow
              key={key}
              modelKey={key}
              info={info}
              isActive={key === activeKey}
              isEnabled={grammarEnabled}
            />
          ))}
        </WellCard>
      </Well>
    </>
  );
}
