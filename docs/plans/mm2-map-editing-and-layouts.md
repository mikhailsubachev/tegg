# Slice MM2: editing on the map and two layouts (2026-10-26)

Status: **accepted by the owner on 2026-10-26, as drawn on the redrawn `MindmapLayouts` board: AP-741…AP-748 are D-785…D-792 (BRD v1.99).** Next: the ACs (`docs/acceptance/mindmap.md` §MM2), the contract (`docs/contracts/mm-mindmap.md` §6) and the red tests (D-61). Owner brief (2026-10-26, with the new board `MindmapLayouts` on the design canvas, page `Mindmap`): *no Mermaid; a nested list view or a visual view; edit the map in the Map view with keyboard navigation; two layouts.*

## 1. Where we are

Slice MM is on `main` (D-679…D-687, D-765…D-780): a mindmap is a `> [!mindmap]` callout holding one list, Tegg draws it, no Mermaid (D-679), `Map` / `List` toggle (D-684), keyboard navigation on the map (D-770: ↑/↓ outline order, → child, ← parent, Home/End, ⏎ or Space = node click). Two of the four asks are therefore done. The other two are the parts D-687 left in v1.0:

| Ask | Today | Decided where |
| --- | --- | --- |
| No Mermaid | done | D-679 |
| List view or visual view | done: `Map` / `List` | D-684 |
| Edit on the map with the keyboard | **not built**: ⏎, Space or a click on a node switches to List with the caret in the item | D-684, D-770, D-776, D-687 ("editing on the map" is v1.0) |
| Two layouts | **not built**: one left-to-right layout, nothing stored | D-683 (R-08: no layout stored) |

The `MindmapLayouts` board predates D-679 and D-684: it says "Mermaid source", shows a `Visual | Source` toggle and proposes a `%% tegg-layout` Mermaid comment. Those parts don't apply (AP-748); the board is read for the layout geometry, the switch and the keyboard rule only.

## 2. Points for the owner

### 2.1 Scope

| AP | Point | Proposal | Alternative |
| --- | --- | --- | --- |
| AP-741 | **Map editing moves from v1.0 into slice MM2** (amends D-687, D-377) | Keyboard editing on the map (AP-742…AP-744) and the two layouts (AP-745…AP-747) are slice MM2, built now in the daily-use order after the MS8 release gate work or beside it (editor-only, no file-format change beyond one title-line marker). Drag to re-parent, collapse, zoom/pan, node → object, export and full screen stay v1.0 | Layouts only now (small), map editing with the v1.0 visual editor |

### 2.2 Editing on the map

| AP | Point | Proposal | Alternative |
| --- | --- | --- | --- |
| AP-742 | **The editing model: the map edits the list** (D-82, one text engine) | Every edit on the map is the same list edit the List view would make, through the editor's commands (§3 of the MM contract): the saved bytes are R93's, the block-level rewrite rule is D-766, each key is one undo step, and ⌘Z / ⇧⌘Z work with the map focused. The map stays in view after an edit; nothing switches to List. The map re-lays out at once (not the 150 ms debounce of D-776), with the focus kept on the edited node. Nothing new is stored. In the read view and a read-only note the map is navigation only, as today | A separate map model written back to the list (a second text engine; rejected by D-82) |
| AP-743 | **Keys on the map** (amends D-770: ⏎ and Space no longer switch to List) | With a node focused: **⏎** adds an empty sibling after it and edits it (on the root: adds the first child; on the synthesized root, a new top-level item at the end). **Tab** adds an empty child at the end of the node's children and edits it. **Space** or **F2** edits the node's text with the caret at its end. **⌫** or **Delete** removes a node that has no children, focus moves to the previous sibling, else the parent; on a node with children the key does nothing (its subtree is deleted in List, no dialog, no surprise). **⌥↑ / ⌥↓** move the node among its siblings; **⌥→** nests it under the previous sibling (as Tab in the list); **⌥←** un-nests it after its parent (⇧Tab). **⌘↩** keeps opening the first link (D-770). Navigation (↑/↓/←/→/Home/End) is unchanged in the right layout; in the spider layout see AP-746. Checklist nodes stay read-only on the map (D-770). Every change is written through AP-742 | Typing a printable character starts editing (replaces the text as in Finder; risky for a slip of the hand). ⌫ deletes a subtree with its undo |
| AP-744 | **Editing a node's text** | While editing, the node shows its first paragraph's **Markdown source** in a single-line field (`[[Lisabon]]`, `#tag`, `**bold**` as written; the width grows with the text up to R92's 200 px, then wraps). **⏎** commits; **Esc** cancels and keeps the old text; **Tab** commits and adds a child (AP-743); clicking elsewhere commits. An item with more than its first paragraph (`more`, D-774) edits its first paragraph only; the rest is untouched. `[[` and `#` autocomplete, the floating toolbar and date mentions are not offered on the map in MM2 (List has them; v1.0 on the map). Pointer: **a single click focuses the node** (it no longer switches to List; amends D-684, D-776), **a double-click edits its text**, a click on a chip opens its link (D-770); the `List` button and `⌘⇧L`-style palette commands are how the list is reached | The node's rendered inline content edited in place with chips (a nested ProseMirror per node; much more code for the same bytes) |

### 2.3 Two layouts

| AP | Point | Proposal | Alternative |
| --- | --- | --- | --- |
| AP-745 | **`right` and `spider`** (board A and B; adds to D-683) | Two layouts, both deterministic (golden tests as R92, D-777). **`right`** is today's layout and the default. **`spider`**: the root sits in the middle; first-level branches alternate **right, left, right, left in outline order** (the 1st, 3rd, 5th… to the right); a left-side subtree is the mirror image of a right-side one (children to the left of their parent, elbows mirrored, the connector leaving the root's left side); the two sides are stacked independently and centred on the root; R92's sizes, gaps, colours and wrapping are unchanged. Width = left columns + root + right columns; a wide map scrolls inside the block as today (D-683). Inserting a first-level branch in the middle flips the side of every later branch: accepted, since the side is a function of the outline position, so the drawing never depends on history (R-08) | Balance the sides by subtree size (stable only until a branch grows) |
| AP-746 | **Navigation on the spider map** (adds to D-770) | ← and → follow the screen: on a right-side node → is the first child and ← the parent; on a left-side node ← is the first child and → the parent; on the root → is the first right-side branch and ← the first left-side branch. ↑/↓ stay outline order (so they cross sides). The board's "a new first-level branch goes to the lighter side" follows from AP-745's alternation when the branch is appended at the end (⏎ on the last first-level node) | ← / → always mean parent / child (as the right layout) regardless of side |
| AP-747 | **Where the choice is stored: in the callout line** (AR-01, NFR-POR-03; replaces the board's Mermaid comment) | The layout is per block and lives in the file as Obsidian callout metadata: `> [!mindmap\|spider] Title`. Obsidian renders `[!type\|metadata]` as the callout and ignores the metadata, so the vault opens unchanged (NFR-POR-01; the owner rechecks as for D-686). `right` is the default and is **never written**; switching to `right` removes the `\|spider` part. Unknown metadata (`[!mindmap\|foo]`) means `right` and is preserved byte for byte until the user switches (FR-FMT-07). Recognition (R90) matches the type before `\|`, so hint callouts and case rules are unchanged. Switching the layout rewrites only the callout's title line, is one undo step, and is the only write a layout switch makes (FR-SYN-06). A vault-wide default layout is v1.0 (a `.tegg/vault.yml` key) | A `.tegg/` sidecar or `ui-state.json` (the drawing would differ per machine and in Obsidian the information is lost: against NFR-POR-03) · a vault setting only, nothing per block |

### 2.4 The switch and the board

| AP | Point | Proposal | Alternative |
| --- | --- | --- | --- |
| AP-748 | **The layout switch and what the board doesn't mean** | In the block header, left of `Map` / `List`: a `radiogroup` `Mindmap layout` with two icon buttons `Branches to the right` and `Spider: branches on both sides` (tooltips as named; VoiceOver `Mindmap layout, Spider, selected, 2 of 2`), shown in **both** views (the List view draws the live map too), hidden in the read view and read-only notes (the stored layout is drawn). Palette commands `Mindmap layout: right` and `Mindmap layout: spider` (R4 section `edit`, no shortcut). The board's `Visual | Source` toggle, "Mermaid source", `%% tegg-layout` and "full screen shows it whole" don't apply (D-679, D-684; full screen is v1.0); the board is corrected to `Map | List` and the callout marker when it is next touched | Switch in Map only (the board's "visual mode only") |

## 3. What changes once decided

- **BRD** (v1.99, one D-xx per AP): FR-MMP-02 (the v1.0 sentence splits: keyboard editing and layouts now, drag/collapse/zoom/pan later), D-684 and D-776 (node click → focus, not List), D-770 (⏎/Space), D-687 (what stays v1.0), D-683 / R-08 ("no layout stored" → "no positions stored; the layout *name* is callout metadata"), FR-FMT-05 (the metadata form), NFR-POR-01 (Obsidian recheck), §11 rows.
- **Dialect** `docs/markdown-dialect.md`: the callout row gains `[!type|metadata]`, preserved for every callout, read for `mindmap`.
- **ACs** `docs/acceptance/mindmap.md`: a new section MM2 (R95 keys on the map, R96 spider geometry with golden values, R97 the switch and strings); FR-MMP-02 AC-5, AC-15 and the node-click parts of AC-3, AC-16 change (`AC-Test-Change`, approved by the owner with these decisions); new FR-FMT-07 / FR-SYN-06 criteria for the one-line write; FR-UX-03 AC-15 and NFR-OTH-02 AC-7 gain the new commands and strings; NFR-PERF: the spider layout of `Velká mapa` meets AC-14's 16.7 ms.
- **Contract** `docs/contracts/mm-mindmap.md` §6: `MindmapTree.layout: 'right' | 'spider'` and `meta: string | null`; `layoutMindmap(tree, measure, { layout })` with `side: 'left' | 'right' | 'root'` on each node; editor commands `mindmapInsertSibling(path)`, `mindmapInsertChild(path)`, `mindmapSetText(path, markdown)`, `mindmapDelete(path)`, `mindmapMove(path, 'up' | 'down' | 'in' | 'out')`, `mindmapSetLayout(index, layout)`; `MindmapCtl.onEdit` hooks and `focusNode(path)` on the handle.
- **Fixture** `tests/fixtures/vaults/mindmap/`: `Pavouk.md` (`[!mindmap|spider]`, five branches, a left-side subtree three deep), `Neznámé metadata.md` (`[!mindmap|foo]`), a regenerated `obsidian-check` note for the recheck.
- **Design** `design/edit-note-page/MindmapLayouts.dc.html`: copied from the canvas; the AP-748 corrections when next touched.

## 4. Order inside the slice

1. **MM2-a layouts** (parser metadata, `spider` layout, the switch, the one-line write): small, independent, ships first as its own preview.
2. **MM2-b map editing** (AP-742…AP-744, AP-746): the editor commands, then the map's keys and the in-place field.

Both follow the per-slice loop (ACs → contract → red tests → implementation → `./verify push` → explorer → preview) and the D-61 rules.
