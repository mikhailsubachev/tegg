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
import { commands, type Command, type ShellActions, type ShellContext, type ThemeChoice } from './shell/commands';
import { ContextPanel, Sidebar, TitleBar } from './shell/Frame';
import { routeIcon, typeIconName } from './shell/Icon';
import { eventKeys } from './shell/keys';
import { createHistory } from './shell/history';
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
import { resetJobs, showList, startJobs, undoLast } from './jobs/jobs';
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
import { setDateTimeSetting } from './i18n/dates';
import { HotkeyNotice } from './pages/HotkeyNotice';
import { useInboxCount } from './inbox/useInboxCount';
import { setSourceHandler } from './tasks/sourceNav';
import type { InterruptedDto } from './ipc/types';
import { TagPage } from './tags/TagPage';
import { AllTagsPage } from './tags/AllTagsPage';
import { refreshTags, tagOfFile, useTags } from './tags/store';
import { tagKey } from './tags/keys';
import type { TagPageUi, TagsSort } from './tags/model';

const DAILY = 'daily/YYYY-MM-DD';
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

type Dialog = 'palette' | 'newType' | 'starter' | null;
type PanelTab = 'backlinks' | 'outline' | 'graph';

/** 3D (ms3-shell §14.7.1): `typeSort` and `otherPropertiesOpen`; missing fields read as defaults, `version` stays 1. */
type UiState = UiStateDto & { typeSort?: Record<string, TypeSort>; otherPropertiesOpen?: boolean; noteWidth?: Record<string, PageWidth> };
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
  /** D-520 (ms5-tasks §12.2): the unsaved new object shown on `new/<type>` (`route`: its route string). */
  const [draft, setDraft] = useState<{ route: string; path: string; info: DraftInfo } | null>(null);
  /** FR-VLT-05 AC-4: the `Type` menu of an unwritten draft, and the title it carries to the new type. */
  const [draftType, setDraftType] = useState<{ at: { left: number; top: number } } | null>(null);
  const carryTitle = useRef<string | null>(null);
  const tagCommand = useRef<((id: string) => void) | null>(null);
  const newTagCommand = useRef<(() => void) | null>(null);
  const mergeCommand = useRef<(() => void) | null>(null);
  const pendingNewTag = useRef(false);
  /** D-520: New Task lands on the Tasks page with the caret in the quick-add row. */
  const focusQuickAdd = useRef(false);
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
  useEffect(() => { setOfferHandler((r) => setOffer(r)); return () => setOfferHandler(null); }, []);
  useEffect(() => { setChipTypes(types); }, [types]);
  const [refresh, setRefresh] = useState(0);
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
  const heading = useRef<HTMLHeadingElement | null>(null);
  const searchInput = useRef<HTMLInputElement | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const pendingFocus = useRef(false);
  const pendingReturn = useRef<HTMLElement | null>(null);
  const uiLoaded = useRef(false);
  // 5A-1: the Tasks page's command handler (R45) and the last task view (D-481).
  const taskCommand = useRef<((id: string) => void) | null>(null);
  const inboxCommand = useRef<((id: string) => void) | null>(null);
  const trashCommand = useRef<((id: 'restore' | 'delete') => void) | null>(null);
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
    const forced = (window as { __TEGG_ROUTE__?: string | null }).__TEGG_ROUTE__;
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
    setInterrupted(v.interrupted ?? []); // D-387: renames a crash interrupted, from the vault info (no extra call)
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

  // 4C (ms4-jobs §2.2, §10): job progress and the worker bridge for the whole session.
  useEffect(() => { startJobs(); return startBridge(); }, []);
  useEffect(() => {
    // A result after the cleanup is dropped: StrictMode runs this effect twice, and two `opened` calls would load the
    // landing page twice (NFR-PERF-05 AC-3: one link_resolve, one note_read).
    let live = true;
    ipc.vaultCurrent().then((v) => { if (live) (v ? opened(v) : setVault(null)); }, () => { if (live) setVault(null); });
    const un = [
      // The end of indexing changes what every page reads (a page opened while it ran saw part of the vault), but the
      // core sends no `vault:changed` for it: pages read again as after a change (bug v0.70, tag page; FR-UX-07).
      events.progress((p) => { setProgress(p); if (p.state === 'done') setRefresh((n) => n + 1); }),
      events.changed(() => { setRefresh((n) => n + 1); }),
      // 5B (ms5-capture §1.4, §2.2): `Settings…` in the status menu and the Saved panel's `Open`.
      events.shellRoute((r) => { const parsed = parseRoute(r); if (parsed) void goRef.current?.(parsed); }),
    ];
    return () => { live = false; un.forEach((p) => p.then((f) => f())); };
  }, []);

  useEffect(() => {
    if (vault) loadTypes();
  }, [refresh]);
  useEffect(() => {
    if (!vault) return;
    let live = true;
    ipc.vaultSettings().then((v) => { if (live) setVaultWidth(pageWidthOf(v.pageWidth)); }, () => {});
    return () => { live = false; };
  }, [vault?.path, refresh]);
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
    const mark = () => ipc.perfMark('ui-ready').catch(() => {});
    requestAnimationFrame(() => setTimeout(mark, 0));
    const fallback = setTimeout(mark, 250);
    return () => clearTimeout(fallback);
  }, [vault === undefined]);

  // ------------------------------------------------------------------ navigation
  /** D-760: a `Go to` jump from Search replaces the Search entry, so Back leaves it out as the ⌘O switcher did (FR-NAV-03). */
  const jumpFrom = useRef<string | null>(null);
  const go = useCallback(async (r0: Route, o: { keepDialog?: boolean } = {}) => {
    const r = r0.id === 'today' ? todayRoute() : r0;
    await flushNote();
    setChooser(null);
    if (!o.keepDialog) setDialog(null);
    setFocusMode(false);
    pendingReturn.current = null; // navigation moves the focus to the new page, not back (D-130)
    pendingFocus.current = true;
    history.current.saveScroll(centreScroll());
    if (jumpFrom.current !== null && jumpFrom.current === shownRoute.current) history.current.replace(r);
    else history.current.push(r);
    jumpFrom.current = null;
    setHistTick((n) => n + 1);
    setNavKey((n) => n + 1);
    justCreated.current = settleCreated(justCreated.current, r); // D-367: a marker of a route not landed on goes
    setRoute(r);
  }, []);
  const goRef = useRef(go);
  goRef.current = go;
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
    justCreated.current = settleCreated(justCreated.current, e.route);
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
  /** A create path that lands on today's Daily Note (D-318, D-353): the caret goes into its body (D-367). */
  const createToday = useCallback(() => { const r = todayRoute(); justCreated.current = createdMarker(r); void go(r); }, [go]);
  // 6A (R74, FR-HIS-01 AC-11): a link to a trashed object opens the Trash with its row focused.
  const openNote = useCallback((path: string, fragment?: string, keepDialog = false) => {
    if (path.startsWith('.trash/')) { void go({ id: 'trash', param: path.normalize('NFC') }, { keepDialog }); return; }
    void go({ id: 'note/<path>', param: path.normalize('NFC'), ...(fragment ? { fragment } : {}) }, { keepDialog });
  }, [go]);
  const openDay = useCallback((date: string) => { void go({ id: DAILY, param: date }); }, [go]);
  useEffect(() => { setDateHandler(openDay); return () => setDateHandler(null); }, [openDay]);
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

  /** D-520: where `New <Name>` goes: today's Daily Note, the Tasks quick-add row, or an unsaved draft. */
  const newOf = useCallback((key0: string) => {
    const key = key0.normalize('NFC');
    if (key === 'daily-note') { createToday(); return; }
    if (key === 'task') {
      focusQuickAdd.current = true;
      void go({ id: lastBoard.current ?? (uiRef.current?.tasks?.view === 'kanban' ? 'tasks/kanban' : 'tasks') }).then(() => setTimeout(() => {
        // Already on that view: no new route to focus, so focus the row here.
        const quick = focusQuickAdd.current ? document.querySelector<HTMLInputElement>('main [data-quick-add] input') : null;
        if (quick) { focusQuickAdd.current = false; quick.focus({ preventScroll: true }); }
      }, 100));
      return;
    }
    void go({ id: 'new/<type>', param: key });
  }, [go, createToday]);

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
      setDraft({ route: at, path: `${p.folder ? `${p.folder}/` : ''}${t('newObject.untitled')}.md`, info: { text: p.render(carried, stamp), stamp, onCreate } });
    }, () => setMessage(t('error.io')));
    return () => { live = false; };
  }, [routeKey, navKey]);

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
  const taskBadge = useTaskBadge(refresh, !!vault);
  const inboxCount = useInboxCount(refresh, !!vault);
  const tagList = useTags();
  // D-692: every way of opening a Tag object opens its tag page.
  useEffect(() => {
    if (route?.id !== 'note/<path>' || !route.param) return;
    const k = tagOfFile(route.param);
    if (k) replaceRoute({ id: 'tag/<key>', param: k });
  }, [routeKey, tagList]);
  useEffect(() => { if (vault) void refreshTags(); }, [vault?.path, refresh]);
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
    // D-520: New object opens an unsaved object of the vault's default type (D-131); a Daily Note opens today's
    // (D-353), a Task the quick-add row.
    newObject: () => {
      void ipc.switcher('?', 0).then((items) => items.find((i) => i.kind === 'create')?.type ?? null, () => null).then((key) => newOf(key ?? 'page'));
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
    showNotUpdated: () => showList(true),
    showBacklinks: () => {
      if (!isNoteRoute(route)) return;
      updateUi((u) => ({ ...u, rightPanel: { ...u.rightPanel, open: true, tab: 'backlinks' } }));
      setFocusBacklinks((n) => n + 1);
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
    edit: (a) => { if (isNoteRoute(route)) noteApi.current?.edit(a); },
    convertBlocked: () => (!isNoteRoute(route) ? null : noteApi.current ? noteApi.current.convertBlocked() : t('convert.readOnly')),
  }), [go, step, route?.id, route?.param, updateUi, noteDaily]);

  // D-562: a note route carries its object's type, so the review commands follow its Review row.
  setDateTimeSetting(ui.dateTime);
  const ctxRoute = route?.id === DAILY ? { ...route, date: route.param } : route?.id === 'note/<path>' ? { ...route, path: route.param ?? null, type: meta?.type, review: meta?.review, hasFrontmatter: meta?.hasFrontmatter } : route;
  const ctx: ShellContext = { vault: vault ?? null, types, counts, actions, route: ctxRoute ?? null };
  const list = useMemo(() => commands(ctx), [types, counts, vault, actions, routeKey, !!noteDaily, meta?.type, meta?.review, meta?.hasFrontmatter]);
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
    // A command that moved the focus itself (a mindmap's Map / List, D-776) keeps it; otherwise it goes back.
    const now = document.activeElement;
    if (now && now !== document.body && now.isConnected) return;
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
      // ⌥⌘← / ⌥⌘→ leave an open `@` / `[[` list alone (FR-DLY-03 AC-2).
      if ((s.command === 'daily.previous' || s.command === 'daily.next') && document.querySelector('[role="listbox"]')) return;
      // Editor commands the editor already handled (⌘Z in the text) don't run twice.
      if (s.command.startsWith('edit.') && e.defaultPrevented) return;
      // 6A (FR-HIS-01 AC-1): in text (the editor, a field) ⌘⌫ keeps deleting to the line start.
      if (s.command === 'object.trash' && el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
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
    route?.id === DAILY ? (route.param ?? '')
      : route?.id === 'note/<path>' ? (meta?.title ?? (route.param ?? '').split('/').pop()!.replace(/\.md$/, ''))
      : route?.id === 'type/<type>' ? (typeEntry?.plural ?? route.param ?? '')
      : route?.id === 'tag/<key>' ? `#${tagList.find((x) => x.key === route.param)?.name ?? route.param ?? ''}`
        // FR-VLT-05 AC-4: an unwritten draft's tab names its type (`New Nápad`).
        : route?.id === 'new/<type>' && route.param ? t('cmd.newOfType', { name: types.find((x) => x.key === route.param?.normalize('NFC'))?.name ?? route.param })
        : def ? t(def.name) : '';
  const userNamed = route?.id === 'note/<path>' || route?.id === 'type/<type>' || route?.id === DAILY || route?.id === 'tag/<key>';

  // Focus moves to the new page's heading after navigation (D-130); `route-ready:` marks for Appium (§1).
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
        const quick = focusQuickAdd.current ? document.querySelector<HTMLInputElement>('main [data-quick-add] input') : null;
        if (quick) { focusQuickAdd.current = false; quick.focus({ preventScroll: true }); } // D-520: New Task
        else if ((isNote || route.id === DAILY) && noteApi.current) { if (route.param === justCreated.current || `daily:${route.param}` === justCreated.current) justCreated.current = null; noteApi.current.placeFocus(); }
        // Search starts in its field (owner feedback F3, docs/feedback/ms3-3d.md); other pages focus the heading.
        else if (route.id === 'search' && searchInput.current) searchInput.current.focus({ preventScroll: true });
        // A page that already put the focus on one of its items (the Inbox card one came back to, D-457) keeps it.
        else if (!(document.activeElement && document.activeElement !== h && document.querySelector('main')?.contains(document.activeElement) && document.activeElement.closest('[data-path]'))) h!.focus({ preventScroll: true });
      }
      if (pendingScroll.current !== null && route.id !== 'note/<path>' && route.id !== DAILY) {
        const m = document.querySelector('main');
        if (m) m.scrollTop = pendingScroll.current;
        pendingScroll.current = null;
      }
      // The Tasks page marks itself once its cards have painted (FR-TSK-04 AC-14).
      if (route.id !== 'tasks' && route.id !== 'tasks/kanban') void ipc.perfMark(`route-ready:${routeKey}`).catch(() => {});
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
        onUi={(f) => updateUi((u) => ({ ...u, tasks: f({ ...DEFAULT_TASKS_UI, ...(u.tasks ?? {}) }) }))}
        nav={{
          openNote: (p) => openNote(p),
          openSource: (p, task) => { void go({ id: 'note/<path>', param: p.normalize('NFC'), selectEmbedOf: task.normalize('NFC') }); },
          openDay,
        }}
        go={(v) => { void go(tasksRoute(v)); }}
        onSettings={() => go({ id: 'type-settings/<type>', param: 'task' })}
        commandRef={taskCommand}
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
      onGoTo={(p) => { jumpFrom.current = shownRoute.current; openNote(p); }}
      onCreate={(i, p) => { jumpFrom.current = shownRoute.current; createFrom(i, p); }}
      onLeave={() => { if (!history.current.canBack()) return false; void step('back'); return true; }}
      tag={route.param?.startsWith('tag:') ? route.param.slice(4) : undefined} />;
  } else if (route?.id.startsWith('settings/') && def) {
    body = <SettingsPage id={route.id} theme={ui.theme as ThemeChoice} heading={heading} onSection={(id) => go({ id })} onTheme={actions.setTheme}
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

  return (
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
              <span>{t('job.interrupted', { old: i.from.split('/').pop()!.replace(/\.md$/i, ''), done: i.done, total: i.total })}</span>
              <button type="button" onClick={() => { void ipc.jobResolveInterrupted(i.jobId, 'finish').finally(() => setInterrupted((l) => l.filter((x) => x.jobId !== i.jobId))); }}>{t('job.finish')}</button>
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
        </div>
        {showPanel && <ContextPanel tab={ui.rightPanel.tab} onTab={(tab: PanelTab) => updateUi((u) => ({ ...u, rightPanel: { ...u.rightPanel, tab } }))}
          width={panelWidth} room={panelRoom} limits={[PANEL_MIN, PANEL_MAX, PANEL_W]}
          onWidth={(w) => updateUi((u) => ({ ...u, rightPanel: { ...u.rightPanel, width: w } }))}
          backlinks={route?.param ? { path: route.param, date: isDaily ? route.param : undefined, types, refresh, onOpen: (s, o) => openMention(s, o), focusFirst: focusBacklinks } : undefined} />}
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
      {dialog === 'starter' && <StarterTypesDialog onClose={closeDialog} onAdded={() => { closeDialog(); loadTypes(); }} />}
    </div>
  );
}
