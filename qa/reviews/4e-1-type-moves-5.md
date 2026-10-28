# QA review: claude/strat-4e-planning-578ac8 (slice 4E-1, type moves, fifth review)

Head: d32535b12d76c6decda3132ac98d902165544163  Tree: f2593abd5494e955a52e0cfe9baa80efbfffa84c  Verify: missing (the last push gate failed on c620e050…, 21bccd3's tree; the last pass was on 7defce0f…, 43e0283's tree)
Verdict: **not ready**

Reviewed by the `qa-reviewer` agent on 2026-10-28: commit d32535b against `qa/reviews/4e-1-type-moves-4.md` and ms4-jobs §2.3 and §14.3a. The reviewer can only read files, so the red-first claims and the WebKit flakes are not confirmed by it.

## Findings

- **[blocker] B0: no passing push for this tree.** The gate on d32535b was still running. Failures that pass alone are not a gate result; if they recur in the full run they need their own issue.

- **[major] P1 (new): undoing a large move copies the vault's path list for every file and scans it against every move.** `plan_undo` builds each file's ops with `reversed(op)`, and for a `Relink` that allocates a new `paths` Vec with a linear, NFC-allocating search of `moves` per path. For the 500-move, 1,000-linking-note case on the 20k vault: 1,500 copies of 20k paths and about 1,500 × 20k × 500 comparisons, so the undo never gets past `planning`. `write_undo` reverses once more (time only). Redo shares the Arcs. FR-STO-04 AC-11, D-812. Fix: reverse once per undo with a map, share the Arcs; an L4 test with a time bound.

- **[minor] P2 (new): the `SlimIndex` cache is keyed by raw `Arc::as_ptr` values without holding the Arcs.** After a free, a new op can get the same addresses and hit a stale index, silently pairing paths with other stems (journal Finish deserializes fresh ops each time). Fix: keep the Arcs and compare with `Arc::ptr_eq`.

- **[minor] P3: N1 matching misses destinations written with entity or backslash escapes** (`[x](Babi&#269;ka.md)`, `[x](Tom\&Jerry.md)`), which `markdownLinks` decodes. Rare; decode them in the matching copy or note the limit in §14.3a. `percent_decoded` itself is sound.

- **[minor] P4: `vault_files()` lists the whole vault in every move job's write step**, even when nothing moves. Build it only when there are moves. The journals store the unslimmed lists (a few MB per job): acceptable.

## Fourth-review findings

- M1′: resolved. The real app gets the same `vault:changed` event as the fake (`Host::write` emits `VaultChanged`, forwarded by the shell), so the WebKit test reflects the app; `onRewritten` is a harmless second trigger. Direct rows are journaled with their bytes and Finish writes them.
- N1: resolved for percent-encoding (rest: P3). N2, N3 (and third-round m1), N6, N7: resolved. N5: resolved, key needs P2. M7′: resolved forward; undo side is P1.
- N4: accepted as carried (base-checked direct write; an open page reloads or merges, NFR-REL-02).
- m5: accepted as carried; keep it as a tracked issue.
- m7: unconfirmed by the reviewer (needs a run).

## AC coverage of touched requirements

- FR-STO-04 AC-11 in place with an open editor: `bug_qa4e1_4_m1p_*` (Rust, WebKit). AC-7/AC-8 encoded links: `bug_qa4e1_4_n1_*`. AC-8 links the move doesn't break: `bug_qa4e1_4_n2_*`. FR-STO-01 AC-9 late name: `bug_qa4e1_4_n3_*`.
- Missing: Undo of a large move at scale (P1); entity-escaped Markdown links (P3).

## Owner points

None.
