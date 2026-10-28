# QA review: claude/strat-4e-planning-578ac8 (slice 4E-1, type moves, second review)

Head: 4e9db6c00f6c19fb76dc768a04ba6926fe100f38  Tree: 176652d4cf8511eaab5bf934f005e842e4686e7c  Verify: pass
Verdict: **not ready**

Reviewed by the `qa-reviewer` agent on 2026-10-28: fix commit 4e9db6c against the first review (`qa/reviews/4e-1-type-moves.md`), D-803…D-840, `docs/acceptance/type-moves.md`, ms4-jobs §5, §7, §8, §14, §14.8a. Diff against origin/main.

## Findings

- **[blocker] N1.** A moved note's links to other moved notes can break (D-810, D-838). `HoldTargets` in moved notes keeps the *planned* destination of the other note and isn't updated when that note is skipped or takes a ` (2)` name; with a same-stem note elsewhere, `keep-targets` and `hold-targets` each see only their own move and can write a path that no longer exists. Fix: give the link op the whole move set, resolve before over the original paths and after with every move applied from the file's own final folder; decide skips and names before the first rename. L4 cases: two moved notes linking to each other with one skipped, with a `NameTaken`, with a same-stem note in a third folder.
- **[major] N2.** First-review #8 only partly fixed: only the TipTap body is blocked; the title, the property panel, the chip, the review toggle and the source view still change the text during a move, and `unblock` runs before the `onMoved` reload (and re-enables the editor under the merge dialog). Fix: a `moving` state that makes them read-only until the reload, never while `merge` is open; an L5 test.
- **[major] N3.** `hold-targets` has no property test (FR-FMT-07 AC-26, AR-06). Fix: a generator next to `keep-targets`, with a resolution oracle.
- **[minor] N4.** A folder save clears only the new paths from the exemption `paths` (D-839); clear every `from` too.
- **[minor] N5.** D-837 "each with its zip": a group of one in a bulk convert gets no zip; only the first group feeds the Inbox status. Fix: a `bulk` flag.
- **[minor] N6.** The fake core differs from Rust: maps untyped notes' keys, exemptions by id only, no `hold-targets` in moved notes, folder label always plural. Align.
- **[minor] N7.** Contract §14 stale: the folder move still says `RetargetLinks`; the `TextOp` lists lack `HoldTargets`; §14.6 file shape and undo; `type_patch` "gains `jobId`"; first-review #18's rule not written down.
- **[minor] N8.** `storedValues` doesn't resolve YAML aliases; removing an anchor entry can leave an unresolvable alias.
- **[minor] N9.** The `bug_qa4e1_*` tests were never seen red; #8 and #6's journal rewrite have no test; the L2 generator lacks numeric-looking scalars.
- **[minor] N10.** Cost: a stem scan of every note per moved note; the note list cloned into every op. Build a stem map; run `perf_type_move.ts` on the 20k vault before MS7.
- **[minor] N11.** D-812 and D-839 clear exemptions only on job-driven type changes; record the scope.
- **[minor] N12.** `The type couldn't be changed. Nothing was written.` is shown for any non-`done` phase, also when files were written.

## First-review findings

1, 2, 3, 5, 6, 7, 10, 12, 13, 15…22: resolved (12 with gap N4; 7 with N8). 4 partial (no E2 table test), 8 partial (N2), 9 resolved per D-837 except N5, 11 resolved for notes that don't move (N1), 14 partial (no L6 use of `TEGG_TEST_FOCUS_FOLDER`), 23 partial (N7), 24 open (L6 not run).

## Owner decisions

D-837 followed except N5; D-838 followed for notes that don't move (N1); D-839 with gap N4; D-840 followed. "A path form stays a path form" is consistent with FR-STO-04 AC-7; write it into the contract.
