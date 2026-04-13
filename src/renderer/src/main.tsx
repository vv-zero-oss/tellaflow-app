import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './globals.css';
import { applyTheme } from '@/lib/theme';
import type { Theme } from '@/lib/ipc';
import App from './App';

if (window.tellaflow) {
  window.tellaflow.getConfig().then((c: { theme?: Theme }) => {
    applyTheme(c.theme || 'dark');
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
