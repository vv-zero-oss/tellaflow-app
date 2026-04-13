import type { Theme } from './ipc';

function getEffectiveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

export function applyTheme(theme: Theme) {
  const effective = getEffectiveTheme(theme);
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(effective);
}

export function listenForSystemThemeChange(getCurrentTheme: () => Theme) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => {
    if (getCurrentTheme() === 'system') {
      applyTheme('system');
    }
  };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}
