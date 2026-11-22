# QA review: slice Q2-T (Tasks on saved queries), build

Branch `claude/q2-tasks`, head fc029a27 (tree edd7a4e8), `./verify push` PASS (one unrelated flaky graph-panel test).
Reviewer: `qa-reviewer` agent, 2026-11-22. Scope: the Q2-T commits c5eb36d5…fc029a27 (the generated diff's base was a
stale local `main`; Q2, Q2.1 and the gate work are already merged in PRs #145–#149).

**Verdict: not ready** (one must-fix in a test); no T1 data-loss defect in the new writes. Owner decisions on the
findings: D-1935 (M1), D-1936 (S1), 2026-11-22.

## T1 / blocker

None. Checked and correct:
- Migration (`crates/tegg-core/src/taskviews.rs`): exclusive creates (NFC and case-folded name check, no-clobber
  rename); a live query of the same name is never read or written; `views:` last through a base-checked `type_patch`, so a
  crash reruns; newer or invalid `task.yml` and unreadable `views` skip before any write; `views: []` is `NotNeeded`;
  `Core::open` stays zero-write, the migration runs only for a newly opened core in `open_vault`. `fr_qry_07_ac28`,
  `fr_qry_07_ac29` cover variants (a)–(e), 200 kill cycles, 40 race trials.
- Restore: refuses Newer, Invalid, `ViewsUnreadable` and `NothingToDo` before writing; base-checked `views:` write; Undo
  restores `views:` then trashes the created files.
- Period, done-lane and status writes: `applyPeriodMove` changes only the value token (quotes, comment, line ending kept;
  D-230 append; `null` removes the key's lines; same valid date writes nothing). All board writes go through
  `writeCardChange` (read, version check, change, `touchModified`, write with base). Status moves set or remove
  `completed` (D-472).
- A 0.4.x vault opens unchanged apart from the decided files; `ui-state.json` is adopted once and stays machine-local.

## Must-fix

- **M1** `app/test/tasks_property.ac.test.ts` `fr_syn_06_ac22_every_task_lands_in_exactly_one_place` (TS-I3, TS-I5,
  D-1929): the Schedule half sorted the tasks itself with `period.ts` and asserted on its own loop, and the Done check
  was loosened to `length <= 1`. It no longer checks a real grouping. → **D-1935**: run the default Schedule query over
  the generated vaults and assert on its lanes and days, as the Kanban half does.

## Should-fix

- **S1** Migration on a synced vault (R202, D-1901): (a) a Mac that opens the vault before `task.yml` has synced creates
  a built-in `task.yml` plus `views:`, and the sync tool makes a conflict copy of the user's file; (b) two Macs migrating
  before they sync write `Schedule.yml` / `Kanban.yml` with different stamps, giving conflict copies. → **D-1936**: migrate
  only when `task.yml` exists and the vault has no online-only placeholders; identical default bytes on every Mac.
- **S2** Performance (NFR-PERF-07 AC-5): `tasks5a::query_link` finds a link target with a linear scan, once per task row
  with a `source` and once per link column in `row_of`, so a run is O(rows × objects). Build a path map once per run.
  Record the nightly AC-5 numbers before release.
- **S3** False "changed outside Tegg" (`app/ui/src/queries/board/write.ts`, FR-SYN-03): a write queued behind another
  write to the same object checks the version from when it was queued and is refused after the first lands. Accept the
  version returned by the previous write in the same queue.

## Notes

- N1 The review diff's base was stale; confirm the merge-base with `origin/main` before merging.
- N2 `defaultViews.ts`: if Restore created `task.yml`, Undo leaves a built-in `task.yml` instead of no file (low).
- N3 The Kanban half of FR-SYN-06 AC-22 checks every 10th generated vault (run time); record under D-1929.
- N4 D-1933: with `type/task` unpinnable, confirm an existing Task type pin can still be unpinned from its own menu.
- N5 `defaultViews.ts`: `NewerVersion` and `Rule` errors show the "changed outside" alert (only in a race).
- N6 `types3d.rs`: `type_patch` reads other type files only for `SetFolder`; `others` is used only by `check_folder`.
- N7 Sampled AC-test changes match the change table and D-1924, D-1929, D-1932, D-1934; no `.only` / `.skip` /
  `#[ignore]`.
- N8 No hard-coded colours or literal UI strings in the new modules; fixtures synthetic; the migration log has paths and
  error kinds only.
- N9 The flaky graph-panel test is unrelated.

## AC coverage

Every new AC of `docs/acceptance/views.md` part three has tests at the layers of contract §31.2 (FR-TSK-04 AC-22…29,
FR-TSK-05 AC-19…22, FR-TSK-10 AC-13, FR-QRY-07 AC-27…30, FR-TYP-01 AC-11, FR-QRY-01 AC-17…20, FR-QRY-02 AC-9,
FR-QRY-05 AC-28, 29, FR-QRY-08 AC-3, FR-TYP-09 AC-36, FR-FMT-07 AC-35, FR-FMT-12 AC-14, FR-SYN-02 AC-13, FR-SYN-03
AC-32, FR-SYN-06 AC-50, FR-STO-07 AC-12, NFR-PERF-07 AC-5 (nightly, report-only), FR-UX-03 AC-53, FR-UX-05 AC-25,
FR-UX-08 AC-25, NFR-OTH-02 AC-23) and the F3 regression `bug_q2t_fr_qry_07_multi_lane_card_links_resolve`. FR-QRY-07
AC-31 is the owner's manual design review. FR-SYN-06 AC-22 was weakened (M1).
