# QA review: slice G3 build (graph presets, keyboard, VoiceOver, List, hover)

Branch `claude/graph-g3-f18612`, reviewed at 37486b9 (tree 33ceeee2c2) by the `qa-reviewer` agent, 2026-10-30.
Verdict at review: **not ready** (push gate failed; one T1 path). Findings fixed in the commit that adds this file.

| # | Severity | Finding | Fix |
| --- | --- | --- | --- |
| 1 | blocker | Push gate failed on the head tree: AR-03 scan flagged `ac_graph_presets.rs`'s own forbidden-string list; `graph_presets_get` not in the WebKit helpers' read commands; three load flakes (`fr_ux_07_ac1`, `fr_emb_02_ac9`, `fr_tag_04_ac9`) | D-1128 (AC-test change); `READ_COMMANDS` entry; the flakes pass alone and in the re-run gate |
| 2 | blocker (T1) | `graph_presets.rs` item and key ranges ended at a shallower comment line, so Delete / Update could write a `graph.yml` that doesn't parse (a key commented out at column 0; a comment inside a block list); nothing checked the patched text; anchors and aliases likewise | Comment lines never end an item or a value range; a parse-back check before every write (the new text must read `ok` and give exactly the expected presets and other keys, else `Unreadable`, nothing written); deleting or updating an anchored item is refused. Regression tests `crates/tegg-core/tests/bug_qag3_graph_yml.rs` |
| 3 | major | Property generator lacked comments inside items, compact lists, `---`, BOM, anchors | Covered by the regression tests of #2, #4 (the AC property test itself is unchanged) |
| 4 | major (T1) | A missing `version: 1` was inserted before a leading `---` / `%YAML` directive (two documents) and above a BOM | BOM stays first and is stripped before parsing; `version` goes after leading comments, directives and the first `---`; a file with more than one document, or a flow item, is not patchable (writes refused, D-1122) |
| 5 | minor | TS twin `fake-presets.ts` differed from Rust outside the fixtures (`keysOf` comments, `presets: ~`, a missed key duplicated) | Twin rewritten as a port of the Rust scanner and patcher with the same parse-back check; `app/test/regress/bug_qag3_fake_presets.test.ts` |
| 6 | minor | `GraphPage.tsx` `onRenamed` compared names with `trim()` (strips U+FEFF) | Uses `nameKey` from `presets.ts`; `app/webkit/bug_qag3_fr_grp_02_rename_matches_by_name_key.test.ts` |
| 7 | minor | `GraphList.tsx` roving tab stop could stay on a hidden row after a collapse | Falls back to the nearest visible ancestor; `app/webkit/bug_qag3_fr_ux_03_list_tab_stop.test.ts` |
| 8 | minor | List rows: ` · ` literals, `data-user-content` on the whole treeitem | Kept: the treeitem's accessible name is user content (as G1's canvas nodes) and NFR-OTH-02 AC-14's test exempts it that way; the separators are their own text nodes as in `graphModel.ts` and the preview lines; no new catalog key (AC-14: exactly the R124 keys) |
| 9 | minor | Review base stale (diff includes G1) | Re-checked with `git diff b3eee45 37486b9 -- '*.ac.test.ts' 'tests/ac_*.rs'`: only the D-1104 / D-1126 edits, with the trailer |
