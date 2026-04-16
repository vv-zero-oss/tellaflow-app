import { useState, useEffect, useCallback } from 'react';
import { Bot, Brain, History, AlertCircle, CheckCircle2, Loader2, ChevronRight, Trash2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Well, WellHeader, WellTitle, WellCard, WellItem } from '@/components/ui/well';
import { ipc } from '@/lib/ipc';
import type { AiModels, AiModelInfo, AgentMemoryEntry, AgentHistoryEntry, AgentStatus, HotkeyConfig } from '@/lib/ipc';
import { cn } from '@/lib/utils';
import { useConfig } from '@/hooks/use-config';

// ─── Hotkey picker (reuses main-process keyspy) ───────────────────────────────

function AgentHotkeyPicker({ hotkey, onSave }: { hotkey?: HotkeyConfig; onSave: (h: HotkeyConfig) => void }) {
  const [recording, setRecording] = useState(false);
  const [candidate, setCandidate] = useState<HotkeyConfig | null>(null);

  const startRecording = () => {
    setRecording(true);
    setCandidate(null);
    ipc.startHotkeyRecording();
    ipc.onHotkeyRecorded((data) => {
      setCandidate(data);
      setRecording(false);
    });
    ipc.onHotkeyRecordingCancelled(() => {
      setRecording(false);
    });
  };

  const confirmSave = () => {
    if (candidate) { onSave(candidate); setCandidate(null); }
  };

  const cancelRecord = () => {
    ipc.stopHotkeyRecording();
    setRecording(false);
    setCandidate(null);
  };

  if (recording) {
    return (
      <button
        onClick={cancelRecord}
        className="px-3 py-1.5 text-xs rounded-lg border border-primary/40 bg-primary/10 text-primary animate-pulse"
      >
        Press any key... (click to cancel)
      </button>
    );
  }

  if (candidate) {
    return (
      <div className="flex items-center gap-2">
        <span className="px-3 py-1.5 text-xs rounded-lg bg-muted border border-border font-mono">{candidate.label}</span>
        <button onClick={confirmSave} className="px-2.5 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground font-medium">Save</button>
        <button onClick={() => { setCandidate(null); }} className="px-2.5 py-1.5 text-xs rounded-lg bg-muted text-muted-foreground">Cancel</button>
      </div>
    );
  }

  return (
    <button
      onClick={startRecording}
      className="px-3 py-1.5 text-xs rounded-lg border border-border bg-muted hover:bg-muted/70 text-foreground font-mono transition-colors"
    >
      {hotkey?.label || 'Right Option (⌥)'}
    </button>
  );
}

// ─── Model select card (downloaded models only) ───────────────────────────────

function AgentModelSelectCard({ modelKey, info, isActive, onSelect }: {
  modelKey: string;
  info: AiModelInfo;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <WellCard className={cn('transition-all', isActive && 'ring-1 ring-primary/40 bg-primary/5')}>
      <div className="flex items-start gap-3 p-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-medium text-foreground">{info.name}</span>
            <span className={cn(
              'text-[10px] px-1.5 py-0.5 rounded font-medium',
              info.quality === 'Best' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
            )}>
              {info.quality}
            </span>
            <span className="text-[10px] text-muted-foreground">{info.size} · {info.context}</span>
            <span className={cn(
              'text-[10px] px-1.5 py-0.5 rounded font-medium border',
              info.source === 'grammar'
                ? 'border-violet-400/50 text-violet-600 dark:text-violet-400'
                : 'border-blue-400/50 text-blue-600 dark:text-blue-400',
            )}>
              {info.source === 'grammar' ? 'Grammar' : 'Agent'}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{info.description}</p>
        </div>

        <button
          onClick={onSelect}
          disabled={isActive}
          className={cn(
            'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors shrink-0',
            isActive
              ? 'bg-primary/20 text-primary cursor-default'
              : 'bg-muted hover:bg-muted/70 text-foreground',
          )}
        >
          {isActive ? <CheckCircle2 className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          {isActive ? 'Active' : 'Use'}
        </button>
      </div>
    </WellCard>
  );
}

// ─── Main AgentPage ───────────────────────────────────────────────────────────

export function AgentPage() {
  const { config, refresh } = useConfig();
  const [models, setModels] = useState<AiModels | null>(null);
  const [memory, setMemory] = useState<AgentMemoryEntry[]>([]);
  const [agentHistory, setAgentHistory] = useState<AgentHistoryEntry[]>([]);
  const [liveStatus, setLiveStatus] = useState<AgentStatus | null>(null);
  const [activeTab, setActiveTab] = useState<'setup' | 'memory' | 'history'>('setup');
  const [loadError, setLoadError] = useState<string | null>(null);

  const agentEnabled = config.agentEnabled ?? false;
  const agentHotkey = config.agentHotkey;
  const activeModelKey = config.agentModel ?? 'qwen3-1.7b';

  const modelsLoaded = models !== null;
  const downloadedModels = modelsLoaded ? Object.entries(models).filter(([, m]) => m.available) : [];
  const hasDownloadedModel = downloadedModels.length > 0;

  const loadData = useCallback(async () => {
    setLoadError(null);
    try {
      if (typeof ipc.getAllAiModelsStatus !== 'function') {
        throw new Error('getAllAiModelsStatus not available in preload');
      }
      const m = await ipc.getAllAiModelsStatus();
      setModels(m ?? {});
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[agent] getAllAiModelsStatus failed:', msg);
      setLoadError(msg);
      setModels({});
    }
    try {
      const mem = await ipc.getAgentMemory();
      setMemory(mem ?? []);
    } catch (e) {
      console.error('[agent] getAgentMemory failed:', e);
    }
    try {
      const hist = await ipc.getAgentHistory();
      setAgentHistory(hist ?? []);
    } catch (e) {
      console.error('[agent] getAgentHistory failed:', e);
    }
  }, []);

  useEffect(() => {
    loadData();

    // Refresh model list when either registry changes
    const offGrammar = ipc.onGrammarModelChanged(() => loadData());
    const offAgent   = ipc.onAgentModelChanged(() => loadData());
    const offMemory  = ipc.onAgentMemoryChanged((m) => setMemory(m));
    const offHist    = ipc.onAgentHistoryChanged((h) => setAgentHistory(h));
    const offStatus  = ipc.onAgentStatus((s) => {
      setLiveStatus(s);
      if (s.status !== 'running') {
        setTimeout(() => setLiveStatus(null), 4000);
        if (s.status === 'done') loadData();
      }
    });

    return () => { offGrammar(); offAgent(); offMemory(); offHist(); offStatus(); };
  }, [loadData]);

  const handleToggleAgent = (enabled: boolean) => {
    ipc.setAgentEnabled(enabled);
    refresh();
  };

  const handleSaveHotkey = (hotkey: HotkeyConfig) => {
    ipc.setAgentHotkey(hotkey);
    refresh();
  };

  const handleSelectModel = (key: string) => {
    ipc.setAgentModel(key);
    refresh();
  };

  const handleClearMemory = () => {
    ipc.clearAgentMemory();
  };

  const handleDeleteMemory = (key: string) => {
    ipc.deleteAgentMemoryEntry(key);
  };

  const handleClearHistory = () => {
    ipc.clearAgentHistory();
  };


  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1">
        <div className="p-5 space-y-4 max-w-2xl">

          {/* Header */}
          <div className="flex items-center gap-3 pb-1">
            <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Bot className="w-4.5 h-4.5 text-primary" strokeWidth={1.8} />
            </div>
            <div>
              <h1 className="text-[15px] font-semibold">Agent Mode</h1>
              <p className="text-[12px] text-muted-foreground">Voice-controlled AI agent for your Mac</p>
            </div>
          </div>

          {/* Live status banner */}
          {liveStatus && (
            <div className={cn(
              'flex items-start gap-2.5 p-3 rounded-xl border text-[12px] transition-all',
              liveStatus.status === 'running' && 'bg-primary/10 border-primary/30 text-primary',
              liveStatus.status === 'done' && 'bg-success/10 border-success/30 text-success',
              liveStatus.status === 'error' && 'bg-destructive/10 border-destructive/30 text-destructive',
            )}>
              {liveStatus.status === 'running' && <Loader2 className="w-3.5 h-3.5 animate-spin mt-0.5 shrink-0" />}
              {liveStatus.status === 'done' && <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
              {liveStatus.status === 'error' && <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
              <div>
                <span className="font-medium">"{liveStatus.command}"</span>
                {liveStatus.reply && <p className="mt-0.5 text-foreground/70">{liveStatus.reply}</p>}
                {liveStatus.error && <p className="mt-0.5">{liveStatus.error}</p>}
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 p-1 rounded-xl bg-muted w-fit">
            {(['setup', 'memory', 'history'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'px-3.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors capitalize',
                  activeTab === tab
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* ── Setup tab ── */}
          {activeTab === 'setup' && (
            <div className="space-y-4">
              {/* Enable toggle */}
              <Well>
                <WellHeader><WellTitle>Enable Agent</WellTitle></WellHeader>
                <WellCard>
                  <WellItem>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <span className="text-sm">Agent Mode</span>
                        <p className="text-xs text-muted-foreground/60 mt-0.5">
                          Hold the agent hotkey to give voice commands to your Mac
                        </p>
                      </div>
                      <Switch checked={agentEnabled} onCheckedChange={handleToggleAgent} />
                    </div>
                  </WellItem>
                  {agentEnabled && (
                    <WellItem>
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <span className="text-sm">Agent Hotkey</span>
                          <p className="text-xs text-muted-foreground/60 mt-0.5">
                            Must be different from your dictation hotkey
                          </p>
                        </div>
                        <AgentHotkeyPicker hotkey={agentHotkey} onSave={handleSaveHotkey} />
                      </div>
                    </WellItem>
                  )}
                </WellCard>
              </Well>

              {loadError && (
                <div className="flex items-start gap-2.5 p-3 rounded-xl bg-destructive/10 border border-destructive/30 text-[12px]">
                  <AlertCircle className="w-3.5 h-3.5 text-destructive mt-0.5 shrink-0" />
                  <span className="text-destructive">
                    IPC error: {loadError}
                  </span>
                </div>
              )}
              {modelsLoaded && !loadError && !hasDownloadedModel && (
                <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[12px]">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                  <span className="text-amber-600 dark:text-amber-400">
                    No AI model downloaded yet. Go to <strong>Models → AI Models</strong> to download one.
                  </span>
                </div>
              )}

              {/* Models — only downloaded ones are selectable */}
              <Well>
                <WellHeader>
                  <WellTitle>Agent Model</WellTitle>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Select any downloaded AI model. Download more in <strong>Models → AI Models</strong>.
                  </p>
                </WellHeader>
                <div className="space-y-2 p-2">
                  {!modelsLoaded && (
                    <p className="text-[12px] text-muted-foreground p-3 flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading models...
                    </p>
                  )}
                  {modelsLoaded && downloadedModels.length === 0 && (
                    <p className="text-[12px] text-muted-foreground p-3">No models downloaded yet.</p>
                  )}
                  {modelsLoaded && downloadedModels.map(([key, info]) => (
                    <AgentModelSelectCard
                      key={key}
                      modelKey={key}
                      info={info}
                      isActive={key === activeModelKey}
                      onSelect={() => handleSelectModel(key)}
                    />
                  ))}
                </div>
              </Well>

              {/* Capabilities */}
              <Well>
                <WellHeader><WellTitle>Available Skills</WellTitle></WellHeader>
                <div className="grid grid-cols-2 gap-2 p-2">
                  {[
                    { icon: '🖥', label: 'App Control', desc: 'Open, quit, switch apps' },
                    { icon: '⌨️', label: 'Keyboard', desc: 'Type text and shortcuts' },
                    { icon: '📁', label: 'File System', desc: 'Read, write, copy, downloads' },
                    { icon: '📋', label: 'Clipboard', desc: 'Get and set clipboard' },
                    { icon: '⚙️', label: 'System', desc: 'Volume, brightness, dark mode' },
                    { icon: '🧠', label: 'Memory', desc: 'Remember your preferences' },
                    { icon: '🌐', label: 'Browser', desc: 'Safari & Chrome — navigate, search, YouTube' },
                    { icon: '💻', label: 'Shell', desc: 'Terminal commands, find files, downloads' },
                  ].map(s => (
                    <div key={s.label} className="flex items-start gap-2 p-2.5 rounded-xl bg-muted/50">
                      <span className="text-base">{s.icon}</span>
                      <div>
                        <div className="text-[12px] font-medium">{s.label}</div>
                        <div className="text-[11px] text-muted-foreground">{s.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Well>

              {/* Browser Extension */}
              <Well>
                <WellHeader>
                  <WellTitle>Chrome Extension</WellTitle>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Enables deep page control — click, fill forms, read content
                  </p>
                </WellHeader>
                <WellCard>
                  <WellItem>
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-sm font-bold shrink-0">✦</div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-medium">Tellaflow Agent Bridge</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          Load the <code className="font-mono bg-muted px-1 rounded">/extension</code> folder in Chrome → Extensions → Load unpacked
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {['navigate', 'click elements', 'fill forms', 'read page', 'YouTube'].map(f => (
                            <span key={f} className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{f}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </WellItem>
                </WellCard>
              </Well>
            </div>
          )}

          {/* ── Memory tab ── */}
          {activeTab === 'memory' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[12px] text-muted-foreground">
                  {memory.length} stored {memory.length === 1 ? 'fact' : 'facts'}
                </p>
                {memory.length > 0 && (
                  <button
                    onClick={handleClearMemory}
                    className="text-[11px] text-destructive/70 hover:text-destructive transition-colors"
                  >
                    Clear all
                  </button>
                )}
              </div>

              {memory.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                  <Brain className="w-8 h-8 text-muted-foreground/40" strokeWidth={1.4} />
                  <div>
                    <p className="text-[13px] font-medium text-foreground/50">No memories yet</p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Say "remember my browser is Chrome" to store preferences.
                    </p>
                  </div>
                </div>
              ) : (
                <Well>
                  <WellCard>
                    {memory.map((entry, i) => (
                      <div
                        key={entry.key}
                        className={cn(
                          'flex items-start justify-between gap-3 px-3 py-2.5',
                          i < memory.length - 1 && 'border-b border-border/50'
                        )}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-mono font-medium text-foreground">{entry.key}</span>
                            <span className="text-[10px] px-1 py-0 rounded bg-muted text-muted-foreground">{entry.category}</span>
                          </div>
                          <p className="text-[12px] text-muted-foreground truncate">{entry.value}</p>
                        </div>
                        <button
                          onClick={() => handleDeleteMemory(entry.key)}
                          className="shrink-0 p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </WellCard>
                </Well>
              )}
            </div>
          )}

          {/* ── History tab ── */}
          {activeTab === 'history' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[12px] text-muted-foreground">
                  {agentHistory.length} recent {agentHistory.length === 1 ? 'command' : 'commands'}
                </p>
                {agentHistory.length > 0 && (
                  <button
                    onClick={handleClearHistory}
                    className="text-[11px] text-destructive/70 hover:text-destructive transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>

              {agentHistory.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                  <History className="w-8 h-8 text-muted-foreground/40" strokeWidth={1.4} />
                  <div>
                    <p className="text-[13px] font-medium text-foreground/50">No commands yet</p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Your agent command history will appear here.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {agentHistory.map((h) => {
                    let actions: { tool: string }[] = [];
                    try { actions = JSON.parse(h.actions); } catch {}
                    const ts = new Date(h.timestamp * 1000).toLocaleString();
                    return (
                      <WellCard key={h.id}>
                        <div className="p-3">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-[12px] font-medium text-foreground">"{h.transcript}"</span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {h.success ? (
                                <CheckCircle2 className="w-3 h-3 text-success" />
                              ) : (
                                <AlertCircle className="w-3 h-3 text-destructive" />
                              )}
                              <span className="text-[10px] text-muted-foreground">{ts}</span>
                            </div>
                          </div>
                          {actions.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {actions.map((a, i) => (
                                <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                                  {a.tool}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </WellCard>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
