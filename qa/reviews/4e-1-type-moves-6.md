# QA review: claude/strat-4e-planning-578ac8 (slice 4E-1, type moves, sixth review)

Head: 3cc95d2df0f4e73882638a9f0aacfac07aff6800  Tree: 83ce5e4fd229339e305ce42e888ea1b92141afa6  Verify: pass (83ce5e4fd2, matches HEAD, 2026-10-28T12:30:29Z)
Verdict: **ready with notes**

Reviewed by the `qa-reviewer` agent on 2026-10-28: commits fa1462e and 3cc95d2 against `qa/reviews/4e-1-type-moves-5.md`, ms4-jobs §2 and §14.3a. The red-first runs for P1 and P3 and the 108 s timing are taken from the commit message.

## Findings

- **[major] F1 (new, 3cc95d2): the fake core no longer follows the event contract it stands in for.** It sends a folder move's renames as one `vault:changed`; ms4-jobs §2 says the event is emitted per written file, and the real core does so (`jobs4c.rs`), the shell forwards each one, and `App.tsx` bumps `refresh` on every event without a debounce. A 500-note folder move or tidy run in the real app gives at least 500 rounds of re-reads. No layer tests the real event stream against FR-STO-01 AC-13 / FR-UX-07 AC-8 (the L6 AC-13 test checks the files only).
  - Root cause, separate follow-up (pre-existing since 4C): per-file events and the undebounced app-wide refresh. Fix by coalescing in the UI or batching per job in the core.
  - 4E-1 part, not blocking if before the merge: (a) the follow-up issue is filed; (b) the fake's batching is noted as a test-only shortcut in the contract; (c) the L6 AC-13 test also asserts `Moved 500 knihy` within a bound.
- **[minor] F2 (new):** `SlimIndex` keeps the last job's lists alive until the next relink; clear it when the job ends.
- **[minor] F3 (known limit, follow-up):** backslash-escaped Markdown destinations (`[x](Tom\&Jerry.md)`) aren't resolved by `markdownLinks`, for every link op. Documented in §14.3a; track as a dialect/link issue with a round-trip test (AR-06).
- **[minor] F4:** the P1 test checks speed and places, not the linking notes' bytes after the undo.

## Fifth-review findings

B0, P1, P2, P4: resolved. P3: resolved for entities, documented for the rest (F3). N4: accepted. m5: accepted, keep as a tracked issue. Gate flakes: closed unless they return.

## Other checks

No new vault write paths, no network, NFC kept in the new keys. No AC test modified; `fake-core.ts` is test support. Synthetic fixtures only.

## AC coverage of touched requirements

- FR-STO-04 AC-11 undo at scale: `bug_qa4e1_5_p1_*` (links at scale: F4). FR-STO-04 AC-8 entity-escaped link: `bug_qa4e1_5_p3_*`; backslash-escaped: missing (F3).
- FR-STO-01 AC-13: Rust, WebKit (batched fake, F1), L6 (no status assertion, F1 c).

## Owner points

None for 4E-1. F1's follow-up is an implementation and contract choice in ms4-jobs §2.
