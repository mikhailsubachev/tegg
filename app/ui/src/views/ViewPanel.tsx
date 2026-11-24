// Slice Q2: a view tab's toolbar and body (docs/contracts/v1-views.md §4.2 `ViewPanel.tsx`, §4.3, §4.4; R186…R188;
// boards Views A, D1, D2, E). One `query_run` of the saved query per open and per live change; the state texts of R141
// (in the trash with `Restore`, not found with `Remove from <plural> page`, unreadable, read-only); the types-changed
// notice (D-1763); the Table, List or Board; the toolbar `Filter <plural>…`, `Filter by tag` (narrowing only, kept per
// tab while the page is open, D-1796), the sort button (R188), `Columns` (Table) or the `Lanes` radiogroup (Board) and
// `View actions`. Viewing writes nothing; sort, columns, lanes, lane order and card moves write their one file.
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { t, catalogLocale } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import type { QueryDefDto, QueryResultDto, QueryRowDto, SortDto } from '../ipc/queries';
import type { TypeDto, TypeRowDto } from '../ipc/types';
import { collator } from '../i18n/collate';
import { sortTypeRows } from './allSort';
import { Icon } from '../shell/Icon';
import { TagFilterControl } from './TagFilterControl';
import { keepRow } from './tagFilter';
import { QueryWall, type BoardControl } from '../queries/board/QueryWall';
import { DisplayControls, type DisplayControlsApi } from '../queries/GroupMenu';
import { effectiveDisplay, effectiveGrouping, groupChoices, isGrouped, limitApplies, noticeKeys, ownKeys, resetLaneOrderChange, type Display } from './display';
import { ColumnsMenu, ResultChip, noticeOf } from '../queries/QueryBlock';
import { ResultsTable } from '../queries/ResultsTable';
import { GroupedList, useGrouped, type GroupControl } from '../queries/Grouped';
import { SortPopover, sortKeyName } from '../queries/SortPopover';
import { buttonText, headerClick, sameSort } from '../queries/sort';
import { queryAlert } from '../queries/editorHost';
import { queryNav } from '../queries/nav';
import { refreshQueries } from '../queries/store';
import { toggleColumn } from '../queries/model';
import { useQueryApply } from '../queries/useQueryApply';
import { useQueryRun } from '../queries/useQueryRun';
import { columnsRequest } from '../types/columns';
import { resetWidths, type WidthScope } from '../tables/widths';
import { canUseQuery, usageKey, type Usage } from './usage';
import { registerUsage } from './usageHook';
import { useUsageWrite, type TypePatch } from './useUsageWrite';
import { NewPropertyDialog } from '../pages/TypeSettingsPage';
import type { ViewsStatus } from '../shell/commands';
import { useRowsReady } from './marks';

const nfc = (s: string) => s.normalize('NFC');
const fold = (s: string) => nfc(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');

export type ViewState = 'loading' | 'ok' | 'trashed' | 'missing' | 'unreadable' | 'newer' | 'types' | 'draft';
export type TabFilter = { text: string; tags: string[] };

/** What `TypeViews` drives on the shown view (the palette, the view menu, Edit view). */
export type PanelApi = {
  def: () => QueryDefDto | null;
  readOnly: () => string | null;
  board: () => BoardControl | null;
  openSort: (add: boolean) => void;
  rerun: () => void;
  /** Slice Q2.1 (R199): the tab's usage for the palette (null while it can't be written or has no run). */
  usage: () => { kind: 'tab'; ownSort: boolean; ownColumns: boolean } | null;
  /** `Use the query's sort` / `columns` (R197). */
  useQuery: (key: 'sort' | 'columns') => void;
  /** What the editor opened from this tab works with (D-1844, D-1859). */
  editorUsage: () => { sort: SortDto[]; columns: string[]; setColumns: (next: string[]) => Promise<boolean>; disabled: string | null } | null;
  /** Slice Q3 (§42.4): the tab's display for the palette and the view menu (`Reset lane order` when it has one). */
  display: () => (NonNullable<ViewsStatus['display']> & { resetLaneOrder: boolean }) | null;
  /** Slice Q3: the palette's display, grouping and board commands on this tab. */
  run: (id: string) => void;
};

const showResultsOf = (state: ViewState, live: QueryResultDto | null) => state === 'ok' || state === 'types' || state === 'newer' || (state === 'draft' && !!live);

export function viewStateOf(r: QueryResultDto | null, typeKey: string, draft: boolean): ViewState {
  if (draft) return 'draft';
  if (!r) return 'loading';
  if (r.form === 'unreadable' || r.lookup === 'unreadable') return 'unreadable';
  if (r.lookup === 'missing') return 'missing';
  if (r.lookup === 'trashed') return 'trashed';
  if (r.lookup === 'newer') return 'newer';
  const types = r.def?.types.map(nfc) ?? [];
  if (!(types.length === 1 && types[0] === nfc(typeKey))) return 'types';
  return 'ok';
}

export function ViewPanel({ name, typeKey, type, types, plural, filter, onFilter, onState, onMenu, onRemove, apiRef, live, draft, labelledBy, patch, onTags }: {
  /** The saved query's name (a tab of `views:`). */
  name: string;
  typeKey: string;
  type: TypeDto;
  types: TypeDto[];
  plural: string;
  filter: TabFilter;
  onFilter: (f: TabFilter) => void;
  onState: (s: ViewState) => void;
  /** `View actions` from the toolbar's `⋯`. */
  onMenu: (anchor: HTMLElement) => void;
  onRemove: () => void;
  apiRef: Ref<PanelApi | null>;
  /** The editor's live result while it is open (null: the panel's own run). */
  live: QueryResultDto | null;
  /** A `New view` draft: nothing runs until the editor answers. */
  draft: boolean;
  labelledBy: string;
  /** Slice Q2.1: the type page's queued `type_patch` (the tab's `views:` item, R197). */
  patch?: TypePatch;
  /** Q2-T (§29.6): the tag selection changed (kept per tab on this Mac). */
  onTags?: (tags: string[]) => void;
}) {
  // Slice Q2.1 (CP-11, D-1853): the tab runs as a usage, its own sort and columns read from its `views:` item.
  const run = useQueryRun(draft ? null : { kind: 'view', type: typeKey, name }, null);
  const result = live ?? run.result;
  const state = viewStateOf(result, typeKey, draft && !live);
  const readOnly = state === 'newer' ? t('query.block.readOnly') : null;
  useEffect(() => { onState(state); }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const def = result?.def ?? null;
  const writer = useQueryApply(!draft && !readOnly && def ? name : null, run.result, () => run.rerun());
  const apply = (p: Parameters<typeof writer.apply>[0]) => { if (!readOnly && !draft) writer.apply(p); };
  // ---- Slice Q2.1 (R194, R197): the tab's own sort and columns, written to its `views:` item.
  const usage: Usage | null = draft ? null : { kind: 'tab', typeKey, name };
  const uw = useUsageWrite(usage, run.result, { type, ctl: null, fenceSource: null, rerun: () => run.rerun(), patch, plural });
  const uKey = usage ? usageKey(usage) : null;
  const usageRun = !live ? run.result?.usage ?? null : null;
  const effSort = def ? (live || draft ? def.sort : uw.current().sort) : [];
  const effColumns = def ? (live || draft ? def.columns : uw.current().columns) : [];
  const disabled = draft ? null : uw.disabled;
  const ownSort: boolean | 'broken' = usageRun ? (usageRun.broken.some((b) => b.key === 'sort') ? 'broken' : usageRun.own.sort !== null) : false;
  const ownColumns: boolean | 'broken' = usageRun ? (usageRun.broken.some((b) => b.key === 'columns') ? 'broken' : usageRun.own.columns !== null) : false;
  // ---- Slice Q3 (R220, §33.2, §41): the tab's own display and grouping over the query's; the editor's live preview
  // (and a `New view` draft) shows the query's.
  const cur = uw.current();
  const plainRun = !!live || draft || !run.result;
  const display: Display = plainRun ? (result ? effectiveDisplay(result) : 'list') : cur.view;
  const grouping = plainRun ? (def?.groupBy ? { key: nfc(def.groupBy), period: !!def.groupPeriod } : null) : cur.group;
  const grouped = !!result?.group && grouping !== null && (plainRun || isGrouped(run.result!));
  // A grouping just written shows on `Group` before the next run draws it (the pending own value).
  const runGrouping = !plainRun ? effectiveGrouping(run.result!) : null;
  const groupPending = !plainRun && !!grouping && (runGrouping?.key !== grouping.key || runGrouping?.period !== grouping.period);
  const lanes = plainRun ? (def?.lanes ?? 'columns') : cur.lanes;
  const laneOrder = plainRun ? (def?.laneOrder ?? null) : cur.laneOrder;
  const own = usageRun && !plainRun ? ownKeys(run.result!) : { view: null, group: null, lanes: null, laneOrder: null, widths: null };
  const ownAttr = (v: 'own' | 'broken' | null) => (v === null ? undefined : v === 'broken' ? 'broken' : '');
  const controls = useRef<DisplayControlsApi | null>(null);
  const groupWith = (c: { key: string | null; period: boolean }) => uw.group(c.key === null ? { none: true } : { none: false, key: c.key, period: c.period });
  const resetLaneOrder = () => { if (run.result) void uw.laneOrder(resetLaneOrderChange(run.result)); };
  const panelEl = useRef<HTMLDivElement | null>(null);
  const info = useRef({ uKey, name, ownSort, ownColumns, editable: !disabled, display, grouped, own });
  info.current = { uKey, name, ownSort, ownColumns, editable: !disabled, display, grouped, own };
  useEffect(() => registerUsage(() => (info.current.uKey ? panelEl.current : null), () => {
    const i = info.current;
    const b = (v: 'own' | 'broken' | null) => (v === 'broken' ? 'broken' as const : v === 'own');
    return { key: i.uKey ?? '', kind: 'tab', name: i.name.normalize('NFC'), ownSort: i.ownSort, ownColumns: i.ownColumns, editable: i.editable,
      display: i.display, grouped: i.grouped, ownView: b(i.own.view), ownGroup: b(i.own.group), ownLanes: b(i.own.lanes), ownLaneOrder: b(i.own.laneOrder), ownWidths: b(i.own.widths) };
  }), []);
  const [newProp, setNewProp] = useState(false);
  const typeOf = (k: string) => types.find((x) => nfc(x.key) === nfc(k));
  const typeName = (k: string) => typeOf(k)?.name ?? k;
  const board = useRef<BoardControl | null>(null);
  const [sortOpen, setSortOpen] = useState<{ add: boolean } | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [shown, setShown] = useState<number | null>(null);
  const sortBtn = useRef<HTMLButtonElement | null>(null);
  const columnsBtn = useRef<HTMLButtonElement | null>(null);
  const isBoard = display === 'wall' && grouped;
  useImperativeHandle(apiRef, () => ({
    def: () => writer.current() ?? def,
    readOnly: () => readOnly,
    board: () => (isBoard ? board.current : null),
    openSort: (add) => { if (def && !disabled) setSortOpen({ add }); },
    rerun: () => run.rerun(),
    usage: () => (!disabled && run.result?.usage ? { kind: 'tab', ownSort: canUseQuery(run.result, 'sort'), ownColumns: canUseQuery(run.result, 'columns') } : null),
    useQuery: (key) => { if (!disabled) void (key === 'sort' ? uw.sort(null) : uw.columns(null)); },
    editorUsage: () => (usage ? { sort: uw.current().sort, columns: uw.current().columns, setColumns: (c) => uw.columns(c), disabled: uw.disabled } : null),
    display: () => (def && !draft ? {
      value: display, grouped, wall: display === 'wall', writable: !disabled, ownView: own.view !== null, ownGroup: own.group !== null || own.lanes !== null || own.laneOrder !== null,
      laneOrder: grouped && laneOrder !== null, groupFocused: display !== 'wall' && !!groupCtl.current?.focused(), all: false, resetLaneOrder: grouped && laneOrder !== null,
    } : null),
    run: (id) => {
      if (disabled && (id.startsWith('display.') || id.startsWith('group.') || id === 'board.switchLanes' || id === 'board.resetLaneOrder')) return;
      switch (id) {
        case 'display.list': case 'display.table': case 'display.wall': void uw.display(id.slice(8) as Display); return;
        case 'group.open': controls.current?.openGroup(); return;
        case 'group.remove': void uw.group({ none: true }); return;
        case 'display.useQuery': void uw.display(null); return;
        case 'group.useQuery': void uw.group(null); return;
        case 'board.switchLanes': if (grouped && display === 'wall') void uw.lanes(lanes === 'rows' ? 'columns' : 'rows'); return;
        case 'board.resetLaneOrder': if (grouped && laneOrder !== null) resetLaneOrder(); return;
        case 'board.laneUp': case 'board.laneDown':
          if (display !== 'wall' && groupCtl.current?.focused()) { groupCtl.current.move(id === 'board.laneUp' ? -1 : 1); return; }
          board.current?.run(id); return;
        default: board.current?.run(id);
      }
    },
  }));

  // ---- §4.7: on a view tab's table the palette's `Choose columns…` opens its Columns, `Reset column widths` resets the
  // query's widths (`queryColumnWidths[name]`), not the type's.
  const isTable = display === 'table' && !draft;
  // §41.6: the tab's widths are its item's `widths` (D-2177), read from the 0.6.0 entry until it has its own (D-2190).
  const widthScope: WidthScope | null = uKey && !draft && !live ? {
    kind: 'usage', key: uKey, own: run.result?.usage?.own.widths ?? null, ownBroken: !!run.result && ownKeys(run.result).widths === 'broken',
    order: effColumns, write: (next) => uw.widths(next), disabled,
  } : null;
  const scopeRef = useRef(widthScope);
  scopeRef.current = widthScope;
  useEffect(() => {
    if (!isTable) return;
    const prev = columnsRequest.current;
    const h = (what: 'choose' | 'reset') => { if (what === 'reset') { if (scopeRef.current) resetWidths(scopeRef.current); } else if (!disabled) setColumnsOpen(true); };
    columnsRequest.current = h;
    return () => { if (columnsRequest.current === h) columnsRequest.current = prev; };
  }, [isTable, name, disabled, uKey]);

  // ---- the toolbar's narrowing (D-1796): folded title text, every chosen tag.
  const q = fold(filter.text.trim());
  // Q2-T (§24.1, §29.6): a row's tag keys (frontmatter and inline); all of the selected tags (D-518).
  const rowTags = (r: QueryRowDto) => r.tags ?? (Array.isArray(r.values.tags) ? r.values.tags : []).map((x) => nfc(String(x)).replace(/^#/, '').toLowerCase());
  const keep = (r: QueryRowDto) => (!q || fold(r.title).includes(q)) && keepRow({ tags: rowTags(r) }, filter.tags);
  const all = result?.rows ?? [];
  // A sort just written shows at once (R222: within 300 ms), before the next run answers: the rows in the pending
  // sort's order, the type page's comparison (title, then path, last).
  const runSort = run.result?.usage?.sort ?? def?.sort ?? [];
  const sortPending = !plainRun && !!def && !sameSort(effSort, runSort);
  const narrowed0 = all.filter(keep);
  const narrowed = sortPending ? sortTypeRows(narrowed0 as unknown as TypeRowDto[], effSort, type, collator()) as unknown as QueryRowDto[] : narrowed0;
  // ---- Slice Q3 (R225, §41.5): a grouped Table or List draws the run's groups.
  const groupCtl = useRef<GroupControl | null>(null);
  const groupedBody = useGrouped({
    on: showResultsOf(state, live) && grouped && display !== 'wall', result, def: def ? { ...def, lanes, laneOrder } : null, keep, foldKey: uKey,
    display: display === 'list' ? 'list' : 'table', types, grips: true, disabled: readOnly ?? disabled ?? (draft || live ? t('query.block.usageNotEditable') : null),
    onLaneOrder: (order) => { if (!readOnly && !draft && !live) void uw.laneOrder(order); }, controlRef: groupCtl,
  });
  // D-2189: `limit` applies to an ungrouped List or Table only.
  const limit = limitApplies(display, grouped) ? Math.max(1, def?.limit ?? 50) : Math.max(1, narrowed.length);
  const count = Math.min(shown ?? limit, narrowed.length);
  const rows = narrowed.slice(0, count);
  const more = Math.min(limit, narrowed.length - count);
  const tagRows = all.map((r) => ({ tags: rowTags(r) }));
  const setTags = (tags: string[]) => { onFilter({ ...filter, tags }); onTags?.(tags); };

  const listFormat = (xs: string[]) => { try { return new Intl.ListFormat(catalogLocale(), { type: 'conjunction' }).format(xs); } catch { return xs.join(', '); } };
  const sortText = def ? buttonText(effSort, (k) => sortKeyName(k, type).label) : { text: '', more: 0 };
  const showResults = state === 'ok' || state === 'types' || state === 'newer' || (state === 'draft' && !!live);
  const firstBroken = showResults ? result?.broken[0] ?? null : null;

  const toolbar = (
    <div className="view-toolbar">
      <input type="search" role="searchbox" className="type-filter view-filter" aria-label={t('typePage.filter', { plural })} placeholder={t('typePage.filter', { plural })}
        data-command={nfc(typeKey) === 'task' ? 'tasks.search' : undefined}
        value={filter.text} spellCheck={false} autoComplete="off" onChange={(e) => onFilter({ ...filter, text: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && filter.text) { e.preventDefault(); e.stopPropagation(); onFilter({ ...filter, text: '' }); }
          else if (e.key === 'ArrowDown') {
            // ↓ moves to the first shown card or row (FR-TSK-04 AC-21, D-1284).
            const el = panelEl.current?.querySelector<HTMLElement>('article[data-board-card][tabindex="0"], article[data-board-card], tr[data-path], li a');
            if (el) { e.preventDefault(); el.focus(); }
          }
        }} />
      <TagFilterControl rows={tagRows} selected={filter.tags} onChange={setTags} command="view.tagFilter" allHint={nfc(typeKey) === 'task' ? t('tasks.tagAll') : null} />
      {def && (
        <DisplayControls display={display} grouping={grouped || groupPending ? grouping : null} groupedWall={display === 'wall' && grouped} lanes={lanes}
          choices={groupChoices(def.types.length === 1 ? typeOf(def.types[0]!) ?? type : null, def.types)} type={def.types.length === 1 ? typeOf(def.types[0]!) ?? type : null}
          scope="tab" disabled={draft ? t('query.block.usageNotEditable') : disabled} apiRef={controls}
          offerUseQuery={{ grouping: !plainRun && canUseQuery(run.result!, 'grouping'), display: !plainRun && canUseQuery(run.result!, 'view') }}
          onDisplay={(d) => { void uw.display(d); }} onGroup={(c) => { void groupWith(c); }} onLanes={(l) => { void uw.lanes(l); }}
          onUseQuery={(w) => { void (w === 'display' ? uw.display(null) : uw.group(null)); }} />
      )}
      {def && (
        <button ref={sortBtn} type="button" tabIndex={0} className="text-button view-sort" aria-label={t('sort.button')} aria-haspopup="dialog" aria-expanded={!!sortOpen}
          data-command="sort.open" aria-disabled={disabled ? 'true' : undefined} aria-description={disabled ?? undefined}
          onClick={() => { if (!disabled) setSortOpen((o) => (o ? null : { add: false })); }}>
          <Icon name="sort" size={13} />
          <span className="sort-first">{(() => {
            const first = effSort[0];
            if (!first) return sortText.text;
            const n = sortKeyName(first.by, type);
            return <><span data-user-content={n.user ? '' : undefined}>{n.label}</span>{` ${first.order === 'asc' ? '↑' : '↓'}`}</>;
          })()}</span>
          {sortText.more > 0 && <span className="sort-more">{t('sort.more', { count: sortText.more })}</span>}
        </button>
      )}
      {def && display === 'table' && (
        <button ref={columnsBtn} type="button" tabIndex={0} className="text-button view-columns" data-command="view.columns" aria-haspopup="menu" aria-expanded={columnsOpen}
          aria-disabled={disabled ? 'true' : undefined} aria-description={disabled ?? undefined}
          onClick={() => { if (!disabled) setColumnsOpen((o) => !o); }}>
          <Icon name="columns" size={13} />{t('typePage.columns')}
        </button>
      )}
      <button type="button" tabIndex={0} className="icon-button view-more" aria-label={t('views.menu')} title={t('views.menu')} aria-haspopup="menu" data-command="views.menu"
        onClick={(e) => onMenu(e.currentTarget)}>
        <Icon name="more-horizontal" size={15} />
      </button>
    </div>
  );

  const message = (() => {
    switch (state) {
      case 'trashed':
        return (
          <p className="query-message">{t('query.block.trashed', { name })}{' '}
            <button type="button" tabIndex={0} className="query-msg-button" data-command="query.block.action"
              onClick={() => { void ipc.queryRestore(name).then(() => { void refreshQueries(); run.rerun(); }, () => queryAlert(t('query.saveFailed'))); }}>
              {t('query.block.restore')}
            </button>
          </p>
        );
      case 'missing':
        return (
          <p className="query-message">{t('query.block.notFound', { name })}{' '}
            <button type="button" tabIndex={0} className="query-msg-button" data-command="views.remove" onClick={onRemove}>{t('views.remove', { plural })}</button>
          </p>
        );
      case 'unreadable':
        return <p className="query-message">{t('query.block.unreadable', { line: result?.line ?? 1 })}</p>;
      case 'loading':
        return <div className="query-skeleton" aria-hidden="true"><span /><span /><span /></div>;
      default:
        return null;
    }
  })();

  const typesNotice = state === 'types' && def ? (def.types.length === 0
    ? t('views.brokenAllTypes', { thisType: type.name })
    : t('views.brokenTypes', { types: listFormat(def.types.map(typeName)), thisType: type.name })) : null;

  /** A wall's lane drag, `Move lane …`, `Switch lanes` and `Reset lane order` write the tab's item (§33.2). */
  const wallApply = (p: Partial<QueryDefDto>) => {
    if (readOnly || draft || live) return;
    if (p.lanes !== undefined) void uw.lanes(p.lanes);
    if (p.laneOrder !== undefined) { if (p.laneOrder === null) resetLaneOrder(); else void uw.laneOrder(p.laneOrder); }
  };
  const body = (() => {
    if (!showResults || !def || !result) return null;
    if (display === 'wall' && isBoard && result.group) {
      // §29.6: lanes stay when the filters leave nothing; the status says so.
      const none = (filter.text.trim() || filter.tags.length) && narrowed.length === 0
        ? <p role="status" className="query-message">{t('typePage.noMatch', { plural, text: filter.text.trim() })}</p> : null;
      return <>{none}<QueryWall result={{ ...result, def: { ...def, view: 'wall', lanes, laneOrder } }} name={draft ? null : name} title={def.title} readOnly={readOnly ?? disabled} types={types}
        filter={filter} apply={wallApply} rerun={() => run.rerun()} controlRef={board} foldKey={uKey} env={live ? null : run.env} /></>;
    }
    if (narrowed.length === 0) {
      return <p className="query-message">{filter.text.trim() || filter.tags.length ? t('typePage.noMatch', { plural, text: filter.text.trim() }) : t('query.block.noResults')}</p>;
    }
    if (display === 'wall') {
      return <QueryWall result={{ ...result, group: null, def }} rows={narrowed} name={draft ? null : name} title={def.title} readOnly={readOnly ?? disabled} types={types}
        apply={wallApply} rerun={() => run.rerun()} controlRef={board} env={live ? null : run.env} />;
    }
    if (display === 'table') {
      return <ResultsTable def={def} rows={rows} types={types} typeOf={typeOf} typeName={typeName} title={def.title} name={draft ? null : name} readOnly={disabled}
        sort={effSort} columns={effColumns} widthKey={uKey} widthScope={widthScope}
        onOpen={(p) => queryNav()?.openNote(p)}
        onSort={(by, shift) => { const cur = uw.current().sort; const next = headerClick(cur, by, shift); if (!sameSort(next, cur) || !ownSort) void uw.sort(next); }}
        onColumns={(columns) => { void uw.columns(columns); }} grouped={grouped ? groupedBody : null} />;
    }
    if (grouped) return <GroupedList grouped={groupedBody} title={def.title} />;
    return (
      <ul className="query-list view-list" aria-label={def.title}>
        {rows.map((r) => <li key={r.path} data-query-result={nfc(r.path)}><ResultChip row={r} onOpen={(p) => queryNav()?.openNote(p)} /></li>)}
      </ul>
    );
  })();
  // The perf mark (§42.5, D-2185; NFR-PERF-07 AC-8): `rows-ready` two frames after a Table or List tab first drew its
  // rows and group headers (a wall marks `board-ready` itself). Once per panel: the panel is keyed by the tab.
  const rowsDrawn = body !== null && display !== 'wall';
  useRowsReady(rowsDrawn, 'panel');
  const notices = showResults && usageRun && run.result ? noticeKeys(run.result) : [];

  return (
    <>
      <div ref={panelEl} role="tabpanel" aria-labelledby={labelledBy} data-view-panel={nfc(name)} className="view-panel" data-view-state={state}
        data-usage-key={uKey ?? undefined} data-usage-kind={uKey ? 'tab' : undefined}
        data-own-sort={uKey && ownSort ? (ownSort === 'broken' ? 'broken' : '') : undefined}
        data-own-columns={uKey && ownColumns ? (ownColumns === 'broken' ? 'broken' : '') : undefined}
        data-display={def ? display : undefined} data-group={grouped && grouping ? grouping.key : undefined} data-group-period={grouped && grouping?.period ? '' : undefined}
        data-own-view={ownAttr(own.view)} data-own-group={ownAttr(own.group)} data-own-lanes={ownAttr(own.lanes)} data-own-lane-order={ownAttr(own.laneOrder)} data-own-widths={ownAttr(own.widths)}>
        <div className="view-toolbar-cell">{toolbar}</div>
        <div className="view-body">
          {typesNotice && <p className="query-notice view-notice"><Icon name="warning" size={13} />{typesNotice}</p>}
          {firstBroken && <p className="query-notice view-notice"><Icon name="warning" size={13} />{noticeOf(firstBroken, types)}</p>}
          {notices.map((k) => (
            <p key={`usage-${k}`} className="query-notice view-notice" data-usage-broken={k}><Icon name="warning" size={13} />{t('query.block.brokenKey', { key: k })}</p>
          ))}
          {message}
          {body}
          {showResults && display !== 'wall' && more > 0 && (
            <button type="button" tabIndex={0} className="query-more" data-command="query.showMore" onClick={() => setShown(count + limit)}>
              {t('query.block.showMore', { count: more, total: narrowed.length })}
            </button>
          )}
        </div>
      </div>
      {sortOpen && def && (
        <SortPopover sort={effSort} type={type} anchor={sortBtn.current} addOnOpen={sortOpen.add} disabled={disabled} scope="tab"
          onUseQuery={run.result && canUseQuery(run.result, 'sort') ? () => { void uw.sort(null); } : null}
          onChange={(sort) => { void uw.sort(sort); }}
          onClose={() => { setSortOpen(null); sortBtn.current?.focus(); }} />
      )}
      {columnsOpen && def && (
        <ColumnsMenu def={def} types={types} anchor={columnsBtn.current} columns={effColumns} disabled={disabled} scope="tab"
          onUseQuery={run.result && canUseQuery(run.result, 'columns') ? () => { void uw.columns(null); } : null}
          onToggle={(key, on) => { void uw.columns(toggleColumn({ ...def, columns: uw.current().columns }, key, on)); }}
          onNewProperty={() => { setColumnsOpen(false); setNewProp(true); }}
          onClose={() => { setColumnsOpen(false); columnsBtn.current?.focus(); }} />
      )}
      {newProp && def && (
        // R197: the type file (the attribute), then the tab's columns (a second write, on the version the first returned).
        <NewPropertyDialog type={type} types={types} attributeOnly fresh={() => ipc.typeGet(type.key).then((x) => x ?? undefined, () => undefined)}
          onClose={() => { setNewProp(false); columnsBtn.current?.focus(); }}
          onDone={(added) => {
            setNewProp(false);
            if (!added || !patch) return;
            const k = nfc(added.key);
            const cur = uw.current().columns;
            if (cur.some((c) => nfc(c) === k)) return;
            void patch([{ op: 'viewColumns', name: nfc(name), columns: [...cur.map(nfc), k] }], added.type).then(() => run.rerun(), () => run.rerun());
          }} />
      )}
    </>
  );
}
