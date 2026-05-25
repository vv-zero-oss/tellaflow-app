import { useState, useEffect } from 'react';
import { Well, WellHeader, WellTitle, WellCard, WellItem } from '@/components/ui/well';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
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
  const [micMode, setMicMode] = useState<{ supported: boolean; active?: string } | null>(null);

  useEffect(() => {
    ipc.getMicModeStatus().then(setMicMode).catch(() => setMicMode({ supported: false }));
  }, []);

  const handleLaunchAtLogin = async (enabled: boolean) => {
    ipc.setLaunchAtLogin(enabled);
    await refreshConfig();
  };

  const handleFloatingBar = async (enabled: boolean) => {
    ipc.setFloatingBarEnabled(enabled);
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

  const handleAudioNoiseReduction = async (enabled: boolean) => {
    ipc.setAudioNoiseReduction(enabled);
    await refreshConfig();
  };

  const handleAudioSpectralDenoise = async (enabled: boolean) => {
    ipc.setAudioSpectralDenoise(enabled);
    await refreshConfig();
  };

  const handleOpenMicModePicker = async () => {
    await ipc.openMicModePicker();
    // Re-check status after user interacts with the picker
    setTimeout(async () => {
      const status = await ipc.getMicModeStatus();
      setMicMode(status);
    }, 2000);
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
            label="Show Floating bar at all times"
            description="Always-visible bar — click to start dictating"
            checked={config.floatingBarEnabled ?? false}
            onCheckedChange={handleFloatingBar}
          />
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

      <Well className="mb-7">
        <WellHeader>
          <WellTitle>Audio quality</WellTitle>
        </WellHeader>
        <WellCard>
          <SettingRow
            label="Noise reduction"
            description="Filter background noise and normalize audio before transcription"
            checked={config.audioNoiseReduction ?? true}
            onCheckedChange={handleAudioNoiseReduction}
          />
          <SettingRow
            label="Spectral denoising"
            description="Deep noise cleanup using frequency analysis (experimental)"
            checked={config.audioSpectralDenoise ?? false}
            onCheckedChange={handleAudioSpectralDenoise}
          />
          {micMode?.supported && (
            <WellItem>
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <span className="text-sm">Apple Voice Isolation</span>
                  <p className="text-xs text-muted-foreground/60 mt-0.5">
                    {micMode.active === 'voice-isolation'
                      ? 'Active — ML-powered voice isolation is enhancing your mic'
                      : 'Uses Apple\'s on-device ML to isolate your voice from all background noise'}
                  </p>
                </div>
                {micMode.active === 'voice-isolation' ? (
                  <span className="text-xs font-medium text-success shrink-0">On</span>
                ) : (
                  <Button variant="outline" size="sm" onClick={handleOpenMicModePicker}>
                    Enable
                  </Button>
                )}
              </div>
            </WellItem>
          )}
        </WellCard>
      </Well>
    </>
  );
}
