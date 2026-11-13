# Contract: the Outline, tab and edge rail (v1.0 slice OL)

**Status: accepted, 2026-11-13, written before the slice OL red tests.** The owner accepted contract points CP-1…CP-14 (§14) as proposed ("Accept all 14"): D-1628…D-1641 (BRD v1.176; CP-n → D-(1627 + n)).

Public interfaces of slice OL, for the test author (D-61) and the build. ACs: `docs/acceptance/outline.md` (R170…R177;
FR-EDT-11 AC-1…AC-21, FR-EDT-16 AC-1…AC-14, FR-NAV-03 AC-15, AC-16, FR-NAV-05 AC-4, AC-5 and the changed AC-1 of
inbox.md, FR-STO-07 AC-7, AC-8, FR-SYN-06 AC-46, FR-UX-03 AC-45…AC-47, FR-UX-08 AC-21, AC-22, FR-UX-05 AC-22,
NFR-OTH-02 AC-19, NFR-PERF-06 AC-6, FR-FMT-12 AC-10, FR-SET-02 AC-10). Decisions: AP-1400…AP-1427, accepted as proposed:
D-1600…D-1627 (BRD v1.175; AP-14xx → D-16xx, same last two digits). Boards: `design/edit-note-page/Outline.dc.html`,
`OutlineDark.dc.html` (A–D, E1–E4, V1–V11), prototype `outline-rail-prototype.html` (its script is the reference for the
rail's constants and row rule). Fixture: `tests/fixtures/vaults/outline/` (its README has every expected row and rail
row). Precedents: the Graph tab in the panel ([v1-graph.md](v1-graph.md) §15, §17), machine-local state as page width
and [v1-pinned.md](v1-pinned.md) §4, history as [ms3-shell.md](ms3-shell.md) §12.1, the editor as §13.

OL adds **no IPC command, no event and no Rust code** (the perf line of §8 uses the existing `perf_mark`). It **writes
nothing to the vault** (§9). Its only write is `ui-state.json` in Application Support, through `ui_state_set` (§5).
The heading list is computed in the UI from the text the centre pane shows; there is no L4 part.

## 1. The heading list (`@tegg/doc`, AR-03; D-1604…D-1606, D-1611, D-1615, D-1625)

A new module `packages/doc/src/outline.ts`, exported from `packages/doc/src/index.ts`. Pure TypeScript over `parse()`:
no DOM, no app import, no editor import (AR-03 AC-2). FR-LNK-06 resolves `#Heading` with the same list (§1.5).

### 1.1 Types

```ts
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/** One heading the outline lists (R171). Offsets are UTF-16 code units into the `text` given (the whole file text,
 *  frontmatter and BOM included), i.e. the mdast heading node's own position: after any indentation and container
 *  markers (`> `, `- `); ATX: the line without its EOL (closing `##` included); setext: the text line through the end
 *  of the underline. */
export type OutlineHeading = { level: HeadingLevel; text: string; from: number; to: number };

/** A heading in the tree (R171 rule 5, R176). Indexes are positions in the `outlineHeadings` array. */
export type OutlineNode = OutlineHeading & {
  index: number;
  depth: number;            // 1 + number of ancestors
  parent: number | null;    // nearest earlier heading with a lower level
  children: number[];       // in note order
  descendants: number;      // all headings below it (the collapsed row's count, D-1612)
  key: string;              // foldKey (R171 rule 6)
};
```

### 1.2 Functions

```ts
export function outlineHeadings(text: string): OutlineHeading[];      // parses once
export function outlineHeadingsOf(doc: Doc): OutlineHeading[];        // the same from a parsed Doc (no second parse)
export function outlineTree(headings: readonly OutlineHeading[]): OutlineNode[];
export function foldKey(level: HeadingLevel, text: string, n: number): string;   // `${level}:${text.normalize('NFC')}#${n}`
export function railDepth(tree: readonly OutlineNode[], max?: number): number;   // X of R173, max = RAIL_MAX_ROWS = 20
export function railRows(tree: readonly OutlineNode[], current: number | null,
                         tempOpen?: ReadonlySet<number>, max?: number): number[];
export function headingForFragment(headings: readonly OutlineHeading[], fragment: string): number | null;
export const RAIL_MAX_ROWS = 20;
```

**`outlineHeadings`** walks `doc.blocks` and, inside each, the mdast children (R171 rules 2–4, D-1604, D-1605):

| Node | Rule |
| --- | --- |
| `heading` (ATX or setext) | listed, unless its text (rule 4) is empty (`#`, `##`, `## %%c%%`) |
| `blockquote`, `list`, `listItem` | descended into, at any nesting (callouts folded or not, plain quotes, list items) |
| a top-level block or nested `blockquote` whose first line is a `[!mindmap…]` callout head (`calloutHead(raw).type`, any case; D-679) | skipped whole, whether or not `isMindmapBlock` holds |
| `code` (fenced, indented, `query`, plugin fences), `html`, `math`, `footnoteDefinition`, `definition`, `table` | skipped |
| top-level blocks of kind `raw`, `embed`, `query`, `mindmap` | skipped (an embed's target is never read) |
| a `%%` comment region (CP-1) | every heading starting inside it is skipped |
| frontmatter | never seen: `parse` starts the body after it (YAML comments included) |

Text (rule 4): the heading's inline children joined in order: `text` and `inlineCode` → their value; `strong`,
`emphasis`, `delete`, `highlight`, `link` → their children's text; `wikiLink` → the alias after the first unescaped
`|`, else the target as written inside `[[…]]` (CP-3); `image` → its alt; `tag`, `inlineMath`, `html` and any other
inline node → its source slice; `comment` (`%%…%%`) → nothing; `break` → a space. Then a trailing block id
(`/\s\^[A-Za-z0-9-]+$/`) is removed, whitespace runs become one space and the result is trimmed. Characters stay as
written (an NFD heading keeps its NFD text; FR-FMT-12 AC-10). The title (`title:` or the file name) is never a heading;
a body heading with the same text is listed.

Examples from the fixture (offsets as committed):

- **Plán:** 11 headings, `[0]` = `{ level: 1, text: 'Cíle', from: 216, to: 222 }`, `[4]` = `{ 2, 'Den 1', 1766, 1774 }`,
  `[10]` = `{ 2, 'Rozpočet', 4095, 4106 }`.
- **Okraje:** the README's 11, `[0]` = `{ 1, 'Nadpis podtržený', 187, 220 }` (setext), `[2]` =
  `{ 2, 'Tučný začátek, odkaz a kód', 306, 366 }`, `[3].text` = `'Oddíl s blokem'`, `[5]` = `{ 3, 'Skrytý nadpis', 560,
  577 }`, `[10]` = `{ 2, 'Poznámky', 902, 913 }`. Not listed: `#` (416), `##` (419), `## Kořen mapy` (671, mindmap),
  `# Nadpis v komentáři` (757, `%%` region).
- **L1 strings** (FR-EDT-11 AC-3): `## a  **b**   c ` → `a b c`; `## [text](https://example.com)` → `text`;
  `## #projekt plán` → `#projekt plán`; `## x %%skryté%% y` → `x y`; `## <b>tučně</b>` → `<b>tučně</b>`;
  `## $x^2$` → `$x^2$`; `## [[A|b]] ^id1` → `b`; `## [[A#B]]` → `A#B`.

**`outlineTree`** (rule 5): parent = nearest earlier heading with a lower level; depth = 1 + ancestors. Přeskočené:
depths 1, 1, 2, 2, 3 (`Hluboko` H6 under `Zpět na dvojku` H2). Architektura: depth = level. `key` = `foldKey(level,
text, n)`, n counting headings with the same level and NFC text up to and including this one: Okraje's three `Poznámky`
are `2:Poznámky#1`, `3:Poznámky#1`, `2:Poznámky#2`; Plán's `Program` is `1:Program#1`.

**`railDepth`** = the greatest d in 1…6 for which the headings of depth ≤ d number at most `max`; 1 when even depth 1
has more. Čtenářské: 1 (12 at depth 1, 48 at depth ≤ 2). Architektura and Plán: 6 (18 and 11 headings in all).

**`railRows`** (R173, D-1615; the prototype's `visibleRows()` over **depth**): the set S = every heading of depth ≤ X;
plus, when `current` is not null, `current`, its ancestors, the children of each ancestor and `current`'s children;
plus the children of each `t ∈ tempOpen` that is already in S. The result is the indexes of S whose ancestors are all in
S, in note order. Čtenářské (README "Expected rail rows"): 12 with nothing current, 15 with `Replikace`, 16 with
`Zpoždění replikace`, 17 with `Kompromisy`, 15 at the end (`Další čtení`); with `Zpoždění replikace` current and
`tempOpen = {Transakce}`: 19. Architektura and Plán: every index at any `current`. `current` is always the **real**
current section, never the tab's visible ancestor (R172 rule 5, D-1603).

**`headingForFragment`** (D-1625): the first heading whose NFC text equals the fragment (without `#`, NFC) compared case
insensitively, as `scrollToFragment` matches today; null when none. Block fragments (`#^id`) are not headings.

### 1.3 Properties (L2, FR-EDT-16 AC-5)

`packages/doc/test/outline_props.ac.test.ts` generates heading lists directly (levels 1–6, length 0–600, a random
`current` or null) through `outlineTree` over synthetic `OutlineHeading`s (no Markdown needed) and checks AC-5's five
properties. A second property builds Markdown from a random list (`#`×level + text + blank line) and checks that
`outlineHeadings` returns exactly that list (levels, texts, increasing `from`).

### 1.4 Performance

`outlineHeadingsOf` adds one walk over the parsed blocks to `parse`; on `Pages/Pět set nadpisů.md` (500 headings,
~100 KB) `outlineHeadings` takes under 40 ms on the reference machine (L1 benchmark, report-only, §8).

### 1.5 FR-LNK-06 (D-1625)

`pages/NotePage.tsx`'s `scrollToFragment` and the editor's `caretToStart(fragment)` resolve `#Heading` by
`headingForFragment(outlineHeadings(shown text), fragment)` and act on that heading by position, with the outline's
scroll (§3.4 step 4, 24 px) and without the flash. The caret stays where D-247 puts it (the start of the heading). See CP-12.

## 2. Editor additions (`@tegg/editor`, ms3-shell §13.3)

```ts
export interface TeggEditor {
  // … as before …
  /** Slice OL: the outline of the current document, computed now: `outlineHeadings(this.text())` plus, per heading, the
   *  ProseMirror position of the node that renders it and whether that is a heading node (`false`: the heading is
   *  inside a read-only block, e.g. a raw or lossy block; `pos` is then that block). `version` changes with every
   *  doc-changing transaction. */
  outline(): { version: number; headings: OutlineHeading[]; pos: number[]; heading: boolean[] };
  /** `pos` from `outline()` at `version`, mapped through every later edit; null when that node was deleted or is no
   *  longer a heading (a stale row, R172 rule 9). */
  headingPos(version: number, pos: number): number | null;
  /** Opens, as view state only, every folded callout that contains `pos` (R172 rule 3, D-159); writes nothing, no
   *  transaction, no history step. False when nothing was folded. */
  revealPos(pos: number): boolean;
  /** Node decoration `data-outline-flash` on the node at `pos` (null clears it). A decoration only: no doc change, no
   *  history step, `dirty()` unchanged (R172 rule 7). */
  flash(pos: number | null): void;
  /** D-1610, D-112: a function that returns `sel` mapped through every edit since this call; a deleted position maps to
   *  the end of the nearest preceding text block, else the start of the body. Null after `destroy()`. */
  followSelection(sel: { anchor: number; head: number }): () => { anchor: number; head: number } | null;
}
```

- Mapping a heading to its node: the reconciled text's top-level blocks correspond to the editor's top-level nodes in
  order (the `<!-- -->` separators of `Loaded.hidden` have no node); inside a block, the n-th mdast heading is the n-th
  `heading` node in document order. The build may cache per block; `outline()` must equal a fresh computation.
- `outline()` costs one `text()` (reconcile without verify, as the test hook) and one `parse`; nothing is written.

`EditorPaneApi` (`app/ui/src/edit/EditorPane.tsx`) gains:

```ts
  /** Slice OL (§3.4): the jump to a heading of `outline()` at `version`. 'stale' changes nothing. */
  jumpToHeading(version: number, pos: number): 'ok' | 'stale';
  /** Esc in the tree or the card (R174, D-1618): the focus back to the body with its selection; no scroll moves. */
  refocus(): void;
```

## 3. UI (`app/ui/src/outline/`)

### 3.1 Modules

| Module | Owns |
| --- | --- |
| `model.ts` | Pure, L1. Constants (§3.2). `visibleRows(tree, collapsed: ReadonlySet<string>) → number[]` (no collapsed ancestor); `shownCurrent(tree, visible, current) → number \| null` (the current row or its nearest visible ancestor, R172 rule 5); `foldButtons(tree, collapsed) → { expandAll: boolean; collapseAll: boolean }` (expand: some heading with children is collapsed; collapse: some heading with children is not, D-1612); `toggle(tree, collapsed, index, branch: boolean) → string[]` (one row, or ⌥: the row and every descendant with children take the row's new state; result in note order); `allKeys(tree)` (keys of headings with children, note order: Čtenářské's 14); `currentSection(tops, o: { scrolls: boolean; atEnd: boolean }) → number \| null` (R172 rules 1–4: `tops` in viewport coordinates, note order; the last i with `tops[i] ≤ CURRENT_LINE`, else null; `scrolls && atEnd` → the last index); `railGap(n, height) → number \| null` (§3.6); `cardChevrons(tree, rows, tempOpen) → Set<number>` (D-1616: rows with children whose children are not all in `rows`, plus `tempOpen`); `jumpTop(elementTop, scrollTop, max) → number` (`clamp(elementTop + scrollTop − JUMP_TOP, 0, max)`); `countText(n)` (`outline.count`, region grouping). |
| `folds.ts` | Pure, L1 (§5): `noteKey(id, path)`, `foldsOf(ui, vault, key)`, `withFolds(ui, vault, key, keys, valid) → UiState`, `rekeyFolds(ui, vault, from, to) → UiState \| null`, `OUTLINE_NOTES_MAX = 200`. |
| `store.ts` | The one `OutlineSource` of the window (§3.3): `publishOutline(source \| null)`, `useOutline()`, `getOutline()`, the current section (`setCurrent`, `useCurrent()`), the card's open state and `tempOpen`, and the L5 hook (§10). |
| `tracker.ts` | `trackCurrent(scroller: HTMLElement, source)` (§3.5): tops cached per snapshot, recomputed on `scroll` (one rAF), on a new snapshot and on `ResizeObserver` of the note body; publishes `setCurrent`. |
| `jump.ts` | `jump(index, via: 'tab' \| 'rail' \| 'card' \| 'key')` (§3.4): the history entry, the flash timers, closing the card. |
| `OutlineTree.tsx` | The `tree` of R170 for both surfaces: `variant: 'tab' \| 'card'`, rows, roving focus, keys (R174), chevrons, current bar, hover; keyed by `foldKey`, so a relabel replaces one row and the others keep their DOM nodes (FR-EDT-11 AC-7). |
| `OutlineTab.tsx` | The `tabpanel` `Outline`: header (count, `Expand all`, `Collapse all`), the tree in its own scroll container (D-1613), the empty state; folds through `onFolds`. Rendered by `ContextPanel` for `tab === 'outline'` when the `PANEL_TABS` row is built, as `GraphPanel`. |
| `OutlineEdge.tsx` | The rail, the card and the live region, mounted in `App.tsx` inside `div.centre` after `main` on `note/<path>`, `daily/<date>`, `new/<type>`; the hover timers, the fade, geometry from the measured centre pane and `main` (§3.6). |

### 3.2 Constants (`model.ts`)

`REFRESH_MS = 120` (trailing debounce, §8), `CURRENT_LINE = 30`, `END_TOLERANCE = 2`, `JUMP_TOP = 24`,
`FLASH_MS = 2000`, `FLASH_FADE_MS = 300`, `HOVER_OPEN_MS = 150`, `HOVER_CLOSE_MS = 300`, `RAIL_FADE_MS = 150`,
`CHEVRON_MS = 120`, `ROW_H = 26`, `INDENT = 14`, `RAIL_MIN_PANE = 640`, `RAIL_RIGHT = 14`, `RAIL_PAD = [12, 8]`
(vertical, horizontal), `RAIL_LINE = 1.5`, `RAIL_LINE_ON = 2`, `RAIL_GAP = 7`, `RAIL_MIN_GAP = 2`, `RAIL_MARGIN = 48`,
`LINE_W = { 1: 18, 2: 13, 3: 9, 4: 7, 5: 5, 6: 4 }`, `CARD_W = 256`, `CARD_RIGHT = 52`, `CARD_MAX_H = 520`,
`CARD_MAX_VH = 0.8`, `TEXT_CLEARANCE = 44`.

### 3.3 The source: what the outline reads (R171 rule 1, D-1619, D-1620)

```ts
export type OutlineSource = {
  view: 'editor' | 'source';
  /** Fold-state key (§5): the note's `id`, else its vault path in NFC; null for an unwritten `new/<type>` draft (CP-5). */
  key: string | null;
  version: number;                       // editor: TeggEditor.outline().version; source view: the text's load counter
  tree: OutlineNode[];                   // outlineTree(outlineHeadings(shown text))
  /** The rendered element of heading i (editor: the heading node's DOM, or the read-only block holding it; source view:
   *  `.source-line[data-line]` of its first line), or, when that isn't rendered (inside a folded callout), the nearest
   *  rendered block that contains it. */
  element(i: number): HTMLElement | null;
  jump(i: number, version: number): 'ok' | 'stale';
  refocus(): void;
};
```

- `NotePage` publishes it while the editor or the source view shows note text, and `publishOutline(null)` when the page
  shows none (gone, deleted, loading; FR-EDT-11 AC-18) or unmounts. The read view (test fallback, D-215) publishes
  null.
- **Editor:** after each doc-changing transaction (including `reload`, undo, a merge result, the draft's typing) the
  page schedules a refresh `REFRESH_MS` later (restarted by each change); none while `view.composing`, and one
  scheduled at `compositionend`. The refresh calls `ed.outline()` and publishes a new source only if the headings
  changed (deep equality of `level`, `text`, and the order) or their positions changed.
- **Source view:** the file text the view draws (`loaded.text`); a new source on each reload. Line of heading i:
  `1 +` the number of `\n` in `text.slice(0, from)`.
- No IPC: showing the tab or the rail sends nothing (FR-EDT-11 AC-1, AC-7).

### 3.4 The jump (R172, D-1609, D-1610)

`jump(i, via)` in `jump.ts`:

1. `before = { scrollTop: main.scrollTop, caret: noteApi.caret() }`.
2. `source.jump(i, version)`; `'stale'` → nothing else happens (caret and scroll unchanged), the page refreshes the
   outline at once (FR-EDT-11 AC-11), the card stays as it was.
3. Editor: `pos = ed.headingPos(version, pos[i])` (null → `'stale'`); `ed.revealPos(pos)`; the target element's top
   (after the reveal) minus `viewportTop(main)` (§3.5, D-1673) gives `main.scrollTop = jumpTop(…)`, set directly (never `scrollIntoView`, never smooth; the
   centre pane has `scroll-behavior: auto`). Then the focus on the body with `preventScroll` and the selection collapsed at
   the end of the heading node's content (`pos + node.nodeSize − 1`, after a block id the editor shows); the scroll top is
   set again on the next frame (as `caretToStart`). A heading inside a read-only block: CP-2.
4. Source view: the same scroll for the line element; no caret, no selection change, the focus stays where it was.
5. Flash: editor `ed.flash(pos)`, source view the attribute on the line. `data-outline-flash` stays `FLASH_MS`; then
   `data-outline-fade` for `FLASH_FADE_MS` (the CSS transition to transparent), then nothing. Under
   `prefers-reduced-motion: reduce` there is no `data-outline-fade` and `transition-duration: 0s`. A second jump clears
   the first flash at once.
6. `after = { scrollTop, caret }`; when `after` differs from `before` (scrollTop by more than 1 px, or the caret), the
   history gets the entry of §4. `nav_opened` is never called; the route doesn't change.
7. The card closes at once (any `via`); `via: 'tab'`, `'card'`, `'key'` leave the focus in the body (step 3).

CSS (no colour literal): `[data-outline-flash] { background: var(--link-bg); box-shadow: 0 0 0 5px var(--link-bg);
transition: none }`, `[data-outline-fade] { transition: background-color 300ms, box-shadow 300ms }`.

### 3.5 The current section (R172 rules 1–7, D-1608)

- The viewport is `main` (the centre pane's scroller), its top `viewportTop(main)` (`tracker.ts`, D-1673): the bottom
  of the sticky note toolbar (`data-sticky-top`) when it is shown, else `main`'s top. `tops[i] =
  element(i).getBoundingClientRect().top − viewportTop(main)`; `scrolls = scrollHeight > clientHeight`; `atEnd = scrollTop + clientHeight ≥
  scrollHeight − END_TOLERANCE`.
- `tracker.ts` caches each element's offset in the scroll content and binary-searches it on `scroll` (one rAF per
  frame, so within 100 ms of the last scroll event); the cache is rebuilt on a new source, on `ResizeObserver` of the
  note body and after a reveal. The tab, the rail and the card read the one value from `useCurrent()` (rule 7).
- The tab draws `aria-current="location"` on `shownCurrent(…)`; the rail and the card on the current row itself.

### 3.6 Rail and card geometry (R173, D-1614, D-1615)

- **Shown** when all hold: a note route (`isNoteRoute`), a source with ≥ 2 headings, the Outline not on screen
  (`showPanel && rightPanel.tab === 'outline'` in `App.tsx`), the centre pane (`div.centre`, measured by a
  `ResizeObserver`, so a separator drag counts while it moves) ≥ `RAIL_MIN_PANE`, not focus mode, `outlineRail !== false`,
  and `railGap(rows.length, main.clientHeight − RAIL_MARGIN) !== null`.
- **`railGap(n, h)`**: `RAIL_GAP` when `n·RAIL_LINE + (n−1)·RAIL_GAP ≤ h`; else the largest gap ≥ `RAIL_MIN_GAP`
  that fits; else null (no rail). Applied to every row set, not only when depth 1 exceeds 20 (CP-8); see CP-7 for AC-13.
- **Lines:** each line sits centred in a slot of height `RAIL_LINE + gap` (the pointer target, the rail's full width);
  width `LINE_W[level]`, right-aligned; height `RAIL_LINE` in `--faint`, `RAIL_LINE_ON` in `--muted` (ancestors of the
  current section) or `--text` (the current section, the line under the pointer, the line of the card's hovered row).
- **Place:** the rail box (`RAIL_PAD`) has its right edge `RAIL_RIGHT` px left of `div.centre`'s right edge, and its
  vertical centre on `main`'s visible centre; `position: absolute` in `div.centre` (`position: relative`), so it
  never scrolls.
- **Clearance:** while the rail is shown, `div.centre` has `data-outline-rail`, and `.note-column[data-width="normal"]`
  gets `padding-right: 44px` when the pane is narrower than `760 + 2 × 4` px (the column reaches the pane's edge);
  Wide's 56 px already clears. Nothing changes when the rail isn't shown (V1).
- **Card:** `position: absolute` in `div.centre`, width `CARD_W`, right edge `CARD_RIGHT` px left of `div.centre`'s right
  edge, vertically centred on `main`, `max-height: min(520px, 80% of main's height)`, its tree scrolls. Opened by hover,
  the current row is scrolled to the card's middle.
- **Fade:** the rail stays mounted with `data-leaving` and `opacity: 0` for `RAIL_FADE_MS` when the Outline comes on
  screen, then unmounts; it mounts at `opacity: 0` and goes to 1 when the Outline leaves the screen. Both are CSS
  `opacity` transitions (one `CSSTransition` in `getAnimations()`); none under Reduce motion.

### 3.7 DOM (R170, R173, R177; FR-UX-08 AC-21)

| Part | Element | Attributes |
| --- | --- | --- |
| Tab | `button[role=tab]` (existing) | `data-command="panel.outline"`, no `aria-description` (built) |
| Tab panel | `div[role=tabpanel].panel-body.outline-panel` | `aria-label` `tab.outline` |
| Header | `div.outline-header` | `span[data-outline-count]` (`outline.count`); buttons below; absent in the empty state |
| Expand all | `button.icon-button` 24 × 24 | `aria-label` `outline.expandAll`, `title` the same, `data-command="outline.expandAll"`; rendered only when `foldButtons().expandAll` |
| Collapse all | `button.icon-button` 24 × 24 | `aria-label` `outline.collapseAll`, `title` `outline.collapseAllHint`, `data-command="outline.collapseAll"`; only when `foldButtons().collapseAll` |
| Tree | `div[role=tree]` | `aria-label` `outline.tree`; tab: inside `div[data-outline-scroll]` (the scroll container) |
| Row | `div[role=treeitem]` | `data-outline-row="<index>"`, `aria-label` = heading text, `aria-level` = depth, `aria-setsize` / `aria-posinset` among its siblings, `aria-expanded` only with children, `aria-current="location"`, `aria-description` `outline.hidden` when collapsed (tab), `tabindex` 0 on one row else −1, `data-level` = level; `title` = full text (CP-6); `padding-left: 14 × (depth − 1)` px |
| Row text | `span.outline-text` | `data-user-content`; one line, `text-overflow: ellipsis` |
| Chevron | `span.outline-chevron` | `aria-hidden="true"`, `data-outline-chevron`, `title` `outline.collapse` / `outline.expand`; rotation `transition: transform 120ms` (none under Reduce motion) |
| Hidden count | `span[data-outline-hidden]` | `aria-hidden="true"`, `--muted`; collapsed tab rows only |
| Current bar | the row's `::before` | 3 px wide, `--text`, `top: 7px; bottom: 7px; left: 0`; the row's background stays transparent |
| Empty state | `div.outline-empty` | `p[tabindex=-1]` `outline.empty`, `p` `outline.emptyHint` with `{hash}` as `code` `#` |
| Rail | `div[data-outline-rail]` | `aria-hidden="true"`; `data-leaving` while fading out |
| Rail line | `i[data-outline-line="<index>"]` | `data-state="current" \| "ancestor" \| "rest"`, `data-hover` while lit |
| Card | `div[role=dialog][data-outline-card]` | `aria-label` `outline.card`, no `aria-modal`; contains the tree (variant `card`) |
| Live region | `div.sr-live[data-outline-live]` | `role="status"`, `aria-live="polite"`; `outline.empty` on ⌘J with no headings (cleared first, so a repeat is announced again) |
| Flash | the heading element / `.source-line` | `data-outline-flash`, then `data-outline-fade` |
| Centre | `div.centre` | `data-outline-rail` while the rail is shown |

Row type (R170, D-1607): depth-1 level-1 rows 13 px / 500, others 12.5 px / 400, `data-level` 5–6 in `--muted`, the
current row weight 600; in the card the current section's ancestors are 600 too. Hover and keyboard focus:
`--hover` background, no bar, no outline (D-594). Chevron visibility: always on a collapsed row; on an expanded row on
hover or `:focus-visible` only.

### 3.8 Tree behaviour

- **Keys** (R174): handled by `OutlineTree` on `keydown` of the row; each handled key `preventDefault()` and
  `stopPropagation()` (so Esc never also leaves focus mode). Tab into the tab's tree lands on the current row (else the
  first): roving `tabindex`. Card: → on a row with a chevron and hidden children adds it to `tempOpen`; → on a row whose
  children are shown goes to its first child; ← removes a temp open, else goes to the parent; ⏎ jumps; Esc, ⌘J, Tab
  close the card and call `source.refocus()`.
- **Clicks:** the row text jumps; the chevron toggles (⌥: the branch); a `mousedown` in the tree never takes the
  editor's focus away from a hover-opened card (`preventDefault` on `mousedown` in the card).
- **Tab tree scrolling** (D-1613): when the shown current row changes and is not fully inside the scroll container,
  the container's `scrollTop` is set so that the row's centre is at the container's centre (clamped). Nothing happens
  while the pointer is over the container or the focus is inside it; the next change after both have left scrolls again.
  The container never scrolls `main`.
- **Card hover** (R173): `pointerenter` on the rail box starts a `HOVER_OPEN_MS` timer, `pointerleave` cancels it;
  leaving both the rail and the card starts `HOVER_CLOSE_MS`, entering either cancels it. A hover-opened card never
  moves the focus or the selection. A card opened by ⌘J ignores pointer-leave timers until it closes.
- **Closing** (R173): a jump, Esc, ⌘J, Tab, a `mousedown` outside the rail and the card (the click goes on to its target,
  e.g. the editor places the caret), the rail going from shown to hidden, a route change (`go`, `step`), the source
  becoming null. Closing clears `tempOpen`.

## 4. History (ms3-shell §12.1 amended; FR-NAV-03 AC-15, AC-16; D-1610)

`HistoryEntry.caret` (added by the G2 build, v1-graph §15.11) **is** the selection D-1610 names; OL adds no `selection`
field. Changes in `shell/history.ts`:

```ts
/** The editor's selection; `follow` (slice OL) maps it through later edits of the same editor (D-112). */
export type Caret = { anchor: number; head: number; follow?: () => { anchor: number; head: number } | null };
export function createHistory(): {
  // … as before …
  /** Slice OL: a jump's place on the current route. Saves `from` on the current entry, drops the forward entries and
   *  adds `{ route: current route, scrollTop: to.scrollTop, caret: to.caret }`. The current `new/<type>` draft entry is
   *  kept (not popped as `push` does). */
  pushPlace(from: { scrollTop: number; caret: Caret | null }, to: { scrollTop: number; caret: Caret | null }): void;
};
```

- `NotePage`'s `caret()` returns `{ anchor, head, follow: ed.followSelection(sel) }`.
- **A step to an entry with the same route string** (NFC) as the shown route — only `pushPlace` makes such neighbours —
  happens in place: no `flushNote()` (CP-10), no `setNavKey`, no `setRoute`, no `note_read`, no `nav_opened`;
  `noteApi.restorePlace(scrollTop, caret)` sets the selection (`caret.follow?.() ?? caret`, clamped; focus on the body
  with `preventScroll`) and then `main.scrollTop`, in that order, on this frame and the next. In the source view only the
  scroll is restored. `NotePageApi` gains `restorePlace(scrollTop: number, caret: Caret | null): void`.
- Other steps are unchanged (a note shown again by Back is read and remounted; its caret is clamped as today).
- No entry when the jump changes neither scroll nor caret (§3.4 step 6). A jump after Back drops the forward entries.
- The title-bar `Back` is enabled by the new entry (`setHistTick`). Nothing is stored across launches.

## 5. Machine-local state (R176; FR-STO-07 AC-7, AC-8; D-1601, D-1611)

```ts
type UiStateDto = {
  // … as before (version stays 1) …
  /** Slice OL (D-1601): `Show outline rail`; missing reads as true. */
  outlineRail?: boolean;
  vaults?: Record<string, {
    graph?: …; sidebar?: …;
    /** Slice OL (D-1611): per note, the fold keys of its collapsed headings (R171 rule 6), in note order. */
    outline?: { collapsed: Record<string, string[]> };
  }>;
};
```

- The Rust `UiState` keeps unknown top-level fields and `vaults` in its flattened map: no Rust change.
- `noteKey(id, path)` = the note's `id` (NFC), else its vault path in NFC (as page width's `widthKey`). A virtual
  `daily/<date>` uses its path; an unwritten `new/<type>` draft has no key and keeps its folds in page state (CP-5).
- `withFolds(ui, vault, key, keys, valid)`: drops keys not in `valid` (the note's current fold keys of headings with
  children); `keys` empty → the note's entry is deleted; otherwise the entry is deleted and re-inserted last (object order
  = order of last change); then, while more than `OUTLINE_NOTES_MAX` entries, the first is deleted. Nothing else of
  `ui` changes. One `ui_state_set` per user action (a chevron, ⌥-click, `Expand all`, `Collapse all`, ⌥→/⌥←, the
  palette commands, → / ← on a tab row); never on open, never for the card's temporary opens, never for the rail.
- `rekeyFolds(ui, vault, from, to)`: moves `collapsed[from]` to `collapsed[to]` (last place) when `to` has none; null
  when there is nothing to move. `NotePage` calls it in the same effect and the same `updateUi` as the page-width
  re-key, so the first `Saved` that gives the note an `id` sends one `ui_state_set` (FR-STO-07 AC-7).
- An entry's keys matching no heading are kept until that note's next fold write (rename, AC-14).
- `outlineRail` is written by the Settings switch and `Toggle outline rail` (one `ui_state_set` each).
- The vault key is `vault.path.normalize('NFC')`, as `graph` and `sidebar` (D-993).

## 6. Registry, commands, shortcuts, strings (R175, R177; D-1617, D-1618, D-1624)

- `PANEL_TABS` row `outline` becomes `{ id: 'outline', name: 'tab.outline', status: { built: true, due: { milestone:
  'v1.0' } }, reqs: ['FR-EDT-11', 'FR-NAV-05'] }` (app-shell R2).
- `SHORTCUTS` gains `{ keys: '⌘J', command: 'outline.jump' }` after `⇧⌘G` (app-shell R4 gains the row at the same
  place). `shortcutGroups.ts`: `groupOf` puts `outline.*` in `navigation` and `ROUTE_TITLES` gains `'outline.jump':
  'cmd.outline.jump'`, so `help/shortcuts` lists it under `Navigation` from any route (FR-UX-03 AC-45).

| Id | Title key | Section | Shortcut | Listed |
| --- | --- | --- | --- | --- |
| `panel.outline` | `cmd.outline.show` | `view` | — | `note/<path>`, `daily/YYYY-MM-DD`, `new/<type>` (as `panel.graph`) |
| `outline.jump` | `cmd.outline.jump` | `view` | ⌘J | the same routes |
| `outline.expandAll` | `cmd.outline.expandAll` | `view` | — | `ctx.outline?.canExpandAll` |
| `outline.collapseAll` | `cmd.outline.collapseAll` | `view` | — | `ctx.outline?.canCollapseAll` |
| `outline.toggleRail` | `cmd.outline.toggleRail` | `view` | — | always (`needsVault: true`) |

```ts
// shell/commands.ts
export type ShellContext = {
  // … as before …
  /** Slice OL: present only while the Outline is on screen (the panel shown on the `outline` tab, with a source). */
  outline?: { canExpandAll: boolean; canCollapseAll: boolean } | null;
};
export type ShellActions = {
  // … as before …
  showOutline?: () => void;       // panel.outline: one ui_state_set (open: true, tab: 'outline'); focus §6.1
  outlineJump?: () => void;       // outline.jump, §6.1
  outlineFold?: (all: 'expand' | 'collapse') => void;
  toggleOutlineRail?: () => void;
};
```

`App.tsx` keeps the tab's `foldButtons` result in state (set by `OutlineTab` through `onStatus`), passes it as
`ctx.outline` and adds it to the `commands(ctx)` memo's dependencies.

### 6.1 What the commands do

- `panel.outline`: on a note route, `updateUi` with `rightPanel: { …, open: true, tab: 'outline' }` (one write; none
  when already so), then the focus on the tab's current row, else the first row, else the empty state's `p[tabindex=-1]`.
- `outline.jump` (D-1617), in this order: the card open → close it (§3.8). No source → nothing. 0 headings → the
  live region says `outline.empty`, nothing else (also with the Outline on screen). The Outline on screen → the focus
  on the tab's current row (else the first). Otherwise → the card opens at its place (rail shown or not), focus on its
  current row (else the first); the element focused before is remembered only to decide nothing: closing always calls
  `source.refocus()` (CP-9). The global key handler runs it like any shortcut (not while a dialog is open).
- `outline.expandAll` / `collapseAll`: as the buttons. `outline.toggleRail`: flips `outlineRail` (missing = true).

### 6.2 Strings

Every R177 key in `app/ui/src/i18n/catalog.ts` with the given text; `outline.count` and `outline.hidden` as plural
objects (`{ one, other }`, D-133); numbers through the region's grouping as other counts. No other new key (the
`Expand all` button's tooltip reuses `outline.expandAll`; chevron tooltips `outline.expand` / `outline.collapse`).

## 7. The Settings switch (FR-SET-02 AC-10, D-1601)

`settings/appearance` gains, after the theme radios and before the disabled font controls, a `button[role=switch]`
`aria-label` `settings.appearance.outlineRail`, `aria-checked` = `outlineRail !== false`, `aria-description`
`settings.appearance.outlineRailNote` (also shown as the muted note), `data-command="outline.toggleRail"` (the markup of
`settings5b.tsx`'s `sw`). `SettingsPage` gets `outlineRail: boolean` and `onOutlineRail(on: boolean)`.

## 8. Timing and performance (D-1623; NFR-PERF-06 AC-6, FR-EDT-11 AC-20)

- Refresh: trailing `REFRESH_MS` after the last doc-changing transaction, never per keystroke, never during a
  composition; the rows paint in the frame after the refresh. With Playwright's clock: ≤ 120 ms + one frame, under
  the 250 ms of AC-7, AC-12, AC-20.
- The tracker never measures on `input`; only on `scroll`, a new source and layout changes.
- **Perf line** (test builds; while the latency probe is on, `TEGG_PERF_LOG` set): the editor's capture `keydown`
  listener stamps the time of the last printable key; when a refresh changes rows and the next frame has painted them,
  the page calls `ipc.perfOutline(frames, ms)` = `invoke('perf_mark', { name: 'outline', mark: 'outline', frame, ms })`,
  which appends `{"mark":"outline","frame":<n>,"ms":<float>}` (ms from that keydown to the paint), then clears the stamp.
- Benchmarks (outside the push run, report-only until the v1.0 release gate, as D-940): `app/e2e/nfr_perf_06_outline.ac.test.ts`
  with `app/e2e/perf_outline.ts` (`outlineLines(log)`, `type50(char)`: one key, 400 ms pause, ×50, through
  `helpers/osa.ts` while Tegg is frontmost, D-758) for AC-20, and `perf_typing.ts`'s `type200` with the panel on
  Outline, then with the panel closed and the rail shown, for NFR-PERF-06 AC-6 (key lines as before). The runtime note
  `Pages/Pět set nadpisů.md` is copied into `tools/gen-vault --seed 1 --small-images` output.
- L1 benchmark (report-only): `outlineHeadings` on the 500-heading text, `railRows` on 600 headings.

## 9. No writes (FR-SYN-06 AC-46, T1)

- Nothing in `outline/` imports a write command; the only `ipc` it calls is `perfMark` / `perfOutline` (test builds).
- A jump, a reveal, a flash, a fold, the card, the rail and Back / Forward between jump entries change no document:
  no transaction with steps, `dirty()` and `historyDepth()` unchanged (FR-EDT-11 AC-10, AC-11). A folded callout's
  `-` stays (`revealPos` is view state).
- A virtual `daily/<date>` and a `new/<type>` draft are never created by the outline.
- The fake core's `writes()` stays 0 over the AC-46 tour; in L6 every vault file keeps bytes, mtime and inode and
  only `ui-state.json` changes (new inode).

## 10. Fake core and test hooks

- **No fake-core change:** the outline makes no IPC. `uiState()` exposes `outlineRail` and `vaults[…].outline`;
  `calls()` shows that the tab and the rail add none; `setFile(…)` makes AC-8's external change; `writes()` counts 0.
  The L5 start option `__TEGG_UI_STATE__` seeds `rightPanel`, `outlineRail` and `vaults[…].outline` (the 200-entry file
  of FR-STO-07 AC-7).
- **`window.__TEGG_TEST__.outline`** (L5 build and `TEGG_TEST=1`; set by `store.ts`):

```ts
outline: {
  /** Rows as the outline holds them now (the source's tree): { level, text, from, to, depth, key }. */
  headings(): { level: number; text: string; from: number; to: number; depth: number; key: string }[];
  current(): number | null;                 // the real current section (not the tab's shown ancestor)
  /** While on, no refresh is published (the AC-11 "outline refresh held"); turning it off refreshes at once. */
  hold(on: boolean): void;
  railRows(): number[];                     // the rows the rail draws now (same as the DOM)
}
```

- `__TEGG_TEST__.editor.dirty()` / `historyDepth()` / `text()` as ms3-shell §13.6.
- L5 helpers (`app/webkit/outline-helpers.ts`, written by the test author): `outlineVault(edit?)` (the fixture plus
  `new-empty/.tegg`), `startOutline(page, route, { panel?: 'outline' | 'backlinks' | 'graph' | null, width?, rail?,
  folds?, viewport? })`, locators `outlineTab`, `outlinePanel`, `outlineTree`, `rows`, `row(text, n?)`, `rail`,
  `railLines`, `card`, `cardTree`, `liveRegion`, and `headingTop(page, i)` (the element's top below `viewportTop(main)`, D-1673).
- **L6** (`app/e2e/outline.ac.test.ts`): a temporary copy of the fixture with `new-empty/.tegg`, a temporary Application
  Support seeded with `ui-state.json` (`rightPanel`, folds), `TEGG_ROUTE=note/<path>`, the marks `route-ready:…` and
  `note-ready`; the test build writes the mark `outline-ready` once, when the tab or the rail first paints rows. Keys are
  sent only while Tegg is frontmost (`helpers/capture.ts` `press`, D-799). External edits through
  `helpers/external.ts`. Vault checks with `tree()` / `changedPaths()` (bytes, mtime, inode). The macOS accessibility
  tree shows rows as `AXRow`/`AXOutlineRow` (or the WebKit mapping of `treeitem`) named by their text, the current one
  with `AXSelected` or the `aria-current` description (FR-UX-08 AC-21).

## 11. Test layout

| Layer | Files |
| --- | --- |
| L0 | static rules unchanged (no colour or string literal in `outline/`); the AR-03 check covers `packages/doc/src/outline.ts` |
| L1 | `packages/doc/test/outline.ac.test.ts` (FR-EDT-11 AC-2, AC-3, AC-4 tree; FR-EDT-16 AC-5 `railRows`; FR-FMT-12 AC-10 `foldKey`; `headingForFragment`), `app/test/outline_model.ac.test.ts` (`visibleRows`, `shownCurrent`, `foldButtons`, `toggle`, `currentSection`, `railGap`, `cardChevrons`, `folds.ts` prune, cap, re-key: FR-STO-07 AC-7 L1 part), `app/test/outline_registry.ac.test.ts` (FR-UX-03 AC-45 registry part, R2 and R4 rows, `groupOf`), `app/test/outline_catalog.ac.test.ts` (NFR-OTH-02 AC-19, FR-UX-05 AC-22 line contrast from `theme/tokens.ts`) |
| L2 | `packages/doc/test/outline_props.ac.test.ts` (§1.3) |
| L5 | `app/webkit/outline.ac.test.ts` (FR-EDT-11 AC-1…AC-8, AC-15, AC-17, AC-18), `outline_jump.ac.test.ts` (AC-9…AC-12, AC-19, FR-NAV-03 AC-15, AC-16), `outline_folds.ac.test.ts` (AC-13, AC-14, AC-16, FR-STO-07 AC-7, FR-FMT-12 AC-10), `outline_rail.ac.test.ts` (FR-EDT-16 AC-1…AC-13), `outline_keyboard.ac.test.ts` (FR-UX-03 AC-45…AC-47, FR-NAV-05 AC-4, AC-5, FR-EDT-11 AC-20), `outline_a11y.ac.test.ts` (FR-UX-08 AC-21, AC-22, FR-UX-05 AC-22, NFR-OTH-02 AC-19, FR-SET-02 AC-10, FR-SYN-06 AC-46); helpers `app/webkit/outline-helpers.ts`; `app/webkit/sidebar_5b.ac.test.ts` (FR-NAV-05 AC-1, changed with the trailer of D-1624) |
| L6 | `app/e2e/outline.ac.test.ts` (outline.md "Real-app tests"), `app/e2e/nfr_perf_06_outline.ac.test.ts` + `perf_outline.ts` (outside the push run) |
| manual | FR-EDT-11 AC-21, FR-EDT-16 AC-14 (`qa/manual/`) |

No new `qa.config.json` step: the tests live in packages that already have steps.

## 12. Changes to other documents and tests (in the build commit)

- `docs/contracts/ms3-shell.md` §2 / §14.7.1: a pointer to §5 here for `outlineRail` and `vaults[…].outline`; §12.1: a
  pointer to §4 here (`pushPlace`, same-route steps, `Caret.follow`).
- App-shell R2 (`outline` built, `FR-EDT-11, FR-NAV-05`) and R4 (`⌘J`), inbox.md FR-NAV-05 AC-1 and its test, with
  `AC-Test-Change: AP-1424, the Outline tab is built in slice OL; approved-by: owner` (D-1624).
- `app/test/registry.ac.test.ts` (R2, R4 from app-shell.md) and every test that counts R4 rows or lists the TBD panel
  tabs of `overdue('v1.0')` follow the doc change, under the same trailer.
- CP-12: the two regression tests that pin a `#Heading` open at the pane's top.

## 13. Contract choices (no owner decision needed)

1. The heading list, the tree, the fold key and the rail rows live in `@tegg/doc` (platform-neutral, mobile reuses them,
   FR-LNK-06 shares them); geometry, timing and folds live in the UI.
2. `outlineHeadings` returns only `{ level, text, from, to }` (R171 rule 1); depth, parent and keys come from
   `outlineTree`, so the extraction stays the one FR-LNK-06 shares.
3. Offsets are UTF-16 code units (JS string positions), unlike `queryFences`' UTF-8 bytes: the outline never meets Rust.
4. The jump targets a ProseMirror position mapped through edits since the snapshot (`headingPos`), never the text;
   a click between a keystroke and the refresh still lands right, and only a deleted heading is stale.
5. The flash is a node decoration in the editor (ProseMirror would drop a foreign attribute on re-render) and an
   attribute on the line in the source view; the fade is a second attribute so the flash itself never animates in.
6. One `OutlineTree` component for the tab and the card, with a variant; one store for the current section, so the tab,
   the rail and the card can't disagree (R172 rule 7).
7. Rows are keyed by fold key, so a relabel replaces one row and a live update never rebuilds the tree.
8. The rail measures `div.centre` with a `ResizeObserver` (the panel's drag width is internal to `ContextPanel`).
9. Same-route history neighbours exist only through `pushPlace`; a step between them is in place, so Back after a jump
   reads nothing.
10. The selection of D-1610 is the existing `HistoryEntry.caret`; `follow` adds D-112's mapping for the same editor.
11. The caret after a jump is at the end of the heading node's content, after a block id the editor shows (`^oddil1`).
12. A heading not rendered (inside a folded callout) takes the top of its nearest rendered container for the current
    section; the jump reveals it first.
13. `outline.*` shortcuts group under `Navigation` in `help/shortcuts` by id prefix; the palette section stays `view`.
14. ⌘J with 0 headings only announces, also when the Outline is on screen.
15. The card's → on a row whose children are shown moves to the first child (tree pattern), as the tab's →.
16. `outline-ready` is a once-per-process mark for L6 waits; the benchmark uses `perf_mark` lines named `outline`.
17. The tab panel shows nothing (no tree, count or hint) while the source is null (FR-EDT-11 AC-18).

## 14. Contract points (CP-1…CP-14 → D-1628…D-1641, accepted as proposed)

| CP | Point | Choice in this contract (why) |
| --- | --- | --- |
| CP-1 | **`%%` comment blocks.** The dialect table lists `%%…%%` comment blocks as raw, but `parse` splits `%%`, `# Nadpis v komentáři`, `%%` (Okraje) into paragraph, heading, paragraph, so the editor shows that line as a real heading. R171 rule 3 excludes it. | `outlineHeadings` adds a region rule: a top-level block whose source starts with `%%` and holds an odd number of `%%` opens a comment that the next top-level block holding an odd number of `%%` closes; headings starting inside are skipped. An **unclosed** `%%` hides nothing (a stray `%%` must not empty the outline). The editor keeps showing the line as a heading (a parser follow-up, outside OL). |
| CP-2 | **A heading inside a read-only block** (a raw or lossy block the editor shows as source, `heading: false` in §2). R172 rule 4 wants the caret at the heading's end, which a read-only block can't hold. | Scroll and flash the block as for a heading; the editor gets the focus and the caret is not moved. Still a Back entry when the scroll changed. |
| CP-3 | **Wikilink text** in a heading without an alias: target only, or with its `#subpath`? Also images and footnote references. | The target as written inside the brackets, subpath included (`[[A#B]]` → `A#B`); images by alt text; any other inline node by its source. |
| CP-4 | **Footnote definitions, tables, definitions**: R171 lists HTML, `%%`, `$$` as raw; footnote definitions are raw blocks too. | Headings inside footnote definitions, link definitions and tables are not listed. |
| CP-5 | **Folds on an unwritten `new/<type>` draft** have no key (as page width, AP-758). | Kept in the page's state, never stored; once the draft is written they are stored under its `id` at the next fold write, not before (no extra write). |
| CP-6 | **The tooltip of a cut row** (FR-EDT-11 AC-15: on hover after the app's delay **and** on keyboard focus). The app's hover tooltips are native `title`s, which never show on focus. | `title` = full text on every row (hover), plus a `span[role=tooltip]` with the full text while a row whose text is cut has keyboard focus (as `Disabled`). Tests check `title` for hover and `role=tooltip` for focus. |
| CP-7 | **AC-13 contradicts R173.** At about 850 px, 200 depth-1 lines fit with a gap of 2.5 px (200 × 1.5 + 199 × 2.5 = 797.5 ≤ 802), so `Dvě stě kapitol` would show a rail, but AC-13 expects none. | Keep R173 (D-1615) and change AC-13's runtime note to 300 H1 (`Pages/Tři sta kapitol.md`: 300 × 3.5 − 2 = 1,048 > 802, no rail, the card lists 300 rows). Alternative: a minimum gap of 4 px. |
| CP-8 | **The fit rule when depth 1 fits in 20** but the current branch is long (a section with 60 subheadings). R173 shrinks the gap only when depth 1 exceeds 20. | The same `railGap` for every row set: shrink to fit, minimum 2 px, else no rail for that scroll position. |
| CP-9 | **Esc / ⌘J / Tab in the source view**, which has no editor (R173, R174 say "back to the editor"). | `refocus()` of the source view focuses its `section` (`tabindex=-1`) without scrolling. In the editor it is always the `Note body`, whatever had the focus before. |
| CP-10 | **Back between a jump's entries** with unsaved edits: R172 / FR-NAV-03 AC-16 say Back never writes. Today every step flushes the note first. | A same-route step doesn't flush; the autosave keeps its own schedule (so `Saved` may follow on its own). Steps to other routes flush as today. |
| CP-11 | **Jumps on a `new/<type>` draft** (D-521: a draft is an entry only while shown). | They add entries like any jump; all of them go with the draft when it is left (D-521's rule). |
| CP-12 | **Heading links land at 24 px** (D-1625) instead of the pane's top. `app/webkit/bug_112a_fr_lnk_09_a_link_opened_right_after_back_lands_on_its_heading.test.ts` and `bug_v094gp_fr_lnk_09_section_embed_opens_at_its_heading.test.ts` assert the heading at 0 ± 8 px. | Change both to 24 ± 8 px in the build commit with `AC-Test-Change: D-1625, a heading link lands where the outline jumps; approved-by: owner`. |
| CP-13 | **"The fake core holding the outline refresh"** (FR-EDT-11 AC-11): the outline makes no IPC, so the fake core can't hold it. | The hook `__TEGG_TEST__.outline.hold(on)` (§10); the AC's wording changes to "with the outline refresh held". |
| CP-14 | **Which heading a duplicate `#Heading` link picks** (FR-LNK-06 shares the list): the first by text, as today. | The first heading in note order with that NFC text, case-insensitive (`headingForFragment`); FR-LNK-06's own criteria may refine it. |

## 15. Red-test clarifications (2026-11-13; D-1642…D-1646)

- D-1642…D-1646 (BRD v1.177) settle the four ambiguities the red tests found (Tab order, End, the test hold, the card's centring) and the test approximations. `hold(true)` (§10) blocks only the debounced refresh after typing; a stale click refreshes regardless (D-1644).
- Contract choices (no owner decision): `toggle(tree, collapsed, id)` and `visibleRows` take `collapsed: Set<string>`; `folds.ts` takes the vault as its path string and keys it as `vault.normalize('NFC')`. On the rail, `i[data-outline-line]` is the row's 8.5 px pointer slot and the drawn stroke is its `::before` (width by level, R173).
