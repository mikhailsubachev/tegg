# Slice MM3 (map navigation, drag, fold, mouse add) and the `+` object menu (2026-11-25)

Status: **decided 2026-11-25** (owner answers, then "Approve all"): AP-2100…AP-2110 are D-2600…D-2610 (BRD v1.323). Boards approved (D-2611), ACs approved (D-2612…D-2634), red tests (D-2635…D-2652), built (D-2653…D-2667), QA fixes D-2668 (BRD v1.328).

Owner brief (2026-11-25):

- Map: ↑/↓ move between children of the same node; ←/→ child/parent (on spider, ← goes to the child on the root and on
  the left side); drag-and-drop branches (reorder, re-parent); fold/unfold by a mouse click or Space in navigation mode;
  add nodes with a mouse `+` shown on hover.
- Editor: create a new Page or any other object from `/`, or after typing `+` (the same menu as `/`); board with all
  menu variations.
- Bug: converting an empty block into an object shows an error until the page is refreshed.

## Decided by the owner (2026-11-25)

| AP | Point | Decision |
| --- | --- | --- |
| AP-2100 | ↑/↓ on the map (amends D-770's outline order) | ↑/↓ move among the node's siblings; past the first / last sibling they **continue to the nearest node at the same depth under the previous / next parent** (cousin). |
| AP-2101 | Where a fold is remembered | **Not remembered**: folds last while the note is open; reopening shows the map unfolded. Nothing written, nothing in `ui-state.json` (FR-MMP-02 AC-33 unchanged). |
| AP-2102 | What text typed after `+` does | **It filters, like `/`**: `+` opens the `/` menu at its Objects group and typed text filters rows (`+ta` → `Task`); the title is asked in the dialog. |
| AP-2103 | What a new object from `+` or `/` inserts | **Always a link** `[[Title]]` at the caret (not an embed). |

## Proposals for the owner

| AP | Point | Proposal |
| --- | --- | --- |
| AP-2104 | ←/→ | Unchanged from D-790 (`right`: ← parent, → first child; `spider`: on the root and the left side ← is the first child). Check: the built app must do this. If it doesn't, that's a bug, not a change. |
| AP-2105 | Space (amends D-787) | Space folds / unfolds the focused node with children (nothing on a leaf). F2 and a double-click edit the text. → on a folded node unfolds it. Tab on a folded node unfolds it before adding the child. |
| AP-2106 | Fold control | A 16 px circle on the connector's elbow of a node with children: `−` on hover while open; the hidden count (`+3`, as the board's Travel node) while folded; a click toggles. Shown in the read view too (writes nothing). |
| AP-2107 | Mouse `+` | On hover or focus, a 16 px `+` at the node's outer edge (where its children grow): adds a child at the end and edits it (as Tab). On the spider root, one `+` (appended; its side follows the alternation). Not in the read view. |
| AP-2108 | Drag and drop | Drag a node (4 px threshold, so a click still focuses) with its subtree: on a node's upper / lower half, it becomes the sibling before / after it; on its outer third, it becomes its last child. A drop line or a highlight shows the target. No drop into its own subtree; the root can't be dragged. Esc cancels. One list edit, one undo step (as the ⌥ arrows). Hovering 600 ms over a folded node unfolds it. Not in the read view. |
| AP-2109 | `/` Objects group | One row per creatable type (Page, Task, Quick Note, then user types in D-122 order; never Daily Note, Tag, Image or PDF, as R50), then `Embed object`, `Turn into object…`. A type row opens a dialog with an empty title and that type; Convert creates the object and inserts `[[Title]]` at the caret (AP-2103). `/task` in a paragraph with text no longer converts the paragraph (`Turn into object…` and ⇧⌘T still do). |
| AP-2110 | `+` trigger | `+` at the start of a block or after a space opens the menu (like `/`), never inside a word (`C++`, `1+1`). `+` then a space closes the menu, so `+ ` at the start of a line still makes a bullet list. |

## Bug: converting an empty block

On the built app (synthetic `tasks` fixture), ⇧⌘O in an empty paragraph after `Úvodní odstavec.`, title, ⏎: the Task file
and the embed are written, but the card then fills the editor with blank space below `Add details…` and the rest of
the note is pushed out of view. No error text was seen. The fake core (L5) doesn't show it. The owner's error text,
and the path used (block menu, `/`, ⇧⌘O, type), are needed for the regression test `bug_<issue>_fr_cnv_03_…`.
