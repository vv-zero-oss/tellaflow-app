import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Well, WellHeader, WellTitle, WellCard, WellItem } from '@/components/ui/well';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Bot, Send, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAssistant } from '@/hooks/use-assistant';

// ─── Types ──────────────────────────────────────────────────────────────────────

type ActiveTab = 'chat' | 'settings';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface DownloadedModel {
  key: string;
  name: string;
  size: string;
}

// ─── Providers ──────────────────────────────────────────────────────────────────

const CLOUD_PROVIDERS = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic (Claude)' },
  { id: 'google', label: 'Google (Gemini)' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'groq', label: 'Groq' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'huggingface', label: 'HuggingFace' },
  { id: 'xai', label: 'xAI (Grok)' },
  { id: 'mistral', label: 'Mistral' },
];

const CLOUD_MODELS: Record<string, { id: string; label: string }[]> = {
  openai: [
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { id: 'gpt-4o', label: 'GPT-4o' },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  ],
  google: [
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
    { id: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B' },
  ],
  deepseek: [
    { id: 'deepseek-chat', label: 'DeepSeek Chat' },
    { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
  ],
};

const VOICES = [
  { id: 'alba', label: 'Alba' },
  { id: 'george', label: 'George' },
  { id: 'anna', label: 'Anna' },
  { id: 'bill', label: 'Bill' },
  { id: 'jane', label: 'Jane' },
  { id: 'michael', label: 'Michael' },
];

// ─── Tab component (matches ModelsPage exactly) ─────────────────────────────

function Tab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative pb-2.5 text-sm font-medium transition-colors whitespace-nowrap flex items-center gap-1.5',
        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
      {active && (
        <motion.div
          layoutId="assistant-tab-indicator"
          className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground rounded-full"
        />
      )}
    </button>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function AssistantPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('chat');
  const {
    config, ttsStatus, testResult, testing,
    setEnabled, setProvider, setModel, setVoice, setApiKey, testConnection,
  } = useAssistant();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [downloadedModels, setDownloadedModels] = useState<DownloadedModel[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const isLocal = config ? ['llamacpp', 'ollama'].includes(config.assistantProvider) : true;

  // Fetch available local models (from Ollama)
  useEffect(() => {
    if (!isLocal) return;
    // Try to get models from Ollama API
    fetch('http://localhost:11434/api/tags')
      .then(r => r.json())
      .then(data => {
        if (data?.models) {
          setDownloadedModels(data.models.map((m: any) => ({
            key: m.name,
            name: m.name,
            size: m.size ? `${(m.size / 1e9).toFixed(1)} GB` : '',
          })));
        }
      })
      .catch(() => {
        // Ollama not running — show empty
        setDownloadedModels([]);
      });
  }, [isLocal, config?.assistantProvider]);

  // Listen for voice messages (from hotkey → STT → LLM path)
  useEffect(() => {
    const ipc = (window as any).tellaflow;
    const unsub1 = ipc?.onAssistantChatMessage?.((msg: ChatMessage) => {
      setMessages(prev => [...prev, msg]);
    });
    // Listen for streaming partial responses — update the last assistant message live
    const unsub2 = ipc?.onAssistantPartialResponse?.((text: string) => {
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && last.timestamp === 0) {
          // Update the streaming placeholder
          return [...prev.slice(0, -1), { ...last, content: text }];
        }
        return prev;
      });
    });
    return () => {
      if (typeof unsub1 === 'function') unsub1();
      if (typeof unsub2 === 'function') unsub2();
    };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const [sending, setSending] = useState(false);

  const sendTextMessage = async () => {
    if (!inputText.trim() || sending) return;
    const text = inputText.trim();
    const userMsg: ChatMessage = { role: 'user', content: text, timestamp: Date.now() };
    // Add user message + streaming placeholder (timestamp=0 marks it as streaming)
    setMessages(prev => [...prev, userMsg, { role: 'assistant', content: '...', timestamp: 0 }]);
    setInputText('');
    setSending(true);

    try {
      const ipc = (window as any).tellaflow;
      const result = await ipc?.sendAssistantMessage(text);
      // Replace streaming placeholder with final response
      setMessages(prev => {
        const withoutPlaceholder = prev.filter(m => m.timestamp !== 0);
        return [...withoutPlaceholder, {
          role: 'assistant' as const,
          content: result?.response || 'No response received.',
          timestamp: Date.now(),
        }];
      });
    } catch (err) {
      setMessages(prev => {
        const withoutPlaceholder = prev.filter(m => m.timestamp !== 0);
        return [...withoutPlaceholder, {
          role: 'assistant' as const,
          content: `Error: ${(err as Error).message}`,
          timestamp: Date.now(),
        }];
      });
    }
    setSending(false);
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="px-7 pt-12 pb-1 [-webkit-app-region:drag]">
        <h2 className="text-xl font-bold tracking-tight">Assistant</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Voice-powered AI assistant
        </p>
      </div>

      {/* Tabs */}
      <div className="px-7 [-webkit-app-region:no-drag]">
        <div className="flex gap-5 border-b border-border/50 mt-3">
          <Tab label="Chat" active={activeTab === 'chat'} onClick={() => setActiveTab('chat')} />
          <Tab label="Settings" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
        </div>
      </div>

      {/* ─── Chat Tab ──────────────────────────────────────────── */}
      {activeTab === 'chat' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Messages */}
          <ScrollArea className="flex-1">
            <div className="px-7 py-5 [-webkit-app-region:no-drag]">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
                  <Bot className="w-10 h-10 opacity-20" strokeWidth={1.2} />
                  <p className="text-sm">No messages yet</p>
                  <p className="text-xs opacity-60">
                    {config?.assistantEnabled
                      ? `Hold ${config.assistantHotkey?.label || 'hotkey'} to speak, or type below`
                      : 'Enable the assistant in Settings to get started'}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {messages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={cn(
                        'max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                        msg.role === 'user'
                          ? 'bg-primary text-primary-foreground rounded-br-md'
                          : 'bg-well text-foreground rounded-bl-md',
                      )}>
                        {msg.content}
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Input bar — pinned to bottom */}
          <div className="border-t border-border/50 px-7 py-3 [-webkit-app-region:no-drag]">
            <div className="flex items-center gap-2 bg-well rounded-xl px-4 py-2">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTextMessage(); } }}
                placeholder="Type a message…"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
                onClick={sendTextMessage}
                disabled={!inputText.trim() || sending}
              >
                {sending
                  ? <div className="w-3.5 h-3.5 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
                  : <Send className="w-3.5 h-3.5" />
                }
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Settings Tab ──────────────────────────────────────── */}
      {activeTab === 'settings' && (
        <ScrollArea className="flex-1">
          <div className="px-7 py-5 [-webkit-app-region:no-drag]">

            {/* General */}
            <Well className="mb-7">
              <WellHeader>
                <WellTitle>General</WellTitle>
              </WellHeader>
              <WellCard>
                <WellItem>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm">Voice Assistant</span>
                      <p className="text-xs text-muted-foreground mt-0.5">Hold assistant hotkey to talk</p>
                    </div>
                    <Switch
                      checked={config?.assistantEnabled ?? false}
                      onCheckedChange={setEnabled}
                    />
                  </div>
                </WellItem>

                <WellItem>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm">Hotkey</span>
                      <p className="text-xs text-muted-foreground mt-0.5">Hold to speak, release to send</p>
                    </div>
                    <div className="h-9 px-4 rounded-lg border border-input bg-muted/50 flex items-center text-sm font-mono">
                      {config?.assistantHotkey?.label || '⌥ Right'}
                    </div>
                  </div>
                </WellItem>
              </WellCard>
            </Well>

            {/* Model */}
            <Well className="mb-7">
              <WellHeader>
                <WellTitle>Model</WellTitle>
              </WellHeader>
              <WellCard>
                <WellItem>
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <span className="text-sm font-medium">Provider</span>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {isLocal ? 'Uses models downloaded on this machine' : 'Requires API key'}
                      </p>
                    </div>
                    <Select value={config?.assistantProvider ?? 'ollama'} onValueChange={setProvider}>
                      <SelectTrigger className="w-auto min-w-[200px] h-9 text-sm shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Local</div>
                        <SelectItem value="ollama">Ollama</SelectItem>
                        <SelectItem value="llamacpp">llama.cpp</SelectItem>
                        <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-1">Cloud</div>
                        {CLOUD_PROVIDERS.map(p => (
                          <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </WellItem>

                <WellItem>
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <span className="text-sm font-medium">Model</span>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {isLocal
                          ? (downloadedModels.length > 0
                              ? `${downloadedModels.length} model${downloadedModels.length > 1 ? 's' : ''} downloaded`
                              : 'No local models downloaded — go to Models page')
                          : 'Select a model from your provider'}
                      </p>
                    </div>
                    <Select value={config?.assistantModel ?? ''} onValueChange={setModel}>
                      <SelectTrigger className="w-auto min-w-[200px] h-9 text-sm shrink-0">
                        <SelectValue placeholder="Select model" />
                      </SelectTrigger>
                      <SelectContent>
                        {isLocal ? (
                          downloadedModels.length > 0 ? (
                            downloadedModels.map(m => (
                              <SelectItem key={m.key} value={m.key}>
                                {m.name} {m.size && `(${m.size})`}
                              </SelectItem>
                            ))
                          ) : (
                            <div className="px-3 py-2 text-xs text-muted-foreground">
                              No models found. Make sure Ollama is running.
                            </div>
                          )
                        ) : (
                          (CLOUD_MODELS[config?.assistantProvider ?? ''] ?? [{ id: config?.assistantModel ?? 'default', label: config?.assistantModel ?? 'Default' }]).map(m => (
                            <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </WellItem>

                {/* API Key — cloud only */}
                {!isLocal && (
                  <WellItem>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="text-sm">API Key</span>
                        <p className="text-xs text-muted-foreground mt-0.5">Stored in macOS Keychain</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <input
                          type="password"
                          placeholder="sk-…"
                          className="h-9 w-[160px] px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                          onBlur={(e) => {
                            if (e.target.value) {
                              setApiKey(config?.assistantProvider ?? '', e.target.value);
                              e.target.value = '';
                            }
                          }}
                        />
                        <Button variant="outline" size="sm" onClick={testConnection} disabled={testing}>
                          {testing ? 'Testing…' : 'Test'}
                        </Button>
                      </div>
                    </div>
                    {testResult && (
                      <p className={`text-xs mt-1.5 ${testResult.ok ? 'text-green-500' : 'text-destructive'}`}>
                        {testResult.ok ? 'Connected successfully' : `Failed: ${testResult.error || 'Unknown error'}`}
                      </p>
                    )}
                  </WellItem>
                )}
              </WellCard>
            </Well>

            {/* Voice */}
            <Well className="mb-7">
              <WellHeader>
                <WellTitle>Voice</WellTitle>
              </WellHeader>
              <WellCard>
                <WellItem>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm">TTS Voice</span>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {ttsStatus?.downloaded ? 'Kokoro TTS ready' : 'Kokoro TTS — not downloaded (170 MB)'}
                      </p>
                    </div>
                    <Select value={config?.assistantVoice ?? 'alba'} onValueChange={setVoice}>
                      <SelectTrigger className="w-auto min-w-[140px] h-9 text-sm shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VOICES.map(v => (
                          <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </WellItem>
              </WellCard>
            </Well>

            {/* Data */}
            <Well>
              <WellHeader>
                <WellTitle>Data</WellTitle>
              </WellHeader>
              <WellCard>
                <WellItem>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm">Conversation History</span>
                      <p className="text-xs text-muted-foreground mt-0.5">{messages.length} messages</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => { setMessages([]); (window as any).tellaflow?.clearAssistantHistory(); }}
                      disabled={messages.length === 0}
                    >
                      <Trash2 className="w-3 h-3 mr-1.5" />
                      Clear
                    </Button>
                  </div>
                </WellItem>
              </WellCard>
            </Well>

          </div>
        </ScrollArea>
      )}
    </div>
  );
}
