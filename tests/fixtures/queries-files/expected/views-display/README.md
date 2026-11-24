# Expected bytes for slice Q3 (display and grouping per usage)

Synthetic (D-50, D-62), written by the test author with the red tests from `docs/acceptance/views.md` part five
(R220…R228) and `docs/contracts/v1-views.md` §43.4; each file is the whole file after the action. Byte rules as
`../views/`: LF, UTF-8 without BOM, one final newline; the `-crlf` files use CRLF on every line, the `-no-newline` files
have no final newline; NFC except the NFD `saved:` line of `fences/nfd-saved*.md`. Don't open and re-save these files in
an editor.

Clock `2026-11-19T10:00:00+01:00` (Tasks rows: part three's `2026-10-14T12:00:00+02:00`). Inputs: **base** =
`tests/fixtures/vaults/views/`, **overlay** = the base with `tests/fixtures/vaults/views-display/` copied over it,
**views-tasks** = `tests/fixtures/vaults/tasks/` with `views-tasks/` over it. `notes/` hold the note after the editor's
autosave (`modified:` set to the clock, D-55) unless the row says otherwise; `fences/` hold `applyFenceUsage` results
(no `modified:` change) next to their `-input.md`.

**Steps in sequence.** Where a criterion lists steps, each file is the result of every step before it, starting from the
input.

## `types/`

| File | Input → action | Criteria |
| --- | --- | --- |
| `book-prectene-view-wall.yml`, `book-prectene-view-list.yml` | base; `Wall` on the `Přečtené 2026` tab; then `List` (then `Use the query's display` gives the base `book.yml`) | FR-QRY-05 AC-32 |
| `book-vyborne-group-status.yml`, `-group-status-wall.yml`, `-group-status-wall-rows.yml`, `-group-none.yml` | base; on `Výborné knihy`: Group › `Status`, `Wall`, `Rows`, `None` | AC-34 |
| `book-overlay-rozectene-use-query-grouping.yml`, `book-overlay-prectene-use-query-display.yml`, `book-overlay-rozectene-group-status.yml` | overlay; AC-35 steps 3, 4, 6 (each from the overlay) | AC-35 |
| `book-overlay-podle-zanru-wall.yml` | overlay; `Wall` on `Podle žánru` (line 24 `lanes: vertical` kept) | AC-40 |
| `book-overlay-vyborne-lane-order-eva.yml` | overlay; the `Eva Lindová` header dragged above `Lucie Horká` | AC-42 (a) |
| `book-prectene-widths-title-300.yml`, `book-prectene-widths-title-300-author-200.yml` | base; `Resize Title` to 300 px, then `Resize Author` to 200 px (`⌫` on Author gives the first file again; `Reset column widths` gives the base) | AC-43 |
| `book-prectene-widths-legacy-rating.yml` | base with 0.6.0's `usageColumnWidths["tab:book/přečtené 2026"] = { title: 200, author: 180 }`; `Resize Rating` to 150 px | AC-44 |
| `book-overlay-podle-autora-lanes-columns.yml` (+ `-crlf`, `-no-newline`) | overlay (or its CRLF / no-final-newline copy); `Columns` on `Podle autora`: line 27 only, line 26 `view: board` kept | AC-46 (c), FR-FMT-07 AC-37 |
| `book-overlay-vyborne-renamed.yml` | overlay; the query rename `Výborné knihy` → `Nejlepší knihy`: line 18 only | FR-QRY-07 AC-34 (a) |
| `book-overlay-vyborne-duplicate.yml` | overlay; `Duplicate` on `Výborné knihy`: lines 18…21 with the name `Výborné knihy (2)` after line 21 | AC-34 (b) |
| `book-overlay-without-podle-zanru.yml`, `book-overlay-readded-podle-zanru.yml` | overlay; `Remove from Books page` on `Podle žánru`; then `Show a saved query` › `Podle žánru` (a plain name at the end) | AC-34 (c) |
| `book-overlay-without-podle-autora.yml` | overlay; `Move to trash` on `Podle autora` from its view menu (Undo gives the overlay back) | AC-34 (d) |
| `book-overlay-cela-zed-sort-desc.yml` | overlay; `Title ↓` as the `Celá zeď` tab's own sort | FR-QRY-07 AC-35 |
| `book-overlay-xbarva-input.yml`, `book-overlay-xbarva-after-display.yml` | the overlay with `    x-barva: modrá` after line 21; then `Wall` on `Výborné knihy` (`x-barva` stays after the known keys) | AC-35 |
| `book-overlay-lucie-renamed.yml` | overlay; the 4C rename `Lucie Horká` → `Lucie Horká-Nová` (no other byte changes) | FR-LNK-03 AC-26 |
| `task-schedule-view-table.yml` | views-tasks; `Table` on the `Schedule` tab (`Use the query's display` gives `task.yml` back) | FR-TSK-04 AC-30 |
| `task-kanban-lane-order-waiting.yml` | views-tasks; `Waiting`'s grip dragged before `To do` on the `Kanban` tab | FR-TSK-05 AC-23 |

## `notes/`

| File | Input → action | Criteria |
| --- | --- | --- |
| `cteni-2026-prectene-view-wall.md` | base Čtení; `Wall` in its `Přečtené 2026` block: `view: wall` after line 11 | FR-QRY-05 AC-33 (a) |
| `cteni-2026-rozectene-lanes-rows.md`, `cteni-2026-rozectene-lane-order.md` | base Čtení; Group › `Lanes` › `Rows` in its `Rozečtené` block; then `To read` dragged before `Reading` (D-2203) | AC-33 (d) |
| `cteni-2026-prectene-widths-title-200.md` | base Čtení; `Resize Title` to 200 px in its `Přečtené 2026` block | AC-43 (b) |
| `zobrazeni-b6-view-wall.md` | overlay Zobrazení; `Wall` in block 6: `> view: wall` after line 53 | AC-33 (b) |
| `zobrazeni-b5-group-author.md` | overlay Zobrazení; Group › `Author` in block 5: line 46 only | AC-36 (a) |
| `zobrazeni-b2-lane-order-reading.md` | overlay Zobrazení; `Reading` dragged above `To read` in block 2: line 21 | AC-42 (a) |
| `zobrazeni-b2-view-list.md` | overlay Zobrazení; `List` in block 2: line 20 (the kill harness's second text) | FR-SYN-02 AC-15 |
| `zobrazeni-vyborne-renamed.md` | overlay Zobrazení; the query rename job: lines 43 and 53 (no `modified:` change) | FR-QRY-07 AC-34 (a) |
| `lane-order-fence-input.md`, `lane-order-fence-renamed.md` | the runtime note `Pages/Autorky.md` (a fence whose `lane_order` names Lucie Horká, no other link to her); the 4C rename (the job's link write: no `modified:` change, D-1467) | FR-LNK-03 AC-26 |

## `queries/`

| File | Input → action | Criteria |
| --- | --- | --- |
| `prectene-2026-view-wall.yml` | base; `Wall` on `query/Přečtené 2026`: line 14 and `modified:` | AC-33 (c) |
| `rozectene-lanes-rows.yml` | base; `Rows` on `query/Rozečtené`: line 15 | AC-46 (c) |
| `podle-zanru-lanes-columns.yml` | base; `Columns` on `query/Podle žánru`: line 14 with its trailing comment | AC-46 (c) |
| `rozectene-view-wall.yml` | after `../views/rozectene-view-table.yml` (Group › `Genres`, then `Table` on `query/Rozečtené`), `Wall` | AC-46 (c), FR-QRY-06 AC-26 |
| `cela-zed-group-status.yml` | overlay; Group › `Status` on `query/Celá zeď`: `group_by: status` after line 10 | FR-QRY-06 AC-26 |
| `rozectene-group-none.yml` | base; Group › `None` on `query/Rozečtené`: line 14 removed (D-2191) | FR-QRY-06 AC-26 |
| `new-view-wall-autor.yml`, `new-view-wall-book.yml` | `New view` › `Wall` + `Done` on `type/autor`, `type/book` | FR-QRY-07 AC-32 |
| `schedule-lanes-columns.yml` (+ `-crlf`, `-no-newline`) | views-tasks `Schedule.yml` (or its copies); `Switch lanes` on `query/Schedule` | FR-FMT-07 AC-37 |

The query-page drags of FR-QRY-05 AC-42 and FR-TSK-05 AC-23 step 4 reuse `../views/rozectene-lane-order-to-read-first.yml`
and `../views-tasks/queries/kanban-lane-order-waiting.yml`; FR-QRY-06 AC-26's `Genres` and `Table` reuse
`../views/rozectene-group-by-genres.yml`, `../views/rozectene-view-table.yml`.

## `fences/` (`applyFenceUsage(input, range of fence n, change)`, FR-FMT-06 AC-8)

| Case | Fence | Change |
| --- | --- | --- |
| `insert-view` | 1 | `{ view: 'wall' }` into a fence with only `saved:` |
| `insert-group` | 1 | `{ group: status }`: after `saved:`, before `sort:` |
| `insert-group-period` | 1 | `{ group: { finished: period } }` after `view:` |
| `insert-group-none` | 1 | `{ group: none }` before `columns:` |
| `insert-lanes` | 1 | `{ lanes: 'rows' }` after `group_by:`, before `sort:` |
| `insert-lane-order` | 1 | `{ laneOrder: [To read, Reading, Read] }` after `group_by:`, before `widths:` |
| `insert-widths` | 1 | `{ widths: [title 240, author 180] }` last |
| `insert-all` | 1 | `view`, `group_by`, `lanes`, `lane_order` (D-230 quoting), `widths` in one change, in R221's order around `sort` and `columns` |
| `replace-view` | 1 | `{ view: 'wall' }` replacing `view: table` |
| `remove-display` | 1 | `{ view: null }` (`Use the query's display`) |
| `remove-grouping` | 1 | `{ group: null, lanes: null, laneOrder: null }` (`Use the query's grouping`) |
| `tilde` | 1 | `{ view: 'list' }` in a `~~~query` fence |
| `info-meta` | 1 | `{ group: status }` in a ```` ```query meta ```` fence |
| `list-item` | 1 | `{ view: 'wall', widths: [title 300] }` in a fence inside a list item |
| `callout` | 6 (Zobrazení's block 6) | `{ view: 'wall' }`: `> ` on the new line |
| `comment-broken` | 5 (Zobrazení's block 5) | `{ group: author }`: the broken `group_by: finished` replaced in place, the comment and the other broken lines kept |
| `crlf` | 2 (a CRLF copy of Zobrazení) | `{ view: 'list' }` with CRLF |
| `nfd-saved` | 1 | `{ view: 'wall' }`: the NFD `saved:` line keeps its bytes |
| `old-word-kept` | 1 | `{ group: author }` between `view: board` and `lanes: horizontal …`, which keep their bytes |

`../../expected-views-display.json` (L3) lists what a reader gives for every fence of these files and of the overlay's
Zobrazení (`null` absent, `"broken"`, or the value), the overlay's `views:` items, the query reads and R228's results.
