import { useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Well, WellHeader, WellTitle, WellCard, WellItem } from '@/components/ui/well';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';

interface Integration {
  id: string;
  name: string;
  icon: string;
  description: string;
  available: boolean;
}

const SYSTEM_INTEGRATIONS: Integration[] = [
  { id: 'apple-notes', name: 'Apple Notes', icon: '📝', description: 'Create and search notes via Siri Shortcuts', available: true },
  { id: 'apple-reminders', name: 'Reminders', icon: '✅', description: 'Create reminders and tasks', available: true },
  { id: 'apple-calendar', name: 'Calendar', icon: '📅', description: 'Check and create calendar events', available: true },
  { id: 'apple-music', name: 'Music', icon: '🎵', description: 'Control music playback', available: true },
  { id: 'finder', name: 'Finder', icon: '📁', description: 'Search and open files via Spotlight', available: true },
  { id: 'imessage', name: 'iMessage', icon: '💬', description: 'Send texts via Messages app', available: true },
];

const APP_INTEGRATIONS: Integration[] = [
  { id: 'slack', name: 'Slack', icon: '💬', description: 'Send messages and check channels', available: false },
  { id: 'discord', name: 'Discord', icon: '🎮', description: 'Send and read messages', available: false },
  { id: 'telegram', name: 'Telegram', icon: '✈️', description: 'Send and receive messages', available: false },
  { id: 'github', name: 'GitHub', icon: '🐙', description: 'Issues, PRs, and repositories', available: false },
  { id: 'linear', name: 'Linear', icon: '📐', description: 'Track issues and projects', available: false },
  { id: 'notion', name: 'Notion', icon: '📓', description: 'Pages and databases', available: false },
  { id: 'spotify', name: 'Spotify', icon: '🎧', description: 'Control music playback', available: false },
  { id: 'brave-search', name: 'Brave Search', icon: '🦁', description: 'Privacy-focused web search', available: false },
];

export function IntegrationsPage() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});

  const toggle = (id: string) => {
    setEnabled(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-7 pt-12 pb-2 [-webkit-app-region:drag]">
        <h1 className="text-xl font-bold tracking-tight">Integrations</h1>
        <p className="text-sm text-muted-foreground mt-1">Connect apps and services to your assistant</p>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-7 py-5 [-webkit-app-region:no-drag]">
          <div className="space-y-6">

            {/* System integrations */}
            <Well>
              <WellHeader>
                <WellTitle>System (Built-in)</WellTitle>
              </WellHeader>
              <WellCard>
                {SYSTEM_INTEGRATIONS.map((integration) => (
                  <WellItem key={integration.id}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-base">{integration.icon}</span>
                        <div>
                          <span className="text-sm">{integration.name}</span>
                          <p className="text-xs text-muted-foreground mt-0.5">{integration.description}</p>
                        </div>
                      </div>
                      <Switch
                        checked={enabled[integration.id] ?? false}
                        onCheckedChange={() => toggle(integration.id)}
                      />
                    </div>
                  </WellItem>
                ))}
              </WellCard>
            </Well>

            {/* App integrations */}
            <Well>
              <WellHeader>
                <WellTitle>Apps & Services</WellTitle>
              </WellHeader>
              <WellCard>
                {APP_INTEGRATIONS.map((integration) => (
                  <WellItem key={integration.id}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-base">{integration.icon}</span>
                        <div>
                          <span className="text-sm">{integration.name}</span>
                          <p className="text-xs text-muted-foreground mt-0.5">{integration.description}</p>
                        </div>
                      </div>
                      {integration.available ? (
                        <Switch
                          checked={enabled[integration.id] ?? false}
                          onCheckedChange={() => toggle(integration.id)}
                        />
                      ) : (
                        <Badge variant="outline" className="text-[9px]">Coming Soon</Badge>
                      )}
                    </div>
                  </WellItem>
                ))}
              </WellCard>
            </Well>

          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
