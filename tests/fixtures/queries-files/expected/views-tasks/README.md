# Expected bytes of slice Q2-T writes (`expected/views-tasks/`)

Expected bytes of the writes of `docs/acceptance/views.md` **part three** (R201…R208) and
`docs/contracts/v1-views.md` §24.3, §25, §26 and §31.4. Synthetic (D-50, D-62), written by the test author with the red
tests from the ACs, the fixtures and the contract only (D-61). Each file is the **whole file after the action** unless
the table says otherwise.

**Inputs.** **base** = `tests/fixtures/vaults/tasks/` with `tests/fixtures/vaults/new-empty/.tegg/` copied in (its
`task.yml` has no `views`); **overlay** = the base with `tests/fixtures/vaults/views-tasks/` copied over it (its README).

**Clock.** `2026-10-14T12:00:00+02:00` (Wednesday), Europe/Prague, region `cs` (week Monday–Sunday) unless a name says
otherwise: `-la` = America/Los_Angeles (`2026-10-14T03:00:00-07:00`, the same local date), `-en-us` = region `en-US`
(week Sunday–Saturday). Every `modified:` written by an action is the clock; `created` / `modified` of R202's default
files (`<stamp>`) are the clock too.

**Byte rules.** UTF-8 without BOM, NFC, LF, one final `\n`, except: `-crlf` (CRLF on every line, final CRLF),
`-no-newline` (LF, no final newline) and `tasks/nakup-later.md` (its `title` and `tags` entry keep the fixture's **NFD**
bytes; only `due:` and `modified:` change). Don't open and re-save these files in an editor.

**Steps in sequence.** `queries/schedule-no-done-lane.yml` → `queries/schedule-done-lane-again.yml` (uncheck, then check
the done lane; the second file equals the overlay's `Schedule.yml` with `modified:` set) and
`queries/kanban-lane-order-waiting.yml` → `queries/kanban-lane-order-reset.yml` (the lane drag, then `Reset lane order`)
are each two commits at the same clock.

## `queries/` (`.tegg/queries/<name>.yml` after the action)

| File | Input → action | Criteria |
| --- | --- | --- |
| `schedule-default.yml`, `kanban-default.yml` | R202's bytes, `<stamp>` the clock (the migration, `Restore default views`, `create_text(default_task_view(name), clock, None)`) | FR-QRY-07 AC-27, AC-28, FR-TYP-01 AC-11 |
| `schedule-no-done-lane.yml` | overlay `Schedule.yml`; the editor's done-lane checkbox unchecked, `Done`: line 15 removed | FR-TSK-04 AC-26 |
| `schedule-done-lane-again.yml` | then checked again: `done_lane: { within_days: 7, folded: true }` back after `lanes:` | FR-TSK-04 AC-26 |
| `schedule-lanes-vertical.yml` (+ `-crlf`, `-no-newline`) | overlay `Schedule.yml` (or its CRLF / no-final-newline copy); `Switch lanes`: line 14 only | FR-FMT-07 AC-35 |
| `kanban-lane-order-waiting.yml` | overlay `Kanban.yml`; the `Waiting` lane dragged before `To do`: `lane_order: [Waiting, To do, In progress, Done, Rozpracováno]` inserted after `lanes: vertical` (before `done_lane`, R201's order) | FR-TSK-05 AC-20 |
| `kanban-lane-order-reset.yml` | then `Reset lane order`: the line removed | FR-TSK-05 AC-20 |
| `projekty-group-created.yml` | overlay `Projekty podle termínu.yml`; `Group by` › `Created · by period`, `Done`: line 10 → `group_by: { created: period }   # podle termínu` (comment kept) | FR-QRY-01 AC-17, FR-FMT-07 AC-35 |

`../views/new-view-board-book.yml` (part one's file, FR-QRY-05 AC-28: its `columns:` line goes, D-1910) is **not**
changed by the red tests: it is an existing fixture and changes with a `Fixture-Change:` trailer in the build commit.

## `types/` (`.tegg/types/task.yml` after the action)

| File | Input → action | Criteria |
| --- | --- | --- |
| `task-migrated.yml` | base `task.yml` (new-empty's) + line 11 `views: [Schedule, Kanban]` | FR-QRY-07 AC-27, AC-28 |
| `task-builtin-migrated.yml` | no `task.yml`: the built-in file (= new-empty's, D-90) + the line; the same bytes as `task-migrated.yml` | AC-28 (a) |
| `task-overlay-without-kanban.yml` | overlay; `Move to trash` on the `Kanban` tab: line 11 `views: [Schedule, Čeká na ostatní]` | FR-TYP-01 AC-11 (input of the restore; the restore gives the overlay's `task.yml` back) |
| `task-overlay-without-schedule.yml` | overlay; `Remove from Tasks page` on `Schedule`: line 11 `views: [Kanban, Čeká na ostatní]` | FR-TYP-01 AC-11 (the restore gives the overlay's `task.yml` back) |
| `task-overlay-schedule-sort-title.yml` | overlay; `Schedule` tab sort replaced by one level `Title A → Z`: line 11 → the block list of R196 | FR-QRY-01 AC-19 |
| `task-overlay-kanban-add-title.yml` | overlay; `+ Add sort` on the `Kanban` tab: the query's `due ↑`, `priority ↑` plus `title ↑` as the tab's own sort | FR-QRY-01 AC-19 |

## `tasks/` (`Tasks/<title>.md` after the drop or the create)

| File | Input → action | Criteria |
| --- | --- | --- |
| `precist-knihu-due-16.md` | T08 from `Not scheduled` onto `pátek 16.`: `due: 2026-10-16` appended after the last entry (D-230) | FR-TSK-04 AC-25 (a) |
| `obnovit-pas-due-14.md`, `obnovit-pas-due-14-la.md` | T07 from `Later` onto `Today & overdue` (Prague; Los Angeles) | (b) |
| `zalit-kvetiny-due-19.md`, `zalit-kvetiny-due-18-en-us.md` | T03 onto `Later` (`cs`: Monday 19; `en-US`: Sunday 18) | (c) |
| `koupit-darek-no-due.md` | T04 onto `Not scheduled`: the `due:` line removed | (d) |
| `poslat-rozpocet-done.md` | T02 onto `Done`: `status: Done`, `completed: <clock>` appended, `due` kept | (e) |
| `vratit-knihy-reopened.md` | T12 from `Done` onto `Today & overdue`: `status: To do`, `due: 2026-10-14` appended (no `completed` to remove) | (f) |
| `spatne-datum-due-15.md` | T16 (`due: 2026-02-30`) onto `čtvrtek 15.` | (g) |
| `zalit-kvetiny-no-due.md` | T03 onto `Not scheduled` (the `period` kill harness's second text) | FR-SYN-02 AC-13 |
| `nakup-later.md` | T19 (NFD title and tag) onto `Later`: `due: 2026-10-19`, NFD bytes kept | FR-FMT-12 AC-14 |
| `zavolat-do-servisu-new.md` | `New Task`, title `Zavolat do servisu`, ⏎: the whole new file **without its `id:` line** (the id is generated; tests remove the line `id: <26 characters>` that follows `---` and compare the rest) | FR-TSK-10 AC-13 (a) |

## `projekty/` (`Projekty/<title>.md` after the drop)

| File | Input → action | Criteria |
| --- | --- | --- |
| `zahrada-later.md` | overlay Zahrada (no `due`) onto `Later` of `Projekty podle termínu`: `due: 2026-10-19` appended | FR-QRY-01 AC-17 |
| `web-no-due.md` | base Web onto `No Due date`: the `due:` line removed | FR-QRY-01 AC-17 |

Status-drag bytes on the Kanban are tasks.md FR-TSK-05 AC-2's (existing L1 texts in
`packages/doc/test/task_edit.ac.test.ts`); tag-drag bytes are part one's `board_move`.

`../../expected-views-tasks.json` (L3, contract §31.3) holds the reads, groups and filter results of this slice; its
README part is the `_about` entry in the file itself.
