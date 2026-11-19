// Slice Q2: a view tab's toolbar and body (docs/contracts/v1-views.md §4.2 `ViewPanel.tsx`, §4.3, §4.4; R186…R188;
// boards Views A, D1, D2, E). One `query_run` of the saved query per open and per live change; the state texts of R141
// (in the trash with `Restore`, not found with `Remove from <plural> page`, unreadable, read-only); the types-changed
// notice (D-1763); the Table, List or Board; the toolbar `Filter <plural>…`, `Filter by tag` (narrowing only, kept per
// tab while the page is open, D-1796), the sort button (R188), `Columns` (Table) or the `Lanes` radiogroup (Board) and
// `View actions`. Viewing writes nothing; sort, columns, lanes, lane order and card moves write their one file.
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { t, catalogLocale } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import type { QueryDefDto, QueryResultDto, QueryRowDto } from '../ipc/queries';
import type { TypeDto } from '../ipc/types';
import { Icon } from '../shell/Icon';
import { TagFilter } from '../tasks/TagFilter';
import { LanesSwitch, QueryBoard, type BoardControl } from '../queries/board/QueryBoard';
import { ColumnsMenu, ResultChip, noticeOf } from '../queries/QueryBlock';
import { ResultsTable } from '../queries/ResultsTable';
import { SortPopover, sortKeyName } from '../queries/SortPopover';
import { buttonText, headerClick, sameSort } from '../queries/sort';
import { queryAlert } from '../queries/editorHost';
import { queryNav } from '../queries/nav';
import { refreshQueries } from '../queries/store';
import { toggleColumn } from '../queries/model';
import { useQueryApply } from '../queries/useQueryApply';
import { useQueryRun } from '../queries/useQueryRun';
import { columnsRequest } from '../types/columns';
import { resetWidths } from '../tables/widths';

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
};

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

export function ViewPanel({ name, typeKey, type, types, plural, slot, filter, onFilter, onState, onMenu, onRemove, apiRef, live, draft, labelledBy }: {
  /** The saved query's name (a tab of `views:`). */
  name: string;
  typeKey: string;
  type: TypeDto;
  types: TypeDto[];
  plural: string;
  /** Where the toolbar goes (next to the tabs). */
  slot: HTMLElement | null;
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
}) {
  const run = useQueryRun(draft ? null : { kind: 'saved', name }, null);
  const result = live ?? run.result;
  const state = viewStateOf(result, typeKey, draft && !live);
  const readOnly = state === 'newer' ? t('query.block.readOnly') : null;
  useEffect(() => { onState(state); }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const def = result?.def ?? null;
  const writer = useQueryApply(!draft && !readOnly && def ? name : null, run.result, () => run.rerun());
  const apply = (patch: Parameters<typeof writer.apply>[0]) => { if (!readOnly && !draft) writer.apply(patch); };
  const typeOf = (k: string) => types.find((x) => nfc(x.key) === nfc(k));
  const typeName = (k: string) => typeOf(k)?.name ?? k;
  const board = useRef<BoardControl | null>(null);
  const [sortOpen, setSortOpen] = useState<{ add: boolean } | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [shown, setShown] = useState<number | null>(null);
  const sortBtn = useRef<HTMLButtonElement | null>(null);
  const columnsBtn = useRef<HTMLButtonElement | null>(null);
  const tagsBtn = useRef<HTMLButtonElement | null>(null);
  const isBoard = def?.view === 'board' && !!result?.group;
  useImperativeHandle(apiRef, () => ({
    def: () => writer.current() ?? def,
    readOnly: () => readOnly,
    board: () => (isBoard ? board.current : null),
    openSort: (add) => { if (def && !readOnly) setSortOpen({ add }); },
    rerun: () => run.rerun(),
  }));

  // ---- §4.7: on a view tab's table the palette's `Choose columns…` opens its Columns, `Reset column widths` resets the
  // query's widths (`queryColumnWidths[name]`), not the type's.
  const isTable = def?.view === 'table' && !draft;
  useEffect(() => {
    if (!isTable) return;
    const prev = columnsRequest.current;
    const h = (what: 'choose' | 'reset') => { if (what === 'reset') resetWidths({ kind: 'query', name }); else if (!readOnly) setColumnsOpen(true); };
    columnsRequest.current = h;
    return () => { if (columnsRequest.current === h) columnsRequest.current = prev; };
  }, [isTable, name, readOnly]);

  // ---- the toolbar's narrowing (D-1796): folded title text, every chosen tag.
  const q = fold(filter.text.trim());
  const rowTags = (r: QueryRowDto) => (Array.isArray(r.values.tags) ? r.values.tags : []).map((x) => nfc(String(x)).replace(/^#/, '').toLowerCase());
  const keep = (r: QueryRowDto) => (!q || fold(r.title).includes(q)) && filter.tags.every((k) => rowTags(r).includes(k));
  const all = result?.rows ?? [];
  const narrowed = all.filter(keep);
  const limit = Math.max(1, def?.limit ?? 50);
  const count = Math.min(shown ?? limit, narrowed.length);
  const rows = narrowed.slice(0, count);
  const more = Math.min(limit, narrowed.length - count);
  const tagCounts = (() => {
    const m = new Map<string, number>();
    for (const r of all) for (const k of new Set(rowTags(r))) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key, n]) => ({ key, label: key, count: n }));
  })();

  const listFormat = (xs: string[]) => { try { return new Intl.ListFormat(catalogLocale(), { type: 'conjunction' }).format(xs); } catch { return xs.join(', '); } };
  const sortText = def ? buttonText(def.sort, (k) => sortKeyName(k, type).label) : { text: '', more: 0 };
  const showResults = state === 'ok' || state === 'types' || state === 'newer' || (state === 'draft' && !!live);
  const firstBroken = showResults ? result?.broken[0] ?? null : null;

  const toolbar = (
    <div className="view-toolbar">
      <input type="search" className="type-filter view-filter" aria-label={t('typePage.filter', { plural })} placeholder={t('typePage.filter', { plural })}
        value={filter.text} spellCheck={false} autoComplete="off" onChange={(e) => onFilter({ ...filter, text: e.target.value })}
        onKeyDown={(e) => { if (e.key === 'Escape' && filter.text) { e.preventDefault(); e.stopPropagation(); onFilter({ ...filter, text: '' }); } }} />
      <button ref={tagsBtn} type="button" tabIndex={0} className="text-button view-tags" aria-label={t('tasks.tagFilter')} aria-haspopup="dialog" aria-expanded={tagsOpen}
        data-command="view.tagFilter" onClick={() => setTagsOpen((o) => !o)}>
        <span aria-hidden="true">#</span>{filter.tags.length > 0 && <span className="view-tags-count" aria-hidden="true">{filter.tags.length}</span>}
        <Icon name="chevron-down" size={11} />
      </button>
      {def && (
        <button ref={sortBtn} type="button" tabIndex={0} className="text-button view-sort" aria-label={t('sort.button')} aria-haspopup="dialog" aria-expanded={!!sortOpen}
          data-command="sort.open" aria-disabled={readOnly ? 'true' : undefined} aria-description={readOnly ?? undefined}
          onClick={() => { if (!readOnly) setSortOpen((o) => (o ? null : { add: false })); }}>
          <Icon name="sort" size={13} />
          <span className="sort-first">{sortText.text}</span>
          {sortText.more > 0 && <span className="sort-more">{t('sort.more', { count: sortText.more })}</span>}
        </button>
      )}
      {def && def.view === 'table' && (
        <button ref={columnsBtn} type="button" tabIndex={0} className="text-button view-columns" data-command="view.columns" aria-haspopup="menu" aria-expanded={columnsOpen}
          aria-disabled={readOnly ? 'true' : undefined} aria-description={readOnly ?? undefined}
          onClick={() => { if (!readOnly) setColumnsOpen((o) => !o); }}>
          <Icon name="columns" size={13} />{t('typePage.columns')}
        </button>
      )}
      {def && isBoard && <LanesSwitch lanes={def.lanes} disabled={readOnly} onSwitch={(l) => apply({ lanes: l })} />}
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

  const body = (() => {
    if (!showResults || !def || !result) return null;
    if (isBoard && result.group) {
      return <QueryBoard result={{ ...result, group: result.group, def }} name={draft ? null : name} title={def.title} readOnly={readOnly} types={types}
        filter={filter} apply={(patch) => apply(patch)} rerun={() => run.rerun()} controlRef={board} />;
    }
    if (narrowed.length === 0) {
      return <p className="query-message">{filter.text.trim() || filter.tags.length ? t('typePage.noMatch', { plural, text: filter.text.trim() }) : t('query.block.noResults')}</p>;
    }
    if (def.view === 'table') {
      return <ResultsTable def={def} rows={rows} types={types} typeOf={typeOf} typeName={typeName} title={def.title} name={draft ? null : name} readOnly={readOnly}
        onOpen={(p) => queryNav()?.openNote(p)}
        onSort={(by, shift) => apply((d) => { const next = headerClick(d.sort, by, shift); return sameSort(next, d.sort) ? null : { sort: next }; })}
        onColumns={(columns) => apply({ columns })} />;
    }
    return (
      <ul className="query-list view-list" aria-label={def.title}>
        {rows.map((r) => <li key={r.path}><ResultChip row={r} onOpen={(p) => queryNav()?.openNote(p)} /></li>)}
      </ul>
    );
  })();

  return (
    <>
      {slot && createPortal(toolbar, slot)}
      <div role="tabpanel" aria-labelledby={labelledBy} data-view-panel={nfc(name)} className="view-panel" data-view-state={state}>
        {typesNotice && <p className="query-notice view-notice"><Icon name="warning" size={13} />{typesNotice}</p>}
        {firstBroken && <p className="query-notice view-notice"><Icon name="warning" size={13} />{noticeOf(firstBroken, types)}</p>}
        {message}
        {body}
        {showResults && !isBoard && more > 0 && (
          <button type="button" tabIndex={0} className="query-more" data-command="query.showMore" onClick={() => setShown(count + limit)}>
            {t('query.block.showMore', { count: more, total: narrowed.length })}
          </button>
        )}
      </div>
      {sortOpen && def && (
        <SortPopover sort={writer.current()?.sort ?? def.sort} type={type} anchor={sortBtn.current} addOnOpen={sortOpen.add} disabled={readOnly}
          onChange={(sort) => apply({ sort })}
          onClose={() => { setSortOpen(null); sortBtn.current?.focus(); }} />
      )}
      {columnsOpen && def && (
        <ColumnsMenu def={def} types={types} anchor={columnsBtn.current}
          onToggle={(key, on) => apply((d) => ({ columns: toggleColumn(d, key, on) }))}
          onNewProperty={() => setColumnsOpen(false)}
          onClose={() => { setColumnsOpen(false); columnsBtn.current?.focus(); }} />
      )}
      {tagsOpen && (
        <TagPopover anchor={tagsBtn.current} onClose={() => { setTagsOpen(false); tagsBtn.current?.focus(); }}>
          <TagFilter tags={tagCounts} selected={filter.tags} onChange={(tags) => onFilter({ ...filter, tags })} />
        </TagPopover>
      )}
    </>
  );
}

/** The `Filter by tag` popover: the Tasks tag filter under its button; Esc or a click outside closes it. */
function TagPopover({ anchor, onClose, children }: { anchor: HTMLElement | null; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const r = anchor?.getBoundingClientRect();
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input')?.focus();
    const outside = (e: MouseEvent) => { const tg = e.target as Node; if (ref.current?.contains(tg) || anchor?.contains(tg)) return; onClose(); };
    document.addEventListener('mousedown', outside, true);
    return () => document.removeEventListener('mousedown', outside, true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={ref} role="dialog" aria-label={t('tasks.tagFilter')} className="popover view-tag-popover" style={{ left: r ? Math.max(8, r.left) : 0, top: r ? r.bottom + 6 : 0 }}
      onKeyDown={(e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
      {children}
    </div>
  );
}

