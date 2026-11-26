# Slice MM Interface Contract (mindmaps)

- **Status:** draft, 2026-10-25. Written before the slice MM red tests (D-61), from `docs/acceptance/mindmap.md` (R90…R94, D-765…D-779) and D-679…D-687.
- **Builds on** [ms1-core.md](ms1-core.md) (`parse`, block kinds), [ms3-shell.md](ms3-shell.md) §13 (the editor, `EditorUi`, R5, R6, the block menu), [ms4-links.md](ms4-links.md) (chip resolution, D-600 chip states).
- **Writes.** Only the editor's ordinary save path writes (one text engine, D-82). Nothing about a map (view, layout, colours) is stored (D-683, D-684).

Until a part is implemented it exists as a stub that compiles and returns a deliberately wrong result (null, an empty tree, an empty layout, `false`), so a test fails on its assertion, not on an import.

---

## 1. `@tegg/doc` (packages/doc)

### 1.1 Block kinds (changes ms1-core `BlockKind`)

- `mindmap` now means a **top-level callout whose type is `mindmap`** (ASCII case-insensitive, `> [!mindmap]`, optional `+`/`-`, optional title) **whose body is exactly one list, or empty** (title line only, D-765). Every other `[!mindmap]` body is `callout` (a hint callout, D-680).
- A ` ```mermaid ` fence whose first non-blank line starts with `mindmap` is `raw` (D-679); other Mermaid fences stay `code`.
- **The body is read on its own (D-765):** for a `mindmap` callout, the lines after the title line, with their `>` prefix removed, are parsed as a document of their own, so an empty item (`> -`) or a numbered list that doesn't start at 1 right after the title is still the body's list. This applies to the callout's kind, to `mindmapTree` (§1.2), to the editor's reading of the block (§3.1) and to the read view. The block's source range and its bytes are unchanged by this rule.

### 1.2 `mindmapTree(raw: string, noteTitle: string): MindmapTree | null`

Exported from `@tegg/doc`. `raw` is one top-level block's source (as `doc.blocks[i].raw`). Returns null unless the block is `mindmap`.

```ts
export type MindInline =
  | { k: 'text'; text: string; marks: ('strong' | 'emphasis' | 'code' | 'mark' | 'delete')[] }
  | { k: 'link'; target: string; alias: string | null; embed: boolean }   // [[…]] and ![[…]] (D-682, D-774: embeds show their chip)
  | { k: 'tag'; value: string }                                          // #tag, without '#'
  | { k: 'break' }                                                       // a hard or soft line break inside the first paragraph (D-774)
  | { k: 'url'; href: string; text: string }                             // an external link
export type MindItem = {
  inline: MindInline[]          // the item's first paragraph (D-774: whole paragraph); [] for an item without text
  checked: boolean | null       // checklist state, null for a plain item
  more: boolean                 // the item holds more than its first paragraph and its nested lists (D-774)
  path: number[]                // index path in the list: [0], [0, 2], … (the outline position of the list item)
  children: MindItem[]          // items of every list directly inside the item, in file order (D-774)
}
export type MindmapTree = {
  title: string | null          // the callout title (trimmed), null when empty
  typeSpelling: string          // `mindmap`, `MindMap`, … as written
  fold: '' | '+' | '-'
  ordered: boolean              // the list is numbered (numbers are not shown, D-774)
  items: MindItem[]             // top-level items; [] in the empty state (D-681)
  root: MindRoot
}
export type MindRoot =
  | { kind: 'item'; item: MindItem }                     // exactly one top-level item
  | { kind: 'synthesized'; text: string }                // several: the title, else `noteTitle` (D-681)
  | { kind: 'empty' }                                    // no item
```

NFC: every text is returned in NFC (FR-FMT-12). CRLF is accepted.

### 1.3 Wrap and unwrap (D-767)

`@tegg/doc` exports the byte transforms the editor uses, so they are testable at L1 without ProseMirror:

- `wrapMindmap(blocksRaw: string[], gaps: string[]): string` — one list: each line prefixed with `> ` (`>` alone for blank lines), after the line `> [!mindmap]`; paragraphs and headings: one bulleted item each (`> - <inline text>`; a heading loses its `#`s), after `> [!mindmap]`. `gaps` are the separators between the given blocks (dropped). Output has no trailing newline (a block's range never includes it).
- `unwrapMindmap(raw: string, to: 'bulletList' | 'orderedList' | 'checklist' | 'keep'): string` — removes the callout: a non-empty title becomes a paragraph followed by a blank line; the list lines lose one `> ` / `>` prefix; `keep` keeps the list's markers, the others re-mark the top-level and nested items as `-`, `1.`, `- [ ]` (W6, W8, W8a).

---

## 2. Layout (app/ui/src/mindmap/layout.ts)

Pure, deterministic, no DOM (D-683, D-777: L1 golden tests).

```ts
export type Measure = (text: string) => number            // px width of `text` on one line at the node font (13 px)
export type MindLayoutNode = {
  id: string                    // 'root' for a synthesized or empty root, else the item's path joined by '.' ('0', '0.2', …)
  depth: number                 // root 0
  x: number; y: number; w: number; h: number
  lines: string[]               // the wrapped text lines (chips count as one unbreakable word, see `chipExtra`)
  tone: 'root' | 'blue' | 'orange' | 'purple' | 'teal' | 'green' | 'yellow' | 'red' | 'plain'
}
export type MindConnector = { from: string; to: string; points: [number, number][] }   // elbow polyline, R92
export type MindLayout = { width: number; height: number; nodes: MindLayoutNode[]; connectors: MindConnector[] }

export type ChipExtra = number | ((r: MindInline & { k: 'link' | 'tag' }) => number)
export function layoutMindmap(tree: MindmapTree, measure: Measure, opts?: { chipExtra?: ChipExtra }): MindLayout
export const PALETTE: readonly ['blue', 'orange', 'purple', 'teal', 'green', 'yellow', 'red']
export const textMeasurer: Measure   // the test Measurer of R92: 7 px per Unicode scalar value of the NFC text
```

- Geometry exactly as R92 (padding 10, line 18, height 14 + 18 × lines, width clamp(text + 20, 48, 200), wrap within 180, columns +60, rows +8, elbow at x(d + 1) − 30). `nodes` are in outline order with the root first. Node text for wrapping: the inline runs as plain text (link chips: alias or the target's last path segment without `.md`, tag chips `#value`, `break` forces a new line), plus ` …` when `more`.
- `chipExtra` (default 0) adds that many px to the width of each link or tag word (or a per-chip amount, for a task chip's due · status suffix), so the app's real measurer can account for a chip's icon, padding and suffix. The golden values use 0.
- Every call increments `layoutCount()` (exported; read by the L5 test hook below).

---

## 3. Editor (`@tegg/editor`)

### 3.1 Reading and writing the block

- A `mindmap` callout loads as the existing `callout` node (`calloutType` as written) holding `calloutTitle` and one list node; an empty-state block loads with one empty `bulletList > listItem > paragraph` so the caret has an item (D-765). Saving writes the bytes of R93: an empty single item is never written (`> [!mindmap]` alone, W1), the title line keeps the type spelling and fold marker, an empty title writes no trailing space (W9b), and the list follows the title line directly (no blank `>` line) when it starts with a non-empty item.
- Unchanged blocks keep their bytes (FR-FMT-07); an edited mindmap block is rewritten whole (D-766).

### 3.2 Commands (TeggEditor.commands)

- `turnInto('mindmap')` — D-767/D-768 wrap of the current block or block selection; returns false where `Mindmap` isn't offered.
- `turnInto('bulletList' | 'orderedList' | 'checklist')` on a mindmap block unwraps it (W6, W8, W8a); `setCalloutType(t)` on it changes only the type (W7); `setCalloutType('mindmap')` on another callout changes only the type (W10).
- `insertBlock('mindmap')` — W1, caret in the (unsaved) empty item, view List.
- `mindmapView(view: 'map' | 'list'): boolean` — switches the mindmap block holding the caret (or the focused map); false elsewhere. Map → List puts the caret at the end of the root item (the first item for a synthesized root).
- `canTurnIntoMindmap(): 'yes' | 'disabled' | 'no'` — for the block menu (D-768).

### 3.3 `EditorUi.mindmap?(dom, ctl): MindmapHandle | null`

The editor's callout node view, for a `mindmap` block, renders the header (R91: icon, title, `Mindmap view` with `Map` / `List`, the fold button) and asks the app to draw the map into a container:

```ts
export type MindmapCtl = {
  markdown: () => string                   // the block's current Markdown; the app reads it with mindmapTree (§1.2), adding the note title
  view: () => 'map' | 'list'
  onNode: (path: number[] | null) => void  // a node click or ⏎ (null: the synthesized or empty root) → List with the caret (D-776)
  onLink: (target: string) => void         // a chip in a node
  readOnly: boolean                        // true in the read view and in a read-only note (no view switch)
}
export type MindmapHandle = { update(): void; focusTree(): void; destroy(): void }
```

`ui.mindmap` returns null when the app has no map (the block then shows its list only). The `placeholder` kind type loses `'mindmap'` (R5 is `query` only).

The view state lives in memory in the app per `(note path, block index)` (D-776), via `EditorUi.mindmapState?: { get(key: string): 'map' | 'list' | undefined; set(key: string, v: 'map' | 'list'): void }`; the key is the block index as a string (the app adds the note path). `EditorUi.mindmapText?(key, title?)` gives R94's texts (`figure`, `untitled`, `view`, `map`, `list`, `empty`, `notOneList`, `expand`, `collapse`) and `EditorUi.mindmapIcon?()` the icon. The figure carries `data-callout="mindmap"` and class `mindmap-block`; its list is `.mindmap-list` (the editable content) and the map `[data-map-area]`.

---

## 4. App UI

- `app/ui/src/mindmap/MindmapMap.tsx` — the React map: R91 roles (`tree` `Map of <title>`, `treeitem`s with `aria-level`, `aria-setsize`, `aria-posinset`, descriptions `More in the list`, `Checked` / `Not checked`), R92 look, chips from the read view's chip components (D-600 states), keyboard of D-770.
- `app/ui/src/mindmap/fromMarkdown.ts` — the read view's tree is `mindmapTree(block raw, note title)` (§1.2).
- Read view (`ReadView.tsx`): a `mindmap` block is the R91 `figure` with the map only (no view switch); a hint callout is the ordinary callout with the mindmap icon and the hint text.
- **Registry (R94):** `slash('mindmap', 'advanced', ['FR-MMP-01'])` built, description key `slash.mindmap.description`; `IN_NOTE_PLACEHOLDERS` = `[query]`; `Turn into` gains `{ label: 'slash.mindmap', kind: 'mindmap' }` after `Checklist`; the `Callout type` submenu is `CALLOUT_TYPES` (13, unchanged) followed by `mindmap`.
- **Commands (R4, section `edit`, `needsVault: true`, no shortcut):** `mindmap.showMap` (`cmd.mindmap.showMap`), `mindmap.showList` (`cmd.mindmap.showList`); the `Map` and `List` buttons carry `data-command` of these ids.
- **Catalog keys:** exactly R94's list; `ph.mindmap` is removed.
- **Test hooks (L5):** `window.__TEGG_MINDMAP_LAYOUTS__` — the number of layouts computed so far (AC-6); the perf mark `mindmap-layout` with `TEGG_PERF_LOG` (AC-14).
- **DOM data:** the figure has `data-mindmap` and `data-view="map" | "list"`; each `treeitem` has `data-node` = the layout node id and `data-tone` = its tone; the map area has `data-map-area`; connectors are SVG `path`s with `data-from` / `data-to`.

---

## 5. Not in this slice

Editing on the map, collapse, zoom, pan, drag, export, node → object (D-687, D-778), Mermaid conversion (D-679).

---

## 6. Slice MM2: editing on the map and the layouts (D-785…D-795)

- **Status:** draft, 2026-10-26. Written before the slice MM2 red tests (D-61), from `docs/acceptance/mindmap.md` part two (R95…R98, D-785…D-795).
- **Writes.** Still only the editor's save path (D-82). A map edit is an editor command on the block's list (D-786); a layout switch rewrites the title line only (D-791). The layout *name* is the one new thing in the file; positions, sides and colours are never stored.

Until a part is implemented it exists as a stub that compiles and returns a deliberately wrong result (`meta: null`, `layout: 'right'`, unchanged bytes, no `side`, `false` / `null`), so a test fails on its assertion, not on an import.

### 6.1 `@tegg/doc`

- **`calloutHead(raw)`** gains `meta: string | null`: the text between `|` and `]` of the callout marker, as written (`[!mindmap|spider]` → `'spider'`, `[!Mindmap|SPIDER]+` → `'SPIDER'`, `[!note|wide]` → `'wide'`, `[!mindmap|]` → `''`, no `|` → `null`). The `type` is the text before `|`. Recognition (R90, `isMindmapBlock`, `isMindmapHint`) uses the type only, so metadata changes no kind. Every callout's metadata is preserved by the parser and the serializer (FR-FMT-07; the editor's callout node keeps it as the attribute `calloutMeta`, written back byte for byte).
- **`MindmapTree`** gains `layout: 'right' | 'spider'` (`spider` when `meta` lower-cased is `spider`, else `right`) and `meta: string | null` (as written).
- **`setMindmapLayout(raw: string, layout: 'right' | 'spider'): string`** — the byte transform of W12…W13: rewrites only the title line of a mindmap (or hint) callout: `spider` writes `|spider` after the type (replacing any metadata); `right` removes the `|…` part. The type spelling, fold marker, title and every other byte are unchanged; the result equals `raw` when nothing changes. For a non-callout block it returns `raw`.

### 6.2 Layout (`app/ui/src/mindmap/layout.ts`)

```ts
export type MindLayoutNode = { …; side?: 'left' | 'right' }                 // spider: every node under a first-level branch; absent on the root and in `right`
export type MindLayout = { …; layout: 'right' | 'spider' }
export function layoutMindmap(tree: MindmapTree, measure: Measure, opts?: { chipExtra?: ChipExtra; layout?: 'right' | 'spider' }): MindLayout
```

- `opts.layout` defaults to `tree.layout`. `right` is unchanged (R92, `side` absent). `spider` is R96: sides by position in outline order (1st, 3rd, … `right`; 2nd, 4th, … `left`), the left side mirrored (column right edges, nodes right-aligned, connectors from the parent's left edge to the child's right edge, the elbow at the child column's right edge + 30), the sides stacked independently and centred (the taller from y = 0, the other shifted by (H − h) / 2, the root at (H − root h) / 2). `nodes` stay in outline order, root first; tones stay R92's. Every call still increments `layoutCount()`.

### 6.3 Editor (`@tegg/editor`)

**The callout node** gets the attribute `calloutMeta: string | null` (6.1), loaded and saved unchanged.

**`MindmapCtl`** (§3.3) gains:

```ts
layout: () => 'right' | 'spider'                       // the block's stored layout (D-791)
edit: MindmapEdit | null                               // null when readOnly (the read view, a read-only note): navigation only (D-786)
export type MindmapEdit = {
  source(path: number[]): string | null                // the item's first paragraph as Markdown source (R95a); null for a missing path
  setText(path: number[], markdown: string): boolean    // replaces the first paragraph's inline content (W17, W17a, W22); false when unchanged or missing
  insert(at: number[] | null, where: 'sibling' | 'child', markdown: string): number[] | null
                                                        // D-787: `sibling` after `at` (root item → first child; `at === null`, the synthesized root → a new top-level item at the end);
                                                        // `child` at the end of `at`'s children. Inserted with its text in one step (D-795: an empty node is never in the document);
                                                        // returns the new item's path, null when `markdown` is empty or `at` is missing
  remove(path: number[]): number[] | null               // D-787: a node without children only; returns the path to focus (the previous sibling, else the parent); null otherwise
  move(path: number[], dir: 'up' | 'down' | 'in' | 'out'): number[] | null
                                                        // W19…W21: among siblings, under the previous sibling (last child), after the parent; null when impossible (first/last, first child, first-level `out`, the root)
  undo(): boolean; redo(): boolean                      // the editor's history, callable with the map focused (D-786)
}
```

Each `MindmapEdit` call is one editor transaction on this block (one undo step, D-766's rewrite, R93/R98 bytes) and leaves the view in Map; the editor calls `handle.update()` at once (no 150 ms wait, D-786) and the map keeps its focus on the path the call returned. Paths are the tree's item paths (`MindItem.path`); after a call the app re-reads the tree.

**`MindmapHandle`** gains `focusedNode(): number[] | null | undefined` — the focused node's path (`null`: the synthesized root; `undefined`: no node has the focus), for D-794.

**Commands (`TeggEditor.commands`)**: `mindmapLayout(layout: 'right' | 'spider'): boolean` — on the mindmap block holding the caret or the focused map (as `mindmapView`): writes 6.1's transform as one undo step (W12…W12d); false elsewhere or when already so. `mindmapView('list')` with a focused node (the handle's `focusedNode()`) puts the caret at the end of that node's item's first paragraph; otherwise as §3.2 (D-794).

**The header** (R97): a `radiogroup` `Mindmap layout` left of the view switch, two `radio` buttons with `data-layout="right" | "spider"`, `aria-checked`, `data-command="mindmap.layoutRight" | "mindmap.layoutSpider"`, one Tab stop with ← / → moving the check (and switching); absent when `readOnly`. The figure carries `data-layout`. `EditorUi.mindmapText` gains the keys `layout`, `layoutRight`, `layoutSpider`, `editNode`.

### 6.4 App UI

- `MindmapMap` takes `layout`, `edit` (the ctl's `MindmapEdit`, null when read-only) and `onFocusedNode`; it renders `data-side` on each `treeitem`, the keys of R95 (spider ← / → by `side`), the text field of R95a (a `textbox` `Edit node`, `data-node-editor`, inside the focused `treeitem`; Esc / ⏎ / Tab / ⇧Tab / blur per R95a) and the pending node of D-795 (a `treeitem` with `data-node="pending"` holding the field until the first non-empty commit, which calls `edit.insert`). ⌘Z / ⇧⌘Z on the tree call `edit.undo()` / `edit.redo()`.
- `mount.tsx` passes `ctl.layout()` and `ctl.edit` through and draws at once when `update()` follows an edit (the editor marks it: `handle.update({ now: true })` is allowed; the handle's `update` takes an optional `{ now?: boolean }`).
- **Commands (R4, section `edit`, `needsVault: true`, no shortcut):** `mindmap.layoutRight` (`cmd.mindmap.layoutRight`, action `mindmapLayoutRight`), `mindmap.layoutSpider` (`cmd.mindmap.layoutSpider`, action `mindmapLayoutSpider`) → `commands.mindmapLayout(...)`.
- **Catalog keys (R97):** `mindmap.layout` `Mindmap layout` · `mindmap.layoutRight` `Branches to the right` · `mindmap.layoutSpider` `Spider: branches on both sides` · `mindmap.editNode` `Edit node` · `cmd.mindmap.layoutRight` `Mindmap layout: right` · `cmd.mindmap.layoutSpider` `Mindmap layout: spider`.
- Read view: `ReadView` draws the tree's `layout`; no switch, no field, `edit` null.
- **Test hooks:** none new; `__TEGG_MINDMAP_LAYOUTS__` and `mindmap-layout` as §4.

### 6.5 Not in this slice

Drag, collapse, zoom, pan, node → object, export, full screen, autocomplete on the map, a vault default layout (D-785).

### 6.6 Interface details settled while writing the red tests (no owner decision needed)

- **`EditorOptions.editable?: boolean`** (default true): false creates a read-only editor (ProseMirror `editable`), the L1 way to a `readOnly` `MindmapCtl` with `edit: null`. `MindmapCtl.layout` and `.edit` are required (never undefined).
- **`MindmapCtl.onNode(path)`** keeps D-776's behaviour (List with the caret at the end of the item's first paragraph; the synthesized root: the end of the title, else the start of the first item, D-771): the empty-state button uses it (D-793) and `List` with a focused node goes through the same placement (D-794). The map no longer calls it on a node click (D-788).
- **`mindmapView('list')`** with `focusedNode() === null` (the synthesized root focused): the caret goes where `onNode(null)` puts it.
- **`setMindmapLayout`** when the layout is already the one asked for (`|spider` or `|SPIDER` and `spider`; no metadata or unknown metadata and `right`): returns `raw` unchanged, so the UI's "choosing the checked radio writes nothing" holds at every level; `|foo` + `right` is also the identity (D-791: unknown metadata is preserved until the user switches to the other layout).
- **Spider with one side only** (every first-level branch on the right, as with a single branch): the root's x is 0, as in `right`; with a left side only, the root's x is the left columns' width + 60 and the layout's width is the root's right edge.
- **Catalog keys** are §6.4's (`mindmap.layoutRight`, `mindmap.layoutSpider`); R97 is corrected to them. Pavouk has 8 nodes (README corrected).
- **A pending node after undo:** when ⌘Z removes the node that had the focus (W15 undone), the focus goes to the node the tree's roving stop falls back to (its previous sibling, else the parent); redo focuses the restored node.

### 6.7 Settled while building (no owner decision needed)

- **A save redraws the document** (the frontmatter attribute changes, so ProseMirror rebuilds every node view). The re-created mindmap view **adopts the previous view's live map**: `MindmapHandle.adopt(dom)` (called after `destroy()`, in the same task) moves the map's DOM into the new container and cancels the unmount; the handle's control already resolves to the live view. The map keeps its focused node and an open field; `focusTree()` focuses the open field, else the roving node; a focused layout radio is focused again in the new header.
- **`leafText` on link chips:** the editor sets ProseMirror's `leafText` on `wikiLink` at creation (TipTap's node config has none), so an item's `textContent` reads `Lisabon` for `[[Lisabon]]` (the caret helpers of D-794).
- **A straight connector** (a zero-height path, Beta → B1 in Pavouk) gets a `l0 0.01` tail in its `d`, so it has a bounding box; its four points are unchanged.
- **Undo focus (R95):** the map records each of its edits as a (before, after) pair of paths; ⌘Z focuses the `before` path of the last map edit, ⇧⌘Z the `after` path; other undo steps fall back to the roving node.
- **R96 golden values corrected:** `Delta` is 5 characters (55 px), so the left depth-1 column of Pavouk is 55 px wide (the criteria's first numbers held an arithmetic slip; the layout code follows R92 unchanged).
- **`EditorOptions.editable`** is passed to ProseMirror as given; the stubs' `initialFocus` / `initialEditing` idea was dropped for the adoption above.
- **After the QA review of PR #76:** `adopt(dom)` returns false for a map that is still live or whose root is already unmounted (then a new map is mounted), and a destroyed view drops its registry entry in a microtask, so a block re-created in a later task never adopts a dead map (regression test `bug_mm2_fr_mmp_02_unwrap_then_undo_draws_the_map_again_without_errors`). `remove()` returns `[]` for the synthesized root (the first top-level item had no previous sibling); `toItem([])` and the map treat it as the root. `source()` returns the paragraph re-serialized by the one text engine (`**bold**` for `__bold__`), not the file's bytes; an unchanged commit still writes nothing (content equality). `leafText` also reaches the mindmap header title and ProseMirror's plain-text clipboard, which now carry a link's label. The undo-focus bookkeeping assumes the undone step is the map's last edit; a List-view edit in between desyncs the focus only, never the bytes.

---

## 7. Slice MM3: navigation, folds, the mouse `+` and drag and drop (D-2600…D-2608, D-2612…D-2624)

- **Status:** draft, 2026-11-25. Written by the red-test author before the slice MM3 red tests (D-61), from `docs/acceptance/mindmap.md` part three (R229…R233). The points marked *RT-n* are the red-test author's proposals, listed in the red-test report for the owner.
- **Writes.** Still only the editor's save path (D-82). A drop is one editor transaction on the block's list (the bytes of the ⌥ moves, D-766). Folds are never written, never undo steps, never in `ui-state.json` (D-2601).

Until a part is implemented it exists as a stub that compiles and returns a deliberately wrong result (no `fold` / `plus` on the layout nodes, `null` from the navigation and the drop, an empty fold list), so a test fails on its assertion, not on an import.

### 7.1 Layout with folds (`app/ui/src/mindmap/layout.ts`)

```ts
export type MindFold = { x: number; y: number; folded: boolean; hidden: number }   // the fold control's centre (R230), map coordinates;
                                                                                  // hidden = the node's descendants, all depths
export type MindLayoutNode = { …; fold?: MindFold; plus: { x: number; y: number } } // fold: only on nodes with children (in the tree);
                                                                                  // plus: the `+` centre (the outer edge, vertical centre)
export function layoutMindmap(tree: MindmapTree, measure: Measure,
  opts?: { chipExtra?: ChipExtra; layout?: 'right' | 'spider'; folded?: ReadonlySet<string> }): MindLayout
```

- `folded` holds layout node ids (`'0'`, `'0.1'`, `'root'` for a synthesized root). A folded node is laid out as a leaf (R92 / R96); its descendants are absent from `nodes` and `connectors`. The layout's width is at least the rightmost fold control's centre + 8 (AP-2117). Unknown ids are ignored; without `folded` the layout equals slice MM2's plus the two new fields.
- `fold` sits on the node's elbow point (Shared definitions of part three; the spider root: the right elbow, AP-2114); `plus` on the outer edge (the spider root: its right edge, AP-2118).

### 7.2 Navigation (`app/ui/src/mindmap/nav.ts`, new; RT-1)

```ts
export type MindNavKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End'
export function navigateMindmap(layout: MindLayout, from: string, key: MindNavKey): { focus: string } | { unfold: string } | null
```

Pure, on the laid-out (visible) nodes of 7.1: R229's rows for ↑ ↓ (siblings, then the nearest visible node of the same depth in outline order, D-2612; nothing on a root), Home / End, ← → (R95, by `side` in `spider`); on a folded node, the key towards its children returns `{ unfold: id }` (D-2605, D-2614, D-2615). `null`: nothing happens. The map uses it for its keys.

### 7.3 Fold state of an open note (`@tegg/editor`; RT-2)

`MindmapCtl` gains

```ts
folds: {
  folded(): (number[] | null)[]                    // the folded items' paths in outline order (null: the synthesized root)
  toggle(path: number[] | null): boolean           // folds / unfolds an item with children; false for a leaf or a missing path
  set(path: number[] | null, folded: boolean): boolean
}
```

The editor keeps the set in plugin state, mapped through every transaction, so a fold follows its list item through ⌥ moves, drops, undo and redo (D-2616); it is never part of the document, the saved bytes or the history; it is cleared for a block that is reloaded from an external change, and it ends with the editor (reopening, another vault, a relaunch). Switching the block to List and back clears it (D-2601). The read view has no editor: its map keeps its own fold set while the note is shown.

### 7.4 The drop (`@tegg/editor`; RT-3)

`MindmapEdit` gains

```ts
moveMindmapItem(from: number[], target: number[] | null, zone: 'before' | 'after' | 'child'): number[] | null
```

- `child`: the item becomes `target`'s last child (`target === null`: the synthesized root, the last top-level item); `before` / `after`: `target`'s previous / next sibling. One transaction (one undo step), D-766's rewrite of the block, the same bytes as the ⌥ moves that give the same tree (W23 = W19, W24 = W20, W25 = W21). Returns the moved item's new path.
- Returns `from` without a transaction when the list would not change (AC-49), and `null` without a transaction when the move is impossible: `from` is the root item or missing, `target` is `from` or inside its subtree or missing, `before` / `after` on the root item or on `null`.
- A dropped folded item stays folded (7.3); the app unfolds a folded `target` on a `child` drop.

### 7.5 App UI

- **DOM** (L5): inside each `treeitem` with children a `button` with `data-fold-control`, the name of R230 (`Collapse <node>`, `Expand <node>, <n> hidden`), `tabindex="-1"`, `data-command="mindmap.toggleFold"`; the visible `+<n>` text while folded. On an editable map, inside each `treeitem` a `button` with `data-add-child`, name `Add child to <node>`, `tabindex="-1"`, `data-command="mindmap.addChild"`, `visibility: hidden` unless its node is hovered or focused (absent or hidden while editing). The `treeitem`'s own accessible name stays the node text (the buttons don't add to it, e.g. through `aria-labelledby` on the text). `aria-expanded` on `treeitem`s with children.
- **Drag** (DOM data, the "drag-state hook" of the criteria): while a drag runs the figure has `data-dragging="<node id>"`, the dragged node's place has `data-drag-origin` (the dashed `muted` outline), the copy following the pointer has `data-drag-ghost` (`aria-hidden`), and the indicator is one element `[data-drop-indicator]` with the value `before` / `after` / `child` and `data-drop-target="<node id>"` (absent when there is no valid zone). Nothing of it is left after the drop or cancel.
- **Commands (R4, section `edit`, `needsVault: true`, no shortcut):** `mindmap.toggleFold` (`cmd.mindmap.toggleFold`), `mindmap.addChild` (`cmd.mindmap.addChild`); both act on the focused node of the mindmap holding the focus and do nothing elsewhere (no error).
- **Catalog keys (R233):** `mindmap.collapseNode` `Collapse {node}` · `mindmap.expandNode` `Expand {node}, {count} hidden` (a plural message: `one` / `few` / `many` / `other`, D-133) · `mindmap.hiddenCount` `+{count}` · `mindmap.addChild` `Add child to {node}` · `cmd.mindmap.toggleFold` `Fold or unfold mindmap node` · `cmd.mindmap.addChild` `Add child to mindmap node`.
- **Perf mark** `mindmap-drag` (with `TEGG_PERF_LOG` and in L5 through `perf_mark`): one per painted indicator move, `{ ms }` = pointer event to paint; `mindmap-layout` as §4 also for fold re-layouts.
- **Test hooks:** `__TEGG_MINDMAP_LAYOUTS__` as §4; no new hook.

### 7.6 Not in this slice

Zoom, pan, auto-scroll while dragging (D-2621), drops between blocks or out of a map, folds on the phone (D-2622), folds remembered across visits (D-2601), node → object, export.

### 7.7 MM3 follow-up (D-2672…D-2676; `docs/acceptance/mindmap.md` part four)

- **7.1 changes:** `fold` sits on the node's outer edge at its vertical centre (the spider root: its right edge); `plus` on a node with `fold` is 24 px beyond the outer edge (right + 24, spider left side − 24), on a leaf the outer edge as before. The layout's extent covers every `fold` and every `plus` of a node with `fold` (centre ± 8); a negative left shifts the drawing right (R234 golden values). The types don't change.
- **7.2 changes:** in `spider`, ↑ / ↓ consider only nodes with the focused node's `side` (siblings, then the same depth in outline order); `right` is unchanged.
- **7.5 changes:** no connector stub for a folded node; the node's hover covers a strip on its outer side wide enough to reach its fold control and `+` (bug #170); the key `e` / `E` without ⌘, ⌃, ⌥ on a node does what F2 does (R235), the keydown is consumed so no `e` reaches the field.
