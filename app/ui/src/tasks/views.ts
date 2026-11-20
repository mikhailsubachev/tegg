// Slice 5A-1: task labels, overdue and week helpers (docs/contracts/ms5-tasks.md §4; R44, D-474…D-477). Pure TypeScript.
// Slice Q2-T (v1-views §23.3, §28.2): `schedule`, `kanban`, `counts` and `tagSpellings` went (the core's `group` draws
// Schedule and Kanban); `summaryWeek` is the Tasks header's line.
import { addDays, localDate, parseInstant } from '@tegg/doc';
import { t } from '../i18n/catalog';
import type { TaskRowDto } from '../ipc/types';

export type TaskState = 'open' | 'in-progress' | 'done' | 'cancelled';

/** Folded as the type page's title filter (FR-TYP-09 AC-4): NFC, lower case, marks removed. */
const fold = (s: string) => s.normalize('NFC').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
/** Whether a row's title contains the search (D-1280); a blank search keeps every row. */
export function matches(r: TaskRowDto, search: string | undefined): boolean {
  const q = fold(search?.trim() ?? '');
  return !q || fold(r.title).includes(q);
}

const isOpen = (r: TaskRowDto) => r.state === 'open' || r.state === 'in-progress';
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
export function isOverdue(r: TaskRowDto, today: string): boolean {
  return isOpen(r) && r.due !== null && r.due < today;
}

/** Slice Q2-T (v1-views §28.2, R204, CP-29): the Tasks header's counts, filters ignored: open and overdue tasks (R44)
 *  and the Done-state tasks whose completed day is in the current week (`firstWeekday` 1 = Monday … 7 or 0 = Sunday). */
export function summaryWeek(tasks: readonly TaskRowDto[], today: string, firstWeekday: number, timeZone?: string): { open: number; overdue: number; doneWeek: number } {
  const { first, last } = weekOf(today, firstWeekday);
  let open = 0, overdue = 0, doneWeek = 0;
  for (const r of tasks) {
    if (isOpen(r)) { open++; if (isOverdue(r, today)) overdue++; }
    else if (r.state === 'done') {
      const d = completedDate(r, timeZone);
      if (d !== null && d >= first && d <= last) doneWeek++;
    }
  }
  return { open, overdue, doneWeek };
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
