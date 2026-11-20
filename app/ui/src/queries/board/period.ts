// Slice Q2-T: the pure model of a period board (docs/contracts/v1-views.md §28.1, §29.3; R203; CP-22, D-1914, D-1927).
// The core groups (`QueryResultDto.group`); this TS twin gives the UI the bounds of a run, R203's bucketing table (the
// fake core and L1 use it), drop dates, pre-fills, lane label keys, day headings and keyboard targets. Dates are
// `YYYY-MM-DD` calendar days, never shifted by a zone (FR-FMT-11); a date-time is read as its local date in the zone
// (D-104).
import { addDays, localDate, parseDate, parseInstant } from '@tegg/doc';

export type Bounds = { today: string; weekFirst: string; weekLast: string; afterWeek: string; days: string[] };
export type PeriodLane = 'today' | 'week' | 'later' | 'none';
export type Target = { lane: string; day: string | null };

/** Day of the week of a `YYYY-MM-DD` date in `Date.getDay` numbering (0 = Sunday … 6 = Saturday). */
function getDay(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The bounds of a run (§23.1, D-329): the week's first day = today − ((today − weekStart) mod 7) days. */
export function bounds(env: { today: string; weekStart: number }): Bounds {
  const back = (((getDay(env.today) - env.weekStart) % 7) + 7) % 7;
  const weekFirst = addDays(env.today, -back);
  const weekLast = addDays(weekFirst, 6);
  const days: string[] = [];
  for (let d = addDays(env.today, 1); d <= weekLast; d = addDays(d, 1)) days.push(d);
  return { today: env.today, weekFirst, weekLast, afterWeek: addDays(weekLast, 1), days };
}

/** The calendar date of a value (§24.4): a Date takes its valid `YYYY-MM-DD` only (tasks.md AP-414); a date-time the
 *  instant's local date in `zone`. Anything else has no date. */
export function dateOf(value: unknown, kind: 'date' | 'dateTime', zone?: string): string | null {
  if (typeof value !== 'string') return null;
  if (kind === 'date') return parseDate(value.trim());
  const ms = parseInstant(value, zone);
  return ms === null ? null : localDate(ms, zone);
}

/** R203's table: Today & overdue (≤ today), This week (a day group from tomorrow to the week's last day), Later (after
 *  the week), no value. */
export function periodOf(value: unknown, kind: 'date' | 'dateTime', b: Bounds, zone?: string): { lane: PeriodLane; day: string | null } {
  const d = dateOf(value, kind, zone);
  if (d === null) return { lane: 'none', day: null };
  if (d <= b.today) return { lane: 'today', day: null };
  if (d <= b.weekLast) return { lane: 'week', day: d };
  return { lane: 'later', day: null };
}

/** The done lane's window (R201): the completed day (`completed`, else `modified`, tasks.md R44) is within
 *  `today − (n − 1) … today`. */
export function completedWithin(row: { completed: string | null | undefined; modified: string | null | undefined }, today: string, n: number, zone?: string): boolean {
  let day: string | null = null;
  for (const v of [row.completed, row.modified]) {
    const ms = typeof v === 'string' ? parseInstant(v, zone) : null;
    if (ms !== null) { day = localDate(ms, zone); break; }
  }
  if (day === null) return false;
  return day >= addDays(today, -(n - 1)) && day <= today;
}

const dayOfId = (id: string) => (id.startsWith('day:') ? id.slice(4) : null);

/** The date a drop writes (§29.3): today, a day group's date (the week lane's heading: its first day), the first day
 *  after the week, or null (clear) for the no-value lane. Undefined: no date drop (the done lane, an unknown id). */
export function dropFor(laneId: string, day: string | null, b: Bounds): string | null | undefined {
  const d = day ?? dayOfId(laneId);
  if (d !== null && (laneId === 'period:week' || laneId.startsWith('day:'))) return d;
  switch (laneId) {
    case 'period:today': return b.today;
    case 'period:week': return b.days[0] ?? null;
    case 'period:later': return b.afterWeek;
    case 'none': return null;
    default: return undefined;
  }
}

/** A lane tile's pre-fill (FR-QRY-08 AC-3): today, the week's last day, the first day after it, nothing; the done lane
 *  has no tile (undefined). */
export function prefillFor(laneId: string, b: Bounds): string | null | undefined {
  switch (laneId) {
    case 'period:today': return b.today;
    case 'period:week': return b.weekLast;
    case 'period:later': return b.afterWeek;
    case 'none': return null;
    default: return undefined;
  }
}

/** The catalog key of a period board's lane (§29.3, §30.2). */
export function laneLabelKey(laneId: string, isTaskDue: boolean): string {
  switch (laneId) {
    case 'period:today': return isTaskDue ? 'board.period.today' : 'board.period.todayEarlier';
    case 'period:week': return 'board.period.week';
    case 'period:later': return 'board.period.later';
    case 'none': return isTaskDue ? 'board.period.none' : 'board.none';
    case 'done': return 'board.done';
    default: return laneId;
  }
}

/** A day group's heading, region-formatted (`středa 15.`, `Thursday 15`), never from the catalog. ICU builds differ in
 *  the order of a weekday-and-day pattern for some regions (`15 Thursday` in Node's ICU, `Thursday 15` in WebKit), so a
 *  pattern that puts the day first is read weekday first, keeping the region's own words and day literal. */
export function dayHeading(date: string, region: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const parts = new Intl.DateTimeFormat(region, { weekday: 'long', day: 'numeric', timeZone: 'UTC' }).formatToParts(Date.UTC(y, m - 1, d));
  const wi = parts.findIndex((p) => p.type === 'weekday');
  const di = parts.findIndex((p) => p.type === 'day');
  if (wi < 0 || di < 0 || wi < di) return parts.map((p) => p.value).join('');
  return `${parts[wi].value} ${parts[di].value}`;
}

type GroupLike = { lanes: { id: string; dropTarget?: boolean; days?: { date: string }[] }[] };

/** The drop targets in keyboard order (§29.3): lanes in their order, the week lane as its day groups. */
export function targets(group: GroupLike): Target[] {
  const out: Target[] = [];
  for (const l of group.lanes) {
    if (l.dropTarget === false) continue;
    if (l.id === 'period:week' && l.days && l.days.length) for (const d of l.days) out.push({ lane: l.id, day: d.date });
    else out.push({ lane: l.id, day: null });
  }
  return out;
}

const sameTarget = (a: Target, b: Target) => a.lane === b.lane && (a.day ?? null) === (b.day ?? null);

/** `Move card to next / previous lane` on a period board: the neighbouring target; null at the ends. A card in the week
 *  lane's heading (no day) counts as its first day. */
export function neighbourTarget(group: GroupLike, at: Target, dir: 1 | -1): Target | null {
  const list = targets(group);
  let i = list.findIndex((t) => sameTarget(t, at));
  if (i < 0 && at.lane === 'period:week') i = list.findIndex((t) => t.lane === 'period:week');
  if (i < 0) return null;
  return list[i + dir] ?? null;
}
