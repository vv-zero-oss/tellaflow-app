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

function useSet(refreshConfig: () => Promise<void>) {
  return async (key: FeatureSettingKey, value: boolean | number) => {
    await ipc.setFeatureSetting(key, value);
    await refreshConfig();
  };
}

export function SmartDictationSettings({ config, refreshConfig }: Props) {
  const set = useSet(refreshConfig);
  return (
    <Well className="mb-7">
      <WellHeader>
        <WellTitle>Smart dictation</WellTitle>
      </WellHeader>
      <WellCard>
        <Row
          label="Learn from my corrections"
          description="If you fix a misheard word right after dictating, Tellaflow offers to add it to your Dictionary."
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
  );
}

export function MeetingSettings({ config, refreshConfig }: Props) {
  const set = useSet(refreshConfig);
  const on = config.meetingNotesEnabled ?? false;
  return (
    <Well className="mb-7">
      <WellHeader>
        <WellTitle>Meeting notes</WellTitle>
      </WellHeader>
      <WellCard>
        <Row
          label="Offer to take notes in meetings"
          description="When Zoom, Google Meet, Teams or a Slack huddle starts, Tellaflow asks whether to transcribe it. Notes are made on this Mac and saved with your transcripts."
          checked={on}
          onChange={(v) => set('meetingNotesEnabled', v)}
        />
        {/* Only means something while meeting notes are on. */}
        {on && (
          <Row
            label="Also look in browser tabs"
            description="Finds Google Meet, Zoom and Teams calls open in Chrome, Arc, Brave, Edge or Safari. macOS asks once per browser."
            checked={config.meetingBrowserDetection ?? true}
            onChange={(v) => set('meetingBrowserDetection', v)}
          />
        )}
      </WellCard>
    </Well>
  );
}

/** How long recordings are kept (the Data & privacy tab). */
export function RetentionRow({ config, refreshConfig }: Props) {
  const set = useSet(refreshConfig);
  return (
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
  );
}
