# Acceptance Criteria: One date picker (D-763)

See [README](README.md) for conventions. Preview v0.68 feedback F10 (`docs/feedback/ms6-v068.md`, AP-723 → D-763; boards
`MainProperties`, `QuickCapture`). The capture's due calendar (D-602) becomes the dialog every user-entered date is
chosen in. These criteria add to types.md R10 and FR-TYP-02, tasks.md FR-TSK-09 AC-4, daily-notes.md R18 and FR-DLY-08
AC-3, and capture.md FR-CAP-01 AC-19; where they differ, these win.

**Follow-up (Preview v0.94 feedback; owner, 2026-10-30, each as proposed).** The owner: "Remove Fri from the date picker; leave just 3 options: Today,
Tomorrow, This week (Friday). The date picker will become one line shorter." R89's quick picks become `Today`,
`Tomorrow`, `This week` (AP-1185…AP-1188 → D-1285…D-1288); new FR-TYP-02 AC-9, AC-10; FR-DLY-03 AC-7 and capture.md FR-CAP-01
AC-19 are amended (AP-1189 → D-1289, their tests change with an `AC-Test-Change` trailer).

Fixtures: `tests/fixtures/vaults/types/` (Porada `Schůzky/2026-10-07 Porada.md`: `datum: 2026-10-07`, `začátek`
Date-time; Velká písmena, a Projekt with the Date range `období` empty), `tests/fixtures/vaults/tasks/` (T03
`Tasks/Zalít květiny.md`), `tests/fixtures/vaults/daily/` (Zmínky). Test clock `2026-10-14T10:00:00+02:00` (a
Wednesday), Europe/Prague, region `cs` unless stated. Layers as in [types.md](types.md).

## R89. The date picker (D-602, D-763)

| Element | Role | Accessible name / content |
| --- | --- | --- |
| Opener (attribute panel) | `button`, `aria-haspopup="dialog"`, `aria-expanded` | the calendar icon (`data-icon="calendar"`) and the date in the region format (D-133), or `No date` (muted text, faint icon; `faint` is only for decorative icons, FR-UX-05) when empty; accessible name `<attribute name>: <date or No date>` |
| Dialog | `dialog` | `Pick date` (the capture keeps `Pick a due date`, FR-CAP-01 AC-19; the Daily Notes calendar keeps `Calendar`, R18); anchored below its opener, inside the window |
| Date field | `textbox` `Date` | accepts every form of the D-537 typed date (`2026-10-20`, the region's numeric form, `fri`, `next week`, `tomorrow`); ⏎ commits; an unreadable text shows the field error `Not a date` and changes nothing |
| Quick picks | `button`s, one line | `Today`, `Tomorrow`, `This week` (the first Friday on or after today, AP-1186; description and tooltip: its long date, AP-1187) (v0.94, AP-1185; was `Today`, `Tomorrow`, `Next week`, `Fri`, D-602) |
| Month | heading + buttons | `<Month YYYY>` (localized); `Previous month` `‹`, `Next month` `›` |
| Grid | `grid` | weekday columns from the Date & time week start (D-329, D-566); `gridcell` buttons named by the long date; `aria-current="date"` on today (ringed), `aria-selected="true"` on the value (filled), days of other months faint |
| No date | `button` | `No date`; absent in the Daily Notes calendar |
| Hint | text | `or type “fri”, “next week”` (unchanged by v0.94, AP-1188) |

Keyboard (all surfaces): the focus starts on the value's day (else today); ←/→/↑/↓ move by a day / week, crossing months;
⏎ or Space picks the focused day; Esc closes without a change and returns the focus to the opener; Tab cycles inside
the dialog.

### FR-TYP-02 Dates in the attribute panel (D-763)

- **AC-6** **The opener (board `MainProperties`).** On Porada the row `Datum` shows a `button` `Datum: <7 Oct 2026 in cs>` with the calendar icon, not a textbox; Velká písmena's `Období` shows two buttons `Období start: No date` and `Období end: No date` (`panel.rangeStart`, `panel.rangeEnd`; D-230 one row); `Začátek` shows a date button `Začátek date: <date>` (`panel.dateField`) and its time textbox `Začátek time`. No row of type Date, Date-time or Date range has a free textbox for the date part. *(L5)*
- **AC-7** **Choosing a date writes once.** On Porada, `Datum` › `Pick date` shows October 2026 with 7 selected and 14 ringed; clicking 20 closes the dialog and writes `datum: 2026-10-20` once (one `note_write`, every other byte unchanged, FR-SYN-06); `Tomorrow` writes `2026-10-15`; typing `2026-10-08` in `Date` and ⏎ writes `2026-10-08`; `No date` removes the `datum:` line (types.md FR-TYP-03 AC-9). Esc after moving the focused day writes nothing. The same choices give the same bytes with the zone America/Los_Angeles and Pacific/Kiritimati (FR-FMT-11). *(L5; L1 for the bytes)*
- **AC-8** **Date-time and Date range.** `Začátek` › picking 9 Oct keeps its time and offset rule (types.md R10: the moment's offset in the machine's zone); the time textbox is unchanged. On Velká písmena, picking 1 Jan 2027 for `začátek` and then 31 Dec 2027 for `konec` writes `období` once, after the second (D-230: committed together); picking an end before the start shows the field error of types.md AC-3 and writes nothing. *(L5)*
- **AC-9** **Three quick picks (v0.94; AP-1185, AP-1186, AP-1187; TZ, T2).** Every surface of R89 shows exactly three quick-pick buttons, in this order: `Today`, `Tomorrow`, `This week`; no button named `Next week` or `Fri` exists in any of them. `This week` picks the first Friday on or after today, whatever the region's week start: with today Mon 12, Wed 14, Thu 15 or Fri 16 Oct 2026 it gives 2026-10-16; with Sat 17 or Sun 18 Oct it gives 2026-10-23; with Thu 31 Dec 2026 it gives 2027-01-01. "Today" is the local date of the clock in the current zone: at the instant `2026-10-16T22:30:00Z` `This week` gives 2026-10-23 in Europe/Prague (Sat 17, 00:30) and 2026-10-16 in America/Los_Angeles (Fri 16, 15:30). On Porada at the test clock, `Datum` › `This week` writes `datum: 2026-10-16` once (AC-7 rules). The button `This week` has the description and the tooltip of its date in the region's long form (`pátek 16. října 2026` in `cs`, `Friday, October 16, 2026` in `en-US`); `Today` and `Tomorrow` have none. The date rule is one exported function given today (L1 table test). *(L1; L5)*
- **AC-10** **One line (v0.94).** With the English catalog, in light and dark, in each surface (attribute panel `Pick date` at 1280 × 800 pt, a task card's `Pick date`, the `@` list's `Pick date`, the Daily Notes `Calendar`, and the capture's `Pick a due date` at the capture window's size), the three quick-pick buttons have the same `getBoundingClientRect().top` (± 1 px), and their container's height equals the height of one button (± 1 px): the quick picks never wrap to a second line. *(L5)*

### FR-TSK-09 Due dates of tasks (D-763; replaces tasks.md AC-4's `Choose date`)

- **AC-5** **Card menu, Kanban and Schedule.** The task card menu's `Due date…` opens `Pick date` directly (no separate textbox and `Choose date` button): on T03, `Pick date` › 20 writes `Tasks/Zalít květiny.md` once with `due: 2026-10-20` and `modified` updated, every other byte unchanged; `No date` removes `due:`. The same dialog opens from a Kanban card's menu and from the Schedule's card menu. The quick-add `Due` chip is unchanged (token only). *(L5; L1 for the bytes)*

### FR-DLY-03 Daily Notes calendar (D-763)

- **AC-7** **Daily Notes calendar is the same picker.** The calendar of R18 (title-bar date and palette `Open calendar`) has R89's month, grid, keyboard and quick picks `Today`, `Tomorrow`, `This week` (v0.94, AP-1189; was `Today`, `Tomorrow`, `Next week`, `Fri`), and its `Date` field; it keeps the name `Calendar`, the `data-has-note` marks and descriptions, and has no `No date`. Choosing a day opens `daily/<date>` as before (FR-DLY-03 AC-3…AC-6); `This week` opens `daily/2026-10-16`. *(L5)*
### FR-DLY-08 Date mentions (D-763)

- **AC-9** **`Pick a date…` in the `@` list.** In Zmínky, `@` › `Pick a date…` opens `Pick date` anchored at the caret (R89, without `No date`); choosing 20 inserts `[[2026-10-20]]` at the `@` position; typing `fri` in `Date` and ⏎ inserts `[[2026-10-16]]`; Esc returns to the list with the query intact (FR-DLY-08 AC-3). *(L5)*

### FR-CAP-01 The capture (D-763)

- **AC-22** **Same picker.** The capture's `Pick a due date` (FR-CAP-01 AC-19) and the app's `Pick date` render from one component: the same quick picks, grid classes and keyboard; with the Date & time week start `sunday` both grids start on Sunday. *(L5)*

### FR-UX-05 Themes and strings (D-763)

- **AC-9** **Themes, strings, keyboard.** FR-UX-05 AC-4, AC-5 and axe `color-contrast` pass with `Pick date` open from the attribute panel, a task card and the `@` list, light and dark; every text of R89 is a catalog key (pseudo-locale, NFR-OTH-02); the dialog is fully usable by keyboard (Tab, arrows, ⏎, Esc), FR-UX-03. *(L5)*

## Points raised by the v0.94 follow-up (AP-1185…AP-1189)

| # | Issue | Proposal | Alternatives | Affects |
| --- | --- | --- | --- | --- |
| AP-1185 → D-1285 | **Which buttons stay.** "Remove Fri … leave just 3 options" also drops `Next week`, which the owner didn't name. | Three buttons `Today`, `Tomorrow`, `This week`; `Next week` and `Fri` removed; catalog `due.thisWeek` `This week` added, `due.nextWeek` and `due.fri` removed. | (b) Keep `Next week` as a fourth (contradicts "just 3" and "one line shorter"). (c) Label `This week (Fri)` or `Fri` instead of `This week`. | R89, AC-9, AC-10, FR-DLY-03 AC-7, capture.md FR-CAP-01 AC-19, contract ms5-capture §16.3 strings |
| AP-1186 → D-1286 | **What `This week` picks on Friday and at the weekend.** "This week (Friday)" doesn't say what happens once the week's Friday is today or past; the old `Fri` was strictly after today. | The first Friday on or after today: Mon–Fri give this week's Friday (Friday gives today), Sat and Sun give the next Friday; independent of the region's week start. | (b) Strictly after today, as the old `Fri` (Friday gives the next Friday). (c) At the weekend, the last day of the current week (D-329), so it never leaves "this week". (d) Hidden or disabled at the weekend. | AC-9 |
| AP-1187 → D-1287 | **The button doesn't show its date.** `This week` hides which day it sets. | Description and tooltip with the long date (`Friday, October 16, 2026`); `Today`, `Tomorrow` without. | (b) All three get the description. (c) None. (d) The short date in the label (`This week · Fri 16`), which risks the one line. | AC-9 |
| AP-1188 → D-1288 | **Typed words and the hint.** The `Date` field still takes `fri` (strictly the next Friday) and `next week` (next Monday), and the hint names them; on a Friday, `fri` and `This week` then differ (16 → 23 Oct vs today). | Keep the typed forms, their meaning and the hint unchanged (D-537). | (b) `fri` (and every weekday word) also means "on or after today". (c) Hint `or type “fri”, “20.10.”`. | R89 hint, FR-DLY-08 AC-9, D-537 |
| AP-1189 → D-1289 | **Existing criteria and tests that name four buttons.** FR-DLY-03 AC-7 (here) and capture.md FR-CAP-01 AC-19 list `Next week`, `Fri`; the BRD's D-602 and D-763 and contract ms5-capture §16.3 name them too. | Amend the two ACs as written here; change their tests in the build commit with `AC-Test-Change: v0.94 three quick picks (D-1289); approved-by: owner`; update D-602/D-763 text and the contract strings with the decision. | — | FR-DLY-03 AC-7, FR-CAP-01 AC-19, FR-CAP-01 AC-22 tests, FR-TSK-09 AC-5 test, FR-UX-05 AC-9 test |
| AP-1192 → D-1292 | **The quick picks' container (red tests).** | The nearest common ancestor of the three buttons, with no vertical padding. | — | AC-10 |
| AP-1193 → D-1293 | **"Have none" (red tests).** | No `aria-description`, no `aria-describedby` text and no `title` on `Today` and `Tomorrow`. | — | AC-9 |
| AP-1195 → D-1295 | **The capture chip after `Tomorrow` (build).** The changed AC-19 test expected the short date. | `Due: Tomorrow`, R55's due label; AC-test correction. | — | capture.md FR-CAP-01 AC-19 |
