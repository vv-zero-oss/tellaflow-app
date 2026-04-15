import { useEffect, useState, useCallback, useRef } from 'react';
import { Mic } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface MicrophoneSelectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentDeviceId: string;
  onSelect: (deviceId: string) => void;
}

interface MicDevice {
  deviceId: string;
  label: string;
}

function MicLevelMeter({ deviceId }: { deviceId?: string }) {
  const [level, setLevel] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      try {
        const constraints: MediaStreamConstraints = {
          audio: deviceId
            ? { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true }
            : { echoCancellation: true, noiseSuppression: true },
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }

        streamRef.current = stream;
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.5;
        source.connect(analyser);

        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          if (cancelled) return;
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          const avg = sum / data.length / 255;
          setLevel(avg);
          animRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        // mic unavailable
      }
    };

    setup();

    return () => {
      cancelled = true;
      if (animRef.current) cancelAnimationFrame(animRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
    };
  }, [deviceId]);

  const BAR_COUNT = 10;
  const normalizedLevel = Math.min(1, level * 3);
  const activeBars = Math.round(normalizedLevel * BAR_COUNT);

  return (
    <div className="flex items-center gap-[3px]">
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <div
          key={i}
          className={cn(
            'w-[3px] h-3 rounded-sm transition-colors duration-75',
            i < activeBars ? 'bg-primary' : 'bg-muted-foreground/20',
          )}
        />
      ))}
    </div>
  );
}

async function getDefaultMicLabel(): Promise<string> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const track = stream.getAudioTracks()[0];
    const trackLabel = track.label;
    track.stop();
    return trackLabel || 'System default';
  } catch {
    return 'System default';
  }
}

export function MicrophoneSelectDialog({
  open,
  onOpenChange,
  currentDeviceId,
  onSelect,
}: MicrophoneSelectDialogProps) {
  const [devices, setDevices] = useState<MicDevice[]>([]);
  const [defaultMicLabel, setDefaultMicLabel] = useState('System default');
  const [selectedId, setSelectedId] = useState(currentDeviceId || 'auto');

  const refreshDevices = useCallback(async () => {
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = allDevices
        .filter((d) => d.kind === 'audioinput' && !d.label.startsWith('Default - '))
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${i + 1}`,
        }));
      setDevices(audioInputs);
      const label = await getDefaultMicLabel();
      setDefaultMicLabel(label);
    } catch (err) {
      console.error('Failed to enumerate devices:', err);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setSelectedId(currentDeviceId || 'auto');
    refreshDevices();

    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', refreshDevices);
    };
  }, [open, currentDeviceId, refreshDevices]);

  const handleSelect = (deviceId: string) => {
    setSelectedId(deviceId);
    onSelect(deviceId);
  };

  const isAutoSelected = selectedId === 'auto';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>Microphone</DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[400px]">
          <div className="px-6 pb-6 flex flex-col gap-2">
            {/* Auto-detect option */}
            <button
              type="button"
              onClick={() => handleSelect('auto')}
              className={cn(
                'w-full text-left rounded-xl border p-4 transition-all',
                isAutoSelected
                  ? 'border-primary ring-2 ring-primary bg-primary/[0.03]'
                  : 'border-border hover:border-muted-foreground/40 bg-card',
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">
                    Auto-detect ({defaultMicLabel})
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Overrides other mics when connected
                  </div>
                </div>
                {isAutoSelected && (
                  <div className="ml-3 flex-shrink-0">
                    <MicLevelMeter />
                  </div>
                )}
              </div>
            </button>

            {/* Individual mic cards */}
            {devices.map((device) => {
              const isSelected = selectedId === device.deviceId;
              return (
                <button
                  key={device.deviceId}
                  type="button"
                  onClick={() => handleSelect(device.deviceId)}
                  className={cn(
                    'w-full text-left rounded-xl border p-4 transition-all',
                    isSelected
                      ? 'border-primary ring-2 ring-primary bg-primary/[0.03]'
                      : 'border-border hover:border-muted-foreground/40 bg-card',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <Mic className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <span className="text-sm font-medium truncate">{device.label}</span>
                    </div>
                    {isSelected && (
                      <div className="ml-3 flex-shrink-0">
                        <MicLevelMeter deviceId={device.deviceId} />
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
