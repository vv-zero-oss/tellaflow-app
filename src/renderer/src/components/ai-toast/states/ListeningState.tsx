import { WaveformBar } from '../WaveformBar';
import { ChipButton } from '../ChipButton';

interface Props {
  onStop: () => void;
}

export function ListeningState({ onStop }: Props) {
  return (
    <>
      <WaveformBar animated={true} color="#93c5fd" />
      <span style={{ color: '#93c5fd', letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
        Listening…
      </span>
      <div style={{ width: '1px', height: '14px', background: 'rgba(255,255,255,0.1)', flexShrink: 0 }} />
      <ChipButton onClick={onStop} kbd="Esc">Stop</ChipButton>
    </>
  );
}
