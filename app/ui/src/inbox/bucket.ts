// Slice 5B (docs/contracts/ms5-capture.md §7.2; docs/acceptance/inbox.md R61; D-555): the Inbox instant, order and
// groups, in TypeScript like the Tasks buckets (the core never decides "today", ms5-tasks §1). Pure.
import { addDays, localDate, parseInstant } from '@tegg/doc';
import type { InboxRowDto } from '../ipc/types';

export type InboxGroup = 'today' | 'yesterday' | 'week' | 'older';
export type InboxGroups = Record<InboxGroup, InboxRowDto[]>;

/** R61: a valid `captured` date-time, else `created`, else `modified` (offset-less values in `zone`, D-365; a date alone
 *  is local 00:00 of that day); epoch milliseconds, or null. */
export function inboxInstant(row: Pick<InboxRowDto, 'captured' | 'created' | 'modified'>, zone?: string): number | null {
  for (const v of [row.captured, row.created, row.modified]) {
    if (typeof v !== 'string' || v.trim() === '') continue;
    const at = parseInstant(v, zone);
    if (at !== null && !Number.isNaN(at)) return at;
  }
  return null;
}

const bytes = (s: string) => new TextEncoder().encode(s.normalize('NFC'));
function byteOrder(a: string, b: string): number {
  const x = bytes(a);
  const y = bytes(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}

/** R61: instant descending; items without an instant last; ties and those by title (`collator`), then NFC path byte
 *  order. */
export function inboxOrder(rows: InboxRowDto[], zone: string | undefined, collator: Intl.Collator): InboxRowDto[] {
  const at = new Map(rows.map((r) => [r, inboxInstant(r, zone)]));
  return [...rows].sort((a, b) => {
    const x = at.get(a) ?? null;
    const y = at.get(b) ?? null;
    if (x !== y) {
      if (x === null) return 1;
      if (y === null) return -1;
      return y - x;
    }
    return collator.compare(a.title, b.title) || byteOrder(a.path, b.path);
  });
}

/** ISO weekday (1 = Monday … 7 = Sunday) of `YYYY-MM-DD`. */
function weekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

/** R61 groups by the local date of the instant in `zone`: Today, Yesterday, Earlier this week (from `firstDay`, ISO
 *  weekday 1 = Monday … 7 = Sunday, to the day before yesterday), Older (and no instant). Each group keeps the input
 *  order. */
export function inboxGroups(rows: InboxRowDto[], todayLocal: string, firstDay: number, zone?: string): InboxGroups {
  const out: InboxGroups = { today: [], yesterday: [], week: [], older: [] };
  const yesterday = addDays(todayLocal, -1);
  const weekStart = addDays(todayLocal, -((weekday(todayLocal) - firstDay + 7) % 7));
  for (const r of rows) {
    const at = inboxInstant(r, zone);
    if (at === null) {
      out.older.push(r);
      continue;
    }
    const day = localDate(at, zone);
    if (day >= todayLocal) out.today.push(r);
    else if (day === yesterday) out.yesterday.push(r);
    else if (day >= weekStart) out.week.push(r);
    else out.older.push(r);
  }
  return out;
}
