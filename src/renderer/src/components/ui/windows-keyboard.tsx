import * as React from 'react';
import { cn } from '@/lib/utils';
import { MacKeyboard, MacKey } from './mac-keyboard';

const KEY_H = 'h-11';

export function WindowsModifierKeyRow({
  externalActiveKeys,
  className,
}: {
  externalActiveKeys?: Set<string>;
  className?: string;
}) {
  return (
    <MacKeyboard soundSrc="" externalActiveKeys={externalActiveKeys} className={cn('w-full', className)}>
      <MacKey label="Ctrl" keyCode="ControlLeft" grow={1.1} className={KEY_H} />
      <MacKey label="Win" keyCode="MetaLeft" grow={1.1} className={KEY_H} />
      <MacKey label="Alt" keyCode="AltLeft" grow={1.1} className={KEY_H} />
      <MacKey label="Space" keyCode="Space" grow={1.6} className={KEY_H} />
      <MacKey label="Alt" keyCode="AltRight" grow={1.1} className={KEY_H} />
      <MacKey label="Win" keyCode="MetaRight" grow={1.1} className={KEY_H} />
      <MacKey label="Menu" keyCode={['ContextMenu', 'Menu']} grow={1.1} className={KEY_H} />
      <MacKey label="Ctrl" keyCode="ControlRight" grow={1.1} className={KEY_H} />
    </MacKeyboard>
  );
}
