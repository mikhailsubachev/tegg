# QA review: slice G1 graph build (branch `claude/graph-g1-red-tests`)

- **Reviewed head:** 8e29c30 (tree 25d1210) · **Reviewer:** `qa-reviewer` agent, 2026-10-30
- **Verdict:** not ready (no passing push run on the head tree; NFR-PERF-11 AC-1 could not pass). Findings fixed in c60b60a;
  `./verify push` PASS on c60b60a.
- **Checked:** the query writes nothing (core `CountingFs` and snapshot test); no network; NFC throughout; view state per
  vault in `ui-state.json` (kept by `UiStateDto`'s flattened map); no stubs, skips or `.only`; the AC-test changes match
  D-1021, D-1022 and carry the trailer; `embed_load` in the fake core's READS is right (ms4-embeds §8: it never counts as a
  write); the Rust and TypeScript walks agree.

## Findings and resolution

| # | Finding | Resolution |
| --- | --- | --- |
| 1 | Blocker: no passing push run for the head tree | `./verify push` PASS on c60b60a |
| 2 | Major: `graph-request` never marked; `graph-centre:` (D-1003) never written | `ask()` marks `graph-request`; the benchmark estimates its centre from the files, so `graph-centre:` stays unwritten (contract §14; open point for the owner) |
| 3 | Major: each request listed the vault and read the type files for the type order | Order from the cached type definitions and the graph's cached type keys |
| 4 | Major: `graph_ready` not set when the listing fails; set after `Done` was emitted | A drop guard sets it on every exit, before `Done` / `Cancelled` |
| 5 | Minor: NFC allocations in the build's sort comparator; cold rebuild not reported | NFC computed once; the cold-build report is a follow-up |
| 6 | Minor: twins parse Tag `created` differently (seconds optional in TS) | TS requires seconds, like `parse_from_rfc3339` |
| 7 | Minor: leftover `'ready'` progress state | Removed (D-1005) |
| 8 | Minor: `route-ready:graph/…` written on navigation | Written by the page after the first graph or state |
| 9 | Minor: trashed centre found only at the same path | Follow-up (contract §14) |
| 10 | Minor: hand-written DTOs | Follow-up (contract §14) |
| 11 | Minor: contract drift (§1.4, §4, §5) | Contract updated |
| 12 | Minor: label cut measured on every render | Cuts remembered per text and font; font family read once |
| 13 | Minor: duplicated system colours; unformatted type counts | One `typeColour` helper from the type definitions; counts formatted by region |
| 14 | Minor: misplaced tokens comment | Moved |
