import { WaveformBar } from '../WaveformBar';
import { ChipButton } from '../ChipButton';

interface Props {
  onCancel: () => void;
}

export function ThinkingState({ onCancel }: Props) {
  return (
    <>
      <WaveformBar animated={true} color="#c4b5fd" barCount={8} />
      <span style={{ color: '#c4b5fd', letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
        Thinking…
      </span>
      <div style={{ width: '1px', height: '14px', background: 'rgba(255,255,255,0.1)', flexShrink: 0 }} />
      <ChipButton onClick={onCancel} kbd="Esc">Cancel</ChipButton>
    </>
  );
}
