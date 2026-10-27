# Open items for the next slices

Items 14–19 added on 2026-10-22 (L6 run on preview v0.55). Items 20 and 21 added on 2026-10-23 (push-gate flakes). Item 13 updated and item 22 added on 2026-10-27 (nightly on main, PR #78). State otherwise on 2026-10-18, after PR #48 (L6 fixes on main), the merge of main into `ms5/5a-tasks` (PR #47) and the 5A-1
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

13. **Nightly and perf L6 tests: checked on main on 2026-10-27 (ef0ca11).** The 2026-10-18 failures: `fr_lnk_03_ac17`
    ("the old hub file holds other bytes", 16 of 20 cycles in the 2026-10-23 milestone run) was the test pasting the
    new title into the hub's body, not a data-loss bug: before D-751 (2026-10-24) the test build never put the focus in
    the title, so ⌘A ⌘V ⏎ replaced the body with `Uzel`; the rename never started. On main the test passes 6 of 6
    cycles (a kill at 100 ms leaves the pristine hub, at 900 ms the renamed hub with 3 links rewritten; no `.tegg-tmp`,
    Finish completes). Not a T1 (D-62). `./verify nightly` on main ef0ca11 (2026-10-27, the first since 2026-10-10):
    every step passes except `app-webkit`, whose one failure (`fr_cnv_04_ac2`, two races with the embed cards under
    load) is fixed in PR #78 (`bug_nightly_fr_cnv_04_ac2_…`); `app-e2e-nightly` 2 of 2 (both crash tests, 20 of 20
    cycles). It took 10764 s against the 5400 s budget: `jobs-test` 8365 s (the tegg-jobs ACs at property scale 100,
    `ac_property_tags` alone about 35 min, one JS text-engine round trip per file, issue #67), `app-e2e-nightly` 2026 s,
    `core-rust-test` 1800 s. Next: decide the nightly budget or the property scale of `jobs-test` (a D-343/D-609 gate change).
    `fr_ux_07_ac11`, `fr_lnk_01_ac16` and `fr_tsk_04_ac14` are `nfr_perf_*` tests of the milestone step `app-perf`, not
    of the nightly; the 2026-10-24 milestone run had `app-perf` fail with no results file. Next: run `./verify milestone
    --milestone MS6` once and look at `app-perf` (D-382's real-app tests).

20. **`fr_ux_07_ac1` can fail under push-gate contention (owner, 2026-10-23).** In a `./verify push --all` run on
    `qa/webkit-flakes`, the largest gap between index progress events was 508.6 ms against D-110's 500 ms
    (`crates/tegg-core/tests/ac_perf.rs`, debug build, the WebKit lane running beside it). It is a requirement-level
    timing AC, so the limit stays. Next: decide whether `ac_perf.rs` runs in the nightly gate or in a release build
    instead of the debug push gate (a D-343/D-609 gate change).
21. **Existing WebKit sleeps before actions (D-688, 2026-10-23).** `app/webkit` has ~480 `await sleep(` calls; the
    test-strategy §8.4 rule (wait for state, not time) binds new and touched tests. A scan found ~237 reads right after
    start or navigation without a wait, and three pickers (tags, relation) still sleep before ⏎. Next: fix a test when
    it flakes; quarantined so far: `fr_emb_02_ac9_card_and_link_mode_open_their_target` (#59). Flaked once in the
    pre-merge flow of PR #78 (2026-10-27): `fr_dly_08_ac8_date_links_in_text_and_relation_values` read a chip's
    `data-link-kind` as `unresolved` before the resolution answered (`date-missing`); 6 of 6 standalone. Fixed on
    2026-10-27 (AC-test change approved by the owner): the test waits for the kind with `eventually`. Flaked once more
    in that fix's push gate: `fr_nav_01_ac16_keyboard_wraps_opens_and_back_skips_search` read the centre pane's name
    as empty right after Back ("Back returns to the page Search was opened from"); passes standalone. Next candidate.

22. **Scroll anchoring is off on note routes (PR #78, QA review).** `main:has(.editor-host), main:has(.read-view)` has
    `overflow-anchor: none`: WebKit's anchoring moved the pane by half a viewport when the embed cards rendered below a
    block aligned at the top (FR-CNV-04 AC-2). D-456 and the AP-358 row of `docs/contracts/ms4-embeds.md` still describe
    WebKit's anchoring as what keeps content on screen; in the app `keepOnScreen` (`app/ui/src/embeds/store.ts`) does
    it for embed-tree rebuilds, and FR-EMB-02 AC-10 passes with anchoring off. Open for the owner (AP): reword D-456
    ("Tegg keeps the centre-pane scroll itself; browser anchoring is off on note routes"); and whether other growth
    above the view on a note needs the same keeping now that anchoring no longer hides it: lazy images without a
    reserved height on the read view (`MediaFigure`, `loading="lazy"`, `height: auto`), a mindmap laying out, tables.
    Also from the review: ⌘↩ on a selected *broken* block embed does nothing, while a broken link-mode embed and a
    broken wikilink offer Create (FR-LNK-04 AC-4); pre-existing, an AP for the owner.

## Product and accessibility

10. **An empty editable embed has no accessible "Empty note".** The hint is `aria-hidden` (FR-EDT-01 AC-9), so
    VoiceOver says nothing for an empty embedded note, and L6 can't see it. Next: propose `aria-placeholder` on the
    nested editor's textbox (AP point; it would also let L6 check it).
11. **Same accessible labels in two places.** A sidebar type row (`Daily Notes, 1`) and a Backlinks group header have
    identical labels. Next: consider distinct labels (for example `Backlinks from Daily Notes, 1`) when the panel is
    next touched (AP point; a test locator depends on it).

## Running elsewhere

12. **5A-2 conversion** is being built in the `ms5/5a2-conversion` worktree; it starts after PR #47 lands (D-500).
