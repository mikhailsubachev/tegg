# QA review: slice G1 graph ACs, contract and ADR (PR #90)

- **Branch:** `claude/graph-g1-acs-2ffabc` · **Reviewed head:** a332deb (tree db7e9e1) · **Reviewer:** `qa-reviewer` agent, 2026-10-29
- **Verdict:** ready with notes; no blockers. All findings fixed in 301da45 without new owner decisions.
- **Checked:** fixture counts recomputed from the files (27 edges, degrees with sum 54, every walk, type count, filter scenario and hub count in the fixture README); AP-n → D-(n+143); AC numbers don't collide with slice P; CLAUDE.md rules (no vault writes, machine-local state, AR-03, NFC, no network); privacy.

## Findings and resolution

| # | Finding | Resolution (301da45) |
| --- | --- | --- |
| M1 | FR-GRP-02 AC-5 stored `hiddenKinds: ["relations"]`; the contract's `EdgeKindDto` is singular | AC-5 uses `["relation"]` |
| M2 | A renamed node had no stable key (layout keyed by path); the centre's `id` had no source; an external rename first answers `CentreNotFound` | `GraphNode.object_id` / `objectId`; layout and selection keyed by it (else the sort key); contract §3 calls `index_path_by_id` before showing the gone state; a centre without `id` shows the gone state |
| M3 | "Byte for byte" JSON but edge, `ways`, `type_counts` and `NodeId` order unspecified | Contract §1.6: sort keys, edge order, `ways` order, `type_counts` order, serde form of `NodeId` |
| M4 | D-988's narrow layout had no AC and no `Filters` string | FR-GRP-01 AC-27 (800 × 500, popover and overlay); R112 `graph.filtersButton`; R109 row; counts 62 / 61 automated |
| m1 | review-prep diff used a stale local `main` | Gate rerun with `./verify merge --base origin/main` |
| m2 | Fixture README still "draft" with AP references | Approved; AP-n replaced by D-(n+143); rejected alternatives marked historical |
| m3 | Seams named visible types and kinds | Seams row follows the contract (hidden types and kinds, `showAll`) |
| m4 | R110 "too many" fired on depth 1 above 150 | Fires only when the cap dropped nodes (D-978) |
| m5 | AC-18's zoom-out rule hid the selected and hovered labels; start zoom unclear | Three labels always shown (D-985); the test sets 100 % |
| m6 | R111 tie-break for tag nodes | `tag:<key>` sort key in R111 |
| m7 | The new `show` signature changed more than D-982 | Contract §7 keeps `origin` and optional `host`; only `extraLine` → `extraLines` plus `extraAction`. The forward pointer in v1-previews §7 is left to the slice P / G1 build (P is editing that file) |
| m8 | Walk start rules implicit | Contract §1.2: centre always entered and expanded; Tag-file centre → `Tag(key)`; losing duplicate → `CentreNotFound` |
| m9 | No source for undefined type values | Contract §1.7: `type_counts` lists every vault type key with 0 |
| m10 | `by relation Source` vs the raw-key rule | Reserved keys from the catalog (`graph.relKey.*`); NFR-OTH-02 AC-12 exception narrowed |
| m11 | NFD copy collides on APFS | AC-26 and the README rename Shrnutí to its NFD name in place |
| m12 | AC-9's L4 cancel case was a race | A test-only pause hook between BFS levels (contract §1.5) |
| m13 | No L0 row in the layer table | Added |
| m14 | The centre's size step undefined | `data-size-step="centre"` |
| m15 | Panel cap vs "nothing panel-specific" | Seams: G2 checks `total > 60` and shows the offer instead of drawing |
| m16 | AC-10 named a route in `ui-state` | The history entry and the D-993 `vaults` key |

Gate: `./verify merge --base origin/main` READY on 301da45 (two earlier runs failed on unrelated timing-sensitive tests while the machine's load average was about 20; rerun at low load passed).
