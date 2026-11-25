# QA review: slice MM3 (map navigation, folds, mouse +, drag and drop) and the New object menu

- Branch: `claude/mindmaps-navigation-editor-58c537`, head `6da952be` (tree `3efa8232`), base `main` (merge-base `130aaff7`).
- Reviewer: `qa-reviewer` agent, 2026-11-25, from `.verify/review/diff.patch` and `context.md`, the ACs, the contracts, BRD D-2600…D-2667 and the changed sources.
- Verdict: **NOT READY**: 1 blocker, 4 major. No data loss. Resolutions below (D-2668, BRD v1.328).

## Findings

1. **[blocker] No `./verify push` pass on HEAD** (`.verify/review/context.md:7`): the last pass was on tree `7a80f9d1`, before the 2026-11-25 commits; TS-I3, `ac-ids`, coverage and the new suites hadn't run on this tree.
2. **[major] D-2633's BRD row is garbled** (`docs/Business Requirements.md:2383`): a `\|` inside backticks broke the table cell.
3. **[major] Autosave can write the half-typed trigger** (D-2631, FR-SYN-06 AC-57, FR-EDT-03 AC-15): `EditorPane.tsx` and `NestedNewObject.tsx` released the saver's pause after the create but before the `link_resolve` round trip and the link insert.
4. **[major] The live map under the List view offers fold controls, `+` and drag**, against D-2621 (`mindmap/mount.tsx`, `MindmapMap.tsx`). Untested.
5. **[major] FR-FMT-12 AC-18 has no test named after it** (`docs/acceptance/new-object-menu.md:134`).
6. [minor] FR-EDT-03 AC-13 and AC-15 texts contradict D-2657 (trailing space).
7. [minor] The `mindmap-drag` perf mark is an IPC call per pointer move in production on big maps (`MindmapMap.tsx:468`); §7.5 says only with `TEGG_PERF_LOG`.
8. [minor] D-2655 names the android-shell contract; the list is in `android-phone.md` §10.
9. [minor] `NotePage.tsx:1503` changes `×` to the `x` icon for one alert only.
10. [minor] The plan has a sentence fragment; CLAUDE.md's Status doesn't name MM3.
11. [note] The paragraph patch (D-2666) applies to every edit of an NFD paragraph, so a paragraph can mix NFD and NFC (consistent with D-2666 and FR-FMT-12 AC-5).

## Checks that passed

Round-trip and minimal writes (folds are plugin metadata outside the document and history; a cancelled drag or a no-op drop makes no transaction; a drop is one transaction; the paragraph patch keeps bytes outside the changed range only when the source re-renders exactly), atomic writes (no new write path), NFC of link text and titles, no network, catalog strings, theme tokens, keyboard access (palette commands, `tabindex=-1` controls with `data-command`), the decisions D-2600…D-2667 in the code, test hygiene (no `.only` / `.skip`; relaxed tests match D-2653, D-2654, D-2657, D-2658, D-2660). Every touched AC has a named test except FR-FMT-12 AC-18.

## Resolution (D-2668)

| # | Resolution |
| --- | --- |
| 1 | `./verify push` re-run on the fixed head before merge |
| 2 | Row rewritten without a raw pipe ("a pipe character") |
| 3 | The saver keeps waiting (`newObjInserting`, `inserting` refs) from a successful create until `insertObjectLink` has run |
| 4 | `MindmapMap` gets `underList` (from `mount.tsx`, `ctl.view() === 'list'`): no folds, fold controls, `+` or drag there |
| 5 | A named L1 test `fr_fmt_12_ac18_…` added by the test author |
| 6 | AC-13 and AC-15 texts follow D-2657 |
| 7 | Kept, as `mindmap-layout`: the core's `perf_mark` returns at once without `TEGG_PERF_LOG`, so the file is never written; the WebKit test FR-MMP-02 AC-53 reads the call |
| 8 | D-2655 corrected |
| 9 | Kept: the pseudo-locale check (NFR-OTH-02 AC-28) reads the alert's visible text, and `×` isn't a catalog string; the icon button keeps its `dialog.close` name. The other alerts are unchanged (outside this slice) |
| 10 | Plan status line fixed; CLAUDE.md Status names MM3 and the New object menu |
| 11 | Noted; consistent with D-2666 |
