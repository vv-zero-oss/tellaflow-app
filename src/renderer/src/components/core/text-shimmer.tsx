import { CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface TextShimmerProps {
  children: string;
  className?: string;
  duration?: number;
  spread?: number;
}

export function TextShimmer({ children, className, duration = 1.5, spread = 2 }: TextShimmerProps) {
  const dynamicSpread = Math.max(spread, children.length / 5);

  return (
    <motion.span
      className={cn(
        'relative inline-block bg-clip-text text-transparent',
        className,
      )}
      style={
        {
          backgroundImage:
            'linear-gradient(110deg, rgba(255,255,255,0.25) 25%, rgba(255,255,255,0.95) 50%, rgba(255,255,255,0.25) 75%), linear-gradient(rgba(255,255,255,0.35), rgba(255,255,255,0.35))',
          backgroundSize: `${dynamicSpread * 200}% 100%, auto`,
          backgroundClip: 'text',
          WebkitBackgroundClip: 'text',
        } as CSSProperties
      }
      initial={{ backgroundPosition: '200% center, 0% center' }}
      animate={{ backgroundPosition: '-200% center, 0% center' }}
      transition={{
        repeat: Infinity,
        duration,
        ease: 'linear',
      }}
    >
      {children}
    </motion.span>
  );
}
