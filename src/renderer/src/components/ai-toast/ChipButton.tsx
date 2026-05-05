import type { ReactNode, MouseEventHandler } from 'react';

interface ChipButtonProps {
  children: ReactNode;
  onClick?: MouseEventHandler;
  variant?: 'default' | 'affirm' | 'deny' | 'warn' | 'hotkey';
  kbd?: string;
}

const variantStyles: Record<string, React.CSSProperties> = {
  default: { background: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.85)' },
  affirm: { background: 'rgba(16,185,129,0.16)', borderColor: 'rgba(16,185,129,0.32)', color: '#6ee7b7' },
  deny: { background: 'rgba(239,68,68,0.14)', borderColor: 'rgba(239,68,68,0.32)', color: '#fca5a5' },
  warn: { background: 'rgba(252,211,77,0.14)', borderColor: 'rgba(252,211,77,0.3)', color: '#fcd34d' },
  hotkey: { background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.5)', fontFamily: "'Geist Mono', monospace", fontSize: '10px', padding: '0 6px', gap: '3px' },
};

export function ChipButton({ children, onClick, variant = 'default', kbd }: ChipButtonProps) {
  const style = variantStyles[variant] || variantStyles.default;

  return (
    <button
      onClick={onClick}
      style={{
        height: '22px',
        padding: '0 10px',
        borderRadius: '9999px',
        border: `1px solid ${style.borderColor}`,
        background: style.background,
        color: style.color,
        font: "500 11px 'Geist', sans-serif",
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        whiteSpace: 'nowrap',
        transition: 'background 0.15s, border-color 0.15s',
        ...style,
      }}
    >
      {children}
      {kbd && (
        <kbd style={{
          fontFamily: "'Geist Mono', monospace",
          fontSize: '9px',
          padding: '1px 4px',
          borderRadius: '3px',
          background: 'rgba(255,255,255,0.1)',
          color: 'rgba(255,255,255,0.6)',
          border: 0,
        }}>
          {kbd}
        </kbd>
      )}
    </button>
  );
}
