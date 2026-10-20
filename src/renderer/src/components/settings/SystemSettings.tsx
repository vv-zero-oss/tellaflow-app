import { Well, WellHeader, WellTitle, WellCard, WellItem } from '@/components/ui/well';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { AppConfig } from '@/lib/ipc';
import { ipc } from '@/lib/ipc';

interface IslandSettingsProps {
  config: AppConfig;
  refreshConfig: () => Promise<void>;
}

/** The island: the pill that shows while you dictate. */
export function IslandSettings({ config, refreshConfig }: IslandSettingsProps) {
  const setIsland = async (key: 'islandPlacement' | 'islandMaterial', value: string) => {
    await ipc.setFeatureSetting(key, value);
    await refreshConfig();
  };

  return (
    <Well className="mb-7">
      <WellHeader>
        <WellTitle>Island</WellTitle>
      </WellHeader>
      <WellCard>
        <WellItem>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="text-sm">Always show the island</span>
              <p className="text-xs text-muted-foreground/60 mt-0.5">The island is the pill that shows while you dictate. On, a small dot stays on screen — click it to start.</p>
            </div>
            <Switch
              checked={config.floatingBarEnabled ?? false}
              onCheckedChange={async (v) => { ipc.setFloatingBarEnabled(v); await refreshConfig(); }}
            />
          </div>
        </WellItem>
        <WellItem>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="text-sm">Position</span>
              <p className="text-xs text-muted-foreground/60 mt-0.5">The screen edge the island sits on.</p>
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
              <span className="text-sm">Look</span>
              <p className="text-xs text-muted-foreground/60 mt-0.5">See-through glass, or solid grey.</p>
            </div>
            <Select value={config.islandMaterial ?? 'translucent'} onValueChange={(v) => setIsland('islandMaterial', v)}>
              <SelectTrigger className="w-[160px] h-8 text-sm shrink-0"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="translucent">Translucent</SelectItem>
                <SelectItem value="opaque">Solid</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </WellItem>
      </WellCard>
    </Well>
  );
}
