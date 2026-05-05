interface Props {
  message?: string;
}

export function SuccessState({ message = 'Done' }: Props) {
  return (
    <>
      <svg width="14" height="14" viewBox="0 0 24 24" stroke="#6ee7b7" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      <span style={{ color: '#6ee7b7', letterSpacing: '0.02em', whiteSpace: 'nowrap', maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {message}
      </span>
    </>
  );
}
