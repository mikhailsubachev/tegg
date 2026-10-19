// Slice 5B (docs/contracts/ms5-capture.md §7.2; docs/acceptance/inbox.md R61; D-555): the Inbox instant, order and
// groups, in TypeScript like the Tasks buckets (the core never decides "today", ms5-tasks §1). Pure.
// STUB (TS-I1): exists and compiles, returns deliberately wrong results until 5B is built.
import type { InboxRowDto } from '../ipc/types';

export type InboxGroup = 'today' | 'yesterday' | 'week' | 'older';
export type InboxGroups = Record<InboxGroup, InboxRowDto[]>;

/** R61: a valid `captured` date-time, else `created`, else `modified` (offset-less values in `zone`, D-365; a date alone
 *  is local 00:00 of that day); epoch milliseconds, or null. STUB: null. */
export function inboxInstant(_row: Pick<InboxRowDto, 'captured' | 'created' | 'modified'>, _zone?: string): number | null {
  return null;
}

/** R61: instant descending; items without an instant last; ties and those by title (`collator`), then NFC path byte
 *  order. STUB: the input order. */
export function inboxOrder(rows: InboxRowDto[], _zone: string | undefined, _collator: Intl.Collator): InboxRowDto[] {
  return [...rows];
}

/** R61 groups by the local date of the instant in `zone`: Today, Yesterday, Earlier this week (from `firstDay`, ISO
 *  weekday 1 = Monday … 7 = Sunday, to the day before yesterday), Older (and no instant). Each group keeps the input
 *  order. STUB: every group empty. */
export function inboxGroups(_rows: InboxRowDto[], _todayLocal: string, _firstDay: number, _zone?: string): InboxGroups {
  return { today: [], yesterday: [], week: [], older: [] };
}
