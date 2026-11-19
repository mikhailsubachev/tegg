# Plan: slice Q2, views on type pages (FR-QRY-07, FR-QRY-05, FR-QRY-01, FR-QRY-08)

Status: **draft for the owner**. The owner decided the split on 2026-11-19: Q2 comes first and Q2-T follows it (§7). The design boards are committed together with Q2's code, on its branch. The open points in §8 (AP-1478…AP-1496) are still open. Once the owner decides them, they become decisions from D-1762 on.

Designs (uncommitted on 2026-11-19, `design/edit-note-page/`):
- `Views` / `ViewsDark`: boards A–G, views on a type page.
- `ViewsApp` / `ViewsAppDark`: the Books page in the full app.
- `TasksQSpec` / `TasksQSpecDark`, `TasksQSchedule*`, `TasksQKanban*`: Schedule and Kanban as views (§7).

The designs follow on from slice Q:
- `docs/acceptance/queries.md` (R138…R146);
- `docs/contracts/v1-queries.md`;
- D-1433…D-1510.

D-1438 already set aside "slice Q2" for group by, Board, Calendar, editable cells, FR-QRY-04 and FR-QRY-07.

## 1. What changes for the user

1. **A type page has views.** It shows underline tabs under the header:
   - `All books` is always first. It is today's type page (FR-TYP-09).
   - Each other tab is a saved query whose type is fixed to that type.
   - Tabs can be added (`+`: New view or Show a saved query), reordered by dragging, renamed, duplicated, removed from the page, or moved to the trash (boards A, B, E).
2. **A view is a saved query** (`.tegg/queries/<name>.yml`, R138). The type file only lists the tabs, in order: `views: [Reading, Read in 2026]` (board F). The same view can sit in notes as a `/query` block (board G), and editing it in either place changes both (D-1446).
3. **Board view, with grouping.** `view: board` groups by a select or status attribute. It also groups by a multi-value attribute (multi-select, tags, relations), where a card shows in each of its lanes. The lanes are either:
   - `vertical`, as columns (board D1), or
   - `horizontal`, as rows that wrap and can be collapsed (board D2).

   On a board:
   - Lanes reorder by drag. The order is saved as `lane_order`.
   - Dragging a card to another lane writes the attribute (one write).
   - A lane's `+` / dashed tile creates an object pre-filled from the lane and the filters (FR-QRY-08).
   - A lane the filter excludes stays as a hatched drop target.
   - There is no `Show more`; the board scrolls sideways when its columns don't fit.
4. **Multi-level sort** (boards A, G):
   - The sort button opens a list of levels, each with its order, reordered by drag.
   - A header click sorts by that column alone; ⇧-click adds it as the next level or flips its order.
   - Headers show ¹ ².
   - `sort:` is written once per change (as D-1444). Sorting is set on the view, not in the editor.
5. **Sort and resize in embedded blocks** (board G): a query block in a note gets the same sort popover, header click / ⇧-click, and column resize by dragging a header's edge.
6. **Wide type pages.** The type page, its views and the Queries pages fill the main pane instead of the centred 960 px column (`.page-column`, `app/ui/src/styles.css:134`), as drawn in `ViewsApp`. Tables keep Title sticky and scroll sideways, as today.
7. **The editor for views** is the existing query editor (R142) with these changes (board C):
   - `Show` is fixed to the page's type.
   - New rows: `Group by` and `Lanes`.
   - `On cards` sets the board's `columns`.
   - There is no Sort row.

**Removed from scope by the owner (2026-11-19):** the Calendar view. FR-QRY-05 changes to "Table, List, Board", and FR-TSK-06 (task calendar) needs a decision of its own (AP-1494).

## 2. File format (R138 additions; the type file)

| Key | Where | New in Q2 |
|---|---|---|
| `views: [<query name>, …]` | `.tegg/types/<key>.yml` | Tab order. A missing key means only `All books`. Names resolve as `saved:` does (D-1434), and renaming a query patches this list (it becomes one more usage in the rename job). |
| `view: board` | query | It was already kept when written by hand (D-1438). Q2 makes it valid. |
| `group_by: <attribute>` | query | Select, status, multi-select, tags or relation. Any other type is a broken key that falls back to a list with a notice (D-1442). |
| `lanes: vertical \| horizontal` | query | A missing key reads as `vertical`. |
| `lane_order: [<option>, …]` | query | Options that aren't listed go to the end, in the attribute's option order. `Reset order` removes the key. |
| `sort: [ {by, order}, … ]` | query | Either a list (one level per item) or the R138 single mapping, which reads as one level. Tegg writes a list only when there are two or more levels, so existing files don't churn. |
| `columns:` on a board | query | The `On cards` attributes, which become the pills and the footer chip. |

The write rules stay as in D-1436: a commit replaces only the top-level keys that changed. Each of these makes one minimal atomic write, refused on an external change (FR-SYN-03):
- a tab drag (type file);
- a lane drag (`lane_order`);
- the lanes switch;
- a sort change.

**Machine-local** (`ui-state.json`, never in the vault, FR-STO-07):
- column widths per view (AP-1483);
- folded lanes per view;
- the last tab opened on each type page (AP-1481).

## 3. Core (`crates/tegg-core/src/queries_q.rs`, AR-03)

- `View::Board`; `Query.group_by: Option<String>`, `lanes`, `lane_order`; `sort: Vec<Sort>`. The reader accepts both `sort` forms, and the writer emits R138's style.
- Evaluator:
  - a stable multi-key comparison (ICU collation for text, D-1462 rules per key, then title as the last tie-break);
  - `group(results, attribute)`, which returns ordered lanes with counts. A multi-value attribute puts a card in every lane it has a value for. An empty value goes to a `No <attribute>` lane, which is always last.
- Board results are not paged: `limit` doesn't apply, and each lane holds all its cards (as drawn). NFR-PERF says how many cards we test (AP-1490).
- `query_apply` gains `group_by`, `lanes`, `lane_order`, `sort[]`. A new `type_views_set(type, names)` writes the type file's `views:`.
- Card move: the attribute write the Tasks Kanban already does (D-378), generalised to any select or status attribute. On a multi-value attribute, the move replaces the source lane's value with the target's (as the tag Kanban; Alt keeps both, D-378).
- Rename job (D-1434): patches `views:` in type files. Trash (D-1435): the tab shows `in the trash` with `Restore`.
- Live updates (FR-QRY-09): there is no change, because a board is one more shape of the same result set.

## 4. UI (`app/ui/src/`)

- `pages/TypePage.tsx`:
  - the tabs (`TypeViews`), with `All books` as tab 0, which is the current table unchanged;
  - the other tabs mount the query result in the page;
  - wide layout; `Filter…` and `Columns` on every tab.
- `queries/board/`:
  - `Board.tsx` (lanes, either direction; drag of cards and lanes; collapse; horizontal scroll), extracted from `tasks/Kanban.tsx` and `tasks/Schedule.tsx` so that Q2-T (§7) can reuse it;
  - the card from `tasks/TaskCard.tsx`, generalised to the universal card (CardAnatomy). The grouping attribute is hidden on the card, except a multi-value attribute when the card has several values.
- `queries/SortPopover.tsx`: multi-level sort, used by the type page views and by `queries/QueryBlock.tsx`. Header click and ⇧-click are added to both tables.
- Column resize in `QueryBlock.tsx`: the type-columns code (`types/columns.ts`, `<colgroup>`, `table-layout: fixed`, write on pointer release; `docs/contracts/type-columns.md`) moves to a shared helper keyed by view instead of by type.
- Query editor: `Group by`, `Lanes`, `On cards`; `Show` locked when it is opened from a tab.
- The Queries page shows a `<Type> page` mark on a view (AP-1480).
- Palette (FR-UX-03):
  - `New view`, `Edit view`, `Next view` / `Previous view`;
  - `Switch lanes`, `Add sort level`, `Reset lane order`;
  - for keyboard moves of cards and lanes: ⌥← / ⌥→ (as D-1357), plus ⌥↑ / ⌥↓ for rows (AP-1487).
- Strings are externalised. Light and dark use the dark boards.

## 5. How it is built (the usual flow, D-61)

1. Owner decides §8, and the BRD gets D-1762… (v1.190).
2. `ac-author` writes `docs/acceptance/views.md` (FR-QRY-07, FR-QRY-05 Board, FR-QRY-01 group by and multi-sort, FR-QRY-08 on boards, the block sort and resize, NFR-PERF). It also writes the fixture `tests/fixtures/vaults/views/` (Books with Status, Rating, Author, multi-select Genres, tags, Czech titles; synthetic, D-62).
3. Contract `docs/contracts/v1-views.md` (IPC, DOM, strings), plus any CP points the owner decides.
4. `test-author` commits the red tests (Rust `tests/ac_views*.rs`, WebKit `views_*.ac.test.ts`), then `./verify check-red`.
5. Build in this order: core (multi-sort, group, file keys) → type-page tabs + wide layout → board → sort popover + block resize → editor rows → palette. Each step stays green on `./verify commit`.
6. `qa-reviewer`, the `explorer` charter on the generated 5,000-note vault, `./verify merge`, then release **0.4.0** (feature → MINOR).

**AC tests this slice changes**, each with `AC-Test-Change: …; approved-by: owner`:
- type-page layout and width checks (`layout.ac.test.ts`, type-columns AC-29's wheel and sticky probes, if the wider pane moves them);
- FR-QRY-05 AC-6 (header click: it now replaces the sort, and ⇧ adds a level);
- queries' `sort` read rules (D-1462: a list is no longer a broken `sort`).

The exact list comes with the ACs.

## 6. Size and risk

- About the size of slice Q: ~25–35 ACs. The board component is the largest piece.
- **Risk: one shared board for types and tasks.** If the board is built for types only, Q2-T rewrites it. Mitigation: extract it from the Tasks Kanban now (§4) and keep the Tasks page on its own data until Q2-T.
- **Risk: sort compatibility.** Writing a `sort:` list into a file that other Tegg builds read as broken. Mitigation: write a list only for two or more levels, and keep `version: 1` (AP-1484).

## 7. Tasks on queries: slice Q2-T, recommended as a separate slice

Boards `TasksQSpec`, `TasksQSchedule`, `TasksQKanban`:
- The Tasks page becomes a type page with views. Schedule and Kanban become saved queries: `.tegg/queries/Schedule.yml` and `Kanban.yml`, with `task.yml` set to `views: [Schedule, Kanban, All tasks, Waiting on others]`.
- New keys: `group_by: { due: period }` (lanes Today & overdue · This week, by day · Later · Not scheduled) and `done_lane: { within_days: 7, folded: true }`.
- The Kanban's "columns by tag" becomes `group_by: tags`.

**Why a separate slice and not part of Q2:**
- 22 AC test files cover today's Tasks page (Schedule, Kanban, quick add, search, header, D-1280…D-1291, D-1357). Moving it needs one AC-test change, approved by the owner, for nearly every one of them, plus BRD changes:
  - D-378, D-379, D-516, D-517 and D-1357 are amended. D-1357 is the reason: lane order moves from the option order in `task.yml` to `lane_order` in the query.
  - FR-TSK-10 changes, because quick add is removed.
- The Tasks page is in daily use. Shipping Q2 first lets the board settle on Books-style types before Schedule and Kanban depend on it.
- Q2-T only adds things on top of Q2: the period grouping, `done_lane`, the default view files, and the migration of the Tasks page. It needs no other core work.

Q2-T then ships as 0.5.0. If the owner prefers one slice, the build order of §5 simply adds Q2-T's steps at the end, and the release waits for both.

## 8. Open points for the owner

From the boards' "To decide", plus gaps found while planning. Each has a proposal, the option given first.

| AP | Question | Proposal |
|---|---|---|
| AP-1478 | Are views saved queries referenced from the type file, or definitions inside the type file? | Saved queries, as drawn. Your brief says "views are defined as queries". |
| AP-1479 | What does `Show a saved query` accept? | Exactly that one type and no `this` filter; anything else is greyed with the reason (board B). |
| AP-1480 | Do views show in the Queries list? | Yes, with a `<Type> page` mark. |
| AP-1481 | Which tab opens first? | The last tab used on this Mac, per type (as D-481 for Tasks). `All books` on first open. |
| AP-1482 | Header click and ⇧-click | A click sorts by that column alone (it replaces the sort); ⇧-click adds the column as the next level or flips its order. Both write `sort:` once (D-1444). |
| AP-1483 | Where are column widths kept, for views and blocks? | Machine-local per query (`ui-state.json` `queryColumnWidths[name][col]`), shared by the tab and every block of that query; the type page keeps its own (D-1241). |
| AP-1484 | The `sort` list form, and `version` | Write a list only for ≥ 2 levels; `version` stays 1 (an older Tegg shows a broken sort and keeps the file, D-1442). |
| AP-1485 | Grouping by a multi-value attribute | A card shows in each of its lanes, with all its values. A drag replaces the source lane's value (Alt keeps both). `No <attribute>` lane last. |
| AP-1486 | Which attribute types can be grouped by? | Select, status, multi-select, tags, relation (one lane per linked object). Not dates (date periods are Q2-T, AP-1492) and not numbers or text. |
| AP-1487 | Keyboard | ⌃⇥ / ⌃⇧⇥ switch tabs; ⌥←→ / ⌥↑↓ move a focused card or lane; palette commands for each. |
| AP-1488 | Do the wide pages apply to `All <type>` and Queries as well? | Yes: the type page, every view, Queries and a query page. Notes keep their centred column. |
| AP-1489 | Board cards in an embedded block | Yes: a board in a note uses the same component, sized to the note column, scrolling sideways. |
| AP-1490 | Performance | A board with 500 cards in 6 lanes renders in ≤ 225 ms p95 (as NFR-PERF-07), with lanes virtualised; a card drag is shown in ≤ 100 ms. |
| AP-1491 | Out of Q2 | Editable table cells, FR-QRY-04 (cross-type) and Gallery stay for a later slice (they were in Q2 under D-1438). |
| AP-1492 | `Due · by period` grouping | Q2-T, for any date attribute (Books by Finished) or only Task's Due? Proposal: any date attribute, built in Q2-T. |
| AP-1493 | Default task views | Written as files when a vault is created (and when an existing vault first opens with Q2-T), with `Restore default views` in Type settings. |
| AP-1494 | Calendar removed | FR-QRY-05 becomes "Table, List, Board". FR-TSK-06 (task calendar) moves to W, or stays as a later v1.x item? |
| AP-1495 | Q2-T header and filters | The Tasks page takes the type-page header and tabs (the D-517 segmented control goes). All / Today / This week are dropped. The tag and text filters stay in the toolbar, not saved. |
| AP-1496 | FR-TSK-10 quick add, removed from the Tasks page (owner, 2026-11-19) | Reword FR-TSK-10: tasks come from `New Task`, a lane's dashed tile, ⌘N and the global hotkey; quick-add tokens (D-380) stay in the capture window's title field. |
