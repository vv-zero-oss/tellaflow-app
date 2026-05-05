import React from 'react';
import { createRoot } from 'react-dom/client';
import { AiToastApp } from './components/ai-toast/AiToastApp';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AiToastApp />
  </React.StrictMode>
);
