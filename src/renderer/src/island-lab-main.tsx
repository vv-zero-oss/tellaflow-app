import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './globals.css';
import IslandLab from './components/island/IslandLab';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <IslandLab />
  </StrictMode>,
);
