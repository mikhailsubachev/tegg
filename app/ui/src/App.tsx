// The MS3 slice 3A shell (architecture §12, docs/contracts/ms3-shell.md): the frame with every designed page,
// TBD placeholders for later phases (D-116), the command palette and shortcuts (FR-UX-03), themes (FR-UX-05),
// the vault chooser (FR-VLT-01) and the launch landing (D-132). The note route is the slice 3B read view (D-117).
import { ShortcutsPage } from './pages/ShortcutsPage';
import { resetMindmapViews } from './mindmap/mount';
import { registerConvertPrefs } from './convert/prefs';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { t } from './i18n/catalog';
import { events, ipc } from './ipc/client';
import type { ProgressDto, SwitcherItemDto, TypeDefDto, UiStateDto, VaultInfo } from './ipc/types';
import { Chooser } from './pages/Chooser';
import { ConflictsPage } from './pages/ConflictsPage';
import { NotePage, type DraftInfo, type NoteMeta, type NotePageApi } from './pages/NotePage';
import { pageWidthOf, type PageWidth } from './edit/WidthSwitch';
import { SearchPage } from './pages/SearchPage';
import { SettingsPage } from './pages/SettingsPage';
import { TypePage, type TypeSort } from './pages/TypePage';
import { TypeSettingsPage } from './pages/TypeSettingsPage';
import { createObject, prepareObject, type Prepared } from './types/create';
import { NewTypeDialog } from './types/NewTypeDialog';
import { StarterTypesDialog } from './types/StarterTypesDialog';
import { commands, type Command, type GraphCommandId, type GraphStatus, type ShellActions, type ShellContext, type ThemeChoice } from './shell/commands';
import { ContextPanel, Sidebar, TitleBar } from './shell/Frame';
import { routeIcon, typeIconName } from './shell/Icon';
import { eventKeys } from './shell/keys';
import { createHistory } from './shell/history';
import { installNavSwipe } from './shell/navSwipe';
import { Palette } from './shell/Palette';
import { Placeholder } from './shell/Placeholder';
import { ROUTES, SHORTCUTS, routeDef } from './shell/registry';
import { parseRoute, routeString, type Route, sameRoute } from './shell/routes';
import { createdMarker, settleCreated } from './shell/created';
import { typeEntries } from './shell/types';
import { applyTheme } from './theme/apply';
import { BrokenLinksPage } from './links/BrokenLinksPage';
import { CreateLinkOffer } from './links/CreateLinkOffer';
import { DuplicateTitlesPage } from './links/DuplicateTitlesPage';
import { setChipTypes } from './links/icons';
import { setOfferHandler, type OfferRequest } from './links/offer';
import type { OccurrenceDto } from './ipc/types';
import { localDate } from './zone';
import { localIso } from './newNote';
import { parse as parseDoc } from '@tegg/doc';
import { Calendar } from './daily/Calendar';
import { DailyPage } from './daily/DailyPage';
import type { DailyInfo } from './daily/DailyHeader';
import { setDateHandler } from './daily/open';
import { resetJobs, setMoveTypes, showList, startJobs, undoLast, undoLastMove } from './jobs/jobs';
import { startBridge } from './jobs/bridge';
import { NotUpdatedList } from './jobs/notUpdated';
import { DEFAULT_TASKS_UI, TasksPage, type TasksUi } from './tasks/TasksPage';
import { AllTasks } from './tasks/AllTasks';
import type { TasksView } from './tasks/TasksHeader';
import { useTaskBadge } from './tasks/useTasks';
import { InboxPage } from './inbox/InboxPage';
import { TrashPage } from './trash/TrashPage';
import { TrashMessages } from './trash/toast';
import { moveToTrash, trashRequest } from './trash/moveToTrash';
import { TypeMenu } from './shell/TypeMenu';
import { NewObjectPicker } from './shell/NewObjectPicker';
import { setDateTimeSetting } from './i18n/dates';
import { HotkeyNotice } from './pages/HotkeyNotice';
import { useInboxCount } from './inbox/useInboxCount';
import { setSourceHandler } from './tasks/sourceNav';
import type { InterruptedDto } from './ipc/types';
import { TagPage } from './tags/TagPage';
import { AllTagsPage } from './tags/AllTagsPage';
import { tagOfFile, useTags, loadTags, refreshTags } from './tags/store';
import { findPin, editReason } from './pinned/model';
import { ImportDialog } from './import/ImportDialog';
import { ImportStatus } from './import/ImportStatus';
import { importOpen, importRunning, openImport as openImportWindow, quitRequested as importQuitRequested, setImportHost, startImportEvents } from './import/store';
import { pinsForVault, pinsNow, pinTarget, unpin, usePins } from './pinned/store';
import { focusedPinnedRow, moveFocusedPinned } from './pinned/PinnedSection';
import type { PinRequestDto } from './ipc/pins';
import { tagKey } from './tags/keys';
import type { TagPageUi, TagsSort } from './tags/model';
import { PreviewProvider } from './preview/PreviewProvider';
import { GraphPage } from './graph/GraphPage';
import type { GraphPanelCommands, GraphPanelProps } from './graph/GraphPanel';
import type { GraphHandover } from './shell/history';
import type { GraphViewStateDto } from './graph/types';
import { close as closePreview, getPrefs as getPreviewPrefs, setPreviewHost, setStoredPrefs, showPreviewAction, updatePrefs } from './preview/store';
import type { PreviewTarget, PreviewUiDto } from './preview/types';
import { editorLinkAction } from './preview/editorLink';
import { setAttribute as setFmAttribute } from '@tegg/doc';
import { QueriesPage } from './queries/QueriesPage';
import { QueryPage, type QueryPageCommand } from './queries/QueryPage';
import { QueryDialogs } from './queries/QueryDialogs';
import { QueryEditorHost } from './queries/QueryEditor';
import { QueryPicker } from './queries/QueryPicker';
import { QueryNotices } from './queries/QueryNotices';
import { queriesForVault, useQueries, type QueriesSort } from './queries/store';
import { setPendingEdit, setQueryNav } from './queries/nav';
import { openNameDialog } from './queries/dialogs';
import { selectedQueryBlock } from './queries/selection';
import { forgetPreviewCaches } from './preview/load';
import { OutlineEdge } from './outline/OutlineEdge';
import { announce, closeCard, getCard, getOutline, openCard, requestFocus } from './outline/store';
import { syncTracker } from './outline/tracker';
import { setJumpHost } from './outline/jump';
import { installMultiClickGuard, routeChanged } from './shell/multiClick';

const DAILY = 'daily/YYYY-MM-DD';
/** The webview history mirror of the app's in-memory history (see the `popstate` effect in App). */
const browserNav = (() => {
  let idx = 0;
  let skip = 0;
  const h = typeof window !== 'undefined' ? window.history : null;
  try { h?.replaceState({ teggNav: 0 }, ''); } catch { /* no history */ }
  return {
    push() { idx++; try { h?.pushState({ teggNav: idx }, ''); } catch { /* no history */ } },
    move(dir: 'back' | 'forward') {
      if (!h) return;
      skip++;
      idx += dir === 'back' ? -1 : 1;
      if (dir === 'back') h.back(); else h.forward();
    },
    pop(e: PopStateEvent): 'back' | 'forward' | null {
      const i = (e.state as { teggNav?: number } | null)?.teggNav;
      if (skip > 0) { skip--; if (typeof i === 'number') idx = i; return null; }
      if (typeof i !== 'number' || i === idx) return null;
      const d = i < idx ? 'back' : 'forward';
      idx = i;
      return d;
    },
  };
})();
/** D-321: `today` is a redirect to the daily route of the local date. */
const todayRoute = (): Route => ({ id: DAILY, param: localDate(Date.now()) });
/** A route that shows a note page: a note, a Daily Note or an unsaved new object (D-520). */
const isNoteRoute = (r: Route | null | undefined) => r?.id === 'note/<path>' || r?.id === DAILY || r?.id === 'new/<type>';
/** The route of a Tasks view (D-516). */
const tasksRoute = (v: TasksView): Route => (v === 'kanban' ? { id: 'tasks/kanban' } : v === 'all' ? { id: 'type/<type>', param: 'task' } : { id: 'tasks' });

const SIDEBAR_W = 232;
const PANEL_W = 288;
/** D-634: the range the user can drag the panel to. */
const PANEL_MIN = 240;
const PANEL_MAX = 480;
const MIN_CENTRE = 400; // D-136
const QUICK_ADD = 'main [data-quick-add] input';
/** The task views' search: Schedule and Kanban (D-1280), or All tasks' type-page filter. */
const TASK_SEARCH = 'main [data-command="tasks.search"], main input.type-filter';

type Dialog = 'palette' | 'newType' | 'starter' | 'newObject' | null;
type PanelTab = 'backlinks' | 'graph';

/** 3D (ms3-shell §14.7.1): `typeSort` and `otherPropertiesOpen`; missing fields read as defaults, `version` stays 1. */
type UiState = UiStateDto & { typeSort?: Record<string, TypeSort>; otherPropertiesOpen?: boolean; noteWidth?: Record<string, PageWidth>; preview?: PreviewUiDto;
  /** Slice OL (v1-outline §5, D-1601): `Show outline rail`; missing reads as true. */
  outlineRail?: boolean;
  /** Slice G1 (v1-graph §5, D-993): per-vault state, keyed by the vault's absolute path (NFC); G2 adds `graph.panel`. */
  vaults?: Record<string, { graph?: { full?: GraphViewStateDto; panel?: GraphViewStateDto } & Record<string, unknown> } & Record<string, unknown>> };
const DEFAULT_UI: UiState = { version: 1, theme: 'system', sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' }, propertiesOpen: true, typeSort: {}, otherPropertiesOpen: false };

function initialUi(): UiState {
  const w = window as { __TEGG_UI_STATE__?: UiState | null };
  return w.__TEGG_UI_STATE__ ? { ...DEFAULT_UI, ...w.__TEGG_UI_STATE__ } : DEFAULT_UI;
}

/** The Import window is mounted once, at the same place of every tree App returns (the chooser, the frame), so a vault
 *  switch or the chooser never remounts it (v1-import-window §3.1). */
function withImport(node: React.ReactNode) {
  return <>{node}<ImportDialog /></>;
}

export function App() {
  const [vault, setVault] = useState<VaultInfo | null | undefined>(undefined);
  const [types, setTypes] = useState<TypeDefDto[]>([]);
  const typesRef = useRef(types);
  typesRef.current = types;
  // 4E-1: the move status texts name types by their folder (R99 B2).
  useEffect(() => { setMoveTypes(types.map((x) => ({ key: x.key, name: x.name, plural: x.plural, folder: x.folder }))); }, [types]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [route, setRoute] = useState<Route | null>(null);
  const [chooser, setChooser] = useState<{ form: boolean } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const returnRange = useRef<Range | null>(null);
  const pendingRange = useRef<Range | null>(null);
  const [newPicker, setNewPicker] = useState<{ types: TypeDefDto[]; defaultKey: string | null | undefined; at: { left: number; top: number } | null } | null>(null);
  const [defineValue, setDefineValue] = useState<string | null>(null); // D-251: New type for an undefined value
  const [ui, setUi] = useState<UiState>(initialUi);
  /** D-520 (ms5-tasks §12.2): the unsaved new object shown on `new/<type>` (`route`: its route string). */
  const [draft, setDraft] = useState<{ route: string; path: string; info: DraftInfo } | null>(null);
  /** FR-VLT-05 AC-4: the `Type` menu of an unwritten draft, and the title it carries to the new type. */
  const [draftType, setDraftType] = useState<{ at: { left: number; top: number } } | null>(null);
  const carryTitle = useRef<string | null>(null);
  const tagCommand = useRef<((id: string) => void) | null>(null);
  const newTagCommand = useRef<(() => void) | null>(null);
  const mergeCommand = useRef<(() => void) | null>(null);
  const pendingNewTag = useRef(false);
  /** Where the focus goes when a task view is shown: the quick-add row (New Task, D-520) or the search (D-1284). */
  const focusOnLand = useRef<string | null>(null);
  /** The last of Schedule and Kanban shown (New Task goes there, D-520); `null` falls back to the stored view. */
  const lastBoard = useRef<'tasks' | 'tasks/kanban' | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [width, setWidth] = useState(window.innerWidth);
  const [progress, setProgress] = useState<ProgressDto | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [interrupted, setInterrupted] = useState<InterruptedDto[]>([]);
  // 4A: the Create offer of a broken link (FR-LNK-04 AC-4) and `Show backlinks` (R16).
  const [offer, setOffer] = useState<OfferRequest | null>(null);
  const [focusBacklinks, setFocusBacklinks] = useState(0);
  /** Slice G2 (FR-NAV-05 AC-2): `Show local graph` puts the focus on `Depth and filters`. */
  const [focusGraph, setFocusGraph] = useState(0);
  /** Slice G2 (v1-graph §15.5): the shown history entry's hand-over from the panel to the full view. */
  const [handover, setHandover] = useState<GraphHandover | null>(null);
  /** Slice G2: the shown panel graph's commands (`Graph: Depth n`, ⌘⇧G); whether the panel shows the Graph tab. */
  const panelGraph = useRef<GraphPanelCommands | null>(null);
  const panelShowsGraph = useRef(false);
  /** "G3 in the panel" (D-1145): the panel's day file isn't known yet (R115 pending), for AP-972's reasons. */
  const panelPending = useRef(false);
  useEffect(() => { setOfferHandler((r) => setOffer(r)); return () => setOfferHandler(null); }, []);
  useEffect(() => { setChipTypes(types); }, [types]);
  const [refresh, setRefresh] = useState(0);
  /** Slice G2 (v1-graph §15.7): the note page's own saves, which the watcher doesn't report; the panel graph re-asks.
   *  A subscription, not state: an autosave doesn't re-render the App. */
  const ownSaveListeners = useRef(new Set<() => void>());
  const onOwnSave = useCallback((f: () => void) => { ownSaveListeners.current.add(f); return () => { ownSaveListeners.current.delete(f); }; }, []);
  // Slice PW (AP-754, AP-759): the vault's default page width, read again after every vault change (live).
  const [vaultWidth, setVaultWidth] = useState<PageWidth>('normal');
  // 4B: the calendar popover (R18) and the daily info of a note route showing a Daily Note that doesn't win (D-319).
  const [calendar, setCalendar] = useState<{ selected: string; anchor: HTMLElement | null; onChoose: (d: string) => void } | null>(null);
  const [noteDaily, setNoteDaily] = useState<{ path: string; date: string; duplicates: string[] } | null>(null);
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
  /** The note editor's caret on the page being left (Back returns with it). */
  const centreCaret = () => noteApi.current?.caret?.() ?? null;
  const pendingCaret = useRef<{ anchor: number; head: number } | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const searchInput = useRef<HTMLInputElement | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const pendingFocus = useRef(false);
  /** "G3 in the panel" (FR-UX-03 AC-33): an object opened by key from the panel graph focuses the page heading (D-130). */
  const headingFocus = useRef(false);
  const pendingReturn = useRef<HTMLElement | null>(null);
  const uiLoaded = useRef(false);
  // 5A-1: the Tasks page's command handler (R45) and the last task view (D-481).
  const taskCommand = useRef<((id: string) => void) | null>(null);
  const taskCommandState = useRef<((id: string) => string | null) | null>(null);
  const inboxCommand = useRef<((id: string) => void) | null>(null);
  const trashCommand = useRef<((id: 'restore' | 'delete') => void) | null>(null);
  /** Slice Q (v1-queries §4.6): the query page's commands and status. */
  const queryCommand = useRef<((id: QueryPageCommand) => void) | null>(null);
  const queryStatus = useRef<(() => { name: string; editable: boolean; title: string } | null) | null>(null);
  /** Slice Q (D-1490): the pre-filled values of the next `new/<type>` draft (a query block's footer). */
  const pendingPrefill = useRef<{ type: string; values: [string, unknown][] } | null>(null);
  const uiRef = useRef<UiState | null>(null);

  // ------------------------------------------------------------------ theme and machine-local UI state (D-128)
  uiRef.current = ui;
  useLayoutEffect(() => applyTheme(ui.theme as ThemeChoice), [ui.theme]);
  useEffect(() => {
    if ((window as { __TEGG_UI_STATE__?: unknown }).__TEGG_UI_STATE__) {
      uiLoaded.current = true;
      return;
    }
    ipc.uiStateGet().then((s) => { uiLoaded.current = true; setUi({ ...DEFAULT_UI, ...(s as UiState) }); }, () => { uiLoaded.current = true; });
  }, []);
  // The write happens once per committed state (an effect), not inside the updater: React's StrictMode runs updaters
  // twice in development and test builds, which sent every `ui_state_set` twice (page-width.md FR-STO-07 AC-4).
  const uiDirty = useRef(false);
  const updateUi = useCallback((f: (u: UiState) => UiState) => {
    uiDirty.current = true;
    setUi(f);
  }, []);
  useEffect(() => {
    if (!uiDirty.current) return;
    uiDirty.current = false;
    void ipc.uiStateSet(ui).catch(() => {});
  }, [ui]);
  // 5A-2 (ms5-tasks §11.4): the conversion's preferences live in the same machine-local state.
  // Slice P (v1-previews §1, D-922, D-923): the Object preview setting and the popover size live in the same state.
  useEffect(() => { setStoredPrefs(ui.preview); }, [ui.preview]);
  useEffect(() => registerConvertPrefs({ get: () => uiRef.current?.convert ?? undefined, set: (c) => updateUi((u) => ({ ...u, convert: c })) }), [updateUi]);

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
    const forced = landingOverride.current ?? (window as { __TEGG_ROUTE__?: string | null }).__TEGG_ROUTE__;
    landingOverride.current = null;
    const r = forced ? parseRoute(forced) : null;
    const landing: Route = r ?? await ipc.vaultLast().then((last) => (last ? (parseRoute(last.path)?.id === DAILY ? parseRoute(last.path)! : { id: 'note/<path>', param: last.path }) : { id: 'inbox' }), () => ({ id: 'inbox' }));
    history.current.clear(); // D-171: the history starts with the landing route
    history.current.push(landing);
    setHistTick((n) => n + 1);
    setNavKey((n) => n + 1);
    setRoute(landing);
  }, []);

  const liveVault = useRef<VaultInfo | null>(null);
  liveVault.current = vault ?? null;
  const opened = useCallback((v: VaultInfo) => {
    resetJobs(); // D-385, D-398: undo and the list don't outlive the vault
    resetMindmapViews(); // D-776: another vault opens every mindmap in Map
    forgetPreviewCaches(); // slice P: another vault's duplicate details
    setInterrupted(v.interrupted ?? []); // D-387: renames a crash interrupted, from the vault info (no extra call)
    setVault(v);
    setVaultWidth(pageWidthOf(v.pageWidth));
    setChooser(null);
    setRoute(null);
    history.current.clear(); // another vault: a new history (AC-7)
    pendingFocus.current = true;
    headingFocus.current = false;
    // The landing page shows with the sidebar's types and counts (3D: the panel needs the type definitions).
    void loadTypes().finally(() => void land());
  }, [land, loadTypes]);

  /** D-219: open another vault from the title-bar switcher or ⌃⌘n, as the chooser does (FR-VLT-01 AC-15); an error
   *  (not a Tegg vault, gone) shows the chooser, which explains it. */
  const openVaultPath = useCallback((path: string) => {
    setDialog(null);
    void flushNote().then(() => ipc.vaultOpen(path)).then(opened, () => setChooser({ form: false }));
  }, [opened]);

  // 4C (ms4-jobs §2.2, §10): job progress and the worker bridge for the whole session.
  useEffect(() => { startJobs(); return startBridge(); }, []);
  // Slice I2 (v1-import-window §3.1, §3.11): the Import window's events from app mount, with or without a vault; how it
  // opens a vault (the switcher's way) and its report Page.
  const landingOverride = useRef<string | null>(null);
  useEffect(() => { startImportEvents(); }, []);
  useEffect(() => {
    setImportHost({
      openVault: async (path, report) => {
        await flushNote();
        const v = await ipc.vaultOpen(path);
        landingOverride.current = report ? `note/${report}` : null;
        opened(v);
      },
      vaultPath: () => liveVault.current?.path ?? null,
      goNote: (path) => { void goRef.current?.({ id: 'note/<path>', param: path.normalize('NFC') }); },
      quit: () => { void quitFlow.current(); },
    });
    return () => setImportHost(null);
  }, [opened]);
  // Slice I2 (QA): an import writes the vault in batches, each a `vault:changed`; every one re-read the whole frame (types,
  // counts, the page's lists), and on a large vault those reads queued behind each other. While a run is live the
  // frame re-reads at most every 500 ms (the first change at once, the last one always), well within NFR-PERF-08.
  const importBump = useRef<{ timer: ReturnType<typeof setTimeout> | null; pending: boolean }>({ timer: null, pending: false });
  const bumpDuringImport = useCallback(() => {
    const b = importBump.current;
    if (b.timer) { b.pending = true; return; }
    setRefresh((n) => n + 1);
    const tick = () => {
      if (!b.pending) { b.timer = null; return; }
      b.pending = false;
      setRefresh((n) => n + 1);
      b.timer = setTimeout(tick, 500);
    };
    b.timer = setTimeout(tick, 500);
  }, []);
  useEffect(() => {
    // A result after the cleanup is dropped: StrictMode runs this effect twice, and two `opened` calls would load the
    // landing page twice (NFR-PERF-05 AC-3: one link_resolve, one note_read).
    let live = true;
    ipc.vaultCurrent().then((v) => { if (live) (v ? opened(v) : setVault(null)); }, () => { if (live) setVault(null); });
    const un = [
      // The end of indexing changes what every page reads (a page opened while it ran saw part of the vault), but the
      // core sends no `vault:changed` for it: pages read again as after a change (bug v0.70, tag page; FR-UX-07).
      events.progress((p) => { setProgress(p); if (p.state === 'done') setRefresh((n) => n + 1); }),
      events.changed(() => { if (importRunning()) bumpDuringImport(); else setRefresh((n) => n + 1); }),
      // 5B (ms5-capture §1.4, §2.2): `Settings…` in the status menu and the Saved panel's `Open`.
      events.shellRoute((r) => { const parsed = parseRoute(r); if (parsed) void goRef.current?.(parsed); }),
    ];
    return () => { live = false; un.forEach((p) => p.then((f) => f())); };
  }, []);

  useEffect(() => {
    if (vault) loadTypes();
  }, [refresh]);
  // The default arrives with the vault (no extra read at open, FR-EDT-02 AC-13); a change of `.tegg/vault.yml` on disk
  // or from Settings › Vault reads `vault_settings` again (AP-759).
  useEffect(() => {
    let live = true;
    const un = events.changed((c) => {
      if (!c.paths.some((p) => p.normalize('NFC') === '.tegg/vault.yml')) return;
      ipc.vaultSettings().then((v) => { if (live) setVaultWidth(pageWidthOf(v.pageWidth)); }, () => {});
    });
    return () => { live = false; void un.then((f) => f()); };
  }, []);
  /** AP-753: one `ui_state_set` per effective change; AP-760: a stored value is never removed by a choice. */
  const setNoteWidth = useCallback((key: string, w: PageWidth, from: string | null = null) => {
    updateUi((u) => {
      const next = { ...(u.noteWidth ?? {}) };
      if (from && from !== key) delete next[from];
      next[key] = w;
      return { ...u, noteWidth: next };
    });
  }, [updateUi]);

  // `ui-ready` (ms2-shell §1, ms3-shell §1): the frame or the chooser has painted. WebKit pauses frames for a
  // hidden window, so a timer backs the frame callback up.
  useEffect(() => {
    if (vault === undefined) return;
    // Once (ms3-shell §1: a single `ui-ready` mark): the timer only backs up a frame that didn't come (a late second mark
    // looked like a request, FR-UX-03 AC-34). Regression test bug_qag3p_nfr_perf_01_ui_ready_once.
    let marked = false;
    const mark = () => { if (marked) return; marked = true; void ipc.perfMark('ui-ready').catch(() => {}); };
    requestAnimationFrame(() => setTimeout(mark, 0));
    const fallback = setTimeout(mark, 250);
    return () => clearTimeout(fallback);
  }, [vault === undefined]);

  // ------------------------------------------------------------------ navigation
  const go = useCallback(async (r0: Route, o: { keepDialog?: boolean; graph?: GraphHandover; heading?: boolean } = {}) => {
    const r = r0.id === 'today' ? todayRoute() : r0;
    await flushNote();
    setChooser(null);
    if (!o.keepDialog) setDialog(null);
    setFocusMode(false);
    pendingReturn.current = null; // navigation moves the focus to the new page, not back (D-130)
    pendingFocus.current = true;
    headingFocus.current = !!o.heading;
    // Issue 112 a: a Back/Forward step's scroll position and caret belong to the page that step returned to. A page
    // left before it had restored them keeps them in its entry, and the page opened now never takes them (a link
    // clicked right after Back opened at Back's scroll position, not at its `#Heading`).
    const unrestored = pendingScroll.current;
    const unrestoredCaret = pendingCaret.current;
    pendingScroll.current = null;
    pendingCaret.current = null;
    history.current.saveScroll(unrestored ?? centreScroll(), unrestored !== null ? unrestoredCaret : centreCaret());
    history.current.push(r, o.graph);
    browserNav.push();
    setHandover(o.graph ?? null);
    setHistTick((n) => n + 1);
    setNavKey((n) => n + 1);
    justCreated.current = settleCreated(justCreated.current, r); // D-367: a marker of a route not landed on goes
    setRoute(r);
  }, []);
  const goRef = useRef(go);
  goRef.current = go;
  const step = useCallback(async (dir: 'back' | 'forward', fromBrowser = false) => {
    if (dir === 'back' ? !history.current.canBack() : !history.current.canForward()) return;
    if (!fromBrowser) browserNav.move(dir);
    // Slice OL (v1-outline §4, D-1610, D-1637): a step to an entry of the same route (an outline jump's) happens in
    // place: no flush, no remount, no read; the selection (followed through edits) and the scroll are restored.
    const here = history.current.current();
    const to = history.current.peek(dir);
    if (here && to && routeString(here.route).normalize('NFC') === routeString(to.route).normalize('NFC') && noteApi.current) {
      history.current.saveScroll(centreScroll(), centreCaret());
      const e = dir === 'back' ? history.current.back() : history.current.forward();
      if (!e) return;
      setHistTick((n) => n + 1);
      noteApi.current.restorePlace(e.scrollTop, e.caret ?? null);
      return;
    }
    await flushNote();
    history.current.saveScroll(centreScroll(), centreCaret());
    const e = dir === 'back' ? history.current.back() : history.current.forward();
    if (!e) return;
    setChooser(null);
    setFocusMode(false);
    pendingReturn.current = null;
    pendingFocus.current = true;
    headingFocus.current = false;
    pendingScroll.current = e.scrollTop;
    pendingCaret.current = e.caret ?? null;
    setHistTick((n) => n + 1);
    setNavKey((n) => n + 1);
    justCreated.current = settleCreated(justCreated.current, e.route);
    setHandover(e.graph ?? null);
    setRoute(e.route);
  }, []);
  // The webview's own history follows the app's (one entry per navigation), so the browser's Back / Forward (and a test
  // driver's goBack) step the app's history instead of leaving the page (slice Q tests navigate so).
  useEffect(() => {
    const onPop = (e: PopStateEvent) => { const d = browserNav.pop(e); if (d) void step(d, true); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [step]);
  // Slice OL (v1-outline §3.4 step 6, §4): an outline jump's Back entry.
  useEffect(() => {
    setJumpHost({
      main: () => document.querySelector('main'),
      caret: () => noteApi.current?.caret?.() ?? null,
      pushPlace: (from, to) => { history.current.pushPlace(from, to); browserNav.push(); setHistTick((n) => n + 1); },
    });
    return () => setJumpHost(null);
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
  /** A create path that lands on today's Daily Note (D-318, D-353): the caret goes into its body (D-367). */
  const createToday = useCallback(() => { const r = todayRoute(); justCreated.current = createdMarker(r); void go(r); }, [go]);
  // 6A (R74, FR-HIS-01 AC-11): a link to a trashed object opens the Trash with its row focused.
  const openNote = useCallback((path: string, fragment?: string, keepDialog = false) => {
    if (path.startsWith('.trash/')) { void go({ id: 'trash', param: path.normalize('NFC') }, { keepDialog }); return; }
    void go({ id: 'note/<path>', param: path.normalize('NFC'), ...(fragment ? { fragment } : {}) }, { keepDialog });
  }, [go]);
  const openDay = useCallback((date: string) => { void go({ id: DAILY, param: date }); }, [go]);
  // Slice P (v1-previews §3): what the popover's `Open` and ⏎ open, and where a size or mode change is stored.
  useEffect(() => {
    setPreviewHost({
      open: (tg: PreviewTarget) => {
        if (tg.kind === 'day') { if (tg.key) openDay(tg.key); return; }
        if (tg.kind === 'tag') { if (tg.key) void go({ id: 'tag/<key>', param: tagKey(tg.key) }); return; }
        if (tg.scrollToEmbedOf) { void go({ id: 'note/<path>', param: tg.path.normalize('NFC'), selectEmbedOf: tg.scrollToEmbedOf.normalize('NFC') }); return; }
        openNote(tg.path, tg.fragment ?? undefined);
      },
      setPrefs: (p) => updateUi((u) => ({ ...u, preview: p })),
      external: (url) => { void ipc.openExternal(url).catch(() => {}); },
    });
    return () => setPreviewHost(null);
  }, [openNote, openDay, go, updateUi]);
  useEffect(() => { setDateHandler(openDay); return () => setDateHandler(null); }, [openDay]);
  // Slice Q: blocks (also inside editors and embeds) open notes, queries and pre-filled drafts through this.
  useEffect(() => {
    setQueryNav({
      openNote: (p) => openNote(p),
      openQuery: (name, o) => { if (o?.edit) setPendingEdit(name); void go({ id: 'query/<name>', param: name.normalize('NFC') }); },
      openNew: (type, values) => { pendingPrefill.current = { type, values }; void go({ id: 'new/<type>', param: type.normalize('NFC') }); },
      go: (r) => { void go(r); },
    });
    return () => setQueryNav(null);
  }, [openNote, go]);
  useEffect(() => {
    setSourceHandler((src, task) => { void go({ id: 'note/<path>', param: src.normalize('NFC'), selectEmbedOf: task.normalize('NFC') }); });
    return () => setSourceHandler(null);
  }, [go]);
  /** A note route that shows a Daily Note (D-321): the winner opens as its daily route; another note keeps its route
   *  and shows the notice naming the others (D-319). */
  const onNoteDaily = useCallback((path: string, date: string) => {
    void ipc.dailyView(date).then((v) => {
      if (v.path && v.path.normalize('NFC') === path.normalize('NFC')) {
        const r: Route = { id: DAILY, param: date };
        history.current.replace(r);
        setNavKey((n) => n + 1);
        setRoute(r);
      } else {
        setNoteDaily({ path, date, duplicates: [v.path, ...v.duplicates].filter((p): p is string => !!p && p.normalize('NFC') !== path.normalize('NFC')) });
      }
    }, () => {});
  }, []);
  // D-218, D-703: a tag opens its tag page.
  const openTag = useCallback((key: string) => { void go({ id: 'tag/<key>', param: tagKey(key) }); }, [go]);
  /** Replaces the current history entry (FR-TAG-04 AC-9: a renamed tag; D-720: a removed one). */
  const replaceRoute = useCallback((r: Route) => {
    history.current.replace(r);
    setNavKey((n) => n + 1);
    setRoute(r);
  }, []);

  const routeKey = route ? routeString(route) : '';
  const shownRoute = useRef(routeKey);
  shownRoute.current = routeKey;
  // The route a Back/Forward step is restoring the scroll position of (not re-scrolled to its fragment, AC-4).
  const restoreFor = pendingScroll.current !== null ? routeKey : null;
  const keepMeta = useRef<string | null>(null);
  useEffect(() => {
    const kept = keepMeta.current !== null && route?.id === 'note/<path>' && route.param === keepMeta.current;
    keepMeta.current = null;
    if (kept) { void ipc.navOpened(route!.param!).catch(() => {}); return; }
    setMeta(null);
    setNoteShown(false);
    setNoteDaily(null);
    setCalendar(null);
    if (route?.id === 'note/<path>' && route.param) void ipc.navOpened(route.param).catch(() => {});
    closePreview('route'); // v1-previews §3.3: a route change closes the preview
  }, [routeKey]);

  /** The one creation path (D-232, FR-TYP-03 AC-12): ⌘N, the switcher's create item and the type page's New <Name>. */
  const createOf = useCallback(async (typeKey: string, rawTitle: string, prepared: Prepared | null = null) => {
    setDialog(null);
    if (typeKey === 'daily-note') { createToday(); return; } // D-318, D-353: never a second Daily Note
    const title = rawTitle.normalize('NFC');
    if (noteApi.current?.pending()) await flushNote(); // FR-EDT-08 AC-7: the open note is saved before the new object is written
    const made = prepared ? prepared.create(title) : createObject(typeKey, title);
    // A dialog the user opened while the object was being created stays open (the new note opens behind it).
    made.then((p) => { justCreated.current = p.normalize('NFC'); openNote(p, undefined, true); }, () => setMessage(t('error.io')));
  }, [openNote, createToday]);
  const createFrom = useCallback((item: SwitcherItemDto, prepared?: Prepared | null) => createOf(item.type, item.title, prepared ?? null), [createOf]);

  /** Opens the last of Schedule and Kanban (D-520) and puts the focus in `selector` there. */
  const landOnTasks = useCallback((selector: string) => {
    focusOnLand.current = selector;
    void go({ id: lastBoard.current ?? (uiRef.current?.tasks?.view === 'kanban' ? 'tasks/kanban' : 'tasks') }).then(() => setTimeout(() => {
      // Already on that view: no new route to focus, so focus it here.
      const el = focusOnLand.current ? document.querySelector<HTMLInputElement>(focusOnLand.current) : null;
      if (el) { focusOnLand.current = null; el.focus({ preventScroll: true }); }
    }, 100));
  }, [go]);

  /** D-520: where `New <Name>` goes: today's Daily Note, the Tasks quick-add row, or an unsaved draft. */
  const newOf = useCallback((key0: string) => {
    const key = key0.normalize('NFC');
    if (key === 'daily-note') { createToday(); return; }
    if (key === 'task') {
      landOnTasks(QUICK_ADD);
      return;
    }
    void go({ id: 'new/<type>', param: key });
  }, [go, createToday, landOnTasks]);

  // D-520: a draft's bytes come from the creation path (D-232) with an empty title; its first write creates the file
  // and the route becomes the note's without remounting the page (as a rename, FR-FMT-08 AC-5).
  useEffect(() => {
    if (route?.id !== 'new/<type>' || !route.param) return;
    const key = route.param;
    const at = `${routeKey}\n${navKey}`; // each visit is a new draft
    let live = true;
    void prepareObject(key).then((p) => {
      if (!live) return;
      const stamp = localIso(new Date(Date.now()));
      const onCreate = async (text: string) => {
        const title = String(parseDoc(text).frontmatter?.data?.title ?? '').trim();
        const made = await ipc.noteCreate(p.key, title, text);
        const n = await ipc.noteRead(made);
        const path = made.normalize('NFC');
        keepMeta.current = path;
        const r: Route = { id: 'note/<path>', param: path };
        history.current.replace(r);
        setRoute(r);
        return { path: made, version: n.version };
      };
      const carried = carryTitle.current ?? '';
      carryTitle.current = null;
      let text = p.render(carried, stamp);
      // Slice Q (D-1490): a query block's `New <type>` starts with its values (written with the draft's first write).
      const pre = pendingPrefill.current;
      pendingPrefill.current = null;
      if (pre && pre.type.normalize('NFC') === key.normalize('NFC')) {
        for (const [k, v] of pre.values) { try { text = setFmAttribute(parseDoc(text), k, v as never); } catch { /* invalid frontmatter: as rendered */ } }
      }
      setDraft({ route: at, path: `${p.folder ? `${p.folder}/` : ''}${t('newObject.untitled')}.md`, info: { text, stamp, onCreate } });
    }, () => setMessage(t('error.io')));
    return () => { live = false; };
  }, [routeKey, navKey]);
  // D-1674: the second click of a double-click that opened this page acts on nothing here.
  useEffect(() => installMultiClickGuard(), []);
  useEffect(() => { routeChanged(); }, [routeKey, navKey]);

  // ------------------------------------------------------------------ quitting (FR-EDT-08 AC-7, AC-11; FR-SYN-03 AC-19; D-196)
  const quitFlow = useRef(async () => {
    const quit = () => { void ipc.appQuit().catch(() => {}); };
    const api = noteApi.current;
    if (!api) { quit(); return; }
    if (api.mergeOpen()) { setQuitAsk('keepBoth'); return; }
    await Promise.race([api.flush(), new Promise((r) => setTimeout(r, 2000))]);
    if (api.pending()) setQuitAsk('unsaved');
    else quit();
  });
  useEffect(() => {
    // Slice I2 (v1-import-window §6.3): a running import asks first (writing) or is cancelled first (before writing).
    const un = events.quitRequested(() => { if (!importQuitRequested()) void quitFlow.current(); });
    return () => void un.then((f) => f());
  }, []);

  // ------------------------------------------------------------------ layout
  const taskBadge = useTaskBadge(refresh, !!vault);
  const inboxCount = useInboxCount(refresh, !!vault);
  const tagList = useTags();
  const queryList = useQueries();
  // Slice PIN: re-render (and re-list `Pin to sidebar` / `Unpin from sidebar`) when the pins change.
  const pinsState = usePins().pins;
  /** Slice G1 (D-987): the file of the object a route shows (a note, a day with its note, a tag with its Tag file). */
  const objectPathOf = (r: Route | null | undefined): string | null =>
    r?.id === 'note/<path>' || r?.id === 'graph/<path>' ? (r.param ?? null)
      : r?.id === DAILY ? (noteDaily && noteDaily.date === r.param ? noteDaily.path : dailyFile && dailyFile.date === r.param ? dailyFile.path : null)
      : r?.id === 'tag/<key>' ? (tagList.find((x) => x.key === r.param)?.file?.path ?? null) : null;
  /** Slice Q: a query's title from the list (its name until known). */
  const queryTitleOf = (name: string) => queryList?.find((q) => q.name.normalize('NFC') === name.normalize('NFC'))?.title ?? name;
  /** Slice PIN (D-1382): what the route can pin; `unsaved` for `new/<type>` and a virtual day. */
  const pinRequestOf = (r: Route | null | undefined): PinRequestDto | 'unsaved' | null => {
    if (!r) return null;
    if (r.id === 'new/<type>') return 'unsaved';
    if (r.id === 'tag/<key>') return r.param ? { kind: 'tag', key: r.param } : null;
    if (r.id === 'type/<type>') return r.param ? { kind: 'type', key: r.param } : null;
    if (r.id === 'note/<path>') return r.param ? { kind: 'object', path: r.param.normalize('NFC') } : null;
    if (r.id === DAILY) { const p = objectPathOf(r); return p ? { kind: 'object', path: p.normalize('NFC') } : 'unsaved'; }
    // Slice Q (v1-queries §1.9): a query page pins its query by name.
    if (r.id === 'query/<name>') return r.param ? { kind: 'query', name: r.param.normalize('NFC') } : null;
    return null;
  };
  /** The label `Pinned …` / `Unpinned …` names (R133's label for the route's target). */
  const pinLabelOf = (r: Route | null | undefined): string | null => {
    if (!r) return null;
    if (r.id === 'tag/<key>') return `#${tagList.find((x) => x.key === r.param)?.name ?? r.param ?? ''}`;
    if (r.id === 'type/<type>') return types.find((x) => x.key === r.param)?.plural ?? r.param ?? null;
    if (r.id === DAILY) return r.param ?? null;
    if (r.id === 'query/<name>') return queryTitleOf(r.param ?? '');
    return meta?.title ?? (r.param ? r.param.split('/').pop()!.replace(/\.md$/, '') : null);
  };
  // D-987: a day route's note file (null: a virtual day), for `Open graph`.
  const [dailyFile, setDailyFile] = useState<{ date: string; path: string | null } | null>(null);
  useEffect(() => {
    if (route?.id !== DAILY || !route.param) return;
    const date = route.param;
    let live = true;
    ipc.dailyView(date).then((v) => { if (live) setDailyFile({ date, path: v.path }); }, () => {});
    return () => { live = false; };
  }, [route?.id, route?.param, refresh]);
  const graphCommand = useRef<((id: GraphCommandId) => void) | null>(null);
  const graphStatus = useRef<(() => GraphStatus) | null>(null);
  const [graphTitle, setGraphTitle] = useState<{ route: string; title: string } | null>(null);
  // D-692: every way of opening a Tag object opens its tag page.
  useEffect(() => {
    if (route?.id !== 'note/<path>' || !route.param) return;
    const k = tagOfFile(route.param);
    if (k) replaceRoute({ id: 'tag/<key>', param: k });
  }, [routeKey, tagList]);
  // Bug 112h: at start (vault still unknown → known) the tags' first load is shared with every surface; a vault opened
  // from the chooser, a vault switch and a refresh read again.
  const tagsVault = useRef<VaultInfo | null | undefined>(undefined);
  const tagsRefresh = useRef(refresh);
  useEffect(() => {
    const atStart = tagsVault.current === undefined && tagsRefresh.current === refresh;
    if (vault !== undefined) tagsVault.current = vault;
    tagsRefresh.current = refresh;
    if (vault) void (atStart ? loadTags() : refreshTags());
  }, [vault?.path, vault === null, refresh]);
  // Slice PIN (§2): the pins of the open vault; a vault switch forgets the last vault's.
  useEffect(() => { pinsForVault(vault ? vault.path.normalize('NFC') : null); }, [vault?.path]);
  // Slice Q (§2.2): the vault's saved queries.
  useEffect(() => { queriesForVault(vault ? vault.path.normalize('NFC') : null); }, [vault?.path]);
  const isDaily = route?.id === DAILY;
  const isObject = isNoteRoute(route);
  const available = width - (ui.sidebarOpen ? SIDEBAR_W : 0);
  // D-634: the stored width, drawn narrower when the centre pane would fall below 400 px; closed when even 240 doesn't fit.
  const panelWidth = Math.min(Math.max(ui.rightPanel.width ?? PANEL_W, PANEL_MIN), PANEL_MAX);
  const panelRoom = available - MIN_CENTRE;
  const panelFits = panelRoom >= PANEL_MIN;
  const showSidebar = ui.sidebarOpen && !focusMode;
  const showPanel = isObject && ui.rightPanel.open && panelFits && !focusMode;
  /** 6A: Move to trash for the current route (FR-HIS-01 AC-1, AC-3): a note page saves first and goes Back (or to the
   *  Inbox); the Trash page asks to delete the focused row; elsewhere the focused row or card with a `data-path`. */
  const trashHere = async () => {
    if (route?.id === 'trash') { trashCommand.current?.('delete'); return; }
    if (route?.id === 'inbox') { inboxCommand.current?.('inbox.trash'); return; }
    if (isNoteRoute(route) || route?.id === DAILY) {
      const api = noteApi.current;
      if (!api || api.trashBlocked()) return;
      const item = await api.trashTarget();
      if (!item) return;
      const back = route;
      const r = await moveToTrash([item], { onUndone: () => { if (back) void go(back); } });
      if (r.conflicts.length) { api.reload(); return; }
      if (!r.moved.length) return;
      if (history.current.canBack()) actions.back(); else void go({ id: 'inbox' });
      return;
    }
    const el = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('main [data-path]');
    const path = el?.dataset.path;
    if (!path) return;
    try {
      const n = await ipc.noteRead(path);
      const title = el?.dataset.title ?? path.split('/').pop()!.replace(/\.md$/i, '');
      await moveToTrash([{ path, base: n.version, title }]);
      setRefresh((x) => x + 1);
    } catch { /* gone already */ }
  };
  trashRequest.current = () => { void trashHere(); };

  const actions: ShellActions = useMemo(() => ({
    go: (r: Route) => { void go(r); },
    openPalette: () => setDialog('palette'),
    openSearch: () => {
      void go({ id: 'search' });
      // Also when Search is already shown: the caret goes to its field with the query selected (D-760).
      requestAnimationFrame(() => { const i = searchInput.current; if (i && !live.current.dialog) { i.focus({ preventScroll: true }); i.select(); } });
    },
    // D-1431, D-1432: New object asks for a type first, the vault's default preselected; the choice then opens an
    // unsaved object of that type (D-520); a Daily Note opens today's (D-353), a Task the quick-add row.
    newObject: (anchor?: HTMLElement | null) => {
      const open = live.current.dialog;
      if (open && open !== 'palette') return; // one picker at a time (AC-12)
      // From the palette (D-139): the focus to give back is the one the palette would have given back.
      returnFocus.current = open === 'palette' ? pendingReturn.current : document.activeElement as HTMLElement | null;
      returnRange.current = open === 'palette' ? pendingRange.current : null;
      if (open === 'palette') { pendingReturn.current = null; pendingRange.current = null; }
      else {
        // Focusing the editor again doesn't bring its caret back: keep the text range to restore on close (AC-12).
        const sel = window.getSelection();
        const r = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
        returnRange.current = r && returnFocus.current?.isContentEditable && returnFocus.current.contains(r.startContainer) ? r.cloneRange() : null;
      }
      pendingFocus.current = false;
      // Open at once with the loaded types, so keys typed right after ⌘N reach the picker, not the note; the default
      // type follows (`undefined` until known: ⏎ waits for it).
      const box = anchor?.getBoundingClientRect();
      const at = box ? { left: box.left, top: box.bottom + 4 } : null;
      setNewPicker({ types: typesRef.current, defaultKey: undefined, at });
      setDialog('newObject');
      void ipc.switcher('?', 0).then((items) => items.find((i) => i.kind === 'create')?.type ?? null, () => null)
        .then((key) => setNewPicker((p) => (p ? { ...p, defaultKey: key } : p)));
    },
    newType: () => { returnFocus.current = document.activeElement as HTMLElement | null; pendingFocus.current = false; setDefineValue(null); setDialog('newType'); },
    addStarterTypes: () => { returnFocus.current = document.activeElement as HTMLElement | null; pendingFocus.current = false; setDialog('starter'); },
    newObjectOfType: (key: string) => newOf(key),
    openTypeSettings: () => {
      const key = route?.id === 'type/<type>' ? route.param : isNoteRoute(route) ? (metaRef.current?.type ?? 'page') : undefined;
      if (key) void go({ id: 'type-settings/<type>', param: key });
    },
    // After the palette has closed and given the focus back (D-139), the menu or the first control takes it.
    // FR-VLT-05 AC-4 (D-550): on an unwritten draft, `Change type…` picks the draft's type and writes nothing.
    changeType: () => {
      if (route?.id === 'new/<type>') { setTimeout(() => setDraftType({ at: { left: 240, top: 120 } }), 0); return; }
      if (isNoteRoute(route)) setTimeout(() => noteApi.current?.changeType(), 0);
    },
    editProperties: () => { if (isNoteRoute(route)) setTimeout(() => noteApi.current?.editProperties(), 0); },
    toggleSidebar: () => updateUi((u) => ({ ...u, sidebarOpen: !u.sidebarOpen })),
    toggleRightPanel: () => {
      if (!isNoteRoute(route)) return;
      // Closing the panel with the focus in it gives the focus back to the note (FR-LNK-01 AC-14).
      if (document.activeElement?.closest('.context-panel')) noteApi.current?.placeFocus();
      updateUi((u) => ({ ...u, rightPanel: { ...u.rightPanel, open: !u.rightPanel.open } }));
    },
    pickDate: () => {
      const selected = route?.id === DAILY && route.param ? route.param : localDate(Date.now());
      const anchor = document.querySelector<HTMLElement>('[data-command="daily.pickDate"]');
      setCalendar({ selected, anchor, onChoose: (d) => { setCalendar(null); void go({ id: DAILY, param: d }); } });
    },
    setReviewed: (r: boolean) => { if (route?.id === DAILY || noteDaily) setTimeout(() => noteApi.current?.setReviewed(r), 0); },
    goTasks: () => { void go(tasksRoute((uiRef.current?.tasks?.view ?? 'schedule') as TasksView)); },
    taskCommand: (id: string) => taskCommand.current?.(id),
    taskCommandState: (id: string) => taskCommandState.current?.(id),
    filterTasks: () => {
      // D-1284: on a task view the focus goes to its field; elsewhere the last of Schedule and Kanban opens with it.
      const field = document.querySelector<HTMLInputElement>(TASK_SEARCH);
      if (field && (route?.id === 'tasks' || route?.id === 'tasks/kanban' || (route?.id === 'type/<type>' && route.param?.normalize('NFC') === 'task'))) field.focus();
      else landOnTasks('main [data-command="tasks.search"]');
    },
    tagCommand: (id: string) => tagCommand.current?.(id),
    mergeFocused: () => mergeCommand.current?.(),
    newTag: () => {
      if (newTagCommand.current) { newTagCommand.current(); return; }
      pendingNewTag.current = true;
      void go({ id: 'tags' });
    },
    // 5B (inbox.md R62; D-562, D-578).
    inboxCommand: (id: string) => inboxCommand.current?.(id),
    capture: (kind: 'default' | 'task') => { void ipc.captureOpen(kind).catch(() => {}); },
    setNoteReviewed: (r: boolean) => { if (route?.id === 'note/<path>') setTimeout(() => noteApi.current?.setReviewed(r), 0); },
    // 6A (R75, FR-HIS-01 AC-1, AC-3; D-620): Move to trash on the page's object, card or row.
    trashObject: () => { void trashHere(); },
    trashBlocked: () => (route?.id === 'new/<type>' ? t('trash.nothing') : isNoteRoute(route) || route?.id === DAILY ? (noteApi.current?.trashBlocked() ?? null) : null),
    trashCommand: (id: 'restore' | 'delete') => trashCommand.current?.(id),
    addMedia: () => { if (isNoteRoute(route) || route?.id === DAILY) setTimeout(() => noteApi.current?.edit('addMedia'), 0); },
    undoRename: () => { void undoLast(); },
    undoJob: (kind) => undoLastMove(kind),
    showNotUpdated: () => showList(true),
    showBacklinks: () => {
      if (!isNoteRoute(route)) return;
      updateUi((u) => ({ ...u, rightPanel: { ...u.rightPanel, open: true, tab: 'backlinks' } }));
      setFocusBacklinks((n) => n + 1);
    },
    // Slice OL (R175, §6.1; D-1675): ⌘J opens the card; `Toggle outline rail`.
    outlineJump: () => {
      if (!isNoteRoute(route)) return;
      const src = getOutline();
      if (getCard().open) { closeCard(); src?.refocus(); return; }
      if (!src) return;
      if (!src.tree.length) { announce(t('outline.empty')); return; }
      syncTracker(); // the focused row is the current section of the scroll position now (a scroll's frame may be pending)
      openCard('key');
      requestFocus('card');
    },
    toggleOutlineRail: () => updateUi((u) => ({ ...u, outlineRail: u.outlineRail === false })),
    // Slice G2 (FR-NAV-05 AC-2, D-918): one write of `rightPanel.open` and `tab`.
    showLocalGraph: () => {
      if (!isNoteRoute(route)) return;
      updateUi((u) => ({ ...u, rightPanel: { ...u.rightPanel, open: true, tab: 'graph' } }));
      setFocusGraph((n) => n + 1);
    },
    toggleFocus: () => {
      if (!isNoteRoute(route)) return;
      setFocusMode((f) => !f);
      requestAnimationFrame(() => heading.current?.focus());
    },
    toggleSource: () => { if (isNoteRoute(route)) setSourceToggle((n) => n + 1); },
    back: () => { void step('back'); },
    forward: () => { void step('forward'); },
    toggleProperties: () => { if (isNoteRoute(route)) updateUi((u) => ({ ...u, propertiesOpen: !u.propertiesOpen })); },
    setPageWidth: (w) => { if (isNoteRoute(route)) noteApi.current?.setWidth(w); },
    openImport: () => openImportWindow(pendingReturn.current ?? returnFocus.current ?? (document.activeElement as HTMLElement | null)),
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
    // Slice P (R106): each does nothing without a reference or a chip at the caret (FR-UX-03 AC-19).
    showPreview: () => { setTimeout(() => showPreviewAction()?.(), 0); }, // after the palette gave the focus back (D-139)
    setPreviewMode: (m) => { if (getPreviewPrefs().mode !== m) updatePrefs((d) => ({ ...d, mode: m })); },
    // Slice G1 (D-918, D-987): the full view of the current object; the graph route's commands.
    // Slice G2 (R116 rules 3, 4; D-1036): with the panel on the Graph tab, the panel's hand-over.
    openGraph: () => {
      if (route?.id !== 'graph/<path>' && panelShowsGraph.current && panelGraph.current) { panelGraph.current.openFull(); return; }
      const path = objectPathOf(route);
      if (path) void go({ id: 'graph/<path>', param: path.normalize('NFC') });
    },
    // "G3 in the panel" (R127, §17.5): each R123 command acts on the one graph shown (D-988).
    graphCommand: (id) => {
      if (route?.id === 'graph/<path>') graphCommand.current?.(id);
      else if (panelShowsGraph.current && id !== 'recenter') panelGraph.current?.command(id);
    },
    graphStatus: () => {
      const vk = vault?.path.normalize('NFC');
      if (route?.id === 'graph/<path>') {
        const st = graphStatus.current?.() ?? null;
        // The stored view, which the palette's list follows before the page re-renders (R123).
        const v = vk ? uiRef.current?.vaults?.[vk]?.graph?.full?.view : undefined;
        return st ? { ...st, view: v === 'list' ? 'list' : 'graph' } : null;
      }
      if (panelShowsGraph.current && panelGraph.current) {
        const st = panelGraph.current.status();
        const v = vk ? uiRef.current?.vaults?.[vk]?.graph?.panel?.view : undefined;
        const s = panelGraph.current.state();
        // D-1145: the panel's state for AP-972's reasons.
        const state = panelPending.current ? 'pending' : s === 'noFile' || s === 'deleted' || s === 'noLinks' ? s : 'ready';
        return { ...st, view: v === 'list' ? 'list' : 'graph', state };
      }
      return null;
    },
    editLink: () => { setTimeout(() => editorLinkAction('edit'), 0); },
    removeLink: () => { setTimeout(() => editorLinkAction('remove'), 0); },
    edit: (a) => { if (isNoteRoute(route)) noteApi.current?.edit(a); },
    convertBlocked: () => (!isNoteRoute(route) ? null : noteApi.current ? noteApi.current.convertBlocked() : t('convert.readOnly')),
    // Slice PIN (R136, v1-pinned §3.4): what the route pins, and the focused pinned row's moves.
    pinStatus: () => {
      const r = pinRequestOf(route);
      if (r === null) return null;
      if (r === 'unsaved') return { pinned: false, disabled: t('pinned.notSaved') };
      const lock = editReason(pinsNow());
      return { pinned: findPin(pinsNow(), r, tagOfFile) !== null, disabled: lock ? t(lock) : null };
    },
    pinCurrent: () => {
      const r = pinRequestOf(route);
      if (r && r !== 'unsaved' && !editReason(pinsNow())) void pinTarget(r, null, () => pinLabelOf(route));
    },
    unpinCurrent: () => {
      const r = pinRequestOf(route);
      const i = r && r !== 'unsaved' ? findPin(pinsNow(), r, tagOfFile) : null;
      if (i !== null && !editReason(pinsNow())) void unpin(i, pinLabelOf(route) ?? undefined);
    },
    movePinned: (dir) => moveFocusedPinned(dir),
    pinnedRowFocused: () => focusedPinnedRow() !== null,
    // Slice Q (v1-queries §4.6): the query page's query or the note's selected query block.
    queryStatus: () => {
      if (route?.id === 'query/<name>') {
        const st = queryStatus.current?.() ?? null;
        return st ? { name: st.name, editable: st.editable } : route.param ? { name: route.param, editable: true } : null;
      }
      if (!isNoteRoute(route)) return null;
      const b = selectedQueryBlock();
      return b ? { name: b.name ?? '', editable: b.editable } : null;
    },
    editQuery: () => {
      if (route?.id === 'query/<name>') { setTimeout(() => queryCommand.current?.('edit'), 0); return; }
      const b = selectedQueryBlock();
      if (b) setTimeout(() => b.edit(), 0);
    },
    renameQuery: () => { if (route?.id === 'query/<name>') setTimeout(() => queryCommand.current?.('rename'), 0); },
    trashQuery: () => { if (route?.id === 'query/<name>') setTimeout(() => queryCommand.current?.('trash'), 0); },
    insertQuery: () => { if (isNoteRoute(route)) setTimeout(() => noteApi.current?.edit('insertQuery'), 0); },
    newQuery: () => { setTimeout(() => openNameDialog({ kind: 'new', returnFocus: document.activeElement as HTMLElement | null }), 0); },
    editorFocused: () => {
      // With the palette open, the focus it gives back (D-139) is what counts.
      const inDialog = !!(document.activeElement as HTMLElement | null)?.closest?.('[role="dialog"]');
      const el = (inDialog ? returnFocus.current : document.activeElement) as HTMLElement | null;
      return !!el?.closest?.('main [contenteditable="true"]');
    },
  }), [go, step, route?.id, route?.param, updateUi, noteDaily, tagList, dailyFile, meta?.title, types, pinsState, queryList]);

  // Slice G2 (v1-graph §15.2): the right panel's Graph tab, around the page's object (D-1038: no file on new/<type>
  // and a virtual day).
  const panelGraphProps: Omit<GraphPanelProps, 'width'> | undefined = (() => {
    if (!vault || !isNoteRoute(route)) return undefined;
    const vp = vault.path.normalize('NFC');
    const path = route?.id === 'new/<type>' ? null : objectPathOf(route);
    const pending = route?.id === DAILY && !(noteDaily && noteDaily.date === route.param) && !(dailyFile && dailyFile.date === route.param);
    const title = route?.id === DAILY ? (route.param ?? '') : (meta?.title ?? (path ? path.split('/').pop()!.replace(/\.md$/, '') : ''));
    return {
      centre: { path: path ? path.normalize('NFC') : null, title, objectId: null },
      vaultPath: vp,
      state: ui.vaults?.[vp]?.graph?.panel ?? {},
      onState: (next) => updateUi((u) => ({ ...u, vaults: { ...(u.vaults ?? {}), [vp]: { ...(u.vaults?.[vp] ?? {}), graph: { ...(u.vaults?.[vp]?.graph ?? {}), panel: next } } } })),
      onOpen: (n, o) => {
        const heading = !!o?.byKey;
        if (n.typeKey === 'tag') { void go({ id: 'tag/<key>', param: tagKey(n.tagKey ?? n.title) }, { heading }); return; }
        if (n.typeKey === 'daily-note' && /^\d{4}-\d{2}-\d{2}$/.test(n.title)) { void go({ id: DAILY, param: n.title }, { heading }); return; }
        if (n.path) void go({ id: 'note/<path>', param: n.path.normalize('NFC') }, { heading });
      },
      onOpenFull: (h) => { if (path) void go({ id: 'graph/<path>', param: path.normalize('NFC') }, { graph: h }); },
      refresh,
      onOwnSave,
      types,
      pending,
      focusTrigger: focusGraph,
      commandRef: panelGraph,
      // §17.1, §16.4: a Tegg rename or delete of a preset changes `preset` in both views in one write.
      onViews: (f) => updateUi((u) => {
        const g = u.vaults?.[vp]?.graph ?? {};
        const next = f({ full: g.full, panel: g.panel as GraphViewStateDto | undefined });
        return { ...u, vaults: { ...(u.vaults ?? {}), [vp]: { ...(u.vaults?.[vp] ?? {}), graph: { ...g, ...next } } } };
      }),
      // AP-960 (D-1130): the second Esc in the panel graph focuses the Context panel's `Graph` tab.
      onFocusTab: () => document.querySelector<HTMLElement>('.context-panel [role="tab"][data-command="panel.graph"]')?.focus(),
    };
  })();
  panelPending.current = !!panelGraphProps?.pending;
  // D-562: a note route carries its object's type, so the review commands follow its Review row.
  setDateTimeSetting(ui.dateTime);
  const ctxRoute = route?.id === DAILY ? { ...route, date: route.param, path: objectPathOf(route) } : route?.id === 'note/<path>' ? { ...route, path: route.param ?? null, type: meta?.type, review: meta?.review, hasFrontmatter: meta?.hasFrontmatter }
    : route?.id === 'tag/<key>' ? { ...route, path: objectPathOf(route) } : route;
  // D-1675: a remembered `outline` tab (the removed Outline tab) shows Backlinks.
  const panelTab: PanelTab = ui.rightPanel.tab === 'graph' ? 'graph' : 'backlinks';
  panelShowsGraph.current = showPanel && panelTab === 'graph';
  const ctx: ShellContext = { vault: vault ?? null, types, counts, actions, route: ctxRoute ?? null, panel: { open: showPanel, tab: panelTab } };
  // G3 (R123): `Show as list` / `Show as graph` follow the graph's stored view.
  const graphView = vault ? ui.vaults?.[vault.path.normalize('NFC')]?.graph?.full?.view : undefined;
  const panelView = vault ? ui.vaults?.[vault.path.normalize('NFC')]?.graph?.panel?.view : undefined;
  const list = useMemo(() => commands(ctx), [types, counts, vault, actions, routeKey, graphView, panelView, noteDaily?.path, noteDaily?.date, dailyFile, tagList, meta?.type, meta?.review, meta?.hasFrontmatter, showPanel, panelTab, dialog /* slice PIN: ⌥⌘↑/↓ listed when opened from a pinned row */]);
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
    pendingRange.current = returnRange.current;
    returnRange.current = null;
    pendingReturn.current = returnFocus.current;
    returnFocus.current = null;
    setDialog(null);
  }, []);
  useLayoutEffect(() => {
    if (dialog) return;
    const back = pendingReturn.current;
    const range = pendingRange.current;
    pendingReturn.current = null;
    pendingRange.current = null;
    // A command that moved the focus itself (a mindmap's Map / List, D-776) keeps it; otherwise it goes back.
    const now = document.activeElement;
    if (now && now !== document.body && now.isConnected) return;
    if (back?.isConnected) {
      back.focus();
      if (range && back.contains(range.startContainer)) { const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(range); }
    }
  }, [dialog]);

  // ------------------------------------------------------------------ keyboard (FR-UX-03 AC-9, D-137)
  // One listener reads the latest state through a ref, so a key right after a render never sees stale state.
  const live = useRef({ dialog, focusMode, available_commands, run, closeDialog });
  live.current = { dialog, focusMode, available_commands, run, closeDialog };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (importOpen()) return; // slice I2 (FR-UX-03 AC-44): only the Import window's keys act while it is open
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
      // ⌥⌘← / ⌥⌘→ leave an open `@` / `[[` list alone (FR-DLY-03 AC-2).
      if ((s.command === 'daily.previous' || s.command === 'daily.next') && document.querySelector('[role="listbox"]')) return;
      // Editor commands the editor already handled (⌘Z in the text) don't run twice.
      if (s.command.startsWith('edit.') && e.defaultPrevented) return;
      // 6A (FR-HIS-01 AC-1): in text (the editor, a field) ⌘⌫ keeps deleting to the line start.
      if (s.command === 'object.trash' && el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      // Slice PIN (R136, D-1386): ⌥⌘↑ / ⌥⌘↓ act only with the focus on a pinned row; elsewhere the key is left alone.
      if (s.command === 'sidebar.pinned.moveUp' || s.command === 'sidebar.pinned.moveDown') {
        if (L.dialog || focusedPinnedRow() === null) return;
        e.preventDefault();
        moveFocusedPinned(s.command === 'sidebar.pinned.moveUp' ? -1 : 1);
        return;
      }
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
    const w = window as { __teggEarlyKeys?: KeyboardEvent[]; __teggKeysReady?: boolean };
    w.__teggKeysReady = true;
    for (const e of w.__teggEarlyKeys?.splice(0) ?? []) onKey(e);
    return () => window.removeEventListener('keydown', onKey);
  }, []);


  // Mouse back/forward buttons and the shell's native navigation events (FR-NAV-03, ms3-shell §12.2). The two-finger
  // swipe is the next effect (D-1511).
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
    window.addEventListener('mouseup', onMouse);
    return () => {
      void unNative.then((f) => f());
      window.removeEventListener('mouseup', onMouse);
    };
  }, [step]);

  // The two-finger swipe between pages (D-1511, FR-NAV-03 AC-11…AC-14): only while macOS's `Swipe between pages` scrolls
  // with two fingers, which the shell answers at start and each time the window gets the focus (ms3-shell §12.2).
  const swipeStep = useRef(step);
  swipeStep.current = step;
  useEffect(() => {
    let on = false;
    let asked = 0;
    const ask = () => {
      const n = ++asked;
      void ipc.navSwipeScroll().then((v) => { if (n === asked) on = v === true; }).catch(() => {});
    };
    ask();
    window.addEventListener('focus', ask);
    const off = installNavSwipe({ enabled: () => on, blocked: () => !!live.current.dialog, step: (dir) => { void swipeStep.current(dir); } });
    return () => {
      asked++;
      window.removeEventListener('focus', ask);
      off();
    };
  }, []);

  // ------------------------------------------------------------------ the current page
  const def = route ? routeDef(route.id) : undefined;
  const typeEntry = route?.id === 'type/<type>' ? typeEntries(types, counts).find((e) => e.key === route.param) : undefined;
  const pageName: string =
    route?.id === DAILY ? (route.param ?? '')
      : route?.id === 'note/<path>' ? (meta?.title ?? (route.param ?? '').split('/').pop()!.replace(/\.md$/, ''))
      : route?.id === 'type/<type>' ? (typeEntry?.plural ?? route.param ?? '')
      : route?.id === 'tag/<key>' ? `#${tagList.find((x) => x.key === route.param)?.name ?? route.param ?? ''}`
      // Slice Q (R143): the query page is named by its title.
      : route?.id === 'query/<name>' ? queryTitleOf(route.param ?? '')
      // Slice G1 (D-914): `Graph · <title>`.
      : route?.id === 'graph/<path>' ? t('graph.tabTitle', { title: graphTitle?.route === routeKey ? graphTitle.title : (route.param ?? '').split('/').pop()!.replace(/\.md$/, '') })
        // FR-VLT-05 AC-4: an unwritten draft's tab names its type (`New Nápad`).
        : route?.id === 'new/<type>' && route.param ? t('cmd.newOfType', { name: types.find((x) => x.key === route.param?.normalize('NFC'))?.name ?? route.param })
        : def ? t(def.name) : '';
  const userNamed = route?.id === 'note/<path>' || route?.id === 'type/<type>' || route?.id === DAILY || route?.id === 'tag/<key>' || route?.id === 'query/<name>';

  // Focus moves to the new page's heading after navigation (D-130); `route-ready:` marks for Appium (§1).
  const markedRoute = useRef<string | null>(null);
  useEffect(() => { markedRoute.current = null; }, [routeKey]);
  useEffect(() => {
    if (!route || chooserShown) return;
    let tries = 0;
    const tick = () => {
      if (shownRoute.current !== routeKey) return; // a tick of a page that was left before it was ready
      const h = heading.current;
      const isNote = route.id === 'note/<path>' || route.id === 'new/<type>';
      const ready = !!h && ((!isNote && route.id !== DAILY) || meta !== null);
      // A draft (D-520) reads its type before its page exists: give it longer than a page that renders at once.
      if (!ready) { if (tries++ < (route.id === 'new/<type>' ? 300 : 60)) requestAnimationFrame(tick); return; }
      // A daily route mounts its note page after its view is known: wait for it rather than focusing the heading.
      if (route.id === DAILY && !noteApi.current && tries++ < 60) { requestAnimationFrame(tick); return; }
      if (pendingFocus.current && !live.current.dialog) {
        pendingFocus.current = false;
        // A note places the focus itself: title of a new note, caret in the body, or its heading (D-247, D-255).
        const quick = focusOnLand.current ? document.querySelector<HTMLInputElement>(focusOnLand.current) : null;
        if (quick) { focusOnLand.current = null; quick.focus({ preventScroll: true }); } // D-520: New Task, D-1284: Filter tasks
        else if ((isNote || route.id === DAILY) && noteApi.current && !headingFocus.current) { if (route.param === justCreated.current || `daily:${route.param}` === justCreated.current) justCreated.current = null; noteApi.current.placeFocus(); }
        // Search starts in its field (owner feedback F3, docs/feedback/ms3-3d.md); other pages focus the heading.
        else if (route.id === 'search' && searchInput.current) searchInput.current.focus({ preventScroll: true });
        // A page that already put the focus on one of its items (the Inbox card one came back to, D-457) keeps it.
        else if (headingFocus.current) {
          // "G3 in the panel" (FR-UX-03 AC-33): the page heading itself, not the title field inside it (D-130).
          headingFocus.current = false;
          const h1 = (h!.closest('h1') as HTMLElement | null) ?? h!;
          if (h1 !== h && !h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1');
          h1.focus({ preventScroll: true });
        }
        else if (!(document.activeElement && document.activeElement !== h && document.querySelector('main')?.contains(document.activeElement) && document.activeElement.closest('[data-path]'))) h!.focus({ preventScroll: true });
      }
      if (pendingScroll.current !== null && route.id !== 'note/<path>' && route.id !== DAILY) {
        const m = document.querySelector('main');
        if (m) m.scrollTop = pendingScroll.current;
        pendingScroll.current = null;
      }
      // The Tasks page marks itself once its cards have painted (FR-TSK-04 AC-14).
      // The Tasks page and the graph (v1-graph §3: after its first graph or state) mark themselves.
      if (route.id === 'tasks' || route.id === 'tasks/kanban' || route.id === 'graph/<path>') return;
      // A page that doesn't wait for a note is shown once per arrival: the note left behind clearing its `meta` reruns
      // this effect and must not mark the route a second time (D-1511: a step is one route shown, FR-NAV-03 AC-12).
      if (!isNote && route.id !== DAILY) {
        if (markedRoute.current === routeKey) return;
        markedRoute.current = routeKey;
      }
      void ipc.perfMark(`route-ready:${routeKey}`).catch(() => {});
    };
    requestAnimationFrame(tick);
  }, [routeKey, meta, chooserShown]);

  if (vault === undefined) return withImport(null);

  if (chooserShown) {
    return withImport(
      <>
        <Chooser key={chooser ? `c${chooser.form}` : 'none'} startWithForm={chooser?.form ?? false} onOpened={opened} onCancel={vault ? () => setChooser(null) : undefined} />
        {dialog === 'palette' && <Palette list={available_commands} onRun={(c) => { closeDialog(); run(c); }} onClose={closeDialog} />}
        <div className="chooser-status"><ImportStatus /></div>
      </>,
    );
  }

  let body: React.ReactNode = null;
  const notePage = (path: string, key: string | number, daily?: DailyInfo, draftInfo?: DraftInfo) => (
      <NotePage
        key={key}
        apiRef={noteApi}
        created={!!draftInfo || justCreated.current === path || (!!daily && justCreated.current === `daily:${daily.date}`)}
        path={path}
        fragment={daily ? undefined : route?.fragment}
        at={daily ? undefined : route?.at}
        attr={daily ? undefined : route?.attr}
        selectEmbedOf={daily ? undefined : route?.selectEmbedOf}
        onOpenSource={(p) => { void go({ id: 'note/<path>', param: p.normalize('NFC'), selectEmbedOf: path.normalize('NFC') }); }}
        restoreScroll={restoreFor === routeKey ? (pendingScroll.current ?? undefined) : undefined}
        restoreCaret={restoreFor === routeKey ? (pendingCaret.current ?? undefined) : undefined}
        onRestored={() => { pendingScroll.current = null; }}
        knownId={knownIds.current.get(path)}
        onId={(id) => knownIds.current.set(path, id)}
        types={types}
        heading={heading}
        onMeta={(m) => { setMeta(m); setNoteShown(true); }}
        onType={(k) => { void go({ id: 'type/<type>', param: k }); void ipc.navOpened(null, `type/${k}`).catch(() => {}); }} // D-369: the chip's open is recorded (FR-TYP-07 AC-11)
        onOpen={openNote}
        onTag={openTag}
        onRenamed={(p) => {
          if (route?.id === DAILY) return;
          keepMeta.current = p.normalize('NFC'); // the same page goes on showing the note (FR-FMT-08 AC-5)
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
        widths={ui.noteWidth}
        defaultWidth={vaultWidth}
        onWidth={setNoteWidth}
        onRekeyWidth={(from, to, w) => setNoteWidth(to, w, from)}
        onTypeSaved={loadTypes}
        onWritten={() => { for (const f of ownSaveListeners.current) f(); }}
        daily={daily}
        draft={draftInfo}
        onDaily={(date) => onNoteDaily(path, date)}
      />
  );
  const dailyNav = {
    go: (d: string) => openDay(d),
    today: () => { void go({ id: 'today' }); },
    pickDate: (anchor: HTMLElement | null) => {
      const selected = route?.id === DAILY && route.param ? route.param : noteDaily?.date ?? localDate(Date.now());
      setCalendar({ selected, anchor, onChoose: (d) => { setCalendar(null); openDay(d); } });
    },
    openPath: (p: string) => openNote(p),
    duplicateTitles: () => { void go({ id: 'duplicate-titles' }); },
  };
  if (route?.id === DAILY && route.param) {
    body = <DailyPage key={navKey} date={route.param} refresh={refresh} apiRef={noteApi} nav={dailyNav} render={(p, info, k) => notePage(p, k, info)} />;
  } else if (route?.id === 'note/<path>' && route.param) {
    const nd = noteDaily && noteDaily.path === route.param ? noteDaily : null;
    const info: DailyInfo | undefined = nd ? {
      date: nd.date, virtual: null, duplicates: nd.duplicates, messages: [],
      onCreate: () => Promise.reject(new Error('written')),
      onDay: (n) => { const [y, m, d] = nd.date.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1, d + n)); openDay(x.toISOString().slice(0, 10)); },
      onToday: dailyNav.today, onPickDate: dailyNav.pickDate, onOpenPath: dailyNav.openPath, onDuplicateTitles: dailyNav.duplicateTitles,
    } : undefined;
    body = notePage(route.param, navKey, info);
  } else if (route?.id === 'new/<type>' && route.param) {
    body = draft && draft.route === `${routeKey}\n${navKey}` ? notePage(draft.path, navKey, undefined, draft.info) : null;
  } else if (route?.id === 'type/<type>' && route.param) {
    const key = route.param;
    const page = {
      typeKey: key,
      type: types.find((x) => x.key.normalize('NFC') === key.normalize('NFC')),
      types,
      plural: pageName,
      refresh,
      heading,
      sort: ui.typeSort?.[key],
      onSort: (s: TypeSort) => updateUi((u) => ({ ...u, typeSort: { ...(u.typeSort ?? {}), [key]: s } })),
      // D-1241: column widths per type key, machine-local; an empty map drops the type's entry (Reset column widths).
      widths: ui.typeColumnWidths?.[key] as Record<string, number> | undefined,
      onWidths: (w: Record<string, number>) => updateUi((u) => {
        const all = { ...(u.typeColumnWidths ?? {}) };
        if (Object.keys(w).length) all[key] = w; else delete all[key];
        return { ...u, typeColumnWidths: all };
      }),
      onOpen: openNote,
      onTag: openTag,
      onSettings: () => go({ id: 'type-settings/<type>', param: key }),
      onNew: () => actions.newObjectOfType?.(key),
      onDefine: (v: string) => { returnFocus.current = document.activeElement as HTMLElement | null; pendingFocus.current = false; setDefineValue(v); setDialog('newType'); },
    };
    // D-516: the Task type's page is the Tasks page's `All tasks` view.
    body = key.normalize('NFC') === 'task'
      ? <AllTasks key={key} {...page} go={(v) => { void go(tasksRoute(v)); }}
          onShown={() => updateUi((u) => (u.tasks?.view === 'all' ? u : { ...u, tasks: { ...DEFAULT_TASKS_UI, ...(u.tasks ?? {}), view: 'all' } }))} />
      : <TypePage key={key} {...page} />;
  } else if (route?.id === 'tags' && vault) {
    body = (
      <AllTagsPage heading={heading} sort={ui.tagsSort as TagsSort | undefined} onSort={(x) => updateUi((u) => ({ ...u, tagsSort: x }))}
        onOpen={(k) => { void go({ id: 'tag/<key>', param: tagKey(k) }); }} commandRef={newTagCommand} />
    );
    if (pendingNewTag.current) { pendingNewTag.current = false; setTimeout(() => newTagCommand.current?.(), 0); }
  } else if (route?.id === 'queries' && vault) {
    body = <QueriesPage heading={heading} sort={(ui as { queries?: { sort?: QueriesSort } }).queries?.sort}
      onSort={(x) => updateUi((u) => ({ ...u, queries: { ...((u as { queries?: object }).queries ?? {}), sort: x } }))}
      onOpen={(name) => { void go({ id: 'query/<name>', param: name.normalize('NFC') }); }} />;
  } else if (route?.id === 'query/<name>' && route.param && vault) {
    const name = route.param;
    body = (
      <QueryPage key={`${name}\n${navKey}`} name={name} heading={heading} commandRef={queryCommand} statusRef={queryStatus}
        onAll={() => { void go({ id: 'queries' }); }}
        onRenamed={(n) => { if (shownRoute.current === routeString({ id: 'query/<name>', param: name })) replaceRoute({ id: 'query/<name>', param: n.normalize('NFC') }); }}
        onTrashed={() => { if (shownRoute.current !== routeString({ id: 'query/<name>', param: name })) return; if (history.current.canBack()) void step('back'); else void go({ id: 'queries' }); }} />
    );
  } else if (route?.id === 'tag/<key>' && route.param && vault) {
    const key = route.param;
    body = (
      <TagPage key={key} tagKey={key} types={types} refresh={refresh} heading={heading}
        ui={ui.tagPage as TagPageUi | undefined} onUi={(x) => updateUi((u) => ({ ...u, tagPage: { sort: x.sort, type: x.type, grouping: x.grouping } }))}
        onOpen={openNote} onTag={openTag} onAll={() => { void go({ id: 'tags' }); }}
        onRenamed={(k) => { if (shownRoute.current === routeString({ id: 'tag/<key>', param: key })) replaceRoute({ id: 'tag/<key>', param: k }); }}
        onRemoved={() => { if (shownRoute.current === routeString({ id: 'tag/<key>', param: key })) replaceRoute({ id: 'tags' }); }}
        commandRef={tagCommand} />
    );
  } else if (route?.id === 'graph/<path>' && route.param && vault) {
    // Slice G1 (v1-graph §3, §5): the full view; its state per vault (D-993).
    const vp = vault.path.normalize('NFC');
    const graphKey = routeKey;
    body = (
      <GraphPage key={navKey} path={route.param} heading={heading} commandRef={graphCommand} statusRef={graphStatus}
        handover={handover} onHandoverDepth={(d) => { if (!handover) return; const next = { ...handover, depth: d }; history.current.setGraph(next); setHandover(next); }}
        view={ui.vaults?.[vp]?.graph?.full}
        onView={(next) => updateUi((u) => ({ ...u, vaults: { ...(u.vaults ?? {}), [vp]: { ...(u.vaults?.[vp] ?? {}), graph: { ...(u.vaults?.[vp]?.graph ?? {}), full: next } } } }))}
        onViews={(f) => updateUi((u) => {
          const g = u.vaults?.[vp]?.graph ?? {};
          const next = f({ full: g.full, panel: g.panel as GraphViewStateDto | undefined });
          return { ...u, vaults: { ...(u.vaults ?? {}), [vp]: { ...(u.vaults?.[vp] ?? {}), graph: { ...g, ...next } } } };
        })}
        onTitle={(title) => setGraphTitle((g) => (g?.route === graphKey && g.title === title ? g : { route: graphKey, title }))}
        nav={{
          open: (n) => {
            if (n.node.typeKey === 'tag') { void go({ id: 'tag/<key>', param: tagKey(n.node.tagKey ?? n.node.title) }); return; }
            if (n.node.typeKey === 'daily-note' && /^\d{4}-\d{2}-\d{2}$/.test(n.node.title)) { openDay(n.node.title); return; }
            if (n.node.path) openNote(n.node.path);
          },
          centre: (path) => { void go({ id: 'graph/<path>', param: path.normalize('NFC') }); },
          replace: (path) => { if (shownRoute.current === graphKey) replaceRoute({ id: 'graph/<path>', param: path.normalize('NFC') }); },
          back: () => { void step('back'); },
        }} />
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
        onOpenTrash={() => { void go({ id: 'trash' }); }}
      />
    );
  } else if ((route?.id === 'tasks' || route?.id === 'tasks/kanban') && vault) {
    lastBoard.current = route.id;
    const tui: TasksUi = { ...DEFAULT_TASKS_UI, ...(ui.tasks ?? {}) };
    body = (
      <TasksPage
        key={route.id}
        view={route.id === 'tasks' ? 'schedule' : 'kanban'}
        refresh={refresh}
        heading={heading}
        ui={tui}
        onUi={(f) => updateUi((u) => {
          // A change to what is already stored writes nothing (FR-SYN-06 AC-42: reaching a stored view is no write).
          const was = { ...DEFAULT_TASKS_UI, ...(u.tasks ?? {}) };
          const next = f(was);
          return u.tasks && JSON.stringify(next) === JSON.stringify(was) ? u : { ...u, tasks: next };
        })}
        nav={{
          openNote: (p) => openNote(p),
          openSource: (p, task) => { void go({ id: 'note/<path>', param: p.normalize('NFC'), selectEmbedOf: task.normalize('NFC') }); },
          openDay,
        }}
        go={(v) => { void go(tasksRoute(v)); }}
        onSettings={() => go({ id: 'type-settings/<type>', param: 'task' })}
        plural={types.find((x) => x.key.normalize('NFC') === 'task')?.plural ?? t('tasks.title')}
        commandRef={taskCommand}
        commandStateRef={taskCommandState}
      />
    );
  } else if (route?.id === 'inbox' && vault) {
    body = (
      <InboxPage
        refresh={refresh}
        heading={heading}
        types={types}
        filter={ui.inbox?.filter ?? 'all'}
        onFilter={(f) => updateUi((u) => ({ ...u, inbox: { filter: f } }))}
        dateTime={ui.dateTime}
        nav={{ openNote: (p) => openNote(p), openDay, capture: (k) => actions.capture?.(k), today: () => { void go({ id: 'today' }); } }}
        commandRef={inboxCommand}
      />
    );
  } else if (route?.id === 'trash' && vault) {
    body = <TrashPage heading={heading} focus={route.param ?? null} onOpen={(p) => { void go({ id: 'note/<path>', param: p.normalize('NFC') }); }} commandRef={trashCommand} />;
  } else if (route?.id === 'broken-links') {
    body = <BrokenLinksPage heading={heading} refresh={refresh} onOpen={(s, o) => openMention(s, o)} />;
  } else if (route?.id === 'duplicate-titles') {
    body = <DuplicateTitlesPage heading={heading} refresh={refresh} types={types} onOpen={(p) => openNote(p)} mergeRef={mergeCommand} />;
  } else if (route?.id === 'help/shortcuts') {
    body = <ShortcutsPage heading={heading} commandTitle={(id) => { const c = list.find((x) => x.id === id); return c ? t(c.title, c.vars ?? {}) : null; }} />;
  } else if (route?.id === 'conflicts') {
    body = <ConflictsPage heading={heading} onCount={setConflicts} />;
  } else if (route?.id === 'search') {
    body = <SearchPage key={route.param ?? ''} refresh={refresh} heading={heading} inputRef={searchInput} onOpen={openNote}
      onCreate={(i, p) => { createFrom(i, p); }}
      onLeave={() => { if (!history.current.canBack()) return false; void step('back'); return true; }}
      tag={route.param?.startsWith('tag:') ? route.param.slice(4) : undefined}
      types={types} dateTime={ui.dateTime} initial={history.current.current()?.search} onState={(st) => history.current.setSearch(st)} />;
  } else if (route?.id.startsWith('settings/') && def) {
    body = <SettingsPage id={route.id} theme={ui.theme as ThemeChoice} heading={heading} onSection={(id) => go({ id })} onTheme={actions.setTheme}
      outlineRail={ui.outlineRail !== false} onOutlineRail={(on) => updateUi((u) => ({ ...u, outlineRail: on }))}
      vault={vault} types={types} refresh={refresh} dateTime={ui.dateTime} onDateTime={(dt) => updateUi((u) => ({ ...u, dateTime: dt }))}
      onStarter={() => actions.addStarterTypes?.()} onOpenFolder={actions.openFolder}
      commandTitle={(id) => { const c = list.find((x) => x.id === id); return c ? t(c.title, c.vars ?? {}) : null; }} />;
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

  return withImport(
    <PreviewProvider>
    <div className={`app ${focusMode ? 'focus-mode' : ''}`}>
      {!focusMode && <TitleBar switcher={{ vault, onOpenPath: openVaultPath, onOpenFolder: actions.openFolder, onCreate: () => actions.openChooser(true), onSettings: () => go({ id: 'settings/vault' }) }} name={named} icon={tabIcon} progress={progress} onToggleSidebar={actions.toggleSidebar} canBack={history.current.canBack()} canForward={history.current.canForward()} onBack={actions.back} onForward={actions.forward} />}
      <div className="frame">
        {showSidebar && (
          <Sidebar
            route={route ?? { id: 'inbox' }}
            types={typeEntries(types, counts).filter((e) => e.key !== 'task') /* D-516: the Tasks entry covers it */}
            // A click on the entry of the page shown moves the focus to its heading, as a navigation would (FR-UX-03 AC-11).
            onGo={(r) => { if (route && sameRoute(r, route)) heading.current?.focus(); else void go(r); }}
            onSearch={actions.openSearch}
            onNewObject={actions.newObject}
            onNewType={() => actions.newType?.()}
            onAbout={actions.about}
            conflicts={conflicts}
            taskCount={taskBadge}
            inboxCount={inboxCount}
            onTasks={actions.goTasks}
            onOpenPinned={(r) => { if (route && sameRoute(r, route)) heading.current?.focus(); else void go(r, { heading: true }); }}
            pinnedCollapsed={!!(ui.vaults?.[vault.path.normalize('NFC')] as { sidebar?: { pinnedCollapsed?: boolean } } | undefined)?.sidebar?.pinnedCollapsed}
            onPinnedCollapse={(c) => { const vp = vault.path.normalize('NFC'); updateUi((u) => ({ ...u, vaults: { ...(u.vaults ?? {}), [vp]: { ...(u.vaults?.[vp] ?? {}), sidebar: { ...((u.vaults?.[vp] as { sidebar?: object } | undefined)?.sidebar ?? {}), pinnedCollapsed: c } } } })); }}
          />
        )}
        <div className="centre">
          <HotkeyNotice onSettings={() => { void go({ id: 'settings/shortcuts' }); }} />
          <TrashMessages />
          {vault.placeholders > 0 && (
            <div className="banner" role="region" aria-label={t('banner.offline')}>
              {t('banner.placeholders', { count: vault.placeholders })}
            </div>
          )}
          {interrupted.map((i) => (
            <div key={i.jobId} className="banner" role="status">
              <span>{i.kind === 'import'
                ? t('job.interrupted.import', { space: i.title ?? '', done: i.done, total: i.total }) // slice I2 (§6.4): `Undo` only
                : i.kind === 'type-move'
                ? t('job.interrupted.typeMove', { title: i.title ?? i.from.split('/').pop()!.replace(/\.md$/i, ''), done: i.done, total: i.total })
                : t('job.interrupted', { old: i.from.split('/').pop()!.replace(/\.md$/i, ''), done: i.done, total: i.total })}</span>
              {i.kind !== 'import' && <button type="button" onClick={() => { void ipc.jobResolveInterrupted(i.jobId, 'finish').finally(() => setInterrupted((l) => l.filter((x) => x.jobId !== i.jobId))); }}>{t('job.finish')}</button>}
              <button type="button" onClick={() => { void ipc.jobResolveInterrupted(i.jobId, 'undo').finally(() => setInterrupted((l) => l.filter((x) => x.jobId !== i.jobId))); }}>{t('job.undo')}</button>
            </div>
          ))}
          <NotUpdatedList onOpen={(p) => openNote(p)} />
          {message && (
            <div className="banner" role="status">
              <span>{message}</span>
              <button tabIndex={0} type="button" data-command="banner.dismiss" onClick={() => setMessage(null)}>{t('banner.dismiss')}</button>
            </div>
          )}
          <main aria-label={(route?.id === 'note/<path>' || isDaily) && !noteShown ? undefined : pageName} className={route?.id === 'note/<path>' || isDaily ? 'note-main' : ''}>
            {body}
          </main>
          {/* Slice OL (FR-EDT-16): the rail, its card and the live region, on the note routes. */}
          {isObject && <OutlineEdge wanted={!focusMode && ui.outlineRail !== false} />}
        </div>
        {showPanel && <ContextPanel tab={panelTab} onTab={(tab: PanelTab) => updateUi((u) => ({ ...u, rightPanel: { ...u.rightPanel, tab } }))}
          width={panelWidth} room={panelRoom} limits={[PANEL_MIN, PANEL_MAX, PANEL_W]}
          onWidth={(w) => updateUi((u) => ({ ...u, rightPanel: { ...u.rightPanel, width: w } }))}
          backlinks={route?.param ? { path: route.param, date: isDaily ? route.param : undefined, types, refresh, onOpen: (s, o) => openMention(s, o), focusFirst: focusBacklinks } : undefined}
          graph={panelGraphProps} />}
        {offer && (
          <CreateLinkOffer req={offer} types={types} onClose={() => setOffer(null)}
            onCreated={(p) => { if (offer.stay) return; justCreated.current = p.normalize('NFC'); openNote(p); }}
            onExists={(p, title) => { setMessage(t('createLink.exists', { title })); openNote(p); }} />
        )}
      </div>
      {calendar && <Calendar selected={calendar.selected} anchor={calendar.anchor} onChoose={calendar.onChoose}
        onClose={() => { const a = calendar.anchor; setCalendar(null); if (a?.isConnected) a.focus(); }} />}
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
      {dialog === 'newType' && (
        <NewTypeDialog key={defineValue ?? ''} fromValue={defineValue ?? undefined} types={types} undefinedKeys={Object.keys(counts).filter((k) => !types.some((x) => x.key === k))} onClose={closeDialog}
          onCreated={(created) => { setDialog(null); loadTypes(); void go({ id: 'type-settings/<type>', param: created.key.normalize('NFC') }); }} />
      )}
      {draftType && (
        <TypeMenu at={draftType.at} current={route?.id === 'new/<type>' ? route.param : undefined}
          onClose={() => { setDraftType(null); noteApi.current?.placeFocus(); }}
          onChoose={(ty) => { setDraftType(null); carryTitle.current = noteApi.current?.title() ?? null; noteApi.current?.discardDraft(); void go({ id: 'new/<type>', param: ty.key }); }} />
      )}
      {dialog === 'newObject' && newPicker && (
        <NewObjectPicker types={newPicker.types} defaultKey={newPicker.defaultKey} at={newPicker.at} onClose={closeDialog}
          onChoose={(key) => { closeDialog(); newOf(key); }} />
      )}
      {dialog === 'starter' && <StarterTypesDialog onClose={closeDialog} onAdded={() => { closeDialog(); loadTypes(); }} />}
      {/* Slice Q: the query editor, the name dialogs, the `Choose a query` picker, the live region and the alert. */}
      <QueryEditorHost types={types} />
      <QueryDialogs />
      <QueryPicker />
      <QueryNotices />
    </div>
    </PreviewProvider>,
  );
}
