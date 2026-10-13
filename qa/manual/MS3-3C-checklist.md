# MS3 slice 3C manual checks (checklist, no results yet)

The `[manual]` criteria that slice 3C makes checkable (docs/acceptance/editor.md, "Existing criteria this slice
verifies"). They are not automated; a session record with `milestone: MS3` and one line `- <AC-ID>: pass` or `fail`
each goes into `qa/manual/<date>-MS3.md` or `qa/sessions/` when they are run (tools/qa CONTRACT §9.3). This file holds
no results on purpose.

Setup for all three: the built app with `TEGG_TEST=1`, a temporary `TEGG_APP_SUPPORT`, and a temporary copy of a
synthetic vault (`tests/fixtures/vaults/editor/` + `new-empty/.tegg/`, or the generated reference vault from
`tools/gen-vault --seed 1 --small-images --perf-note`). Never the owner's real vault (D-62).

| AC | Where defined | Check |
| --- | --- | --- |
| FR-SYN-02/AC-5 | data-safety.md `[manual] [MS3]` | Type continuously into a paragraph of Deset bloků, force-quit the app (Activity Monitor › Force Quit, or `kill -9`) mid-typing. Reopen: the file parses, its frontmatter is valid, and at most the last ~1 s of typing is missing. The automated companion is FR-SYN-02 AC-7 (`app/e2e/ms3_editor.ac.test.ts`, kill cycles). |
| NFR-PERF-06/AC-2 | performance.md `[manual]` | Delete the index in the temporary Application Support, reopen the reference vault so a full re-index runs, and type in the 5,000-word note during it: no visible stutter. |
| FR-UX-07/AC-6 | search-navigation.md `[MS3] [manual]` | During the same re-index (or another long operation), progress is shown without a modal dialog and typing in the open note keeps working (D-134; recorded in the NFR-PERF-06 AC-5 session). |
