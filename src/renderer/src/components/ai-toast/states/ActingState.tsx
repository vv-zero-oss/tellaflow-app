import { ChipButton } from '../ChipButton';

interface Props {
  label?: string;
  onCancel: () => void;
}

export function ActingState({ label = 'Working…', onCancel }: Props) {
  return (
    <>
      <div style={{
        width: '12px', height: '12px', borderRadius: '50%',
        border: '1.5px solid rgba(255,255,255,0.15)',
        borderTopColor: '#c4b5fd',
        animation: 'spin 0.9s linear infinite',
        flexShrink: 0,
      }} />
      <span style={{ color: '#c4b5fd', letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <div style={{ width: '1px', height: '14px', background: 'rgba(255,255,255,0.1)', flexShrink: 0 }} />
      <ChipButton onClick={onCancel} kbd="Esc">Cancel</ChipButton>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
