import { ChipButton } from '../ChipButton';

interface Props {
  question?: string;
  onYes: () => void;
  onNo: () => void;
}

export function ConfirmState({ question = 'Confirm action?', onYes, onNo }: Props) {
  return (
    <>
      <svg width="14" height="14" viewBox="0 0 24 24" stroke="rgba(255,255,255,0.7)" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <path d="M4 4h16v12H5.17L4 17.17z"/>
      </svg>
      <span style={{ color: '#fcd34d', letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
        {question}
      </span>
      <div style={{ width: '1px', height: '14px', background: 'rgba(255,255,255,0.1)', flexShrink: 0 }} />
      <ChipButton variant="affirm" onClick={onYes} kbd="Y">
        <svg width="10" height="10" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        Yes
      </ChipButton>
      <ChipButton variant="deny" onClick={onNo} kbd="N">
        <svg width="10" height="10" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        No
      </ChipButton>
    </>
  );
}
