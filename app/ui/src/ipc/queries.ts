// Slice Q (docs/contracts/v1-queries.md §2): the saved-query DTOs, hand-written as pins.ts.
import type { CardDataDto, LinkTargetDto, TaskDefsDto, TaskRowDto, TypeDto, VersionDto } from './types';

export type QueryOp = 'is' | 'is_not' | 'contains' | 'is_empty' | 'is_not_empty' | 'is_any_of' | 'has_any_of' | 'has_all_of'
  | 'has_none_of' | 'before' | 'after' | 'between' | 'today' | 'this_week' | 'within_next_days' | 'overdue'
  | 'eq' | 'ne' | 'lt' | 'gt' | 'links_to'
  /** Slice Q2-T (v1-views §24.1, AP-1533): an object's state for a Select that carries states. */
  | 'state_is' | 'state_is_not';
/** Slice Q2-T (v1-views §27.2): the done lane of a board (R201). */
export type DoneLaneDto = { withinDays: number; folded: boolean };
export type FilterItemDto =
  | { kind: 'filter'; key: string; op: QueryOp; value: unknown; src: number[] | null }
  | { kind: 'group'; match: 'all' | 'any'; filters: FilterItemDto[]; src: number[] | null }
  | { kind: 'raw'; src: number[] };
/** One sort level (v1-views §2, D-1768). */
export type SortDto = { by: string; order: 'asc' | 'desc' };
/** Slice Q3 (v1-views §39.2, D-2172): `wall` replaces `board` (the old word is read as `wall`, D-2179). */
export type QueryViewKind = 'list' | 'table' | 'wall';
/** Slice Q3: `columns` / `rows` replace `vertical` / `horizontal`. */
export type LanesDto = 'columns' | 'rows';
/** Slice Q3 (v1-views §39.2): a usage's own grouping. */
/** The board component's direction (`data-lanes` keeps `vertical` / `horizontal`, v1-views §45 choice 4). */
export const lanesDir = (l: LanesDto): 'vertical' | 'horizontal' => (l === 'rows' ? 'horizontal' : 'vertical');
export const lanesOf = (d: 'vertical' | 'horizontal'): LanesDto => (d === 'horizontal' ? 'rows' : 'columns');
export type UsageGroupDto = { none: true } | { none: false; key: string; period: boolean };
export type QueryDefDto = {
  title: string; types: string[]; match: 'all' | 'any'; filters: FilterItemDto[];
  /** The levels as written (repeats kept); a missing or broken `sort` reads as `[modified desc]` (v1-views §1.2). */
  sort: SortDto[]; limit: number; view: QueryViewKind;
  /** Slice Q2 (v1-views §1.1): `group_by` as written (null: absent or broken), `lanes`, `lane_order` (null: absent). */
  groupBy: string | null; lanes: LanesDto; laneOrder: string[] | null;
  columns: string[];
  /** Slice Q2-T (v1-views §24.1, CP-23): `group_by` was the mapping `{ <key>: period }`; false when `groupBy` is null. */
  groupPeriod: boolean;
  /** Slice Q2-T (v1-views §24.1): null = absent or broken. */
  doneLane: DoneLaneDto | null;
  /** Slice Q3 (CP-32, D-2197): the file says `group_by: none`; a commit with a null `groupBy` and `groupNone: true`
   *  removes a valid `group_by` line. Missing reads as false. */
  groupNone?: boolean;
};
/** Slice Q2 (v1-views §2): one card of a lane; `row` indexes `QueryResultDto.rows`, `raw` the values that placed it. */
export type LaneCardDto = { row: number; raw: string[] };
export type LaneKindDto = 'option' | 'unknown' | 'tag' | 'relation' | 'unresolved' | 'none' | 'period' | 'done';
/** Slice Q2-T (v1-views §27.2): one day of the `period:week` lane. */
export type DayGroupDto = { date: string; cards: LaneCardDto[] };
export type LaneDto = {
  id: string; kind: LaneKindDto;
  value: string | null; label: string; color: string | null; target: string | null;
  excluded: boolean; dropTarget: boolean; cards: LaneCardDto[];
  /** Slice Q2-T: the `period:week` lane's day groups (tomorrow … the week's last day, empty ones included); [] otherwise. */
  days: DayGroupDto[];
  /** Slice Q2-T: the done lane's and the limited Done-state option lanes' `within_days`; null otherwise. */
  doneWithin: number | null;
};
export type GroupingDto = {
  key: string; kind: 'select' | 'multiSelect' | 'tags' | 'relation' | 'period'; multiple: boolean; name: string; lanes: LaneDto[];
  /** Slice Q2-T: a period grouping by a Date-time attribute, `created` or `modified` (CP-25). */
  dateTime: boolean;
};
/** A type file whose `views:` lists a query (v1-views §1.5, D-1804). */
export type ViewUsageDto = { type: string; path: string };
export type BrokenReason = 'badValue' | 'shape' | 'operator' | 'nestedGroup' | 'notAttribute' | 'operatorKind' | 'value' | 'noType';
export type BrokenDto = { reason: BrokenReason; at: number[] | null; key: string; type: string | null };
export type LookupDto = 'ok' | 'newer' | 'unreadable' | 'missing' | 'trashed';
export type QuerySummaryDto = {
  name: string; title: string; path: string; state: 'ok' | 'newer' | 'unreadable'; line: number | null;
  created: string | null; modified: string | null; usesThis: boolean; version: VersionDto;
  /** Slice Q2 (v1-views §2): null when unreadable. */
  view: QueryViewKind | null; types: string[] | null;
};
export type QueryDto = {
  name: string; path: string; state: LookupDto; line: number | null; reason: string | null;
  version: VersionDto | null; text: string | null; def: QueryDefDto | null; broken: BrokenDto[]; usesThis: boolean;
  created: string | null; modified: string | null; trashedPath: string | null;
};
export type QuerySourceDto =
  | { kind: 'saved'; name: string }
  | { kind: 'fence'; body: string }
  | { kind: 'def'; def: QueryDefDto; name: string | null }
  /** Slice Q2.1 (v1-views §17.3, D-1853): a view tab, the first `views:` item named `name` of type `type`. */
  | { kind: 'view'; type: string; name: string };
export type QueryEnvDto = { today: string; zone: string; weekStart: number; locale: string };
export type QueryTaskDto = { status: string | null; state: 'open' | 'in-progress' | 'done' | 'cancelled'; due: string | null };
export type QueryRowDto = {
  path: string; id: string | null; title: string; type: string; created: string | null; modified: string | null;
  values: Record<string, unknown>; links: LinkTargetDto[]; task: QueryTaskDto | null;
  /** Slice Q2 (v1-views §1.1): the index's version (the card move's base), the excerpt, not UTF-8. */
  version: VersionDto; excerpt: string; readOnly: boolean;
  /** Slice Q2-T (v1-views §24.1): the object's tag keys (NFC, case-folded), sorted, unique. */
  tags: string[];
  /** Slice Q2-T (CP-24): ms5-tasks' row for an object of type `task`; null otherwise. */
  taskRow: TaskRowDto | null;
  /** Slice OC (v1-cards §3.3): the card data on board runs; null on List and Table runs. */
  card: CardDataDto | null;
};
export type QueryResultDto = {
  form: 'reference' | 'inline' | 'unreadable' | 'empty' | 'def'; name: string | null; lookup: LookupDto | null;
  line: number | null; version: VersionDto | null; def: QueryDefDto | null;
  state: 'ok' | 'noType' | 'needsHost' | 'needsContext'; broken: BrokenDto[]; targets: string[];
  usesRelative: boolean; total: number; rows: QueryRowDto[]; indexReady: boolean;
  /** Slice Q2 (v1-views §1.6): the board's lanes; null unless `view: board` with a valid `group_by`. */
  group: GroupingDto | null;
  /** Slice Q2.1 (v1-views §17.1, D-1854): the usage's own and effective values; null for `query/<name>`, the editor's
   *  preview, inline fences and missing, trashed or unreadable queries. `def` stays the query file's. */
  usage: UsageRunDto | null;
  /** Slice Q2-T (CP-24): the Task definitions when any row has `taskRow`; else null. */
  taskDefs: TaskDefsDto | null;
};
/** Slice Q2-T (v1-views §25.3, §27.2): what `task_views_restore` did; `type` is the Task type after the write. */
export type TaskViewsRestoreDto = { created: string[]; names: string[] | null; before: string | null; type: TypeDto };
/** Slice Q2.1 (v1-views §17.3): a usage's run (R194). */
export type UsageRunDto = {
  kind: 'tab' | 'block';
  /** Own values as read: null = absent, or present with a broken shape (then in `broken`). */
  own: {
    sort: SortDto[] | null; columns: string[] | null;
    /** Slice Q3 (v1-views §39.2). */
    view: QueryViewKind | null; group: UsageGroupDto | null; lanes: LanesDto | null; laneOrder: string[] | null; widths: [string, number][] | null;
  };
  /** `{ reason: 'badValue', key }`, at most one per key. */
  broken: BrokenDto[];
  /** Effective: the own valid value, else the query file's. */
  sort: SortDto[];
  /** Effective (unknown keys kept). */
  columns: string[];
  /** Slice Q3 effective values: `groupBy` null = not grouped; `widths` the own valid widths, else none. */
  view: QueryViewKind; groupBy: string | null; groupPeriod: boolean; lanes: LanesDto; laneOrder: string[] | null; widths: [string, number][];
};
export type QueryUsageDto = { path: string; title: string; type: string | null; template: boolean };
/** `query:stale` (§1.7): the changed objects' types before and after, and their paths. */
export type QueryStaleDto = { types: string[]; paths: string[] };
export type QueryErrorKind = 'Conflict' | 'Gone' | 'NewerVersion' | 'Unreadable' | 'NameTaken' | 'EmptyName' | 'NotFound' | 'Limit' | 'NothingToDo' | 'Io' | 'NoVault' | 'IndexNotReady';
