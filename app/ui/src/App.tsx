// The MS3 slice 3A shell (architecture §12, docs/contracts/ms3-shell.md): the frame with every designed page,
// TBD placeholders for later phases (D-116), the command palette and shortcuts (FR-UX-03), themes (FR-UX-05),
// the vault chooser (FR-VLT-01) and the launch landing (D-132). The note route is the slice 3B read view (D-117).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { t } from './i18n/catalog';
import { events, ipc } from './ipc/client';
import type { ProgressDto, SwitcherItemDto, TypeDefDto, UiStateDto, VaultInfo } from './ipc/types';
import { renderNewNote } from './newNote';
import { Chooser } from './pages/Chooser';
import { NotePage, type NoteMeta } from './pages/NotePage';
import { SearchPage } from './pages/SearchPage';
import { SettingsPage } from './pages/SettingsPage';
import { TypePage } from './pages/TypePage';
import { commands, type Command, type ShellActions, type ShellContext, type ThemeChoice } from './shell/commands';
import { ContextPanel, Sidebar, TitleBar } from './shell/Frame';
import { routeIcon, typeIconName } from './shell/Icon';
import { eventKeys } from './shell/keys';
import { NewObjectDialog } from './shell/NewObjectDialog';
import { Palette } from './shell/Palette';
import { Placeholder } from './shell/Placeholder';
import { ROUTES, SHORTCUTS, routeDef } from './shell/registry';
import { parseRoute, routeString, type Route } from './shell/routes';
import { typeEntries } from './shell/types';
import { Switcher } from './Switcher';
import { applyTheme } from './theme/apply';

const SIDEBAR_W = 232;
const PANEL_W = 288;
const MIN_CENTRE = 400; // D-136

type Dialog = 'palette' | 'switcher' | 'newObject' | null;
type PanelTab = 'backlinks' | 'outline' | 'graph';

const DEFAULT_UI: UiStateDto = { version: 1, theme: 'system', sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' }, propertiesOpen: true };

function initialUi(): UiStateDto {
  const w = window as { __TEGG_UI_STATE__?: UiStateDto | null };
  return w.__TEGG_UI_STATE__ ? { ...DEFAULT_UI, ...w.__TEGG_UI_STATE__ } : DEFAULT_UI;
}

export function App() {
  const [vault, setVault] = useState<VaultInfo | null | undefined>(undefined);
  const [types, setTypes] = useState<TypeDefDto[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [route, setRoute] = useState<Route | null>(null);
  const [chooser, setChooser] = useState<{ form: boolean } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [ui, setUi] = useState<UiStateDto>(initialUi);
  const [focusMode, setFocusMode] = useState(false);
  const [width, setWidth] = useState(window.innerWidth);
  const [progress, setProgress] = useState<ProgressDto | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [meta, setMeta] = useState<NoteMeta | null>(null);
  const [sourceToggle, setSourceToggle] = useState(0);
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
    ipc.uiStateGet().then((s) => { uiLoaded.current = true; setUi({ ...DEFAULT_UI, ...s }); }, () => { uiLoaded.current = true; });
  }, []);
  const updateUi = useCallback((f: (u: UiStateDto) => UiStateDto) => {
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
  const loadTypes = useCallback(() => {
    ipc.vaultTypes().then(setTypes, () => setTypes([]));
    ipc.typeCounts().then(setCounts, () => setCounts({}));
  }, []);

  const land = useCallback(async () => {
    const forced = (window as { __TEGG_ROUTE__?: string | null }).__TEGG_ROUTE__;
    const r = forced ? parseRoute(forced) : null;
    if (r) { setRoute(r); return; }
    const last = await ipc.vaultLast().catch(() => null);
    setRoute(last ? { id: 'note/<path>', param: last.path } : { id: 'home' });
  }, []);

  const opened = useCallback((v: VaultInfo) => {
    setVault(v);
    setChooser(null);
    setRoute(null);
    loadTypes();
    pendingFocus.current = true;
    void land();
  }, [land, loadTypes]);

  useEffect(() => {
    ipc.vaultCurrent().then((v) => (v ? opened(v) : setVault(null)), () => setVault(null));
    const un = [
      events.progress(setProgress),
      events.changed(() => { setRefresh((n) => n + 1); }),
      events.conflict((c) => setMessage(t('banner.conflict', { path: c.path }))),
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
  const go = useCallback((r: Route) => {
    setChooser(null);
    setDialog(null);
    setFocusMode(false);
    pendingReturn.current = null; // navigation moves the focus to the new page, not back (D-130)
    pendingFocus.current = true;
    setRoute(r);
  }, []);
  // A focus the user makes before the new page is ready wins over the pending heading focus.
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      if (pendingFocus.current && e.target !== heading.current && e.target !== document.body) pendingFocus.current = false;
    };
    window.addEventListener('focusin', onFocus);
    return () => window.removeEventListener('focusin', onFocus);
  }, []);
  const openNote = useCallback((path: string, fragment?: string) => go({ id: 'note/<path>', param: path.normalize('NFC'), ...(fragment ? { fragment } : {}) }), [go]);
  const openTag = useCallback((key: string) => go({ id: 'search', param: `tag:${key}` }), [go]);

  const routeKey = route ? routeString(route) : '';
  useEffect(() => {
    setMeta(null);
    if (route?.id === 'note/<path>' && route.param) void ipc.navOpened(route.param).catch(() => {});
  }, [routeKey]);

  const createFrom = useCallback((item: SwitcherItemDto) => {
    setDialog(null);
    const title = item.title.normalize('NFC');
    ipc.noteCreate(item.folder, title, renderNewNote(item.type, title)).then(openNote, () => setMessage(t('error.io')));
  }, [openNote]);

  // ------------------------------------------------------------------ layout
  const isObject = route?.id === 'note/<path>';
  const available = width - (ui.sidebarOpen ? SIDEBAR_W : 0);
  const panelFits = available - PANEL_W >= MIN_CENTRE;
  const showSidebar = ui.sidebarOpen && !focusMode;
  const showPanel = isObject && ui.rightPanel.open && panelFits && !focusMode;

  const actions: ShellActions = useMemo(() => ({
    go,
    openPalette: () => setDialog('palette'),
    openSwitcher: () => { returnFocus.current = document.activeElement as HTMLElement | null; pendingFocus.current = false; setDialog('switcher'); },
    newObject: () => { returnFocus.current = document.activeElement as HTMLElement | null; pendingFocus.current = false; setDialog('newObject'); },
    toggleSidebar: () => updateUi((u) => ({ ...u, sidebarOpen: !u.sidebarOpen })),
    toggleRightPanel: () => { if (route?.id === 'note/<path>') updateUi((u) => ({ ...u, rightPanel: { ...u.rightPanel, open: !u.rightPanel.open } })); },
    toggleFocus: () => {
      if (route?.id !== 'note/<path>') return;
      setFocusMode((f) => !f);
      requestAnimationFrame(() => heading.current?.focus());
    },
    toggleSource: () => { if (route?.id === 'note/<path>') setSourceToggle((n) => n + 1); },
    toggleProperties: () => { if (route?.id === 'note/<path>') updateUi((u) => ({ ...u, propertiesOpen: !u.propertiesOpen })); },
    openChooser: (form: boolean) => { setDialog(null); setChooser({ form }); },
    setTheme: (c: ThemeChoice) => updateUi((u) => ({ ...u, theme: c })),
  }), [go, route?.id, updateUi]);

  const ctx: ShellContext = { vault: vault ?? null, types, counts, actions };
  const list = useMemo(() => commands(ctx), [types, counts, vault, actions]);
  const chooserShown = vault === null || chooser !== null;
  const available_commands = useMemo(() => (chooserShown ? list.filter((c) => !c.needsVault) : list), [list, chooserShown]);

  const run = useCallback((c: Command) => {
    if (c.due) return;
    void c.run(ctx);
  }, [ctx]);

  // Test hook (ms3-shell §10): registered command ids and route ids.
  useEffect(() => {
    (window as { __TEGG_TEST__?: unknown }).__TEGG_TEST__ = { commands: () => list.map((c) => c.id), routes: () => ROUTES.map((r) => r.id) };
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
      if (pendingFocus.current && !live.current.dialog) { pendingFocus.current = false; h!.focus({ preventScroll: true }); }
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
        key={route.param}
        path={route.param}
        fragment={route.fragment}
        types={types}
        heading={heading}
        onMeta={setMeta}
        onType={(k) => go({ id: 'type/<type>', param: k })}
        onOpen={openNote}
        onTag={openTag}
        onRenamed={(p) => setRoute({ id: 'note/<path>', param: p.normalize('NFC') })}
        toggleSource={sourceToggle}
        focusMode={focusMode}
        onTogglePanel={actions.toggleRightPanel}
        onFocus={actions.toggleFocus}
        propertiesOpen={ui.propertiesOpen}
        onToggleProperties={actions.toggleProperties}
      />
    );
  } else if (route?.id === 'type/<type>' && route.param) {
    body = (
      <TypePage
        key={route.param}
        typeKey={route.param}
        plural={pageName}
        name={typeEntry?.name ?? route.param}
        refresh={refresh}
        heading={heading}
        onOpen={openNote}
        onSettings={() => go({ id: 'type-settings/<type>', param: route.param })}
      />
    );
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

  const tabIcon = route?.id === 'note/<path>' ? typeIconName(meta?.type ?? 'page') : route?.id === 'type/<type>' ? typeIconName(route.param ?? '') : routeIcon(route?.id ?? '');
  const named = userNamed ? <span data-user-content>{pageName}</span> : pageName;

  return (
    <div className={`app ${focusMode ? 'focus-mode' : ''}`}>
      {!focusMode && <TitleBar name={named} icon={tabIcon} progress={progress} onToggleSidebar={actions.toggleSidebar} />}
      <div className="frame">
        {showSidebar && (
          <Sidebar
            route={route ?? { id: 'home' }}
            types={typeEntries(types, counts)}
            onGo={go}
            onSwitcher={actions.openSwitcher}
            onNewObject={actions.newObject}
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
          <main aria-label={pageName} className={route?.id === 'note/<path>' ? 'note-main' : ''}>
            {body}
          </main>
        </div>
        {showPanel && <ContextPanel tab={ui.rightPanel.tab} onTab={(tab: PanelTab) => updateUi((u) => ({ ...u, rightPanel: { ...u.rightPanel, tab } }))} />}
      </div>
      {dialog === 'palette' && <Palette list={available_commands} onRun={(c) => { closeDialog(); run(c); }} onClose={closeDialog} />}
      {dialog === 'switcher' && <Switcher onOpen={openNote} onCreate={createFrom} onClose={closeDialog} />}
      {dialog === 'newObject' && <NewObjectDialog types={types} onCreate={createFrom} onClose={closeDialog} />}
    </div>
  );
}
