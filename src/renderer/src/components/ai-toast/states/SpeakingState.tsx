import { WaveformBar } from '../WaveformBar';
import { ChipButton } from '../ChipButton';

interface Props {
  text?: string;
  onSkip: () => void;
  onRepeat: () => void;
}

export function SpeakingState({ text, onSkip, onRepeat }: Props) {
  return (
    <>
      <WaveformBar animated={true} color="#6ee7b7" />
      <span style={{ color: '#6ee7b7', letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
        Speaking…
      </span>
      <div style={{ width: '1px', height: '14px', background: 'rgba(255,255,255,0.1)', flexShrink: 0 }} />
      <button
        style={{
          width: '22px', height: '22px', borderRadius: '50%',
          background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.75)',
          border: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', flexShrink: 0,
        }}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
        </svg>
      </button>
      <ChipButton onClick={onSkip}>Skip</ChipButton>
      <ChipButton onClick={onRepeat}>Repeat</ChipButton>
    </>
  );
}
