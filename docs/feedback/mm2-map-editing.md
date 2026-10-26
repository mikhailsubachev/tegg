# Feedback: slice MM2, editing on the map (owner, 2026-10-26)

Build of `main` after PR #76 (slice MM2). Triage as `ms5-v052.md`: **bug** = contradicts an existing AC, decision or
design board; **change** = new behaviour, needs a D-xx.

| # | Area | Finding | Triage |
|---|---|---|---|
| F1 | Map | The map loses the focus on ⏎ after editing a node's text | not reproduced: in the real app (L6) and on WebKit (L5) the committed node keeps the focus and the next ⏎ opens a new node, after a keyboard or a double-click edit, before and after the autosave. What was lost was the indicator: after pointer use the focused node showed no ring (F2). Guarded by `app/e2e/bug_mm2fb_fr_mmp_02_ac23_the_map_keeps_the_focus_after_a_commit.ac.test.ts` |
| F2 | Map | It isn't clear which node is selected | change: D-796. The ring was `:focus-visible` only, so a node focused by a click (D-788) showed nothing |
| F3 | Map | ⏎ on a selected node draws the new node over other nodes | bug: the pending node (D-795) was drawn below the anchor's subtree at a fixed place, over the next node; the map didn't make room for it. Fixed by D-797 |
| F4 | Map | A click on the map's empty area puts the caret in the note body (found by FR-SYN-06 AC-34 on the real app: its click on the tree's centre hit empty space in the spider layout) | change: D-798 |
| F5 | Real-app tests | During the MM L6 run a key reached the Claude app in front and stopped the run | change: D-799, extends D-758 |

## Decided points (owner, 2026-10-26)

| Point | Decision |
|---|---|
| The selected node (F1, F2) | The focused node is the selected one (D-788) and shows a 2 px `accent` ring with a 2 px offset however it got the focus, a click included; the same colour as the node field's ring (FR-UX-05 AC-11). Map nodes are an exception to D-594 (a): there a pointer click leaves no ring. **D-796** |
| Where the new node goes (F3) | While a node is pending (D-795) the map is laid out with it in its place: a sibling right after the anchor, a child last (Tab), ⏎ on the root item its first child (D-787). The pending node is 120 × 32 px; the nodes after it move down and nothing overlaps. Branch colours stay as they were until the commit. **D-797** |
| A click on the empty map area (F4) | It focuses the map's current node (the last focused one, else the root), never the note body; with a field open it commits the field, as a click on another node does. The map area is the canvas over the block's full width. **D-798** |
| Keys in real-app tests (F5) | Every key a real-app test sends (`keystroke` / `key code` through System Events, `app/e2e/helpers/osa.ts`) runs only while the test build is frontmost, checked in the same AppleScript run, waited for up to 2 s, otherwise the test fails and nothing is sent. Finder may be frontmost too (the capture tests type into Tegg's capture window over Finder), except for ⌘Q and ⌘W (D-758); the global hotkeys ⌃⌥… go anywhere. **D-799** |
