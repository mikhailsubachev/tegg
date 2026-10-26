# Acceptance Criteria: Mindmaps (slice MM)

See [README](README.md) for conventions. Milestone MS5 (BRD §11.2: FR-MMP-01, -02 list editing + map, -04), slice **MM**, built in the daily-use order (`docs/plans/mvp-daily-use-plan.md`; D-377). Plan and decisions: `docs/plans/mm-mindmap-as-list.md`, **D-679…D-687** (BRD v1.84). A mindmap is an Obsidian callout of type `mindmap` holding one Markdown list; the list is edited as an ordinary list, and Tegg draws it as a left-to-right map. No Mermaid. Design reference: the Main board (`design/edit-note-page/Main.dc.html`, section "Mindmap block") for the node look, the connectors and the framed block with a header; the board predates D-684, so its `Visual` / `Source` toggle, zoom, full-screen, collapse badge, shortcut legend and "saved as Mermaid" text don't apply.

**Status: approved, 2026-10-25.** Writing these criteria raised AP-726…AP-740 (end of this file); the owner accepted every recommendation (D-765…D-779, BRD v1.95). A criterion naming an AP follows that decision. **Slice MM2** (editing on the map, the `right` / `spider` layouts; D-785…D-792) is the second part of this file, drafted 2026-10-26.

**Scope.** FR-MMP-01 (insert, wrap, unwrap), FR-MMP-02 (the MVP part, D-684: `Map` / `List`, the drawing, D-681…D-684), FR-MMP-04 (template), FR-FMT-05 (format and parser, D-679, D-680), and the MM parts of FR-FMT-07, FR-SYN-06, FR-LNK-01, FR-LNK-03, FR-UX-03, FR-UX-05 and NFR-OTH-02. **Out of scope (v1.0, D-687):** editing on the map, drag to re-parent, collapse, zoom and pan (FR-MMP-02's v1.0 part), node → object (FR-MMP-03's conversion part; see AP-739 for what the MVP does instead), export as an image (FR-MMP-05, FR-EXP-03), a `Convert to mindmap list` action for Mermaid fences (D-679), templates beyond the verbatim file (FR-TPL).

**Interfaces.** The parser's block kinds are `docs/contracts/ms1-core.md` §`BlockKind` (`mindmap` now means the callout); the in-note registry and the editor's UI side are `docs/contracts/ms3-shell.md` (§13, `IN_NOTE_PLACEHOLDERS`, R6). The layout function, its tree input and the test text measurer are named by the red-test author in the MS5 contract before the red tests (D-61).

**Test layers** as in [editor.md](editor.md) and [tags.md](tags.md):

| Tag | Layer |
| --- | --- |
| L0 | Static rule over the source tree and the lockfiles |
| L1 | Vitest: `@tegg/doc` parse and serialize, `@tegg/editor` with real ProseMirror transactions in a DOM environment, the layout function with an injected text measurer, React components; the save path through the real `@tegg/doc` (never mocked) |
| L2 | Property test (fast-check): fixed seed plus one random seed per push, 10 × 1,000 runs nightly (TS-L2) |
| L4 | Rust: `tegg-format` extraction, `tegg-index` (backlinks, broken links, search), `tegg-jobs` (`note-rename`) on a temporary copy of the fixture on APFS |
| L5 | Playwright on WebKit with the fake core over mocked IPC (real `@tegg/doc`; records every call with its path); clock, time zone and region injected |
| L6 | Appium `mac2` on the built app with `TEGG_TEST=1`, a temporary Application Support and a temporary copy of the fixture; vault checks by bytes, mtime and inode. Every AC whose layer names L6 has an `app/e2e/` test in the red-test commit (D-382) |
| manual | Owner session, recorded in `qa/manual/` |

**Test clock** (L4, L5, L6): `2026-10-22T10:00:00+02:00` (a Thursday), Europe/Prague, region `cs`, window 1440 × 900 with the right panel closed (centre pane 560 px of text column, board), unless a criterion says otherwise.

**Fixture:** `tests/fixtures/vaults/mindmap/` (synthetic, D-50; contents, byte rules and the criterion each file serves are in its `README.md`) plus `tests/fixtures/vaults/new-empty/.tegg/` copied in. Short names below are those of the README: Výjezd, Lisabon, Uzly, Nákup, Postup, Více kořenů, Bez titulku, Holá mapa, Složené, Rozpoznání (1)…(10), Mermaid, Převody (blocks 1…8), Rozbalení (blocks 1, 2), Z Obsidianu, Vložení, Zalít květiny, Rozložení (Strom, Zalomení, Paleta), Prázdná, Neplatná mapa, Šablona, Stará mapa. Two criteria also use the editor fixture's Deset bloků (`tests/fixtures/vaults/editor/`).

**Shared definitions.**
- **Mindmap block** = a top-level callout whose type is `mindmap` (any case) and whose body is exactly one list (D-680, AP-726, AP-730); it is shown as R91.
- **Hint callout** = a top-level callout of type `mindmap` whose body is not one list: an ordinary callout with the mindmap icon and the hint (D-680).
- **Node** = a `treeitem` of the map (R91). **Outline order** = the list's items in file order, depth first.
- **Root**: the single top-level item, or a **synthesized root** (the callout title, else the note title) when there are several (D-681).
- **Untouched** = bytes, mtime and inode unchanged.
- **Measurer** = the test text measurer of R92: 7 px per Unicode scalar value of the NFC text, line height 18 px.

**Existing criteria this slice verifies** (not repeated, tests named after them): file-format FR-FMT-05 AC-1 (changed wording, see "What changes"), AC-3 [manual] (the owner's Obsidian recheck, D-686, on the regenerated `obsidian-check` vault), NFR-POR-01 AC-1 [manual]; editor.md FR-EDT-01 AC-6 (`Mindmap` in `Turn into`), FR-EDT-02 AC-17 and AC-18 (list editing and checklist toggles inside the List view), FR-EDT-09 AC-2 (undo steps), FR-EDT-13 AC-4 (multi-block `Turn into`); embeds.md (a note embed showing a note with a mindmap); conversion.md (block → object of a whole mindmap block, AP-739).

---

## Reference tables

### R90. Recognition (FR-FMT-05, D-679, D-680; AP-726, AP-730)

`@tegg/doc` `parse(text).blocks[i].kind` and what the editor and the read view show, for each top-level block of the fixture.

| Block | `kind` | Shown as | Root (nodes) |
| --- | --- | --- | --- |
| Výjezd (block 2) | `mindmap` | mindmap block | `Výjezd 2026` (7) |
| Uzly | `mindmap` | mindmap block | `Obsah uzlů` (12) |
| Nákup | `mindmap` | mindmap block, checklist | `Nákup` (4) |
| Postup (`[!MindMap]`, numbered) | `mindmap` | mindmap block | `Postup` (3) |
| Více kořenů | `mindmap` | mindmap block | synthesized `Témata` (5) |
| Bez titulku | `mindmap` | mindmap block | synthesized `Bez titulku`, the note title (3) |
| Holá mapa (no frontmatter) | `mindmap` | mindmap block | synthesized `Holá mapa`, the file stem (D-103) (3) |
| Složené (1) `[!mindmap]-` and (2) `[!MINDMAP]+` | `mindmap` ×2 | mindmap blocks; (1) starts collapsed | `Kořen` (2) each |
| Rozpoznání (1) paragraph, (2) two lists, (3) list + paragraph, (4) list + `%%comment%%` | `callout` | hint callouts | — |
| Rozpoznání (5) `2. druhý bod` right after the title line | `mindmap` (AP-726) | mindmap block | `druhý bod` (1) |
| Rozpoznání (6) empty first item `> -` with child `dítě` | `mindmap` (AP-726) | mindmap block | an empty node (2) |
| Rozpoznání (7) `[!mind-map]`, (8) `[!mindmaps]` | `callout` | ordinary callouts of an unknown type (read-view FR-EDT-02 AC-3: note style, raw type as the label), no mindmap icon, no hint | — |
| Rozpoznání (9) `[!Mindmap]` | `mindmap` | mindmap block | `a` (1) |
| Rozpoznání (10) title only, no body | `mindmap` (AP-726) | mindmap block in the empty state | — |
| Mermaid fence starting `mindmap` | `raw` | read view: `pre > code` with the label `mermaid`; editor: read-only source block | — |
| Mermaid `flowchart` fence | `code` | ordinary code block (editable) | — |
| Z Obsidianu (tab indents) | `mindmap` | mindmap block | `Kořen` (3, depth 3) |
| Rozložení: Strom, Zalomení, Paleta | `mindmap` ×3 | mindmap blocks | `Kořen` (7), `Krátký` (2), `Barvy` (9) |
| Rozbalení (1), (2) | `mindmap` ×2 | mindmap blocks | `Kořen` (2); synthesized `Rozbalení` (3) |
| Neplatná mapa | `mindmap` | read view only (NFR-REL-03): Map without the view switch | `Jen ke čtení` (3) |
| Šablona `_templates/Projekt/Projekt.md` | `mindmap` | mindmap block when opened | `Cíle projektu` (4) |
| Převody blocks 1…8 | `paragraph`, `list`, `list`, `heading`, `paragraph`, `paragraph`, `quote`, `code` | no mindmap | — |

### R91. The mindmap block (D-684; board Main, without the parts D-684 dropped)

| Element | Role | Accessible name / content |
| --- | --- | --- |
| Block | `figure` | `Mindmap: <title>` with a callout title, else `Mindmap`; bordered frame (`border` token, 10 px radius, `bg` background) |
| Header | — | the mindmap icon (`data-icon="mindmap"`, the board's branching icon, `aria-hidden`); the title (the callout title as user content, or `Mindmap` in `muted` when there is none; AP-732); with a `+`/`-` fold marker, the existing fold `button` `Collapse <title>` / `Expand <title>`; the view switch. Background `embed` token, bottom border. No zoom, full-screen, collapse or Mermaid control or text |
| View switch | `group` `Mindmap view` | two `button`s `Map` and `List` with `aria-pressed`; exactly one pressed |
| Map | `tree` | `Map of <title>` (`Map of Mindmap` without a title) (AP-731); one `treeitem` per node with `aria-level` (root 1), `aria-setsize`, `aria-posinset`; the accessible name is the node's text, chip titles included; a node with ` …` has the description `More in the list`; a checklist node has the description `Checked` or `Not checked` (AP-731) |
| Map area | — | scrolls horizontally inside the block (`overflow-x: auto`), never vertically (AP-736) |
| List (List view) | inside the `textbox` `Note body` | the callout body as the editor's ordinary list (editor.md FR-EDT-02), followed by the map of the same list (read-only, live, AP-737) |
| Empty state | `button` (Map) / placeholder (List) | `Type the central topic`: in Map a button in the map area; in List the placeholder of the empty first item (`muted`, never saved) (D-681) |
| Hint callout | `note` (an ordinary callout) | the mindmap icon, the title, the body as written, and the text `A mindmap holds one list` (`muted`); no view switch, no tree (D-680) |

### R92. Node look and geometry (D-683; board Main; AP-735, AP-736)

- **Root:** background `text`, text `bg`, weight 650, no border.
- **First-level nodes** (the root's children; with a synthesized root, the top-level items): background `type-<c>-bg`, text `type-<c>`, weight 600, no border, where `<c>` is palette[i mod 7] for the i-th child (0-based), palette = `blue`, `orange`, `purple`, `teal`, `green`, `yellow`, `red` (AP-736; the board's first four).
- **Deeper nodes:** background `bg`, 1 px `border`, text `text`, weight 400.
- **Box:** font 13 px, line height 18 px, horizontal padding 10 px, radius 8 px; height = 14 + 18 × lines; a node whose text fits in 180 px is `clamp(text width + 20, 48, 200)` wide; a longer text wraps greedily at word boundaries within 180 px (a word wider than 180 px breaks between characters) and the node is 200 px wide. Nothing is cut; ` …` is appended only per AP-735.
- **Columns:** x(depth 0) = 0; x(d + 1) = x(d) + (widest node of depth d) + 60.
- **Rows:** a leaf is placed 8 px below the bottom of the previously placed subtree (the first at y = 0); a parent's vertical centre is the midpoint of its first and last child's centres; when that would put the parent above its subtree's top, the subtree moves down until it fits; the next sibling subtree starts 8 px below the lower of the parent's and its children's bottoms.
- **Connectors (elbow):** from the parent's right edge at its centre, horizontally to x(d + 1) − 30, vertically between the first and last child's centres, then horizontally to each child's left edge at its centre; 1.5 px, token `muted` (AP-736).
- **Map area:** padding 12 px top and bottom, 16 px left and right; its height is the layout height + 24 px; no maximum height (AP-736).
- **Golden values** with the Measurer (L1, FR-MMP-02 AC-11), boxes as (x, y, width, height):
  - **Strom:** Kořen (0, 70, 55, 32); Alfa (115, 20, 48, 32); A1 (223, 0, 48, 32); A2 (223, 40, 48, 32); Beta (115, 80, 48, 32); B1 (223, 80, 48, 32); Gama (115, 120, 48, 32). Layout 271 × 152. Connector Kořen → Alfa: (55, 86) → (85, 86) → (85, 36) → (115, 36); Kořen → Gama ends (115, 136); Alfa → A1: (163, 36) → (193, 36) → (193, 16) → (223, 16).
  - **Zalomení:** Krátký (0, 18, 62, 32); the long node (122, 0, 200, 68) with exactly the lines `Velmi dlouhý text uzlu,` / `který se musí zalomit do` / `více řádků`. Layout 322 × 68.
  - **Paleta:** Jedna `blue`, Dvě `orange`, Tři `purple`, Čtyři `teal`, Pět `green`, Šest `yellow`, Sedm `red`, Osm `blue`.

### R93. What is written (FR-FMT-07, FR-SYN-06; D-685; AP-726, AP-728, AP-732)

Byte strings with `\n` for LF. "Block" is the top-level block's source range; every byte outside it, and the gaps between blocks, are unchanged; the frontmatter changes only in `modified` (D-55).

| # | Action | Before (block) | After (block) |
| --- | --- | --- | --- |
| W1 | `/mindmap` in Prázdná's empty body (AP-726) | — (body empty) | `> [!mindmap]\n` |
| W1a | then typing `Výlet do Brna` | `> [!mindmap]\n` | `> [!mindmap]\n> - Výlet do Brna\n` |
| W1b | then ⏎, Tab, `Doprava` | | `> [!mindmap]\n> - Výlet do Brna\n>   - Doprava\n` |
| W2 | `Turn into › Mindmap` on Převody block 2 (AP-728) | `* Kořen\n    * Větev s odsazením čtyř mezer\n* Druhý` | `> [!mindmap]\n> * Kořen\n>     * Větev s odsazením čtyř mezer\n> * Druhý` |
| W3 | the same on block 3 | `1) První krok\n2) Druhý krok` | `> [!mindmap]\n> 1) První krok\n> 2) Druhý krok` |
| W4 | the same on block 1 | `Úvodní odstavec.` | `> [!mindmap]\n> - Úvodní odstavec.` |
| W5 | the same on the selection of blocks 4–6 (FR-EDT-13) | `## Nadpis jedna\n\nOdstavec dva.\n\nOdstavec tři.` | `> [!mindmap]\n> - Nadpis jedna\n> - Odstavec dva.\n> - Odstavec tři.` (one block) |
| W6 | `Turn into › Bulleted list` on Rozbalení block 1 (AP-728) | `> [!mindmap] Titulek mapy\n> * Kořen\n>     * Větev` | `Titulek mapy\n\n* Kořen\n    * Větev` (two blocks) |
| W7 | `Callout type › note` on Rozbalení block 1 | (as W6) | `> [!note] Titulek mapy\n> * Kořen\n>     * Větev` |
| W8 | `Turn into › Numbered list` on Rozbalení block 2 | `> [!mindmap]\n> 1. Jedna\n> 2. Dvě` | `1. Jedna\n2. Dvě` |
| W8a | `Turn into › Bulleted list` on Rozbalení block 2 | (as W8) | `- Jedna\n- Dvě` |
| W9 | List view of Výjezd, ` – plán` typed at the end of the header title (AP-732) | first line `> [!mindmap] Výjezd 2026` | first line `> [!mindmap] Výjezd 2026 – plán`; other lines unchanged |
| W9a | Bez titulku, title `Roční období` typed into the empty title | first line `> [!mindmap]` | `> [!mindmap] Roční období` |
| W9b | then the title deleted | | `> [!mindmap]` (no trailing space) |
| W9c | Složené (1), title changed to `Nová` | `> [!mindmap]- Složená mapa` | `> [!mindmap]- Nová` (fold marker kept) |
| W9d | Rozpoznání (9), ` B` typed at the title's end | `> [!Mindmap] Velké písmeno` | `> [!Mindmap] Velké písmeno B` (the type's spelling kept) |
| W10 | `Callout type › mindmap` on Deset bloků's callout (editor fixture) | `> [!tip]+ Tip` (first line) | `> [!mindmap]+ Tip`; the body (a paragraph) makes it a hint callout |
| W11 | List view of Výjezd, ` 2026` typed at the end of `Přehled Q4` | line `>     - Přehled Q4` | `>     - Přehled Q4 2026`; every other byte of the file except `modified` unchanged |

### R94. Registry, commands and strings (NFR-OTH-02, FR-UX-03)

- **R6 (editor.md):** the row `Advanced › Mindmap` becomes **built** (no milestone), writes W1 (`> [!mindmap]`, AP-726), with the option description `Edit as a list, shown as a map` shown as its second line (board Main) and as `aria-description`. `Turn into` lists `Mindmap` after `Checklist` (D-685). The `Callout type` submenu has 14 entries, `mindmap` (label `Mindmap`) last (D-680).
- **R5 (read-view.md):** the `mindmap` row is removed; `IN_NOTE_PLACEHOLDERS` holds `query` only (ms3-shell §13). The catalog key `ph.mindmap` is removed.
- **Commands (R4, section `edit`, `needsVault: true`, no shortcut; AP-731):** `Show mindmap as map`, `Show mindmap as list`. They act on the mindmap block that holds the caret or the focus; elsewhere they aren't run and show no error.
- **Catalog keys (English text):** `slash.mindmap` `Mindmap` (exists) · `slash.mindmap.description` `Edit as a list, shown as a map` · `callout.mindmap` `Mindmap` · `mindmap.figure` `Mindmap: {title}` · `mindmap.untitled` `Mindmap` · `mindmap.view` `Mindmap view` · `mindmap.map` `Map` · `mindmap.list` `List` · `mindmap.tree` `Map of {title}` · `mindmap.empty` `Type the central topic` · `mindmap.notOneList` `A mindmap holds one list` · `mindmap.more` `More in the list` · `mindmap.checked` `Checked` · `mindmap.unchecked` `Not checked` · `cmd.mindmap.showMap` `Show mindmap as map` · `cmd.mindmap.showList` `Show mindmap as list`. Final key names are the contract's.

---

### FR-FMT-05 Mindmap format and parser (D-679, D-680; adds to file-format.md AC-1…AC-3)

- **AC-4** [MS5] **Recognition (R90; T2).** For every block of R90, `@tegg/doc` `parse` returns the `kind` of R90 and the editor and the read view show it as R90 says. The type `mindmap` matches in any case (`MindMap`, `MINDMAP`, `Mindmap`); `mind-map` and `mindmaps` don't. The fold markers `+` and `-` don't affect recognition. A body is one list when, after the title line, it holds exactly one list block (bulleted, numbered or checklist; mixed checklist and plain items in one list count as one list) and nothing else but blank `>` lines (AP-726 for what "after the title line" means). Recognition is the same for a runtime CRLF copy and for a copy whose text is NFD. *(L1)*
- **AC-5** [MS5] **Mermaid fences stay what they are (D-679).** In Mermaid: the read view shows both fences as `pre > code` with the label `mermaid` and their text exact; no `tree`, `figure` named `Mindmap…` or map is rendered. In the editor the `mindmap` fence is a read-only source block (`group` `Source block`, editor.md FR-EDT-01 AC-8 rules: typing and paste change nothing) and the `flowchart` fence is an editable code block. After editing both paragraphs, each fence is byte-identical in the saved file. Pasting the `mindmap` fence's text into Prázdná creates a read-only source block, not a mindmap. *(L1 for the kinds; L5)*
- **AC-6** [MS5] **Tegg ships no Mermaid (D-679, D-683, NFR-SEC-01).** No `package.json` of `app/` or `packages/` and no lockfile entry names `mermaid`, `markmap`, `markmap-*` or a `d3` / `d3-*` package; the built UI bundle contains no `mermaid` module; drawing every fixture mindmap makes no network request (the WebKit network log shows none). *(L0; L5 for the network log)*

### FR-MMP-01 Inserting and converting (D-685)

- **AC-1** **`/mindmap` (R6, W1; AP-726).** In Prázdná, `/mind` lists `Mindmap` first with the description `Edit as a list, shown as a map`; ⏎ inserts a mindmap block in the **List** view (`List` pressed) with the caret in its single empty item, which shows `Type the central topic`. After `Saved`, the file is the original bytes followed by W1; typing `Výlet do Brna` saves W1a; ⏎, Tab, `Doprava` saves W1b; the map below the list shows `Výlet do Brna` › `Doprava` (AP-737). `Text /mindmap` in a paragraph with other text removes `/mindmap` and inserts the block after that paragraph (editor.md FR-EDT-03 AC-4). *(L5; L1 for the bytes)*
- **AC-2** **Wrapping a list (W2, W3; AP-728; T1).** `Turn into › Mindmap` on Převody block 2 saves W2: the list's own bytes (the `*` markers and the 4-space indent) are kept, each line prefixed with `> `; the block shows the Map with the synthesized root `Převody` and the children `Kořen` (with `Větev s odsazením čtyř mezer`) and `Druhý`. On block 3 it saves W3 (root `Převody`, children `První krok`, `Druhý krok`). Every other byte of Převody except `modified` is unchanged. *(L1 for the transform; L5)*
- **AC-3** **Text blocks become one list (W4, W5).** `Turn into › Mindmap` on Převody block 1 saves W4 (root `Úvodní odstavec.`); on the block selection of blocks 4–6 it saves W5 as one block separated from blocks 3 and 7 by the original gaps (root `Převody`, three children). The heading's level is dropped as `Turn into › Bulleted list` drops it (editor.md FR-EDT-13 AC-4). *(L1; L5)*
- **AC-4** **Unwrapping (W6…W8a; AP-728; T1).** On Rozbalení block 1, `Turn into › Bulleted list` saves W6: the title `Titulek mapy` becomes a paragraph above the list, and the list keeps its bytes; `Callout type › note` instead saves W7 (only `mindmap` → `note` changes; the block becomes an ordinary note callout holding the list). On block 2, `Turn into › Numbered list` saves W8 and `Turn into › Bulleted list` saves W8a. No text of the mindmap is lost in any of them (every item's text and the title are in the saved file). *(L1; L5)*
- **AC-5** **`Callout type` has 14 entries (D-680, D-189).** The block menu's `Callout type` submenu lists the 13 types of read-view FR-EDT-02 AC-3 and then `Mindmap` (`mindmap`); on Výjezd's block `Mindmap` is the checked entry; choosing `Mindmap` on Deset bloků's `[!tip]+` callout saves W10 and shows a hint callout (its body is a paragraph). Choosing `Mindmap` on Výjezd writes nothing. *(L5)*
- **AC-6** **One undo step each (D-685, editor.md FR-EDT-09 AC-2).** Each of W1, W2, W3, W4, W5, W6, W7, W8 and W10 is one undo step: ⌘Z right after it, and after its save, gives a body byte-identical to the body before it; ⇧⌘Z re-applies it to the same bytes. Switching between `Map` and `List` is not an undo step: after W2, `List`, `Map`, ⌘Z still undoes W2. *(L1 for the steps; L5 for W2 and W6)*
- **AC-7** **Where `Mindmap` is offered (AP-729, AP-730).** `Turn into` lists `Mindmap` after `Checklist` for Převody blocks 1–6 and for the selection 4–6; it isn't listed for block 7 (quote), block 8 (code), a callout (which uses `Callout type`), a table, an embed or a source block; for the selection of blocks 2–3 (two lists) and 1–2 (a paragraph and a list) it is `aria-disabled`. `/mindmap` typed in an item of Výjezd's List inserts a new mindmap after Výjezd's mindmap block, with the caret in its item; typed in a quote's paragraph, after the quote. *(L5)*
- **AC-8** **Registry (R94, D-116).** The slash item `Mindmap` has no milestone (FR-UX-02 AC-13 lists no `Mindmap` entry); R5 has no `mindmap` row and `IN_NOTE_PLACEHOLDERS` equals `['query']`; the catalog has no `ph.mindmap`; no rendered note shows a `region` named `Mindmap` with `Coming in …`. *(L1)*
- **AC-9** **The title (W9…W9d; AP-732).** In the List view the header title is editable in place (single line; ⏎ moves the caret to the first item); in the Map view it is read-only text. W9, W9a, W9b, W9c and W9d are saved exactly; each changes only the callout's first line (and `modified`). With the synthesized root, a title change redraws the root within 500 ms (Bez titulku: `Bez titulku` → `Roční období` → `Bez titulku` after W9b). *(L5; L1 for the bytes)*

### FR-MMP-02 Map and List (D-681…D-684)

- **AC-1** **The block (R91).** Výjezd shows, between `Plán výjezdu týmu.` and `Poznámka pod mapou.`, one `figure` `Mindmap: Výjezd 2026` with the header of R91 (icon, title `Výjezd 2026`, the group `Mindmap view` with `Map` pressed) and a `tree` `Map of Výjezd 2026` of 7 `treeitem`s in outline order: `Výjezd 2026` (level 1), `Program` (2), `Přehled Q4` (3), `Plán 2027` (3), `Místo` (2), `Lisabon` (3), `Doprava` (2). The figure has no button named `Zoom in`, `Zoom out`, `Open full screen`, `Visual` or `Source`, and no text `Mermaid`. *(L5)*
- **AC-2** **The root (D-681).** Výjezd's root is its item `Výjezd 2026`. Více kořenů's root is the synthesized `Témata` with the children `Rodina`, `Práce` (with `Porady`), `Zdraví`; Bez titulku's is `Bez titulku` (note title) and Holá mapa's `Holá mapa` (file stem, D-103). A synthesized root is drawn as a root (R92) but maps to no list item: no click on it changes the list, and AP-732 says where it puts the caret. Changing the note's title of Bez titulku to `Bez titulku 2` in the Title field redraws the root within 500 ms and writes only `title:` (editor.md FR-EDT-01 AC-10); the callout bytes are untouched. *(L5; L1 for the tree)*
- **AC-3** **Empty state (D-681; AP-726).** Rozpoznání (10) shows, in Map, the button `Type the central topic` and no tree; activating it switches to List with the caret in one empty item showing `Type the central topic`; nothing is written until a character is typed; typing `Téma` saves `> [!mindmap] Prázdná\n> - Téma` for that block; leaving the item empty (moving the caret elsewhere, leaving the note) writes nothing. *(L5)*
- **AC-4** **Hint callouts (D-680).** Rozpoznání (1)–(4) are hint callouts (R91): role `note`, the mindmap icon, their title, their body as written (the two lists of (2), the paragraph of (3), the comment hidden as in any note for (4)), the text `A mindmap holds one list`, no `Mindmap view` group and no tree; the body is editable as in any callout. (7) and (8) are ordinary unknown-type callouts with neither icon nor hint. Opening Rozpoznání writes nothing (zero `note_write`). *(L5)*
- **AC-5** **Opens in Map; a node click goes to List (D-684; AP-737).** Every mindmap block of the fixture opens in Map. Clicking the node `Program` in Výjezd presses `List`, shows the list, and puts the caret at the end of `Program` inside `Note body` (`document.activeElement` within it); typing ` a cíle` saves `>   - Program a cíle` and nothing else changes but `modified`. Clicking `Výjezd 2026` (the root item) puts the caret at the end of that item. *(L5)*
- **AC-6** **The List view and the live map (D-684; AP-737).** In Výjezd's List, the list is the editor's ordinary list (FR-EDT-02 AC-17 keys: Tab nests, ⇧Tab un-nests a nested item, ⏎ adds a sibling), with the map below it. With the caret at the end of `Doprava`, ⏎ `Ubytování` saves `>   - Ubytování` after `>   - Doprava`; Tab then saves `>     - Ubytování`; within 500 ms after the last key, the map below shows `Ubytování` as a child of `Doprava`. While typing one key every 50 ms for 3 s, the map is laid out at most once per 150 ms (layout counter, test hook) and keystrokes meet NFR-PERF-06 AC-4's frame rule. Clicking a node of the map below the list moves the caret to that item without leaving List. *(L5)*
- **AC-7** **The view is session state, never written (D-684; AP-737; T2).** Switching Výjezd between `Map` and `List` ten times sends no `note_write` and changes no vault file (bytes, mtime, inode) and no key of `ui-state.json`. In Složené, setting (2) to List leaves (1) in Map. After opening Lisabon and going Back, Výjezd is still in List; after a relaunch (L6) or opening another vault and coming back, it opens in Map. A reload caused by an external change to another block of Výjezd keeps List. *(L5; L6 for relaunch)*
- **AC-8** **Read view: always Map, links clickable (D-684).** Neplatná mapa opens per NFR-REL-03 (source view with its warning); switching to the formatted read view shows its mindmap as a `figure` with the `tree` and no `Mindmap view` group; nodes are not editable and clicking a node changes nothing (no route change, no IPC write); clicking the chip `Výjezd 2026` (or ⌘↩ on its focused node, AP-731) opens `note/Pages/Výjezd 2026.md`. *(L5)*
- **AC-9** **What a node shows (D-682; AP-735).** Uzly's 11 child nodes, in order: (a) `strong` `Tučně`, `,`, `code` `kód`, ` a `, `mark` `zvýraznění`; (b) `Odkaz na `, a resolved link chip `Lisabon` (D-600, Page icon), ` a `, a tag chip `#cestování` (neutral, FR-TAG-05); (c) `Termín ` and the date-link chip of `[[2026-10-20]]` (not broken; daily-notes FR-DLY-08); (d) `Úkol ` and the chip of `Zalít květiny` with the task box icon and the suffix `Today · To do` (`Today` in the link colour, semibold; D-600), with no embedded content; (e) `Fotka ` and a file chip `fotka.png` (AP-735), no file read; (f) the long text on 3 lines in a 200 px node (R92), nothing cut; (g) `Odstavec navíc …`, (h) `Položka s kódem …`, (i) `Položka s citací …`, each with the description `More in the list` and none of the second paragraph, code or quote text; (j) the broken-link chip `Neexistuje` (D-73 broken style, description `No note named Neexistuje`); (k) `Řádek jedna` and `řádek dva` on two lines, no `…` (AP-735). Nákup's nodes show boxes, checked for `Mléko` and `Sýr` (`[X]`) and unchecked for `Nákup` and `Chléb`, with the descriptions `Checked` / `Not checked`; clicking a box never toggles it (it acts as a node click, AP-731) and writes nothing. Postup's nodes are `Postup`, `Krok jedna`, `Krok dva` with no `1.` or `2.` (AP-735). *(L1 for the node content model; L5)*
- **AC-10** **Links in nodes are links (D-682).** In Výjezd's Map, clicking the chip `Lisabon` opens `note/Pages/Lisabon.md` (records `nav_opened`, D-138) and doesn't switch to List; clicking elsewhere on that node switches to List (AC-5). In Uzly, clicking `#cestování` opens `tag/cestování`, the date chip opens `daily/2026-10-20` without writing (FR-DLY-08), `Neexistuje` opens the Create offer (backlinks.md FR-LNK-04 AC-4), `Zalít květiny` opens the task. *(L5)*
- **AC-11** **Deterministic layout (D-683; R92 golden; AP-738).** With the Measurer, the layout of Strom and Zalomení equals R92's boxes, lines and connector points exactly; laying out the same list twice, in another time zone, theme or window width, or after a load–save round trip of the file, gives an identical result (deep equality). In the app, each node's rendered box is within ±1 px of the layout computed with the real measurer for that render. Nothing of the layout is written to the vault or Application Support (R-08). *(L1; L5 for the rendered boxes)*
- **AC-12** **Colours by position, light and dark (D-683; R92; AP-736).** In both themes, each node's computed background, text colour and border equal R92's tokens for that theme: Výjezd's root inverse (`text` background, `bg` text), `Program` blue, `Místo` orange, `Doprava` purple, the depth-3 nodes neutral; Více kořenů's synthesized root inverse and `Rodina` blue, `Práce` orange, `Zdraví` purple, `Porady` neutral; Paleta's eight branches as R92. The connectors are drawn with the `muted` token. *(L5 computed styles)*
- **AC-13** **Wide maps scroll inside the block (D-683; AP-736).** For the runtime `Široká mapa` in the 560 px text column, the map area's `scrollWidth` exceeds its `clientWidth` and is at least 1,700 px, its `overflow-x` is `auto`, the page itself has no horizontal scroll (`document.scrollingElement.scrollWidth` equals the viewport width) and the note column's width is unchanged; the map area has no vertical scrollbar and the block's height equals header + map height + 24 px. Focusing the last node (AC-15) scrolls it into view inside the map area. *(L5)*
- **AC-14** **500 nodes (D-683; AP-738).** For the runtime `Velká mapa` (500 nodes): the layout of the map, measuring included, has a p95 of 20 runs ≤ 16.7 ms on the reference machine (reported with `TEGG_PERF_LOG` mark `mindmap-layout`; report-only until MS8, D-152); opening the note meets NFR-PERF-05 AC-4's `note-ready` budget (reported); typing in its List view meets NFR-PERF-06 AC-4's frame rule in WebKit. *(L5 benchmark every push, report-only; L6 benchmark with `TEGG_PERF_REF=1`)*
- **AC-15** **Keyboard (FR-UX-03; AP-731).** Tab reaches, in order, `Map`, `List` and the tree (one stop, focus on the root). In Výjezd's tree, ↓ moves through the nodes in outline order, ↑ back, → to the first child, ← to the parent, Home / End to the first / last node; the focused node has a visible indicator (app-shell FR-UX-03 AC-13 (b)). ⏎ or Space on `Program` does AC-5's switch with the caret at the end of `Program`; ⌘↩ on `Lisabon` opens Lisabon. Link chips inside nodes are not separate Tab stops. Esc in the List view's list leaves the caret where it is (no view change). *(L5)*
- **AC-16** **In an embedded note (AP-730).** In Vložení, the full embed of Výjezd shows its mindmap as a mindmap block in Map with the same tree as AC-1; switching that embedded block to List and typing follow embeds.md's editing rules and change only the callout bytes of `Pages/Výjezd 2026.md`; Vložení's file is untouched. *(L5)*
- **AC-17** **Folding (D-680, editor.md FR-EDT-02 AC-19).** Složené (1) starts collapsed: the header with `Expand Složená mapa` and the view switch, no tree and no list; activating it shows the Map; (2) starts expanded with `Collapse Rozbalená mapa`. Folding and unfolding write nothing and never change `+` or `-`. *(L5)*
- **AC-18** **What an edit rewrites (AP-727; T1).** (a) W11 on Výjezd changes only line 6 of the body (counted from the first line after the frontmatter) and `modified`. (b) In Z Obsidianu, typing ` nový` at the end of `List` rewrites only the callout's byte range (the tab-indented lines may become canonical space-indented lines, AP-727); the saved callout parses to the same tree with `List nový`; every byte outside the callout is unchanged. A second edit afterwards changes only the edited line. (c) In Holá mapa, typing ` a západ` after `Jih` saves the first-edit frontmatter of editor.md FR-FMT-02 AC-5 (`id`, `type: page`, `modified`) followed by the original body with only that line changed. (d) In a runtime CRLF copy of Výjezd without a final newline, W11 keeps CRLF on every line and the missing final newline. *(L1; L5)*
- **AC-19** **Block → object inside a mindmap (AP-739).** With the caret in `Přehled Q4` in Výjezd's List, the toolbar's and the slash menu's `Turn into object` and ⇧⌘T are `aria-disabled` with `Coming in v1.0` and change nothing; the block menu's `Turn into object` on the whole mindmap block converts it as conversion.md converts a callout. *(L5)*
- **AC-20** **Paste (AP-734).** In Výjezd's List with the caret at the end of `Doprava`: pasting `text/plain` `- Vlak\n- Letadlo\n  - Přestup` saves `>   - Vlak\n>   - Letadlo\n>     - Přestup` after `>   - Doprava`; pasting `Auto\n\nKolo` saves the items `>   - Auto` and `>   - Kolo`; pasting one line `Bus` inserts it at the caret (`>   - DopravaBus`); pasting `` # Nadpis\n\n```\nx\n``` `` puts the heading and the code block after the mindmap block (as pasting into any callout does), and the callout's bytes are unchanged. In Map, ⌘V changes nothing and sends no write. Copying Výjezd's mindmap block (block selection, ⌘C) and pasting it into Prázdná creates a mindmap block with the same source bytes. *(L5)*
- **AC-21** **Node text is note text (D-682).** Search for `Přehled Q4` lists Výjezd 2026; `cestovani` (folded) as a tag filter or text finds Uzly; the switcher doesn't match node text (titles only). `extract()` of Výjezd lists the link `Lisabon` with `block` pointing at a `listItem` excerpt block (ms4-links §2.1): no extractor change. *(L4)*
- **AC-22** **Editing keeps one list (AP-733).** In Více kořenů's List: with the caret at the end of `Zdraví`, ⏎ creates an empty top-level item, and ⏎ in it removes that item and puts the caret in a new empty paragraph after the mindmap block; the file is unchanged (zero `note_write` after the autosave delay). ⇧Tab in `Rodina` (top-level) changes nothing. After `/mindmap` in Prázdná (W1), ⌫ in the empty item turns the block back into an empty paragraph and the body returns to empty (one undo step). In a titled mindmap whose only item is empty (Rozpoznání's `Prázdná`), ⌫ there moves the caret to the end of the title and ⏎ to a new paragraph after the block; the block and the file are unchanged (D-780). `/code` in the item `Porady` nests a code block in that item; the map shows `Porady …`. The block never becomes a hint callout through these keys. *(L5)*

### FR-MMP-04 Mindmap in a type's template (D-92, D-685)

- **AC-1** **Copied verbatim.** Creating a Projekt titled `Nový projekt` from `type/projekt` (types.md FR-TYP-09 AC-6, D-520 draft rules) writes `Projekty/Nový projekt.md` whose body equals Šablona's bytes exactly (`> [!mindmap] Cíle projektu\n> - Cíle projektu\n>   - Proč\n>   - Co\n>   - Kdy\n`); the new note shows the mindmap block in Map with the root `Cíle projektu` and three children. Šablona is untouched and never listed in Search, backlinks or switcher results (FR-TPL-07). *(L5; L4 for the bytes)*

### FR-LNK-01 Backlinks from nodes (D-682; adds to backlinks.md)

- **AC-27** [MS5] **Node links are backlinks.** Lisabon's Backlinks panel lists exactly `Pages, 2`: Výjezd 2026 and Uzly (each once); Stará mapa (`.trash/`, D-102) and Šablona aren't listed. A runtime note `Pages/NFD odkaz.md` holding `> [!mindmap]\n> - [[Lisabon]]` with `Lisabon` in NFD bytes adds a third entry within 2 s. The Broken links page lists Uzly's `[[Neexistuje]]` with the excerpt `Neexistuje` (the list item's own text, D-277: no `>`, `-` or child items). The panel query returns the same after the index is rebuilt (AR-01). *(L4; L5 for the panel)*

### FR-LNK-03 Renames reach node links (D-682; adds to rename.md)

- **AC-21** [MS5] **Rename rewrites inside the callout.** Renaming Lisabon to `Lisabon 2027` renames the file to `Pages/Lisabon 2027.md` with `title: Lisabon 2027` and changes exactly: Výjezd's body line 9 to `>     - [[Lisabon 2027]]`, Uzly's line to `>   - Odkaz na [[Lisabon 2027]] a #cestování` (`modified` per rename.md AC-7); Stará mapa and every other file are untouched. With Výjezd open in Map, the node shows `Lisabon 2027` within 2 s (D-386). Undo restores every written file's sha256. *(L4 by byte diff; L5 for the open note)*

### FR-FMT-07 Round-trip with mindmaps (slice MM)

- **AC-24** [MS5] **Viewing and loading never rewrite (T1).** (a) Every fixture file parsed and serialized without edits is byte-identical, including Z Obsidianu's tabs, Rozpoznání's ten callouts and the runtime CRLF and NFD copies. (b) Opening every fixture note in the editor and leaving it sends zero `note_write`; no mindmap block of R90 is a read-only source block (the Mermaid `mindmap` fence is the only one in the fixture, AC-5). (c) Property: for random mindmap callouts (depth 1–5, 1–40 items, Czech words in NFC and NFD, markers `-`, `*`, `+`, `1.`, `1)`, checklist items, 2- and 4-space and tab indents, titles with and without fold markers, CRLF and LF, with and without a final newline), load + save without edits is the identity; an edit of one item changes only bytes inside the callout and reads back to the same tree with only that item changed; wrapping a random list and unwrapping it again returns its original bytes when the mindmap has no title (AP-728); the layout of the tree read back equals the layout before the save. *(L1; L5 for (b); L2 for (c))*

### FR-SYN-06 No writes but the user's (slice MM)

- **AC-33** [MS5] **A browsing tour writes nothing.** On the built app with a copy of the fixture: open every note; switch every mindmap block to List and back; click nodes; move through every tree with the arrow keys; scroll Široká mapa's map area; fold and unfold Složené; open the block menu, `Turn into` and `Callout type` on Výjezd's block and close them with Esc; follow `Lisabon` and go Back; open Neplatná mapa and its read view; open Vložení. Every vault file's bytes, mtime and inode are unchanged, nothing is created, and `ui-state.json` gains no mindmap key. *(L6; L5 counts zero write calls)*

### FR-UX-03 Mindmap commands (adds to app-shell.md and editor.md)

- **AC-15** [MS5] **Reachable by keyboard and palette (R94; AP-731).** The palette lists `Show mindmap as map` and `Show mindmap as list` on a note route; with the caret in Výjezd's block they switch it and move the focus to the tree (Map) or put the caret at the end of the root item (List); with the caret outside any mindmap they aren't run and show no error. app-shell FR-UX-03 AC-8 passes on Výjezd in both views (the `Map` and `List` buttons carry those commands). A keyboard-only run (no pointer events) inserts a mindmap with `/mindmap` ⏎, types `Kořen`, ⏎, Tab, `Větev`, switches to Map with the palette, moves to `Větev` with ↓ and returns to List with ⏎; the saved block is `> [!mindmap]\n> - Kořen\n>   - Větev`. *(L5)*

### FR-UX-05 Themes for mindmaps (adds to app-shell.md)

- **AC-10** [MS5] **Both themes, measurable contrast (D-129; AP-736).** Token check, in light and dark: `bg` on `text` (root), each `type-<c>` on `type-<c>-bg` for the seven palette colours, `text` on `bg` (deeper nodes), `text` and `muted` on `embed` (header), `muted` on the hint callout's background are each ≥ 4.5:1; the connector token `muted` on `bg` is ≥ 3:1 (WCAG 1.4.11). axe `color-contrast` reports no violation, and FR-UX-05 AC-5 (no colour leaks) passes, on Výjezd in Map and List, Uzly, Nákup, Paleta, Rozpoznání and the empty state, in both themes. No colour literal is added outside the token module (FR-UX-05 AC-2). *(L1 tokens; L5)*

### NFR-OTH-02 Strings of mindmaps (adds to app-shell.md and editor.md)

- **AC-7** [MS5] **Catalog only.** Every R94 text is a catalog key; with the pseudo-locale, every visible text node and accessible name of the mindmap block, the slash row and its description, the `Callout type` entry, the commands and the hint is inside `⟦ ⟧`, except user content (titles, node text, link and tag names). *(L1 for the keys; L5)*

---

## What changes in earlier criteria, tests and fixtures

Made in slice MM's red-test commit (or the build commit for the registry), as the plan's §4 says; test changes carry `AC-Test-Change: slice MM, mindmaps are [!mindmap] callouts drawn by Tegg (D-679…D-687); approved-by: owner`, fixture changes `Fixture-Change:` (TS-D4).

**AC tests** (the plan's §4 list, plus the four marked *new*):

| Test | Change | Reason |
| --- | --- | --- |
| `packages/doc/test/links.ac.test.ts` `fr_fmt_05_ac1_mermaid_block_starting_with_mindmap_is_a_mindmap_block` | Renamed `fr_fmt_05_ac1_mindmap_is_a_callout_holding_one_list`: the Mermaid pair parses as `['raw', 'code']`, and a `> [!mindmap]` callout with one list parses as `mindmap` | D-679, D-680 |
| `packages/doc/test/corpus.static.ac.test.ts` `ar_06_ac1_tegg_notes_use_every_mvp_block_type` | `mindmap: /^> \[!mindmap\]/m` instead of the Mermaid pattern | D-679; follows the fixture change below |
| `app/test/shell-tables.ts` (R5 table) | `R5Row.id` is `'query'` only; the `mindmap` row is removed | D-679 (R5 row goes) |
| `app/test/embeds_registry.ac.test.ts` (R5 ids) | Expects `['query']` | D-679 |
| `app/test/read_view.ac.test.ts` `fr_edt_02_ac13_r5_placeholders_render_with_their_parts` | Bloky's placeholders are `['query']` | D-679 |
| `app/test/read_view.ac.test.ts` `fr_edt_02_ac4_code_tables_and_dividers` | Adds: Bloky's Mermaid `mindmap` block is a code block with its text exact (`mindmap\n  root((Mapa))\n    Větev`) | D-679 |
| `app/test/editor_registry.ac.test.ts` (R6 rows) | `['advanced', 'Mindmap', …]` is built (no milestone) | D-685 |
| *new* `packages/editor/test/links.ac.test.ts` `fr_edt_03_ac5_slash_items_are_r6_with_milestones` | Its R6 mirror: `['advanced', 'Mindmap', null]` | D-685 |
| *new* `app/webkit/editor.ac.test.ts` `fr_edt_01_ac8_source_blocks_and_placeholders` | Surové bloky has **6** source blocks (the Mermaid `mindmap` fence joins the 5) and at least **1** R5 region (query) instead of 2 | D-679 (the fence is a read-only source block) |
| *new* `packages/editor/test/load.ac.test.ts` `fr_edt_01_ac2_normalization_guard_is_exactly_the_ragged_table` | The skip list loses `'mindmap'` (a mindmap is an editable callout now; a read-only one would be a regression) | D-684 |
| *new* `packages/editor/test/embeds.ac.test.ts` (the `ui()` stub) | The `placeholder` kind type loses `'mindmap'` when the contract's type does (type-only; no assertion changes) | D-679 |
| `app/test/read_view.ac.test.ts` `fr_edt_02_ac3_quote_and_callouts` | No change if `mindmap` is kept out of `CALLOUT_TYPES` (the 13 Obsidian types) and the submenu's 14th entry comes from its own list, as recommended; it changes only if the implementation adds `mindmap` to that constant | D-680 |

**Fixtures:**

| Fixture | Change | Reason |
| --- | --- | --- |
| `tests/fixtures/format/roundtrip/tegg/Pages/Every block type.md` | Lines 49–55 (the Mermaid fence) become `> [!mindmap] Trip\n> - Trip\n>   - Flights\n>   - Hotel\n>     - Booking`; README row "query and mermaid blocks" → "query and mindmap blocks". If `tests/fixtures/format/extract/expected.json` covers this file it is regenerated (no links or tags change) | D-679 (Tegg's canonical output is the callout) |
| `tests/fixtures/vaults/obsidian-check/Pages/Myšlenková mapa a dotaz.md` and `packages/doc/scripts/make-obsidian-check.ts` | The generator writes a `[!mindmap]` callout (title, one top-level item, two levels, a `[[link]]`) instead of the fence; the owner rechecks FR-FMT-05 AC-3 on it (D-686) | D-686 |
| `tests/fixtures/vaults/read-view/Pages/Bloky.md` | **Bytes unchanged** (AP-740): its two Mermaid fences now show as code; only its description changes (read-view.md fixture table, `tests/fixtures/vaults/README.md`: "two Mermaid code blocks") | D-679 |
| `tests/fixtures/vaults/editor/Pages/Surové bloky.md` | Bytes unchanged; the description "mindmap" becomes "a Mermaid `mindmap` fence (a read-only source block)" | D-679 |
| `tests/fixtures/vaults/mindmap/` | New (this slice) | — |

**Criteria text** (doc changes in the same commit): file-format.md FR-FMT-05 AC-1 (the "from slice MM" wording becomes the criterion); read-view.md R5 (the `mindmap` row removed) and its Bloky row; editor.md R6 (`Mindmap` built, writes W1), FR-EDT-01 AC-8 (the mindmap is a source block, not a placeholder), FR-EDT-02 AC-19 (14 entries), the Surové bloky row; `docs/contracts/ms1-core.md` (`mindmap` = the callout) and `docs/contracts/ms3-shell.md` (`IN_NOTE_PLACEHOLDERS`, the editor's `placeholder` kinds, block menu); `docs/requirements-coverage.md` rows FR-MMP-01, -02, -04.

---

## Points raised by these criteria (AP-726…AP-740, decided as D-765…D-779)

Numbering continues after AP-725 (v0.68 feedback); AP-686…AP-706 are the open v1.0 graph points. Next free AP after this list: AP-741. The owner accepted every recommendation on 2026-10-25 (D-765…D-779, BRD v1.95), including the AC-test and fixture changes listed above under one `AC-Test-Change` approval.

| # | Issue | Recommendation | Alternatives | Affects |
| --- | --- | --- | --- | --- |
| AP-726 → D-765 | **The title line and the first item (T1).** In CommonMark an empty list item can't interrupt a paragraph, and a numbered list can only interrupt one when it starts at 1. So `> [!mindmap]\n> -` (the empty item `/mindmap` inserts) reads as a **setext heading** `[!mindmap]`, and `> [!mindmap] T\n> 2. x` as one paragraph. The editor's callout reader (`convert.ts`) would then see no callout or a joined paragraph, and save verification would refuse the first autosave after `/mindmap` (NFR-REL-03 AC-9). Obsidian reads the title line separately and shows both as lists. | (a) For a callout of type `mindmap`, Tegg reads the lines after the title line as the body on their own (Obsidian's reading): Rozpoznání (5) and (6) are mindmaps. (b) Tegg never writes an empty item: an empty mindmap is written as its title line alone (`> [!mindmap]`), shows the empty state, and its empty item lives only in the editor until it has text, like an empty paragraph (AP-135). The Rust extractor needs no change (links and tags are the same in both readings). | (b) Write a separator line `>` after the title whenever the first item is empty or the list starts at a number other than 1 (pure CommonMark; a visible blank line in Obsidian). (c) Keep CommonMark: such callouts are hint callouts, and `/mindmap` writes nothing until the first item has text. | R90, R93 W1, FR-FMT-05 AC-4, FR-MMP-01 AC-1, FR-MMP-02 AC-3, AC-22 |
| AP-727 → D-766 | **How much an edit rewrites (T1).** The plan (§1) says only the edited items change. The editor re-serializes a changed top-level block whole (ADR 0002, dialect §1.5), and the callout is one block, so the first edit of a mindmap written elsewhere (Obsidian's tab indents, `*`/`+` markers, 4-space indents) rewrites the whole callout in canonical form, as editing any list does today. | Accept the block-level rewrite (as for lists): bytes outside the callout never change, the rewritten callout reads back to the same tree with only the edited item changed, and once canonical, later edits change only the edited lines (FR-MMP-02 AC-18). | (b) Item-level patching inside callouts, keeping tabs and markers (new work in `@tegg/doc` and the save path; T1 risk in the most-used block). | FR-MMP-02 AC-18, FR-FMT-07 AC-24 |
| AP-728 → D-767 | **Wrap and unwrap bytes, and the title on unwrap (T1).** D-685 says a list is wrapped "unchanged" (bytes or items?), and that `Turn into → Bulleted list` unwraps, which would drop a titled mindmap's title and doesn't say what happens to a numbered or checklist list. | Wrap = prefix every line of the list's source with `> ` (`>` for an empty line) and add the title line above; the list's own bytes are kept. Unwrap = remove the prefixes and the title line; a non-empty title becomes a paragraph above the list, so no text is lost. `Turn into › Bulleted list / Numbered list / Checklist` unwraps and gives the list that kind (no change when it already is; otherwise re-rendered in that kind, as `Turn into` on a list does). An untitled wrap followed by an unwrap returns the original bytes. | (b) Re-render the list canonically on wrap. (c) Drop the title on unwrap (undo brings it back). | R93 W2…W8a, FR-MMP-01 AC-2…AC-4, FR-FMT-07 AC-24 |
| AP-729 → D-768 | **Where `Turn into › Mindmap` is offered.** D-685 names lists and text blocks, one block or a selection; mixed selections, quotes, code, callouts and a mindmap itself aren't covered. | Listed after `Checklist` for one list, one paragraph or heading, and a selection of only paragraphs and headings; on a mindmap it is shown checked and does nothing; not listed for quotes, callouts (they use `Callout type`), code, tables, embeds, dividers and source blocks; `aria-disabled` for a selection that mixes a list with other blocks or holds two lists. | (b) Mixed selections: paragraphs become items and the lists' items are appended in order. | FR-MMP-01 AC-7 |
| AP-730 → D-769 | **Nested and embedded mindmaps; `/mindmap` inside containers.** D-680 doesn't say whether a `[!mindmap]` callout inside a quote, callout or list item is drawn, whether an embedded note's mindmap is drawn, or where `/mindmap` typed inside a list item or a mindmap puts the block. | Drawn only as a top-level block of a note's body, also inside an embedded note shown in full or as a section; nested in a quote, callout or list item it is an ordinary callout with the mindmap icon and no hint. `/mindmap` inside a list item, quote, callout or mindmap inserts the new mindmap after the containing top-level block, caret in its item (as pasted blocks go after a callout). | (b) Draw nested mindmaps too (layout and editing inside list items). | R90, FR-MMP-01 AC-7, FR-MMP-02 AC-16 |
| AP-731 → D-770 | **Keyboard and pointer on the map.** D-684 says a node click goes to List; FR-UX-03 asks for keyboard access; read-view links in nodes must be clickable, but a link inside a clickable node is a nested control; a click on a checkbox isn't defined; FR-UX-03 AC-8 wants every control to be a command. | The map is a `tree` `Map of <title>`, one Tab stop with roving focus: ↑/↓ outline order, → first child, ← parent, Home/End. ⏎ or Space = node click (editor: List with the caret; read view: nothing); ⌘↩ opens the node's first link in both views. Link chips are pointer targets that open their link, not Tab stops; a click elsewhere on a node is the node click. The checkbox is drawn (`aria-hidden`), the node's description says `Checked` / `Not checked`, and a click on it is a node click, never a toggle. `Map` and `List` are Tab-reachable buttons bound to new palette commands `Show mindmap as map` / `Show mindmap as list` (no shortcut). | (b) Nodes as a flat row of buttons in Tab order (simpler; long Tab runs on big maps). (c) No keyboard access to nodes (List is the keyboard path; read-view links then can't be reached by keyboard). | R91, R94, FR-MMP-02 AC-9, AC-10, AC-15, FR-UX-03 AC-15 |
| AP-732 → D-771 | **The title, and a click on a synthesized root.** D-681 says the synthesized root isn't editable on the map; how the title is edited and written, and what a click on that root does, isn't said. | The title is the header's text: editable in place in List (single line, like a callout title, FR-EDT-02 AC-19), read-only in Map; only the first line is written, `> [!mindmap] <title>`, and an emptied title writes `> [!mindmap]` with no trailing space; the fold marker and the type's spelling are kept; an empty title shows `Mindmap` in `muted`. Clicking a synthesized root switches to List with the caret at the end of the title when the root is the callout title, or at the start of the first item when it is the note title (edited in the note's Title field). | (b) The title editable in the header in both views. | R91, R93 W9…W9d, FR-MMP-01 AC-9, FR-MMP-02 AC-2 |
| AP-733 → D-772 | **List keys that would break "one list".** In an ordinary list, ⏎ on an empty last item ends the list (FR-EDT-02 AC-17) and ⇧Tab on a top-level item lifts it out; inside a mindmap both leave a paragraph in the callout, which turns it into a hint callout (D-680). ⌫ in the only empty item isn't defined. | Inside a mindmap: ⏎ on an empty top-level item removes it and puts the caret in a new empty paragraph after the block; ⇧Tab on a top-level item does nothing; ⌫ at the start of the only, empty item turns the block into an empty paragraph (one undo step). Blocks nested in an item (a second paragraph, `/code`) stay allowed and show `…` on the map. | (b) Plain list behaviour; the block falls into the hint state and the user fixes it. | FR-MMP-02 AC-22 |
| AP-734 → D-773 | **Paste into a mindmap.** Today pasted blocks inside a callout go after the callout (`editor.ts` paste rule), so pasting a list into a mindmap would land outside it; plain multi-line text isn't covered either. | In List: a clipboard that parses to only lists, paragraphs and headings becomes items after the caret's item at its level (nested lists keep their nesting, paragraphs and headings become items); a single line is inserted at the caret; a clipboard with any other block goes after the mindmap block (the current rule). In Map, paste does nothing. | (b) Keep the current rule for every multi-block paste (everything after the block). | FR-MMP-02 AC-20 |
| AP-735 → D-774 | **Node content details.** D-682 says an item holding more "shows its first line and `…`" (the first source line, or the first paragraph?); it doesn't cover hard breaks, empty items, image or PDF embeds, numbered-list numbers, or an item holding two child lists. | (1) The whole first paragraph is drawn, wrapped; a hard break is a line break; ` …` is appended when the item holds other blocks besides its child lists, with the description `More in the list`. (2) An item without text is an empty node (48 px). (3) Image, PDF and other attachment embeds show a file chip (`image` / `file` icon and the file name), never the picture. (4) Numbered lists draw no numbers (order is top to bottom). (5) An item's children are the items of every list directly inside it, in file order. | (1) Only the first source line, then `…`. (4) Numbers drawn as `1.` prefixes. | R92, FR-MMP-02 AC-9 |
| AP-736 → D-775 | **Geometry, branch palette, connectors, block height.** D-682/683 say "fixed node width" and "palette colour by position" without numbers; the board draws connectors in `faint`, about 2.8:1 on white, under WCAG 1.4.11's 3:1 for graphics that carry meaning (D-129 keeps `faint` for decorative icons and disabled controls); no maximum height is set. | R92's numbers, taken from the Main board (32 px one-line nodes, 60 px column gap, 8 px row gap, elbow connectors, width up to 200 px, wrapping at 180 px of text); branch palette `blue`, `orange`, `purple`, `teal` (the board's four), `green`, `yellow`, `red`, then again; nodes below the first level neutral; connectors 1.5 px in `muted`; no maximum block height (the page scrolls; the map scrolls only horizontally). | (b) Connectors in `faint`, treated as decorative. (c) A maximum height of 480 px with vertical scrolling inside the block. | R92, FR-MMP-02 AC-11…AC-13, FR-UX-05 AC-10 |
| AP-737 → D-776 | **View state, caret on a node click, live re-render.** D-684 says the view "lasts for the session" (the app run, or the visit to the note?), "caret in that item" (where in it?) and "debounced" (how long?). | Session = while the app runs: kept in memory per note `id` (path for files without one) and the block's ordinal among the note's mindmaps, never in `ui-state.json`; it survives navigation and external reloads and resets on relaunch and vault switch; a mindmap made by `/mindmap` or `Turn into` starts in List. A node click puts the caret at the end of the item's first paragraph. The map under the list re-lays out 150 ms after the last change, so it reflects the list within 500 ms. | (b) Back to Map on every visit. (c) Stored per machine in `ui-state.json` across relaunches. | FR-MMP-02 AC-5…AC-7 |
| AP-738 → D-777 | **Test layers of the layout and the frame budget.** D-683 says the layout is "tested at L4", but L4 is integration on a real filesystem (test-strategy §4) and the layout is UI code; "within one frame" isn't defined as a measurement. | The layout is a pure function tested at L1 against R92's golden values with the Measurer; L5 checks the rendered boxes against it; the 500-node budget is the layout's p95 over 20 runs ≤ 16.7 ms (one 60 Hz frame, no D-59 factor, D-66), reported at L5 on every push and at L6 on the reference machine, report-only until MS8 (D-152). | (b) Enforce the budget from MS5. | FR-MMP-02 AC-11, AC-14 |
| AP-739 → D-778 | **Block → object inside a mindmap.** conversion.md AP-420 extends a selection inside a callout to the whole callout, so `Turn into object` with the caret in a mindmap item would convert the whole mindmap; D-687 keeps node → object for v1.0. | In a mindmap's list, `Turn into object` (toolbar, slash, ⇧⌘T) is `aria-disabled` with `Coming in v1.0`; the block menu's `Turn into object` on the whole mindmap block works as for any callout. | (b) Allow item conversion now (FR-MMP-03 early: the item becomes `![[Title]]`, a chip on the map). | FR-MMP-02 AC-19 |
| AP-740 → D-779 | **Two departures from the plan's §4 lists.** The plan lists `Bloky.md` among the fixtures that change; adding a mindmap callout there would also change read-view FR-EDT-02 AC-3 (six callouts) and AC-13. And four more AC tests than §4 names depend on the old `mindmap` kind (the *new* rows above). | Keep `Bloky.md`'s bytes (its Mermaid fences become the "Mermaid shows as code" check; mindmap rendering is tested on the new `mindmap/` fixture) and approve the full list of test changes above in one `AC-Test-Change` approval. | (b) Add a `[!mindmap]` callout to `Bloky.md` and change read-view AC-3 and AC-13 with it. | "What changes" tables |

---

# Slice MM2: editing on the map and two layouts (D-785…D-792)

**Status: drafted 2026-10-26 from the owner's decisions D-785…D-792 (AP-741…AP-748, `docs/plans/mm2-map-editing-and-layouts.md`, board `MindmapLayouts` as redrawn that day; BRD v1.99).** Writing these criteria raised AP-749…AP-751 (end of this section); the owner accepted every recommendation on 2026-10-26 (D-793…D-795, BRD v1.100). A criterion naming an AP follows that decision.

**Scope.** FR-MMP-02's MM2 part: keyboard editing on the map (D-786…D-788), the `right` and `spider` layouts (D-789, D-790), the layout stored as callout metadata (D-791) and the switch (D-792); FR-FMT-05 (metadata), and the MM2 parts of FR-FMT-07, FR-SYN-06, FR-UX-03, FR-UX-05, NFR-OTH-02, NFR-POR-01 and NFR-PERF. **Out of scope (v1.0, D-785):** drag to re-parent, collapse, zoom and pan, node → object, export, full screen, `[[` and `#` autocomplete and the floating toolbar on the map, the checklist toggle on the map, a vault-wide default layout.

**Interfaces.** The MM contract (`docs/contracts/mm-mindmap.md`) gains §6: `MindmapTree.layout` and `meta`, `layoutMindmap(tree, measure, { layout })` with a `side` per node, the editor commands for the map edits and the layout switch, and the `MindmapCtl` hooks; named by the red-test author before the red tests (D-61). Test layers, clock, window and fixture are those of slice MM above; the fixture gains Pavouk, Neznámé metadata and Metadata (README).

**Shared definitions (added).**
- **Layout** = `right` or `spider` (D-789). **Side** of a node in `spider`: `right` or `left` for every node under a first-level branch, by the branch's position; the root has no side.
- **Focused node** = the `treeitem` that holds the tree's roving focus (D-770). **Editing** = the node's text field is open (R95).
- **Layout switch** = the header's `radiogroup` `Mindmap layout` (R97).

## Reference tables

### R95. Keys and pointer on the map (D-786…D-788, D-790; replaces the ⏎ / Space / click rows of D-770)

The map must be in the editor (not the read view, not a read-only note) for every row but navigation. Every edit is the list edit the List view would make (D-786): the bytes of R93 and R98, the rewrite rule D-766, one undo step, ⌘Z / ⇧⌘Z with the map focused. After an edit the map stays in Map, re-laid out at once, with the focus on the edited node (on the node named in "Focus after").

| Key / pointer | On a focused node | Writes | Focus after |
| --- | --- | --- | --- |
| ↑ ↓ Home End | outline order, first / last node (D-770) | nothing | the reached node |
| ← → in `right` | parent / first child (D-770) | nothing | the reached node |
| ← → in `spider` | right side: → first child, ← parent; left side: ← first child, → parent; root: → first right-side branch, ← first left-side branch; no node that way: nothing (D-790) | nothing | the reached node |
| ⏎ | a new empty sibling after the node, editing; root item: a new first child, editing; synthesized root: a new top-level item at the end, editing | nothing until a character is committed (R98 W15…W15b) | the new node |
| Tab | a new empty child at the end of the node's children, editing | nothing until committed (W16) | the new node |
| Space, F2 | editing the node's text (the field of R95a); synthesized root: nothing | nothing until committed | the node |
| ⌫, Delete | a node without children: removed (W18); a node with children, the root, the synthesized root: nothing | W18 | the previous sibling, else the parent |
| ⌥↑, ⌥↓ | the node and its subtree move one place among its siblings; first / last: nothing | W19 | the node |
| ⌥→ | the node and its subtree become the last child of the previous sibling; first child: nothing | W20 | the node |
| ⌥← | the node and its subtree become the sibling after its parent; first-level node, root: nothing | W21 | the node |
| ⌘↩ | opens the node's first link (D-770) | nothing | — |
| ⌘Z, ⇧⌘Z | undo / redo the last edit, map stays in Map | the inverse bytes | the node of the undone edit |
| Esc | editing: cancels (R95a); else: nothing | nothing | the node |
| click | focuses the node (no view change; AP-750: `List` afterwards puts the caret at the end of that item) | nothing | the node |
| double-click | editing the node's text | nothing until committed | the node |
| click on a chip | opens its link (D-770) | nothing | — |
| checklist box | drawn, read-only, a click is a node click (D-770) | nothing | the node |

**R95a. The text field (D-788).** A single-line `textbox` `Edit node` inside the node, holding the item's first paragraph's **Markdown source** (the line's bytes after the list marker and before the first line break; `[[Lisabon]]`, `#cestování`, `**Tučně**` as written; NFC); the caret at the end; the node keeps its tone and box, the width growing with the text to R92's 200 px, then wrapping as the node does. ⏎ commits; Esc cancels and keeps the old text (nothing written); Tab commits and adds a child (the Tab row); ⇧Tab commits; a click outside the field commits; leaving the note commits. A committed text equal to the old text writes nothing. An item with more than its first paragraph (`more`, D-774) edits its first paragraph only; its other paragraphs, nested lists and `more` marker are unchanged. A new node (⏎, Tab) committed empty, or cancelled, is removed again and nothing is written (AP-751). No autocomplete, toolbar, date mention or slash menu opens in the field; `[[`, `#`, `/` are typed as text.

### R96. The `spider` layout (D-789, D-790; board `MindmapLayouts` B)

Everything of R92 (box, wrap, tones, connector style) holds. Differences:

- **Sides:** the root's children (with a synthesized root: the top-level items) take sides in outline order: the 1st, 3rd, 5th… `right`, the 2nd, 4th… `left`. Every descendant takes its branch's side. Tones stay R92's (by position in outline order, whatever the side).
- **Right side:** laid out as R92 (columns to the right of the root, stacked from y = 0).
- **Left side:** the mirror image: column d's **right edge** is at x; a node's x = right edge − its width; x(left d1 right edge) = (widest left depth-2 node) + 60 + (widest left depth-1 node), and so on outwards, the outermost left column's right edge being its widest node's width; the root's x = (left d1 right edge) + 60. Stacked from y = 0 by R92's row rules.
- **Vertical centring:** H = max(right height, left height); the taller side starts at y = 0, the other side is shifted down by (H − its height) / 2; the root's y = (H − root height) / 2. Width = root x + root width + 60 + the right columns (as R92), or root x + root width when there is no right side.
- **Connectors:** right side as R92. Left side mirrored: from the parent's **left** edge at its centre, horizontally to (child column's right edge + 30), vertically to the child's centre, then horizontally to the child's **right** edge; the root's left-side connectors leave its left edge. Points are the four of R92 even when the vertical segment has zero length.
- **Golden values** with the Measurer (L1), boxes as (x, y, width, height):
  - **Pavouk** (`spider`; `Delta` is 5 characters, so 55 px wide, and the left depth-1 column is 55 px): Střed (223, 40, 55, 32); Alfa (338, 20, 48, 32) `right` `blue`; A1 (446, 0, 48, 32); A2 (446, 40, 48, 32); Beta (115, 20, 48, 32) `left` `orange`; B1 (0, 20, 48, 32); Gama (338, 80, 48, 32) `right` `purple`; Delta (108, 60, 55, 32) `left` `teal`. Layout 494 × 112. Connectors: Střed → Alfa (278, 56) → (308, 56) → (308, 36) → (338, 36); Střed → Gama ends (338, 96); Alfa → A1 (386, 36) → (416, 36) → (416, 16) → (446, 16); Střed → Beta (223, 56) → (193, 56) → (193, 36) → (163, 36); Střed → Delta ends (163, 76); Beta → B1 (115, 36) → (78, 36) → (78, 36) → (48, 36).
  - **Pavouk** laid out as `right` (the switch, AC-27): Střed (0, 90, 55, 32); Alfa (115, 20, 48, 32); A1 (230, 0, 48, 32); A2 (230, 40, 48, 32); Beta (115, 80, 48, 32); B1 (230, 80, 48, 32); Gama (115, 120, 48, 32); Delta (115, 160, 55, 32). Layout 278 × 192.
  - **Strom** laid out as `spider`: Kořen (216, 40, 55, 32); Alfa (331, 20, 48, 32) `right`; A1 (439, 0, 48, 32); A2 (439, 40, 48, 32); Beta (108, 40, 48, 32) `left`; B1 (0, 40, 48, 32); Gama (331, 80, 48, 32) `right`. Layout 487 × 112 (right height 112, left height 32 shifted down by 40). Connector Kořen → Beta: (216, 56) → (186, 56) → (186, 56) → (156, 56).

### R97. The switch, commands and strings (D-792; NFR-OTH-02, FR-UX-03)

| Element | Role | Accessible name / content |
| --- | --- | --- |
| Layout switch | `radiogroup` `Mindmap layout`, in the header left of the view switch, in Map and List; absent in the read view and in a read-only note | two `radio`s: `Branches to the right` (`data-layout="right"`) and `Spider: branches on both sides` (`data-layout="spider"`), icon-only with those names as tooltips; `aria-checked` on the stored layout; one Tab stop with ← / → moving the check (a move switches, R98 W12) |
| Figure | `figure` | gains `data-layout="right" \| "spider"` |
| Node | `treeitem` | gains `data-side="left" \| "right"` (none on the root); while editing, holds the `textbox` `Edit node` (R95a) |
| Commands (R4, section `edit`, `needsVault: true`, no shortcut) | | `Mindmap layout: right` (`mindmap.layoutRight`), `Mindmap layout: spider` (`mindmap.layoutSpider`): act on the mindmap block that holds the caret or the focus; elsewhere not run, no error. The radios carry these `data-command`s |
| Catalog keys (English text) | | `mindmap.layout` `Mindmap layout` · `mindmap.layoutRight` `Branches to the right` · `mindmap.layoutSpider` `Spider: branches on both sides` · `mindmap.editNode` `Edit node` · `cmd.mindmap.layoutRight` `Mindmap layout: right` · `cmd.mindmap.layoutSpider` `Mindmap layout: spider`. Final key names are the contract's |

### R98. What is written (FR-FMT-07, FR-SYN-06; D-786…D-788, D-791)

As R93: block = the top-level block's source range; every byte outside it unchanged; the frontmatter changes only in `modified`. Výjezd's block lines are numbered 1 (the title line) to 8 (`>   - Doprava`).

| # | Action | Before | After |
| --- | --- | --- | --- |
| W12 | Výjezd, `Spider` chosen | line 1 `> [!mindmap] Výjezd 2026` | `> [!mindmap\|spider] Výjezd 2026`; lines 2–8 unchanged |
| W12a | Pavouk, `Branches to the right` chosen | `> [!mindmap\|spider] Pavouk` | `> [!mindmap] Pavouk` (no trailing space) |
| W12b | Neznámé metadata, `Spider` chosen | `> [!mindmap\|foo] Cizí` | `> [!mindmap\|spider] Cizí` |
| W12c | Složené (1), `Spider` chosen | `> [!mindmap]- Složená mapa` | `> [!mindmap\|spider]- Složená mapa` (fold marker kept) |
| W12d | Metadata (2), `Branches to the right` chosen | `> [!Mindmap\|SPIDER]+ Velká písmena` | `> [!Mindmap]+ Velká písmena` (type spelling and fold marker kept) |
| W13 | Výjezd, `Spider` chosen then `Branches to the right` | line 1 | `> [!mindmap] Výjezd 2026` (byte-identical to the original) |
| W14 | Metadata (1), ` navíc` typed at the end of its paragraph in the editor | `> [!note\|wide] Poznámka\n> Odstavec v calloutu.` | `> [!note\|wide] Poznámka\n> Odstavec v calloutu. navíc` |
| W15 | Výjezd Map, `Doprava` focused, ⏎, `Ubytování`, ⏎ | lines 1–8 | line 9 `>   - Ubytování` added; lines 1–8 unchanged |
| W15a | Výjezd Map, the root `Výjezd 2026` focused, ⏎, `Nocleh`, ⏎ | | `>   - Nocleh` inserted as the new line 3 (before `Program`) |
| W15b | Více kořenů Map, the synthesized root focused, ⏎, `Spánek`, ⏎ | | `> - Spánek` added after `> - Zdraví` |
| W16 | Výjezd Map, `Doprava` focused, Tab, `Vlak`, ⏎ | | `>     - Vlak` added after line 8 |
| W17 | Výjezd Map, `Plán 2027` focused, Space, ` v2`, ⏎ | line 5 `>     - Plán 2027` | `>     - Plán 2027 v2` |
| W17a | Výjezd Map, `Lisabon` focused, Space (the field shows `[[Lisabon]]`), ` město` typed, ⏎ | line 7 `>     - [[Lisabon]]` | `>     - [[Lisabon]] město` |
| W18 | Výjezd Map, `Plán 2027` focused, ⌫ | line 5 | line 5 removed; `Program` keeps `Přehled Q4` |
| W19 | Výjezd Map, `Program` focused, ⌥↓ | lines 3–8 | `>   - Místo`, `>     - [[Lisabon]]`, `>   - Program`, `>     - Přehled Q4`, `>     - Plán 2027`, `>   - Doprava` |
| W20 | Výjezd Map, `Místo` focused, ⌥→ | lines 6–7 | `>     - Místo`, `>       - [[Lisabon]]` after line 5 (the last child of `Program`) |
| W21 | Výjezd Map, `Přehled Q4` focused, ⌥← | lines 4–8 | `>     - Plán 2027`, `>   - Přehled Q4`, `>   - Místo`, `>     - [[Lisabon]]`, `>   - Doprava` (after `Program`'s subtree) |
| W22 | Uzly Map, the item with a second paragraph focused, Space, ` x` typed, ⏎ | its first paragraph line | only that line gains ` x`; the blank `>` line and the second paragraph are unchanged |

## Criteria

### FR-FMT-05 Callout metadata (D-791; adds to AC-4…AC-6)

- **AC-7** [MM2] **Metadata is read for the layout and preserved for every callout (T2).** `@tegg/doc` `parse` returns `mindmap` for Pavouk (`layout: 'spider'`, `meta: 'spider'`), Neznámé metadata (`layout: 'right'`, `meta: 'foo'`), Metadata (2) (`layout: 'spider'`, `meta: 'SPIDER'`; the type `Mindmap` and the fold `+` as in R90) and `callout` for Metadata (1) (type `note`, its metadata kept in `raw`); Výjezd has `layout: 'right'`, `meta: null`. The editor and the read view draw Pavouk and Metadata (2) in `spider` and Neznámé metadata in `right`; Metadata (1) is an ordinary note callout titled `Poznámka` with no visible metadata. `[!mindmap|spider]` with a body that is not one list is a hint callout (R90). *(L1; L5)*

### FR-MMP-02 Editing on the map and the layouts (D-786…D-792; adds to AC-1…AC-22)

- **AC-23** **Keys edit the list (R95, R98; T1).** In Výjezd's Map, each of W15, W15a, W16, W17, W17a, W18, W19, W20 and W21, done from a fresh copy of the fixture, saves exactly its "After" bytes, every other byte of the file except `modified` unchanged; W15b on Více kořenů and W22 on Uzly likewise. After each, `data-view` is still `map`, the layout is recomputed (`__TEGG_MINDMAP_LAYOUTS__` grew) and the focus is on the node R95 names (W15: `Ubytování`; W18: `Přehled Q4`; W19: `Program`). ⌫ on `Program`, on the root, on Více kořenů's synthesized root, ⌥↑ on `Program`, ⌥→ on `Program` (first child) and ⌥← on `Program` (first-level) change nothing and write nothing. *(L1 for the commands on the editor; L5)*
- **AC-24** **The text field (R95a).** Space on `Plán 2027` in Výjezd's Map opens the `textbox` `Edit node` inside that node with the value `Plán 2027` and the caret at its end; Esc closes it with the node text and the file unchanged (zero `note_write` after the autosave delay); F2 and a double-click open the same field. On `Lisabon` the value is `[[Lisabon]]`; on Uzly's `Tučně` item the value is its source line as written in the fixture (`**Tučně**, ` + backtick-`kód`-backtick + ` a ==zvýraznění==`); on Nákup's `Mléko` it is `Mléko` (the `[x] ` box is not part of the text). Typing `[[`, `#` or `/` into the field shows no popup. Committing an unchanged value writes nothing. On Více kořenů's synthesized root Space does nothing. *(L5)*
- **AC-25** **New nodes (R95, R95a; AP-751).** ⏎ on `Doprava` shows a new empty `treeitem` after it, editing, before any write; Esc removes it again and nothing is written; ⏎ committing it empty also removes it; typing `Ubytování` then ⏎ is W15. Tab on `Doprava` adds the child as the last child; on `Program` (two children) the new child comes after `Plán 2027`. The new node's tone is its position's (a new first-level node of Výjezd after `Doprava` is `teal`). *(L5)*
- **AC-26** **One undo step each, map stays (D-786).** Each of W12, W15, W16, W17, W18, W19, W20 and W21 is one undo step: ⌘Z with the map focused restores the block's previous bytes and the focus returns to the edited node; ⇧⌘Z re-applies it; `data-view` stays `map` throughout. Opening and cancelling the field (AC-24) is not an undo step. *(L1; L5 for W15 and W19)*
- **AC-27** **Two layouts, deterministic (R96; D-789).** With the Measurer, `layoutMindmap` of Pavouk with `spider` equals R96's boxes, sides, tones and connector points exactly, Pavouk with `right` and Strom with `spider` likewise; the same tree twice gives deep-equal results; `right` of every slice-MM fixture note is unchanged from AC-11. In the app each rendered box of Pavouk is within ±1 px of the layout with the real measurer; left-side connectors leave the parent's left edge. *(L1; L5)*
- **AC-28** **Spider navigation (R95; D-790).** In Pavouk's Map (focus on `Střed`): → reaches `Alfa`, → `A1`, ← back to `Alfa`, ← `Střed`, ← `Beta`, ← `B1`, → `Beta`, → `Střed`; ↓ from `Střed` goes `Alfa`, `A1`, `A2`, `Beta`, `B1`, `Gama`, `Delta` (outline order, crossing sides); End reaches `Delta`, Home `Střed`. On `Gama` (right, a leaf) → does nothing; on `Delta` (left, a leaf) ← does nothing. After W12 on Výjezd, `Program` and `Doprava` are `right`, `Místo` is `left`, and → on `Místo` reaches `Výjezd 2026`. ⏎ on `Delta` adds a sibling that lands `right` (the 5th branch). *(L5)*
- **AC-29** **The switch writes one line (R97, R98; D-791, D-792; T1).** Pavouk's header shows the `radiogroup` `Mindmap layout` with `Spider: branches on both sides` checked; Výjezd's shows `Branches to the right` checked. Choosing the other radio (click, or ← / → with the group focused, or the palette commands) saves W12, W12a, W12b, W12c, W12d respectively, each as one undo step, and redraws the block in the chosen layout at once in Map and in List (the live map). W13 restores the original first line byte for byte. On Neznámé metadata the group shows `Branches to the right` checked and the file is untouched until the choice. The switch is present in Map and in List, absent in the read view (which draws Pavouk in `spider`) and in a read-only note; the embedded Výjezd in Vložení shows it and W12 there changes `Pages/Výjezd 2026.md` only. Choosing the already checked radio writes nothing. *(L5)*
- **AC-30** **Wide spider maps and 500 nodes (D-683, D-777).** The runtime `Široká mapa` in `spider` (the first branch right, the chain of nested items) scrolls inside the block as AC-13 says; the runtime `Velká mapa` in `spider` meets AC-14's layout budget (p95 of 20 runs ≤ 16.7 ms, `mindmap-layout`, report-only until MS8) and the note-ready budget. *(L5; L6 for the reference machine)*
- **AC-31** **Read view and read-only notes (D-786).** In the read view of Pavouk and Výjezd the tree is navigation only: ⏎, Space, F2, Tab, ⌫, the ⌥ keys and a double-click change nothing, write nothing and open no field; ⌘↩ still opens the first link; there is no layout switch and no `Edit node` field. The same holds for the mindmap of a note shown read-only. *(L5)*

### FR-FMT-07 Round-trip with metadata (slice MM2)

- **AC-25** [MM2] **Metadata never rewrites (T1).** Pavouk, Neznámé metadata and Metadata parsed and serialized without edits are byte-identical; opened in the editor in both views and in the read view, with the layout switch untouched, ten navigation keys and an opened-then-cancelled field, they stay byte-identical (zero `note_write`). W14 keeps `[!note|wide]` as written. The property criterion of AC-24 (random mindmaps) extends to a random metadata token (`spider`, `right`, `foo`, empty `|`, `SPIDER`) on the callout line: parse → serialize is identity, and a layout switch changes only the callout line. *(L1; L2; L5)*

### FR-SYN-06 No writes but the user's (slice MM2)

- **AC-34** [MM2] **Browsing and navigating the map writes nothing.** On the built app with a copy of the fixture: open Pavouk, Neznámé metadata and Metadata; in each mindmap block move through every node with ↓, → and ←, open the field with Space and cancel with Esc, switch to List and back; every file's bytes, mtime and inode are unchanged and no write reaches the vault. *(L6)*

### FR-UX-03 Map editing by keyboard and palette (adds to AC-15)

- **AC-16** [MM2] **Reachable by keyboard and palette (R97; D-787, D-792).** Tab reaches, in order, the layout switch (one stop), `Map`, `List` and the tree. The palette lists `Mindmap layout: right` and `Mindmap layout: spider` on a note route; with the caret in Výjezd's block or its tree focused they do W12 / W13; with the caret outside any mindmap they aren't run and show no error. app-shell FR-UX-03 AC-8 passes on Pavouk (the radios carry the commands). A keyboard-only run (no pointer events) opens Prázdná, inserts a mindmap with `/mindmap` ⏎, types `Kořen`, switches to Map with the palette, presses Tab, types `Větev`, ⏎, then ⏎, types `Druhá`, ⏎, then Tab to the layout switch and → ; the saved block is `> [!mindmap|spider]\n> - Kořen\n>   - Větev\n>   - Druhá`. *(L5)*

### FR-UX-05 Themes (adds to AC-10)

- **AC-11** [MM2] **The field and the switch in both themes.** In light and dark, the `Edit node` field has the node's background and text colour (R92 tones) with a 2 px `accent` focus ring; the checked radio uses `accent` on `bg`, the unchecked `muted`; the contrast rules of AC-10 hold for both; the left-side connectors use `muted` like the right ones. *(L5)*

### NFR-OTH-02 Strings (adds to AC-7)

- **AC-8** [MM2] **Catalog only.** Every R97 text is a catalog key; with the pseudo-locale every visible text and accessible name of the switch, the field and the two commands is pseudo-localized; node text stays user content. *(L1; L5)*

### NFR-POR-01 Obsidian (adds to AC-1)

- **AC-2** [MM2, manual] **Metadata in Obsidian (D-791).** The regenerated `obsidian-check` vault gains a note with `> [!mindmap|spider] Pavouk` and the Pavouk list: Obsidian shows it as the callout of D-686 with the list, no error and no visible `spider`; the file is unchanged after opening. Recorded in `qa/manual/`. *(manual, owner)*

## What changes in earlier criteria, tests and fixtures (MM2)

Made in slice MM2's red-test commit; test changes carry `AC-Test-Change: slice MM2, keyboard editing on the map and the right / spider layouts (D-785…D-792); approved-by: owner`, fixture changes `Fixture-Change:` (TS-D4).

| Criterion / test | Change | Reason |
| --- | --- | --- |
| FR-MMP-02 AC-5 (`app/webkit/mindmap_block.ac.test.ts`) | "a node click goes to List" becomes: a click on `Program` focuses it, `data-view` stays `map`, nothing is written; `List` pressed afterwards puts the caret at the end of `Program` (AP-750); typing ` a cíle` there saves `>   - Program a cíle` as before | D-788 |
| FR-MMP-02 AC-15 (`mindmap_misc.ac.test.ts` / `mindmap_block.ac.test.ts`) | ⏎ or Space on `Program` opens the field (AC-24) instead of switching; Tab reaches the layout switch first (FR-UX-03 AC-16) | D-787, D-792 |
| FR-MMP-02 AC-6 | unchanged: `List` still puts the caret at the end of the root item when no node is focused | — |
| FR-MMP-02 AC-3 | unchanged: the empty-state button still switches to List (AP-749) | — |
| FR-UX-03 AC-15 | the keyboard-only run's "returns to List with ⏎" becomes "returns to List with the palette" | D-787 |
| D-776's caret rule | the caret follows the focused node when `List` is pressed, not a click | D-788, AP-750 |
| R90 / FR-FMT-05 AC-4 | the type is matched before `\|`; three recognition rows added (Pavouk, Neznámé metadata, Metadata) | D-791 |
| `tests/fixtures/vaults/mindmap/` | Pavouk, Neznámé metadata, Metadata added (README) | D-789, D-791 |
| FR-FMT-07 AC-24 (a) (`packages/doc/test/mindmap_roundtrip.ac.test.ts`) | the fixture count 21 becomes 24 (the three MM2 notes round-trip too) | the fixture change above |
| **Found by the red-test author, approved by the owner on 2026-10-26:** FR-MMP-02 AC-2 `fr_mmp_02_ac2_a_click_on_the_synthesized_root_changes_no_list_item`, AC-9 `fr_mmp_02_ac9_checklist_boxes_are_read_only…`, AC-10 `fr_mmp_02_ac10_link_chip_opens_the_note_without_switching` (`mindmap_block`, `mindmap_nodes`), FR-UX-03 AC-15 `fr_ux_03_ac15_show_as_list_puts_the_caret_at_the_end_of_the_root_item` (`mindmap_misc`), the regression `app/webkit/bug_mm_fr_mmp_02_space_on_a_map_node_writes_nothing.test.ts`, and AC-6 `fr_mmp_02_ac6_list_view_edits_and_the_live_map` ("clicking a node of the map below the list moves the caret") | each asserts that a click, Space or a box click switches to List or moves the caret; under D-788 a click focuses, under D-794 `List` follows the focused node (`Program`, not the root); AC-6's live map below the list: a click there focuses the node too, the caret stays | D-788, D-794 (approved after the red commit; changed in their own `AC-Test-Change` commit). Also FR-MMP-02 AC-16 `fr_mmp_02_ac16_mindmap_inside_an_embedded_note`: the caret is placed in the embedded list, not by a node click (approved 2026-10-26, after the build) |
| `tests/fixtures/vaults/obsidian-check/` and `packages/doc/scripts/make-obsidian-check.ts` | a `[!mindmap\|spider]` note for the owner's recheck | NFR-POR-01 AC-2 |

## Points raised by these criteria (AP-749…AP-751, decided as D-793…D-795)

Numbering continues after AP-748 (slice MM2 decisions). Next free AP after this list: AP-752. The owner accepted every recommendation on 2026-10-26.

| # | Issue | Recommendation | Alternatives | Affects |
| --- | --- | --- | --- | --- |
| AP-749 | **The empty state on the map.** D-787 lets ⏎ create nodes on the map, but the empty state (D-681, AC-3) is a button that switches to List. With map editing, the user may expect to type the central topic on the map. | Keep AC-3: the button switches to List with the caret in the empty item (the empty state is one item, where the list is the simpler place to type), no new criterion. | (b) The button opens the field on a drawn empty root; W1-style bytes on commit. | FR-MMP-02 AC-3 |
| AP-750 | **Where `List` puts the caret once a click no longer switches.** D-776 tied the caret to the node click; D-788 removes that. | `List` (button or palette) with a focused node puts the caret at the end of that node's item; with no focused node, at the end of the root item (AC-6). | (b) Always the root item (the focused node is lost). | FR-MMP-02 AC-5, AC-6, R95 |
| AP-751 | **An empty new node.** D-787 creates the node before any text; D-788 says Esc cancels. Not said: what a committed empty node does, and whether anything is written before the commit. | Nothing is written while the field is open; Esc, and ⏎ on an empty value, remove the new node again (AC-22's rule that an empty item is never saved); only a non-empty commit writes. | (b) A committed empty node stays as `> - ` and is written. | FR-MMP-02 AC-25, R95a |
