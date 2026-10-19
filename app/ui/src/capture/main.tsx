// The capture window's page (docs/contracts/ms5-capture.md §4; FR-CAP-01, NFR-SEC-03): `capture.html` shows the
// capture form, `capture.html#saved` the confirmation panel (R55 "After saving"). It imports only the capture client,
// the text engine, the catalog, the theme and the quick-add parser (§4, L0 test).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { applyTheme, type ThemeChoice } from '../theme/apply';
import { setDateTimeSetting, type DateTimeSetting } from '../i18n/dates';
import { captureEvents } from '../ipc/capture';
import { CaptureApp } from './CaptureApp';
import { Saved } from './Saved';
import '../styles.css';

const initial = (window as { __TEGG_UI_STATE__?: { theme?: string; dateTime?: DateTimeSetting | null } | null }).__TEGG_UI_STATE__;
const theme = (t?: string) => applyTheme((t === 'light' || t === 'dark' ? t : 'system') as ThemeChoice);
theme(initial?.theme);
setDateTimeSetting(initial?.dateTime ?? undefined);
// FR-CAP-01 AC-14 (§4): the window is pre-warmed, so a change in Settings arrives as `ui:state`.
void captureEvents.uiState((s) => {
  theme(s.theme);
  setDateTimeSetting(s.dateTime ?? undefined);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>{location.hash === '#saved' ? <Saved /> : <CaptureApp />}</StrictMode>,
);
