# QA review: claude/strat-4e-planning-578ac8 (slice 4E-1, type moves)

Head: e1ca644f92de16ff026b82856ec05db4dfb196d2  Tree: 14555ecd024167073dfda3a1ab998e3650b6cbe9  Verify: fail (one WebKit timing flake, `fr_lnk_01_ac10`)
Verdict: **not ready**

Reviewed by the `qa-reviewer` agent on 2026-10-28 against `docs/acceptance/type-moves.md` (4E-1 part), D-803…D-836, `docs/contracts/ms4-jobs.md` §5, §7, §8, §14, §14.8a. The slice is 46ced9b..e1ca644 (the prepared diff also held main's PRs #69…#82: `review-prep` ran against a stale local `main`).

## Checks

- **Verify:** the last push on this tree failed on one WebKit test (`backlinks.ac.test.ts › fr_lnk_01_ac10_own_links_show_up_within_1s_of_note_ready`, a known timing flake under load).
- **Rules:** atomic base-checked renames (`NameTaken` → next free stem, never an overwrite); zip before the first write; written files equal the plan (FR-SYN-06 AC-36); NFC names; `tidy-exempt.json` in Application Support; no network. Gaps: findings 7, 10, 11, 6.
- **Tests:** `ac-test-protection`, `red-first`, `fixtures`, `privacy` pass; changed AC tests match D-828, D-834, D-836. Weak spot: the fake core differs from the Rust core (findings 2, 4). L6 and nightly tests only typechecked.
- **Privacy:** synthetic fixture `tests/fixtures/vaults/type-moves/`; nothing from `test exports/`.

## Findings

1. **[blocker]** The push gate failed on HEAD's tree (known flake). Rerun until it passes on this tree.
2. **[major]** `crates/tegg-jobs/src/movejobs.rs` `move_label`: `backups.label.folderMove` gets `{ type, folder }` but its text needs `{plural}`; `backups.label.typeMove` gets the type key, not the Name. The fake sends the right args, so L5 passes; L6 `Restore "Move knihy to Četba"…` would fail. Fix: send `plural` / Name; assert the exact args at L4.
3. **[major]** `Interrupted` / `InterruptedDto` carry no kind or title, so an interrupted type move shows the rename banner; `job.interrupted.typeMove` is never used (FR-STO-04 AC-14, nightly test). Fix: add `kind` and `title`.
4. **[major]** No test runs the Rust R101 (`crates/tegg-core/src/movemap4e.rs`); D-833 asks for an L4 table test. Fix: `crates/tegg-core/tests/ac_type_move_plan.rs`.
5. **[major / owner]** `type_move_plan` sends `offered` as keys plus `targetNames`; D-821 says `offered: { key, name }[]`. §14.8a overrode an owner decision. Fix: follow D-821 or a new D-xx.
6. **[major]** `journal.rs` `finish_rest` (non-rename branch): Finish of a type-move journal ignores a failed note rename and still rewrites the links (ms4-jobs §8, D-433); after a `NameTaken` retry the journal keeps the first target (`journal::retarget` not called). Fix both; L4 case with the target taken before Finish.
7. **[major]** `packages/doc/src/transform.ts`: Content lines come from `toJS()`, so numeric-looking scalars change (`0123` → `123`, `1.50` → `1.5`, `0x1F` → `31`, big integers). D-813 says "the stored value". Fix: use the scalar's source text; extend the L2 generator.
8. **[major]** `app/ui/src/pages/NotePage.tsx`: text typed while a type move runs is saved with the old frontmatter (the dirty path of `onMoved` applies only rename ops), reverting the type and the mapping. Fix: apply the job's ops to the dirty text or block input; L5 test typing during `holdJob('writing')`.
9. **[major / owner]** A bulk convert of items with different source types is mapped by the first item's type; `schema.is_empty() ||` in the planner maps hand-written keys of untyped notes. D-813 covers one type pair. Fix: drop the branch; one dialog per source type or refuse mixed sources (AP point).
10. **[major]** `app/src-tauri/src/lib.rs` `type_patch`: a folder-only patch never checks the UI's `base`; an external `folder:` change is overwritten silently (NFR-REL-02). Fix: check `base` first (Conflict).
11. **[major / owner]** Incoming links are judged only by their resolution before the move: with duplicate stems a bare link can resolve to another duplicate after it, and a move can take over bare links to another same-stem note (D-810, D-291, §14.3 "before and after"). Part (b) needs an AP point.
12. **[major / owner]** The tidy exemption list keys on `id`; a stray without one (the usual Obsidian stray) is moved again after its Undo (D-812). Needs an owner decision (key by path, or add an `id`).
13. **[minor]** `jobs.ts`: `onMoved` fires only for `report.renamed`; a note open in the editor moved by tidy, a folder save or a bulk convert isn't followed (ms4-jobs §9).
14. **[minor]** D-831 `TEGG_TEST_FOCUS_FOLDER` isn't built; the L6 test clicks the field.
15. **[minor]** `tidy4e.rs`: `TEGG_TEST_QUIET_MS` and `TEGG_TEST_TIDY` are read without `TEGG_TEST=1`.
16. **[minor]** `ChangeTypeDialog.tsx`: R99's `New type` combobox is missing.
17. **[minor]** `transform.ts` `keepPatches`: the added alias uses `|` inside table cells (4C uses `\|`); `nfc()` is applied to the whole link text, changing NFD alias bytes.
18. **[minor]** `transform.ts`: a mapped property whose target key already exists is left under its old key without a word.
19. **[minor]** `NotePage.tsx`: if `type_move_plan` fails the type changes in place without a move; show an error instead.
20. **[minor]** `movejobs.rs`: an id leaves the exempt list only when its note moves; clear it on any type change (D-812).
21. **[minor / owner]** Undo of a folder save moves the notes back but keeps the new `folder:`; confirm and write into §14.6.
22. **[minor]** The planner doesn't validate the UI's mapping against `widens` (D-808).
23. **[minor]** Contract: §14.3 still says the stem rule is vault-wide (§14.8a built "in the target folder"); `type_patch` returns no `jobId` (§14.7); `tidy_now` never returns `null`.
24. **[minor]** L6 and nightly tests were only typechecked; run them before the MS7 gate (they would catch 2 and 3).

## Checked and correct

Kinds and flags; the zip only for bulk type moves and folder moves that move something; `folder:` written after the zip (D-822); templates get only `type:` (D-829); `review` only on an Inbox convert (D-826); Daily Note, Tag, Image, PDF never moved (board G, D-551); the tidy job only with the watcher and after `jobs_ready` (D-819); skipped strays retried after 30 s (D-832); path forms and relative links rewritten, percent-encoding per D-825; the moved note's own links covered by the L2 property test.

## Owner points

Finding 5 (D-821's shape), 9 (bulk convert across source types), 11 (duplicate-stem resolution after a move), 12 (exemptions for id-less strays), 21 (folder after Undo of a folder save).
