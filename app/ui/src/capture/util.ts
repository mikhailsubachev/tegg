// Small helpers of the capture window (it imports nothing from the main window's modules, ms5-capture §4).
import { t } from '../i18n/catalog';
import { dateTimeSetting, formatDate } from '../i18n/dates';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A new ULID (the `id` of a new object, D-232). */
export function ulid(now = Date.now()): string {
  let time = '';
  let n = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[n % 32] + time;
    n = Math.floor(n / 32);
  }
  const rnd = crypto.getRandomValues(new Uint8Array(16));
  let rest = '';
  for (let i = 0; i < 16; i++) rest += CROCKFORD[rnd[i] % 32];
  return time + rest;
}

const dayMs = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

/** R44's due label of an open task (tasks.md, D-484): Today, Tomorrow, else the region's short date. */
export function dueLabelOf(due: string, today: string, region: string): string {
  const n = Math.round((dayMs(due) - dayMs(today)) / 86_400_000);
  if (n === 0) return t('task.due.today');
  if (n === 1) return t('task.due.tomorrow');
  // FR-SET-03: ISO and Long follow the Date & time choice; Region keeps the short weekday form of the chip.
  const s = dateTimeSetting();
  if (s && s.date !== 'region') return formatDate(due, s);
  const [y, m, d] = due.split('-').map(Number);
  return new Intl.DateTimeFormat(region, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d));
}
