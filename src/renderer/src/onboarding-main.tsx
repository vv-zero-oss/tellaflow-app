import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './globals.css';
import { applyTheme } from '@/lib/theme';
import type { Theme } from '@/lib/ipc';
import OnboardingApp from './OnboardingApp';

if (window.tellaflow) {
  window.tellaflow.getConfig().then((c: { theme?: Theme }) => {
    applyTheme(c.theme || 'light');
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OnboardingApp />
  </StrictMode>,
);
