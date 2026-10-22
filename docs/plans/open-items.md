# Open items for the next slices

Items 14–19 added on 2026-10-22 (L6 run on preview v0.55). State otherwise on 2026-10-18, after PR #48 (L6 fixes on main), the merge of main into `ms5/5a-tasks` (PR #47) and the 5A-1
preview feedback (D-516…D-523). Each item names
what is open and the next step. Remove an item once it is done or decided.

## L6 run on preview v0.55 (main b8a6a62, 2026-10-22)

Full `app-e2e` set (no `nfr_perf_*`, `nightly_*`): 158 tests, **147 pass, 11 fail**, 46 min. The four 6A media tests
below ran on the real app for the first time. Logs stay local (not committed).

14. **A pasted image in Quick Capture "saved twice": done (branch `ms6/capture-paste-twice`).** Not a double save:
    `fr_cap_01_ac12` pasted, pressed Esc and pasted again, and staged images survive Esc (D-636, AP-566), so both were
    saved; the test now uses Discard. `fr_att_01_ac11` looked for a button named exactly `Remove` (it is
    `Remove "<name>"`). Found on the way: Discard kept the staged images (`bug_v055_fr_cap_01_discard_drops_staged_media`,
    fixed).
15. **Drop and double-click on media in the real app.** `fr_att_01_ac2` (two dropped files don't land as two
    paragraphs at the drop point, in drop order) and `fr_att_01_ac13` (a double-click on the image doesn't open
    `note/Images/Záhon.md`). Both pass at L5 on the fake core. Next: reproduce in the built app; decide app bug vs. L6
    test (drop coordinates through the drop hook, the double-click reaching the image node).
16. **`broken chip Smazaná` not found** in `fr_syn_06_ac9` and `fr_lnk_04_ac12` (ms4_links). Likely 6A: links to
    trashed targets now resolve as `trashed` (D-614), so a fixture note that is gone may now be in `.trash/` or the chip
    has another `data-link-state`. Next: check the fixture and the chip state; if the test is out of date with D-614,
    it is an AC-test change for the owner.
17. **`switcher for <note>` not found** in `fr_syn_06_ac6` (Dvojník) and `nfr_rel_03_ac5` (Bloky). The switcher
    tour can't select these notes. Next: reproduce; check whether 6A's Home removal or the Inbox landing (D-613) changed
    the starting route or the focus the tour expects.
18. **`fr_cap_05_ac6` (try again after the hotkey holder exits): `taken`.** Seen flaky before; the hotkey stays
    taken after the holder exits. Next: rerun alone; if it fails again, investigate the re-registration.
19. **L6 in a nested worktree.** (a) The worktree's `app/e2e/.appium` was incomplete (no manifest), so every Appium
    session failed with "Could not find a driver for Mac2" until `APPIUM_HOME` pointed at the main checkout's.
    (b) `fr_cap_03_ac4` and `fr_ux_07_ac9` failed because `tools/gen-vault` doesn't build in a nested worktree without
    the `[workspace]` workaround. Next: an L6 preflight (with item 6) that checks the mac2 driver and builds gen-vault
    first, failing fast with a clear message.

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
