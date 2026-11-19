// Slice Q2: the pure model of a type page's views (docs/contracts/v1-views.md §4.2; R184, R186; D-1762, D-1763,
// D-1781, D-1783, D-1787). A view is a saved query named in the type file's `views:`; every function answers the list
// to write (null: unchanged), so the page sends one `type_patch` per change and none for a no-op.
import type { QueryDefDto, QuerySummaryDto } from '../ipc/queries';
import type { TypeDto } from '../ipc/types';
import { catalogLocale, t } from '../i18n/catalog';
import { effectiveColumns } from '../types/columns';

const nfc = (s: string) => s.normalize('NFC');
const trimWs = (s: string) => s.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '');
/** queries_q's `name_key` (D-1434, D-1818): trimmed, NFC, lower case. */
export const nameKey = (s: string) => nfc(trimWs(s)).toLowerCase();

export type ViewTab = { name: string; key: string; summary: QuerySummaryDto | null };
export type OfferReason = 'otherType' | 'severalTypes' | 'allTypes' | 'needsNote' | 'unreadable';

/** D-1787: defined types have views, except Task (until Q2-T) and Tag. */
export function hasViews(typeKey: string, type: TypeDto | null | undefined): boolean {
  if (!type) return false;
  const k = nfc(typeKey);
  return k !== 'task' && k !== 'tag';
}

/** The saved query a name refers to: the exact NFC name first, else the first name-key match (D-1475). */
function summaryOf(name: string, summaries: readonly QuerySummaryDto[]): QuerySummaryDto | null {
  const n = nfc(trimWs(name));
  return summaries.find((s) => nfc(s.name) === n) ?? summaries.find((s) => nameKey(s.name) === nameKey(n)) ?? null;
}

/** The names of `views:` without repeats (name key: NFC, case), each at its first place (R184). */
function unique(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const k = nameKey(n);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out;
}

/** One tab per `views:` name (R184, R186): repeats dropped, a name with no query still a tab (summary null). */
export function viewTabs(type: TypeDto | null | undefined, summaries: readonly QuerySummaryDto[]): ViewTab[] {
  if (!type || type.viewsUnreadable || !type.views) return [];
  return unique(type.views).map((name) => ({ name, key: nameKey(name), summary: summaryOf(name, summaries) }));
}

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** A tab dropped before `before` (null: last); null when it stays where it is. Every copy of the name moves as one. */
export function viewsAfterDrop(names: readonly string[], name: string, before: string | null): string[] | null {
  const k = nameKey(name);
  if (!names.some((n) => nameKey(n) === k)) return null;
  const moved = names.find((n) => nameKey(n) === k)!;
  const rest = names.filter((n) => nameKey(n) !== k);
  const at = before === null ? -1 : rest.findIndex((n) => nameKey(n) === nameKey(before));
  if (before !== null && nameKey(before) === k) return null;
  const out = at < 0 ? [...rest, moved] : [...rest.slice(0, at), moved, ...rest.slice(at)];
  return same(unique(out), unique(names)) ? null : out;
}

/** `Move view left / right` by `delta` tabs; null at the ends (never before `All`). */
export function viewsAfterMove(names: readonly string[], name: string, delta: number): string[] | null {
  const tabs = unique(names);
  const i = tabs.findIndex((n) => nameKey(n) === nameKey(name));
  const j = i + delta;
  if (i < 0 || delta === 0 || j < 0 || j >= tabs.length) return null;
  const before = delta < 0 ? tabs[j] : tabs[j + 1] ?? null;
  return viewsAfterDrop(names, name, before);
}

/** `Remove from <plural> page`: every copy goes (R184); `[]` after the last (the key stays, AP-1498); null when absent. */
export function viewsAfterRemove(names: readonly string[], name: string): string[] | null {
  const k = nameKey(name);
  const out = names.filter((n) => nameKey(n) !== k);
  return out.length === names.length ? null : out;
}

/** A new tab right after `after` (null: last): New view, Show a saved query, Duplicate (D-1788). */
export function viewsAfterInsert(names: readonly string[], name: string, after: string | null): string[] | null {
  if (names.some((n) => nameKey(n) === nameKey(name))) return null;
  const i = after === null ? -1 : names.findIndex((n) => nameKey(n) === nameKey(after));
  return i < 0 ? [...names, nfc(name)] : [...names.slice(0, i + 1), nfc(name), ...names.slice(i + 1)];
}

/** `Add view › Show a saved query` (D-1763, AP-1515): the queries that aren't tabs yet, enabled or greyed with a
 *  reason (the type reason first), each list by title. */
export function savedOffers(typeKey: string, summaries: readonly QuerySummaryDto[], tabs: readonly ViewTab[]):
  { enabled: QuerySummaryDto[]; greyed: { summary: QuerySummaryDto; reason: OfferReason }[] } {
  const k = nfc(typeKey);
  const taken = new Set(tabs.map((tb) => tb.key));
  const enabled: QuerySummaryDto[] = [];
  const greyed: { summary: QuerySummaryDto; reason: OfferReason }[] = [];
  for (const s of summaries) {
    if (taken.has(nameKey(s.name))) continue;
    const types = s.types?.map(nfc) ?? null;
    let reason: OfferReason | null = null;
    if (s.state === 'unreadable' || types === null) reason = 'unreadable';
    else if (types.length === 0) reason = 'allTypes';
    else if (types.length > 1) reason = 'severalTypes';
    else if (types[0] !== k) reason = 'otherType';
    else if (s.usesThis) reason = 'needsNote';
    if (reason === null) enabled.push(s);
    else greyed.push({ summary: s, reason });
  }
  const coll = new Intl.Collator(catalogLocale(), { sensitivity: 'base', numeric: true });
  const title = (s: QuerySummaryDto) => nfc(s.title || s.name);
  enabled.sort((a, b) => coll.compare(title(a), title(b)));
  greyed.sort((a, b) => coll.compare(title(a.summary), title(b.summary)));
  return { enabled, greyed };
}

/** The Queries page's `<plural> page` marks (D-1764, D-1818): name key → the plurals of the type pages listing it. */
export function pageMarks(types: readonly TypeDto[], _summaries: readonly QuerySummaryDto[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const ty of types) {
    if (!hasViews(ty.key, ty) || ty.viewsUnreadable || !ty.views) continue;
    for (const n of unique(ty.views)) {
      const list = out.get(nameKey(n)) ?? [];
      list.push(ty.plural);
      out.set(nameKey(n), list);
    }
  }
  return out;
}

/** D-1769: the groupable keys, Select (incl. `status`), multi-select and relation attributes in schema order, then
 *  `tags` (FR-QRY-01 AC-13). */
export function groupByChoices(type: TypeDto | null | undefined): string[] {
  const out: string[] = [];
  for (const a of type?.attributes ?? []) if (a.type === 'select' || a.type === 'multi-select' || a.type === 'relation') out.push(nfc(a.key));
  return [...out, 'tags'];
}

/** D-1783: the first Select in schema order, else the first multi-select, else `tags`. */
export function defaultGroupBy(type: TypeDto | null | undefined): string {
  const attrs = type?.attributes ?? [];
  const sel = attrs.find((a) => a.type === 'select') ?? attrs.find((a) => a.type === 'multi-select');
  return sel ? nfc(sel.key) : 'tags';
}

/** `Add view › Table | List | Board` (D-1781, D-1783): the new view's definition. */
export function newViewDef(type: TypeDto, kind: 'table' | 'list' | 'board', _typesAll?: readonly TypeDto[]): QueryDefDto {
  const board = kind === 'board';
  const groupBy = board ? defaultGroupBy(type) : null;
  const columns = board ? type.preview.map(nfc).filter((k, i, a) => k !== groupBy && a.indexOf(k) === i) : effectiveColumns(type);
  return {
    title: t('views.newName'), types: [nfc(type.key)], match: 'all', filters: [], sort: [{ by: 'modified', order: 'desc' }], limit: 50, view: kind,
    groupBy, lanes: 'vertical', laneOrder: null, columns,
  };
}
