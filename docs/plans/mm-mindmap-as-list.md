# Slice MM: a mindmap is a list in a `[!mindmap]` callout (2026-10-22)

Status: **decided.** The owner accepted AP-620…AP-628 as proposed on 2026-10-22: **D-679…D-687**, BRD v1.84. The BRD, the dialect and the docs in §4 are updated; the AC tests, code, contracts and design boards in §4 change in slice MM. AP numbers start at AP-620 to leave AP-608…AP-619 to the 4D-lite red tests (`docs/contracts/ms4-tags.md` §10).

## 1. Why

The design review of slice MM (2026-10-22) found that the Main board edits the mindmap on the canvas, while D-377 asks for an indented outline with a live re-render, and that several MVP states (empty block, invalid Mermaid, read view, editable source, unsupported Mermaid syntax) aren't drawn. Discussing it, the owner proposed to drop Mermaid: a mindmap is an ordinary nested list, marked as a mindmap, and Tegg draws it.

What this gives:

- **The outline editor already exists.** Tab, Shift-Tab, Enter and inline text are list editing (FR-EDT-02). MM needs no outline-to-Mermaid serializer, so the riskiest part of the slice goes away.
- **No re-serialization.** The list is stored as written; only the items the user edits change (FR-FMT-07).
- **Links in nodes are links.** Inside a fenced block they are not (`docs/markdown-dialect.md` "Not links"), so D-377's "`[[links]]` inside nodes are links" would have needed an extractor exception. In a list they get backlinks (D-277 excerpts) and rename updates (4C) with no change.
- **Node → object (FR-MMP-03, v1.0)** becomes FR-CNV on a list item, which 5A-2 builds.
- **No Mermaid bundle.** No lazy-loaded layout library to check for runtime fetches (NFR-SEC-01).
- **The editor already allows it.** The callout node is `calloutTitle block*` (`packages/editor/src/schema.ts`), so a list inside a callout is real block content today.

The cost: in Obsidian a mindmap shows as a callout holding a list, not as a diagram (§3, AP-627).

## 2. The format

```markdown
> [!mindmap] Offsite 2026
> - Offsite 2026
>   - Agenda
>     - Q4 review
>     - Roadmap 2027
>   - Venue
>     - [[Lisbon Offsite 2026]]
>   - Travel
```

A mindmap block is a callout of type `mindmap` whose body is one list. The title is optional. Everything else is ordinary Markdown.

## 3. Points for the owner

| AP | Point | Proposal | Alternative |
| --- | --- | --- | --- |
| AP-620 | **Drop Mermaid as the mindmap format** (supersedes the mindmap part of D-05, the OQ-15 part of D-36, and D-377's "render with Mermaid bundled") | A mindmap is stored as the callout of §2, not as a Mermaid fence. Tegg ships no Mermaid. An existing ```` ```mermaid ```` `mindmap` fence stays what it is today: a preserved raw fence, shown as code in the read view and as a read-only source block in the editor (D-145), byte-identical on save. A `Convert to mindmap list` action for such fences is v1.0 if ever wanted | Keep rendering Mermaid fences read-only beside the new format (brings the Mermaid bundle back for a rare case) |
| AP-621 | **The marker: a `> [!mindmap]` callout** | The callout type `mindmap` is matched case-insensitively, like other Obsidian callout types, and the `+`/`-` fold markers work as on any callout (folding writes nothing, editor.md AC-19). The block is a mindmap when the body, after the title line, is **exactly one list** (bulleted, numbered or checklist). Any other body (paragraphs, two lists, a list and a paragraph) is shown as an ordinary callout with the mindmap icon and the hint `A mindmap holds one list`, so nothing is hidden or rewritten. `mindmap` becomes the 14th entry of the `Callout type` submenu (D-189) | A `%%mindmap%%` comment line above a plain list (lighter, but the mark silently breaks when a block lands between them) |
| AP-622 | **The root** | With **one top-level item**, that item is the root (the owner's example). With **several top-level items**, the root is the callout title, or the note title if the callout has none; this root is drawn but not stored, and is not editable on the map. An **empty list** shows the empty state `Type the central topic`, with the caret in the first item | Several top-level items are drawn as several trees side by side |
| AP-623 | **What a node shows** | The item's first paragraph with its inline Markdown (bold, code, highlight, `[[links]]` as link chips, `#tags` as tag chips, date mentions). An item holding more (a second paragraph, code, a quote) shows its first line and `…`. Checklist items show their checkbox, read-only on the map (toggled in the list, AP-625). An embed `![[Task]]` in an item shows its link chip (D-600 states). Long text wraps at a fixed node width; nothing is truncated without `…` | Nodes show plain text only (simpler; loses chips) |
| AP-624 | **Tegg draws the map** (replaces the Mermaid row of the tech table and R-08's "Mermaid supports") | A left-to-right tree layout in the app's own code (SVG or HTML), deterministic (the same list gives the same picture, so it is testable at L4), using Tegg's colour tokens in light and dark (FR-UX-05); each top-level branch gets a colour from the token palette by its position. **No layout, position or colour is stored** (R-08 stands in spirit). A wide map scrolls horizontally inside the block; zoom, pan, collapse and drag stay v1.0 (D-377). Performance: a 500-node map lays out within one frame at the reference machine (an L4 bench, NFR-PERF-05 style) | Use the `markmap` library (MIT, d3; draws Markdown lists as mindmaps; more code to vet, its own look) |
| AP-625 | **Editing and the view toggle** (replaces FR-MMP-02's Visual / Source toggle in the MVP) | The block header has a `Map` / `List` toggle. **Map** shows the drawing; clicking a node switches to List with the caret in that item. **List** shows the callout body as the ordinary editable list, with the map re-rendered live below it (debounced; this is D-377's "live re-render"). The block opens in Map; the chosen view is not stored in the file (session only). The read view always shows Map, with links clickable | Side by side (list left, map right) in List mode; needs the editor width the narrow layout doesn't have |
| AP-626 | **Inserting and converting** | `/mindmap` (slash menu, R6 row moves from v1.0 to MS5) inserts `> [!mindmap]` with one empty item, in List mode, caret in the item. On a list, the block menu's `Turn into → Mindmap` wraps the list in the callout; `Callout type` → another type, or `Turn into → List` on the callout, unwraps it. Each is one undo step (editor.md undo AC). FR-MMP-04 is unchanged: a type's template file can hold the block (D-92, D-270) | Only `/mindmap`, no wrap/unwrap in the MVP |
| AP-627 | **Obsidian** (NFR-POR-01, FR-FMT-05 AC-3) | `[!mindmap]` is an unknown callout type in Obsidian, shown in the default callout style titled `Mindmap` (or the title) with the list inside; links and embeds work. NFR-POR-01 says "mindmaps (as a callout holding a list)". FR-FMT-05 AC-3 is rechecked by the owner in Obsidian (D-151 precedent) | — |
| AP-628 | **What stays v1.0** | Unchanged from D-377: drag to re-parent, collapse, zoom/pan, node → object (FR-MMP-03; now FR-CNV on a list item), export as an image (FR-MMP-05; now Tegg's own SVG, FR-EXP-03 reworded). Templates beyond the verbatim file stay FR-TPL | — |

## 4. What changes once decided

**BRD** (new version, one D-xx per AP):

- D-05: "Mindmaps stored as Mermaid code blocks" → "as a `[!mindmap]` callout holding a list".
- D-36: the OQ-15 part ("visual editor saving to Mermaid").
- D-377: the Mermaid bundling sentence and the `source` toggle.
- FR-FMT-05, FR-MMP-01, FR-MMP-02 (Visual/Source → Map/List; "changes write back to Mermaid" goes), FR-EXP-03 ("Mermaid mindmaps rendered as images"), NFR-POR-01.
- The tech table row `Mindmap`, R-08, §11 rows MVP and v1.0 ("Mermaid render").

**Docs:**

- `docs/markdown-dialect.md`: the Mindmap row of the block table; `mindmap` in the callout types.
- `docs/acceptance/file-format.md`: FR-FMT-05 AC-1 and AC-3.
- `docs/acceptance/read-view.md`: the R5 `mindmap` placeholder row goes (the block renders).
- `docs/acceptance/editor.md`: the R3/R6 slash row; Surové bloky keeps its Mermaid fence as a source block.
- `docs/requirements-coverage.md`, `docs/plans/mvp-daily-use-plan.md` row 6b, `docs/plans/mvp-design-review.md` MM row.
- A new `docs/acceptance/mindmap.md` for slice MM, written after these decisions.

**AC tests that change** (each needs an `AC-Test-Change: …; approved-by: owner` trailer):

- `packages/doc/test/links.ac.test.ts` `fr_fmt_05_ac1_…`: the Mermaid fence is no longer the mindmap block; it becomes a preserved fence, and a new AC-1 checks the callout.
- `app/test/shell-tables.ts` and `app/test/embeds_registry.ac.test.ts`: R5 loses the `mindmap` row.
- `app/test/read_view.ac.test.ts`: Bloky's placeholders become `['query']`; its two Mermaid blocks show as code.
- `app/test/editor_registry.ac.test.ts`: the slash row `Mindmap` moves from v1.0 to MS5.

**Code** (MS1–MS3, small): `packages/doc/src/parse.ts` stops classifying Mermaid fences as `mindmap` (they become `raw`/`code`) and recognises the callout; the `ph.mindmap` placeholder paths in `ReadView.tsx`, `EditorPane.tsx`, `EmbedEditor.tsx`, `present.ts` and `registry.ts` go. The contracts follow: `docs/contracts/ms1-core.md` (block kinds) and `docs/contracts/ms3-shell.md` (`IN_NOTE_PLACEHOLDERS`).

**Design boards:** Main and MainUnreviewed redraw the block: callout header with `Map` / `List`, the list under the map in List mode, no zoom or full-screen buttons, no collapsed badge, slash row text `Edit as a list, shown as a map`. The empty state of AP-622 and the non-list hint of AP-621 are new small states.
