# QA review: slice Q3 (display and grouping on views and queries), build

Branch `claude/slice-q3-build-e6a544`, reviewed at head `67003d51` (tree `299c1d85`, after the Q3-a…Q3-d builds and
the D-2216 test fixes). Reviewer: `qa-reviewer` agent, 2026-11-24. Scope: ACs `docs/acceptance/views.md` part five
(R220…R228), contract `docs/contracts/v1-views.md` part four (§33…§48), BRD decisions D-2172…D-2216, the build commits
`539c04ec`, `250f7dcc`, `23b7648c`, `c99abaca`, `ade20b64`.

**Verdict: not ready** at `67003d51`: the push gate had not passed on that tree, and two major findings. Owner
decisions on the findings: D-2217…D-2221 ("Accept all", 2026-11-24, BRD v1.257) and, on points the fixes raised,
D-2222…D-2224 ("Accept all", 2026-11-24, BRD v1.258). All findings are resolved on the branch (fix `80fa648b`, tests
`49164192`, contract notes in §41.3, §41.5, §41.6).

## T1 / blocker

- **B1 Push gate not on the head tree.** The last `./verify push` passed on tree `a4d79601`, before Q3-c and Q3-d. →
  `./verify push` and `./verify merge` run on the final head (see the PR).
- No data-loss finding. Type-file `views:` items are rewritten field by field (CP-35 / D-2200, D-2212): untouched keys,
  old words (`board`, `vertical`, `horizontal`) and comments keep their lines; no-ops compare valid values, so `board`
  equals Wall; writes go through `type_patch` (atomic, base-checked). Fence writes (`withUsage`) keep old words and
  trailing comments, leave an NFD `saved:` line alone and return nothing when nothing changed. The query file's
  `group_none` removal follows D-2197 with D-1458's read-back check. NFC on every new value.

## Major

- **M1 The quick re-sort could differ from the core's order** (`app/ui/src/views/ViewPanel.tsx`, `allSort.ts`). Rows
  carried only column values, so on a wall with `columns: []` the 300 ms re-sort (R222) drew title order, then the run
  reordered the cards; Select values were matched by exact label (the core folds case and diacritics), numeric strings
  counted as numbers, and the path tie-break compared UTF-16 units. → **D-2221**: the core puts every sort key in a
  row's `values` (`queries_q.rs` `row_of`, and the fake core); `allSort.ts` follows `sort_rows` (fold, numbers only from
  numbers, UTF-8 byte order). The All tab keeps the same rules (contract §28.1). `views_wall` FR-QRY-05 AC-37's sort
  step now checks the full order within 300 ms and after the run, also on a wall with no columns (approved
  `AC-Test-Change`).
- **M2 The ungrouped wall's Task cards lost R43's menu** (`app/ui/src/queries/board/WallGrid.tsx`). → **D-2220**: Task
  cards show `CardMenu` (Open, Status, Priority, Due date, Move to trash, Pin) without `Move to` and `Also add to`, on
  the menu button and ⇧F10; new test `fr_qry_05_ac37_ungrouped_wall_task_card_menu`.

## Minor

- **m1 Type settings › Views hidden until its reads finished** (`ViewsSection.tsx`); never shown when `queries_list`
  failed, and blanked when a view was added. → The section always shows; only each view's display name waits for its
  query; with `queries_list` failing, `Add view` shows and `Restore default views` is disabled. `views_display`
  FR-TYP-01 AC-29 waits for the names (**D-2224**, approved `AC-Test-Change`); regression test in
  `app/webkit/bug_q3qa_fr_qry_05_group_moves_and_views_section.test.ts`.
- **m2 `Move lane up` / `down` stepped over hidden groups** in a grouped Table, writing `lane_order` with no visible
  change. → **D-2219**: a move passes the next drawn movable group; a move or drop that leaves the drawn order as it is
  writes nothing.
- **m3 Grips differed between a grouped Table or List and the wall** for unknown-value and unresolved groups. →
  **D-2218**: no grip and no move on them anywhere; one predicate `laneMovable` (`queries/board/model.ts`).
- **m4 Group drop places not in the BRD** (header → before, rows → after, `No …` / `Done` → after the last movable
  group). → **D-2217**, narrowed by **D-2222**: on a wall a drop on `No …` / `Done` writes nothing (R187,
  `views_board` FR-QRY-05 AC-19). Contract §41.5.
- **m5 A broken own `widths` fell back to the 0.6.0 `usageColumnWidths` entry** (`app/ui/src/tables/widths.ts`), against
  contract §41.6 (absent only). → Fixed (`ownBroken`); with a broken `widths`, `Reset column widths` writes nothing
  (**D-2223**). L1 regression test `app/test/regress/bug_q3qa_fr_qry_05_groups_widths_sort.test.ts`.
- **m6 `data-user-content` on the whole ungrouped-wall root** (`WallGrid.tsx`) exempts card chrome from the NFR-OTH-02
  AC-25 pseudo-locale check. Contract §42.1 asks for it; card strings are covered by `cards.md`'s own tests. No change.
- **m7 Stale merge-base.** The local `main` was behind `origin/main`, so the review diff also held merged PRs
  #145…#155. The branch contains `origin/main` (`9bb78911`); the merge gate runs against it.

## Notes

- **N1 Trailers.** The changed existing tests carry `AC-Test-Change: …; approved-by: owner`: `0a5bf1a8`, `691cb86c`
  (D-2196, D-2210), `7b38cc2f` (D-2211), `c7923d22` (D-2212), `3df0cd4c` (D-2214), `b5e26169` (D-2215), `67003d51`
  (D-2216), `49164192` (D-2220, D-2221, D-2224). No `.only`, `.skip` or `#[ignore]` in the new tests.
- **N2 AC coverage.** Every new AC in `views.md` part five has a test named after it; FR-QRY-05 AC-47 is a [manual]
  design review for the owner.
- **N3 Flaky under load.** `queries_block` FR-QRY-05 AC-7 and the first `views_menus` check failed once each under 6
  workers and passed on re-run; `./verify flaky` is checked before merge. `nfr_perf_11_ac2` (machine load) and
  `icon_picker` FR-TYP-01 AC-20 (dev server only) fail outside Q3's files and pass on the built app.
- **N4 Real-app tests.** `app/e2e/views_display.ac.test.ts` and `app/e2e/nfr_perf_07_wall.ac.test.ts` (contract §44,
  D-2185) were run on the built app: 8 of 11 passed at first. One product bug: Table and List tabs never marked
  `rows-request` / `rows-ready` (§42.5) → fixed in `77f6ccb2` with regression test
  `app/webkit/bug_q3l6_nfr_perf_07_rows_marks.test.ts`. The other causes were test defects (no type files in the
  generated vault, the tab lookup, a scroll without a point, an unscrolled virtualized Table, Mac2's missing `expanded`
  attribute) → **D-2225**, approved `AC-Test-Change`. Then 11 of 11 pass. Measured, report-only before the release gate:
  NFR-PERF-07 AC-7 p95 197 ms (ungrouped wall over Image, 2,000 objects), AC-8 p95 132 ms (grouped Table, 1,000 rows),
  target 225 ms. Follow-ups outside Q3: `nfr_perf_07_board`, `nfr_perf_07_cards` and `nfr_perf_07_tasks_board` use the
  same wrong tab lookup; the `All` tab and `query/<name>` pages mark neither `board-*` nor `rows-*`.
