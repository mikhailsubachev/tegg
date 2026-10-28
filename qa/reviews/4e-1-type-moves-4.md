# QA review: claude/strat-4e-planning-578ac8 (slice 4E-1, type moves, fourth review)

Head: 21bccd37c5df80ee5e83be3c05345a01ff67caed  Tree: c620e050c7c6645c336a4da828200448f7c00ac9  Verify: missing (last pass on 7defce0f8e14fbc1fb3e5db3789c02b7260724da, which is 43e0283's tree, not HEAD's)
Verdict: **not ready**

Reviewed by the `qa-reviewer` agent on 2026-10-28: commit 21bccd3 against `qa/reviews/4e-1-type-moves-3.md`, ms4-jobs §14.3a and §14.6, and the dialect §6. Three of the fixes are incomplete or introduce new problems: the M1 undo path, the M6 rewrite of links to attachments, and the M7 path slimming.

## Findings

- **[blocker] B0: no passing push for this tree.** The gate on 21bccd3 was still running.

- **[major] M1′: undoing an in-place type change while the note is open still doesn't undo it.** `crates/tegg-jobs/src/engine.rs` (`if w.via_op || (at == to && editors.contains(at))`): the in-place row goes through `write_live` with the reversed `relink`, which has no moves, so the transform gives `unchanged`; the page's live callback returns without saving, the job waits the 30 s `LIVE_TIMEOUT`, lists the note as `changed`, and the type stays. Redo behaves the same way. FR-STO-04 AC-11, D-812. Fix: undo and redo write their stored bytes directly with the page's saver held, then make the page reload, as the forward path does; L4 test with `editor_open`.

- **[major] N1 (new, from M7): `slim_relink` drops the target path of percent-encoded Markdown links**, so they break when the note moves. It keeps a path only if its stem appears verbatim in the raw text; `markdownLinks` resolves on the decoded URL. `[x](Bez%20autora.md)` or `[x](../Knihy/Babi%C4%8Dka.md)` in a moved note, pointing at a note that doesn't move, is left as written and points at nothing from the new folder. Silent link break (D-810, FR-STO-04 AC-7/AC-8). Fix: also match against a percent-decoded, NFC, lower-cased copy of the text; L4 test through the real transformer.

- **[major] N2 (new, from M6): links to attachments that already resolved by name or from the vault root are rewritten into broken relative paths** (`packages/doc/src/transform.ts`). `![](photo.png)` with the file in `_attachments/` becomes `../Pages/photo.png`; `![](_attachments/x.png)` becomes `../Pages/_attachments/x.png`; `[site](www.example.com)` becomes `../Pages/www.example.com`. These links are not broken by the move, so D-810 says to leave them alone. Fix: rewrite only when the relative reading names an existing vault file; L1 tests for the three forms.

- **[major] M7′: the memory half of M7 is not resolved.** `TextOp::Relink { paths }` is deep-cloned into every planned file and the plan is cloned twice more into the job state: 500 moves + 1,000 linking notes on the 20k vault give about 1,500 copies of 20k paths. Fix: keep the path list once per job.

- **[minor] N3:** on `NameTaken`, `move_note` uses `host.free_stem(folder, stem_of(to))`: a planned `Beta (2)` that is taken becomes `Beta (2) (2)`, and the job's reserved names are ignored. Fix: `free_stem_avoiding(folder, stem_of(f.path), taken)` and add the result to `taken`.

- **[minor] N4:** `write_direct` bypasses an open editor for any in-place note, not only the one the page started. Not reachable from today's UI, and the saver's base check would show a merge, but rough. Fix: `write_direct` only when `single`.

- **[minor] N5:** `slim_relink` NFC-normalises and lower-cases every vault path for every file: O(files × vault paths). Fix: precompute once per job.

- **[minor] N6: 4C behaviour change.** `markdownLinks` now includes image destinations, so a note rename retargets `![](Duna.md)`. Consistent, no 4C AC changes; note it in ms4-jobs §2.3.

- **[minor] m5 (carried):** an open note with unsaved edits loses the job's link rewrites when the tidy job or a folder move moves it: `onMoved` applies only `set-title` and `retarget-links` to the editor's unsaved text, not the `relink`.

- **[minor] N7:** the doc comment of `free_stem_in` now sits above `free_stem_avoiding` (`crates/tegg-core/src/links4a.rs`).

- **[minor] m7:** red-first of the new `bug_qa4e1_*` tests not confirmed (`./verify check-red 21bccd3^`); `bug_qa4e1_m1_*` is ambiguous between M1 and m1; no test for m1 (`plan.renames` rebuilt / Retry).

## Third-review findings

- B1: resolved (late-rename remainder: N3).
- M1: partial (forward fixed; undo and redo: M1′).
- M2, M3, M4, M5: resolved.
- M6: resolved for existing relative paths; introduces N2.
- M7: IPC half resolved; memory half open (M7′); the slimming introduces N1.
- m1: resolved, untested. m2, m3 (apart from N6), m4, m6: resolved. m5: L5 part resolved, dirty-note part carried. m7: unconfirmed.

## AC coverage of touched requirements

- FR-STO-04 AC-3…AC-14, FR-STO-01 AC-8…AC-14, FR-INB-02 AC-17: covered at L1, L4, L5, L6 and nightly.
- Missing: AC-11 in-place with an open editor (M1′); AC-7/AC-8 encoded relative links to a non-moved note (N1); AC-8 name-only and vault-root attachment links (N2).

## Owner points

None: every fix stays inside D-804, D-810, D-812 and ms4-jobs §7, §9 and §14.3a.
