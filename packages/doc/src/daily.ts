// MS4 slice 4B (docs/contracts/ms4-daily.md §1, §5, §6): dates, daily file names, the daily template, first-write
// bytes, the D-334 title fix and `@` date rows. STUBS until 4B is built: every function returns a deliberately wrong
// value (null, an empty string or list, the input unchanged), so the 4B red tests fail on their assertions (TS-I1).

/** §1: `YYYY-MM-DD` with a valid calendar day (D-332), else null. */
export function parseDate(_s: string): string | null {
  return null
}

/** §1: today's local calendar date of `nowMs` in `timeZone` (default: the current `Intl` zone). */
export function localDate(_nowMs: number, _timeZone?: string): string {
  return ''
}

/** §1: calendar-day arithmetic, no time involved (FR-DLY-03 AC-1). */
export function addDays(_date: string, _n: number): string {
  return ''
}

/** §6.1: `YYYY`, `MM`, `M`, `DD`, `D` (longest first); other characters copied (D-325). */
export function formatDate(_date: string, _format: string): string {
  return ''
}

/** §5: the daily file stem for `format`, or null when the format is bad (D-336). */
export function dailyFileStem(_format: string, _date: string): string | null {
  return null
}

/** §6.1: the daily template expanded for `date` (D-270, D-325). */
export function expandDailyTemplate(_templateText: string, _date: string): { keys: [string, string][]; body: string; invalid: boolean } {
  return { keys: [], body: '', invalid: false }
}

/** §6.2: the bytes of a Daily Note's first write (D-324). */
export function newDailyNote(_opts: { date: string; keys: [string, string][]; body: string; id: string; now: string }): string {
  return ''
}

/** §6.3: sets `title: "<date>"` when the title differs from `date` (D-334). */
export function fixDailyTitle(text: string): string {
  return text
}

/** §6.4: zero or one `@` date row (D-331). */
export function dateRows(_query: string, _today: string, _locale: string): { date: string; label: string; keyword: string | null }[] {
  return []
}
