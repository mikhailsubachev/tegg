// Slice 5B (docs/contracts/ms5-capture.md §5.2; FR-SET-03, D-566): the one date formatter of the UI. Every date shown
// (attribute panel, task rows and chips, Inbox footer, daily header, calendar) goes through it; the region comes from
// i18n/collate.ts `region()`. Display only: files keep `YYYY-MM-DD` and ISO date-times (FR-FMT-11).
// STUB (TS-I1): exists and compiles, returns deliberately wrong results until 5B is built.
import type { DateTimeUiDto } from '../ipc/types';

export type DateTimeSetting = DateTimeUiDto;
export const REGION_SETTING: DateTimeSetting = { date: 'region', time: 'region', week: 'region' };

/** `YYYY-MM-DD` → text by the `date` choice (Region: the region's medium date; ISO; Long). STUB: ''. */
export function formatDate(_date: string, _setting?: DateTimeSetting): string {
  return '';
}

/** An ISO 8601 date-time → date and time text in `zone` (D-104) by the `date` and `time` choices. STUB: ''. */
export function formatDateTime(_instant: string, _setting?: DateTimeSetting, _zone?: string): string {
  return '';
}

/** The first day of the week, ISO weekday (1 = Monday … 7 = Sunday): the `week` choice or the region's (D-329).
 *  STUB: 0. */
export function firstDay(_setting: DateTimeSetting | undefined, _region: string): number {
  return 0;
}
