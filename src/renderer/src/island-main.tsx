import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './globals.css';
import { IslandDemo } from './components/island-demo';
import type { AnswerKind, IslandMaterial, IslandPlacement, IslandState } from './components/voice-island';

// Dev-only preview page. URL params pick the starting view, e.g.
// /island.html?theme=dark&state=answer&answer=image&material=opaque&placement=left
const params = new URLSearchParams(location.search);
if (params.get('theme') === 'dark') document.documentElement.classList.add('dark');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <IslandDemo
      initialState={(params.get('state') as IslandState) || undefined}
      initialAnswerKind={(params.get('answer') as AnswerKind) || undefined}
      initialMaterial={(params.get('material') as IslandMaterial) || undefined}
      initialPlacement={(params.get('placement') as IslandPlacement) || undefined}
    />
  </StrictMode>,
);
