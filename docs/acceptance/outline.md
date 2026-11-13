# Acceptance Criteria: The Outline (v1.0 slice OL)

See [README](README.md) for conventions. Release v1.0 (FR-EDT-11 moved there by D-376). Slice **OL "Outline"** turns on the right panel's Outline tab. Today the tab is disabled with `Coming in v1.0` (D-127, D-376, D-563, D-564; [inbox.md](inbox.md) FR-NAV-05 AC-1, app-shell R2 row `outline`). The slice follows the owner's boards `design/edit-note-page/Outline.dc.html` (light) and `OutlineDark.dc.html` (dark), sections A–D, E1–E4 and V1–V11, and the prototype `design/edit-note-page/outline-rail-prototype.html`. The prototype's script is the reference for the rail's numbers and its row rule. The slice has two parts:

- **The Outline tab** (FR-EDT-11). A tree of the note's headings, with live updates, the current section, a jump to a heading, collapsing, an empty state and the keyboard.
- **The edge rail** (E1–E4, V1–V11). The owner chose it on 2026-11-13, and D-1600 makes it requirement **FR-EDT-16**. It draws one short line per heading on the note's right edge. Hover, or ⌘J, opens a floating card with the same rows.

The Outline only reads: it never writes to the vault. Its view state is machine-local (`ui-state.json`, FR-STO-07). Where the board and a decision differ, the decision wins. Where neither decides, the criterion follows the **proposal** of an AP point at the end of this file and names it.

**Status: approved, 2026-11-13.** The owner accepted AP-1400…AP-1427 (end of this file) as proposed ("Accept all 28"): D-1600…D-1627 (BRD v1.172; AP-14xx → D-16xx with the same last two digits). Contract: `docs/contracts/v1-outline.md`. The module and attribute names used here (`outlineHeadings`, `railRows`, `foldKey`, `data-outline-flash`, `data-outline-rail`) are the proposal it starts from.

**Scope.**
- FR-EDT-11 (the Outline tab).
- **FR-EDT-16** "Outline rail on the note's edge", a new requirement proposed by AP-1400. The rail criteria are numbered under it.
- FR-NAV-03 (a jump is a Back entry) and FR-NAV-05 (the tab, `Show outline`, and the AC-1 change in inbox.md).
- FR-STO-07 (fold state).
- FR-UX-03 (commands, ⌘J, keyboard), FR-UX-08 (VoiceOver, Reduce motion), FR-UX-05, NFR-OTH-02.
- NFR-PERF-06 (typing with the Outline on screen), FR-FMT-12 (NFD headings), FR-SYN-06 (no writes).
- FR-SET-02 (the rail switch, AP-1401).

Reference tables R170…R177.

**Out of scope:**
- Heading and block links themselves (FR-LNK-06, v1.0). Only the shared heading list and the shared scroll position are checked here (AP-1425).
- Folding sections in the note (AP-1403).
- A search field in the outline. The board says none: ⌘F already finds text.
- Reordering sections by dragging rows.
- Tabs (FR-NAV-06).
- The read view. It ships only as a test fallback (D-215, AP-1419).

**Risk tiers** (test-strategy §3). The Outline writes nothing, so its **T1** risk is a write it shouldn't make: a jump, a collapse or a fold that marks the note dirty, adds an undo step, or rewrites a folded callout's `-` marker (FR-SYN-06 AC-46, FR-EDT-11 AC-10, AC-11). Its main risk is **T2, silently wrong data**:
- a heading list that misses a heading or adds one that isn't there (code, frontmatter comments, embeds);
- a jump that lands on the wrong one of two headings with the same text;
- a current section that marks the wrong heading;
- a fold state that sticks to the wrong heading or the wrong note (duplicate texts, NFD, path versus `id`).

Those criteria list exact rows from the fixture and are marked **(T2)**. The rest is **T3/T4** (workflow, layout, motion).

**Test layers** (as in [pinned.md](pinned.md)):

| Tag | Layer |
| --- | --- |
| L0 | Static rules (no colour literal, no string literal) |
| L1 | Vitest: the heading extraction (`outlineHeadings(text)` on the real `@tegg/doc`, never mocked), the tree builder, `railRows()`, `foldKey()`, the store's prune rule, the registry and the catalog |
| L2 | Property tests (fast-check): a fixed seed plus one random seed per push, 10 × 1,000 runs nightly (TS-L2) |
| L5 | **WebKit.** Playwright on WebKit with the fake core over mocked IPC (real `@tegg/doc`, real `@tegg/editor`). It records every IPC call. Playwright's clock drives every timing in this file (150, 250, 300 and 2,000 ms) |
| L6 | **Real app.** Appium `mac2` on the built app with `TEGG_TEST=1`, a temporary Application Support and a temporary copy of the fixture. Vault checks use bytes, mtime and inode. Every AC whose layer names L6 has an `app/e2e/` test in the red-test commit (D-382). Keys go only to Tegg (D-799) |
| manual | Owner design review, recorded in `qa/manual/` |

The Outline has no core (L4) part. The heading list is computed in the UI from the text the centre pane shows.

**Test clock** (L5, L6 with `TEGG_TEST=1`), unless a criterion says otherwise:
- `2026-11-13T10:00:00+01:00` (a Friday), Europe/Prague, region `cs`.
- Window 1,440 × 900, sidebar open (232 px).
- `ui-state.json` holds `rightPanel: { open: true, tab: 'outline', width: 288 }` and no `outline` entry, so the centre pane is 920 px wide.
- Normal page width.
- `prefers-reduced-motion` off.

Each criterion names a suggested test name (`Test:`). A test may split a criterion into several tests with the same prefix.

**Fixture** (synthetic, D-50; committed with this draft): `tests/fixtures/vaults/outline/` with `tests/fixtures/vaults/new-empty/.tegg/` copied in. Its README lists every file, the expected rows of each note (text, level and depth), the expected rail rows and the files made at runtime. Short names used below:
- **Plán:** `Pages/Plán offsitu 2026.md`, 11 headings.
- **Architektura:** 18 headings, H1–H6.
- **Čtenářské:** `Pages/Čtenářské poznámky.md`, 51 headings.
- **Okraje:** the heading edge cases.
- **Přeskočené:** skipped levels.
- **Jeden:** one heading.
- **Bez nadpisů:** no heading.
- **Dlouhé:** long titles.
- **Odkazy:** a heading link.
- **Den:** `Daily/2026-11-12.md`.
- **Rozbitá:** invalid frontmatter.
- **Bez hlavičky:** no frontmatter, no `id`.

**Shared definitions.**
- **The viewport** is the visible rectangle of the centre pane's scrolling element.
- **A heading's top** is the top of its rendered block: the heading element in the editor, the line element in the source view.
- **Untouched** means bytes, mtime and inode unchanged.
- **Depth** is a heading's place in the tree: 1 plus the number of its ancestors (R171). **Level** is its Markdown level, 1–6.
- **The Outline is on screen** when the Context panel is open, shows the Outline tab, and isn't hidden by focus mode or by the narrow-window rule (FR-UX-02 AC-18).

---

## Reference tables

### R170. The Outline tab (FR-EDT-11, FR-NAV-05; boards `Outline` A–D)

Accessible names are catalog strings (R177), except heading texts (user content, `data-user-content`).

| Part | Role / element | Name, content and rules |
| --- | --- | --- |
| Tab | `tab` `Outline` in the `Context panel`'s `tablist`, `data-command="panel.outline"` | No `Coming in v1.0` description. Selected state stored as `rightPanel.tab: 'outline'` (FR-UX-02 AC-10). |
| Tab panel | `tabpanel` `Outline` | A header row, then the tree or the empty state. The header stays in place while the tree scrolls (AP-1413). |
| Count | text in the header | `<n> headings` (plural: `1 heading`). n is every heading the outline lists in the note, whatever is collapsed (AP-1426). Absent in the empty state. |
| Expand all | `button` `Expand all`, `data-command="outline.expandAll"`, 24 × 24 px, icon only | Present only while at least one row is collapsed (AP-1412). |
| Collapse all | `button` `Collapse all`, `data-command="outline.collapseAll"`, 24 × 24 px, icon only, tooltip `Collapse all · ⌥-click a chevron` | Present only while at least one heading with children is expanded (AP-1412). |
| Tree | `tree` `Outline` | One `treeitem` per visible row, in note order; 1 px between rows; no vertical guide lines. |
| Row | `treeitem`, name = the heading text (R171) | Height 26 px. `padding-left` 14 × (depth − 1) px (AP-1406). A 16 px chevron slot, then the text, cut with `…` (tooltip with the full text, AP-1405). Attributes: `aria-level` = depth; `aria-expanded` only on headings with children; `aria-current="location"` on the current section (R172); `aria-setsize` / `aria-posinset` among its siblings. |
| Chevron | `aria-hidden="true"` element in the chevron slot, tooltip `Collapse` / `Expand` | Only on rows with children. Shown on hover or keyboard focus of an expanded row, and always on a collapsed row. A click toggles the row; ⌥-click toggles its whole branch (AP-1412). |
| Hidden count | text at the row's right end, `muted` | On a collapsed row only: the number of descendant headings it hides (`4`). The row's `aria-description` is `<n> hidden headings` (plural: `1 hidden heading`). |
| Empty state | text in the tab panel | `No headings yet`, then `Start a line with # to add one.` with `#` in a `code` element. No count, no buttons, no tree. |

**Row type** (AP-1407):

| Row | Size and weight | Colour |
| --- | --- | --- |
| Depth-1 heading of level 1 | 13 px, weight 500 | `--text` |
| Other rows | 12.5 px, weight 400 | `--text`; level 5 and 6 in `--muted` |
| Current row | weight 600 | `--text`, a 3 px `--text` bar at its left edge, inset 7 px top and bottom, transparent background |
| Hovered or keyboard-focused row (D-594) | own weight | `--hover` background, no bar |

A row can be current and focused at the same time; it then has both.

### R171. Headings: what counts, their text, the tree (AP-1404…AP-1406)

1. **Source.** The outline is computed from the text the centre pane shows:
   - in the editor, the editor's current document, including unsaved edits and the draft on `new/<type>`;
   - in the source view (⌥⌘U), the file text.

   It is never computed from the index or from `note_read`. One function, `outlineHeadings(text)` in `@tegg/doc`, returns `{ level, text, from, to }[]` in note order (`from`/`to` are source offsets). FR-LNK-06 is to use the same function (AP-1425).
2. **Counts as a heading** (AP-1404): every ATX or setext heading that the dialect's Markdown parser (`markdownTree`) finds in the body, at any nesting. That includes headings inside callouts (folded or not), plain quotes and list items.
3. **Does not count** (AP-1404):
   - anything in the frontmatter (YAML comments included);
   - text in fenced or indented code;
   - query blocks;
   - mindmap callouts (`[!mindmap]`, D-679);
   - raw blocks: HTML, `%%` comments, `$$` math;
   - the content of note embeds (`![[Note]]`, `![[Note#Heading]]`);
   - `#tag` lines;
   - empty headings: no text left after rule 4, for example `#` or `##` alone;
   - the note's title (`title:` or the file name). A body heading with the same text as the title still counts.
4. **Text** (AP-1405): the heading's inline content as plain text.
   - Marks are dropped: `**Tučný**` → `Tučný`.
   - A wikilink shows its alias, else its target. A Markdown link shows its text. Inline code shows without backticks. A `#tag` stays as written. Inline math stays as source.
   - `%%…%%` comments, a trailing block id ` ^id` and an ATX closing sequence ` ##` are removed. HTML stays as literal text.
   - Leading and trailing whitespace is trimmed and inner runs of whitespace become one space.
   - Characters are shown as written (an NFD heading looks the same). Comparisons and fold keys use NFC (FR-FMT-12).
5. **Tree** (AP-1406): a heading's parent is the nearest earlier heading with a lower level. Depth is 1 plus the number of ancestors, so `###` after `#` has depth 2, and a note may start at any level.
6. **Fold key** (R176): `<level>:<NFC text>#<n>`, where n counts headings with the same level and NFC text up to and including this one, in note order (`2:Poznámky#2`).

### R172. Current section and the jump (AP-1408, AP-1409)

**Current section.**

1. **Rule.** The current section is the last heading in note order whose top is at or above the viewport's top + 30 px.
2. **Before the first heading.** If no heading's top has passed that line, nothing is current.
3. **End of the note.** If the note scrolls (scrollHeight > clientHeight) and is scrolled to within 2 px of its end, the last heading is current, even if its top can't reach the line (V3).
4. **A note that doesn't scroll** uses only rule 1 (AP-1408).
5. **Collapsed branch.** If the current heading is hidden in a collapsed branch of the tab's tree, the nearest visible ancestor row carries `aria-current` and the bar. Nothing is expanded for it (AP-1412).
6. **Timing.** The current section is recomputed within 100 ms of the last scroll event.
7. **One rule.** The tab, the rail and the card use the same rule.

**The jump** (a click on a row, a click on a rail line, ⏎ on a row):

1. **Target.** It goes to the row's heading **by position** (`from`), never by text.
2. **Scroll.** The scroll is instant, never smooth. The heading's top ends 24 px (± 2) below the viewport's top, or the note is scrolled to its end if it can't scroll that far.
3. **Folded callout.** A heading inside a folded callout expands that callout first. This is a view state only: the `-` marker stays, nothing is written (editor.md FR-EDT-02 AC-19 "Folding writes nothing").
4. **Editor.** The selection is collapsed at the end of the heading's text, and the editor (`Note body`) has the focus.
5. **Source view.** No caret is placed. The view has no editing.
6. **Highlight.** The heading (or source line) gets `data-outline-flash`. Its background is `--link-bg`, with a 5 px `--link-bg` spread. The attribute stays 2,000 ms (± 100), then the background fades to transparent over 300 ms. There is no fade under Reduce motion (AP-1422).
7. **No change to the note.** The highlight is a decoration: it isn't in the document, adds no undo step, and leaves `dirty()` false.
8. **History.** The jump is a Back entry (FR-NAV-03 AC-15, AP-1410).
9. **Stale row.** If the heading at the row's position no longer exists, for example deleted in the moment before the click, nothing happens and the outline refreshes.

### R173. The edge rail and its card (FR-EDT-16 as proposed; boards E1–E4, V1–V11; prototype constants)

| Item | Rule |
| --- | --- |
| Shown when | All of these hold: the route shows a note (`note/<path>`, `daily/<date>`, `new/<type>`); the outline lists **≥ 2 headings**; the Outline is **not** on screen; the centre pane is **≥ 640 px** wide (AP-1414); not in focus mode (AP-1402); the `Show outline rail` setting is on (AP-1401). Otherwise the rail is absent and takes no space (V1). |
| Element | `[data-outline-rail]`, `aria-hidden="true"` (pointer only; keyboard users have ⌘J and the tab, AP-1421) |
| Place | Inside the centre pane. Its box (8 px horizontal, 12 px vertical padding) has its right edge 14 px (± 1) left of the centre pane's right edge, which is left of the panel's separator when the panel is open (E3). It is centred vertically on the viewport (± 1 px) and doesn't move when the note scrolls. |
| Clearance | While the rail is shown, the note text's right edge is ≥ 44 px left of the centre pane's right edge. The Normal width's 40 px right padding grows to 44 px only when the column reaches the pane's edge (AP-1414). |
| Lines | One per rail row (rule below), in note order, right-aligned, 7 px apart (± 0.5). Width by **level**: H1 18, H2 13, H3 9, H4 7, H5 5, H6 4 px. Height 1.5 px in `--faint`; 2 px in `--muted` for ancestors of the current section; 2 px in `--text` for the current section and for the line under the pointer. Each line's pointer target is the rail's full width by the line's 8.5 px slot (line plus gap). |
| Rows | The prototype's `visibleRows()` over **depth** (AP-1415). X is the greatest depth d for which the headings of depth ≤ d number at most 20 (at least 1). The rows are every heading of depth ≤ X, plus: the current section, its ancestors, the children of each ancestor, and the current section's own children. A row is drawn only if all its ancestors are drawn. The tab's collapsing doesn't affect the rail (V6, AP-1403). |
| Many top-level headings | If the depth-1 headings alone are more than 20, the gap shrinks (minimum 2 px) so that the rail fits in the viewport's height − 48 px. If it still doesn't fit, the rail isn't shown (AP-1415). |
| Hover | The pointer staying on the rail box for **150 ms** opens the card. Leaving the rail and the card closes it **300 ms** later. Coming back within 300 ms keeps it open. A pass shorter than 150 ms opens nothing. The row under the pointer and its line light up together (E2). |
| Card | A non-modal `dialog` `Outline` containing a `tree` `Outline`. Width 256 px. Its right edge is 52 px (± 1) left of the centre pane's right edge, so it opens to the left over the note and never covers the panel (E3). Centred vertically on the viewport. Height up to min(520 px, 80 % of the viewport's height); it scrolls inside. Rows as R170 (no hidden counts). The current row has the bar, and its **ancestors are weight 600** (V8). Opened by hover, it scrolls so that the current row is in its middle. |
| Card chevrons | Only on a row whose children the card doesn't show, or that the user opened in this card (AP-1416). A chevron or → shows that row's children in the card and on the rail until the card closes. No chevron appears when every row is shown (V5). |
| Closing | Any of these closes the card: a jump, Esc, ⌘J again, Tab, a click outside the rail and the card, the rail becoming hidden, a route change. Esc, ⌘J and Tab return the focus to the editor with its earlier selection and scroll. |
| Fade | When the Outline tab comes on screen, the rail fades out over 150 ms. When the tab leaves the screen (other tab, panel closed), it fades in over 150 ms. There is no fade under Reduce motion (AP-1422). |

### R174. Keyboard (AP-1417, AP-1418; FR-UX-03)

**In the tab's tree** (WAI-ARIA tree pattern):

| Key | Action |
| --- | --- |
| Tab into the tree | The focus goes to the current row, else to the first row. One row has `tabindex="0"` (roving focus). |
| ↓ / ↑ | Next / previous visible row; stops at the ends. Nothing moves in the note. |
| Home / End | First / last visible row |
| → | On a collapsed row: expand it. On an expanded row: go to its first child. On a leaf: nothing. |
| ← | On an expanded row: collapse it. Otherwise: go to its parent (nothing at depth 1). |
| ⌥→ / ⌥← | Expand / collapse the row's whole branch (as ⌥-click) |
| ⏎ | Jump (R172). The focus goes to the editor. |
| Esc | The focus goes back to the editor with its earlier selection and scroll (AP-1418) |
| Tab / ⇧Tab | Leave the tree |

**In the card**: ↓ / ↑ / Home / End as above.
- → shows a row's hidden children (temporarily, R173).
- ← hides children opened this way; otherwise it goes to the parent.
- ⏎ jumps and closes the card.
- Esc, ⌘J or Tab closes the card and restores the editor's selection and scroll.

The current row keeps its bar while the focus moves (V10).

### R175. Commands and the shortcut (AP-1417, AP-1418)

| Id | Title | Shortcut | Listed on | Runs |
| --- | --- | --- | --- | --- |
| `panel.outline` | `Show outline` | — | `note/<path>`, `daily/<date>`, `new/<type>` | Opens the Context panel on the Outline tab. The focus goes to the current row, else the first row, else the empty state's text (`tabindex="-1"`). One `ui_state_set`. |
| `outline.jump` | `Outline: jump to heading…` | ⌘J | the same routes | The rail is shown → opens the card with the focus on the current row (else the first). The Outline is on screen → focuses the tab's current row. The rail is hidden for another reason (narrow, focus mode, setting off, AP-1417) → opens the card at its usual place. 0 headings → the polite live region says `No headings yet`, nothing else. With the card open → closes it (R173). |
| `outline.expandAll` | `Outline: Expand all` | — | while the Outline is on screen and a row is collapsed | as the button |
| `outline.collapseAll` | `Outline: Collapse all` | — | while the Outline is on screen and a heading with children is expanded | as the button |
| `outline.toggleRail` | `Toggle outline rail` | — | every route with a vault (AP-1401) | Flips `outlineRail` (R176) |

All are in section `view`, `needsVault: true`. App-shell R4 gains the row `⌘J` → `Outline: jump to heading…`. No other R4 change: ⌘J is unused in R4, in editor.md R8 and in every later shortcut table. It isn't reserved by macOS.

### R176. Machine-local state (FR-STO-07; AP-1401, AP-1411)

Only in `ui-state.json` under the Application Support root (`TEGG_APP_SUPPORT`). Never in the vault.

```ts
outlineRail?: boolean;          // missing reads as true (AP-1401)
vaults[<vault path, NFC>].outline?: {
  collapsed: { [noteKey: string]: string[] };   // noteKey: the note's id, else its vault-relative path in NFC (as page-width's noteWidth)
};                                               // values: fold keys of R171 rule 6, in note order
```

Rules:
- A note's entry is written only when a user action changes its fold state. It is removed when nothing in the note is collapsed.
- Keys that match no heading of the note are dropped at that note's next fold write.
- The object's order is the order of the last change. Above **200 notes per vault**, the entry changed longest ago is dropped in the same write.
- A path key moves to the `id` key in the write after the note's first edit gives it an `id` (as page-width FR-STO-07 AC-5).
- The card's temporary opens and the rail are never stored.

### R177. Strings (catalog keys, English text)

`outline.count` `{count} headings` (one: `{count} heading`) · `outline.empty` `No headings yet` · `outline.emptyHint` `Start a line with {hash} to add one.` (`{hash}` rendered as `code` `#`) · `outline.tree` `Outline` · `outline.card` `Outline` · `outline.expandAll` `Expand all` · `outline.collapseAll` `Collapse all` · `outline.collapseAllHint` `Collapse all · ⌥-click a chevron` · `outline.expand` `Expand` · `outline.collapse` `Collapse` · `outline.hidden` `{count} hidden headings` (one: `1 hidden heading`) · `cmd.outline.show` `Show outline` · `cmd.outline.jump` `Outline: jump to heading…` · `cmd.outline.expandAll` `Outline: Expand all` · `cmd.outline.collapseAll` `Outline: Collapse all` · `cmd.outline.toggleRail` `Toggle outline rail` · `settings.appearance.outlineRail` `Show outline rail` · `settings.appearance.outlineRailNote` `Short lines on the note’s right edge; hover them to see the outline.` The tab's existing name key stays. Numbers use the region's grouping.

---

### FR-EDT-11 The Outline tab

- **AC-1** **The tab on a regular note (D-127, D-376; T2).** On `note/Pages/Plán offsitu 2026.md` with the panel on Outline:
  - The `tab` `Outline` has no `Coming in v1.0` description.
  - The tab panel's header reads `11 headings` and has `Collapse all` and no `Expand all`.
  - The `tree` `Outline` has exactly 11 treeitems, in this order with these `aria-level`s: Cíle 1, Co od toho chceme 2, Kdo jede 2, Program 1, Den 1 2, Ráno: strategie 3, Odpoledne: plán 3, Den 2 2, Logistika 1, Cesta 2, Rozpočet 2.
  - `Cíle`, `Program`, `Den 1` and `Logistika` have `aria-expanded="true"`. No other row has `aria-expanded`.
  - Neither the title `Plán offsitu 2026` nor the intro paragraph is a row.
  - Showing the tab sends no IPC call besides the page's own (no extra `note_read`, no `index_*`, no write), and `nav_opened` is called no extra time.

  *(L5)* Test: `fr_edt_11_ac1_outline_tab_lists_the_headings`
- **AC-2** **What counts as a heading (R171, AP-1404; T2).**
  - `outlineHeadings` on Okraje's text returns exactly the 11 headings of the fixture README, in order, with these levels: `Nadpis podtržený` 1 (setext), `Podnadpis podtržený` 2 (setext), `Tučný začátek, odkaz a kód` 2, `Oddíl s blokem` 2, `Nadpis v calloutu` 2, `Skrytý nadpis` 3, `Nadpis v citaci` 2, `Nadpis v seznamu` 2, `Poznámky` 2, `Poznámky` 3, `Poznámky` 2.
  - None of the README's "not listed" items comes back: the frontmatter comment, `#štítek`, the empty `#` and `##`, the two code blocks, `## Kořen mapy`, the query block's comment, the `%%` block, the HTML `h2`, the math block, or the 11 headings of the embedded Plán.
  - The tab shows the same 11 rows and `11 headings`.
  - L1 runs the same check on each case alone, as a one-line or one-block note.

  *(L1; L5)* Test: `fr_edt_11_ac2_what_counts_as_a_heading`
- **AC-3** **Heading text (R171 rule 4, AP-1405).**
  - Okraje's third row reads exactly `Tučný začátek, odkaz a kód`: no `**`, `[[`, `|`, backticks or closing `##`. It contains no `link` element, so a click on it is a jump, not a link.
  - The fourth row reads `Oddíl s blokem` (no `^oddil1`).
  - L1: `## a  **b**   c ` → `a b c`; `## [text](https://example.com)` → `text`; `## #projekt plán` → `#projekt plán`; `## x %%skryté%% y` → `x y`; `## <b>tučně</b>` → `<b>tučně</b>`; `## $x^2$` → `$x^2$`.

  *(L1; L5)* Test: `fr_edt_11_ac3_heading_text_is_plain`
- **AC-4** **The tree and skipped levels (R171 rule 5, AP-1406; T2).**
  - Přeskočené gives these rows (`aria-level`, then `padding-left`): `Začátek ve třetí` 1, 0 px; `Hlavní` 1, 0 px; `Přeskok` 2, 14 px; `Zpět na dvojku` 2, 14 px; `Hluboko` 3, 28 px. Only `Hlavní` and `Zpět na dvojku` have `aria-expanded`.
  - Architektura's 18 rows have depths equal to their levels and `padding-left` 0, 14, 28, 42, 56, 70 px by depth (± 0.5).
  - No element inside the tree draws a vertical line: no row or wrapper has a left border except the current bar.

  *(L1 for the tree; L5 computed styles)* Test: `fr_edt_11_ac4_tree_by_depth`
- **AC-5** **Row type and the two highlights (R170, AP-1407; D-594).** Computed styles on Architektura, scrolled so that `Názvy souborů` is current:
  - Row height: 26 px (± 0.5).
  - `Úložiště` and `Synchronizace`: 13 px, weight 500.
  - Other rows: 12.5 px, weight 400.
  - `Časová pásma` and `Přejmenování`: `--muted`. `Názvy souborů` is level 5, so it would be `--muted`, but it is current: weight 600 with the 3 px `--text` bar.
  - Every other row is `--text`.
  - Hovering `Přílohy` gives it the `--hover` background and no bar. Reaching `Přílohy` with ↓ does the same. The current row keeps its bar and transparent background meanwhile.
  - The current row and the hovered row differ in at least one of background colour and bar presence.

  *(L5)* Test: `fr_edt_11_ac5_row_type_current_and_hover`
- **AC-6** **Empty state and one heading (board A, V1).**
  - On Bez nadpisů the tab stays enabled. The tab panel shows `No headings yet` and `Start a line with # to add one.` (the `#` in a `code` element), with no count, no `Expand all` or `Collapse all`, and no `tree`.
  - The runtime note `Pages/Prázdné nadpisy.md` (only `#` and `##`) shows the same.
  - Jeden shows `1 heading`, one row `Další kroky` with no `aria-expanded`, and neither button.

  *(L5)* Test: `fr_edt_11_ac6_empty_state_and_one_heading`
- **AC-7** **Live while typing (board A; AP-1423; T2).** On Bez nadpisů in the editor, with the caret at the start of a new empty paragraph at the end:
  - Typing `##` and a space leaves the empty state (an empty heading isn't listed).
  - Typing `Nový oddíl` shows the row `Nový oddíl` (`aria-level` 1) and `1 heading` within 250 ms of the last keystroke. The page's `Saved` hasn't happened yet and no `note_write` has been sent.
  - Turning it into Heading 3 (block menu `Turn into`) keeps one row.
  - ⌘Z until the heading is gone brings the empty state back within 250 ms.
  - On Plán, changing `Den 1` to `Den první` relabels that row within 250 ms. The other rows keep their DOM nodes, so the change isn't a rebuild.
  - During an IME composition (Playwright `compositionstart`…`compositionend` for `č`), the row doesn't change. Within 250 ms after `compositionend` it shows the composed text.
  - None of this sends an IPC call for the outline.

  *(L5)* Test: `fr_edt_11_ac7_live_updates_while_typing`
- **AC-8** **External changes (NFR-PERF-08; T2).** Plán is open with no unsaved edits and `Program` collapsed. Another program appends `\n## Rezervy\n\nText.\n`:
  - Within 2 s there is a row `Rezervy` at depth 2 after `Rozpočet` (under `Logistika`), and the header reads `12 headings`.
  - `Program` is still collapsed.
  - If the editor has unsaved edits, the editor's merge flow decides (editor.md), and the outline lists the headings of the text the editor then shows.

  *(L5; L6 once with the helper process)* Test: `fr_edt_11_ac8_external_change_updates_the_outline`
- **AC-9** **The current section (R172, AP-1408; boards B, V2, V3; T2).** On Plán:
  - At scrollTop 0 (the intro and `Cíle` below the 30 px line), no row has `aria-current`.
  - Scrolled so that `Den 1`'s top is 10 px above the viewport's top + 30 px: exactly `Den 1` has `aria-current="location"` and the bar.
  - Scrolled so that `Den 1`'s top is 31 px below the viewport's top: `Program` is current.
  - Scrolled to the end (scrollTop = scrollHeight − clientHeight): `Rozpočet` is current, though its top is below the line.
  - Scrolling back to 0: no current row, within 100 ms of the last scroll event.
  - On Jeden (doesn't scroll at 1,440 × 900), no row is current at any time.
  - In every case exactly zero or one row has `aria-current`.

  *(L5)* Test: `fr_edt_11_ac9_current_section_follows_scrolling`
- **AC-10** **The jump (R172, AP-1409; board B, V11; T2).** On Čtenářské at scrollTop 0, with the caret at offset 5 of the intro paragraph, a click on the row `Zpoždění replikace`:
  - On the next frame the heading's top is 24 px (± 2) below the viewport's top. No frame shows an intermediate scrollTop (sampled each frame), so the scroll is instant.
  - The selection is collapsed at the end of `Zpoždění replikace`, and `document.activeElement` is the `Note body`.
  - The heading has `data-outline-flash` with computed background `--link-bg`. At 1,900 ms it still has it; at 2,100 ms it doesn't, and the background reaches transparent by 2,400 ms.
  - The row `Zpoždění replikace` is current.
  - Typing `X` gives `Zpoždění replikaceX`.
  - Before the typing: `__TEGG_TEST__.editor.dirty()` is false, `historyDepth()` is unchanged, the route string is unchanged, and no write or `nav_opened` call was sent.
  - A click on `Další čtení` (the last heading) scrolls to the end and makes it current.

  *(L5; L6 once in the built app: caret and text after typing)* Test: `fr_edt_11_ac10_click_jumps_to_the_heading`
- **AC-11** **Jump targets by position (AP-1404, AP-1409; T1, T2).** On Okraje:
  - The third `Poznámky` row (level 2, the last heading) puts the caret at the end of the **last** `## Poznámky`, not the first.
  - The second (level 3) lands in `### Poznámky`.
  - `Skrytý nadpis` expands `Sbalený callout`: its button becomes `Collapse Sbalený callout` with `aria-expanded="true"` (D-159). The caret lands at the end of `Skrytý nadpis`. The file stays untouched and still contains `> [!tip]- Sbalený callout` when the note is left.
  - `Nadpis v seznamu` and `Nadpis v calloutu` put the caret at the end of those headings, inside the list item and the callout.
  - `Nadpis podtržený` (setext) puts it at the end of its text line.
  - With the outline refresh held (`__TEGG_TEST__.outline.hold(true)`, D-1640), a row whose heading was deleted just before the click does nothing (the caret and scroll are unchanged), and the tree is refreshed within 250 ms.

  *(L5)* Test: `fr_edt_11_ac11_jump_targets_by_position`
- **AC-12** **The source view and read-only files (AP-1419).** On Plán in the source view (⌥⌘U), the tab lists the same 11 rows. A click on `Den 1`:
  - scrolls the source line `## Den 1` (`data-line`) to 24 px (± 2) below the viewport's top and gives that line `data-outline-flash` for 2,000 ms;
  - places no caret and changes no selection, and the focus stays in the source view;
  - leaves the current section following the same rule on line tops.

  Toggling back to the editor keeps the reading position (D-146). `Pages/Rozbitá hlavička.md`, which opens in the source view (NFR-REL-03), lists `První v rozbité` (1) and `Druhý v rozbité` (2), and nothing from its broken frontmatter.

  *(L5)* Test: `fr_edt_11_ac12_outline_in_the_source_view`
- **AC-13** **Collapse and expand (R170, AP-1403, AP-1412; boards C, D).** On Architektura:
  - **One row.** The chevron of `Hlavička` hides its 2 children. The row gets `aria-expanded="false"`, the visible count `2` and `aria-description` `2 hidden headings`. The header still reads `18 headings`, and both `Expand all` and `Collapse all` are shown. A second click restores it.
  - **A whole branch.** ⌥-click on `Úložiště`'s chevron collapses `Úložiště` and every descendant with children (`Rozvržení trezoru`, `Složky podle typu`, `Denní poznámky`, `Názvy souborů`, `Hlavička`, `Indexování`). A plain click on `Úložiště` then shows 7 rows: `Úložiště`, `Rozvržení trezoru` (collapsed, `9`), `Indexování` (collapsed, `2`), `Synchronizace`, `Konflikty`, `Stejný řádek upraven`, `Složky iCloudu`. ⌥-click on a collapsed row expands it and its whole branch.
  - **All.** `Collapse all` leaves 2 rows: `Úložiště` `13` and `Synchronizace` `3`, with only `Expand all` shown. `Expand all` restores 18 rows with only `Collapse all`.
  - **The note isn't folded.** The editor still renders all 18 headings and their paragraphs (none hidden). Nothing is written, and the editor isn't dirty.
  - **Label versus chevron.** A click on a row's text jumps and doesn't toggle.
  - **Current in a collapsed branch.** With `Úložiště` collapsed and the note scrolled to `Časová pásma`, the `Úložiště` row carries `aria-current` and the bar, and nothing expands.
  - **Chevron visibility.** Expanded rows show their chevron only on hover or focus; collapsed rows show it always.

  *(L5)* Test: `fr_edt_11_ac13_collapse_and_expand`
- **AC-14** **Fold state per note (AP-1403, AP-1411).**
  - With `Hlavička` collapsed in Architektura, opening Plán shows every row expanded. Back (⌘[) to Architektura shows `Hlavička` still collapsed.
  - Collapsing in the tab doesn't change the rail (FR-EDT-16 AC-6), and the card's temporary opens don't change the tab.
  - A heading typed into Architektura appears expanded.
  - Renaming the collapsed `Hlavička` to `Záhlaví` in the editor shows `Záhlaví` expanded: the key no longer matches.

  Storage: FR-STO-07 AC-7. *(L5)* Test: `fr_edt_11_ac14_fold_state_per_note`
- **AC-15** **Long titles and the narrow panel (board C).** On Dlouhé with the panel at 240 px:
  - The H1 row's text ends with `…` (its text box `scrollWidth` > `clientWidth`).
  - Hovering it for the app's tooltip delay, or focusing it by keyboard, shows a tooltip with the full text. Its accessible name is the full text.
  - The level-6 row (depth 6) has a text box at least 140 px wide.
  - The tab panel has no horizontal scrollbar.
  - At 480 px the H6 text isn't cut.

  *(L5)* Test: `fr_edt_11_ac15_long_titles_and_narrow_panel`
- **AC-16** **The outline scrolls on its own (board D; AP-1413).** On Čtenářské the tree is taller than the tab panel:
  - The tree scrolls inside the tab panel while the header (count and buttons) stays in place.
  - Scrolling the note until `Zpracování` (under `Proudy`) is current scrolls the tree so that this row's centre is within ± 13 px of the tree's visible centre, or the tree is at its end.
  - While the pointer is over the tree, or the focus is in it, the tree doesn't scroll by itself. It does again at the next change of the current section after both have left.
  - Scrolling the tree never scrolls the note.

  *(L5)* Test: `fr_edt_11_ac16_tree_keeps_the_current_row_in_view`
- **AC-17** **Every route with the panel (D-127; AP-1420).** With the panel on Outline:
  - `daily/2026-11-12` lists `Čtvrtek`, `Ráno`, `Večer`.
  - The virtual `daily/2026-11-13` (D-322, the template expanded) lists `Deník 13. 11. 2026`, `Úkoly`, `Poznámky` and writes nothing.
  - On `new/page`, typing `# Koncept` in the body lists `Koncept`, and the outline itself writes nothing (the draft's own create rule applies, D-520).
  - `tag/<key>`, `type/page`, `search`, `tasks` and `graph/<path>` have no panel, so no Outline tab and no rail (⌘\ does nothing there).

  *(L5)* Test: `fr_edt_11_ac17_outline_on_each_route`
- **AC-18** **What the outline follows (T2).** The outline always lists exactly the headings of the text the centre pane shows.
  - After the 4C rename job renames Plán to `Plán výjezdu`, the rows and their fold state stay (`id` key).
  - Another program moving `Pages/Plán offsitu 2026.md` to `.trash/` while it is open without edits changes the rows only if the editor changes its text. Clicking a row then writes nothing.
  - When the page shows no note text, the tab shows no tree, no count and no hint.

  *(L5)* Test: `fr_edt_11_ac18_outline_follows_the_shown_text`
- **AC-19** **Same place as a heading link (AP-1425).** From Odkazy, following `[[Čtenářské poznámky#Zpoždění replikace]]` scrolls that heading's top to 24 px (± 2) below the viewport's top: the same place as the outline's jump. The link and the outline resolve `Zpoždění replikace` to the same `from` offset of `outlineHeadings`. *(L5; changes with AP-1425)* Test: `fr_edt_11_ac19_heading_link_lands_where_the_outline_jumps`
- **AC-20** **A long note (AP-1423).** On the runtime `Pages/Pět set nadpisů.md`:
  - The tab shows `500 headings`.
  - `Kapitola 100`'s row is reached with End, and ⏎ jumps there.
  - Typing a character in `Oddíl 050.2` relabels its row within 250 ms.
  - On the reference machine, the p95 of 50 such edits, from keydown to the row's new text, is under **250 ms**. This is report-only until the v1.0 release gate, enforced at it (as D-940).

  *(L5 functional; L6 benchmark `app/e2e/nfr_perf_06_outline.ac.test.ts`, outside the push run)* Test: `fr_edt_11_ac20_five_hundred_headings`
- **AC-21** [manual] **Design review.** The owner compares the built tab with boards `Outline` and `OutlineDark` A–D, in light and dark: Plán, Architektura with a collapsed row, Čtenářské scrolled, Bez nadpisů, and panel widths 240 and 480. Each deviation is recorded as an issue or accepted. *(manual)*

### FR-EDT-16 Outline rail on the note's edge (proposed by AP-1400; boards E1–E4, V1–V11)

- **AC-1** **When it shows (R173; AP-1401, AP-1402, AP-1414).** With the panel closed:
  - Plán shows `[data-outline-rail]` with `aria-hidden="true"`, and so does the runtime `Pages/Dva nadpisy.md` (2 headings).
  - Jeden (1 heading) and Bez nadpisů show none. Their note column's computed width and padding equal those of the same note with the rail switched off: no space is reserved.
  - With the panel open on Backlinks or Graph the rail shows. On Outline it doesn't.
  - In focus mode (⌘⇧\) it doesn't show, and leaving focus mode brings it back.
  - With `Show outline rail` off (FR-SET-02 AC-10) it doesn't show.
  - It shows on `daily/2026-11-12` and on a `new/page` draft with 2 headings, and on no other route.

  *(L5)* Test: `fr_edt_16_ac1_when_the_rail_shows`
- **AC-2** **Narrow windows (V9; AP-1414).** At window 1,160 × 900 with the panel open at 288 px (centre pane 640 px), the rail shows on Plán. At 1,159 (639 px) it doesn't. At 1,000 × 900 it shows with the panel closed (768 px) and not with it open (480 px). Dragging the panel's separator from 240 to 480 px at window 1,200 hides the rail once the panel passes 328 px, and shows it again below that. A card open when the rail hides closes. `Outline: jump to heading…` still opens the card while the rail is hidden (AC-11). *(L5)* Test: `fr_edt_16_ac2_rail_hides_below_640_px`
- **AC-3** **Place and size (R173; E1, E3, V4; AP-1414).** On Architektura with the panel closed:
  - The rail box's right edge is 14 px (± 1) left of the centre pane's right edge. Its vertical centre is the viewport's centre (± 1), and both stay the same at scrollTop 0, at the middle and at the end.
  - It has 18 lines, right-aligned, with widths 18, 13, 9, 7, 5, 4, 4, 7, 9, 7, 7, 13, 9, 9, 18, 13, 9, 13 px (± 0.5) and 7 px (± 0.5) between lines.
  - With the panel open on Backlinks, the box's right edge is 14 px left of the panel's separator.
  - At centre pane widths 640, 700, 920 and 1,208 px, in Normal and in Wide, the right edge of the `Note body` text is ≥ 44 px left of the centre pane's right edge.

  *(L5 computed geometry)* Test: `fr_edt_16_ac3_rail_place_and_line_sizes`
- **AC-4** **Line states (E1, V2, V3; T2).** On Plán:
  - At scrollTop 0 all 11 lines are 1.5 px in `--faint`.
  - With `Ráno: strategie` current, its line is 2 px `--text`. `Program` and `Den 1` are 2 px `--muted`. The other 8 are 1.5 px `--faint`.
  - At the end, `Rozpočet`'s line is 2 px `--text`.
  - At every scroll position the rail's current line belongs to the same heading as the tab's current row: the panel is switched between Backlinks and Outline at 10 positions.

  *(L5 computed styles)* Test: `fr_edt_16_ac4_rail_line_states`
- **AC-5** **The rows in a long note (R173, AP-1415; V7; T2).** On Čtenářské the rail draws the rows of the fixture README's rail table:
  - 12 lines with nothing current;
  - 15 with `Replikace` current;
  - 16 with `Zpoždění replikace` current;
  - 17 with `Kompromisy` current;
  - 15 at the end (`Další čtení`).

  Each set is in note order. Scrolling from `Replikace` into `Transakce` removes `Replikace`'s 3 H2 lines and adds `Transakce`'s. Architektura (18) and Plán (11) always draw every heading.
  - L1: `railRows` returns these sets.
  - L2 properties, on random heading lists of levels 1–6 and lengths 0–600 with a random current: every drawn row's ancestors are drawn; the current section and its ancestors are always drawn; the rows are in note order; the rows other than the current branch number at most 20 when depth 1 alone fits in 20; an all-H2 note behaves as an all-H1 note (depth, not level).

  *(L1; L2; L5)* Test: `fr_edt_16_ac5_rail_rows_in_a_long_note`
- **AC-6** **The rail ignores the tab's folding (V6, AP-1403).** With `Úložiště` collapsed in Architektura's tab, switching the panel to Backlinks shows 18 rail lines, and the card lists 18 rows. *(L5)* Test: `fr_edt_16_ac6_rail_ignores_outline_folding`
- **AC-7** **Hover and its timings (E2; R173).** On Plán with the panel closed and the clock controlled:
  - With the pointer resting on the rail, there is no card at 140 ms. The `dialog` `Outline` is there at 150 ms (± 1 frame).
  - The pointer leaving the rail for the note: the card is open at 290 ms and gone at 310 ms.
  - Leaving and coming back onto the card at 200 ms keeps it open. Moving from the rail onto the card keeps it open.
  - A pointer crossing the rail in 100 ms opens nothing.
  - The pointer on `Den 1`'s line makes that line 2 px `--text` and the card's `Den 1` row `--hover`. The pointer on the card's `Cesta` row lights `Cesta`'s line.
  - A card opened by hover leaves the focus and the selection in the editor unchanged.

  *(L5)* Test: `fr_edt_16_ac7_hover_opens_and_closes_the_card`
- **AC-8** **The card's content (V5, V8, AP-1416).** Opened by hover:
  - **Architektura.** 18 rows and no chevron. The current row (`Názvy souborů` when scrolled there) has the bar. Its ancestors `Úložiště`, `Rozvržení trezoru`, `Složky podle typu` and `Denní poznámky` are weight 600. No row shows a hidden count.
  - **Čtenářské with `Zpoždění replikace` current.**
    - The 16 rows of the rail, the current row scrolled to the card's middle (± 13 px).
    - Chevrons on the 11 H1 rows other than `Replikace`, and on `Vedoucí a následovníci`: 12 in all.
    - A click on `Transakce`'s chevron adds its 3 H2 to the card and to the rail (19 rows and 19 lines). Closing and reopening the card shows 16 again.
  - **Geometry.** The card is 256 px wide and its right edge is 52 px (± 1) left of the centre pane's right edge. It is centred on the viewport. Its height is ≤ min(520, 0.8 × viewport height), and it scrolls inside.

  *(L5)* Test: `fr_edt_16_ac8_card_rows_and_chevrons`
- **AC-9** **Jumps from the rail and the card.**
  - A click on the card's `Kdo jede` row, or on `Kdo jede`'s line, jumps as FR-EDT-11 AC-10 (24 px, caret at the end, highlight 2,000 ms) and closes the card at once. A line click before the 150 ms hover delay also jumps.
  - A click in the note outside the rail and the card closes the card and places the caret where clicked, as any editor click.
  - No jump or close writes anything.

  *(L5)* Test: `fr_edt_16_ac9_rail_and_card_jump`
- **AC-10** **With the panel open (E3, E4; FR-UX-08).** On Plán with the panel open on Backlinks at 288 px:
  - The rail is inside the centre pane. The hover card's right edge is 52 px (± 1) left of the panel's separator, so it never overlaps the panel.
  - Choosing the Outline tab fades the rail's opacity from 1 to 0 over 150 ms (`getAnimations()` shows one 150 ms opacity transition), then the rail is removed.
  - Choosing Graph, or closing the panel with ⌘\, fades it in over 150 ms.
  - Under Reduce motion, both changes happen with no transition.

  *(L5)* Test: `fr_edt_16_ac10_rail_beside_the_panel`
- **AC-11** **The card by keyboard (V10; R174, R175, AP-1417).**
  - **Plán, panel closed.** The caret is in the `Cíle` paragraph and the note is scrolled so `Den 1` is current. ⌘J opens the card with the focus on the treeitem `Den 1` (`--hover` and the bar). ↓ moves the focus to `Ráno: strategie` and the note doesn't move. ⏎ jumps there and closes the card.
  - **Esc.** After ⌘J and ↓↓, Esc closes the card and returns the focus to the `Note body` with the same selection and scrollTop (± 1 px) as before ⌘J. ⌘J while the card is open does the same as Esc.
  - **Čtenářské, `Zpoždění replikace` current.** ↓ ×4 reaches `Transakce`. → shows its 3 H2 (19 rows), ← hides them, ← again stays (depth 1). On `Bez vedoucího`, ← goes to `Replikace`.
  - **No current row.** Plán at scrollTop 0: ⌘J focuses the first row.
  - **Outline on screen.** ⌘J focuses the tab's current row and opens no card.
  - **Rail hidden.** In focus mode, and at 1,000 px with the panel open on Backlinks, ⌘J opens the card at its usual place.
  - **No headings.** On Bez nadpisů, ⌘J opens nothing and the polite live region says `No headings yet`.
  - **Other routes.** On `search`, ⌘J does nothing.

  *(L5; L6 once: ⌘J, ↓, ⏎ in the built app, keys sent only to Tegg, D-799)* Test: `fr_edt_16_ac11_card_by_keyboard`
- **AC-12** **Live updates on the rail.** On Jeden with the panel closed, typing a second heading `## Termíny` makes the rail appear with 2 lines within 250 ms of the last keystroke. ⌘Z removes it within 250 ms. With the card open on Plán, typing `## Rezervy` at the end adds its row and line within 250 ms. *(L5)* Test: `fr_edt_16_ac12_rail_follows_typing`
- **AC-13** **Many top-level headings (AP-1415).** At 1,440 × 900 (viewport about 850 px high) with the panel closed:
  - `Pages/Šedesát kapitol.md` draws 60 lines with a gap of at least 2 px, the whole rail within the viewport's height − 48 px.
  - `Pages/Tři sta kapitol.md` (300 H1, made at runtime) shows no rail. ⌘J opens the card, which lists 300 rows and scrolls. (D-1634: 200 H1 still fit at a 2.5 px gap, R173.)

  *(L5)* Test: `fr_edt_16_ac13_many_top_level_headings`
- **AC-14** [manual] **Design review.** The owner compares the built rail and card with boards E1–E4 and V1–V11 in light and dark (Plán, Architektura, Čtenářské; panel closed, on Backlinks, on Outline; 1,000 px). Each deviation is recorded as an issue or accepted. *(manual)*

### FR-NAV-03 A jump is a Back entry (adds to app-shell.md AC-1…AC-14; AP-1410)

- **AC-15** **Back returns the caret and the scroll.** Čtenářské is opened from `search`, with the caret at offset 5 of the intro paragraph and scrollTop 0. Jumping to `Zpoždění replikace` from the tab:
  - Enables the title-bar `Back`. The route string is unchanged and `nav_opened` isn't called.
  - ⌘[ restores scrollTop 0 (± 1 px) and the caret at offset 5, with the focus in the `Note body`, no `note_read` and no route change.
  - ⌘] returns to the heading (24 px, caret at its end).
  - ⌘[ twice from there shows `search`.
  - Two jumps (to `Transakce`, then to `Proudy`): ⌘[ gives the place after the first jump, ⌘[ again the original place.
  - A jump to the heading where the caret already is, with the heading already at 24 px, adds no entry.
  - A jump after a ⌘[ drops the forward entries.
  - Jumps from the card and by ⌘J ⏎ behave the same.
  - The history still isn't kept across launches (AC-7).

  *(L5)* Test: `fr_nav_03_ac15_outline_jump_is_a_back_entry`
- **AC-16** **Back after edits (D-112).**
  - After the jump, typing ` X` into the heading and pressing ⌘[ puts the caret back at offset 5 of the intro: the edit is below it.
  - If the intro paragraph is deleted after the jump, ⌘[ puts the caret at the end of the nearest preceding block, or at the start of the body if there is none.
  - Going from Čtenářské to Plán and back with ⌘[ shows Čtenářské at the scroll of the jump's entry (app-shell AC-4), with the caret at the heading's end.
  - Back never writes and never adds an undo step.

  *(L5)* Test: `fr_nav_03_ac16_back_after_edits`

### FR-NAV-05 The Outline tab (AC-1 in inbox.md, changed with this slice; AC-2, AC-3 in graph-panel.md)

- **AC-4** **`Show outline` (R175, AP-1418).**
  - On Plán with the panel closed, the palette's `Show outline` opens the `Context panel` on the Outline tab and puts the focus on the current row, or the first row at scrollTop 0. `ui-state.json` gets `rightPanel.open: true, tab: 'outline'` in one write.
  - With the panel on Graph, it switches to Outline.
  - On Bez nadpisů the focus goes to the empty state's text.
  - It is listed on `note/<path>`, `daily/<date>` and `new/<type>`, and not on `tag/<key>`, `graph/<path>`, `search`, `tasks` or `type/page`.

  *(L5)* Test: `fr_nav_05_ac4_show_outline_opens_the_tab`
- **AC-5** **The tab is remembered (FR-UX-02 AC-10).**
  - With Outline chosen, these keep the Outline tab: opening another note, ⌘\ twice, and focus mode on and off.
  - After quitting and relaunching the built app on Plán, the panel opens on Outline with Plán's rows.
  - The vault's files are untouched.

  *(L5; L6 for the relaunch)* Test: `fr_nav_05_ac5_outline_tab_remembered`

**FR-NAV-05 AC-1 (inbox.md), the text this slice gives it (AP-1424):** "The right panel's tabs are, in this order, Backlinks (built, 4A), Outline (built, slice OL: no `Coming in v1.0` description; selecting it shows the outline of [outline.md](outline.md) R170) and Graph (built, G2: no `Coming in v1.0` description; selecting it shows the local graph of [graph-panel.md](graph-panel.md) R114); no Attributes tab (attributes stay at the top of the note, D-127); the panel toggles with its shortcut and the palette, and its open state and tab are kept per machine (FR-UX-02 AC-7, AC-10)."

### FR-STO-07 Fold state is machine-local (R176; AP-1411)

- **AC-7** **Stored in `ui-state.json`, keyed by note and heading (T2).**
  - **Collapse.** Collapsing `Program` in Plán sends exactly one `ui_state_set`. In it, `vaults[<vault path NFC>].outline.collapsed["01JC5N00000000000000000001"]` is `["1:Program#1"]` and every other field is as the UI read it.
  - **Expand.** Expanding `Program` sends one more `ui_state_set`, which removes that note's entry.
  - **Collapse all.** On Čtenářské, `Collapse all` stores the 14 keys of its headings with children, in note order, in one write.
  - **Duplicate texts.** On Okraje, collapsing the first `Poznámky` (level 2, which has the level-3 `Poznámky` as its child) stores `["2:Poznámky#1"]`. The last `Poznámky` (`2:Poznámky#2`) has no chevron.
  - **No `id`.** Bez hlavičky, opened through a route whose path is in NFD, stores under `Pages/Bez hlavičky.md` in NFC. Typing into it (its first edit writes an `id`, editor.md FR-FMT-02 AC-5) moves the entry to the new `id` key, in one `ui_state_set` after the `Saved`.
  - **Stale keys.** After `Program` is renamed in the editor, the next fold write for Plán drops `1:Program#1`.
  - **The 200 cap.** With the pre-seeded file of 200 entries, collapsing in Plán writes 200 entries: the oldest is dropped and Plán's is last.
  - **Separate vaults.** A second vault opened in the same app starts with nothing collapsed.
  - **Nothing in the vault.** No fold change sends a write command to the vault.

  *(L1 for the key and prune rules; L5)* Test: `fr_sto_07_ac7_fold_state_in_ui_state`
- **AC-8** **Relaunch keeps it.** In the built app, collapse `Hlavička` in Architektura and `Program` in Plán, then quit (⌘Q) and relaunch. Both are still collapsed. `<temp>/ui-state.json` holds both keys. Every vault file is untouched, and nothing was created in the vault (no file under `.tegg/`). *(L6)* Test: `fr_sto_07_ac8_fold_state_survives_relaunch`

### FR-SYN-06 No writes from the Outline (slice OL)

- **AC-46** **The Outline never writes to the vault (T1).** The tour runs in the built app on a copy of the fixture:
  - Open Plán, Architektura, Čtenářské, Okraje, Rozbitá, Bez hlavičky, `daily/2026-11-12` and the virtual `daily/2026-11-13`, without typing.
  - On each: show the tab and scroll through the note; collapse and expand single rows and branches; use `Expand all` and `Collapse all`; jump from the tab, the rail, the card and ⌘J (Okraje's folded callout included); go Back and Forward.
  - Switch the panel between Outline, Backlinks and Graph; resize the panel and the window across 640 px; turn focus mode on and off; turn `Show outline rail` off and on; relaunch.

  Afterwards every vault file's bytes, mtime and inode are unchanged, and no file or folder was created (no `Daily/2026-11-13.md`, nothing under `.tegg/`). Only `ui-state.json` in the temporary Application Support changed, written atomically (a new inode). In L5 the fake core counts 0 write commands over the same tour.

  *(L6; L5)* Test: `fr_syn_06_ac46_outline_tour_writes_nothing`

### FR-UX-03 The Outline by keyboard (adds to app-shell.md; AP-1417, AP-1418)

- **AC-45** **Commands and the shortcut (R175).**
  - The registry has R175's five commands with those ids, titles (catalog keys), sections and `needsVault`. Only `outline.jump` has a shortcut, `⌘J`, and R4 gains that one row.
  - FR-UX-03 AC-7 passes: no shortcut is shared, and none is reserved by macOS.
  - The palette lists each command exactly on R175's routes. `Outline: Expand all` and `Outline: Collapse all` act like the buttons.
  - FR-UX-03 AC-8 passes on Plán with the tab, the rail and the card shown: the tab, both buttons and the Settings switch carry their commands; treeitems are rows (exempt); chevrons and the rail are `aria-hidden`.
  - `help/shortcuts` lists `⌘J` `Outline: jump to heading…` under `Navigation` (FR-UX-03 AC-14).

  *(L1 for the registry; L5)* Test: `fr_ux_03_ac45_outline_commands_and_shortcut`
- **AC-46** **The tree's keys (R174).** On Architektura with the tab shown:
  - Tab from the tablist enters the tree on the current row (the first at scrollTop 0). Exactly one treeitem has `tabindex="0"`.
  - ↓ / ↑ / Home / End move as R174.
  - On `Hlavička`: → (expanded) goes to `Povinné klíče`, ← goes back to `Hlavička`, ← collapses it, → expands it.
  - ⌥← on `Úložiště` collapses the branch; ⌥→ expands it.
  - ⏎ on `Indexování` jumps (focus in the `Note body`, caret at the end of `Indexování`).
  - Esc from the tree returns the focus to the `Note body` with its earlier selection and scroll.
  - No key in the tree moves the note, except ⏎.

  *(L5)* Test: `fr_ux_03_ac46_tree_keyboard`
- **AC-47** **Keyboard-only tour.** With no pointer event:
  1. Open Plán from Search.
  2. Run `Show outline`, then move to `Den 1` and press ⏎.
  3. Type `A` and undo it.
  4. ⌘[ back, then ⌘J, ↓, Esc.
  5. ⌘\ to close the panel, then ⌘J and ⏎.

  Every focused element shows the indicator of app-shell FR-UX-03 AC-13 (b): rows `--hover`, buttons a 2 px `focus` outline. No step needs the pointer.

  *(L5)* Test: `fr_ux_03_ac47_outline_keyboard_only`

### FR-UX-08 Accessibility (adds to import-capacities.md AC-19, AC-20; AP-1421, AP-1422)

- **AC-21** **VoiceOver names and states.**
  - The tab panel is a `tabpanel` labelled `Outline`. The tree is a `tree` `Outline`. Each row is a `treeitem` named by its heading text, with `aria-level` = depth, `aria-setsize` and `aria-posinset` among its siblings, `aria-expanded` on headings with children, `aria-current="location"` on the current row, and on a collapsed row the `aria-description` `<n> hidden headings`.
  - The empty state is plain text in the tab panel.
  - The rail is `aria-hidden="true"`. The card is a `dialog` `Outline` without `aria-modal`, containing a `tree` `Outline` with the same treeitem rules.
  - In the built app, the macOS accessibility tree shows the outline's rows by name, and the current one is reported as selected or current.

  *(L5; L6 once)* Test: `fr_ux_08_ac21_outline_voiceover`
- **AC-22** **Reduce motion (FR-UX-08; AP-1422).** With `prefers-reduced-motion: reduce`:
  - **A jump.** The heading has `data-outline-flash` for 2,000 ms (± 100) with `transition-duration` 0s, so the background is removed at once at the end.
  - **The rail.** Showing and hiding it with the tab runs no animation (`getAnimations()` empty).
  - **Chevrons.** Toggling a chevron runs no rotation transition.
  - **Scrolling.** The jump's scroll stays instant (it is in every mode).
  - **Without Reduce motion.** The flash's background fades over 300 ms, the rail fades over 150 ms, and the chevron rotates over 120 ms.

  *(L5)* Test: `fr_ux_08_ac22_outline_reduce_motion`

### FR-UX-05 Themes (adds to import-capacities.md AC-21)

- **AC-22** **The Outline in both themes (boards `Outline`, `OutlineDark`).** In light and in dark, axe `color-contrast` reports zero violations, and FR-UX-05 AC-5 (no colour leaks) passes, on each of these:
  - Plán with the tab shown and a row hovered;
  - Architektura with a collapsed row;
  - Bez nadpisů's empty state;
  - the rail and the card on Čtenářské;
  - a jump's highlight.

  Token use:
  - The current bar and current text are `--text`. The hover row is `--hover`. Level 5–6 rows are `--muted`.
  - Rail lines are `--faint`, `--muted` and `--text` (R173). The highlight is `--link-bg` (already in `theme/tokens.ts` for both themes). The card uses `--pop`, `--border` and the shadow the other popovers use.
  - No colour literal is used (FR-UX-05 AC-2).
  - The current rail line and the ancestor lines each have ≥ 3:1 against `--bg` in both themes (WCAG 1.4.11). The resting `--faint` lines are decorative, as AP-1421 proposes.

  *(L5; L1 for the line contrast)* Test: `fr_ux_05_ac22_outline_in_light_and_dark`

### NFR-OTH-02 Strings (adds to import-capacities.md AC-18)

- **AC-19** **Catalog only.**
  - The catalog has exactly the R177 keys with the texts given.
  - `outline.count` and `outline.hidden` use `Intl.PluralRules`: the Czech test catalog shows them for 1, 3 and 5.
  - With the pseudo-locale, every visible text, tooltip and accessible name of the tab, its header, the empty state, the card, the commands and the Settings switch is inside `⟦ ⟧`, except heading texts (user content, `data-user-content`).

  *(L1; L5)* Test: `nfr_oth_02_ac19_outline_strings_in_the_catalog`

### NFR-PERF-06 Typing with the Outline on screen (adds to AC-3…AC-5; AP-1423)

- **AC-6** **The Outline doesn't slow typing.** The note is the runtime `Pages/Pět set nadpisů.md` in the reference vault on the reference machine, measured with the latency probe of AC-3 (`TEGG_PERF_LOG`), typing 200 characters into `Oddíl 050.2`. In two runs, one with the panel on the Outline tab and one with the panel closed and the rail shown, ≥ 95 % of keystrokes are painted in the next frame and none later than two frames (D-66, D-190). *(L6 benchmark `app/e2e/nfr_perf_06_outline.ac.test.ts`, outside the push run)* Test: `nfr_perf_06_ac6_typing_with_the_outline_on_screen`

### FR-FMT-12 NFD headings (adds to queries.md AC-9)

- **AC-10** **One heading in NFC and NFD (T2).** Architektura's line `### Složky podle typu` is rewritten in NFD at runtime.
  - The row reads the same as before: visually equal, NFC-equal accessible name.
  - Collapsing it stores `3:Složky podle typu#1` in NFC.
  - After another program rewrites the line back to NFC, the row is still collapsed.
  - `outlineHeadings` reports the NFD text as written, and `foldKey` gives the same key for both forms (L1).

  *(L1; L5)* Test: `fr_fmt_12_ac10_nfd_heading_same_fold_key`

### FR-SET-02 The rail switch (AP-1401)

- **AC-10** **`Show outline rail` in Settings › Appearance.**
  - `settings/appearance` has a `switch` `Show outline rail` (`data-command="outline.toggleRail"`), on with an empty Application Support, with the description `Short lines on the note’s right edge; hover them to see the outline.`
  - Turning it off sends one `ui_state_set` with `outlineRail: false`. Plán's rail, open in the background, is gone within 100 ms of returning to it. The palette's `Toggle outline rail` turns it on again.
  - Nothing is written to the vault, and `.tegg/vault.yml` is untouched.
  - After a relaunch the switch keeps its state.

  *(L5; L6 for the relaunch)* Test: `fr_set_02_ac10_outline_rail_switch`

---

## Real-app tests (D-382)

`app/e2e/outline.ac.test.ts` (built app, `TEGG_TEST=1`, temporary Application Support and fixture copy; keys only to Tegg, D-799):
- FR-EDT-11 AC-8 (an external edit) and AC-10 (a jump, then typing);
- FR-EDT-16 AC-11 (⌘J, ↓, ⏎);
- FR-NAV-05 AC-5 (the tab after a relaunch);
- FR-STO-07 AC-8 (fold state after a relaunch);
- FR-SYN-06 AC-46 (the tour);
- FR-UX-08 AC-21 (the macOS accessibility tree);
- FR-SET-02 AC-10 (the switch after a relaunch).

`app/e2e/nfr_perf_06_outline.ac.test.ts`: FR-EDT-11 AC-20 and NFR-PERF-06 AC-6, outside the push run.

---

## Trace: requirement → criteria

| Requirement | Criteria | Decisions and points |
| --- | --- | --- |
| FR-EDT-11 | AC-1…AC-21 (21, one manual) | D-127, D-146, D-159, D-322, D-376, D-520, D-594, D-634; AP-1403…AP-1413, AP-1419, AP-1420, AP-1423, AP-1425, AP-1426 |
| FR-EDT-16 (proposed) | AC-1…AC-14 (14, one manual) | AP-1400…AP-1402, AP-1414…AP-1417, AP-1421, AP-1422 |
| FR-NAV-03 | AC-15, AC-16 (2) | D-112, D-165; AP-1410 |
| FR-NAV-05 | AC-4, AC-5 (2); AC-1 changed in inbox.md | D-127, D-564, D-920; AP-1418, AP-1424 |
| FR-STO-07 | AC-7, AC-8 (2) | D-128; AP-1411 |
| FR-SYN-06 | AC-46 (1) | — |
| FR-UX-03 | AC-45…AC-47 (3) | D-594; AP-1417, AP-1418 |
| FR-UX-08 | AC-21, AC-22 (2) | AP-1421, AP-1422 |
| FR-UX-05 | AC-22 (1) | D-129 |
| NFR-OTH-02 | AC-19 (1) | D-133 |
| NFR-PERF-06 | AC-6 (1) | D-66, D-190; AP-1423 |
| FR-FMT-12 | AC-10 (1) | — |
| FR-SET-02 | AC-10 (1) | D-128; AP-1401 |

**52 new criteria** (50 automated, 2 manual), plus the changed FR-NAV-05 AC-1.

**Changes in the commit that builds slice OL** (after AP-1424 is decided):
- **App-shell R2.** The row `outline` (stale "TBD MS5"; v1.0 by D-563) becomes built (slice OL, outline.md R170), with requirements `FR-EDT-11, FR-NAV-05` (`PANEL_TABS` in `shell/registry.ts`).
- **App-shell R4.** Gains `⌘J` → `Outline: jump to heading…`.
- **FR-NAV-05 AC-1** in [inbox.md](inbox.md) takes the text above. Its test `fr_nav_05_ac1_right_panel_tabs` changes with the trailer `AC-Test-Change: AP-1424, the Outline tab is built in slice OL; approved-by: owner`.
- **README.** A row for this file is added to `docs/acceptance/README.md` when the APs are decided.
- **Contracts.** `docs/contracts/ms3-shell.md` gets the `UiStateDto` fields of R176 and the history entry's `selection` (§12.1, AP-1410). These go into the new contract `docs/contracts/v1-outline.md`.

---

## Points for the owner (AP-1400…AP-1427 → D-1600…D-1627, accepted as proposed)

Raised while writing these criteria. Each criterion that depends on one names it and follows its **proposal**, which the owner accepted (AP-14xx → D-16xx).

| AP | Point | Proposal | Alternative | Affects |
| --- | --- | --- | --- | --- |
| AP-1400 | **Is the rail part of FR-EDT-11?** FR-EDT-11 is "outline … in the side panel". The board marks the edge rail (E1–E4, V1–V11) "Chosen, not yet in the BRD" (owner, 2026-11-13). | A new requirement **FR-EDT-16** "Outline rail on the note's edge: short lines per heading, hover or ⌘J opens the outline" (S, v1.0, slice OL). FR-EDT-11 stays the panel. | Reword FR-EDT-11 to cover both and renumber FR-EDT-16's criteria as FR-EDT-11 AC-22… | FR-EDT-16 AC-1…AC-14, BRD §8, §11 |
| AP-1401 | **Rail on by default, and a switch?** (board "Still open" 1) | On by default. A `Show outline rail` switch in Settings › Appearance, machine-local (`ui-state.json` `outlineRail`, missing = on, like the theme, D-128), plus the palette's `Toggle outline rail`. | Always on, no switch; or a per-vault setting in `.tegg/vault.yml` | FR-EDT-16 AC-1, FR-SET-02 AC-10, R175…R177 |
| AP-1402 | **The rail in focus mode?** (board "Still open" 2; FR-UX-02 "focus mode hides all chrome") | Hidden in focus mode, like the rest of the chrome. ⌘J still opens the card there, so the outline stays one key away. | Shown in focus mode (it is quiet) | FR-EDT-16 AC-1, AC-11, FR-UX-02 AC-9 |
| AP-1403 | **Collapse in the outline only, or also fold the note?** (board "Still open" 3; V6) | Outline only, as drawn. The note never folds, and the rail ignores the tab's folding (V6). Folding sections in the editor is a separate later requirement if wanted. | Collapsing a row also folds that section in the editor (a view state, never written) | FR-EDT-11 AC-13, AC-14, FR-EDT-16 AC-6 |
| AP-1404 | **What counts as a heading?** (board "Still open" 4: callouts yes, embedded notes no.) The BRD doesn't define the set, and FR-LNK-06 needs the same one. | R171 rules 2–3. Every heading the dialect parser finds in the body counts, including inside callouts (folded too), plain quotes and list items, and setext headings. Not counted: the frontmatter, code (fenced and indented), query blocks, mindmap callouts, raw HTML / `%%` / `$$` blocks, embeds' content, `#tag` lines, empty headings, the title. A body H1 equal to the title still counts. | List only top-level headings (no callouts, quotes or lists); or list empty headings as `Untitled heading` | FR-EDT-11 AC-2, AC-6, AC-11, FR-LNK-06 |
| AP-1405 | **How a heading's text is shown.** Headings may hold marks, links, code, tags, math, comments, block ids and closing hashes. | Plain text by R171 rule 4: marks dropped, links show their alias or text, code without backticks, tags as written, math as source, comments and block ids removed, whitespace collapsed. Shown as written (NFD looks the same), compared in NFC. One line with `…` and a tooltip. | Render the inline marks (bold, code) in the row | FR-EDT-11 AC-3, AC-15, FR-FMT-12 AC-10 |
| AP-1406 | **Indent by heading level or by tree depth?** The board indents 14 px "per level" and sets `aria-level` to the heading level. With skipped levels (H1 → H3) or a note starting at H3, that leaves gaps, and ARIA requires `aria-level` = depth in the tree. | Indent and `aria-level` by **depth** (parent = nearest earlier heading of a lower level). The rail keeps line length by **level**. For well-formed notes the board doesn't change. | Indent by level as drawn, `aria-level` by depth | R170, R171, FR-EDT-11 AC-4, FR-UX-08 AC-21 |
| AP-1407 | **Which rows are muted?** Board C's text and the prototype say "H5–H6 muted"; board B and C's drawings colour **H3 and deeper** `--muted`; B's note says "deeper levels lighter". | H5–H6 `--muted` (the text and the prototype). Weights: depth-1 H1 13 px / 500, others 12.5 px / 400, current 600. In the card, ancestors of the current section are 600 (V8). | H3–H6 muted, as drawn | R170, FR-EDT-11 AC-5, FR-EDT-16 AC-8 |
| AP-1408 | **The current-section rule in detail.** The board says "the heading above the top of the viewport" and "at the end the last heading is current". The prototype uses a 30 px line and a 2 px end tolerance. Taken literally, its end rule makes the last heading current at all times in a note that doesn't scroll. | R172: last heading whose top is at or above viewport top + 30 px; the end rule only when the note scrolls; in a non-scrolling note only rule 1 (often nothing is current); in a collapsed branch, the nearest visible ancestor; recomputed within 100 ms of scrolling; same rule for the tab, rail, card and source view. | In a non-scrolling note the heading holding the caret is current | FR-EDT-11 AC-9, AC-13, FR-EDT-16 AC-4 |
| AP-1409 | **The jump in detail.** The board says "to the top with a little space", a ~2 s blue highlight, and the caret at the end. It doesn't settle smooth versus instant scrolling, folded callouts, the source view, duplicate texts, or undo and dirty state. | R172. Instant scroll to 24 px. Caret at the end of the heading text, editor focused. `--link-bg` highlight 2,000 ms then a 300 ms fade, as a decoration (no undo step, not dirty). The target is by position, so duplicates are safe. A folded callout opens for viewing (its `-` marker isn't written). In the source view: scroll and highlight the line, no caret. A stale row does nothing. | Smooth scroll (off under Reduce motion); highlight without a caret move | FR-EDT-11 AC-10…AC-12, FR-EDT-16 AC-9 |
| AP-1410 | **A jump as a Back entry.** The board says "Back returns the cursor to where you were". History entries today hold a route and scrollTop only, and a push to the same route adds none (ms3-shell §12.1). | A jump pushes an entry on the same route with scrollTop **and the selection**. Back and Forward restore both, mapped through later edits (deleted block → nearest preceding block, D-112). There is no entry when nothing would change. Card and ⌘J jumps count. `nav_opened` isn't called. Contract §12.1's `Entry` gains `selection?`. | Back restores scroll only; or jumps add no history entry | FR-NAV-03 AC-15, AC-16 |
| AP-1411 | **Where the fold state lives, keyed how, pruned how.** The board says "per note, kept on this Mac only". | R176: `ui-state.json` `vaults[<vault>].outline.collapsed[<id, else NFC path>]` = fold keys `<level>:<NFC text>#<n>`. An entry is removed when nothing is collapsed. Stale keys are dropped at the note's next fold write. At most 200 notes per vault, oldest change dropped. Path keys re-key to the `id` after the first edit (as page-width's `noteWidth`). A renamed heading loses its fold. | Key headings by position index (survives text edits, breaks on inserts); or no limit | FR-STO-07 AC-7, AC-8, FR-EDT-11 AC-14, FR-FMT-12 AC-10 |
| AP-1412 | **Expand all / Collapse all and collapsed rows.** Board B and C show only `Collapse all`; D shows both. A collapsed row "shows how many headings it hides", but C's `Front matter 4` doesn't match its two children. The board doesn't say which row is current inside a collapsed branch. | Each button is present only when it would change something (neither on a note with no nested headings). A collapsed row shows the number of **all** hidden descendants. ⌥-click (and ⌥→ / ⌥←) acts on the whole branch. The current mark goes to the nearest visible ancestor and nothing auto-expands. Palette `Outline: Expand all` / `Collapse all`. | Both buttons always present, `aria-disabled` when they'd do nothing; the count shows direct children | R170, FR-EDT-11 AC-13, FR-UX-03 AC-45, AC-46 |
| AP-1413 | **The outline's own scrolling.** The board says "the current section is kept in view (scrolled to the middle when it leaves)". It doesn't say what happens while the user is reading or scrolling the tree. | The header stays put and the tree scrolls. When the current row leaves view, the tree centres it, except while the pointer is over the tree or the focus is in it. It resumes at the next current change after both have left. The tree never scrolls the note. | Always follow, even under the pointer | FR-EDT-11 AC-16 |
| AP-1414 | **When the rail has room.** The board says "below 640 px of **note** width"; the prototype measures the centre pane. "The note keeps 44 px free on the right", but the Normal column's padding is 40 px (page-width FR-UX-01 AC-6), so at centre panes of 640–840 px the text sits 40 px from the edge. | Measure the **centre pane** (≥ 640 px). While the rail is shown, the column's right padding grows to 44 px only where it reaches the pane's edge; Normal and Wide are otherwise unchanged. No space is reserved when the rail isn't shown (V1). | Measure the note column; or shift the rail into the 40 px | R173, FR-EDT-16 AC-1…AC-3 |
| AP-1415 | **The rail's row rule for odd notes.** The prototype's `depthX()` counts by heading **level**. A note of only H2s (no H1) then gets X = 1 and draws only the current branch, or nothing above the first heading. A note with more than 20 H1s draws all of them and can overflow the window. The prototype's 1.5 px lines are hard to hit with the pointer. | Count by **depth**. If depth 1 alone exceeds 20, shrink the gap (minimum 2 px) to fit the viewport height − 48 px; if it still doesn't fit, show no rail (⌘J and the tab remain). Each line's pointer target is its whole 8.5 px slot. | Cap the rail at 20 lines and scroll it; or always show depth 1 regardless of height | R173, FR-EDT-16 AC-5, AC-13 |
| AP-1416 | **Chevrons in the card: V5 versus V8.** V5 says "No chevrons and no collapsing in the card; it is for jumping only". V8 and V10 have chevrons that open other branches for a look. The prototype draws a chevron on every row with children. | A chevron only on a row whose children the card doesn't show, or that was opened in this card. The open lasts until the card closes and is never stored. On Architektura (everything fits) there are none (V5); on long notes there are (V8). | No chevrons in the card at all (V5 strictly); or chevrons on every parent as the prototype | R173, FR-EDT-16 AC-8, AC-11 |
| AP-1417 | **⌘J.** The prototype binds ⌘J to open and close the card. The board names only the palette command `Outline: jump to heading…`. ⌘J is free in R4, R8 and later tables, and isn't macOS-reserved. Nothing says what it does when the rail is hidden or the Outline is on screen. | ⌘J = `outline.jump` on note routes. Rail shown: the card with focus on the current row. Outline on screen: focus the tab's current row. Rail hidden (narrow, focus mode, switch off): the card at its usual place. No headings: announce `No headings yet`. Open card: close it (as Esc). | No shortcut, palette only; or ⌘J always opens the panel's Outline tab | R174, R175, FR-EDT-16 AC-11, FR-UX-03 AC-45 |
| AP-1418 | **Palette commands and Esc in the tree.** The graph has `Show local graph` (D-918); the board names only `Outline: jump to heading…`. | Add `Show outline` (`panel.outline`: opens the tab and focuses the current or first row, or the empty text), `Outline: Expand all`, `Outline: Collapse all` (listed while the Outline is on screen), and `Toggle outline rail` (AP-1401). Esc in the tab's tree returns the focus to the editor with its earlier selection. | Only `Outline: jump to heading…`; Esc in the tree does nothing | R174, R175, FR-NAV-05 AC-4, FR-UX-03 AC-45, AC-46 |
| AP-1419 | **Which views show the outline.** The note page has the editor and the source view (⌥⌘U, read-only, also for invalid frontmatter, NFR-REL-03); the read view is only a test fallback (D-215). | Editor and source view, with the same rows. In the source view a jump scrolls and highlights the line, places no caret, and the current rule uses line tops. The read view gets no criteria. | No outline in the source view (the tab shows a note that it's unavailable) | FR-EDT-11 AC-12 |
| AP-1420 | **Which routes.** The panel exists on `note/<path>`, `daily/<date>` and `new/<type>` (D-127); not on tag pages (AP-890) or type pages. | Those three routes. A virtual day shows its expanded template's headings (D-322), and the `new/<type>` draft its typed headings, both writing nothing. No panel or rail elsewhere. | Outline also on tag pages that have a Tag file | FR-EDT-11 AC-17, FR-EDT-16 AC-1, FR-NAV-05 AC-4 |
| AP-1421 | **VoiceOver and the rail's contrast.** The board labels the rail `nav` `Outline (hover to open)`, but its lines aren't focusable, so the landmark would be empty for VoiceOver. The resting lines use `--faint` (about 2.8:1 on white), below WCAG 1.4.11's 3:1 for graphics. | The rail is `aria-hidden` (a pointer shortcut; keyboard and VoiceOver users have ⌘J and the tab). The resting `--faint` lines are decorative (as D-129 allows for decorative icons); the current line (`--text`) and the ancestor lines (`--muted`) must reach 3:1. The tab and card use the tree pattern of FR-UX-08 AC-21. | Keep a `nav` landmark with focusable lines; or draw resting lines in `--muted` | R173, FR-UX-08 AC-21, FR-UX-05 AC-22 |
| AP-1422 | **Reduce motion.** The board has a 2 s highlight fade, a 150 ms rail fade and chevron rotation; FR-UX-08 says Reduce motion is respected. | Under Reduce motion: the highlight still lasts 2,000 ms but appears and disappears with no transition; no rail fade; no chevron rotation. The jump's scroll is instant in every mode. | Drop the highlight under Reduce motion | FR-UX-08 AC-22, FR-EDT-16 AC-10 |
| AP-1423 | **Live updates and performance.** The board says "live, no reload". There is no target for how fast, how long notes may be, or how this interacts with typing latency (NFR-PERF-06) and IME composition for Czech input. | No new NFR. The outline updates within **250 ms** of the last keystroke (debounced, never per keystroke, not during an IME composition), before `Saved`. A 500-heading note works (L5). On the reference machine the p95 edit → row update is under 250 ms, and NFR-PERF-06 holds with the tab or the rail on screen. Both are benchmarks, report-only until the v1.0 gate. | A new NFR-PERF-13 "Outline updated after an edit < 250 ms p95" | FR-EDT-11 AC-7, AC-20, FR-EDT-16 AC-12, NFR-PERF-06 AC-6 |
| AP-1424 | **AC-test changes this slice brings.** inbox.md FR-NAV-05 AC-1 says "Outline (`Coming in v1.0`)", as D-920 did for the Graph. App-shell R2's `outline` row (still "TBD MS5") and R4 (⌘J) change with it. | Approve now, applied in the build commit with `AC-Test-Change: AP-1424, the Outline tab is built in slice OL; approved-by: owner`: AC-1 takes the text in "FR-NAV-05" above, R2's row becomes built, and R4 gains ⌘J. | Approve when the slice lands | inbox.md FR-NAV-05 AC-1, app-shell R2, R4, FR-UX-03 AC-7, AC-14 |
| AP-1425 | **One heading list and one landing place with FR-LNK-06.** The board says "jumping from the outline uses the same scroll-to-heading" as heading links (D-140's `#Heading` subpath already scrolls). | `outlineHeadings` in `@tegg/doc` is the one heading list for the outline and for resolving `#Heading` (FR-LNK-06). A heading link lands at the same 24 px. Only the outline jump flashes and moves the caret; what a link follow does beyond the scroll is left to FR-LNK-06's criteria. | Keep them separate (the link keeps its current scroll) | R171, FR-EDT-11 AC-19, FR-LNK-06 |
| AP-1426 | **The count in the header.** The board's numbers differ: C reads `22 headings` with 18 drawn; D's caption says 40 and its header 38; V7 says 55. | The count is the number of headings the outline lists in the note (R171), independent of collapsing and of the rail; the board's numbers are illustrative. | Count the visible rows | R170, FR-EDT-11 AC-1, AC-13 |
| AP-1427 | **AC numbers shared with parallel work.** Another session is adding points after AP-1343 and may add criteria to the same shared requirements (FR-SYN-06, FR-UX-03, FR-UX-05, FR-UX-08, NFR-OTH-02, FR-STO-07, FR-FMT-12, FR-SET-02, FR-NAV-03). | Keep the numbers used here (FR-SYN-06 AC-46, FR-UX-03 AC-45…AC-47, FR-UX-08 AC-21, AC-22, FR-UX-05 AC-22, NFR-OTH-02 AC-19, FR-STO-07 AC-7, AC-8, FR-FMT-12 AC-10, FR-SET-02 AC-10, FR-NAV-03 AC-15, AC-16, FR-NAV-05 AC-4, AC-5, NFR-PERF-06 AC-6). Whichever set is approved second renumbers its clashes before its red tests (as D-1030). | Reserve fixed blocks per slice | every shared criterion here |
