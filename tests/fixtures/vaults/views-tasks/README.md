# Overlay `views-tasks/` (v1.0 slice Q2-T, Tasks on saved queries)

Synthetic overlay for `docs/acceptance/views.md` **part three** (R201…R208; D-1776, D-1777, D-1779, D-1780, D-1890…D-1895). Hand-written (D-50); every name, title and text is invented (D-62). The bytes of `Schedule.yml` and `Kanban.yml` are the decided defaults: D-1896 (`state_is_not`, AP-1533), D-1897 (the default files, AP-1534) and D-1898 (`done_lane`, AP-1535), owner 2026-11-20. Migrations are off in tests unless a test sets `TEGG_TEST_TASK_VIEWS=1` (D-1913), so copying this overlay never triggers one.

**State it represents.** The tasks vault of slice 5A **after** the Q2-T migration (R202) plus one user view and a project board: `task.yml` lists three views, the two default query files exist, and the user added `Čeká na ostatní` and `Projekty podle termínu`. The migration itself is tested on the base fixture without this overlay (its `task.yml` has no `views`).

**How tests use it.** A part-three test that names the overlay copies `tests/fixtures/vaults/tasks/` (without its README), then `tests/fixtures/vaults/new-empty/.tegg/`, then this folder (without this README). The order matters: this folder **replaces** new-empty's `.tegg/types/task.yml`. It **adds** the four query files and three projects, and **replaces** two base tasks (`Tasks/Opravit kolo.md`, `Tasks/Příprava prezentace.md`) with copies that set `projekt` (D-2160); nothing else. Tests on the base fixture alone (the migration criteria, every slice 5A test) don't copy it.

**Byte rules.** LF, UTF-8 without BOM, every file ends with one `\n`, NFC everywhere (file names too). Don't open and re-save these files in an editor. NFD, CRLF and no-final-newline variants are made at runtime.

**Test clock** (as `tasks.md`): `2026-10-14T12:00:00+02:00` (a Wednesday), Europe/Prague, region `cs` (week Monday–Sunday); `(W)` criteria also with `en-US` (week Sunday–Saturday), `(TZ)` criteria also with `America/Los_Angeles`.

## Files

| File | What it holds | What it tests |
| --- | --- | --- |
| `.tegg/types/task.yml` | new-empty's `task.yml` with one added line 11: `views: [Schedule, Kanban, Čeká na ostatní]` (R184's place, after `preview`); `attributes:` moves to line 12; and, after `recurrence`, the user attribute `projekt` (`name: Projekt`, `type: relation`, `to: [projekt]`, D-2149); every other byte equals new-empty's | the Tasks page's tabs (R204); a tab's own sort written into a block-style `views:` (FR-QRY-01 AC-19); a Task property to add to Task's card (views.md FR-QRY-05 AC-31) and to set from the panel (FR-TSK-01 AC-6) |
| `.tegg/queries/Schedule.yml` | R202's Schedule bytes, `created` / `modified` `2026-10-13T08:00:00+02:00` | `group_by: { due: period }`, `lanes: horizontal`, `done_lane` folded (R201, R203) |
| `.tegg/queries/Kanban.yml` | R202's Kanban bytes, same stamps | the Kanban by status as a view, no `lane_order`, `done_lane` on a board grouped by status (R201) |
| `.tegg/queries/Čeká na ostatní.yml` | Task, `status: Waiting`, Table, `sort: { by: due, order: asc }`, `columns: [due, priority]` | a user Table view on the Tasks page; the tag filter on a table tab (FR-QRY-07 AC-30) |
| `.tegg/queries/Projekty podle termínu.yml` | Projekt, board `group_by: { due: period }   # podle termínu` (trailing comment), `lanes: vertical`, sort by title, no `done_lane`; **not** a tab | period grouping on a type that isn't Task (D-1776; FR-QRY-01 AC-17); the comment kept by writes (FR-FMT-07 AC-35) |
| `Projekty/Stěhování.md` | id `…E201`, `status: To do`, `due: 2026-10-16`, body `Krabice, dodávka, nový nájem.` | This week › Fri 16 Oct |
| `Projekty/Zahrada.md` | id `…E202`, `status: To do`, no `due` | the no-value lane `No Due date` |
| `Projekty/Kuchařka.md` | id `…E203`, `status: Done`, `due: 2026-11-30` | Later; `Done` is only a label on Projekt (no `state`), so no done lane (R201) |

| `Tasks/Opravit kolo.md` | the base's T09 with one added line `projekt: "[[Stěhování]]"` before `created` (D-2160) | a Task with a `projekt` and no `source`, no `due`: the projekt chip in the footer (views.md FR-QRY-05 AC-31) |
| `Tasks/Příprava prezentace.md` | the base's task with one added line `projekt: "[[Stěhování]]"` before `created` (D-2160) | a Task with a `projekt` and a `due` on Schedule (FR-QRY-05 AC-31). T01 (`Zavolat Janě`, the only Task with a `source`) keeps no `projekt`: FR-TSK-01 AC-6 sets it from the panel |

The base's `Projekty/Web.md` (`due: 2026-10-14`) is the fourth project (Today lane).

Expected boards and tables: `docs/acceptance/views.md` R208.

## Made at runtime by the tests (never committed)

- Base-fixture copies for the migration (FR-QRY-07 AC-27…AC-29): without `task.yml` (built-in Task), with a user `.tegg/queries/Schedule.yml` of other content, with `views: []`, with a hand-written `views: [Moje]`, with `version: 2`, with an unreadable `views: Schedule`, a read-only `.tegg/queries/` folder.
- A Kanban copy grouped by `tags` (`Podle štítků`, FR-TSK-05 AC-21); a Schedule copy with `lanes: vertical`; `done_lane` and `group_by` odd values (FR-QRY-01 AC-18); a `task.yml` option `Delegováno` with state `done`, `Odloženo` with state `cancelled`.
- A Book board copy for D-1891 uses `tests/fixtures/vaults/views/` (no change to it).
- `ui-state.json` from 0.4.x holding slice 5A's Tasks keys (last view, Kanban grouping, date filter, tag selection, Done expanded; FR-STO-07 AC-12).
- The reference vault for NFR-PERF-07 AC-5 (`tools/gen-vault --seed 1 --small-images`) with this folder's two default files and `views:` line added.
