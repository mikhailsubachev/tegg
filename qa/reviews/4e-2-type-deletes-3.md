# QA review: claude/4e2-deletes (slice 4E-2, third review: fixes of qa/reviews/4e-2-type-deletes-2.md and D-859)

Head: 2f2bdd71f522762b03d7d415819ff5bafef582c5  Tree: a84fd1234171a2702589e40a145d31d81f7d9a26  Verify: fail (767f0008, not the head tree; last pass 81b21c5c = 59b5aca)
Verdict: **not ready** only for the gate; **ready with notes** once `./verify push` passes on tree a84fd123.

Reviewed by the `qa-reviewer` agent on 2026-10-28; scope 69d90a6 and 2f2bdd7, against ms4-jobs §14.9, type-moves.md R99 D3/F2, D-815, D-849, D-857, D-858, D-859.

## Findings

- **[blocker] gate:** no passing push on tree a84fd123 yet (the 69d90a6 run failed only `fr_mmp_02_ac14_typing_in_the_500_node_list_report_only`, a mindmap typing-speed test outside this branch, under load). It must pass on a clean run.
- **[minor]** The N1 test's bound `lists < u.written.len()` allows up to 4 listings for 5 rows; the fixed code lists once. `<= 1` would catch a regression.
- **[minor]** m8 can be tested: a folder at `.tegg/types/schůzka.yml` doesn't define the type, so the restore tries the trashed copy and `move_back` fails. Optional.
- **[minor]** N9 (the 30 s timeout cancels the job) has no test; it would need an injectable timeout. Accepted.
- **[minor, carried]** every planned note `remove-key` leaves unchanged is skipped `readOnly`, broader than D-858's "an anchored entry"; today only anchored entries reach it.

## Second review's findings

N1, N2, N5, N6, N7, N8, N9 fixed; N3, N4 decided by the owner (D-859) and implemented (`Couldn't delete <Name>. Nothing was changed.`; `· <k> left as written (a value other properties use)`; no Retry on those rows). Rules 1–13, privacy and scope: no new findings.

## Before merge

1. A passing `./verify push` on the head tree; re-run if the mindmap typing-speed test fails under load, never waive it.
2. Optional: the N1 bound `<= 1`.
