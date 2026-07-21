import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/global.css';

// Dev-only: expose the shared slur/hate-speech redactor on `window.redact` so
// it can be exercised straight from the browser console — e.g.
// `redact("you are a retard")`. This is the exact same function the Worker
// runs at write time (../../src/lib/contentFilter), so what you see here is
// what gets stored. Not bundled in production builds.
if (import.meta.env.DEV) {
  void import('../../src/lib/contentFilter').then(({ redact }) => {
    (window as unknown as { redact: typeof redact }).redact = redact;
    console.debug('[the-pit] window.redact ready — try redact("…")');
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
