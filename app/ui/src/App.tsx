// The MS3 slice 3A shell (architecture §12, docs/contracts/ms3-shell.md): the frame with every designed page,
// TBD placeholders for later phases (D-116), the command palette and shortcuts (FR-UX-03), themes (FR-UX-05),
// the vault chooser (FR-VLT-01) and the launch landing (D-132). The note route is the slice 3B read view (D-117).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { t } from './i18n/catalog';
import { events, ipc } from './ipc/client';
import type { ProgressDto, SwitcherItemDto, TypeDefDto, UiStateDto, VaultInfo } from './ipc/types';
import { Chooser } from './pages/Chooser';
import { ConflictsPage } from './pages/ConflictsPage';
import { NotePage, type NoteMeta, type NotePageApi } from './pages/NotePage';
import { SearchPage } from './pages/SearchPage';
import { SettingsPage } from './pages/SettingsPage';
import { TypePage, type TypeSort } from './pages/TypePage';
import { TypeSettingsPage } from './pages/TypeSettingsPage';
import { createObject, type Prepared } from './types/create';
import { NewTypeDialog } from './types/NewTypeDialog';
import { StarterTypesDialog } from './types/StarterTypesDialog';
import { commands, type Command, type ShellActions, type ShellContext, type ThemeChoice } from './shell/commands';
import { ContextPanel, Sidebar, TitleBar } from './shell/Frame';
import { routeIcon, typeIconName } from './shell/Icon';
import { eventKeys } from './shell/keys';
import { createHistory } from './shell/history';
import { NewObjectDialog } from './shell/NewObjectDialog';
import { Palette } from './shell/Palette';
import { Placeholder } from './shell/Placeholder';
import { ROUTES, SHORTCUTS, routeDef } from './shell/registry';
import { parseRoute, routeString, type Route } from './shell/routes';
import { typeEntries } from './shell/types';
import { Switcher } from './Switcher';
import { applyTheme } from './theme/apply';
import { BrokenLinksPage } from './links/BrokenLinksPage';
import { CreateLinkOffer } from './links/CreateLinkOffer';
import { DuplicateTitlesPage } from './links/DuplicateTitlesPage';
import { setChipTypes } from './links/icons';
import { setOfferHandler, type OfferRequest } from './links/offer';
import type { OccurrenceDto } from './ipc/types';

const SIDEBAR_W = 232;
const PANEL_W = 288;
const MIN_CENTRE = 400; // D-136

type Dialog = 'palette' | 'switcher' | 'newObject' | 'newType' | 'starter' | null;
type PanelTab = 'backlinks' | 'outline' | 'graph';

/** 3D (ms3-shell §14.7.1): `typeSort` and `otherPropertiesOpen`; missing fields read as defaults, `version` stays 1. */
type UiState = UiStateDto & { typeSort?: Record<string, TypeSort>; otherPropertiesOpen?: boolean };
const DEFAULT_UI: UiState = { version: 1, theme: 'system', sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' }, propertiesOpen: true, typeSort: {}, otherPropertiesOpen: false };

function initialUi(): UiState {
  const w = window as { __TEGG_UI_STATE__?: UiState | null };
  return w.__TEGG_UI_STATE__ ? { ...DEFAULT_UI, ...w.__TEGG_UI_STATE__ } : DEFAULT_UI;
}

export function App() {
  const [vault, setVault] = useState<VaultInfo | null | undefined>(undefined);
  const [types, setTypes] = useState<TypeDefDto[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [route, setRoute] = useState<Route | null>(null);
  const [chooser, setChooser] = useState<{ form: boolean } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [defineValue, setDefineValue] = useState<string | null>(null); // D-251: New type for an undefined value
  const [ui, setUi] = useState<UiState>(initialUi);
  const [newOfType, setNewOfType] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [width, setWidth] = useState(window.innerWidth);
  const [progress, setProgress] = useState<ProgressDto | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // 4A: the Create offer of a broken link (FR-LNK-04 AC-4) and `Show backlinks` (R16).
  const [offer, setOffer] = useState<OfferRequest | null>(null);
  const [focusBacklinks, setFocusBacklinks] = useState(0);
  useEffect(() => { setOfferHandler((r) => setOffer(r)); return () => setOfferHandler(null); }, []);
  useEffect(() => { setChipTypes(types); }, [types]);
  const [refresh, setRefresh] = useState(0);
  const [meta, setMeta] = useState<NoteMeta | null>(null);
  /** The open note has loaded (or is gone): the centre pane is named only then, so its content is there with it. */
  const [noteShown, setNoteShown] = useState(false);
  const metaRef = useRef<NoteMeta | null>(null);
  metaRef.current = meta;
  const [sourceToggle, setSourceToggle] = useState(0);
  const [conflicts, setConflicts] = useState(0);
  const [quitAsk, setQuitAsk] = useState<'unsaved' | 'keepBoth' | null>(null);
  // The note page stays mounted through a rename (FR-SYN-03 AC-18): it is keyed by navigation, not by path.
  const [navKey, setNavKey] = useState(0);
  const noteApi = useRef<NotePageApi | null>(null);
  const justCreated = useRef<string | null>(null);
  /** Saves the open note before leaving it (FR-EDT-08 AC-7). */
  const flushNote = useCallback(async () => {
    try { await noteApi.current?.flush(); } catch { /* the page shows its own save state */ }
  }, []);
  // Back/forward (FR-NAV-03, D-165): in memory, one per window; `histTick` re-renders the title-bar buttons.
  const history = useRef(createHistory());
  const [, setHistTick] = useState(0);
  const pendingScroll = useRef<number | null>(null);
  // The `id` of every note shown, so Back/Forward can follow a note renamed in the meantime (FR-NAV-03 AC-5).
  const knownIds = useRef(new Map<string, string>());
  const centreScroll = () => document.querySelector('main')?.scrollTop ?? 0;
  const heading = useRef<HTMLHeadingElement | null>(null);
  const searchInput = useRef<HTMLInputElement | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const pendingFocus = useRef(false);
  const pendingReturn = useRef<HTMLElement | null>(null);
  const uiLoaded = useRef(false);

  // ------------------------------------------------------------------ theme and machine-local UI state (D-128)
  useLayoutEffect(() => applyTheme(ui.theme as ThemeChoice), [ui.theme]);
  useEffect(() => {
    if ((window as { __TEGG_UI_STATE__?: unknown }).__TEGG_UI_STATE__) {
      uiLoaded.current = true;
      return;
    }
    ipc.uiStateGet().then((s) => { uiLoaded.current = true; setUi({ ...DEFAULT_UI, ...(s as UiState) }); }, () => { uiLoaded.current = true; });
  }, []);
  const updateUi = useCallback((f: (u: UiState) => UiState) => {
    setUi((u) => {
      const next = f(u);
      void ipc.uiStateSet(next).catch(() => {});
      return next;
    });
  }, []);

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ------------------------------------------------------------------ vault, types, counts, events
  const loadTypes = useCallback((): Promise<unknown> => {
    ipc.conflicts().then((c) => setConflicts(c.length), () => setConflicts(0));
    return Promise.all([
      ipc.vaultTypes().then(setTypes, () => setTypes([])),
      ipc.typeCounts().then(setCounts, () => setCounts({})),
    ]);
  }, []);

  const land = useCallback(async () => {
    const forced = (window as { __TEGG_ROUTE__?: string | null }).__TEGG_ROUTE__;
    const r = forced ? parseRoute(forced) : null;
    const landing: Route = r ?? await ipc.vaultLast().then((last) => (last ? { id: 'note/<path>', param: last.path } : { id: 'home' }), () => ({ id: 'home' }));
    history.current.clear(); // D-171: the history starts with the landing route
    history.current.push(landing);
    setHistTick((n) => n + 1);
    setNavKey((n) => n + 1);
    setRoute(landing);
  }, []);

  const liveVault = useRef<VaultInfo | null>(null);
  liveVault.current = vault ?? null;
  const opened = useCallback((v: VaultInfo) => {
    setVault(v);
    setChooser(null);
    setRoute(null);
    history.current.clear(); // another vault: a new history (AC-7)
    pendingFocus.current = true;
    // The landing page shows with the sidebar's types and counts (3D: the panel needs the type definitions).
    void loadTypes().finally(() => void land());
  }, [land, loadTypes]);

  /** D-219: open another vault from the title-bar switcher or ⌃⌘n, as the chooser does (FR-VLT-01 AC-15); an error
   *  (not a Tegg vault, gone) shows the chooser, which explains it. */
  const openVaultPath = useCallback((path: string) => {
    setDialog(null);
    void flushNote().then(() => ipc.vaultOpen(path)).then(opened, () => setChooser({ form: false }));
  }, [opened]);

  useEffect(() => {
    ipc.vaultCurrent().then((v) => (v ? opened(v) : setVault(null)), () => setVault(null));
    const un = [
      events.progress(setProgress),
      events.changed(() => { setRefresh((n) => n + 1); }),
    ];
    return () => un.forEach((p) => p.then((f) => f()));
  }, []);

  useEffect(() => {
    if (vault) loadTypes();
  }, [refresh]);

  // `ui-ready` (ms2-shell §1, ms3-shell §1): the frame or the chooser has painted. WebKit pauses frames for a
  // hidden window, so a timer backs the frame callback up.
  useEffect(() => {
    if (vault === undefined) return;
    const mark = () => ipc.perfMark('ui-ready').catch(() => {});
    requestAnimationFrame(() => setTimeout(mark, 0));
    const fallback = setTimeout(mark, 250);
    return () => clearTimeout(fallback);
  }, [vault === undefined]);

  // ------------------------------------------------------------------ navigation
  const go = useCallback(async (r: Route, o: { keepDialog?: boolean } = {}) => {
    await flushNote();
    setChooser(null);
    if (!o.keepDialog) setDialog(null);
    setFocusMode(false);
    pendingReturn.current = null; // navigation moves the focus to the new page, not back (D-130)
    pendingFocus.current = true;
    history.current.saveScroll(centreScroll());
    history.current.push(r);
    setHistTick((n) => n + 1);
    setNavKey((n) => n + 1);
    setRoute(r);
  }, []);
  const step = useCallback(async (dir: 'back' | 'forward') => {
    if (dir === 'back' ? !history.current.canBack() : !history.current.canForward()) return;
    await flushNote();
    history.current.saveScroll(centreScroll());
    const e = dir === 'back' ? history.current.back() : history.current.forward();
    if (!e) return;
    setChooser(null);
    setFocusMode(false);
    pendingReturn.current = null;
    pendingFocus.current = true;
    pendingScroll.current = e.scrollTop;
    setHistTick((n) => n + 1);
    setNavKey((n) => n + 1);
    setRoute(e.route);
  }, []);
  // A focus the user makes before the new page is ready wins over the pending heading focus.
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      if (pendingFocus.current && e.target !== heading.current && e.target !== document.body) pendingFocus.current = false;
    };
    window.addEventListener('focusin', onFocus);
    return () => window.removeEventListener('focusin', onFocus);
  }, []);
  /** An excerpt (FR-LNK-01 AC-6): the source at the mention; a property link focuses that property (D-280). */
  const openMention = useCallback((source: string, o: OccurrenceDto | null) => {
    const r: Route = { id: 'note/<path>', param: source.normalize('NFC') };
    if (o?.kind === 'attribute' && o.attribute) r.attr = o.attribute;
    else if (o) r.at = { line: o.at.line, byte: o.at.byte };
    void go(r);
  }, []);
  const openNote = useCallback((path: string, fragment?: string, keepDialog = false) => { void go({ id: 'note/<path>', param: path.normalize('NFC'), ...(fragment ? { fragment } : {}) }, { keepDialog }); }, [go]);
  // D-218: a tag opens its tag page; until tag pages (FR-TAG-06, MS4) that is the Tags placeholder.
  const openTag = useCallback((_key: string) => { void go({ id: 'tags' }); }, [go]);

  const routeKey = route ? routeString(route) : '';
  // The route a Back/Forward step is restoring the scroll position of (not re-scrolled to its fragment, AC-4).
  const restoreFor = pendingScroll.current !== null ? routeKey : null;
  useEffect(() => {
    setMeta(null);
    setNoteShown(false);
    if (route?.id === 'note/<path>' && route.param) void ipc.navOpened(route.param).catch(() => {});
  }, [routeKey]);

  /** The one creation path (D-232, FR-TYP-03 AC-12): ⌘N, the switcher's create item and the type page's New <Name>. */
  const createOf = useCallback(async (typeKey: string, rawTitle: string, prepared: Prepared | null = null) => {
    setDialog(null);
    setNewOfType(null);
    const title = rawTitle.normalize('NFC');
    if (noteApi.current?.pending()) await flushNote(); // FR-EDT-08 AC-7: the open note is saved before the new object is written
    const made = prepared ? prepared.create(title) : createObject(typeKey, title);
    // A dialog the user opened while the object was being created stays open (the new note opens behind it).
    made.then((p) => { justCreated.current = p.normalize('NFC'); openNote(p, undefined, true); }, () => setMessage(t('error.io')));
  }, [openNote]);
  const createFrom = useCallback((item: SwitcherItemDto, prepared?: Prepared | null) => createOf(item.type, item.title, prepared ?? null), [createOf]);

  // ------------------------------------------------------------------ quitting (FR-EDT-08 AC-7, AC-11; FR-SYN-03 AC-19; D-196)
  useEffect(() => {
    const quit = () => { void ipc.appQuit().catch(() => {}); };
    const un = events.quitRequested(async () => {
      const api = noteApi.current;
      if (!api) { quit(); return; }
      if (api.mergeOpen()) { setQuitAsk('keepBoth'); return; }
      await Promise.race([api.flush(), new Promise((r) => setTimeout(r, 2000))]);
      if (api.pending()) setQuitAsk('unsaved');
      else quit();
    });
    return () => void un.then((f) => f());
  }, []);

  // ------------------------------------------------------------------ layout
  const isObject = route?.id === 'note/<path>';
  const available = width - (ui.sidebarOpen ? SIDEBAR_W : 0);
  const panelFits = available - PANEL_W >= MIN_CENTRE;
  const showSidebar = ui.sidebarOpen && !focusMode;
  const showPanel = isObject && ui.rightPanel.open && panelFits && !focusMode;

  const actions: ShellActions = useMemo(() => ({
    go: (r: Route) => { void go(r); },
    openPalette: () => setDialog('palette'),
    openSwitcher: () => { returnFocus.current = document.activeElement as HTMLElement | null; pendingFocus.current = false; setDialog('switcher'); },
    newObject: () => { returnFocus.current = document.activeElement as HTMLElement | null; pendingFocus.current = false; setNewOfType(null); setDialog('newObject'); },
    newType: () => { returnFocus.current = document.activeElement as HTMLElement | null; pendingFocus.current = false; setDefineValue(null); setDialog('newType'); },
    addStarterTypes: () => { returnFocus.current = document.activeElement as HTMLElement | null; pendingFocus.current = false; setDialog('starter'); },
    newObjectOfType: (key: string) => { returnFocus.current = document.activeElement as HTMLElement | null; pendingFocus.current = false; setNewOfType(key); setDialog('newObject'); },
    openTypeSettings: () => {
      const key = route?.id === 'type/<type>' ? route.param : route?.id === 'note/<path>' ? (metaRef.current?.type ?? 'page') : undefined;
      if (key) void go({ id: 'type-settings/<type>', param: key });
    },
    // After the palette has closed and given the focus back (D-139), the menu or the first control takes it.
    changeType: () => { if (route?.id === 'note/<path>') setTimeout(() => noteApi.current?.changeType(), 0); },
    editProperties: () => { if (route?.id === 'note/<path>') setTimeout(() => noteApi.current?.editProperties(), 0); },
    toggleSidebar: () => updateUi((u) => ({ ...u, sidebarOpen: !u.sidebarOpen })),
    toggleRightPanel: () => {
      if (route?.id !== 'note/<path>') return;
      // Closing the panel with the focus in it gives the focus back to the note (FR-LNK-01 AC-14).
      if (document.activeElement?.closest('.context-panel')) noteApi.current?.placeFocus();
      updateUi((u) => ({ ...u, rightPanel: { ...u.rightPanel, open: !u.rightPanel.open } }));
    },
    showBacklinks: () => {
      if (route?.id !== 'note/<path>') return;
      updateUi((u) => ({ ...u, rightPanel: { open: true, tab: 'backlinks' } }));
      setFocusBacklinks((n) => n + 1);
    },
    toggleFocus: () => {
      if (route?.id !== 'note/<path>') return;
      setFocusMode((f) => !f);
      requestAnimationFrame(() => heading.current?.focus());
    },
    toggleSource: () => { if (route?.id === 'note/<path>') setSourceToggle((n) => n + 1); },
    back: () => { void step('back'); },
    forward: () => { void step('forward'); },
    toggleProperties: () => { if (route?.id === 'note/<path>') updateUi((u) => ({ ...u, propertiesOpen: !u.propertiesOpen })); },
    openChooser: (form: boolean) => { setDialog(null); void flushNote().then(() => setChooser({ form })); },
    openRecent: (n: number) => {
      void ipc.vaultRecent().then((list) => {
        const r = list[n - 1];
        if (!r || !r.exists || r.path.normalize('NFC') === liveVault.current?.path.normalize('NFC')) return;
        openVaultPath(r.path);
      }, () => {});
    },
    openFolder: () => { void ipc.vaultPickDir().then((p) => { if (p) openVaultPath(p); }, () => {}); },
    about: () => { void ipc.appAbout().catch(() => {}); },
    setTheme: (c: ThemeChoice) => updateUi((u) => ({ ...u, theme: c })),
    edit: (a) => { if (route?.id === 'note/<path>') noteApi.current?.edit(a); },
  }), [go, step, route?.id, route?.param, updateUi]);

  const ctx: ShellContext = { vault: vault ?? null, types, counts, actions, route: route ?? null };
  const list = useMemo(() => commands(ctx), [types, counts, vault, actions, routeKey]);
  const chooserShown = vault === null || chooser !== null;
  const available_commands = useMemo(() => (chooserShown ? list.filter((c) => !c.needsVault) : list), [list, chooserShown]);

  const run = useCallback((c: Command) => {
    if (c.due) return;
    void c.run(ctx);
  }, [ctx]);

  // Test hook (ms3-shell §10): registered command ids and route ids.
  useEffect(() => {
    const w = window as { __TEGG_TEST__?: Record<string, unknown> };
    w.__TEGG_TEST__ = { ...(w.__TEGG_TEST__ ?? {}), commands: () => list.map((c) => c.id), routes: () => ROUTES.map((r) => r.id) };
  }, [list]);

  // Focus returns to where it was as soon as the dialog is gone, before the next key (D-139).
  const closeDialog = useCallback(() => {
    pendingReturn.current = returnFocus.current;
    returnFocus.current = null;
    setDialog(null);
  }, []);
  useLayoutEffect(() => {
    if (dialog) return;
    const back = pendingReturn.current;
    pendingReturn.current = null;
    if (back?.isConnected) back.focus();
  }, [dialog]);

  // ------------------------------------------------------------------ keyboard (FR-UX-03 AC-9, D-137)
  // One listener reads the latest state through a ref, so a key right after a render never sees stale state.
  const live = useRef({ dialog, focusMode, available_commands, run, closeDialog });
  live.current = { dialog, focusMode, available_commands, run, closeDialog };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const L = live.current;
      // WebKit goes back in history on ⌫ outside a text field, which would blank the read-only views (3B).
      const el = e.target as HTMLElement | null;
      if (e.key === 'Backspace' && !(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)))) e.preventDefault();
      if (e.key === 'Escape' && L.dialog && !e.defaultPrevented) {
        e.preventDefault();
        L.closeDialog();
        return;
      }
      if (e.key === 'Escape' && !L.dialog && L.focusMode) {
        e.preventDefault();
        setFocusMode(false);
        requestAnimationFrame(() => heading.current?.focus());
        return;
      }
      const keys = eventKeys(e);
      if (!keys) return;
      const s = SHORTCUTS.find((x) => x.keys === keys);
      if (!s) return;
      // Editor commands the editor already handled (⌘Z in the text) don't run twice.
      if (s.command.startsWith('edit.') && e.defaultPrevented) return;
      e.preventDefault();
      if (s.command === 'app.palette') {
        if (L.dialog !== 'palette') {
          if (!L.dialog) returnFocus.current = document.activeElement as HTMLElement | null;
          pendingFocus.current = false;
          setDialog('palette');
        }
        return;
      }
      if (L.dialog) return; // only the open dialog's keys act
      const c = L.available_commands.find((x) => x.id === s.command);
      if (c) L.run(c);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);


  // Mouse back/forward buttons and a two-finger horizontal swipe (FR-NAV-03, ms3-shell §12.2).
  useEffect(() => {
    // The page's mouseup (where the webview passes it) and the shell's native event (where it doesn't, 3C feedback)
    // may both report one press: the second within 300 ms is ignored.
    let last = { from: '', at: 0 };
    const press = (dir: 'back' | 'forward', from: 'page' | 'native') => {
      if (live.current.dialog) return; // dialogs keep their input (AC-6)
      const twice = last.from !== from && Date.now() - last.at < 300;
      last = { from, at: Date.now() };
      if (!twice) void step(dir);
    };
    const onMouse = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      press(e.button === 3 ? 'back' : 'forward', 'page');
    };
    const unNative = events.navMouse((d) => press(d, 'native'));
    let dx = 0;
    let since = 0;
    let fired = false;
    const scrollsX = (el: Element | null) => {
      for (let n = el; n; n = n.parentElement) {
        if (n.scrollWidth > n.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(n).overflowX)) return true;
      }
      return false;
    };
    const onWheel = (e: WheelEvent) => {
      if (live.current.dialog || Math.abs(e.deltaX) <= 3 * Math.abs(e.deltaY) || scrollsX(e.target as Element)) return;
      if (e.timeStamp - since > 120) { dx = 0; fired = false; }
      since = e.timeStamp;
      dx += e.deltaX;
      if (!fired && Math.abs(dx) >= 80) {
        fired = true;
        void step(dx < 0 ? 'back' : 'forward'); // fingers to the right scroll left: back, as in Safari
      }
    };
    window.addEventListener('mouseup', onMouse);
    window.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      void unNative.then((f) => f());
      window.removeEventListener('mouseup', onMouse);
      window.removeEventListener('wheel', onWheel);
    };
  }, [step]);

  // ------------------------------------------------------------------ the current page
  const def = route ? routeDef(route.id) : undefined;
  const typeEntry = route?.id === 'type/<type>' ? typeEntries(types, counts).find((e) => e.key === route.param) : undefined;
  const pageName: string =
    route?.id === 'note/<path>' ? (meta?.title ?? (route.param ?? '').split('/').pop()!.replace(/\.md$/, ''))
      : route?.id === 'type/<type>' ? (typeEntry?.plural ?? route.param ?? '')
        : def ? t(def.name) : '';
  const userNamed = route?.id === 'note/<path>' || route?.id === 'type/<type>';

  // Focus moves to the new page's heading after navigation (D-130); `route-ready:` marks for Appium (§1).
  useEffect(() => {
    if (!route || chooserShown) return;
    let tries = 0;
    const tick = () => {
      const h = heading.current;
      const ready = !!h && (route.id !== 'note/<path>' || meta !== null);
      if (!ready) { if (tries++ < 60) requestAnimationFrame(tick); return; }
      if (pendingFocus.current && !live.current.dialog) {
        pendingFocus.current = false;
        // A note places the focus itself: title of a new note, caret in the body, or its heading (D-247, D-255).
        if (route.id === 'note/<path>' && noteApi.current) { if (route.param === justCreated.current) justCreated.current = null; noteApi.current.placeFocus(); }
        // Search starts in its field (owner feedback F3, docs/feedback/ms3-3d.md); other pages focus the heading.
        else if (route.id === 'search' && searchInput.current) searchInput.current.focus({ preventScroll: true });
        else h!.focus({ preventScroll: true });
      }
      if (pendingScroll.current !== null && route.id !== 'note/<path>') {
        const m = document.querySelector('main');
        if (m) m.scrollTop = pendingScroll.current;
        pendingScroll.current = null;
      }
      void ipc.perfMark(`route-ready:${routeKey}`).catch(() => {});
    };
    requestAnimationFrame(tick);
  }, [routeKey, meta, chooserShown]);

  if (vault === undefined) return null;

  if (chooserShown) {
    return (
      <>
        <Chooser key={chooser ? `c${chooser.form}` : 'none'} startWithForm={chooser?.form ?? false} onOpened={opened} onCancel={vault ? () => setChooser(null) : undefined} />
        {dialog === 'palette' && <Palette list={available_commands} onRun={(c) => { closeDialog(); run(c); }} onClose={closeDialog} />}
      </>
    );
  }

  let body: React.ReactNode = null;
  if (route?.id === 'note/<path>' && route.param) {
    body = (
      <NotePage
        key={navKey}
        apiRef={noteApi}
        created={justCreated.current === route.param}
        path={route.param}
        fragment={route.fragment}
        at={route.at}
        attr={route.attr}
        restoreScroll={restoreFor === routeKey ? (pendingScroll.current ?? undefined) : undefined}
        onRestored={() => { pendingScroll.current = null; }}
        knownId={knownIds.current.get(route.param)}
        onId={(id) => knownIds.current.set(route.param!, id)}
        types={types}
        heading={heading}
        onMeta={(m) => { setMeta(m); setNoteShown(true); }}
        onType={(k) => go({ id: 'type/<type>', param: k })}
        onOpen={openNote}
        onTag={openTag}
        onRenamed={(p) => {
          const r: Route = { id: 'note/<path>', param: p.normalize('NFC') };
          history.current.replace(r);
          setRoute(r);
        }}
        toggleSource={sourceToggle}
        focusMode={focusMode}
        onTogglePanel={actions.toggleRightPanel}
        onFocus={actions.toggleFocus}
        propertiesOpen={ui.propertiesOpen}
        onToggleProperties={actions.toggleProperties}
        otherOpen={!!ui.otherPropertiesOpen}
        onToggleOther={() => updateUi((u) => ({ ...u, otherPropertiesOpen: !u.otherPropertiesOpen }))}
        onTypeSaved={loadTypes}
      />
    );
  } else if (route?.id === 'type/<type>' && route.param) {
    const key = route.param;
    body = (
      <TypePage
        key={key}
        typeKey={key}
        type={types.find((x) => x.key.normalize('NFC') === key.normalize('NFC'))}
        types={types}
        plural={pageName}
        refresh={refresh}
        heading={heading}
        sort={ui.typeSort?.[key]}
        onSort={(s) => updateUi((u) => ({ ...u, typeSort: { ...(u.typeSort ?? {}), [key]: s } }))}
        onOpen={openNote}
        onTag={openTag}
        onSettings={() => go({ id: 'type-settings/<type>', param: key })}
        onNew={() => actions.newObjectOfType?.(key)}
        onDefine={(v) => { returnFocus.current = document.activeElement as HTMLElement | null; pendingFocus.current = false; setDefineValue(v); setDialog('newType'); }}
      />
    );
  } else if (route?.id === 'type-settings/<type>' && route.param) {
    const key = route.param;
    body = (
      <TypeSettingsPage
        key={key}
        typeKey={key}
        types={types}
        refresh={refresh}
        heading={heading}
        onDeleted={() => { loadTypes(); void go({ id: 'type/<type>', param: 'page' }); }}
      />
    );
  } else if (route?.id === 'broken-links') {
    body = <BrokenLinksPage heading={heading} refresh={refresh} onOpen={(s, o) => openMention(s, o)} />;
  } else if (route?.id === 'duplicate-titles') {
    body = <DuplicateTitlesPage heading={heading} refresh={refresh} types={types} onOpen={(p) => openNote(p)} />;
  } else if (route?.id === 'conflicts') {
    body = <ConflictsPage heading={heading} onCount={setConflicts} />;
  } else if (route?.id === 'search') {
    body = <SearchPage key={route.param ?? ''} refresh={refresh} heading={heading} inputRef={searchInput} onOpen={openNote} tag={route.param?.startsWith('tag:') ? route.param.slice(4) : undefined} />;
  } else if (route?.id.startsWith('settings/') && def) {
    body = <SettingsPage id={route.id} theme={ui.theme as ThemeChoice} heading={heading} onSection={(id) => go({ id })} onTheme={actions.setTheme} />;
  } else if (def) {
    body = (
      <div className="page-column">
        <h1 ref={heading} tabIndex={-1}>{t(def.name)}</h1>
        <Placeholder def={def} />
      </div>
    );
  }

  const tabIcon = route?.id === 'note/<path>' ? typeIconName(meta?.type ?? 'page', types.find((x) => x.key === meta?.type)?.icon) : route?.id === 'type/<type>' ? typeIconName(route.param ?? '', typeEntry?.icon) : routeIcon(route?.id ?? '');
  const named = userNamed ? <span data-user-content>{pageName}</span> : pageName;

  return (
    <div className={`app ${focusMode ? 'focus-mode' : ''}`}>
      {!focusMode && <TitleBar switcher={{ vault, onOpenPath: openVaultPath, onOpenFolder: actions.openFolder, onCreate: () => actions.openChooser(true), onSettings: () => go({ id: 'settings/vault' }) }} name={named} icon={tabIcon} progress={progress} onToggleSidebar={actions.toggleSidebar} canBack={history.current.canBack()} canForward={history.current.canForward()} onBack={actions.back} onForward={actions.forward} />}
      <div className="frame">
        {showSidebar && (
          <Sidebar
            route={route ?? { id: 'home' }}
            types={typeEntries(types, counts)}
            onGo={go}
            onSwitcher={actions.openSwitcher}
            onNewObject={actions.newObject}
            onNewType={() => actions.newType?.()}
            onAbout={actions.about}
            conflicts={conflicts}
          />
        )}
        <div className="centre">
          {vault.placeholders > 0 && (
            <div className="banner" role="region" aria-label={t('banner.offline')}>
              {t('banner.placeholders', { count: vault.placeholders })}
            </div>
          )}
          {message && (
            <div className="banner" role="status">
              <span>{message}</span>
              <button tabIndex={0} type="button" data-command="banner.dismiss" onClick={() => setMessage(null)}>{t('banner.dismiss')}</button>
            </div>
          )}
          <main aria-label={route?.id === 'note/<path>' && !noteShown ? undefined : pageName} className={route?.id === 'note/<path>' ? 'note-main' : ''}>
            {body}
          </main>
        </div>
        {showPanel && <ContextPanel tab={ui.rightPanel.tab} onTab={(tab: PanelTab) => updateUi((u) => ({ ...u, rightPanel: { ...u.rightPanel, tab } }))}
          backlinks={route?.param ? { path: route.param, types, refresh, onOpen: (s, o) => openMention(s, o), focusFirst: focusBacklinks } : undefined} />}
        {offer && (
          <CreateLinkOffer req={offer} types={types} onClose={() => setOffer(null)}
            onCreated={(p) => openNote(p)}
            onExists={(p, title) => { setMessage(t('createLink.exists', { title })); openNote(p); }} />
        )}
      </div>
      {dialog === 'palette' && <Palette list={available_commands} onRun={(c) => { closeDialog(); run(c); }} onClose={closeDialog} />}
      {quitAsk && (
        <div className="dialog-backdrop">
          <div role="dialog" aria-modal="true" aria-label={t(quitAsk === 'keepBoth' ? 'quit.keepBoth' : 'quit.title')} className="dialog"
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setQuitAsk(null); } }}>
            <h2>{t(quitAsk === 'keepBoth' ? 'quit.keepBoth' : 'quit.title')}</h2>
            <p>{t(quitAsk === 'keepBoth' ? 'quit.keepBothBody' : 'quit.body')}</p>
            <div className="dialog-buttons">
              <button type="button" autoFocus onClick={() => setQuitAsk(null)}>{t('quit.cancel')}</button>
              <button type="button" onClick={async () => {
                const keep = quitAsk === 'keepBoth';
                setQuitAsk(null);
                if (keep) await noteApi.current?.keepBoth().catch(() => {});
                void ipc.appQuit().catch(() => {});
              }}>{t(quitAsk === 'keepBoth' ? 'quit.keepBothOk' : 'quit.anyway')}</button>
            </div>
          </div>
        </div>
      )}
      {dialog === 'switcher' && <Switcher onOpen={openNote} onCreate={createFrom} onClose={closeDialog} />}
      {dialog === 'newObject' && <NewObjectDialog key={newOfType ?? ''} types={types} typeKey={newOfType ?? undefined} onCreate={(k, title, p) => void createOf(k, title, p)} onClose={closeDialog} />}
      {dialog === 'newType' && (
        <NewTypeDialog key={defineValue ?? ''} fromValue={defineValue ?? undefined} types={types} undefinedKeys={Object.keys(counts).filter((k) => !types.some((x) => x.key === k))} onClose={closeDialog}
          onCreated={(created) => { setDialog(null); loadTypes(); void go({ id: 'type-settings/<type>', param: created.key.normalize('NFC') }); }} />
      )}
      {dialog === 'starter' && <StarterTypesDialog onClose={closeDialog} onAdded={() => { closeDialog(); loadTypes(); }} />}
    </div>
  );
}
