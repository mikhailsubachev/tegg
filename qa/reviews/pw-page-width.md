# QA review: claude/cranky-poitras-30b167 (slice PW, page width Normal / Wide)

Reviewed head ecc0f4d (tree 8198452…) by the qa-reviewer agent on 2026-10-27 from `.verify/review/context.md` and
`diff.patch` (32 files; the four board bodies skipped), the push run records, the plan, ACs, contract, BRD rows
FR-SET-01/02, FR-STO-07, FR-SYN-06, FR-UX-01, D-551, D-565, `docs/requirements-coverage.md` and the test strategy.

Verdict at review time: **don't merge yet** (the code is "ready with notes"): the push gate had not passed on the head
tree (two WebKit tests outside the slice failed under load), and AP-753…AP-760 were not recorded owner decisions.
What followed: the two tests pass alone and the gate was rerun (see the PR); the owner's "merge if green" of
2026-10-27 covers the merge with AP-753…AP-760 as built proposals (their D-xx rows are still to be written, plan §5);
the minor findings below were applied in the follow-up commit where marked.

## Checklist summary

1. **Verify result:** both pushes on the branch failed only in `app-webkit`: `backups.ac.test.ts ›
   fr_his_04_ac7_jobs_list_their_zips_with_labels` ("renamed is not shown") and
   `broken_links_ac13.ac.test.ts › fr_lnk_04_ac13_typing_before_an_earlier_chip_keeps_the_clicked_link`. Neither
   touches the slice; the `backups` error also appears in the pre-branch run on tree 714154be. On HEAD all 26
   `page_width.ac.test.ts` tests pass.
2. **Requirements and ACs:** every change cites FR/AP ids in comments, test names and commit subjects; every AC in
   page-width.md has at least one test named after it (table below).
3. **Non-negotiable rules:** OK. A switch sends one `ui_state_set` and nothing else (zero `note_write` /
   `vault_settings_patch` / non-read calls, unchanged bytes and versions). The vault default goes through the 5B
   `vault_settings_patch` path with a base version: one appended line, every other byte unchanged, an equal value
   writes nothing, `Conflict` on a stale base, a new inode per write (FR-SYN-02). Nothing of the per-note choice
   enters frontmatter or the vault; Obsidian compatibility untouched; the entry lives in `ui-state.json` under
   Application Support (FR-STO-07); keys are NFC (FR-FMT-12); the core change is platform-neutral; no network.
4. **Test quality:** only two existing AC files change (`app/test/registry_5b.ac.test.ts`, `app/test/shell-tables.ts`:
   the R3 `Editor width` removal) and ecc0f4d carries the `AC-Test-Change: …; approved-by: owner` trailers covering
   them and the AP-762…AP-764 + pseudo-locale-locator edits of the new `page_width.ac.test.ts`; the gate's
   `ac-test-protection` passed. No `.only`/skip, no snapshot tests, tolerances are the AC's own ±1/±2 px. No fixture
   changes.
5. **Privacy:** synthetic Czech content only; nothing from `test exports/`.
6. **Scope:** one slice. Side changes (`App.tsx` write-in-effect, `VaultInfo.pageWidth`, `[workspace]` in
   `app/src-tauri/Cargo.toml`, Settings select/input CSS, the `Editor width` retirement) are small and explained.

## Findings

- [blocker] The last `./verify push` for the head tree failed in `app-webkit` on two tests outside the slice (above).
  Required: a passing gate on the merged tree (D-612). *Follow-up: both pass alone; the gate was rerun.*
- [major] `docs/plans/page-width.md`, BRD FR-SET-02 row and D-565, `docs/requirements-coverage.md`: AP-753…AP-760 are
  built as proposed but have no D-xx; the FR-SET-02 row and D-565 still say editor width is a v1.0 Appearance
  setting, and AP-761 retires the control D-565 defines. Plan §5 lists the BRD and coverage edits that follow the
  decision. *Follow-up: the plan's status line now says so; the BRD rows wait for the owner's decision pass.*
- [minor] `NotePage.tsx`: `pageWidth` took `widths[widthKey]` unvalidated; a hand-edited value (`"huge"`) gave
  `data-width="huge"` with no radio checked. *Applied: the stored value goes through `pageWidthOf`.*
- [minor] `App.tsx`: `uiDirty` is set before `setUi(f)`; if `f` returns the same state the flag stays set and the next
  unrelated change writes once more (an identical `ui-state.json`, never a vault file). Note only.
- [minor] `settings5b.tsx`: the row sits after `Add starter types…`, not immediately after `Attachments folder` as the
  contract read; the placement keeps R58's Tab order (FR-SET-01 AC-10). *Applied: contract §4 and AC-11 say so.*
- [minor] `styles.css`: `.settings select, .settings input[type='text']` is a side fix for a WebKit default-colour leak
  on Settings › Vault, surfaced by the new FR-UX-05 AC-12 test; the new AC test is its regression test.
- [minor] `app/src-tauri/Cargo.toml`: the empty `[workspace]` table is tooling (open item 19), unrelated to FR-SET-02;
  named in the PR.
- [minor] `app/e2e/page_width.ac.test.ts` (FR-STO-07 AC-6, L6) was not executed on this branch; `l6-coverage` passes by
  presence. Run it in the next milestone gate or L6 run (D-382).
- [minor] `ipc/types.ts`: `VaultInfo.pageWidth` and `noteWidth` values are `string` where the contract says
  `'normal' | 'wide'` (ts-rs output); narrowed by `pageWidthOf` in the UI.
- [note] Test-first (D-61): 0cf761f (red) → 1f6b774 (feat) holds and the gate's `red-first` check passed. The draft and
  virtual-daily re-keying (`NotePage.tsx`: `prevKey` effect, `savedId` set from `written`) matches AC-8 and AC-5;
  `NotePage` is keyed by `navKey`, so `savedId` / `draftWidth` cannot leak between notes.

## AC coverage of touched requirements

| AC | Tests |
| --- | --- |
| FR-SET-02 AC-6 | `fr_set_02_ac6_group_in_the_note_toolbar_with_two_radios_in_order`, `…_group_in_the_read_view_before_focus_mode`, `…_present_on_note_routes_and_absent_elsewhere`, `…_focus_mode_hides_the_group_and_keeps_the_width` |
| FR-SET-02 AC-7 | `fr_set_02_ac7_switch_applies_at_once_to_this_note_only`, `…_a_choice_made_in_the_read_view_shows_in_the_editor_and_the_source_view` |
| FR-SET-02 AC-8 | `fr_set_02_ac8_a_draft_stores_nothing_until_it_is_created`, `…_an_abandoned_wide_draft_stores_nothing`, `…_a_virtual_daily_note_is_keyed_by_path_then_by_id` |
| FR-SET-02 AC-9 | `fr_set_02_ac9_tab_reaches_the_checked_radio_and_arrows_space_enter_choose`, `…_keyboard_only_run_from_search_to_back` (AP-762) |
| FR-STO-07 AC-4 | `fr_sto_07_ac4_one_ui_state_set_per_change_keyed_by_id_and_nothing_in_the_vault` (AP-764), `…_missing_note_width_reads_as_empty_and_the_entry_follows_the_id` (AP-763); L1 `fr_sto_07_ac4_ui_state_dto_has_an_optional_note_width_record` |
| FR-STO-07 AC-5 | `fr_sto_07_ac5_no_id_keyed_by_the_nfc_path_and_rekeyed_on_the_first_edit`, `…_a_file_without_id_renamed_outside_has_no_entry_under_its_new_path` |
| FR-STO-07 AC-6 | `fr_sto_07_ac6_relaunch_keeps_the_width_and_the_vault_is_unchanged` (L6, not yet run) |
| FR-SET-01 AC-11 | L4 `fr_set_01_ac11_wide_appends_exactly_one_line_after_daily_format`, `…_normal_changes_only_that_line_and_an_equal_value_writes_nothing`; L5 `fr_set_01_ac11_the_settings_row_sends_one_patch_per_change` |
| FR-SET-01 AC-12 | L4 `fr_set_01_ac12_every_listed_value_reads_as_wide_or_normal_without_writing`, `…_invalid_values_are_refused_and_surrounding_spaces_are_trimmed`, `…_a_stale_base_is_conflict_and_writes_nothing`; L5 `fr_set_01_ac12_the_page_reads_every_value_and_never_offers_a_third`, `…_a_stale_base_shows_the_alert_and_reloads` |
| FR-SET-01 AC-13 | `fr_set_01_ac13_the_vault_default_applies_to_notes_without_a_choice_live` |
| FR-UX-01 AC-6 | `fr_ux_01_ac6_measured_widths_at_three_window_widths_with_the_panel_closed_and_open` |
| FR-SYN-06 AC-35 | L5 `fr_syn_06_ac35_zero_vault_writes_from_switching_and_one_file_from_the_setting`; L4 `fr_syn_06_ac35_the_setting_writes_one_file_atomically` |
| FR-UX-03 AC-17 | L1 `fr_ux_03_ac17_width_commands_are_registered_in_view_without_a_shortcut`, `…_registry_integrity_holds_with_the_width_commands`; L5 `fr_ux_03_ac17_palette_lists_and_runs_the_width_commands_on_note_routes`, `…_the_width_commands_do_nothing_on_other_routes` |
| FR-UX-05 AC-12 | L1 `fr_ux_05_ac12_width_icons_use_current_color_and_the_radio_tokens_exist`; L5 `fr_ux_05_ac12_both_widths_in_every_view_light`, `…_dark` |
| NFR-OTH-02 AC-9 | L1 `nfr_oth_02_ac9_catalog_has_the_width_keys_with_their_texts`; L5 `nfr_oth_02_ac9_pseudo_locale_wraps_every_width_string_and_leaves_user_content` |
| FR-NAV-04 AC-5 (R3, existing) | `fr_nav_04_ac5_controls_and_shortcuts_follow_r62`, changed under the AP-761 trailer |

## Owner points not yet an AP

- Whether PW may merge while `fr_his_04_ac7_jobs_list_their_zips_with_labels` fails on main's tree under load (it
  passes alone; open item for the flake list).
- Nothing else: AP-759 (live re-layout) and AP-760 (pinning) are built as proposed and tested; pruning of stale
  entries is already deferred by AP-753.
