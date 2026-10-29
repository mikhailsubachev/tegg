// The one preview of a window (v1-previews §3, D-924): a small store every surface and the editor's DOM code reach,
// rendered by `PreviewProvider`. Preferences come from the app's machine-local UI state (§1).
import { readPreviewUi, type PreviewUi } from './state';
import type { CloseReason, PreviewAnchor, PreviewHost, PreviewOrigin, PreviewTarget, PreviewUiDto } from './types';

export type ShowOpts = {
  /** The surface's own open (route + nav_opened) for the popover's `Open` while it shows this reference. */
  open?: () => void;
  /** Where the focus goes on Esc / Close (the editor: the caret after the chip, D-924); default the anchor. */
  returnFocus?: () => void;
  /** The reference's element now, when its surface redraws it (an editor's chips after an edit); null once it's gone. */
  relocate?: () => HTMLElement | null;
};
export type Current = {
  target: PreviewTarget; origin: PreviewOrigin; anchor: PreviewAnchor; host: PreviewHost; extraLine: string | null;
  opts: ShowOpts; seq: number;
};
export type Host = {
  /** The generic open of a target (`Open` after following a link inside the popover, ⏎ in it). */
  open(target: PreviewTarget): void;
  /** Writes `preview` into the machine-local UI state (one `ui_state_set`). */
  setPrefs(next: PreviewUiDto | undefined): void;
  /** An external link inside a preview opens in the browser (read-view FR-EDT-02 AC-10). */
  external?(url: string): void;
};

type Listener = () => void;
const subs = new Set<Listener>();
let current: Current | null = null;
let seq = 0;
/** Read at start from the UI state the shell injected (v1-previews §1), else from `ui_state_get` by the app. */
let raw: PreviewUiDto | undefined = (globalThis as { __TEGG_UI_STATE__?: { preview?: PreviewUiDto } | null }).__TEGG_UI_STATE__?.preview;
let prefs: PreviewUi = readPreviewUi(raw);
let loaded = raw !== undefined;
export const prefsLoaded = () => loaded;
let host: Host | null = null;
/** The reference that had the focus last (⌥Space, `Show preview`, R106): the palette takes the focus for a moment
 *  and gives it back (D-139), so the reference is remembered until another element gets the focus. */
let focusedRef: { el: HTMLElement; run: () => void } | null = null;
/** The editor's "caret at a chip" probe and its ⌥Space (§5.1). */
let editorProbe: (() => (() => void) | null) | null = null;

const emit = () => { for (const f of subs) f(); };

export function subscribe(f: Listener): () => void {
  subs.add(f);
  return () => { subs.delete(f); };
}
export const getCurrent = () => current;
/** Without a mounted provider (a view rendered on its own, the capture window) nothing can show a preview, so a
 *  reference acts as with `Off: click opens`. */
let providers = 0;
let offView: PreviewUi = { ...prefs, mode: 'off' };
export const getPrefs = () => (providers > 0 ? prefs : offView);
export function providerMounted(): () => void {
  providers++;
  emit();
  return () => { providers--; emit(); };
}
export const getRawPrefs = () => raw;

export function setPreviewHost(h: Host | null): void {
  host = h;
}
export function previewHost(): Host | null {
  return host;
}

/** The app's stored `preview` (read at start and after every UI-state change). */
export function setStoredPrefs(dto: PreviewUiDto | undefined): void {
  loaded = true;
  raw = dto;
  const next = readPreviewUi(dto);
  const changedMode = next.mode !== prefs.mode;
  prefs = next;
  offView = { ...next, mode: 'off' };
  if (changedMode && current) close('route');
  emit();
}

/** A committed change (Settings, palette, a resize): stored once, the other fields kept as stored (FR-SET-07 AC-3). */
export function updatePrefs(f: (d: PreviewUiDto) => PreviewUiDto | undefined): void {
  const next = f({ ...(raw ?? {}) });
  setStoredPrefs(next);
  host?.setPrefs(next);
}

let inside: ((target: PreviewTarget) => void) | null = null;
let lastInside: { target: PreviewTarget; at: number } | null = null;
const DOUBLE_CLICK_MS = 500;
/** The reference whose click just replaced the preview's content, when a double-click now belongs to it (its first
 *  click replaced the element the second one lands on). */
export function insideDoubleClick(): PreviewTarget | null {
  const l = lastInside;
  lastInside = null;
  return l && Date.now() - l.at <= DOUBLE_CLICK_MS ? l.target : null;
}
/** The open popover's history push (D-932): a reference inside it replaces its content instead of a new preview. */
export function setInside(f: ((target: PreviewTarget) => void) | null): void {
  inside = f;
}

/** A link inside a shown preview that has no element of its own (a card's property chip): it replaces the content
 *  (D-932); without a preview it opens. */
export function pushInside(target: PreviewTarget): void {
  if (current && inside) inside(target);
  else host?.open(target);
}

export function show(target: PreviewTarget, anchor: PreviewAnchor, origin: PreviewOrigin, h?: PreviewHost, extraLine?: string, opts: ShowOpts = {}): void {
  if (current && inside && 'el' in anchor && anchor.el.closest?.('[data-preview-popover], .preview-column')) {
    // Inside a preview a click replaces the content (D-932); a double-click there opens it (FR-LNK-11 AC-10).
    lastInside = origin === 'click' ? { target, at: Date.now() } : null;
    inside(target);
    return;
  }
  prefetch?.(target);
  current = { target, origin, anchor, host: h ?? { placement: 'popover' }, extraLine: extraLine ?? null, opts, seq: ++seq };
  emit();
}

/** Replaces the shown preview's origin (a click inside a hover preview makes it a clicked one, D-942). */
export function promote(): void {
  if (current && current.origin === 'hover') { current = { ...current, origin: 'click' }; emit(); }
}

let prefetch: ((target: PreviewTarget) => void) | null = null;
/** Starts a shown target's read in `show` itself, a frame before the popover's effects run (NFR-PERF-12). */
export function setPrefetch(f: ((target: PreviewTarget) => void) | null): void {
  prefetch = f;
}

let closer: ((reason: CloseReason) => void) | null = null;
/** The popover's own close (focus return, history drop); set by the mounted popover. */
export function setCloser(f: ((reason: CloseReason) => void) | null): void {
  closer = f;
}
export function close(reason: CloseReason): void {
  if (!current) return;
  const c = current;
  current = null;
  emit();
  closer?.(reason);
  if (reason === 'esc' || reason === 'button') returnFocusOf(c);
}

export function returnFocusOf(c: Current): void {
  if (c.opts.returnFocus) { c.opts.returnFocus(); return; }
  if ('el' in c.anchor && c.anchor.el.isConnected) c.anchor.el.focus({ preventScroll: true });
}

/** The provider unmounted (a window closing, a test's cleanup): nothing is shown any more. */
export function reset(): void {
  current = null;
  inside = null;
  emit();
}

export function setFocusedRef(f: { el: HTMLElement; run: () => void } | null): void {
  focusedRef = f;
}
if (typeof document !== 'undefined') {
  document.addEventListener('focusin', (e) => {
    const t = e.target as HTMLElement | null;
    if (!focusedRef || !t || t === focusedRef.el || t.closest?.('[role="dialog"][aria-modal="true"], .palette, [aria-label="Command palette"]')) return;
    if (!t.closest?.('[data-preview-ref]')) focusedRef = null;
  }, true);
}
export function setEditorProbe(f: (() => (() => void) | null) | null): void {
  editorProbe = f;
}
/** `Show preview` (⌥Space, R106): the focused reference's, else the editor's chip at the caret; null when neither. */
export function showPreviewAction(): (() => void) | null {
  if (focusedRef && focusedRef.el.isConnected) return focusedRef.run;
  return editorProbe?.() ?? null;
}
