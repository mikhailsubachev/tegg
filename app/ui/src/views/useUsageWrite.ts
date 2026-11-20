// Slice Q2.1: what a usage's sort and columns changes write (docs/contracts/v1-views.md §16.1; R194, R197; D-1836,
// D-1839, D-1841, D-1842, D-1856, D-1860). A tab writes its `views:` item (`type_patch` `viewSort` / `viewColumns`), a
// block its fence through the editor (`QueryCtl.setSource`, one transaction, one undo step, one autosave), the query
// page the query file (`query_apply`, the defaults). Each change is computed by the caller from the usage's effective
// value (`current()`) and written whole as its own value; nothing is written when it equals the own value already set.
import { useEffect, useRef } from 'react';
import { withUsage } from '@tegg/doc';
import { t } from '../i18n/catalog';
import { errorKind, ipc } from '../ipc/client';
import type { QueryDefDto, QueryResultDto, SortDto } from '../ipc/queries';
import type { TypeDto, TypeOpDto } from '../ipc/types';
import type { BlockCtl } from '../queries/QueryBlock';
import { queryAlert } from '../queries/editorHost';
import { effectiveColumns, effectiveSort, type Usage } from './usage';

export type UsageWriter = {
  /** null: `Use the query's sort` (tab, block only). Resolves true when written or nothing to write. */
  sort(next: SortDto[] | null): Promise<boolean>;
  columns(next: string[] | null): Promise<boolean>;
  /** Why the usage can't be written (a catalog text), else null. */
  disabled: string | null;
  /** The effective values a change starts from (the last write of this usage until the next run shows it). */
  current(): { sort: SortDto[]; columns: string[] };
};

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
  const pending = useRef<{ sort?: SortDto[] | null; columns?: string[] | null }>({});
  useEffect(() => { pending.current = {}; }, [result]);

  const readOnly = result?.lookup === 'newer';
  const disabled = !usage ? null
    : usage.kind === 'block' && (!usage.editable || !o.ctl) ? t('query.block.usageNotEditable')
      : readOnly ? t('query.block.readOnly')
        : usage.kind === 'tab' ? typeWriteReason(o.type)
          : null;

  const current = () => {
    const r = res.current;
    const def = r?.def ?? null;
    const p = pending.current;
    return {
      sort: p.sort !== undefined ? (p.sort ?? def?.sort ?? []) : r ? effectiveSort(r) : [],
      columns: p.columns !== undefined ? (p.columns ?? def?.columns ?? []) : r ? effectiveColumns(r) : [],
    };
  };
  /** The usage's own value now: undefined = none (absent), 'broken' = present but broken. */
  const ownOf = (key: 'sort' | 'columns'): unknown => {
    const p = pending.current[key];
    if (p !== undefined) return p ?? undefined;
    const u = res.current?.usage;
    if (!u) return undefined;
    if (u.broken.some((b) => b.key === key)) return 'broken';
    return u.own[key] ?? undefined;
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
      if (!ctl.setSource(src)) return false;
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

  return {
    sort: (next) => write('sort', next),
    columns: (next) => write('columns', next),
    disabled,
    current,
  };
}
