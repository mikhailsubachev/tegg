# Open items for the next slices

State on 2026-10-18, after PR #48 (L6 fixes on main), the merge of main into `ms5/5a-tasks` (PR #47) and the 5A-1
preview feedback (D-516…D-523). Each item names
what is open and the next step. Remove an item once it is done or decided.

## Before PR #47 (5A-1 tasks) merges

1. **Merge commit not pushed.** `ms5/5a-tasks` holds the merge of main (84ea504) locally. Next: rerun the L6 failures
   below on a quiet machine, then `./verify push`, push.
2. **fr_syn_02_ac7 (killed while typing): passed** in the full L6 run after the D-516…D-523 build (display on, nothing
   recording), which supports the machine-state explanation. Next: keep an eye on it; if it fails again on a quiet
   machine, treat it as a data-loss bug (D-62) and start with a `bug_…_fr_syn_02_…` regression test.
3. **fr_emb_01_ac1 (Režimy shows 12 embeds) finds 0 frames.** Same pattern and the same A/B result as item 2. Next:
   rerun together with item 2.
5. **fr_tsk_05_ac13 (two Kanban drags) depends on the window width.** The `#práce` column sits partly beyond the
   1280-pt window, and the test failed once on that. It passed in the last full run. The proposed test change (scroll the
   target column into view before the drag) is not approved yet. Next: ask the owner if it fails again.

## QA tooling and gates

6. **L6 needs an unlocked screen and the display on.** With the screen locked, the app never shows its first route
   (every test fails at "route-ready mark missing"). The display also turned off during a run despite
   `caffeinate -dimsu`. Next: an L6 preflight that fails fast with a clear message when `IOConsoleLocked = Yes` or the
   display is off.
7. **The push gate is over budget.** It took 769 s against the 600 s budget; the slowest steps were app-webkit (291 s),
   core-rust-test (244 s) and jobs-test (69 s). Next: a speed-up pass (see `verify-speedup-proposal.md`).
8. **Perf marks are written once per process** (ms2-shell §1). A test that needs a second `note-ready` in one launch
   can't get it, so fr_emb_04_ac8 now launches once per note. Next: decide whether ACs may need repeated marks (for
   example a test-mode counter mark). If so, it needs a contract decision (AP point).
9. **4F property test strictness.** Seed 873028052 exposed the list-marker bug (fixed in the editor). The property
   test's strict model check can still fail on adjacent lists, which is a test-strictness issue never raised with the
   owner. Next: raise it as an AP point if it recurs.

13. **Nightly and perf L6 tests fail (not in the push gate).** A full `npm run test:e2e` (which, unlike the gate's
    `app-e2e` step, includes `nightly_*` and `nfr_perf_*`) failed four of them on 2026-10-18:
    `fr_lnk_03_ac17` (SIGKILL during the hub rename: "the old hub file holds other bytes" in 19 of 20 cycles, a
    possible T1 or a test-expectation gap), `fr_ux_07_ac11` (the 500-backlink rename didn't reach done in 120 s),
    `fr_lnk_01_ac16` (backlinks warm-up mark not reached) and `fr_tsk_04_ac14` (the generated reference vault has 0
    tasks). Not checked against a build before D-516…D-523. Next: run `./verify nightly` on `main` to see whether they
    fail there too; investigate `fr_lnk_03_ac17` first (rename crash safety, FR-SYN-02).

## Product and accessibility

10. **An empty editable embed has no accessible "Empty note".** The hint is `aria-hidden` (FR-EDT-01 AC-9), so
    VoiceOver says nothing for an empty embedded note, and L6 can't see it. Next: propose `aria-placeholder` on the
    nested editor's textbox (AP point; it would also let L6 check it).
11. **Same accessible labels in two places.** A sidebar type row (`Daily Notes, 1`) and a Backlinks group header have
    identical labels. Next: consider distinct labels (for example `Backlinks from Daily Notes, 1`) when the panel is
    next touched (AP point; a test locator depends on it).

## Running elsewhere

12. **5A-2 conversion** is being built in the `ms5/5a2-conversion` worktree; it starts after PR #47 lands (D-500).
