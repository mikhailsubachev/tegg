# QA review: claude/strat-4e-planning-578ac8 (slice 4E-1, type moves, third review)

Head: 43e028315011738580fb6d287f652d0eb8948b07  Tree: 7defce0f8e14fbc1fb3e5db3789c02b7260724da  Verify: fail (load flake)
Verdict: **not ready**

Reviewed by the `qa-reviewer` agent on 2026-10-28: commits beef742, 9c60fbc, 03be5cc, 43e0283 against `qa/reviews/4e-1-type-moves-2.md`, D-803…D-840, ms4-jobs §5, §7, §8, §14, §14.3a.

## Findings

- **[blocker] B0** No passing push on this tree.
- **[blocker] B1** `movejobs.rs` pre-check name loop can spin forever: `free_stem` doesn't know the job's reserved names (three same-stem strays; two strays planned to the same ` (2)` name). Fix: one name predicate (taken, existing, vault-wide stems) from the note's own stem; reserve names in the planner. L4 tests.
- **[major] M1** An in-place type change of the open note goes through `write_live` while the page holds its saver: 30 s wait, skipped `changed`, status still `Now a <Type>`; Undo of such a row reverts only links. Fix: write the page's own note directly.
- **[major] M2** A moved note skipped in the pre-check is passed to `write_one` again (two skip rows; may get its type in place).
- **[major] M3** In-place type-change notes are written with the planned relink, before the real moves are known.
- **[major] M4** The correction pass adds a second `Written` row: Undo of the note is skipped; the journal hash is stale.
- **[major] M5** The undo op is set only for single moves and before the moves: editor-written linking notes of multi-note jobs can't be undone or redone.
- **[major] M6** Relative Markdown links from a moved note to non-`.md` files (attachments, PDFs) break when its folder depth changes.
- **[major] M7** Memory/IPC: every op carries a copy of the vault's note paths (≈1 GB for 500 moves + 1,000 linking notes on 20k).
- **[minor] m1** `plan.renames` not rebuilt after late names/failed renames (Retry answers `changed`).
- **[minor] m2** A done type move whose only note was skipped still says `Now a <Type>`.
- **[minor] m3** Contract drift: `bulk` in §14.2; §14.3 vs §14.3a; §14.6 journal of a bulk group of one; the correction pass's scope.
- **[minor] m4** Exemptions cleared for notes skipped before the rename.
- **[minor] m5** N2 remainder: L5 covers only body and title; tidy/folder moves of an open dirty note apply only rename ops.
- **[minor] m6** Dead code `let _ = from;`, `let _ = b;`.
- **[minor] m7** Red-first of the new `bug_qa4e1_*` tests unconfirmed.

## Second-review findings

N1 resolved for names settled before the first rename (B1, M3, M4 new); N2 resolved from the note page (m5, M1); N3 resolved (M6 gap); N4, N5, N8, N11, N12 resolved; N6, N7, N10 partial; N9 partial (m7).

## Owner points

None: every fix stays inside D-804, D-810, D-811, D-812, D-838 and ms4-jobs §7, §8, §9.
