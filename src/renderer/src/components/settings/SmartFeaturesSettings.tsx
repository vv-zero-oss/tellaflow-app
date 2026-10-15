import { Well, WellHeader, WellTitle, WellCard, WellItem } from '@/components/ui/well';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ipc, type AppConfig, type FeatureSettingKey } from '@/lib/ipc';

interface Props {
  config: AppConfig;
  refreshConfig: () => Promise<void>;
}

function Row({ label, description, checked, onChange, disabled }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <WellItem>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <span className="text-sm">{label}</span>
          <p className="text-xs text-muted-foreground/60 mt-0.5">{description}</p>
        </div>
        <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
      </div>
    </WellItem>
  );
}

const RETENTION_OPTIONS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
  { value: '0', label: 'Forever' },
];

export function SmartFeaturesSettings({ config, refreshConfig }: Props) {
  const set = async (key: FeatureSettingKey, value: boolean | number) => {
    await ipc.setFeatureSetting(key, value);
    await refreshConfig();
  };

  return (
    <>
      <Well className="mb-7">
        <WellHeader>
          <WellTitle>Smart dictation</WellTitle>
        </WellHeader>
        <WellCard>
          <Row
            label="Learn from my corrections"
            description="If you fix a misheard word right after dictating, it's added to your Dictionary automatically."
            checked={config.autoLearnEnabled ?? true}
            onChange={(v) => set('autoLearnEnabled', v)}
          />
          <Row
            label="Understand the app I'm in"
            description="Recognizes names in Slack and other chat apps, and file names in Cursor, VS Code and other editors (“index dot js” → index.js)."
            checked={config.contextAwarenessEnabled ?? true}
            onChange={(v) => set('contextAwarenessEnabled', v)}
          />
        </WellCard>
      </Well>

      <Well className="mb-7">
        <WellHeader>
          <WellTitle>Meeting notes</WellTitle>
        </WellHeader>
        <WellCard>
          <Row
            label="Take notes automatically in meetings"
            description="When Zoom, Google Meet, Teams or a Slack huddle starts, records your microphone and transcribes it locally into a Meeting notes entry. No hotkey needed."
            checked={config.meetingNotesEnabled ?? false}
            onChange={(v) => set('meetingNotesEnabled', v)}
          />
          <Row
            label="Detect meetings in browser tabs"
            description="Checks open tabs in Chrome, Arc, Brave, Edge and Safari for meeting links. macOS asks once for permission per browser."
            checked={config.meetingBrowserDetection ?? true}
            onChange={(v) => set('meetingBrowserDetection', v)}
            disabled={!config.meetingNotesEnabled}
          />
        </WellCard>
      </Well>

      <Well className="mb-7">
        <WellHeader>
          <WellTitle>Storage</WellTitle>
        </WellHeader>
        <WellCard>
          <WellItem>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <span className="text-sm">Keep recordings for</span>
                <p className="text-xs text-muted-foreground/60 mt-0.5">Older audio is deleted to save disk space. Transcripts are always kept.</p>
              </div>
              <Select value={String(config.audioRetentionDays ?? 30)} onValueChange={(v) => set('audioRetentionDays', Number(v))}>
                <SelectTrigger className="w-[130px] h-8 text-sm shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RETENTION_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </WellItem>
        </WellCard>
      </Well>
    </>
  );
}
