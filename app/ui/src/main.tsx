import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTheme, type ThemeChoice } from './theme/apply';
import './styles.css';

// No flash of the wrong theme (FR-UX-05 AC-6): the stored theme, set by the shell before the page runs, is applied
// before the first render.
const stored = (window as { __TEGG_UI_STATE__?: { theme?: string } | null }).__TEGG_UI_STATE__?.theme;
applyTheme((stored === 'light' || stored === 'dark' ? stored : 'system') as ThemeChoice);

// Shortcuts pressed before the app's key handler is registered (right after a load) are kept and replayed by it, so a
// quick ⌘K isn't lost (FR-UX-03).
const w = window as { __teggEarlyKeys?: KeyboardEvent[]; __teggKeysReady?: boolean };
w.__teggEarlyKeys = [];
window.addEventListener('keydown', (e) => { if (!w.__teggKeysReady && (e.metaKey || e.ctrlKey)) w.__teggEarlyKeys!.push(e); }, true);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
