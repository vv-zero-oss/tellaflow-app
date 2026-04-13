import * as React from 'react';
import { cn } from '@/lib/utils';

const Well = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('bg-well rounded-2xl p-1', className)}
      {...props}
    />
  ),
);
Well.displayName = 'Well';

const WellHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('px-4 py-3', className)} {...props} />
  ),
);
WellHeader.displayName = 'WellHeader';

const WellTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('text-[11px] font-semibold text-well-foreground uppercase tracking-wider', className)}
      {...props}
    />
  ),
);
WellTitle.displayName = 'WellTitle';

const WellCard = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('bg-card text-card-foreground rounded-xl shadow-[var(--card-shadow)]', className)}
      {...props}
    />
  ),
);
WellCard.displayName = 'WellCard';

const WellItem = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'px-4 py-3 border-b border-dashed border-[var(--card-divider)] last:border-b-0',
        className,
      )}
      {...props}
    />
  ),
);
WellItem.displayName = 'WellItem';

export { Well, WellHeader, WellTitle, WellCard, WellItem };
