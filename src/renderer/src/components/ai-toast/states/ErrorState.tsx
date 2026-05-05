import { ChipButton } from '../ChipButton';

interface Props {
  message?: string;
  onRetry: () => void;
}

export function ErrorState({ message = 'Something went wrong', onRetry }: Props) {
  return (
    <>
      <svg width="14" height="14" viewBox="0 0 24 24" stroke="#fca5a5" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
      </svg>
      <span style={{ color: '#fca5a5', letterSpacing: '0.02em', whiteSpace: 'nowrap', maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {message}
      </span>
      <div style={{ width: '1px', height: '14px', background: 'rgba(255,255,255,0.1)', flexShrink: 0 }} />
      <ChipButton onClick={onRetry}>
        <svg width="10" height="10" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/>
        </svg>
        Retry
      </ChipButton>
      <ChipButton>Details</ChipButton>
    </>
  );
}
