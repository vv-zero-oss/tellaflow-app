import { WaveformBar } from '../WaveformBar';
import { ChipButton } from '../ChipButton';

export function IdleState() {
  return (
    <>
      <WaveformBar animated={false} color="rgba(255,255,255,0.2)" />
      <span style={{ color: 'rgba(255,255,255,0.55)', letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
        Ready
      </span>
      <div style={{ width: '1px', height: '14px', background: 'rgba(255,255,255,0.1)', flexShrink: 0 }} />
      <ChipButton variant="hotkey">
        <span>⌘</span><span>⇧</span><span>Space</span>
      </ChipButton>
    </>
  );
}
