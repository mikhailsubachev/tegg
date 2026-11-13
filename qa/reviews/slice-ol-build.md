# QA review: slice OL build (the Outline)

Branch `claude/outline-78767f`, head f381955 (tree 7ba03ce), reviewed 2026-11-13 by the `qa-reviewer` agent (read-only; saved here by the session). Verdict at review time: **ready with notes** (no blockers; `./verify merge` READY on that tree).

## Findings and how each was handled

| # | Severity | Where | Finding | Handling |
| --- | --- | --- | --- | --- |
| 1 | should-fix | `packages/editor/src/present.ts` (callout fold, D-1660) | A callout folded in the editor is hidden by CSS only; a restored caret or a joining deletion can put the caret, or an edit, in hidden text. | Fixed (4c26ba3): the selection entering a folded callout's content opens it (view state only; the title keeps it folded). Regression test `app/webkit/bug_olqa_fr_edt_11_…` (212c906), red without the fix. WebKit's own arrow keys already skip the hidden text. |
| 2 | should-fix | `CLAUDE.md` status line | The merge renumbering moved the import slice I2's BRD versions to v1.175, v1.176. | Fixed (c8ccb17): back to v1.172, v1.173. |
| 3 | note | `present.ts` `foldKept` | The editor's fold state is kept per view by position; a callout re-created at that position can inherit it. | Accepted: view state only. |
| 4 | note | `present.ts` fold label fallback | English fallback when `EditorUi.mindmapText` is missing. | Accepted: the app always passes it. |
| 5 | note | `editor.ts` `outline()` | Serializes and parses the whole document on each refresh; falls back to `lastSaved` positions when `candidate()` throws. | Watch in the NFR-PERF-06 benchmark at the milestone gate (D-1623). |
| 6 | note | `App.tsx` same-route Back/Forward | Steps between entries of the same route happen in place, without a flush (D-1637); relies on `push` merging repeats. | Accepted; covered by FR-NAV-03 AC-15, AC-16. |
| 7 | note | `NotePage.tsx` | `delete __TEGG_TEST__.editor` runs during render (D-1668). | Accepted (harmless). |
| 8 | note | `outline/store.ts` | `__TEGG_TEST__.outline` is installed in every build, like `__TEGG_TEST__.editor`. | Accepted: no new exposure. |
| 9 | note | L6 | `fr_sto_07_ac8`, `fr_edt_11_ac20`, `nfr_perf_06_ac6` exist only at L6, which runs at the milestone gate. | As designed (`app-e2e` is milestone level). |

## Checked and sound

- Folds and the rail switch go only to `ui-state.json`; the jump flash is a non-history decoration; nothing in the outline writes to the vault (FR-SYN-06 AC-46 at L5 and L6).
- The callout `-`/`+` marker is written back as read; `packages/doc/src/outline.ts` is pure; no Rust change (D-1672).
- Tree a11y (FR-UX-08 AC-21), palette reachability (FR-UX-03 AC-45…AC-47), strings in the catalog (NFR-OTH-02), theme tokens only (FR-UX-05).
- Changed AC tests carry `AC-Test-Change` trailers (D-1624, D-1639, D-1647…D-1659); the fixture change carries `Fixture-Change` (038c962).
- Every AC in `docs/acceptance/outline.md` has a test named after it, except the manual FR-EDT-11 AC-21 and FR-EDT-16 AC-14.
