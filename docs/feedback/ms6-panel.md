# Feedback: Tegg Preview v0.55, the right panel (owner, 2026-10-22)

Preview `preview-v0.55` (b8a6a62). Triage as `ms5-v052.md`: **bug** = contradicts an existing AC/decision; **change** =
new behaviour, needs an AP point and a D-xx before work.

| # | Area | Finding | Triage |
|---|---|---|---|
| P1 | Backlinks panel | Task chips in the panel don't follow the LinkChips board (no box icon, no due · status, no Done/Cancelled look, no Unreviewed mark) | change: D-633 (AP-563). D-600 listed the editor, read view, embeds and relation values but not the panel, and D-368 says "type icon and title" |
| P2 | Right panel | The user can change the panel's width | change: D-634 (AP-564) |
| P3 | Backlinks panel | Remove the `Unlinked mentions` button | change: D-635 (AP-565), supersedes D-283 |

The owner also asked for a full L6 run on the v0.55 build; its findings are in `docs/plans/open-items.md`.

## Decided points (owner, 2026-10-22)

| AP | Point | Decision |
|---|---|---|
| AP-563 | Which chip states the panel shows | All D-600 variants (Unreviewed, task icon, due · status, Done, Cancelled). Backlink entries carry `review`, `status`, `due`, `completed` as D-601. **D-633** |
| AP-564 | How resizing works | Drag the left edge, 240–480 px, default 288, machine-local for all vaults, double-click resets, a focusable separator with ←/→ by 16 px, Home/End. **D-634** |
| AP-565 | Unlinked mentions | Removed entirely until FR-LNK-05 (v1.x); not on R3 either. **D-635** |

## AC tests this changes (need `AC-Test-Change`, owner approval)

- `app/test/links_registry.ac.test.ts`: R3 no longer has `Unlinked mentions`.
- `app/test/shell-tables.ts`: the R3 row `Unlinked mentions` goes.
- `app/test/links_catalog.ac.test.ts`: `backlinks.unlinked` leaves the catalog list (R15).
