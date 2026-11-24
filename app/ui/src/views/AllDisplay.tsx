// Slice Q3: `All <plural>`'s display and grouping on this Mac (docs/contracts/v1-views.md §41.10, §39.5; R226; D-2178;
// CP-34, D-2199). The display switch and `Group` (scope `thisMac`) write `allView[<type>]` (one `ui_state_set`); an
// ungrouped Table keeps the type page's own table (`index_type_rows`); any other display or a grouping runs
// `query_run({ kind: 'def', def: allDef(…) })` and draws the wall or the list. No grips, no `Reset lane order`, no
// `Use the query's …` here; `Columns` still writes the type file (D-1240).
import { useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n/catalog';
import type { AllViewDto, TypeDto } from '../ipc/types';
import type { QueryRowDto, SortDto } from '../ipc/queries';
import { QueryWall, type BoardControl } from '../queries/board/QueryWall';
import { DisplayControls, type DisplayControlsApi } from '../queries/GroupMenu';
import { ResultChip } from '../queries/QueryBlock';
import { GroupedList, useGrouped } from '../queries/Grouped';
import { ResultsTable } from '../queries/ResultsTable';
import { headerClick } from '../queries/sort';
import { queryNav } from '../queries/nav';
import { useQueryRun } from '../queries/useQueryRun';
import type { ViewsStatus } from '../shell/commands';
import { allDef, groupChoices, type Display } from './display';
import { keepRow } from './tagFilter';
import { allViewOf, setAllView } from './uiState';

const nfc = (s: string) => s.normalize('NFC');
const fold = (s: string) => nfc(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');

export type AllDisplay = {
  /** The display switch and `Group` for the toolbar. */
  controls: ReactNode;
  view: AllViewDto;
  /** The body in place of the type table (null: the ungrouped Table, the page's own). */
  body: ReactNode | null;
  /** This body is a Table or List that drew its rows (null: the page's own table decides; §42.5, D-2226). */
  rowsDrawn: boolean | null;
  attrs: Record<string, string | undefined>;
  status: () => ViewsStatus['display'];
  run: (id: string) => boolean;
};

export function useAllDisplay({ type, typeKey, plural, sort, filterText, tags, types, on, onSort }: {
  type: TypeDto | undefined; typeKey: string; plural: string; sort: SortDto[]; filterText: string; tags: string[]; types: TypeDto[];
  /** The page shows view tabs (only then does `All <plural>` have a display switch). */
  on: boolean;
  /** The machine-local sort's change (a grouped Table's header click). */
  onSort?: (next: SortDto[]) => void;
}): AllDisplay {
  const [av, setAv] = useState<AllViewDto>(() => allViewOf(typeKey));
  const write = (next: AllViewDto) => { setAv(next); setAllView(typeKey, next); };
  const grouping = av.groupBy ? { key: nfc(av.groupBy), period: av.groupPeriod } : null;
  const needsRun = on && !!type && (av.view !== 'table' || grouping !== null);
  const run = useQueryRun(needsRun && type ? { kind: 'def', def: allDef(type, av, sort), name: null } : null, null);
  const result = needsRun ? run.result : null;
  const grouped = grouping !== null && !!result?.group;
  const controls = useRef<DisplayControlsApi | null>(null);
  const board = useRef<BoardControl | null>(null);
  const choices = type ? groupChoices(type, [type.key]) : [];
  const display: Display = av.view;

  const q = fold(filterText.trim());
  const rowTags = (r: QueryRowDto) => r.tags ?? [];
  const keep = (r: QueryRowDto) => (!q || fold(r.title).includes(q)) && keepRow({ tags: rowTags(r) }, tags);
  const rows = (result?.rows ?? []).filter(keep);
  // Slice Q3 (§41.10): a grouped Table or List in option order, no grips, folds `usageFolded["all:<type>"]`.
  const groupedBody = useGrouped({
    on: grouped && display !== 'wall', result, def: result?.def ?? (type ? allDef(type, av, sort) : null), keep, foldKey: `all:${nfc(typeKey)}`,
    display: display === 'list' ? 'list' : 'table', types, grips: false, disabled: null, onLaneOrder: () => {},
  });

  const body = (() => {
    if (!needsRun || (display === 'table' && !grouping) || !type) return null;
    if (!result) return <div className="query-skeleton" aria-hidden="true"><span /><span /><span /></div>;
    if (display === 'wall') {
      if (!grouped && rows.length === 0) return <p className="query-message">{q || tags.length ? t('typePage.noMatch', { plural, text: filterText.trim() }) : t('typePage.empty')}</p>;
      return <QueryWall result={{ ...result, def: result.def ?? allDef(type, av, sort), group: grouped ? result.group : null }} rows={rows} name={null} title={plural} readOnly={null} types={types}
        filter={{ text: filterText, tags }} apply={(p) => { if (p.lanes !== undefined) write({ ...av, lanes: p.lanes }); }} rerun={() => run.rerun()} controlRef={board} foldKey={`all:${nfc(typeKey)}`} env={run.env} />;
    }
    if (grouped && rows.length === 0) return <p className="query-message">{q || tags.length ? t('typePage.noMatch', { plural, text: filterText.trim() }) : t('typePage.empty')}</p>;
    if (display === 'table') {
      if (!grouped) return null;
      const d = result.def ?? allDef(type, av, sort);
      const typeOf = (k: string) => types.find((x) => nfc(x.key) === nfc(k));
      return <ResultsTable def={d} rows={rows} types={types} typeOf={typeOf} typeName={(k) => typeOf(k)?.name ?? k} title={plural} name={`all:${nfc(typeKey)}`} readOnly={null}
        sort={sort} columns={d.columns} widthScope={{ kind: 'type', key: nfc(typeKey) }} onOpen={(p) => queryNav()?.openNote(p)}
        onSort={(by, shift) => onSort?.(headerClick(sort, by, shift))} onColumns={() => {}} grouped={groupedBody} />;
    }
    if (grouped) return <GroupedList grouped={groupedBody} title={plural} />;
    return (
      <ul className="query-list view-list" aria-label={plural}>
        {rows.map((r) => <li key={r.path} data-query-result={nfc(r.path)}><ResultChip row={r} onOpen={(p) => queryNav()?.openNote(p)} /></li>)}
      </ul>
    );
  })();

  const node = (
    <DisplayControls display={display} grouping={grouping} groupedWall={display === 'wall' && grouping !== null} lanes={av.lanes} choices={choices} type={type}
      scope="thisMac" disabled={null} offerUseQuery={{ grouping: false, display: false }} apiRef={controls}
      onDisplay={(d) => write({ ...av, view: d })}
      onGroup={(c) => write({ ...av, groupBy: c.key, groupPeriod: c.key !== null && c.period })}
      onLanes={(l) => write({ ...av, lanes: l })}
      onUseQuery={() => {}} />
  );
  return {
    controls: node, view: av, body,
    rowsDrawn: body === null ? null : display !== 'wall' && !!result,
    attrs: { 'data-display': display, 'data-group': grouping ? grouping.key : undefined, 'data-group-period': grouping?.period ? '' : undefined },
    status: () => ({ value: display, grouped: grouping !== null, wall: display === 'wall', writable: true, ownView: false, ownGroup: false, laneOrder: false, groupFocused: false, all: true }),
    run: (id) => {
      switch (id) {
        case 'display.list': case 'display.table': case 'display.wall': write({ ...av, view: id.slice(8) as Display }); return true;
        case 'group.open': controls.current?.openGroup(); return true;
        case 'group.remove': write({ ...av, groupBy: null, groupPeriod: false }); return true;
        case 'board.switchLanes': if (display === 'wall' && grouping) write({ ...av, lanes: av.lanes === 'rows' ? 'columns' : 'rows' }); return true;
        default: return board.current?.run(id) ?? false;
      }
    },
  };
}
