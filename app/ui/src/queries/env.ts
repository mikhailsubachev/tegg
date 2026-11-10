// Slice Q (docs/contracts/v1-queries.md §4.2 `env.ts`, D-1449): the run environment the UI sends with every `query_run`
// (the core never reads the clock, zone or region for a query): today's local date, the zone, the first day of the week
// and the collation locale.
import { region } from '../i18n/collate';
import { dateTimeSetting, firstDay } from '../i18n/dates';
import { appZone, localDate } from '../zone';
import type { QueryEnvDto } from '../ipc/queries';

export function queryEnv(nowMs: number = Date.now()): QueryEnvDto {
  const locale = region() ?? (typeof navigator !== 'undefined' ? navigator.language : 'en');
  const zone = appZone() ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return { today: localDate(nowMs), zone, weekStart: firstDay(dateTimeSetting(), locale), locale };
}

/** `now` for a write (ISO 8601 with the local offset, FR-FMT-11). */
export { localIso as nowIso } from '../zone';
