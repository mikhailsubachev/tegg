# QA review: claude/4e2-deletes (slice 4E-2: delete property, delete type, widen-only retype)

Head: 772902b90ea11181eee5261b6871f2480ffcb81f  Tree: 64dbfb3466d3e0cae22b0013f9d3bde97468e78c  Verify: missing for HEAD (the push run on this tree was still going)
Verdict: **not ready**

Reviewed by the `qa-reviewer` agent on 2026-10-28 against type-moves.md part two and "Both parts", ms4-jobs §14.9, ms6-trash-media §1.2, D-806…D-809, D-814, D-815, D-841…D-856.

## Findings

- **[blocker] B1: D-851 is built only in the fake core.** `tegg-core` `trash_list` counts only live types' folders, so after a type delete `.trash/Schůzky/` is a folder row: the real Trash view has no `Restore "Porada"` row (FR-TYP-05 AC-10), and restoring the folder row brings the objects back without their definition. L4 tests call `trash_restore` directly and L5 runs on the fake. Fix: the folders of `.trash/.tegg/types/*.yml` count as type folders; an L4 `trash_list` test.
- **[major] M1: Undo of a property delete skips a note open at undo time (`io`).** Only `via_op` rows became `direct`; an ordinary row of a note opened later goes down the op path, and value-remove has no op. Reachable from the palette. Fix: every value-remove row is `direct`; an L4 test with `editor_open` after the job.
- **[major / owner] M2: a failure after files were written** (the type file changed since planning; the templates or definition can't be trashed) ends `failed` with no undo record: values removed but the property defined, or objects trashed but the type kept. Options: (a) reverse the rows and end `failed` with the vault as before; (b) end `Done`, the type file skipped `changed`, Undo kept.
- **[minor] m1:** redo of type-delete rows trashes the current file without a base check, also one the undo skipped as `taken`.
- **[minor / owner] m2:** `remove-key` leaves an anchored entry and the note reports `unchanged`, while the type file drops the property; D-843 says the op removes any entry.
- **[minor] m3:** `check_type_delete` hard-codes the system keys; a host method backed by `tegg_schema::SYSTEM_KEYS` avoids drift.
- **[minor] m4:** the shared `READ_COMMANDS` now hides delete-job starts and cancels from every "writes nothing" check; prefer a local set.
- **[minor] m5:** a dialog unmounted after its plan arrived leaves the job in `confirm`, blocking the job queue.
- **[minor] m6:** with `files == 0` in the plan the UI cancels the job and calls `type_patch`; §14.9.2 says the job confirms the type-file write.
- **[minor] m7:** the templates folder's undo skip reason when the folder exists again is not `taken`; restored templates rely on the watcher.
- **[minor] m8:** `trash_restore` can error after it moved the note (the type file's move failed).
- **[minor] m9:** stale "stub until 4E-2" comments.
- **[minor] m10:** `Retry` does nothing on a type-delete skip; hide it there.

## Checked and correct

Cancel while writing (`reverse_rows`, base-checked, type file never written after a cancel); undo of an editor-written row (base-checked; a later save makes it `changed`); `prune_trash` (empty folders under `.trash/` only); type-delete undo order and `taken` for files; the zero `FileVersion` on the folder row; the `type_base` (the planning version is the right base); atomic writes, minimal writes, backup first, NFC, privacy, AC-test changes recorded in the BRD.

## Owner points

M2 (reviewer recommends (a)) and m2 (reviewer recommends amending D-843: skip the note `readOnly` and list it).
