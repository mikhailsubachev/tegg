// The tag pages' view model (docs/contracts/ms4-tags.md §6.2, D-735): sorting, finding and grouping the rows that
// `index_tags` and `tag_objects` return. Name orders use the region collator (D-122); folding as the switcher.
import type { TagObjectRowDto, TagRowDto } from '../ipc/types';

export type TagsSort = { column: 'count' | 'name' | 'lastUsed'; dir: 'asc' | 'desc' };
export type TagPageSort = { column: 'title' | 'type' | 'otherTags' | 'modified'; dir: 'asc' | 'desc' };
export type TagPageUi = { sort: TagPageSort; type: string | null; grouping: 'none' | 'type' };
export const DEFAULT_TAGS_SORT: TagsSort = { column: 'count', dir: 'desc' };
export const DEFAULT_TAG_PAGE: TagPageUi = { sort: { column: 'modified', dir: 'desc' }, type: null, grouping: 'none' };

export const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().normalize('NFC');
const big = (s: string | null): bigint | null => (s === null ? null : BigInt(s));
const cmpBig = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);

/** Missing values last in both directions. */
function byNullable<T>(a: T | null, b: T | null, cmp: (x: T, y: T) => number, dir: 'asc' | 'desc'): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const c = cmp(a, b);
  return dir === 'asc' ? c : -c;
}

/** R81: All tags with `find` (folded, a leading `#` ignored) and the sort; ties by name (D-122). */
export function allTagsRows(rows: TagRowDto[], sort: TagsSort, find: string, collator: Intl.Collator): TagRowDto[] {
  const q = fold(find.trim().replace(/^#/, ''));
  const kept = q ? rows.filter((r) => fold(r.name).includes(q) || fold(r.key).includes(q)) : [...rows];
  const name = (a: TagRowDto, b: TagRowDto) => collator.compare(a.name, b.name);
  return kept.sort((a, b) => {
    if (sort.column === 'name') return sort.dir === 'asc' ? name(a, b) : -name(a, b);
    if (sort.column === 'count') return (sort.dir === 'asc' ? a.count - b.count : b.count - a.count) || name(a, b);
    return byNullable(big(a.lastUsedNs), big(b.lastUsedNs), cmpBig, sort.dir) || name(a, b);
  });
}

/** R83, D-700, D-721: the five most recently used tags with count ≥ 1, ties by name. */
export function sidebarTags(rows: TagRowDto[], collator: Intl.Collator): TagRowDto[] {
  return rows
    .filter((r) => r.count >= 1)
    .sort((a, b) => byNullable(big(a.lastUsedNs), big(b.lastUsedNs), cmpBig, 'desc') || collator.compare(a.name, b.name))
    .slice(0, 5);
}

/** `<n> objects of <k> types`, always unfiltered (D-722 (c)). */
export function summary(rows: TagObjectRowDto[]): { objects: number; types: number } {
  return { objects: new Set(rows.map((r) => r.path)).size, types: new Set(rows.map((r) => r.type)).size };
}

const typeName = (k: string, names: Record<string, string>) => names[k] ?? k;

/** The Type filter's options: the types among the rows with counts, in D-122 order of their names. */
export function typeOptions(rows: TagObjectRowDto[], typeNames: Record<string, string>, collator: Intl.Collator): { type: string; name: string; count: number }[] {
  const n = new Map<string, number>();
  for (const r of rows) n.set(r.type, (n.get(r.type) ?? 0) + 1);
  return [...n].map(([type, count]) => ({ type, name: typeName(type, typeNames), count })).sort((a, b) => collator.compare(a.name, b.name));
}

/** R82: the filtered, sorted rows, in one `type: null` group or one group per type (D-690, D-702, D-722). */
export function tagPageRows(rows: TagObjectRowDto[], ui: TagPageUi, filter: string, typeNames: Record<string, string>, collator: Intl.Collator): { groups: { type: string | null; rows: TagObjectRowDto[] }[] } {
  const q = fold(filter.trim());
  let kept = rows.filter((r) => (ui.type === null || r.type === ui.type) && (!q || fold(r.title).includes(q)));
  const { column, dir } = ui.sort;
  const title = (a: TagObjectRowDto, b: TagObjectRowDto) => collator.compare(a.title, b.title);
  const firstOther = (r: TagObjectRowDto) => (r.tags.length ? [...r.tags].sort(collator.compare)[0] : null);
  kept = [...kept].sort((a, b) => {
    if (column === 'title') return dir === 'asc' ? title(a, b) : -title(a, b);
    if (column === 'type') {
      const c = collator.compare(typeName(a.type, typeNames), typeName(b.type, typeNames));
      return (dir === 'asc' ? c : -c) || title(a, b);
    }
    if (column === 'otherTags') return byNullable(firstOther(a), firstOther(b), (x, y) => collator.compare(x, y), dir) || title(a, b);
    return byNullable(big(a.modifiedNs), big(b.modifiedNs), cmpBig, dir) || title(a, b);
  });
  if (ui.grouping !== 'type') return { groups: [{ type: null, rows: kept }] };
  const order = typeOptions(kept, typeNames, collator).map((o) => o.type);
  return { groups: order.map((type) => ({ type, rows: kept.filter((r) => r.type === type) })) };
}
