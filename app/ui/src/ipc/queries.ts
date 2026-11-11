// Slice Q (docs/contracts/v1-queries.md §2): the saved-query DTOs, hand-written as pins.ts.
import type { LinkTargetDto, VersionDto } from './types';

export type QueryOp = 'is' | 'is_not' | 'contains' | 'is_empty' | 'is_not_empty' | 'is_any_of' | 'has_any_of' | 'has_all_of'
  | 'has_none_of' | 'before' | 'after' | 'between' | 'today' | 'this_week' | 'within_next_days' | 'overdue'
  | 'eq' | 'ne' | 'lt' | 'gt' | 'links_to';
export type FilterItemDto =
  | { kind: 'filter'; key: string; op: QueryOp; value: unknown; src: number[] | null }
  | { kind: 'group'; match: 'all' | 'any'; filters: FilterItemDto[]; src: number[] | null }
  | { kind: 'raw'; src: number[] };
export type QueryDefDto = {
  title: string; types: string[]; match: 'all' | 'any'; filters: FilterItemDto[];
  sort: { by: string; order: 'asc' | 'desc' }; limit: number; view: 'list' | 'table'; columns: string[];
};
export type BrokenReason = 'badValue' | 'shape' | 'operator' | 'nestedGroup' | 'notAttribute' | 'operatorKind' | 'value' | 'noType';
export type BrokenDto = { reason: BrokenReason; at: number[] | null; key: string; type: string | null };
export type LookupDto = 'ok' | 'newer' | 'unreadable' | 'missing' | 'trashed';
export type QuerySummaryDto = {
  name: string; title: string; path: string; state: 'ok' | 'newer' | 'unreadable'; line: number | null;
  created: string | null; modified: string | null; usesThis: boolean; version: VersionDto;
};
export type QueryDto = {
  name: string; path: string; state: LookupDto; line: number | null; reason: string | null;
  version: VersionDto | null; text: string | null; def: QueryDefDto | null; broken: BrokenDto[]; usesThis: boolean;
  created: string | null; modified: string | null; trashedPath: string | null;
};
export type QuerySourceDto =
  | { kind: 'saved'; name: string }
  | { kind: 'fence'; body: string }
  | { kind: 'def'; def: QueryDefDto; name: string | null };
export type QueryEnvDto = { today: string; zone: string; weekStart: number; locale: string };
export type QueryTaskDto = { status: string | null; state: 'open' | 'in-progress' | 'done' | 'cancelled'; due: string | null };
export type QueryRowDto = {
  path: string; id: string | null; title: string; type: string; created: string | null; modified: string | null;
  values: Record<string, unknown>; links: LinkTargetDto[]; task: QueryTaskDto | null;
};
export type QueryResultDto = {
  form: 'reference' | 'inline' | 'unreadable' | 'empty' | 'def'; name: string | null; lookup: LookupDto | null;
  line: number | null; version: VersionDto | null; def: QueryDefDto | null;
  state: 'ok' | 'noType' | 'needsHost' | 'needsContext'; broken: BrokenDto[]; targets: string[];
  usesRelative: boolean; total: number; rows: QueryRowDto[]; indexReady: boolean;
};
export type QueryUsageDto = { path: string; title: string; type: string | null; template: boolean };
/** `query:stale` (§1.7): the changed objects' types before and after, and their paths. */
export type QueryStaleDto = { types: string[]; paths: string[] };
export type QueryErrorKind = 'Conflict' | 'Gone' | 'NewerVersion' | 'Unreadable' | 'NameTaken' | 'EmptyName' | 'NotFound' | 'Limit' | 'NothingToDo' | 'Io' | 'NoVault' | 'IndexNotReady';
