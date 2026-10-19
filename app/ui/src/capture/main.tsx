// The capture window's page (docs/contracts/ms5-capture.md §4; FR-CAP-01, NFR-SEC-03): `capture.html` shows the
// capture form, `capture.html#saved` the confirmation panel (R55 "After saving"). It imports only the capture client,
// the text engine, the catalog, the theme and the quick-add parser (§4, L0 test).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { applyTheme, type ThemeChoice } from '../theme/apply';
import { CaptureApp } from './CaptureApp';
import { Saved } from './Saved';
import '../styles.css';

const stored = (window as { __TEGG_UI_STATE__?: { theme?: string } | null }).__TEGG_UI_STATE__?.theme;
applyTheme((stored === 'light' || stored === 'dark' ? stored : 'system') as ThemeChoice);

createRoot(document.getElementById('root')!).render(
  <StrictMode>{location.hash === '#saved' ? <Saved /> : <CaptureApp />}</StrictMode>,
);
