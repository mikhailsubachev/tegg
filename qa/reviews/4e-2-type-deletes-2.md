# QA review: claude/4e2-deletes (slice 4E-2, second review: fixes of qa/reviews/4e-2-type-deletes.md)

Head: 59b5aca85ab0ac3913c801ef6af8b99c9731d4c7  Tree: 81b21c5cef1e1859ae96fd0782911602ce138f64  Verify: fail (app-webkit only, on this tree; every other step and check passed, fixtures included)
Verdict: **not ready** (a passing push on this tree and N1; then "ready with notes")

Reviewed by the `qa-reviewer` agent on 2026-10-28 against type-moves.md part two, ms4-jobs §14.9, ms6-trash-media §1.2, D-851, D-857, D-858. The first review's fixes are correct.

## Findings

- **[major] N1:** the m7 fix in `CoreHost::untrash` walks the whole vault (`vault.entries()`) on every untrash: every row of a type-delete undo, a cancel, a D-857 reversal and a backup restore. O(N×M); minutes on the 20k vault. Fix: `vault.version(&to)` errors for a folder; an L4 test counting `list` calls.
- **[minor] N2:** `trashed_type_folders` adds a second full listing to every `trash_list`; use the entries it already has.
- **[minor / owner] N3:** a 4E-2 job that fails after writing (D-857) ends with no status text; R99 has none.
- **[minor / owner] N4:** a D-858 `readOnly` skip makes the done status say `(changed meanwhile)`; Retry is offered on a row it can't fix; every `unchanged` planned file becomes `readOnly` (broader than D-858's wording).
- **[minor] N5:** redo of a type delete trashes the templates and the definition even when it skipped an object (D-815 not applied on redo).
- **[minor] N6:** the fake core's value-remove type-file write uses the current version as base; its undo never finds a folder taken; its redo has no content check.
- **[minor] N7:** m5, m7 and m8 have no regression test.
- **[minor] N8:** a copied doc comment and an unused-helpers line in `bug_qa4e2_trash_rows.rs`; the `bug_qa4e2_m2_` prefix covers both M2 and m2 tests.
- **[minor] N9:** `planDelete` gives up after 30 s without the job id, so a slow job is never cancelled and later waits in `confirm`.
- **[info]:** `untrash` now prunes empty trash folders on the 4D backup-restore path too (benign).

## First review's findings

B1, M1, M2 (D-857), m1, m2 (D-858; see N4), m3, m5 (see N9), m6 (contract amended), m7 (see N1), m8, m9, m10: fixed. m4: accepted as kept; move it to a local set at the next approved change of helpers.ts.

## Owner points

N3 (a text for a 4E-2 job that fails after writing) and N4 (the done-status wording for a `readOnly` skip).
