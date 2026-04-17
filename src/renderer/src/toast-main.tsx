import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './globals.css';
import { applyTheme } from '@/lib/theme';
import type { Theme } from '@/lib/ipc';
import ToastApp from './ToastApp';

// Force a fully transparent page background for the overlay window.
// globals.css sets body background for regular windows, which causes
// a visible strip behind the toast on Windows if not overridden.
document.documentElement.style.background = 'transparent';
document.body.style.background = 'transparent';
document.body.style.setProperty('background-color', 'transparent', 'important');

if (window.tellaflow) {
  window.tellaflow.getConfig().then((c: { theme?: Theme }) => {
    applyTheme(c.theme || 'dark');
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastApp />
  </StrictMode>,
);
