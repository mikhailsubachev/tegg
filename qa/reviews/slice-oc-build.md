# QA review: slice OC (object cards, Object settings, the Settings layout), build

Branch `claude/slice-oc-build-377cd5`, reviewed at tree `01bab36c` (after the merge of `origin/main`, Android slice AND-1,
PR #154, and D-2166…D-2169). Reviewer: `qa-reviewer` agent, 2026-11-23. Scope: slice OC's ACs (`docs/acceptance/cards.md`
and its additions in `types.md`, `views.md`, `embeds.md`, `previews.md`, `app-shell.md`), contract
`docs/contracts/v1-cards.md`, the build and the merge with main.

**Verdict: not ready** at tree `01bab36c` (two major findings). Owner decisions on the findings: D-2170 (M1), D-2171
(M2), in chat, 2026-11-23 (BRD v1.248). Both are resolved on the branch, with the minor fixes below.

## T1 / blocker

None.

## Major

- **M1 AC ID collision with main.** Main's Android ACs (`docs/acceptance/android-shell.md`) already use FR-SYN-03 AC-33
  (`fr_syn_03_ac33_index_settles_on_android`) and FR-STO-07 AC-13 (`fr_sto_07_ac13_machine_local_in_private_storage`);
  main goes up to FR-SYN-03 AC-34 and FR-STO-07 AC-14. Slice OC used the same two IDs for its own criteria, so the AC
  coverage matrix merged two different criteria under one ID. → **D-2170**: slice OC's FR-SYN-03 AC-33 becomes **AC-35**
  and its FR-STO-07 AC-13 becomes **AC-15**, in `cards.md` (now "adds to AC-1…AC-34" and "AC-1…AC-14"), the acceptance
  README's cards.md row, contract v1-cards, the cards overlay README and a code comment (commit `2722fafd`); the tests
  are renamed `fr_syn_03_ac35_card_and_icon_writes_check_the_base` (`crates/tegg-core/tests/ac_cards.rs`,
  `app/webkit/icon_picker.ac.test.ts`) and `fr_sto_07_ac15_recent_icons_are_machine_local` (`app/e2e/cards.ac.test.ts`,
  `app/webkit/icon_picker.ac.test.ts`) with an approved `AC-Test-Change` (commit `5d308796`). Main's Android references
  are unchanged. `./verify coverage` now lists FR-SYN-03 AC-33 (Android) and AC-35 (slice OC), FR-STO-07 AC-13
  (Android) and AC-15 (slice OC) as separate rows.
- **M2 Owner data in board section D.** D-2074's exception to D-62 named only section C of `CardSettings` and
  `CardSettingsDark`, but section D, "Property icons", repeats section C's card with the same project data. → **D-2171**
  (amends D-2074): the exception covers sections C and D; both may be looked at for layout only and their content is
  never copied. D-2074's wording, the CLAUDE.md slice OC note, `cards.md`, contract v1-cards, the cards overlay README
  and the plan's AP-1569 note follow (commit `2722fafd`). No test, fixture or code holds that data.

## Minor

- **m1** CLAUDE.md's slice OC status named D-2166 but not D-2167…D-2169 or the review's decisions. → Added D-2167…D-2171
  and BRD v1.248.
- **m2** `docs/requirements-coverage.md` still said "no ACs yet" for FR-TYP-01 and FR-TYP-11. → They point to `types.md`
  and `cards.md` (and `type-columns.md` for FR-TYP-11 AC-4).
- **m3** The slice OC section headings in `docs/acceptance/app-shell.md` and `docs/acceptance/types.md` said "draft"
  while their status was approved. → Both say "approved".
- **m4** D-2161 and D-2162 were recorded as "owner: seen". The owner approved them ("Approve all three", 2026-11-23). →
  Both say approved; the BRD changelog follows.
- **m5** BRD changelog: v1.247 (dated 2026-11-22) also held D-2166…D-2169 from 2026-11-23. → They moved to the new
  v1.248 row with D-2170, D-2171; v1.247 keeps D-2163…D-2165.

## Notes

- **N1 Trailers checked.** Commit `78f4863f` (formerly `386bfab3`, D-2163) carries `Fixture-Change:` and
  `AC-Test-Change:`; merge `38c19ba9` carries an `AC-Test-Change:` for main's change to `app/webkit/graph.ac.test.ts`
  only; commit `a3ad3af3` (the D-2166 renumbering) carries both trailers. The new commits carry `Fixture-Change:`
  (`2722fafd`, the overlay README only) and `AC-Test-Change:` (`5d308796`, D-2170). No `.only`, `.skip` or `#[ignore]`.
- **N2 Performance to watch.** `fresh_types()` in `crates/tegg-core/src/types3d.rs` stats every type file on each read
  that needs the definitions, to follow another program's write at once (v1-cards §3.4, FR-TYP-11 AC-19). Cheap with a
  handful of type files; watch it in the NFR-PERF-07 AC-6 nightly numbers. No change.
