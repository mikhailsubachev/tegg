# Acceptance Criteria: One date picker (D-763)

See [README](README.md) for conventions. Preview v0.68 feedback F10 (`docs/feedback/ms6-v068.md`, AP-723 → D-763; boards
`MainProperties`, `QuickCapture`). The capture's due calendar (D-602) becomes the dialog every user-entered date is
chosen in. These criteria add to types.md R10 and FR-TYP-02, tasks.md FR-TSK-09 AC-4, daily-notes.md R18 and FR-DLY-08
AC-3, and capture.md FR-CAP-01 AC-19; where they differ, these win.

Fixtures: `tests/fixtures/vaults/types/` (Porada `Schůzky/2026-10-07 Porada.md`: `datum: 2026-10-07`, `začátek`
Date-time; Velká písmena, a Projekt with the Date range `období` empty), `tests/fixtures/vaults/tasks/` (T03
`Tasks/Zalít květiny.md`), `tests/fixtures/vaults/daily/` (Zmínky). Test clock `2026-10-14T10:00:00+02:00` (a
Wednesday), Europe/Prague, region `cs` unless stated. Layers as in [types.md](types.md).

## R89. The date picker (D-602, D-763)

| Element | Role | Accessible name / content |
| --- | --- | --- |
| Opener (attribute panel) | `button`, `aria-haspopup="dialog"`, `aria-expanded` | the calendar icon (`data-icon="calendar"`) and the date in the region format (D-133), or `No date` (faint) when empty; accessible name `<attribute name>: <date or No date>` |
| Dialog | `dialog` | `Pick date` (the capture keeps `Pick a due date`, FR-CAP-01 AC-19; the Daily Notes calendar keeps `Calendar`, R18); anchored below its opener, inside the window |
| Date field | `textbox` `Date` | accepts every form of the D-537 typed date (`2026-10-20`, the region's numeric form, `fri`, `next week`, `tomorrow`); ⏎ commits; an unreadable text shows the field error `Not a date` and changes nothing |
| Quick picks | `button`s | `Today`, `Tomorrow`, `Next week` (next Monday), `Fri` (the next Friday) (D-602) |
| Month | heading + buttons | `<Month YYYY>` (localized); `Previous month` `‹`, `Next month` `›` |
| Grid | `grid` | weekday columns from the Date & time week start (D-329, D-566); `gridcell` buttons named by the long date; `aria-current="date"` on today (ringed), `aria-selected="true"` on the value (filled), days of other months faint |
| No date | `button` | `No date`; absent in the Daily Notes calendar |
| Hint | text | `or type “fri”, “next week”` |

Keyboard (all surfaces): the focus starts on the value's day (else today); ←/→/↑/↓ move by a day / week, crossing months;
⏎ or Space picks the focused day; Esc closes without a change and returns the focus to the opener; Tab cycles inside
the dialog.

### FR-TYP-02 Dates in the attribute panel (D-763)

- **AC-6** **The opener (board `MainProperties`).** On Porada the row `Datum` shows a `button` `Datum: <7 Oct 2026 in cs>` with the calendar icon, not a textbox; Velká písmena's `Období` shows two buttons `Období start: No date` and `Období end: No date` (`panel.rangeStart`, `panel.rangeEnd`; D-230 one row); `Začátek` shows a date button `Začátek date: <date>` (`panel.dateField`) and its time textbox `Začátek time`. No row of type Date, Date-time or Date range has a free textbox for the date part. *(L5)*
- **AC-7** **Choosing a date writes once.** On Porada, `Datum` › `Pick date` shows October 2026 with 7 selected and 14 ringed; clicking 20 closes the dialog and writes `datum: 2026-10-20` once (one `note_write`, every other byte unchanged, FR-SYN-06); `Tomorrow` writes `2026-10-15`; typing `2026-10-08` in `Date` and ⏎ writes `2026-10-08`; `No date` removes the `datum:` line (types.md FR-TYP-03 AC-9). Esc after moving the focused day writes nothing. The same choices give the same bytes with the zone America/Los_Angeles and Pacific/Kiritimati (FR-FMT-11). *(L5; L1 for the bytes)*
- **AC-8** **Date-time and Date range.** `Začátek` › picking 9 Oct keeps its time and offset rule (types.md R10: the moment's offset in the machine's zone); the time textbox is unchanged. On Velká písmena, picking 1 Jan 2027 for `začátek` and then 31 Dec 2027 for `konec` writes `období` once, after the second (D-230: committed together); picking an end before the start shows the field error of types.md AC-3 and writes nothing. *(L5)*

### FR-TSK-09 Due dates of tasks (D-763; replaces tasks.md AC-4's `Choose date`)

- **AC-5** **Card menu, Kanban and Schedule.** The task card menu's `Due date…` opens `Pick date` directly (no separate textbox and `Choose date` button): on T03, `Pick date` › 20 writes `Tasks/Zalít květiny.md` once with `due: 2026-10-20` and `modified` updated, every other byte unchanged; `No date` removes `due:`. The same dialog opens from a Kanban card's menu and from the Schedule's card menu. The quick-add `Due` chip is unchanged (token only). *(L5; L1 for the bytes)*

### FR-DLY-03 Daily Notes calendar (D-763)

- **AC-7** **Daily Notes calendar is the same picker.** The calendar of R18 (title-bar date and palette `Open calendar`) has R89's month, grid, keyboard and quick picks `Today`, `Tomorrow`, `Next week`, `Fri`, and its `Date` field; it keeps the name `Calendar`, the `data-has-note` marks and descriptions, and has no `No date`. Choosing a day opens `daily/<date>` as before (FR-DLY-03 AC-3…AC-6). *(L5)*
### FR-DLY-08 Date mentions (D-763)

- **AC-9** **`Pick a date…` in the `@` list.** In Zmínky, `@` › `Pick a date…` opens `Pick date` anchored at the caret (R89, without `No date`); choosing 20 inserts `[[2026-10-20]]` at the `@` position; typing `fri` in `Date` and ⏎ inserts `[[2026-10-16]]`; Esc returns to the list with the query intact (FR-DLY-08 AC-3). *(L5)*

### FR-CAP-01 The capture (D-763)

- **AC-22** **Same picker.** The capture's `Pick a due date` (FR-CAP-01 AC-19) and the app's `Pick date` render from one component: the same quick picks, grid classes and keyboard; with the Date & time week start `sunday` both grids start on Sunday. *(L5)*

### FR-UX-05 Themes and strings (D-763)

- **AC-9** **Themes, strings, keyboard.** FR-UX-05 AC-4, AC-5 and axe `color-contrast` pass with `Pick date` open from the attribute panel, a task card and the `@` list, light and dark; every text of R89 is a catalog key (pseudo-locale, NFR-OTH-02); the dialog is fully usable by keyboard (Tab, arrows, ⏎, Esc), FR-UX-03. *(L5)*
