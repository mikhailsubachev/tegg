// Slice 5B (docs/acceptance/inbox.md R60 Card; D-555): the parts of an Inbox card that aren't plain row fields. Pure.
import { parseInstant } from '@tegg/doc';
import { formatDateTime } from '../i18n/dates';
import { t } from '../i18n/catalog';
import type { DateTimeUiDto, InboxRowDto } from '../ipc/types';

/** R60: tags `#<tag>` up to 3, then `+<n>`. */
export function cardTags(tags: string[]): { shown: string[]; more: number } {
  return { shown: tags.slice(0, 3), more: Math.max(0, tags.length - 3) };
}

/** R60: `Captured <date-time>` when `captured` is valid, else `Created <date-time>`, else null (D-160 format through
 *  i18n/dates.ts, in `zone`). An offset-less value is read in `zone` (D-365). */
export function cardFooter(row: Pick<InboxRowDto, 'captured' | 'created'>, zone?: string, setting?: DateTimeUiDto): string | null {
  for (const [key, v] of [['inbox.captured', row.captured], ['inbox.created', row.created]] as const) {
    if (typeof v !== 'string' || v.trim() === '') continue;
    const at = parseInstant(v, zone);
    if (at === null || Number.isNaN(at)) continue;
    return t(key, { date: formatDateTime(new Date(at).toISOString(), setting, zone) });
  }
  return null;
}
