import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Well, WellHeader, WellTitle, WellCard, WellItem } from '@/components/ui/well';
import { cn } from '@/lib/utils';

interface PermissionsSettingsProps {
  mic: boolean;
  accessibility: boolean;
  needsRestart: boolean;
  onGrantMic: () => void;
  onGrantAccessibility: () => void;
  onRecheck: () => void;
  onRestart: () => void;
}

export function PermissionsSettings({
  mic,
  accessibility,
  needsRestart,
  onGrantMic,
  onGrantAccessibility,
  onRecheck,
  onRestart,
}: PermissionsSettingsProps) {
  return (
    <Well className="mb-7">
      <WellHeader>
        <WellTitle>Permissions</WellTitle>
      </WellHeader>
      <WellCard>
        <WellItem>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className={cn('w-2 h-2 rounded-full shrink-0', mic ? 'bg-success' : 'bg-destructive')} />
              <span className="text-sm">Microphone</span>
            </div>
            {mic ? (
              <span className="text-sm text-success">Granted</span>
            ) : (
              <Button variant="outline" size="sm" onClick={onGrantMic}>Grant Access</Button>
            )}
          </div>
        </WellItem>

        <WellItem>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className={cn('w-2 h-2 rounded-full shrink-0', accessibility ? 'bg-success' : 'bg-destructive')} />
              <span className="text-sm">Accessibility</span>
            </div>
            {accessibility ? (
              <span className="text-sm text-success">Granted</span>
            ) : (
              <div className="flex gap-1.5">
                <Button variant="outline" size="sm" onClick={onGrantAccessibility}>Open Settings</Button>
                <Button variant="outline" size="sm" onClick={onRecheck}>Recheck</Button>
              </div>
            )}
          </div>
        </WellItem>

        {needsRestart && (
          <WellItem>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <RotateCcw className="w-4 h-4 shrink-0" strokeWidth={2} />
                <span>Accessibility granted. Restart required for the hotkey to work.</span>
              </div>
              <Button variant="outline" size="sm" onClick={onRestart}>Restart</Button>
            </div>
          </WellItem>
        )}
      </WellCard>
    </Well>
  );
}
