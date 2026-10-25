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
