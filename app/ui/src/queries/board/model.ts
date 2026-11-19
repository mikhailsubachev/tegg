// Slice Q2: the pure board model (docs/contracts/v1-views.md §4.2, §4.5; R187; D-1769, D-1791, D-1792, D-1805, D-1811,
// D-1817). The lanes come from the core (`QueryResultDto.group`); the UI never re-groups, it only decides what a drop,
// a lane drag or a new object from a lane writes.
import type { BoardMove } from '@tegg/doc';
import type { GroupingDto, LaneDto, QueryDefDto } from '../../ipc/queries';
import type { TypeDto } from '../../ipc/types';
import { prefill } from '../model';

const nfc = (s: string) => s.normalize('NFC');
const laneOf = (g: GroupingDto, id: string): LaneDto | undefined => g.lanes.find((l) => l.id === id);
/** Select and a single relation hold one value; multi-select, a multiple relation and tags hold a list. */
const isList = (g: GroupingDto) => g.kind === 'multiSelect' || g.kind === 'tags' || (g.kind === 'relation' && g.multiple);

/** What a card dropped from `fromLaneId` on `toLaneId` writes (D-1769): a scalar kind sets the target's value; a list
 *  kind removes the values that placed the card (`raw`) and adds the target's value unless the card is already there;
 *  `alt` (list kinds) only adds. Null: no drop target, the same lane, or nothing to change. */
export function cardMove(group: GroupingDto, row: number, fromLaneId: string, toLaneId: string, alt: boolean): BoardMove | null {
  if (fromLaneId === toLaneId) return null;
  const to = laneOf(group, toLaneId);
  if (!to || !to.dropTarget || to.value === null) return null;
  const from = laneOf(group, fromLaneId);
  const raw = from?.cards.find((c) => c.row === row)?.raw ?? [];
  const key = nfc(group.key);
  if (!isList(group)) return { key, shape: 'scalar', remove: [...raw], add: to.value };
  const there = to.cards.some((c) => c.row === row);
  const remove = alt ? [] : [...raw];
  const add = there ? null : to.value;
  if (remove.length === 0 && add === null) return null;
  return { key, shape: 'list', remove, add };
}

/** `lane_order` after a lane drag (AP-1508, D-1792): every lane's `value` but `none`, `laneId` right before `beforeId`
 *  (null: last, still before `none`). Null when `none` is dragged or nothing changes. */
export function laneOrderAfterDrop(group: GroupingDto, laneId: string, beforeId: string | null): string[] | null {
  const movable = group.lanes.filter((l) => l.kind !== 'none' && l.value !== null);
  const lane = movable.find((l) => l.id === laneId);
  if (!lane || beforeId === laneId) return null;
  const rest = movable.filter((l) => l.id !== laneId);
  const at = beforeId === null ? -1 : rest.findIndex((l) => l.id === beforeId);
  const order = at < 0 ? [...rest, lane] : [...rest.slice(0, at), lane, ...rest.slice(at)];
  const now = movable.map((l) => l.id);
  if (order.every((l, i) => l.id === now[i])) return null;
  return order.map((l) => l.value as string);
}

/** `Move card to next / previous lane` (D-1817): the nearest drop target in `dir` (+1 next, −1 previous); excluded
 *  lanes are targets (AP-1510); unknown, unresolved and `none` lanes are skipped; null at the ends. */
export function neighbourDropLane(group: GroupingDto, laneId: string, dir: 1 | -1): LaneDto | null {
  const i = group.lanes.findIndex((l) => l.id === laneId);
  if (i < 0) return null;
  for (let j = i + dir; j >= 0 && j < group.lanes.length; j += dir) if (group.lanes[j].dropTarget) return group.lanes[j];
  return null;
}

/** `New <Type> in <lane>` (§4.5, FR-QRY-08 AC-2): slice Q's pre-fill (top-level Select `is` values, D-1439) with the
 *  lane's value on the grouping key. */
export function prefillFor(def: QueryDefDto, group: GroupingDto, laneId: string, type: TypeDto | null | undefined): { type: string; values: [string, unknown][] } | null {
  const lane = laneOf(group, laneId);
  if (!lane || lane.value === null || !lane.dropTarget || lane.excluded) return null;
  const base = prefill(def, null, type ? [type] : undefined);
  const key = nfc(group.key);
  const value: unknown = group.kind === 'select' || (group.kind === 'relation' && !group.multiple) ? lane.value : [lane.value];
  const values: [string, unknown][] = [[key, value], ...(base?.values ?? []).filter(([k]) => nfc(k) !== key)];
  return { type: base?.type ?? (def.types[0] ?? type?.key ?? ''), values };
}

/** `board.excludedLong`'s `{values}` (D-1811): the labels of the option lanes that aren't excluded, in lane order. */
export function excludedValues(group: GroupingDto): string[] {
  return group.lanes.filter((l) => l.kind === 'option' && !l.excluded).map((l) => l.label);
}
