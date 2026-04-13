'use client';
import { AnimatePresence, motion, MotionProps, Variants } from 'framer-motion';
import React from 'react';
import { cn } from '@/lib/utils';

interface TransitionPanelProps extends MotionProps {
  children: React.ReactNode[];
  className?: string;
  activeIndex: number;
  variants?: Variants;
  transition?: MotionProps['transition'];
  custom?: unknown;
}

export function TransitionPanel({
  children,
  className,
  activeIndex,
  variants,
  transition,
  custom,
  ...motionProps
}: TransitionPanelProps) {
  const defaultVariants: Variants = {
    enter: { opacity: 0, scale: 0.95 },
    center: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.95 },
  };

  return (
    <div className={cn('relative overflow-hidden', className)}>
      <AnimatePresence mode="wait" custom={custom}>
        <motion.div
          key={activeIndex}
          custom={custom}
          variants={variants ?? defaultVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={transition ?? { duration: 0.2, ease: 'easeInOut' }}
          {...motionProps}
        >
          {children[activeIndex]}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
