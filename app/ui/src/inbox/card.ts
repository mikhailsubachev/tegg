// Slice 5B (docs/acceptance/inbox.md R60 Card; D-555): the parts of an Inbox card that aren't plain row fields. Pure.
// STUB (TS-I1): exists and compiles, returns deliberately wrong results until 5B is built.
import type { DateTimeUiDto, InboxRowDto } from '../ipc/types';

/** R60: tags `#<tag>` up to 3, then `+<n>`. STUB: none shown. */
export function cardTags(tags: string[]): { shown: string[]; more: number } {
  return { shown: [], more: tags.length };
}

/** R60: `Captured <date-time>` when `captured` is valid, else `Created <date-time>`, else null (D-160 format through
 *  i18n/dates.ts, in `zone`). STUB: null. */
export function cardFooter(_row: Pick<InboxRowDto, 'captured' | 'created'>, _zone?: string, _setting?: DateTimeUiDto): string | null {
  return null;
}
