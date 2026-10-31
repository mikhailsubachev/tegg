// Slice 5A-1: task bucketing for the Schedule, the Kanban, the filters and the labels (docs/contracts/ms5-tasks.md §4;
// R41, R42, R44, D-474…D-477). Pure TypeScript: one implementation for the page, the daily section and the tests.
import { addDays, localDate, parseInstant } from '@tegg/doc';
import { t } from '../i18n/catalog';
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
  /** The title search (D-1280): the Schedule and the Kanban only; `counts` ignores it (D-1281). */
  search?: string;
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

/** Folded as the type page's title filter (FR-TYP-09 AC-4): NFC, lower case, marks removed. */
const fold = (s: string) => s.normalize('NFC').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
/** Whether a row's title contains the search (D-1280); a blank search keeps every row. */
export function matches(r: TaskRowDto, search: string | undefined): boolean {
  const q = fold(search?.trim() ?? '');
  return !q || fold(r.title).includes(q);
}

const isOpen = (r: TaskRowDto) => r.state === 'open' || r.state === 'in-progress';
const bytes = (s: string) => new TextEncoder().encode(s.normalize('NFC'));
function byteOrder(a: string, b: string): number {
  const x = bytes(a);
  const y = bytes(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}

/** ISO weekday of a date, 1 = Monday … 7 = Sunday. */
function isoDay(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
}

/** The current week by the region's first weekday (D-329, D-474): its first day and its last day. */
export function weekOf(today: string, firstWeekday: number): { first: string; last: string } {
  const back = (isoDay(today) - firstWeekday + 7) % 7;
  const first = addDays(today, -back);
  return { first, last: addDays(first, 6) };
}

/** The local date a Done task was completed (`completed`, else `modified`, D-472). */
export function completedDate(r: TaskRowDto, timeZone?: string): string | null {
  for (const v of [r.completed, r.modified]) {
    const ms = v ? parseInstant(v, timeZone) : null;
    if (ms !== null) return localDate(ms, timeZone);
  }
  return null;
}
function completedAt(r: TaskRowDto, timeZone?: string): number {
  for (const v of [r.completed, r.modified]) {
    const ms = v ? parseInstant(v, timeZone) : null;
    if (ms !== null) return ms;
  }
  return -Infinity;
}

export function isOverdue(r: TaskRowDto, today: string): boolean {
  return isOpen(r) && r.due !== null && r.due < today;
}

function sorter(i: ViewInput, ...keys: ('priority' | 'due' | 'dueLast' | 'title')[]) {
  return (a: TaskRowDto, b: TaskRowDto): number => {
    for (const k of keys) {
      let c = 0;
      if (k === 'priority') c = a.priorityRank - b.priorityRank;
      else if (k === 'due') c = (a.due ?? '').localeCompare(b.due ?? '');
      else if (k === 'dueLast') c = a.due === b.due ? 0 : a.due === null ? 1 : b.due === null ? -1 : a.due < b.due ? -1 : 1;
      else c = i.collator.compare(a.title, b.title);
      if (c !== 0) return c;
    }
    return byteOrder(a.path, b.path);
  };
}

/** A task passes the tag filter when it has every selected tag (D-518). */
const hasTag = (r: TaskRowDto, keys: string[]) => keys.every((k) => r.tags.includes(k));

/** The open tasks a date filter keeps (D-476): Today = Today & overdue; This week adds This week. */
function inDateFilter(r: TaskRowDto, i: ViewInput): boolean {
  if (i.dateFilter === 'all') return true;
  if (r.due === null) return false;
  if (i.dateFilter === 'today') return r.due <= i.today;
  return r.due <= weekOf(i.today, i.firstWeekday).last;
}

/** Done tasks a date filter keeps (D-475, D-476): completed today / this week; `all` keeps all (`kanbanDays` limits). */
function doneInFilter(r: TaskRowDto, i: ViewInput, kanbanDays?: number): boolean {
  const d = completedDate(r, i.timeZone);
  if (i.dateFilter === 'today') return d === i.today;
  if (i.dateFilter === 'week') return d !== null && d >= weekOf(i.today, i.firstWeekday).first && d <= i.today;
  if (kanbanDays !== undefined) return d !== null && d >= addDays(i.today, -kanbanDays) && d <= i.today;
  return true;
}

export function schedule(i: ViewInput): Schedule {
  const open = i.tasks.filter((r) => isOpen(r) && hasTag(r, i.tagFilter) && inDateFilter(r, i) && matches(r, i.search));
  const { last } = weekOf(i.today, i.firstWeekday);
  const s: Schedule = { today: { overdue: [], today: [] }, week: [], weekRange: last > i.today ? { from: addDays(i.today, 1), to: last } : null, later: [], none: [], done: [] };
  const days = new Map<string, TaskRowDto[]>();
  for (const r of open) {
    if (r.due === null) s.none.push(r);
    else if (r.due < i.today) s.today.overdue.push(r);
    else if (r.due === i.today) s.today.today.push(r);
    else if (r.due <= last) days.set(r.due, [...(days.get(r.due) ?? []), r]);
    else s.later.push(r);
  }
  s.today.overdue.sort(sorter(i, 'priority', 'due', 'title'));
  s.today.today.sort(sorter(i, 'priority', 'due', 'title'));
  s.week = [...days.keys()].sort().map((date) => ({ date, tasks: days.get(date)!.sort(sorter(i, 'priority', 'title')) }));
  s.later.sort(sorter(i, 'due', 'priority', 'title'));
  s.none.sort(sorter(i, 'priority', 'title'));
  s.done = i.tasks
    .filter((r) => r.state === 'done' && hasTag(r, i.tagFilter) && doneInFilter(r, i) && matches(r, i.search))
    .sort((a, b) => completedAt(b, i.timeZone) - completedAt(a, i.timeZone) || byteOrder(a.path, b.path));
  return s;
}

/** Tag keys → the most frequent spelling in `tags:` (D-185; ties by code point), from the rows. */
export function tagSpellings(tasks: TaskRowDto[]): Map<string, string> {
  const seen = new Map<string, Map<string, number>>();
  for (const r of tasks) {
    for (const raw of r.fmTags) {
      const sp = raw.normalize('NFC').replace(/^#/, '');
      const k = sp.toLowerCase();
      const m = seen.get(k) ?? new Map<string, number>();
      m.set(sp, (m.get(sp) ?? 0) + 1);
      seen.set(k, m);
    }
  }
  const out = new Map<string, string>();
  for (const [k, m] of seen) out.set(k, [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0]);
  return out;
}

export function kanban(i: ViewInput, groupBy: 'status' | 'tag', tagSpelling: Map<string, string>): { columns: KanbanColumn[] } {
  // The columns are those of the board without the search (D-1281); the search only hides cards.
  const unsearched = i.tasks.filter((r) => isOpen(r) && hasTag(r, i.tagFilter) && inDateFilter(r, i));
  const open = unsearched.filter((r) => matches(r, i.search));
  const order = sorter(i, 'dueLast', 'priority', 'title');
  if (groupBy === 'status') {
    const done = i.tasks.filter((r) => r.state === 'done' && hasTag(r, i.tagFilter) && doneInFilter(r, i, 6) && matches(r, i.search));
    const columns: KanbanColumn[] = i.defs.statuses
      .filter((o) => o.state !== 'cancelled')
      .map((o) => ({
        id: o.label, label: o.label, color: o.color, state: o.state as TaskState, dropTarget: true,
        tasks: (o.state === 'done' ? done : open).filter((r) => r.statusKnown && r.status === o.label).sort(order),
      }));
    const none = open.filter((r) => !r.statusKnown || r.status === null).sort(order);
    if (unsearched.some((r) => !r.statusKnown || r.status === null)) columns.push({ id: 'no-status', label: t('tasks.column.noStatus'), color: null, state: null, dropTarget: false, tasks: none });
    return { columns };
  }
  const label = (k: string) => tagSpelling.get(k) ?? k;
  const keys = i.tagFilter.length ? [...i.tagFilter] : [...new Set(unsearched.flatMap((r) => r.tags))];
  keys.sort((a, b) => i.collator.compare(label(a), label(b)) || byteOrder(a, b));
  const columns: KanbanColumn[] = keys.map((k) => ({
    id: `#${k}`, label: `#${label(k)}`, color: null, state: null, dropTarget: true, tasks: open.filter((r) => r.tags.includes(k)).sort(order),
  }));
  if (!i.tagFilter.length) columns.push({ id: 'no-tag', label: t('tasks.column.noTag'), color: null, state: null, dropTarget: false, tasks: open.filter((r) => r.tags.length === 0).sort(order) });
  return { columns };
}

export function counts(i: ViewInput): Counts {
  const open = i.tasks.filter(isOpen);
  const tagged = open.filter((r) => hasTag(r, i.tagFilter));
  const { last } = weekOf(i.today, i.firstWeekday);
  const dated = open.filter((r) => inDateFilter(r, i));
  const spell = tagSpellings(i.tasks);
  // The tags of open tasks within the date filter, plus the selected ones; each counts the tasks the views would show
  // with it added (D-518), most first.
  const n = new Map<string, number>();
  for (const r of dated) for (const k of r.tags) if (!n.has(k)) n.set(k, 0);
  for (const k of i.tagFilter) if (!n.has(k)) n.set(k, 0);
  for (const r of dated) if (hasTag(r, i.tagFilter)) for (const k of r.tags) n.set(k, (n.get(k) ?? 0) + 1);
  const tags = [...n].map(([key, count]) => ({ key, label: spell.get(key) ?? key, count }));
  tags.sort((a, b) => b.count - a.count || i.collator.compare(a.label, b.label) || byteOrder(a.key, b.key));
  return {
    open: open.length,
    overdue: open.filter((r) => isOverdue(r, i.today)).length,
    dueToday: open.filter((r) => r.due === i.today).length,
    all: tagged.length,
    today: tagged.filter((r) => r.due !== null && r.due <= i.today).length,
    week: tagged.filter((r) => r.due !== null && r.due <= last).length,
    tags,
  };
}

/** The region's short date (`Fri 9 Oct`), never shifted by a zone. */
export function shortDate(date: string, region: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(region, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d));
}

function daysBetween(a: string, b: string): number {
  const ms = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((ms(b) - ms(a)) / 86_400_000);
}

/** R44 due label and its tone (FR-TSK-09 AC-2). */
export function dueLabel(r: TaskRowDto, today: string, region: string, timeZone?: string): { text: string; tone: 'overdue' | 'today' | 'plain' | 'invalid' | 'done' } {
  if (r.state === 'done') {
    const d = completedDate(r, timeZone);
    if (d === today) return { text: t('task.completedToday'), tone: 'done' };
    if (d) return { text: t('task.completedOn', { date: shortDate(d, region) }), tone: 'done' };
  }
  if (r.due === null) return r.dueRaw !== null ? { text: t('task.due.invalid'), tone: 'invalid' } : { text: '', tone: 'plain' };
  const n = daysBetween(r.due, today);
  if (n === 0) return { text: t('task.due.today'), tone: isOpen(r) ? 'today' : 'plain' };
  if (n === -1) return { text: t('task.due.tomorrow'), tone: 'plain' };
  if (n > 0 && isOpen(r)) {
    const date = shortDate(r.due, region);
    return { text: n === 1 ? t('task.due.yesterday', { date }) : t('task.due.overdue', { date, count: n }), tone: 'overdue' };
  }
  return { text: shortDate(r.due, region), tone: 'plain' };
}
