# QA review: slice Q build (saved queries and the query block)

Branch `claude/jolly-cartwright-4bb871`, head 8470286 (tree e22c6c6), reviewed 2026-11-11 by the `qa-reviewer` agent (read-only; saved here by the session). Verdict at review time: **not ready** (2 blockers).

## Findings and how each was handled

| # | Severity | Where | Finding | Handling |
| --- | --- | --- | --- | --- |
| 1 | blocker | gate | No passing `./verify push` on the reviewed tree; one WebKit failure, `graph_list.ac.test.ts fr_ux_08_ac6…cap`, passed 3/3 when rerun alone. | Re-run `./verify merge` after the fixes below. |
| 2 | blocker (T1) | `app/ui/src/queries/QueryBlock.tsx:247-250` | ⌘Z after a commit passes a freshly read version as `query_revert`'s base, so Undo can overwrite an external change (NFR-REL-02, FR-SYN-03, D-1476). | Fixed: the base is the version returned by the commit. Regression test `bug_qa1_fr_syn_03_query_undo_keeps_external_change`. |
| 3 | major | `app/webkit/queries_block.ac.test.ts:494-515` | `fr_qry_08_ac1` doesn't follow D-1507: it should check that the footer's own block lists the new task. | Test fixed to follow D-1507 (covered by the D-1505…D-1509 approval). |
| 4 | major | triage P3 | With the date picker open, typed keys go into the note body and are saved. Not caused by slice Q. | Proposed as its own bug-fix session, with a `bug_…_fr_typ_02_…` regression test. |
| 5 | minor | `crates/tegg-core/src/pinned.rs:233` | `same_target` compares query pins by exact NFC; D-1434 makes names case-insensitive. | Fixed. |
| 6 | minor | `crates/tegg-core/src/queries_q.rs:2669` | A rename while the first index scan runs can miss usages not yet indexed. | Open: needs an owner decision (refuse rename until the index is ready). |
| 7 | minor | `crates/tegg-core/src/queries_q.rs:1343-1379` | `patch_job_text` has no read-back check, touches `[[…]]` in comments, and turns single quotes into double quotes. | Fixed. |
| 8 | minor | `app/src-tauri/src/shellq.rs:347` | An unparsable zone silently falls back to UTC. | Fixed: it is an error. |
| 9 | minor | `app/webkit/queries_block.ac.test.ts:120-126` | `fr_qry_05_ac6`'s click order is the reverse of D-1506's text. | Test follows D-1506. |
| 10 | minor | `app/webkit/bug_q_fr_qry_06_…` | The name has no issue number (TS-D2). | Kept: the slice has no issue tracker entry; `q` is the slice id. |
| 11 | minor | trailers | Confirm the trailers on `1fb7911`, `146782b`, `6f0c59f`. | Checked. `1fb7911` has `Fixture-Change: … approved-by: owner`. `146782b` has `AC-Test-Change: … approved-by: owner`. `6f0c59f` only adds new red tests, so it needs no trailer. |

## Checked and sound

- **Query file writes:** only changed keys are replaced, every write is read back, and the base is checked; create is exclusive. Newer and unreadable files are refused.
- **The `query-rename` job:** the refusals come before the job starts, and D-1496 stops it before any write. It renames without replacing, keeps a backup that includes `.tegg/`, and can be undone.
- **Trash and restore:** both are moves with unchanged bytes and never write notes.
- **Drafts:** a draft is never serialized.
- **Showing or running a block:** never writes a note.
- **Evaluator:** `this`, the host, dates by zone and region week, overdue, folding and ignored rows are all as decided.
- **Platform rules:** no network calls, and the core stays platform-neutral.
- **AC coverage:** every AC in `docs/acceptance/queries.md` has a test named after it.
