// Slice Q (queries.md R141; boards QueryBlock A, C, D, F, G and their Dark variants; v1-queries §4.2…§4.4): the query
// block. One `query_run` per render of a fence (D-1452), live results while its editor is open (D-1453), every state of
// R141 (loading, results, no results, broken parts, needs context, draft, not found, in the trash, unreadable,
// read-only), the List body (Backlinks chips, D-368) and the Table body (virtualized, at most 60 rows in the DOM, header
// sorts and the Columns menu writing the query file once, D-1444, AP-1294), `Show more` paging in memory (D-1443) and
// the new-object footer (D-1439). Used by the read view, the editor (`EditorUi.query`), embeds and the query page.
import { lazy, Suspense, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import { newQueryFence, referenceFence, savedName, withSavedName } from '@tegg/doc';
import { t } from '../i18n/catalog';
import { events, ipc } from '../ipc/client';
import type { BrokenDto, FilterItemDto, QueryDefDto, QueryDto, QueryResultDto, QueryRowDto, QuerySourceDto, SortDto } from '../ipc/queries';
import { buttonText, headerClick, levels, sameSort } from './sort';
import type { TypeDto, VersionDto } from '../ipc/types';
import { chipIcon, chipTypes, onChipTypes, typeNameOf } from '../links/icons';
import { chipParts } from '../links/ChipParts';
import { RefElement } from '../preview/useReference';
import { Icon, typeIconName } from '../shell/Icon';
import { usePopupPlacement } from '../shell/usePopupPlacement';
import { useViewsHandler } from '../views/actions';
import { canUseQuery, usageKey, type Usage } from '../views/usage';
import { registerUsage } from '../views/usageHook';
import { useUsageWrite } from '../views/useUsageWrite';
import { QueryWall, type BoardControl } from './board/QueryWall';
import { DisplayControls, type DisplayControlsApi } from './GroupMenu';
import { effectiveDisplay, effectiveGrouping, groupChoices, isGrouped, limitApplies, noticeKeys, ownKeys, resetLaneOrderChange, type Display } from '../views/display';
import type { WidthScope } from '../tables/widths';
import { ResultsTable } from './ResultsTable';
import { GroupedList, useGrouped, type GroupControl } from './Grouped';
import { SortPopover, sortKeyName } from './SortPopover';
import { useQueryApply } from './useQueryApply';
import { announceQuery, dismissQueryEditor, openQueryEditor, queryAlert, queryEditorOpen } from './editorHost';
import { openNameDialog } from './dialogs';
import { nowIso, queryEnv } from './env';
import { attributeOf, columnChoices, prefill, toggleColumn, UNIVERSAL } from './model';
import { queryNav } from './nav';
import { openQueryPicker } from './QueryPicker';
import { blockMounted } from './ready';
import { clearSelectedQueryBlock, setSelectedQueryBlock, type SelectedBlock } from './selection';
import { useQueryRun } from './useQueryRun';
import './block.css';

/** The editor's control of a block (contract §3.2 `QueryCtl`), absent in the read view and on the query page. */
export type BlockCtl = {
  getPos(): number | undefined;
  readonly nested: boolean;
  readonly draft: boolean;
  /** Replaces the fence's text as one transaction and one undo step (one autosave), clearing `draft`. */
  setSource(source: string): boolean;
  select(): void;
};

/** What the query page drives on its block. */
export type QueryBlockApi = {
  /** Opens the editor anchored at `anchor` (the page's `Edit query`), focus back to `returnFocus`. */
  edit: (o: { anchor: HTMLElement | null; returnFocus: HTMLElement | null; focusFilter?: number[] | null }) => void;
};

export type QueryBlockProps = {
  /** A block's fence body as written, or a saved query by name (the query page). */
  source: { kind: 'fence'; body: string } | { kind: 'saved'; name: string };
  /** The note whose body holds the fence (`this`, FR-QRY-03); null on the query page. */
  host: string | null;
  /** In the editor (contract §3.2); the fence's full source for `Choose a query…` / `Save as query…`. */
  ctl?: BlockCtl | null;
  fenceSource?: string;
  /** In the editor: the block is the selected node (the 2 px focus ring, board C). */
  selected?: boolean;
  /** In the editor: drop an unsaved draft (Esc with nothing chosen, D-1471). */
  dropDraft?: () => void;
  /** On the query page: a `this` query shows the needs-page section instead of the block (R143). */
  onPage?: boolean;
  apiRef?: MutableRefObject<QueryBlockApi | null>;
  /** The page's query as read (its title, state), when known. */
  query?: QueryDto | null;
  /** Slice Q2.1 (v1-views §16.1, §18): the usage this block is (a block in a note, the query page's defaults). */
  usage?: Usage | null;
};

const nfc = (s: string) => s.normalize('NFC');
/** `New property…` (§4.4) loads the type settings' dialog only when used (it pulls in the editor package). */
const NewPropertyDialog = lazy(() => import('../pages/TypeSettingsPage').then((m) => ({ default: m.NewPropertyDialog })));
const DRAFT_DEF = (): QueryDefDto => ({
  title: t('query.editor.untitled'), types: [], match: 'all', filters: [], sort: [{ by: 'modified', order: 'desc' }], limit: 50, view: 'list', groupBy: null, lanes: 'columns', laneOrder: null, columns: ['type', 'modified'], groupPeriod: false, doneLane: null,
});

type BlockState = 'loading' | 'ok' | 'noResults' | 'draft' | 'notFound' | 'trashed' | 'unreadable' | 'needsContext' | 'needsHost' | 'noType';

function useTypes(): TypeDto[] {
  const [types, setTypes] = useState(() => chipTypes() as TypeDto[]);
  useEffect(() => onChipTypes(() => setTypes(chipTypes() as TypeDto[])), []);
  return types;
}

/** The state R141 draws for a result. */
function stateOf(r: QueryResultDto | null, draft: boolean, loading: boolean): BlockState {
  if (draft) return 'draft';
  if (!r || (!r.indexReady && r.rows.length === 0 && r.form !== 'unreadable' && r.lookup !== 'missing' && r.lookup !== 'trashed' && r.lookup !== 'unreadable')) return 'loading';
  if (r.form === 'empty') return 'draft';
  if (r.form === 'unreadable' || r.lookup === 'unreadable') return 'unreadable';
  if (r.lookup === 'missing') return 'notFound';
  if (r.lookup === 'trashed') return 'trashed';
  if (r.state === 'noType') return 'noType';
  if (r.state === 'needsHost') return 'needsHost';
  if (r.state === 'needsContext') return 'needsContext';
  if (loading && !r) return 'loading';
  return r.total > 0 || r.rows.length > 0 ? 'ok' : 'noResults';
}

/** The notice of the first broken part (§4.5). */
export function noticeOf(b: BrokenDto, types: TypeDto[]): string {
  if (b.reason === 'noType') return t('query.block.noType', { key: b.key });
  if (b.reason === 'badValue') return t('query.block.brokenKey', { key: b.key });
  if (b.reason === 'notAttribute') return t('query.block.brokenAttr', { attribute: b.key, type: types.find((x) => nfc(x.key) === nfc(b.type ?? ''))?.name ?? typeNameOf(b.type ?? '') });
  return t('query.block.brokenFilter', { attribute: b.key });
}

/** `Links to · This note`: the needs-page example (R143), from the query's first `this` filter. */
function thisExample(def: QueryDefDto | null, types: TypeDto[]): string {
  const find = (items: FilterItemDto[]): Extract<FilterItemDto, { kind: 'filter' }> | null => {
    for (const f of items) {
      if (f.kind === 'filter' && f.value === 'this') return f;
      if (f.kind === 'group') { const g = find(f.filters); if (g) return g; }
    }
    return null;
  };
  const f = def ? find(def.filters) : null;
  const a = f ? attributeOf(types, def!.types, f.key) : null;
  const label = a ? (a.userNamed ? a.label : t(a.label)) : t('query.editor.linksTo');
  return `${label} · ${t('query.editor.thisNote')}`;
}

/** A fence's body (between its fence lines), as the core reads it (R140). */
export function fenceBody(source: string): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const open = lines[0] ?? '';
  const m = /^\s*(`{3,}|~{3,})/.exec(open);
  if (!m) return source;
  const marker = m[1];
  let end = lines.length;
  const last = lines[lines.length - 1];
  if (lines.length > 1 && new RegExp(`^\\s*${marker[0]}{${marker.length},}\\s*$`).test(last)) end = lines.length - 1;
  return lines.slice(1, end).join('\n');
}

export function QueryBlock(p: QueryBlockProps) {
  const types = useTypes();
  const draft = !!p.ctl?.draft;
  const source: QuerySourceDto | null = draft ? null : p.source.kind === 'fence' ? { kind: 'fence', body: p.source.body } : { kind: 'saved', name: p.source.name };
  const run = useQueryRun(source, p.host);
  const [live, setLive] = useState<QueryResultDto | null>(null);
  const editing = useRef(false);
  const result = live ?? run.result;
  const state = stateOf(result, draft, run.loading);
  const def = result?.def ?? (draft ? DRAFT_DEF() : null);
  const name = result?.name ?? (p.source.kind === 'saved' ? p.source.name : null);
  // R144: ⌘↩ (and `Edit query`) on a block still drawing its first rows opens the editor at once, on the reference
  // fence's `saved:` name; the editor reads the query itself (and closes when it can't, as for any missing query).
  const editName = name ?? (state === 'loading' && p.source.kind === 'fence' ? savedName(p.source.body) : null);
  const form = draft ? 'empty' : result?.form ?? (p.source.kind === 'saved' ? 'reference' : null);
  const inline = form === 'inline';
  const readOnly = result?.lookup === 'newer' || p.query?.state === 'newer';
  const title = def?.title ?? name ?? (draft ? t('query.editor.untitled') : '');
  const figure = useRef<HTMLElement | null>(null);
  const editBtn = useRef<HTMLButtonElement | null>(null);
  const [shown, setShown] = useState<number | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const columnsBtn = useRef<HTMLButtonElement | null>(null);
  const [newProp, setNewProp] = useState(false);
  const undo = useRef<{ name: string; text: string; base: VersionDto; el: HTMLElement | null } | null>(null);

  // D-1503: `query-ready` once every block of the opened note has painted its first rows.
  const ready = useRef<ReturnType<typeof blockMounted> | null>(null);
  useEffect(() => { ready.current = blockMounted(p.host ?? ''); return () => ready.current?.unmount(); }, [p.host]);
  useEffect(() => { if (state !== 'loading') ready.current?.painted(); }, [state]);

  /** Opens the editor (R142). */
  const edit = (o: { anchor?: HTMLElement | null; returnFocus?: HTMLElement | null; focusFilter?: number[] | null } = {}) => {
    if (readOnly || inline) return;
    if (!draft && (!editName || state === 'notFound' || state === 'trashed' || state === 'unreadable')) return;
    const ret = o.returnFocus ?? editBtn.current ?? figure.current;
    editing.current = true;
    // The block's own editor (anchored at the block) closes with the block; the query page's stays with its page.
    ownAnchor.current = !o.anchor || o.anchor === figure.current;
    openQueryEditor({
      name: draft ? null : editName,
      host: p.host,
      anchor: o.anchor ?? figure.current,
      returnFocus: ret,
      selectTitle: draft,
      focusFilter: o.focusFilter ?? null,
      def: draft ? DRAFT_DEF() : null,
      // Slice Q2.1 (§16.1): from a block, `On cards` and the preview are the block's own (D-1844, D-1859).
      usage: isBlockUsage && !draft ? { sort: uw.current().sort, columns: uw.current().columns, setColumns: (c) => uw.columns(c), disabled: uw.disabled } : null,
      onResult: (r) => setLive(r),
      onCommitted: ({ query, undo: before }) => {
        // The version `query_apply` wrote is the undo's base: a change outside Tegg since then is a Conflict, never
        // overwritten (NFR-REL-02, FR-SYN-03, D-1476).
        if (before !== null && query.name && query.version) undo.current = { name: query.name, text: before, base: query.version, el: ret };
        run.rerun();
        // One polite announcement per commit (FR-UX-08 AC-18): the committed query's count.
        void ipc.queryRun({ kind: 'saved', name: query.name }, p.host, queryEnv()).then((r) => announceQuery(t('query.editor.results', { count: r.total })), () => {});
      },
      onDraftCommit: async (newTitle, d) => {
        const q = await ipc.queryCreate(newTitle, d, null, true, nowIso(Date.now()));
        p.ctl?.setSource(newQueryFence(q.name));
      },
      onDraftDrop: () => p.dropDraft?.(),
      onClosed: () => { editing.current = false; setLive(null); },
    });
  };
  const editRef = useRef(edit);
  editRef.current = edit;
  const editAfterRun = useRef(false);
  useEffect(() => {
    if (!editAfterRun.current || (state !== 'ok' && state !== 'noResults')) return;
    editAfterRun.current = false;
    editRef.current();
  }, [state]);
  // The host note changed outside Tegg while this block's editor is open: the note reloads and the editor closes
  // without a commit (FR-EDT-02 AC-25).
  useEffect(() => {
    if (!p.host) return;
    const h = nfc(p.host);
    const un = events.changed((c) => {
      if (editing.current && (c.paths ?? []).some((x) => nfc(x) === h)) dismissQueryEditor();
    });
    return () => { void un.then((f) => f()).catch(() => {}); };
  }, [p.host]);
  useEffect(() => {
    if (p.apiRef) p.apiRef.current = { edit: (o) => editRef.current({ anchor: o.anchor ?? undefined, returnFocus: o.returnFocus ?? undefined, focusFilter: o.focusFilter }) };
    return () => { if (p.apiRef) p.apiRef.current = null; };
  }, [p.apiRef]);
  // A new draft opens its editor at once with the title selected (board C).
  const opened = useRef(false);
  useEffect(() => {
    if (draft && !opened.current) { opened.current = true; setTimeout(() => editRef.current(), 0); }
  }, [draft]);
  // The block leaves (or the note reloads): an editor of this block closes without a commit (FR-EDT-02 AC-25).
  const ownAnchor = useRef(true);
  useEffect(() => () => { if (editing.current && ownAnchor.current && queryEditorOpen()) dismissQueryEditor(); }, []);

  // The selected block in the editor: `Edit query` in the palette and ⌘↩ (v1-queries §4.6).
  const sel = useRef<SelectedBlock | null>(null);
  useEffect(() => {
    if (!p.selected) return;
    const b: SelectedBlock = { name: draft ? null : editName, editable: !readOnly && !inline && state !== 'unreadable', edit: () => editRef.current() };
    sel.current = b;
    setSelectedQueryBlock(b);
    return () => clearSelectedQueryBlock(b);
  }, [p.selected, editName, readOnly, inline, state, draft]);

  // ⌘Z right after a commit, while the block's `Edit query` (or the page's) still has the focus: one `query_revert`
  // with the bytes before (D-1476).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const u = undo.current;
      if (!u || !(e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'z')) return;
      const a = document.activeElement;
      if (!a || !(a === u.el || figure.current?.contains(a))) return;
      e.preventDefault();
      e.stopPropagation();
      undo.current = null;
      void (async () => {
        try {
          await ipc.queryRevert(u.name, u.base, u.text);
        } catch { queryAlert(t('query.editor.changedOutside')); }
        run.rerun();
      })();
    };
    const drop = (e: FocusEvent) => { const u = undo.current; if (u && e.target !== u.el && !figure.current?.contains(e.target as Node)) undo.current = null; };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', drop);
    return () => { window.removeEventListener('keydown', onKey, true); document.removeEventListener('focusin', drop); };
  }, []);

  /** A header sort, a Columns change, the sort popover, the lanes switch or a lane drag: one `query_apply` with only that
   *  key changed (D-1444, §4.4), each based on the version the previous one wrote (v1-views §2.2). */
  const writer = useQueryApply(name && !readOnly && !inline ? name : null, run.result, () => run.rerun());
  const apply = (patch: Partial<QueryDefDto> | ((d: QueryDefDto) => Partial<QueryDefDto> | null)) => {
    if (!name || readOnly || inline) return;
    undo.current = null;
    writer.apply(patch);
  };
  // ---- Slice Q2.1 (R194, R197): a reference block is a usage with its own sort and columns, written to its fence; the
  // query page shows and sets the defaults (the query file, as above).
  const usage = p.usage ?? null;
  const isBlockUsage = !!usage && usage.kind === 'block' && form === 'reference' && !draft;
  const isPage = usage?.kind === 'page' && form === 'reference' && !draft && !inline;
  const uw = useUsageWrite(isBlockUsage || isPage ? usage : null, run.result, { type: null, ctl: p.ctl ?? null, fenceSource: p.fenceSource ?? null, rerun: () => run.rerun(),
    apply: (patch) => apply(patch) });
  const usageRun = !live ? run.result?.usage ?? null : null;
  const effSort = def ? (isBlockUsage && !live ? uw.current().sort : (usage?.kind === 'page' ? writer.current()?.sort ?? def.sort : def.sort)) : [];
  const effColumns = def ? (isBlockUsage && !live ? uw.current().columns : def.columns) : [];
  /** Why the sort and column controls are refused (R194), else null. */
  const usageDisabled = isBlockUsage ? uw.disabled : readOnly ? t('query.block.readOnly') : null;
  const ownSort: boolean | 'broken' = usageRun ? (usageRun.broken.some((b) => b.key === 'sort') ? 'broken' : usageRun.own.sort !== null) : false;
  const ownColumns: boolean | 'broken' = usageRun ? (usageRun.broken.some((b) => b.key === 'columns') ? 'broken' : usageRun.own.columns !== null) : false;
  const uKey = isBlockUsage || usage?.kind === 'page' ? usageKey(usage!) : null;
  const sortTo = (next: SortDto[] | null) => {
    if (isBlockUsage) { undo.current = null; void uw.sort(next); return; }
    if (next) apply({ sort: next });
  };
  const columnsTo = (next: string[] | null) => {
    if (isBlockUsage) { undo.current = null; void uw.columns(next); return; }
    if (next) apply({ columns: next });
  };
  // ---- Slice Q3 (R220, §33.2, §41): display and grouping. A block's own values over the query's (written to its fence);
  // the query page shows and sets the defaults (the query file); inline fences have neither switch nor Group (D-2194 (e)).
  const hasControls = (isBlockUsage || isPage) && !!def;
  const pageDef = isPage ? (writer.current() ?? def) : null;
  const cur = uw.current();
  const fromUsage = isBlockUsage && !live && !!run.result;
  const display: Display = fromUsage ? cur.view : pageDef ? (pageDef.view === ('board' as string) ? 'wall' : pageDef.view) : result ? effectiveDisplay(result) : 'list';
  const grouping = fromUsage ? cur.group : (() => { const d = pageDef ?? def; return d?.groupBy ? { key: nfc(d.groupBy), period: !!d.groupPeriod } : null; })();
  const grouped = !!result?.group && grouping !== null && (!fromUsage || isGrouped(run.result!));
  // A grouping just written shows on `Group` before the next run draws it (the pending own value or default).
  const runGrouping = result ? effectiveGrouping(result) : null;
  const groupPending = !!grouping && (runGrouping?.key !== grouping.key || runGrouping?.period !== grouping.period);
  const lanes = fromUsage ? cur.lanes : ((pageDef ?? def)?.lanes ?? 'columns');
  const laneOrder = fromUsage ? cur.laneOrder : ((pageDef ?? def)?.laneOrder ?? null);
  const own = fromUsage ? ownKeys(run.result!) : { view: null, group: null, lanes: null, laneOrder: null, widths: null };
  const ownAttr = (v: 'own' | 'broken' | null) => (v === null ? undefined : v === 'broken' ? 'broken' : '');
  const controls = useRef<DisplayControlsApi | null>(null);
  const displayDisabled = isBlockUsage ? uw.disabled : readOnly ? t('query.block.readOnly') : null;
  const resetLaneOrder = () => { if (isBlockUsage && run.result) void uw.laneOrder(resetLaneOrderChange(run.result)); else void uw.laneOrder(null); };
  const groupWith = (c: { key: string | null; period: boolean }) => { undo.current = null; void uw.group(c.key === null ? { none: true } : { none: false, key: c.key, period: c.period }); };
  const usageInfo = useRef({ uKey, usage, ownSort, ownColumns, editable: !usageDisabled, display, grouped, own });
  usageInfo.current = { uKey, usage, ownSort, ownColumns, editable: !usageDisabled, display, grouped, own };
  useEffect(() => registerUsage(() => (usageInfo.current.uKey ? figure.current : null), () => {
    const i = usageInfo.current;
    const b = (v: 'own' | 'broken' | null) => (v === 'broken' ? 'broken' as const : v === 'own');
    return { key: i.uKey ?? '', kind: i.usage?.kind ?? 'block', name: (i.usage?.name ?? '').normalize('NFC'), ownSort: i.ownSort, ownColumns: i.ownColumns, editable: i.editable,
      display: i.display, grouped: i.grouped, ownView: b(i.own.view), ownGroup: b(i.own.group), ownLanes: b(i.own.lanes), ownLaneOrder: b(i.own.laneOrder), ownWidths: b(i.own.widths) };
  }), []);
  const [sortOpen, setSortOpen] = useState<{ add: boolean } | null>(null);
  const sortBtn = useRef<HTMLButtonElement | null>(null);
  const board = useRef<BoardControl | null>(null);

  // Show more: pages of `limit`, in memory (D-1443); `limit` applies to an ungrouped List or Table only (D-2189).
  const limit = limitApplies(display, grouped) ? Math.max(1, def?.limit ?? 50) : Math.max(1, result?.rows.length ?? 1);
  const total = result?.total ?? result?.rows.length ?? 0;
  const count = Math.min(shown ?? limit, result?.rows.length ?? 0);
  const rows = result?.rows.slice(0, count) ?? [];
  const more = Math.min(limit, (result?.rows.length ?? 0) - count);

  const broken = result?.broken ?? [];
  const firstBroken = broken[0] ?? null;
  const showResults = state === 'ok' || state === 'noResults';
  const view = display;
  // Slice Q3 (R224): a grouped wall draws its board; a wall without a valid grouping is the ungrouped wall.
  const isBoard = view === 'wall' && grouped;
  // Slice Q3 (R225, §41.5): a grouped Table or List draws the run's groups; group drags write the usage's `lane_order`
  // (the fence, or the query file on `query/<name>`); inline fences fold in memory and have no grips.
  const groupCtl = useRef<GroupControl | null>(null);
  const groupedBody = useGrouped({
    on: showResults && grouped && view !== 'wall', result, def: def ? { ...def, lanes, laneOrder } : null, foldKey: uKey,
    display: view === 'list' ? 'list' : 'table', types, grips: !inline, disabled: readOnly ? t('query.block.readOnly') : displayDisabled,
    onLaneOrder: (order) => { if (inline || readOnly) return; undo.current = null; void uw.laneOrder(order); }, controlRef: groupCtl,
  });
  const sortTitle = def ? (() => { const b = buttonText(effSort, (k) => sortKeyName(k, def.types.length === 1 ? types.find((x) => nfc(x.key) === nfc(def.types[0])) : undefined).label); return b.text + (b.more ? ` ${t('sort.more', { count: b.more })}` : ''); })() : undefined;
  // The palette (v1-views §4.7): a selected block, or the query page's block.
  useViewsHandler(!!(p.selected || p.onPage) && !!name && !inline, {
    status: () => ({
      typeKey: null, tab: null, writable: !readOnly && !!def, viewWritable: !readOnly && !!def,
      board: isBoard ? board.current?.status() ?? null : null, sortable: !!def && !usageDisabled,
      usage: isBlockUsage && !usageDisabled && run.result ? { kind: 'block' as const, ownSort: canUseQuery(run.result, 'sort'), ownColumns: canUseQuery(run.result, 'columns') } : null,
      display: hasControls ? {
        value: display, grouped, wall: display === 'wall', writable: !displayDisabled, ownView: own.view !== null, ownGroup: own.group !== null || own.lanes !== null || own.laneOrder !== null,
        laneOrder: grouped && laneOrder !== null, groupFocused: view !== 'wall' && !!groupCtl.current?.focused(), all: false,
      } : null,
    }),
    run: (id) => {
      if (id === 'sort.addLevel') { if (!usageDisabled && def) setSortOpen({ add: true }); return; }
      if (id === 'sort.useQuery') { sortTo(null); return; }
      if (id === 'columns.useQuery') { columnsTo(null); return; }
      if (hasControls && !displayDisabled) {
        switch (id) {
          case 'display.list': case 'display.table': case 'display.wall': undo.current = null; void uw.display(id.slice(8) as Display); return;
          case 'group.open': controls.current?.openGroup(); return;
          case 'group.remove': groupWith({ key: null, period: false }); return;
          case 'display.useQuery': void uw.display(null); return;
          case 'group.useQuery': void uw.group(null); return;
          case 'board.switchLanes': if (isBoard) void uw.lanes(lanes === 'rows' ? 'columns' : 'rows'); return;
          case 'board.resetLaneOrder': if (grouped && laneOrder !== null) resetLaneOrder(); return;
          case 'board.laneUp': case 'board.laneDown':
            if (view !== 'wall' && groupCtl.current?.focused()) { undo.current = null; groupCtl.current.move(id === 'board.laneUp' ? -1 : 1); return; }
            break;
          default: break;
        }
      }
      board.current?.run(id);
    },
  });
  const host = p.host;
  const foot = showResults && host && def && !inline && !readOnly ? prefill(def, host, types) : null;
  const typeName = (k: string) => types.find((x) => nfc(x.key) === nfc(k))?.name ?? typeNameOf(k);

  if (p.onPage && (state === 'needsHost' || state === 'needsContext')) {
    return (
      <section className="query-needs-page" data-query-state="needsHost">
        <span className="query-tile" aria-hidden="true"><Icon name="query" size={20} /></span>
        <h2>{t('query.needsPage')}</h2>
        <p>{t('query.needsPageBody', { example: thisExample(def, types) })}</p>
      </section>
    );
  }

  const message = (() => {
    const btn = (label: string, on: () => void, primary = false) => (
      <button type="button" tabIndex={0} className={`query-msg-button${primary ? ' primary' : ''}`} data-command="query.block.action" onClick={on}>{label}</button>
    );
    switch (state) {
      case 'noResults':
        return <p className="query-message">{t('query.block.noResults')} {!inline && !readOnly && name && btn(t('query.edit'), () => edit())}</p>;
      case 'draft':
        return (
          <p className="query-message">{t('query.block.draft')} {!draft && p.ctl && btn(t('query.block.chooseQuery'), () => chooseQuery())}</p>
        );
      case 'notFound':
        return (
          <p className="query-message">{t('query.block.notFound', { name: name ?? '' })}{' '}
            {p.ctl && btn(t('query.block.chooseQuery'), () => chooseQuery())}{' '}
            {btn(t('query.block.createIt'), () => { void createIt(); })}
          </p>
        );
      case 'trashed':
        return <p className="query-message">{t('query.block.trashed', { name: name ?? '' })} {btn(t('query.block.restore'), () => { void restore(); })}</p>;
      case 'unreadable':
        return (
          <p className="query-message">{t('query.block.unreadable', { line: result?.line ?? 1 })}{' '}
            {form !== 'inline' && form !== 'unreadable' && name && btn(t('query.block.openQuery'), () => queryNav()?.openQuery(name))}
          </p>
        );
      case 'needsContext': case 'needsHost':
        return <p className="query-message">{t('query.block.needsContext')}</p>;
      default:
        return null;
    }
  })();

  const chooseQuery = () => {
    const src = p.fenceSource;
    if (!p.ctl || !src) return;
    const anchor = figure.current?.getBoundingClientRect();
    openQueryPicker({
      at: anchor ? { left: anchor.left, top: anchor.top + 36 } : null,
      withNew: false,
      onChoose: (n) => {
        if (!n) return;
        const next = withSavedName(src, n) ?? newQueryFence(n);
        p.ctl?.setSource(next);
      },
      onCancel: () => {},
    });
  };
  const createIt = async () => {
    if (!name) return;
    try {
      await ipc.queryCreate(name, null, null, false, nowIso(Date.now()));
    } catch (e) {
      const k = (e as { kind?: string } | null)?.kind;
      queryAlert(k === 'NameTaken' ? t('query.newQuery.taken') : t('query.saveFailed'));
      return;
    }
    // D-1486: the editor opens on the block (once its result arrives), which shows the default's results.
    editAfterRun.current = true;
    run.rerun();
  };
  const restore = async () => {
    if (!name) return;
    try { await ipc.queryRestore(name); } catch { queryAlert(t('query.saveFailed')); }
    run.rerun();
  };
  const saveAs = () => {
    const src = p.fenceSource;
    const body = p.source.kind === 'fence' ? p.source.body : null;
    if (!p.ctl || !src || body === null) return;
    openNameDialog({
      kind: 'saveAs', initial: def?.title ?? '', fence: body, returnFocus: document.activeElement as HTMLElement | null,
      onCreated: (n) => { p.ctl?.setSource(referenceFence(src, n)); },
    });
  };

  const oneType = def && def.types.length === 1 ? types.find((x) => nfc(x.key) === nfc(def.types[0]!)) ?? null : null;
  const header = (
    <div className="query-header">
      <span className="query-icon" aria-hidden="true"><Icon name="query" size={14} dataIcon="query" /></span>
      <span className="query-title" data-user-content>{title}</span>
      {showResults && <span className="query-count" aria-hidden="true">{total}</span>}
      {/* D-1515: the result count also as hidden text, for the macOS tree (D-1424's way). */}
      {showResults && <span className="sr-only" data-description-text="">{t('query.editor.results', { count: total })}</span>}
      <span className="query-header-gap" />
      {inline ? (
        p.ctl && showResults && <button type="button" tabIndex={0} className="query-head-button" data-command="query.saveAs" onClick={saveAs}>{t('query.block.saveAs')}</button>
      ) : (
        <>
          {showResults && hasControls && def && (
            // Slice Q3 (R223, board G): the display switch and `Group` before the sort icon (saved-query blocks only).
            <DisplayControls display={display} grouping={grouped || groupPending ? grouping : null} groupedWall={display === 'wall' && grouped} lanes={lanes}
              choices={groupChoices(oneType, def.types)} type={oneType}
              scope={isPage ? 'default' : 'block'} disabled={displayDisabled} apiRef={controls}
              offerUseQuery={{ grouping: fromUsage && canUseQuery(run.result!, 'grouping'), display: fromUsage && canUseQuery(run.result!, 'view') }}
              onDisplay={(d) => { undo.current = null; void uw.display(d); }} onGroup={groupWith} onLanes={(l) => { undo.current = null; void uw.lanes(l); }}
              onUseQuery={(w) => { undo.current = null; void (w === 'display' ? uw.display(null) : uw.group(null)); }} />
          )}
          {showResults && def && name && (
            // R188 (board G): the sort button, an icon with the number of levels.
            <button ref={sortBtn} type="button" tabIndex={0} className="query-head-button query-sort" data-command="sort.open" aria-label={t('sort.button')}
              aria-haspopup="dialog" aria-expanded={!!sortOpen} title={sortTitle}
              aria-disabled={usageDisabled ? 'true' : undefined} aria-description={usageDisabled ?? undefined}
              onClick={() => { if (!usageDisabled) setSortOpen((o) => (o ? null : { add: false })); }}>
              <Icon name="sort" size={13} /><span className="sort-count" aria-hidden="true">{levels(effSort).length}</span>
            </button>
          )}
          {showResults && view === 'table' && (
            <button ref={columnsBtn} type="button" tabIndex={0} className="query-head-button" data-command="query.columns" aria-haspopup="menu" aria-expanded={columnsOpen}
              aria-disabled={usageDisabled ? 'true' : undefined} aria-description={usageDisabled ?? undefined}
              onClick={() => { if (!usageDisabled) setColumnsOpen((o) => !o); }}>
              <Icon name="panel" size={13} />{t('query.block.columns')}
            </button>
          )}
          {(draft || name) && state !== 'notFound' && state !== 'trashed' && state !== 'unreadable' && (
            <button ref={editBtn} type="button" tabIndex={0} className="icon-button small query-edit" data-command="query.edit" aria-label={t('query.edit')} title={t('query.edit')} aria-haspopup="dialog"
              aria-disabled={readOnly || undefined} aria-description={readOnly ? t('query.block.readOnly') : undefined}
              onClick={() => edit()}>
              <Icon name="pencil" size={14} />
            </button>
          )}
        </>
      )}
    </div>
  );

  const typeOf = (k: string) => types.find((x) => nfc(x.key) === nfc(k));
  const openRow = (path: string) => queryNav()?.openNote(path);
  const body = (() => {
    if (state === 'loading') {
      // The run failed (no core answered): the fence's text, so nothing written is lost from view (FR-EDT-02 AC-12).
      if (run.error && p.source.kind === 'fence') return <pre className="query-source" data-user-content>{p.source.body}</pre>;
      return <div className="query-skeleton" aria-hidden="true"><span /><span /><span /></div>;
    }
    if (state !== 'ok') return null;
    if (view === 'wall' && result && def) {
      // Slice Q3 (§33.2): a lane drag, `Switch lanes` and `Reset lane order` write the usage (the fence, the query file).
      const wallApply = (patch: Partial<QueryDefDto>) => {
        if (inline) return;
        undo.current = null;
        if (patch.lanes !== undefined) void uw.lanes(patch.lanes);
        if (patch.laneOrder !== undefined) { if (patch.laneOrder === null) resetLaneOrder(); else void uw.laneOrder(patch.laneOrder); }
      };
      const wallDef = { ...def, view: 'wall' as const, lanes, laneOrder };
      return <QueryWall result={{ ...result, group: isBoard ? result.group : null, def: wallDef }} name={name} title={title}
        readOnly={readOnly ? t('query.block.readOnly') : inline ? null : displayDisabled} types={types}
        apply={inline ? (patch) => apply(patch) : wallApply} rerun={() => run.rerun()} controlRef={board} foldKey={uKey} />;
    }
    if (view === 'table' && def) {
      const widthScope: WidthScope | null = isBlockUsage && !live && uKey ? { kind: 'usage', key: uKey, own: run.result?.usage?.own.widths ?? null, order: effColumns, write: (next) => { undo.current = null; return uw.widths(next); }, disabled: uw.disabled }
        : isPage && uKey ? { kind: 'page', key: uKey } : null;
      return <ResultsTable def={def} rows={rows} types={types} typeOf={typeOf} typeName={typeName} title={title} onOpen={openRow}
        name={inline ? null : name} readOnly={usageDisabled} plain sort={effSort} columns={effColumns} widthKey={uKey} widthScope={widthScope}
        onSort={(by, shift) => {
          // D-1784: a click makes the column the only level (a click on the only level flips it); ⇧-click adds or flips.
          if (isBlockUsage) { const cur = uw.current().sort; sortTo(headerClick(cur, by, shift)); return; }
          apply((d) => { const next = headerClick(d.sort, by, shift); return sameSort(next, d.sort) ? null : { sort: next }; });
        }}
        onColumns={(columns) => columnsTo(columns)} grouped={grouped ? groupedBody : null} />;
    }
    if (grouped && def) return <GroupedList grouped={groupedBody} title={title} />;
    return (
      <ul className="query-list" aria-label={title}>
        {rows.map((r) => <li key={r.path}><ResultChip row={r} onOpen={openRow} /></li>)}
      </ul>
    );
  })();

  const label = t('query.block.label', { title });
  return (
    <figure ref={figure as MutableRefObject<HTMLElement | null>} className={`query-block-frame${p.selected ? ' selected' : ''}`} aria-label={label}
      aria-description={showResults ? t('query.editor.results', { count: total }) : undefined}
      data-query-block="" data-query-form={form ?? undefined} data-query-name={name ?? undefined} data-query-state={state}
      data-query-broken={showResults && broken.length ? String(broken.length) : undefined} data-query-readonly={readOnly ? '' : undefined}
      data-usage-key={uKey ?? undefined} data-usage-kind={uKey ? usage!.kind : undefined}
      data-own-sort={uKey && ownSort ? (ownSort === 'broken' ? 'broken' : '') : undefined}
      data-own-columns={uKey && ownColumns ? (ownColumns === 'broken' ? 'broken' : '') : undefined}
      data-display={hasControls || def ? display : undefined} data-group={grouped && grouping ? grouping.key : undefined} data-group-period={grouped && grouping?.period ? '' : undefined}
      data-own-view={ownAttr(own.view)} data-own-group={ownAttr(own.group)} data-own-lanes={ownAttr(own.lanes)} data-own-lane-order={ownAttr(own.laneOrder)} data-own-widths={ownAttr(own.widths)}
      onKeyDown={(e) => {
        // ⌘↩ with the focus in the block (its `Edit query`, a result) opens the editor (R144).
        if (e.key === 'Enter' && e.metaKey && !e.shiftKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); edit(); }
      }}>
      {header}
      {showResults && firstBroken && (
        <p className="query-notice">
          <Icon name="warning" size={13} />{noticeOf(firstBroken, types)}{' '}
          {firstBroken.reason !== 'noType' && firstBroken.reason !== 'badValue' && !inline && !readOnly && name && (
            <button type="button" tabIndex={0} className="text-button" data-command="query.edit" onClick={() => edit({ focusFilter: firstBroken.at })}>{t('query.block.fixFilter')}</button>
          )}
        </p>
      )}
      {showResults && usageRun && run.result && noticeKeys(run.result).map((k) => (
        <p key={`usage-${k}`} className="query-notice" data-usage-broken={k}><Icon name="warning" size={13} />{t('query.block.brokenKey', { key: k })}</p>
      ))}
      {state === 'noType' && firstBroken && <p className="query-notice"><Icon name="warning" size={13} />{noticeOf(firstBroken, types)}</p>}
      {message}
      {state === 'unreadable' && form === 'unreadable' && p.source.kind === 'fence' && <pre className="query-source" data-user-content>{p.source.body}</pre>}
      {body}
      {state === 'ok' && more > 0 && !isBoard && (
        <button type="button" tabIndex={0} className="query-more" data-command="query.showMore" onClick={() => setShown(count + limit)}>
          {t('query.block.showMore', { count: more, total })}
        </button>
      )}
      {foot && (
        <div className="query-foot">
          <button type="button" tabIndex={0} className="query-new" data-command="query.newObject" aria-description={foot.values.some(([k]) => k === 'source') ? t('query.block.linksHere') : undefined}
            onClick={() => queryNav()?.openNew(foot.type, foot.values)}>
            <Icon name="plus" size={13} />{t('query.block.newObject', { type: typeName(foot.type) })}
          </button>
          {foot.values.some(([k]) => k === 'source') && <span className="query-foot-hint" aria-hidden="true">{t('query.block.linksHere')}</span>}
        </div>
      )}
      {sortOpen && def && (
        <SortPopover sort={effSort} type={def.types.length === 1 ? typeOf(def.types[0]) : undefined} anchor={sortBtn.current}
          addOnOpen={sortOpen.add} disabled={usageDisabled}
          scope={isBlockUsage ? 'block' : usage?.kind === 'page' ? 'default' : undefined}
          onUseQuery={isBlockUsage && run.result && canUseQuery(run.result, 'sort') ? () => sortTo(null) : null}
          onChange={(sort) => sortTo(sort)}
          onClose={() => { setSortOpen(null); sortBtn.current?.focus(); }} />
      )}
      {columnsOpen && def && (
        <ColumnsMenu def={def} types={types} anchor={columnsBtn.current} columns={effColumns} disabled={usageDisabled}
          scope={isBlockUsage ? 'block' : usage?.kind === 'page' ? 'default' : undefined}
          onUseQuery={isBlockUsage && run.result && canUseQuery(run.result, 'columns') ? () => columnsTo(null) : null}
          onToggle={(key, on) => {
            if (isBlockUsage) { columnsTo(toggleColumn({ ...def, columns: uw.current().columns }, key, on)); return; }
            void apply((d) => ({ columns: toggleColumn(d, key, on) }));
          }}
          onNewProperty={() => { setColumnsOpen(false); setNewProp(true); }}
          onClose={() => { setColumnsOpen(false); columnsBtn.current?.focus(); }} />
      )}
      {newProp && def && def.types.length === 1 && typeOf(def.types[0]) && (
        <Suspense fallback={null}><NewPropertyDialog type={typeOf(def.types[0])!} types={types} attributeOnly
          onClose={() => { setNewProp(false); columnsBtn.current?.focus(); }}
          onDone={(added) => {
            setNewProp(false);
            // R197: the type file (the attribute), then the usage's columns (a second write).
            if (!added) return;
            const k = nfc(added.key);
            if (isBlockUsage) { const cur = uw.current().columns; if (!cur.some((c) => nfc(c) === k)) columnsTo([...cur, k]); return; }
            void apply((d) => (d.columns.some((c) => nfc(c) === k) ? null : { columns: [...d.columns, k] }));
          }} /></Suspense>
      )}
    </figure>
  );
}

/** A List row: the object's link chip exactly as in the Backlinks panel (D-368): type icon, title and, for a Task, its
 *  due date and status after a divider. */
export function ResultChip({ row, onOpen }: { row: QueryRowDto; onOpen: (path: string) => void }) {
  const icon = chipIcon(row.type);
  const parts = chipParts({ kind: 'note', type: row.type, review: (row.values.review as string | undefined) ?? null, status: row.task?.status ?? null, due: row.task?.due ?? null, completed: (row.values.completed as string | undefined) ?? null });
  return (
    <RefElement as="a" href="#" tabIndex={0} className="chip link-chip kind-note" data-link-kind="note" data-query-result={nfc(row.path)} data-path={nfc(row.path)}
      data-title={row.title} data-icon={icon.def} title={row.title} aria-label={row.title} aria-description={parts.description ?? undefined} {...parts.attrs}
      reference={{ target: { path: nfc(row.path), fragment: null, kind: 'note' }, kind: 'chip', open: () => onOpen(row.path) }}
      onClick={(e: React.MouseEvent) => e.preventDefault()}>
      {parts.icon ?? <Icon name={icon.glyph} dataIcon={icon.def} size={13} />}
      <span className="chip-text"><span data-user-content>{row.title}</span>{parts.suffix}</span>
    </RefElement>
  );
}

/** The block's Columns menu (board F, G; R130's rows for one type, the universal rows plus Type when mixed, AP-1294):
 *  Title checked and disabled, the choices checked when shown, then `New property…` (one type, not Tag). Each change
 *  writes `columns:` once. Arrow keys move (disabled items too), Space / ⏎ toggle, Esc closes. Slice Q2.1: the scope
 *  line first (R197, §19.1), `Use the query's columns` last when offered (D-1856), placed inside the window in a body
 *  portal (§20). `columns` are the shown (effective) columns; `disabled` refuses every change with its reason (R194). */
export function ColumnsMenu({ def, types, anchor, onToggle, onNewProperty, onClose, columns, scope, onUseQuery, disabled }: {
  def: QueryDefDto; types: TypeDto[]; anchor: HTMLElement | null; onToggle: (key: string, on: boolean) => void; onNewProperty: () => void; onClose: () => void;
  columns?: string[]; scope?: 'tab' | 'block' | 'default'; onUseQuery?: (() => void) | null; disabled?: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const style = usePopupPlacement(ref, anchor, 'menu');
  const one = def.types.length === 1 ? types.find((x) => nfc(x.key) === nfc(def.types[0])) : undefined;
  const mixed = def.types.length !== 1;
  const shownCols = new Set((columns ?? def.columns).map(nfc));
  const choices = columnChoices(def, types).filter((k) => k !== 'title');
  const labelOf = (k: string): { label: string; user: boolean } => {
    if (k === 'type') return { label: t('ts.type'), user: false };
    const a = one?.attributes.find((x) => nfc(x.key) === k);
    if (a) return { label: a.name, user: true };
    if (k === 'modified') return { label: t('typePage.modified'), user: false };
    return { label: t(UNIVERSAL.find((u) => u.key === k)?.label ?? k), user: false };
  };
  const items = () => [...(ref.current?.querySelectorAll<HTMLElement>('[data-menu-item]') ?? [])];
  useEffect(() => {
    items()[0]?.focus({ preventScroll: true });
    const outside = (e: MouseEvent) => {
      const tg = e.target as HTMLElement;
      if (ref.current?.contains(tg) || anchor?.contains(tg) || tg.closest?.('[role="dialog"].type-dialog, [role="listbox"]')) return;
      onClose();
    };
    document.addEventListener('mousedown', outside, true);
    return () => document.removeEventListener('mousedown', outside, true);
  }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.length) list[e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length].focus();
    } else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); list[e.key === 'Home' ? 0 : list.length - 1]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    else if (e.key === 'Tab') e.preventDefault();
    e.stopPropagation();
  };
  const check = (on: boolean) => <span className="menu-check" aria-hidden="true">{on && <Icon name="check" size={14} />}</span>;
  // Each checkbox item also carries a `menuitem` part, so lists of a menu's items name every row (its role is
  // presentational inside the checkbox item for assistive technology).
  const item = (key: string, label: string, user: boolean, on: boolean, off: boolean, choose: () => void, description?: string) => (
    <div key={key} role="menuitemcheckbox" aria-checked={on} aria-disabled={off || undefined} aria-label={label} tabIndex={-1} data-menu-item=""
      aria-description={description}
      className={`menu-item${on ? ' checked' : ''}`}
      onClick={() => { if (!off) choose(); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!off) choose(); } }}>
      {check(on)}<span role="menuitem" className="menu-title" data-user-content={user ? '' : undefined}>{label}</span>
    </div>
  );
  const plainItem = (key: string, label: string, choose: () => void, command?: string) => (
    <div key={key} role="menuitem" tabIndex={-1} data-menu-item="" className="menu-item" aria-label={label} data-command={command}
      aria-disabled={disabled ? 'true' : undefined} aria-description={disabled ?? undefined}
      onClick={() => { if (!disabled) choose(); }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!disabled) choose(); } }}>
      <span className="menu-check" aria-hidden="true" /><span className="menu-title">{label}</span>
    </div>
  );
  return createPortal(
    <div ref={ref} className="popup-menu query-columns-menu" role="menu" aria-label={t('query.block.columns')} onKeyDown={onKeyDown}
      data-popup="columns" style={style} aria-describedby={scope ? 'columns-scope-line' : undefined}
      onMouseDown={(e) => e.stopPropagation()}>
      {scope && <div id="columns-scope-line" className="menu-scope" role="presentation" data-scope={scope}>{t(`columns.scope.${scope}`)}</div>}
      {item('title', t('typePage.title'), false, true, true, () => {})}
      {choices.map((k) => { const l = labelOf(k); const on = shownCols.has(k); return item(k, l.label, l.user, on, !!disabled, () => onToggle(k, !on), disabled ?? undefined); })}
      {mixed && <div className="menu-note"><span className="muted-text">{t('query.columns.mixed')}</span></div>}
      {!mixed && one && one.key !== 'tag' && (
        <>
          <div role="separator" className="menu-sep" />
          {plainItem('new', t('typePage.newProperty'), onNewProperty)}
        </>
      )}
      {onUseQuery && (
        <>
          <div role="separator" className="menu-sep" />
          {plainItem('useQuery', t('columns.useQuery'), () => { onUseQuery(); onClose(); }, 'columns.useQuery')}
        </>
      )}
    </div>,
    document.body,
  );
}
