// Slice Q2.1: the pure usage model (docs/contracts/v1-views.md §16.1, §18, §19.3; docs/acceptance/views.md R194, R197,
// R198; D-1836, D-1841, D-1842, D-1856, D-1858, D-1866). A usage is one place that shows a saved query with its own
// `sort` / `columns`: a view tab or a reference block; `query/<name>` shows the defaults. Effective values come from the
// run (`QueryResultDto.usage`, D-1854); machine-local state is keyed by the usage key (R198).
import type { QueryResultDto, SortDto } from '../ipc/queries';
import type { UiStateDto } from '../ipc/types';
import { nameKey } from './model';

export { nameKey };

export type Usage =
  | { kind: 'tab'; typeKey: string; name: string }
  | { kind: 'block'; note: { id: string | null; path: string }; name: string; n: number; editable: boolean }
  | { kind: 'page'; name: string };

export type ParsedUsageKey =
  | { kind: 'tab'; typeKey: string; nameKey: string }
  | { kind: 'block'; noteKey: string; nameKey: string; n: number }
  | { kind: 'page'; nameKey: string };

const nfc = (s: string) => s.normalize('NFC');

/** R198: `tab:<type key>/<name key>`, `block:<note key>/<name key>#<n>` (note key `id:<id>` or `path:<vault path>`),
 *  `page:<name key>`; every part NFC. */
export function usageKey(u: Usage): string {
  if (u.kind === 'tab') return `tab:${nfc(u.typeKey)}/${nameKey(u.name)}`;
  if (u.kind === 'page') return `page:${nameKey(u.name)}`;
  const note = u.note.id !== null && u.note.id !== '' ? `id:${nfc(u.note.id)}` : `path:${nfc(u.note.path)}`;
  return `block:${note}/${nameKey(u.name)}#${u.n}`;
}

/** The parts of a usage key (D-1866: the name key is `nameKey`); a block's name key is read between the last `/` and
 *  the final `#<digits>`. null for anything else. */
export function parseUsageKey(key: string): ParsedUsageKey | null {
  if (key.startsWith('tab:')) {
    const rest = key.slice(4);
    const i = rest.indexOf('/');
    if (i <= 0 || i === rest.length - 1) return null;
    return { kind: 'tab', typeKey: rest.slice(0, i), nameKey: rest.slice(i + 1) };
  }
  if (key.startsWith('page:')) {
    const rest = key.slice(5);
    return rest === '' ? null : { kind: 'page', nameKey: rest };
  }
  if (key.startsWith('block:')) {
    const m = /^block:((?:id|path):.+)\/([^/]+)#(\d+)$/.exec(key);
    if (!m) return null;
    return { kind: 'block', noteKey: m[1]!, nameKey: m[2]!, n: Number(m[3]) };
  }
  return null;
}

/** The key with another name key (other parts kept). */
function withNameKey(p: ParsedUsageKey, nk: string): string {
  if (p.kind === 'tab') return `tab:${p.typeKey}/${nk}`;
  if (p.kind === 'page') return `page:${nk}`;
  return `block:${p.noteKey}/${nk}#${p.n}`;
}

/** D-1858 (R198 `n`): the 1-based place of the block at `index` among the note's reference fences of the same query
 *  (name key), document order, nested fences included. `names[i]` null: an inline or draft block (no ordinal). */
export function blockOrdinal(names: readonly (string | null)[], index: number): number | null {
  const own = names[index];
  if (own === null || own === undefined) return null;
  const k = nameKey(own);
  let n = 0;
  for (let i = 0; i <= index; i++) {
    const x = names[i];
    if (x !== null && x !== undefined && nameKey(x) === k) n++;
  }
  return n;
}

type RunLike = Pick<QueryResultDto, 'def' | 'usage'>;

/** R194: the usage's effective sort (its own valid value, else the query's), else the query file's (`query/<name>`). */
export function effectiveSort(result: RunLike): SortDto[] {
  return result.usage ? result.usage.sort : (result.def?.sort ?? []);
}

/** R194: the usage's effective columns (unknown keys kept; the UI shows real columns only), else the query file's. */
export function effectiveColumns(result: RunLike): string[] {
  return result.usage ? result.usage.columns : (result.def?.columns ?? []);
}

/** R194: the query's own effective values, which a usage without its own value shows (after `Use the query's …`):
 *  the core's effective value when the run's usage has no own value; otherwise the query file's, with R185's default
 *  `[modified desc]` for a broken `sort`. */
export function queryEffective(result: Pick<QueryResultDto, 'def' | 'usage' | 'broken'>): { sort: SortDto[]; columns: string[] } {
  const u = result.usage;
  const ownBroken = (k: 'sort' | 'columns') => !!u && u.broken.some((b) => b.key === k);
  const sort = u && u.own.sort === null && !ownBroken('sort') ? u.sort
    : result.broken.some((b) => b.key === 'sort') || !result.def ? [{ by: 'modified', order: 'desc' as const }] : result.def.sort;
  const columns = u && u.own.columns === null && !ownBroken('columns') ? u.columns : (result.def?.columns ?? []);
  return { sort, columns };
}

/** The usage's own values as read (null: absent or broken); null for a run without a usage. */
export function ownOf(result: RunLike): { sort: SortDto[] | null; columns: string[] | null } | null {
  return result.usage ? result.usage.own : null;
}

/** R197 scope lines: what a change writes. */
export function scopeOf(u: Usage): 'tab' | 'block' | 'default' {
  return u.kind === 'page' ? 'default' : u.kind;
}

/** D-1856: `Use the query's sort` / `columns` is offered when the usage has the key, valid or broken; never on the
 *  query page. */
export function canUseQuery(result: RunLike, key: 'sort' | 'columns' | 'view' | 'grouping'): boolean {
  const u = result.usage;
  if (!u) return false;
  const has = (own: unknown, k: string) => (own !== null && own !== undefined) || u.broken.some((b) => b.key === k);
  // Slice Q3 (§40.2, D-2192): `Use the query's display` with an own `view`; `… grouping` with own `group_by`, `lanes`
  // or `lane_order` (valid or broken).
  if (key === 'view') return has(u.own.view, 'view');
  if (key === 'grouping') return has(u.own.group, 'group_by') || has(u.own.lanes, 'lanes') || has(u.own.laneOrder, 'lane_order');
  return has(u.own[key], key);
}

type UsageUi = Pick<UiStateDto, 'typeViews' | 'usageColumnWidths' | 'usageFolded' | 'tagFilter'>;

/** R198 rename (§19.3): every usage key whose name key is `from`'s gets `to`'s name key, in `usageColumnWidths` and
 *  `usageFolded`, and every remembered tab `from` becomes `to`; the 0.4.0 keys stay untouched. The same object when
 *  nothing names `from`. */
export function movedUsageState<U extends UsageUi>(ui: U, from: string, to: string): U {
  const f = nameKey(from);
  const tk = nameKey(to);
  const t = nfc(to);
  let changed = false;
  const rekey = <V,>(m: Record<string, V | undefined> | undefined): Record<string, V | undefined> | undefined => {
    if (!m) return m;
    let hit = false;
    const out: Record<string, V | undefined> = {};
    for (const [k, v] of Object.entries(m)) {
      const p = parseUsageKey(k);
      if (p && p.nameKey === f) { hit = true; out[withNameKey(p, tk)] = v; } else out[k] = v;
    }
    if (!hit) return m;
    changed = true;
    return out;
  };
  const widths = rekey(ui.usageColumnWidths);
  const folded = rekey(ui.usageFolded);
  // Slice Q2-T (v1-views §30.3, R206): the tab keys of the tag filter move too (`all:<type>` keys never name a query).
  const tagFilter = rekey(ui.tagFilter);
  let typeViews = ui.typeViews;
  const tabs = ui.typeViews?.lastTab;
  if (tabs && Object.values(tabs).some((v) => typeof v === 'string' && nameKey(v) === f)) {
    changed = true;
    typeViews = { ...ui.typeViews, lastTab: Object.fromEntries(Object.entries(tabs).map(([k, v]) => [k, typeof v === 'string' && nameKey(v) === f ? t : v])) };
  }
  if (!changed) return ui;
  const out = { ...ui, typeViews } as U;
  if (widths !== undefined) out.usageColumnWidths = widths;
  if (folded !== undefined) out.usageFolded = folded;
  if (tagFilter !== undefined) out.tagFilter = tagFilter;
  return out;
}
