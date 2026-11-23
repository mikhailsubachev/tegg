// Slice Q3: the pure display and grouping model (docs/contracts/v1-views.md §40.1 `views/display.ts`; R220…R226;
// D-2172…D-2209). A usage (a view tab, a reference block) has its own `view`, `group_by`, `lanes`, `lane_order` and
// `widths` over the query file's defaults; `query/<name>` shows the defaults; `All <plural>` keeps its display and
// grouping on this Mac (D-2178). Effective values come from the run (`QueryResultDto.usage`, else `def`); the core
// groups for every display (`QueryResultDto.group`), the UI only decides what to draw and what a change writes.
import { t } from '../i18n/catalog';
import type { AllViewDto, TypeDto, UiStateDto } from '../ipc/types';
import type { GroupingDto, LaneDto, LaneKindDto, LanesDto, QueryDefDto, QueryResultDto, QueryViewKind, SortDto, UsageRunDto } from '../ipc/queries';
import { laneOrderAfterDrop } from '../queries/board/model';
import { sortKeyName } from '../queries/SortPopover';
import { clampWidth } from '../tables/widths';
import { effectiveColumns } from '../types/columns';
import { groupByChoices, periodChoices } from './model';

export type Display = QueryViewKind;
export type Grouping = { key: string; period: boolean } | null;
export type GroupChoice = { id: string; key: string | null; period: boolean };
export type GroupView = {
  id: string; kind: LaneKindDto; label: string; value: string | null; color: string | null; target: string | null;
  count: number; rows: number[]; grip: boolean;
};
export type OwnState = 'own' | 'broken' | null;
type RunLike = Pick<QueryResultDto, 'def' | 'usage'> & Partial<Pick<QueryResultDto, 'group' | 'broken'>>;

const nfc = (s: string) => s.normalize('NFC');
/** `board` (0.6.0) reads as `wall` (D-2179). */
const asDisplay = (v: string | null | undefined): Display => (v === 'table' || v === 'list' ? v : v === 'wall' || v === 'board' ? 'wall' : 'list');
const asLanes = (v: string | null | undefined): LanesDto => (v === 'rows' || v === 'horizontal' ? 'rows' : 'columns');

/** R220: the usage's effective display, else the query file's. */
export function effectiveDisplay(r: RunLike): Display {
  if (r.usage) return asDisplay(r.usage.view);
  return asDisplay(r.def?.view);
}

/** R220: the effective grouping (null: not grouped). */
export function effectiveGrouping(r: RunLike): Grouping {
  const u = r.usage;
  if (u) return u.groupBy ? { key: nfc(u.groupBy), period: !!u.groupPeriod } : null;
  const d = r.def;
  return d && d.groupBy ? { key: nfc(d.groupBy), period: !!d.groupPeriod } : null;
}

/** Grouped: a valid effective grouping the core resolved (`group` is Some, §41.2). */
export function isGrouped(r: RunLike): boolean {
  return effectiveGrouping(r) !== null && (r.group === undefined || r.group !== null);
}

export function effectiveLanes(r: RunLike): LanesDto {
  return asLanes(r.usage ? r.usage.lanes : r.def?.lanes);
}

export function effectiveLaneOrder(r: RunLike): string[] | null {
  return r.usage ? r.usage.laneOrder : (r.def?.laneOrder ?? null);
}

/** A usage's own valid widths; none on `query/<name>` (machine-local there). */
export function effectiveWidths(r: RunLike): [string, number][] {
  return r.usage ? [...(r.usage.widths ?? [])] : [];
}

const OWN_KEYS = { view: 'view', group: 'group_by', lanes: 'lanes', laneOrder: 'lane_order', widths: 'widths' } as const;
type OwnKey = keyof typeof OWN_KEYS;

/** Which of the five keys the usage has (own: valid; broken: present, unreadable); all null without a usage. */
export function ownKeys(r: RunLike): Record<OwnKey, OwnState> {
  const out = { view: null, group: null, lanes: null, laneOrder: null, widths: null } as Record<OwnKey, OwnState>;
  const u = r.usage;
  if (!u) return out;
  for (const k of Object.keys(OWN_KEYS) as OwnKey[]) {
    const v = (u.own as Record<string, unknown>)[k];
    if (v === 'broken') out[k] = 'broken';
    else if (v !== null && v !== undefined) out[k] = 'own';
    else if (u.broken.some((b) => b.key === OWN_KEYS[k])) out[k] = 'broken';
  }
  return out;
}

/** R223: the Group menu's choices: `None`, then the single type's Select, multi-select and relation attributes, `Tags`,
 *  each Date / Date-time attribute by period, `Created`, `Modified` by period; several types: `None`, `Tags`,
 *  `Created` and `Modified` by period. An attribute keyed `none` isn't listed (CP-37, D-2202). */
export function groupChoices(type: TypeDto | null | undefined, queryTypes: readonly string[]): GroupChoice[] {
  const out: GroupChoice[] = [{ id: 'none', key: null, period: false }];
  const one = queryTypes.length === 1 && !!type && nfc(queryTypes[0]!) === nfc(type.key);
  const keys = one ? groupByChoices(type) : ['tags'];
  const periods = one ? periodChoices(type) : ['created', 'modified'];
  for (const k of keys) if (k !== 'none') out.push({ id: k, key: k, period: false });
  for (const k of periods) if (k !== 'none') out.push({ id: `period:${k}`, key: k, period: true });
  return out;
}

/** A choice's (or grouping's) name: `None`, an attribute's Name, `Tags`, `<Name> · by period`. */
export function groupName(choice: { key: string | null; period: boolean } | null, type: TypeDto | null | undefined): string {
  if (!choice || choice.key === null) return t('group.none');
  const name = sortKeyName(choice.key, type).label;
  return choice.period ? t('group.byPeriod', { attribute: name }) : name;
}

/** R225: the groups a grouped Table or List draws: the core's lanes with ≥ 1 row (D-2184), in group order; periods
 *  flat (the week lane's rows in `rows` order, D-2181); no grip on `none` and `done`. */
export function groupModel(r: Pick<QueryResultDto, 'group'>, _display: Display): GroupView[] {
  const g = r.group;
  if (!g) return [];
  const out: GroupView[] = [];
  for (const l of g.lanes) {
    if (l.excluded) continue;
    const rows: number[] = [];
    for (const c of l.cards) if (!rows.includes(c.row)) rows.push(c.row);
    if (rows.length === 0) continue;
    out.push({
      id: nfc(l.id), kind: l.kind, label: nfc(l.label), value: l.value === null ? null : nfc(l.value), color: l.color, target: l.target === null ? null : nfc(l.target),
      count: rows.length, rows, grip: l.kind !== 'none' && l.kind !== 'done',
    });
  }
  return out;
}

const nfcLane = (l: LaneDto): LaneDto => ({ ...l, id: nfc(l.id), label: nfc(l.label), value: l.value === null ? null : nfc(l.value) });

/** The `lane_order` a group-header drop writes (= part one's `laneOrderAfterDrop`); null when nothing changes. */
export function laneOrderForGroupDrop(group: GroupingDto, laneId: string, beforeId: string | null): string[] | null {
  const g: GroupingDto = { ...group, lanes: group.lanes.map(nfcLane) };
  return laneOrderAfterDrop(g, nfc(laneId), beforeId === null ? null : nfc(beforeId));
}

/** `Reset lane order` on a usage (D-2192): `[]` when the query file has a `lane_order`, else null (remove the key). */
export function resetLaneOrderChange(r: Pick<QueryResultDto, 'def'>): string[] | null {
  return r.def && r.def.laneOrder !== null ? [] : null;
}

/** Applies to a List or Table without grouping (D-2189). */
export function limitApplies(display: Display, grouped: boolean): boolean {
  return !grouped && display !== 'wall';
}

// R221's key order, then slice Q's rank for the shared keys.
const NOTICE_ORDER = ['view', 'group_by', 'lanes', 'lane_order', 'sort', 'columns', 'widths', 'title', 'types', 'match', 'filters', 'limit', 'done_lane'];

/** D-2194 (g): the usage's broken keys that the effective display uses, one each, in R221 order. */
export function noticeKeys(r: RunLike): string[] {
  const u = r.usage;
  if (!u) return [];
  const display = effectiveDisplay(r);
  const grouped = isGrouped(r);
  const uses = (k: string) => {
    switch (k) {
      case 'view': case 'group_by': case 'sort': return true;
      case 'lanes': return grouped && display === 'wall';
      case 'lane_order': case 'done_lane': return grouped;
      case 'widths': return display === 'table';
      case 'columns': return display !== 'wall';
      case 'limit': return limitApplies(display, grouped);
      default: return true;
    }
  };
  const keys = [...new Set(u.broken.map((b) => b.key))].filter(uses);
  const rank = (k: string) => { const i = NOTICE_ORDER.indexOf(k); return i < 0 ? NOTICE_ORDER.length : i; };
  return keys.sort((a, b) => rank(a) - rank(b));
}

/** §33.2: where a usage's change goes (RT-2, D-2205). */
export function writeRoute(usage: UsageRunDto | { kind: 'tab' | 'block' } | null | 'all'): 'item' | 'fence' | 'query' | 'thisMac' {
  if (usage === 'all') return 'thisMac';
  if (!usage) return 'query';
  return usage.kind === 'tab' ? 'item' : 'fence';
}

/** Type settings › Views (D-2194 (b)): `Wall · by Status`, `Table`. */
export function viewKindText(display: Display, attributeName: string | null): string {
  const d = t(`views.kind.${display}`);
  return attributeName ? t('typeSettings.viewKindBy', { display: d, attribute: attributeName }) : d;
}

/** D-2190, §41.6: the widths a resize writes: the own valid widths, else the 0.6.0 entry, else none; the change applied
 *  (only the changed width clamped); Title first, then the table's column order, then other stored keys. */
export function widthsToWrite(own: [string, number][] | null, legacy: Record<string, number> | null | undefined,
  change: { key: string; width: number }, order: readonly string[]): [string, number][] {
  const base: [string, number][] = own ? own.map(([k, w]) => [nfc(k), w]) : legacy ? Object.entries(legacy).filter(([, w]) => typeof w === 'number').map(([k, w]) => [nfc(k), w as number]) : [];
  const key = nfc(change.key);
  const map = new Map<string, number>();
  for (const [k, w] of base) if (!map.has(k)) map.set(k, w);
  map.set(key, clampWidth(key, change.width));
  return orderWidths(map, order, base.map(([k]) => k));
}

/** Pairs in R221's order: `title`, the column order, then the other keys as stored. */
export function orderWidths(map: Map<string, number>, order: readonly string[], stored: readonly string[]): [string, number][] {
  const keys: string[] = [];
  const add = (k: string) => { if (map.has(k) && !keys.includes(k)) keys.push(k); };
  add('title');
  for (const k of order) add(nfc(k));
  for (const k of stored) add(k);
  for (const k of map.keys()) add(k);
  return keys.map((k) => [k, map.get(k)!]);
}

const ALL_DEFAULT: AllViewDto = { view: 'table', groupBy: null, groupPeriod: false, lanes: 'columns' };

/** D-2178: `All <plural>`'s display and grouping on this Mac (missing: a Table, not grouped). */
export function allViewOf(ui: Pick<UiStateDto, 'allView'> | null | undefined, typeKey: string): AllViewDto {
  const v = ui?.allView?.[nfc(typeKey)];
  if (!v) return { ...ALL_DEFAULT };
  return { view: asDisplay(v.view), groupBy: v.groupBy ? nfc(v.groupBy) : null, groupPeriod: !!v.groupBy && !!v.groupPeriod, lanes: asLanes(v.lanes) };
}

/** CP-34, D-2199: the def `All <plural>` runs when it isn't an ungrouped Table. */
export function allDef(type: TypeDto, allView: AllViewDto, typeSort: SortDto[]): QueryDefDto {
  return {
    title: type.plural || type.name, types: [nfc(type.key)], match: 'all', filters: [], sort: typeSort, limit: 50,
    view: asDisplay(allView.view), groupBy: allView.groupBy, groupPeriod: !!allView.groupBy && allView.groupPeriod, groupNone: false,
    lanes: asLanes(allView.lanes), laneOrder: null, columns: effectiveColumns(type), doneLane: null,
  };
}
