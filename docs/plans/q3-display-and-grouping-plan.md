# Plan: slice Q3, display and grouping on views and queries (FR-QRY-05, FR-QRY-07, FR-QRY-01, FR-QRY-08)

Status: **decided**. The owner set the direction on 2026-11-23 (D-2172, D-2173) and accepted the 14 open points of §9 the same day ("Accept all, write plan"): AP-2036…AP-2049 are D-2174…D-2187 (BRD v1.249). ACs, contract and tests are not written yet.

Designs (`design/edit-note-page/`, copied from the design canvas on 2026-11-23):
- `Views` / `ViewsDark`: boards A, B, W1, D3, D1, D2, H1, H2, C, E, G, F.
- `ViewsApp` / `ViewsAppDark`: the Books page in the full app, with the display switch.

The slice follows on from:
- slice Q2 and Q2.1 (`docs/acceptance/views.md` parts one and two, `docs/contracts/v1-views.md` §1…§22);
- slice Q2-T (part three, §23…§32: Tasks on saved queries);
- slice OC (`docs/contracts/v1-cards.md`: every card is the type's `ObjectCard`).

## 1. What changes for the user

1. **Three displays.** Every view on a type page and every query block in a note has a display switch: **List · Table · Wall** (icons in the toolbar, or in the block's header). Switching keeps the filters, the sort and the grouping; only the drawing changes (boards A, H2, G).
2. **Wall is the one cards display.** It replaces Board and Kanban. Without grouping it is the type's cards in a grid that wraps, in the view's sort order, with cards 220–300 px wide following the window width (board W1).
3. **Grouping works in every display.** The toolbar's `Group` button opens a menu of the attributes that can group, and `None`:
   - on a Wall, groups are lanes (boards D1, D2);
   - in a Table or List, a group is a full-width header row with a chevron, the value and the count (boards H1, H2). A click folds it; ⌥-click folds or unfolds all.
4. **Lanes are part of grouping.** `Lanes: Columns | Rows` sits in the Group menu, under the attribute, and only while a Wall is grouped (board D3). There is no lanes switch in the toolbar.
5. **A board is a grouped wall.** What 0.6.0 calls a board is a Wall with a group and lanes as columns. The Tasks `Kanban` view is a Wall grouped by Status; `Schedule` is a Wall grouped by the due period.
6. **The settings belong to the place of use.** A tab on a type page and a block in a note each keep their own display, grouping, lanes, lane order, sort, columns and column widths. The saved query holds the filters and the defaults.
7. **The query editor** loses its View, Lanes and Group by rows (board C). Display and grouping are set where the query is shown.
8. **`New view`** offers Table, List and Wall (board B). There is no Board entry.

Unchanged: the card itself (the type's card, Object settings › Card, no per-view override), card drags between lanes, the lane `+` tile, hatched excluded lanes on a wall, multi-level sort, the Columns menu, view menus, tabs.

## 2. Words

- **Display**: `list`, `table` or `wall`. The file key stays `view`.
- **Usage** (R194, unchanged): a tab (one item of a type file's `views:`) or a block (a reference fence `saved: <name>`). `query/<name>` is not a usage: it shows and sets the query's defaults.
- **Own / effective value** (R194, extended): a usage's own value is what its item or fence stores; its effective value is its own valid value, else the query file's.

## 3. File format

### 3.1 What is shared and what is per usage (D-2174; amends D-1836, D-1849)

| Key | Query file | Usage (tab item, fence) |
|---|---|---|
| `title`, `types`, `match`, `filters`, `limit`, `done_lane` | shared | – |
| `sort`, `columns` | default | own (as Q2.1) |
| `view` | default | own (**new**) |
| `group_by` | default | own (**new**); `group_by: none` as an own value means "not grouped" over a grouped default |
| `lanes` | default | own (**new**) |
| `lane_order` | default | own (**new**) |
| `widths` | – | own (**new**, D-2177) |

- A usage without an own value takes the query's, so every existing vault shows what it shows today.
- `Use the query's display` / `grouping` removes the usage's own key, as `Use the query's sort` does (D-2176).
- The page `query/<name>` writes the query file (the defaults), as it does for sort and columns today.

### 3.2 Values

| Key | Values | Notes |
|---|---|---|
| `view` | `list` \| `table` \| `wall` | `board` still reads, as `wall` (D-2179). |
| `group_by` | an attribute key, `{ <key>: period }`, or `none` (usage only) | Select, status, multi-select, tags, relation, or a date by period (today / this week / later, D-1776). No grouping by month (D-2180). |
| `lanes` | `columns` \| `rows` | `vertical` / `horizontal` still read, as `columns` / `rows` (D-2179). Missing = `columns`. Ignored without a group or outside a wall; kept in the file, so grouping again brings the direction back. |
| `lane_order` | a list of group values | Also the group order of a grouped Table or List. |
| `widths` | `{ <column key>: <px>, … }` | One flow line. Only the columns the user resized. |

- **No migration** (D-2179). Old words keep reading. Tegg writes the new word only when that key next changes; a file is never rewritten just to rename a value.
- `version` stays 1.
- Board F on the canvas shows `view`, `group_by`, `lanes` and `lane_order` in the query file. That stays valid as the defaults; the board should be redrawn to show a tab item with its own keys.

### 3.3 Examples

The type file:

```yaml
views:
  - name: Rozečtené
    view: wall
    group_by: status
    lanes: columns
    lane_order: [Reading, To read, Read]
  - name: Přečtené 2026
    view: table
    sort: { by: finished, order: desc }
    columns: [author, rating, finished]
    widths: { title: 300 }
```

A block in a note:

````markdown
```query
saved: Přečtené 2026
view: wall
group_by: none
```
````

### 3.4 The `All <plural>` tab (D-2178)

It is not a query and has no usage. Its display and grouping are kept on this Mac (`ui-state.json`), as its sort is. Its groups follow the attribute's option order; they can't be reordered by drag.

### 3.5 Machine-local (`ui-state.json`, FR-STO-07)

- folded groups and lanes per usage (unchanged, D-1845);
- the `All <plural>` tab's display, grouping and lanes (D-2178);
- column widths of `All <plural>` (`typeColumnWidths`, unchanged) and of the page `query/<name>`.

Column widths of a usage move **into the vault** (D-2177; amends D-1845). Until a usage has its own `widths`, the widths kept on this Mac for it are still read; the first resize writes the usage.

## 4. What each action writes

| Action | Tab | Block | `query/<name>` |
|---|---|---|---|
| Display switch | the `views:` item | the fence | the query file |
| Group menu: attribute, `None` | the item | the fence | the query file |
| Group menu: Lanes | the item | the fence | the query file |
| Lane or group drag, `Reset order` | the item | the fence | the query file |
| Column resize | the item, once, when the drag ends | the fence, once | `ui-state.json` |
| Sort, Columns | as Q2.1 | as Q2.1 | as Q2.1 |
| Fold a group or lane | `ui-state.json` | `ui-state.json` | `ui-state.json` |
| Card drag between lanes, a lane's `+` tile | the object (unchanged) | the object | the object |
| Editor `Done` | the query file: filters, title, types, limit | same | same |

Every vault write is one minimal atomic write of one file, base-checked (FR-SYN-02, FR-SYN-03), and none when the result equals the disk (FR-SYN-06). A block without an editor (read view, trash, an embedded note) can't be written: its switch, Group menu and resize handles are disabled, as its sort is today (D-1839).

**Consequence of D-2177 to accept knowingly:** resizing a column in a note's block changes the note (one autosave, `modified:` follows D-55), and resizing on a type page changes the type file.

## 5. Behaviour the ACs must fix

- **Group menu** (D3, H1): the attributes that can group, `None`, and on a grouped wall the Lanes part.
- **Grouped Table / List** (D-2181…D-2184):
  - headers follow `lane_order`, then the option order; `No <attribute>` is last;
  - sort applies inside each group;
  - a multi-value attribute lists the object under each of its values (D-1769); a relation group's header is the related object's chip;
  - only groups that have rows are shown (no hatched groups);
  - rows aren't dragged between groups and a group has no `New <Type>` row in this slice;
  - headers can be dragged into another order (writes `lane_order`).
- **Period grouping in a Table or List** (D-2181): flat groups `Today & overdue`, `This week`, `Later`, `No date` and, with `done_lane`, `Done`. No day sub-headers.
- **Wall**: ungrouped is a wrapping grid; grouped is today's board (lanes as columns or rows, hatched excluded lanes, card drag, `+` tile, lane drag, collapse of rows). The grouping attribute is hidden on the card, with D-1769's exception.
- **Performance** (D-2185): an ungrouped wall renders only the visible cards and holds NFR-PERF-07's 225 ms p95 on the reference vault's largest type.
- **Editor** (board C): `Show`, `Filters`; no View, Lanes, Group by, Sort. The done-lane checkbox stays for a query grouped by a period.
- **Queries page, view menus, tabs, Show a saved query**: unchanged.

## 6. Core (`crates/`, AR-03)

- `tegg-core::queries_q`: `View::Wall` (reads `board`); `Lanes::{Columns, Rows}` (reads the old words); the writer emits the new words on a changed key only. A wall no longer needs a `group_by`.
- `tegg-format::usage` (`usage_of`): reads `view`, `group_by`, `lanes`, `lane_order`, `widths` besides `sort` and `columns`, with the same Absent / Set / Broken shape rule.
- `tegg-schema`: `ViewItem` gains the five values; `TypeOp::SetViewDisplay`, `SetViewGroup`, `SetViewLanes`, `SetViewLaneOrder`, `SetViewWidths` with Q2.1's minimal-rewrite rules; the rename job and Duplicate carry the new keys.
- The run (`query_run`): takes the usage's effective display and grouping. `group` is computed for any display; `card` data is filled for every wall run (grouped or not), and List / Table runs keep the no-excerpt read.
- `@tegg/doc` (`queryfence.ts`): `fenceUsage`, `withUsage` and `applyFenceUsage` learn the new keys (place, style, removal as R195).

## 7. UI (`app/ui/src/`)

- `views/ViewPanel.tsx`, `queries/QueryBlock.tsx`, `queries/QueryPage.tsx`: the display switch and the Group button; the body by display: `QueryList`, `QueryTable`, `QueryBoard` (renamed `QueryWall`), with an ungrouped grid.
- `queries/GroupMenu.tsx` (new): attributes, `None`, Lanes.
- `queries/Grouped.tsx` (new): group headers, folds and header drag for Table and List.
- `views/useUsageWrite.ts`: `display`, `group`, `lanes`, `laneOrder`, `widths` beside `sort` and `columns`.
- `tables/widths.ts`: the `usage` scope writes through the usage writer; `type` and `page` scopes stay machine-local.
- Query editor: the View, Lanes and Group by rows go.
- `New view`: Table, List, Wall. Type settings › Views names a view `Wall · by {attribute}`.
- Palette (FR-UX-03, no new shortcuts, D-1771): `Display as list`, `Display as table`, `Display as wall`, `Group by…`, `Remove grouping`, `Use the query's display`, `Use the query's grouping`. `Switch lanes` stays.
- Strings externalised; `Board` and `Kanban` leave the catalog as display names (the default task view keeps its file name `Kanban`). Light and dark.

## 8. How it is built (D-61)

1. Done: the owner's decisions, BRD v1.249.
2. Done: the boards `Views`, `ViewsDark`, `ViewsApp`, `ViewsAppDark` are copied to `design/edit-note-page/`. Still to do on the canvas, then copied again: board F redrawn per §3.2, and `TasksQKanban`, `TasksQSpec`, `QueryBlock` brought in step (D-2187).
3. `ac-author`: `docs/acceptance/views.md` part four, on the fixtures `tests/fixtures/vaults/views/`, `views-usage/`, `views-tasks/` with a new overlay for own display and grouping. Gaps come back as AP points.
4. Contract `docs/contracts/v1-views.md` part four.
5. `test-author`: red tests, `./verify check-red`.
6. Build, each step green on `./verify commit`:
   - **Q3-a** format and core;
   - **Q3-b** display switch, Group menu, ungrouped wall, `New view`;
   - **Q3-c** grouped Table and List;
   - **Q3-d** Tasks views, editor rows removed, type settings, palette.
7. `qa-reviewer`, the `explorer` charter on the generated vault, `./verify merge`, release **0.7.0**.

**AC tests this slice changes** (each with `AC-Test-Change: …; approved-by: owner`; the exact list comes with the ACs):
- the editor's View / Lanes / Group by rows and the toolbar lanes switch (FR-QRY-05 AC-10, AC-17 and neighbours);
- `view`, `group_by`, `lanes`, `lane_order` as shared keys (part two's R194, R197 tables; D-1849's tests);
- usage widths in `ui-state.json` (FR-STO-07 AC-11, FR-QRY-05 AC-25);
- `New view` › Board; the `Board · by {attribute}` name; catalog key sets;
- a `view: board` without `group_by` being broken.

## 9. Decisions (owner, 2026-11-23)

Direction: **D-2172** (three displays; Wall replaces Board and Kanban), **D-2173** (grouping in every display; lanes in the Group menu).

| AP | Decision | What was decided |
|---|---|---|
| AP-2036 | D-2174 | `view`, `group_by`, `lanes`, `lane_order` are per usage; the query file holds the defaults, as for sort and columns. |
| AP-2037 | D-2175 | The editor has no Group by row; the toolbar's Group menu is the only place. |
| AP-2038 | D-2176 | No dot on a block that differs; `Use the query's display` / `grouping` instead. |
| AP-2039 | D-2177 | A usage's column widths are stored with the usage, in the vault, written once when the drag ends. Folds stay on this Mac. |
| AP-2040 | D-2178 | The `All <plural>` tab keeps its display and grouping on this Mac. |
| AP-2041 | D-2179 | No migration: `board`, `vertical`, `horizontal` keep reading; new words are written when the key next changes. |
| AP-2042 | D-2180 | No grouping by month in this slice. |
| AP-2043 | D-2181 | Period grouping in a Table or List is flat, without day sub-headers. |
| AP-2044 | D-2182 | No row drag between groups in a Table or List. |
| AP-2045 | D-2183 | No `New <Type>` in a Table or List group. |
| AP-2046 | D-2184 | A Table or List shows only groups that have rows. |
| AP-2047 | D-2185 | An ungrouped wall renders visible cards only and holds 225 ms p95. |
| AP-2048 | D-2186 | FR-QRY-05 reworded: List, Table, Wall; grouping in any display; Gallery/cards is the Wall. |
| AP-2049 | D-2187 | `TasksQKanban`, `TasksQSpec` and `QueryBlock` on the canvas are stale; nothing built is removed (the `Choose a query` picker and saved-query files stay). |

## 10. Size and risk

- About the size of Q2.1 plus a third of Q2: ~30 ACs. The grouped Table / List and the usage keys are the largest pieces; the wall reuses the board.
- **Risk: per-usage grouping and shared `lane_order` tests.** Many of Q2's tests assert a write to the query file. Mitigation: the query page keeps writing the query file, so those tests move to `query/<name>` where they can.
- **Risk: widths in the vault.** More writes and possible sync conflicts on type files. Mitigation: one write per drag, none when unchanged, base-checked; only resized columns are stored.
- **Risk: an ungrouped wall on a large type.** Mitigation: windowed rendering and the L5 check of D-2185 before the UI work is called done.
