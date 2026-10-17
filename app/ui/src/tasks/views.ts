// Slice 5A-1: task bucketing for the Schedule, the Kanban, the filters and the labels (docs/contracts/ms5-tasks.md §4;
// R41, R42, R44, D-474…D-477). Pure TypeScript. Stubs until 5A-1 is built: empty or wrong results so the red tests fail
// on their assertions (TS-I1).
import type { TaskDefsDto, TaskRowDto } from '../ipc/types';

export type TaskState = 'open' | 'in-progress' | 'done' | 'cancelled';

export type ViewInput = {
  tasks: TaskRowDto[];
  defs: TaskDefsDto;
  /** `YYYY-MM-DD`, the local date. */
  today: string;
  /** 1 = Monday … 7 = Sunday. */
  firstWeekday: number;
  collator: Intl.Collator;
  dateFilter: 'all' | 'today' | 'week';
  /** Tag keys. */
  tagFilter: string[];
  timeZone?: string;
};

export type Schedule = {
  today: { overdue: TaskRowDto[]; today: TaskRowDto[] };
  week: { date: string; tasks: TaskRowDto[] }[];
  weekRange: { from: string; to: string } | null;
  later: TaskRowDto[];
  none: TaskRowDto[];
  done: TaskRowDto[];
};

export type KanbanColumn = {
  /** The status label, `#<tag>`, `no-tag` or `no-status`. */
  id: string;
  label: string;
  color: string | null;
  state: TaskState | null;
  dropTarget: boolean;
  tasks: TaskRowDto[];
};

export type Counts = { open: number; overdue: number; dueToday: number; all: number; today: number; week: number; tags: { key: string; label: string; count: number }[] };

export function schedule(_i: ViewInput): Schedule {
  return { today: { overdue: [], today: [] }, week: [], weekRange: null, later: [], none: [], done: [] };
}

export function kanban(_i: ViewInput, _groupBy: 'status' | 'tag', _tagSpelling: Map<string, string>): { columns: KanbanColumn[] } {
  return { columns: [] };
}

export function counts(_i: ViewInput): Counts {
  return { open: 0, overdue: 0, dueToday: 0, all: 0, today: 0, week: 0, tags: [] };
}

export function isOverdue(_t: TaskRowDto, _today: string): boolean {
  return false;
}

export function dueLabel(_t: TaskRowDto, _today: string, _region: string): { text: string; tone: 'overdue' | 'today' | 'plain' | 'invalid' | 'done' } {
  return { text: '', tone: 'plain' };
}
