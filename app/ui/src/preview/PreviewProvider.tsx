// One preview per window (v1-previews §3, D-924): mounted in App.tsx above the routes. `usePreview` is the public
// face of the store for surfaces and the graph (§7: `show(target, anchor, origin, host, extraLine)`).
import { useEffect, useSyncExternalStore } from 'react';
import { events, ipc } from '../ipc/client';
import { forgetPreviewCaches } from './load';
import { PreviewPopover, startPreviewRead } from './PreviewPopover';
import { LinkUiHost } from './linkUi';
import { close, getCurrent, setPrefetch, getPrefs, prefsLoaded, previewHost, providerMounted, reset, setStoredPrefs, show, subscribe } from './store';
import type { PreviewUiDto } from './types';
import type { CloseReason, PreviewAnchor, PreviewHost, PreviewOrigin, PreviewTarget } from './types';

export function PreviewProvider(props: { children?: React.ReactNode }) {
  const cur = useSyncExternalStore(subscribe, getCurrent);
  // Without the app (which reads the UI state itself and passes it on), the provider reads it once.
  useEffect(() => {
    if (prefsLoaded() || previewHost()) return;
    ipc.uiStateGet().then((s) => { if (!prefsLoaded()) setStoredPrefs((s as { preview?: PreviewUiDto } | null)?.preview); }, () => {});
  }, []);
  useEffect(() => {
    const off = providerMounted();
    setPrefetch(startPreviewRead);
    return () => { off(); setPrefetch(null); reset(); };
  }, []);
  // Derived data (the D-289 details) follows the vault whether or not a preview is open.
  useEffect(() => {
    const off = events.changed(() => forgetPreviewCaches());
    return () => { void off.then((f) => f()).catch(() => {}); };
  }, []);
  return (
    <>
      {props.children}
      <LinkUiHost />
      {cur && <PreviewPopover key={cur.host.placement === 'column' ? 'column' : 'popover'} cur={cur} />}
    </>
  );
}

export function usePreview(): {
  mode: 'click' | 'hover' | 'off';
  hoverDelay: number;
  show(target: PreviewTarget, anchor: PreviewAnchor, origin: PreviewOrigin, host?: PreviewHost, extraLine?: string): void;
  close(reason: CloseReason): void;
  current: { target: PreviewTarget; origin: PreviewOrigin } | null;
} {
  const prefs = useSyncExternalStore(subscribe, getPrefs);
  const cur = useSyncExternalStore(subscribe, getCurrent);
  return {
    mode: prefs.mode,
    hoverDelay: prefs.hoverDelay,
    show: (target, anchor, origin, host, extraLine) => show(target, anchor, origin, host, extraLine),
    close,
    current: cur ? { target: cur.target, origin: cur.origin } : null,
  };
}
