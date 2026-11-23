// Slice Q2.1: what a usage's sort and columns changes write (docs/contracts/v1-views.md §16.1; R194, R197; D-1836,
// D-1839, D-1841, D-1842, D-1856, D-1860). A tab writes its `views:` item (`type_patch` `viewSort` / `viewColumns`), a
// block its fence through the editor (`QueryCtl.setSource`, one transaction, one undo step, one autosave), the query
// page the query file (`query_apply`, the defaults). Each change is computed by the caller from the usage's effective
// value (`current()`) and written whole as its own value; nothing is written when it equals the own value already set.
import { useEffect, useRef } from 'react';
import { withUsage } from '@tegg/doc';
import { t } from '../i18n/catalog';
import { errorKind, ipc } from '../ipc/client';
import type { LanesDto, QueryDefDto, QueryResultDto, SortDto, UsageGroupDto } from '../ipc/queries';
import type { TypeDto, TypeOpDto } from '../ipc/types';
import type { BlockCtl } from '../queries/QueryBlock';
import { queryAlert } from '../queries/editorHost';
import { effectiveColumns, effectiveSort, queryEffective, type Usage } from './usage';
import { effectiveDisplay, effectiveGrouping, effectiveLaneOrder, effectiveLanes, effectiveWidths, type Display } from './display';

export type UsageWriter = {
  /** null: `Use the query's sort` (tab, block only). Resolves true when written or nothing to write. */
  sort(next: SortDto[] | null): Promise<boolean>;
  columns(next: string[] | null): Promise<boolean>;
  /** Why the usage can't be written (a catalog text), else null. */
  disabled: string | null;
  /** Slice Q3 (§40.2): the display, grouping (null: `Use the query's grouping`, the three keys), lanes, lane order and
   *  widths of the usage (§33.2: tab item, block fence, the query file; page widths stay on this Mac). */
  display(next: Display | null): Promise<boolean>;
  group(next: UsageGroupDto | null): Promise<boolean>;
  lanes(next: LanesDto): Promise<boolean>;
  laneOrder(next: string[] | null): Promise<boolean>;
  widths(next: [string, number][] | null): Promise<boolean>;
  /** The effective values a change starts from (the last write of this usage until the next run shows it). */
  current(): Current;
};
type Current = {
  sort: SortDto[]; columns: string[];
  view: Display; group: { key: string; period: boolean } | null; lanes: LanesDto; laneOrder: string[] | null; widths: [string, number][];
};
type Q3Key = 'view' | 'group' | 'lanes' | 'laneOrder' | 'widths';
const BROKEN_KEY: Record<Q3Key, string> = { view: 'view', group: 'group_by', lanes: 'lanes', laneOrder: 'lane_order', widths: 'widths' };

/** A tab's `type_patch` (the type page's queue: each write based on the version the last one returned). Rejects with
 *  the core's error. */
export type TypePatch = (ops: TypeOpDto[], base?: TypeDto | null) => Promise<TypeDto>;

/** The reason a type file's views can't be written (the one `Remove from <plural> page` shows), else null. */
export function typeWriteReason(type: TypeDto | null): string | null {
  if (!type) return null;
  if (type.viewsUnreadable) return t('views.unreadableSetting', { file: `.tegg/types/${type.key}.yml` });
  if (type.state === 'newer') return t('ts.newer');
  if (type.state !== 'ok') return t('typePage.columnsInvalid');
  return null;
}

const sameList = <T,>(a: readonly T[] | null, b: readonly T[] | null, eq: (x: T, y: T) => boolean) =>
  a === b || (!!a && !!b && a.length === b.length && a.every((x, i) => eq(x, b[i]!)));
const sameSort = (a: SortDto[] | null, b: SortDto[] | null) => sameList(a, b, (x, y) => x.by.normalize('NFC') === y.by.normalize('NFC') && x.order === y.order);
const sameCols = (a: string[] | null, b: string[] | null) => sameList(a, b, (x, y) => x.normalize('NFC') === y.normalize('NFC'));
/** Widths compare as maps (v1-views §45 choice 6). */
const sameWidths = (a: [string, number][], b: [string, number][]) => {
  const m = new Map(a.map(([k, w]) => [k.normalize('NFC'), w]));
  return a.length === b.length && b.every(([k, w]) => m.get(k.normalize('NFC')) === w);
};

export function useUsageWrite(usage: Usage | null, result: QueryResultDto | null, o: {
  type: TypeDto | null;
  ctl: BlockCtl | null;
  fenceSource: string | null;
  rerun(): void;
  /** Tab: the type page's queued `type_patch` (else one direct call on `type`'s version). */
  patch?: TypePatch;
  /** Tab: the plural for `views.changedOutside`. */
  plural?: string;
  /** Page: Q2's `query_apply` with only that key changed. */
  apply?: (patch: Partial<QueryDefDto>) => void;
}): UsageWriter {
  const res = useRef(result);
  res.current = result;
  const opts = useRef(o);
  opts.current = o;
  // The own values this usage last wrote (undefined: none pending; null: removed), until the next run.
  const pending = useRef<{ sort?: SortDto[] | null; columns?: string[] | null; view?: Display | null; group?: UsageGroupDto | null; lanes?: LanesDto | null; laneOrder?: string[] | null; widths?: [string, number][] | null }>({});
  useEffect(() => { pending.current = {}; }, [result]);

  const readOnly = result?.lookup === 'newer';
  const disabled = !usage ? null
    : usage.kind === 'block' && (!usage.editable || !o.ctl) ? t('query.block.usageNotEditable')
      : readOnly ? t('query.block.readOnly')
        : usage.kind === 'tab' ? typeWriteReason(o.type)
          : null;

  const current = (): Current => {
    const r = res.current;
    const p = pending.current;
    // After `Use the query's …` (pending null) the usage shows the query's effective value (R194; R185's default for a
    // broken sort), not the query file's raw value.
    const q = r ? queryEffective(r) : { sort: [], columns: [] };
    const qd = r?.def ?? null;
    const queryGroup = qd && qd.groupBy ? { key: qd.groupBy.normalize('NFC'), period: !!qd.groupPeriod } : null;
    const lanesOfDef = (qd?.lanes as string | undefined) === 'rows' || (qd?.lanes as string | undefined) === 'horizontal' ? 'rows' as const : 'columns' as const;
    const viewOfDef = ((qd?.view as string | undefined) === 'board' ? 'wall' : qd?.view ?? 'list') as Display;
    return {
      sort: p.sort !== undefined ? (p.sort ?? q.sort) : r ? effectiveSort(r) : [],
      columns: p.columns !== undefined ? (p.columns ?? q.columns) : r ? effectiveColumns(r) : [],
      view: p.view !== undefined ? (p.view ?? viewOfDef) : r ? effectiveDisplay(r) : 'list',
      group: p.group !== undefined ? (p.group === null ? queryGroup : p.group.none ? null : { key: p.group.key, period: p.group.period }) : r ? effectiveGrouping(r) : null,
      lanes: p.lanes !== undefined ? (p.lanes ?? lanesOfDef) : p.group === null ? lanesOfDef : r ? effectiveLanes(r) : 'columns',
      laneOrder: p.laneOrder !== undefined ? (p.laneOrder ?? qd?.laneOrder ?? null) : p.group === null ? (qd?.laneOrder ?? null) : r ? effectiveLaneOrder(r) : null,
      widths: p.widths !== undefined ? (p.widths ?? []) : r ? effectiveWidths(r) : [],
    };
  };
  /** The usage's own value now: undefined = none (absent), 'broken' = present but broken. */
  const ownOf = (key: 'sort' | 'columns' | Q3Key): unknown => {
    const p = pending.current[key];
    if (p !== undefined) return p ?? undefined;
    // `Use the query's grouping` removed the three keys.
    if ((key === 'lanes' || key === 'laneOrder') && pending.current.group === null) return undefined;
    const u = res.current?.usage;
    if (!u) return undefined;
    const bk = key === 'sort' || key === 'columns' ? key : BROKEN_KEY[key];
    const own = (u.own as Record<string, unknown>)[key];
    if (own !== null && own !== undefined) return own;
    if (u.broken.some((b) => b.key === bk)) return 'broken';
    return undefined;
  };

  const write = async (key: 'sort' | 'columns', next: SortDto[] | string[] | null): Promise<boolean> => {
    if (!usage || disabled) return false;
    const own = ownOf(key);
    // Nothing to write: `Use the query's …` without an own value; a value equal to the own value already set.
    if (next === null && own === undefined && usage.kind !== 'page') return true;
    if (next !== null && own !== undefined && own !== 'broken') {
      if (key === 'sort' ? sameSort(next as SortDto[], own as SortDto[]) : sameCols(next as string[], own as string[])) return true;
    }
    const nfcSort = (s: SortDto[]) => s.map((x) => ({ by: x.by.normalize('NFC'), order: x.order }));
    const value = next === null ? null : key === 'sort' ? nfcSort(next as SortDto[]) : (next as string[]).map((c) => c.normalize('NFC'));
    const { type, ctl, fenceSource, rerun, patch, plural, apply } = opts.current;
    if (usage.kind === 'page') {
      if (value === null) return true;
      apply?.(key === 'sort' ? { sort: value as SortDto[] } : { columns: value as string[] });
      return true;
    }
    if (usage.kind === 'block') {
      if (!ctl || fenceSource === null) return false;
      const src = withUsage(fenceSource, key === 'sort' ? { sort: value as SortDto[] | null } : { columns: value as string[] | null });
      if (src === null) return true;
      // False: the block is gone, or the editor refused the write (its container couldn't be patched, D-1885).
      if (!ctl.setSource(src)) { queryAlert(t('query.saveFailed')); return false; }
      pending.current = { ...pending.current, [key]: value };
      return true;
    }
    // A tab: its `views:` item.
    if (!type) return false;
    const op: TypeOpDto = key === 'sort'
      ? { op: 'viewSort', name: usage.name.normalize('NFC'), sort: value as SortDto[] | null }
      : { op: 'viewColumns', name: usage.name.normalize('NFC'), columns: value as string[] | null };
    pending.current = { ...pending.current, [key]: value };
    try {
      if (patch) await patch([op]);
      else await ipc.typePatch(type.key, type.exists ? type.version : null, [op]);
      rerun();
      return true;
    } catch (e) {
      pending.current = {};
      const k = errorKind(e);
      if (!patch) queryAlert(k === 'Io' || k === 'Unknown' ? t('query.saveFailed') : t('views.changedOutside', { plural: plural ?? type.plural ?? type.name }));
      rerun();
      return false;
    }
  };

  /** Slice Q3 (§33.2, R222): one write of one key (or the three grouping keys), none when the result equals the disk. */
  const writeQ3 = async (key: Q3Key, next: unknown): Promise<boolean> => {
    if (!usage || disabled) return false;
    const own = ownOf(key);
    const cur = current();
    if (next === null && usage.kind === 'page') {
      // `Reset lane order` on `query/<name>` removes the line (D-1792); nothing else removes a default there.
      if (key !== 'laneOrder' || cur.laneOrder === null) return true;
    } else if (next === null) {
      // `Use the query's …`, `Reset lane order` without a query order, `widths` removed: nothing to remove → no write.
      const has = own !== undefined || (key === 'group' && (ownOf('lanes') !== undefined || ownOf('laneOrder') !== undefined));
      if (!has) return true;
    } else if (key === 'view') {
      if (next === cur.view && own !== 'broken') return true;
    } else if (key === 'group') {
      const g = next as UsageGroupDto;
      const now = cur.group;
      const same = g.none ? now === null : !!now && now.key.normalize('NFC') === g.key.normalize('NFC') && now.period === g.period;
      if (same && own !== 'broken') return true;
    } else if (key === 'lanes') {
      if (next === cur.lanes && own !== 'broken') return true;
    } else if (key === 'laneOrder') {
      if (own !== undefined && own !== 'broken' && sameCols(next as string[], own as string[])) return true;
    } else if (key === 'widths') {
      if (own !== undefined && own !== 'broken' && sameWidths(next as [string, number][], own as [string, number][])) return true;
    }
    const nfcWidths = (w: [string, number][]) => w.map(([k, v]) => [k.normalize('NFC'), Math.round(v)] as [string, number]);
    const value: unknown = next === null ? null
      : key === 'group' ? ((next as UsageGroupDto).none ? { none: true } : { none: false, key: (next as { key: string }).key.normalize('NFC'), period: (next as { period: boolean }).period })
        : key === 'laneOrder' ? (next as string[]).map((x) => x.normalize('NFC'))
          : key === 'widths' ? nfcWidths(next as [string, number][])
            : next;
    const { type, ctl, fenceSource, rerun, patch, plural, apply } = opts.current;
    const remember = () => {
      pending.current = key === 'group' && value === null ? { ...pending.current, group: null, lanes: undefined, laneOrder: undefined } : { ...pending.current, [key]: value };
    };
    if (usage.kind === 'page') {
      // `query/<name>` sets the defaults (the query file); `Use the query's …` isn't offered there.
      if (value === null && key !== 'laneOrder') return true;
      if (key === 'view') apply?.({ view: value as Display });
      else if (key === 'group') {
        const g = value as UsageGroupDto;
        apply?.(g.none ? { groupBy: null, groupPeriod: false, groupNone: true } : { groupBy: g.key, groupPeriod: g.period, groupNone: false });
      } else if (key === 'lanes') apply?.({ lanes: value as LanesDto });
      else if (key === 'laneOrder') apply?.({ laneOrder: value as string[] | null });
      return true;
    }
    if (usage.kind === 'block') {
      if (!ctl || fenceSource === null) return false;
      const change = key === 'group' && value === null ? { group: null, lanes: null, laneOrder: null } : { [key]: value };
      const src = withUsage(fenceSource, change);
      if (src === null) return true;
      if (!ctl.setSource(src)) { queryAlert(t('query.saveFailed')); return false; }
      remember();
      return true;
    }
    if (!type) return false;
    const name = usage.name.normalize('NFC');
    const op: TypeOpDto = key === 'view' ? { op: 'viewDisplay', name, view: value as Display | null }
      : key === 'group' ? { op: 'viewGroup', name, group: value as UsageGroupDto | null }
        : key === 'lanes' ? { op: 'viewLanes', name, lanes: value as LanesDto | null }
          : key === 'laneOrder' ? { op: 'viewLaneOrder', name, laneOrder: value as string[] | null }
            : { op: 'viewWidths', name, widths: value as [string, number][] | null };
    remember();
    try {
      if (patch) await patch([op]);
      else await ipc.typePatch(type.key, type.exists ? type.version : null, [op]);
      rerun();
      return true;
    } catch (e) {
      pending.current = {};
      const k = errorKind(e);
      if (!patch) queryAlert(k === 'Io' || k === 'Unknown' ? t('query.saveFailed') : t('views.changedOutside', { plural: plural ?? type.plural ?? type.name }));
      rerun();
      return false;
    }
  };

  return {
    sort: (next) => write('sort', next),
    columns: (next) => write('columns', next),
    display: (next) => writeQ3('view', next),
    group: (next) => writeQ3('group', next),
    lanes: (next) => writeQ3('lanes', next),
    laneOrder: (next) => writeQ3('laneOrder', next),
    widths: (next) => writeQ3('widths', next === null || next.length === 0 ? null : next),
    disabled,
    current,
  };
}
