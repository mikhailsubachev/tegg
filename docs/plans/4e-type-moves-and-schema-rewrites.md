# Slice 4E: type moves and schema rewrites (2026-10-27)

Status: **accepted, 2026-10-27**: AP-765…AP-773 (`docs/acceptance/type-moves.md`, end of file) accepted as proposed, D-810…D-818 (BRD v1.103). Scope and behaviour are the owner's decisions D-803…D-809 (BRD v1.102) and the board `design/edit-note-page/TypeJobs.dc.html` (sections A–G); this plan adds only what they leave open. 4E is the MVP slice after MM2 and takes the MS7 row of BRD §11.2 (`./verify milestone --milestone MS7`, D-803).

## 1. What 4E is

| Part | Behaviour | Decision | Board |
| --- | --- | --- | --- |
| 4E-1 | `Change type…` and Inbox `Convert to…` map the properties (same key → same property, else Content as `**Name:** value` lines) and move the file to the new type's folder; undoable as one step | D-804, D-803 | A |
| 4E-1 | Saving a new type folder moves the type's objects; a tidy job at vault open and after quiet periods moves strays; backup, report, Undo | D-805 | B |
| 4E-2 | `Delete property…`: one confirmation, removes the values, Undo | D-807 | D |
| 4E-2 | `Delete <Name> type…` with objects: one confirmation, trashes them, definition last, Undo | D-809 | F |
| 4E-2 | A property's `Type` menu offers only wider types; type file only | D-808 | E |
| — | Keys never change (`The key can't be changed after creation`) | D-806 | C |

Not in 4E: key rename (W), value conversion, `Move existing objects`, `Change their type to…`, renaming used options (AP-771).

## 2. What is already there, and what is missing

- **There.** `tegg-jobs` (4C): queue, plan → confirm → zip → write → report, base-checked writes, skips with `Retry`, the not-updated list, note-rename undo records and crash journal, link retargeting by D-291 (D-383). Op shapes `TypeMove`, `FolderMove`, `TypeDelete`, `ValueRemove` (planners return `NotImplemented`; `KeyRename` stays so, D-806). 4D-lite: confirm dialogs, zip labels, Settings › Backups, restore that reverses renames and trash moves (ms4-tags §5.3). 5B: the `inbox` bulk job with `set-type`. 6A: trash moves, the trashed chip, restore from the Trash view.
- **Missing.** The four planners; Undo for multi-file jobs (ms4-jobs §7 covers only note rename, AP-767); the tidy trigger on the watcher's quiet period with its exemption list (AP-766, AP-767); `@tegg/doc` ops `map-properties`, `remove-key`, `keep-targets`; a move write (`Vault::rename_with` into another folder); the mapping dialog and the R99 texts; the widen-only `Type` menu (D-808) and dropping `type_misfits`; restoring a type file with a trashed object (D-809); the contract section ms4-jobs §14.

## 3. Runs

| Run | What | Ends with |
| --- | --- | --- |
| 1 (this one) | This plan, ACs `docs/acceptance/type-moves.md`, AP-765…AP-773 | owner answers → D-xx rows in the BRD |
| 2 | Contract ms4-jobs §14, fixture `tests/fixtures/vaults/type-moves/`, **4E-1 red tests** (test-author agent, D-61) | red commit; red-test points to the owner |
| 3 | **4E-1 build**: `type-move` with mapping, `folder-move` and tidy, job Undo; the AC-test changes of AP-772 for these parts | `./verify push`, qa-reviewer, preview `preview-v0.<PR>` |
| 4 | **4E-2 red tests and build**: `value-remove`, `type-delete`, restore with the type, the widen-only menu; the approved AC-test changes of D-806…D-809 | `./verify push`, qa-reviewer, preview |
| 5 | MS7 milestone gate: nightly crash tests (FR-STO-04 AC-14, FR-STO-01 AC-14), benchmark (FR-UX-07 AC-12) | owner preview feedback |

4E-1 first: moves, links and the tidy job carry the risk, and job Undo built there is reused by 4E-2.

## 4. Risks

- **Silent retargeting (T2).** A move can change what links mean under D-291's same-folder rule. AP-765 keeps every target; FR-FMT-07 AC-26 is a property test over random vaults comparing `link_resolve` before and after.
- **The tidy job touches files the user didn't (T2).** It runs without asking (D-805). AP-766 limits it to typed objects outside their type's folder tree, never Obsidian's untyped files; every run zips first and reports with Undo; AP-767 stops it from fighting an Undo.
- **Crash in a multi-file move (T1).** Files are at old or new paths; the tidy job finishes the move at the next run and the zip's restore reverses it (ms4-tags §5.3). Nightly guard: FR-STO-01 AC-14.
- **Backup churn.** A zip per tidy run could push older backups out of the 10 kept; AP-766 makes no zip when nothing moves.
- **Cost.** About 0.1 s per file at the 4C rate (D-754): a 500-object move is about a minute, in the background; FR-UX-07 AC-12 records it.
