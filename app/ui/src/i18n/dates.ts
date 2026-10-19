// Slice 5B (docs/contracts/ms5-capture.md §5.2; FR-SET-03, D-566, D-574): the one date formatter of the UI. Every date
// shown (attribute panel, task rows and chips, Inbox footer, daily header, calendar) goes through it; the region comes
// from i18n/collate.ts `region()`. Display only: files keep `YYYY-MM-DD` and ISO date-times (FR-FMT-11).
import { firstWeekday } from '@tegg/doc';
import type { DateTimeUiDto } from '../ipc/types';
import { region } from './collate';

export type DateTimeSetting = DateTimeUiDto;
export const REGION_SETTING: DateTimeSetting = { date: 'region', time: 'region', week: 'region' };

/** The UI language (English in v1, NFR-OTH-02) for `Long`, which reads `20 October 2026` whatever the region (D-574). */
const UI_LONG = 'en-GB';

const locale = () => region() ?? (typeof navigator !== 'undefined' ? navigator.language : 'en');

function ymd(date: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** `YYYY-MM-DD` → text by the `date` choice (Region: the region's medium date; ISO; Long). A date never shifts with
 *  the zone: it is formatted as UTC midnight in UTC. Anything else is returned as written. */
export function formatDate(date: string, setting?: DateTimeSetting): string {
  const p = ymd(date);
  if (!p) return date;
  const kind = setting?.date ?? 'region';
  if (kind === 'iso') return date.trim();
  const at = Date.UTC(p[0], p[1] - 1, p[2]);
  if (kind === 'long') return new Intl.DateTimeFormat(UI_LONG, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(at);
  return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeZone: 'UTC' }).format(at);
}

/** An ISO 8601 date-time → date and time text in `zone` (D-104) by the `date` and `time` choices. */
export function formatDateTime(instant: string, setting?: DateTimeSetting, zone?: string): string {
  const ms = Date.parse(instant);
  if (Number.isNaN(ms)) return instant;
  const s = setting ?? REGION_SETTING;
  const tz = zone ?? undefined;
  const hour12 = s.time === '12' ? true : s.time === '24' ? false : undefined;
  if (s.date === 'region') {
    return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short', timeZone: tz, ...(hour12 === undefined ? {} : { hour12 }) }).format(ms);
  }
  const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz }).formatToParts(ms);
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
  const day = formatDate(`${get('year')}-${get('month')}-${get('day')}`, s);
  const time = new Intl.DateTimeFormat(hour12 === true ? 'en-US' : hour12 === false ? 'en-GB' : locale(), {
    hour: hour12 === false ? '2-digit' : 'numeric',
    minute: '2-digit',
    timeZone: tz,
    ...(hour12 === undefined ? {} : { hour12 }),
  }).format(ms);
  return `${day} ${time}`;
}

/** The first day of the week, ISO weekday (1 = Monday … 7 = Sunday): the `week` choice or the region's (D-329). */
export function firstDay(setting: DateTimeSetting | undefined, regionTag: string): number {
  if (setting?.week === 'monday') return 1;
  if (setting?.week === 'sunday') return 7;
  return firstWeekday(regionTag);
}
