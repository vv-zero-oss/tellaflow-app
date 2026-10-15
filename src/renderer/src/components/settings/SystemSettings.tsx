import { Well, WellHeader, WellTitle, WellCard, WellItem } from '@/components/ui/well';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { AppConfig } from '@/lib/ipc';
import { ipc } from '@/lib/ipc';

interface SystemSettingsProps {
  config: AppConfig;
  refreshConfig: () => Promise<void>;
}

interface SettingRowProps {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

function SettingRow({ label, description, checked, onCheckedChange }: SettingRowProps) {
  return (
    <WellItem>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <span className="text-sm">{label}</span>
          {description && (
            <p className="text-xs text-muted-foreground/60 mt-0.5">{description}</p>
          )}
        </div>
        <Switch
          checked={checked}
          onCheckedChange={onCheckedChange}
        />
      </div>
    </WellItem>
  );
}

export function SystemSettings({ config, refreshConfig }: SystemSettingsProps) {
  const handleLaunchAtLogin = async (enabled: boolean) => {
    ipc.setLaunchAtLogin(enabled);
    await refreshConfig();
  };

  const handleFloatingBar = async (enabled: boolean) => {
    ipc.setFloatingBarEnabled(enabled);
    await refreshConfig();
  };

  const setIsland = async (key: 'islandPlacement' | 'islandMaterial', value: string) => {
    await ipc.setFeatureSetting(key, value);
    await refreshConfig();
  };

  const handleShowInDock = async (enabled: boolean) => {
    ipc.setShowInDock(enabled);
    await refreshConfig();
  };

  const handleSoundsEnabled = async (enabled: boolean) => {
    ipc.setSoundsEnabled(enabled);
    await refreshConfig();
  };

  const handleMuteWhileDictating = async (enabled: boolean) => {
    ipc.setMuteWhileDictating(enabled);
    await refreshConfig();
  };

  return (
    <>
      <Well className="mb-7">
        <WellHeader>
          <WellTitle>App settings</WellTitle>
        </WellHeader>
        <WellCard>
          <SettingRow
            label="Launch app at login"
            checked={config.launchAtLogin ?? false}
            onCheckedChange={handleLaunchAtLogin}
          />
          <SettingRow
            label="Show the island at all times"
            description="A small dot stays on screen — click it to start dictating"
            checked={config.floatingBarEnabled ?? false}
            onCheckedChange={handleFloatingBar}
          />
          <WellItem>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <span className="text-sm">Island position</span>
                <p className="text-xs text-muted-foreground/60 mt-0.5">The screen edge the island sits on</p>
              </div>
              <Select value={config.islandPlacement ?? 'bottom'} onValueChange={(v) => setIsland('islandPlacement', v)}>
                <SelectTrigger className="w-[160px] h-8 text-sm shrink-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bottom">Bottom</SelectItem>
                  <SelectItem value="left">Left</SelectItem>
                  <SelectItem value="right">Right</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </WellItem>
          <WellItem>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <span className="text-sm">Island material</span>
                <p className="text-xs text-muted-foreground/60 mt-0.5">Translucent glass, or solid grey</p>
              </div>
              <Select value={config.islandMaterial ?? 'translucent'} onValueChange={(v) => setIsland('islandMaterial', v)}>
                <SelectTrigger className="w-[160px] h-8 text-sm shrink-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="translucent">Translucent</SelectItem>
                  <SelectItem value="opaque">Opaque</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </WellItem>
          <SettingRow
            label="Show app in dock"
            checked={config.showInDock ?? true}
            onCheckedChange={handleShowInDock}
          />
        </WellCard>
      </Well>

      <Well className="mb-7">
        <WellHeader>
          <WellTitle>Sound</WellTitle>
        </WellHeader>
        <WellCard>
          <SettingRow
            label="Dictation and notification sounds"
            checked={config.soundsEnabled ?? true}
            onCheckedChange={handleSoundsEnabled}
          />
          <SettingRow
            label="Mute music while dictating"
            description="Pauses Apple Music and Spotify during recording"
            checked={config.muteWhileDictating ?? false}
            onCheckedChange={handleMuteWhileDictating}
          />
        </WellCard>
      </Well>
    </>
  );
}
