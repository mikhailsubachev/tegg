# ADR 0002: Block editor on source blocks

- **Status:** Proposed (from spike S2, 2026-10-10)
- **Requirements:** FR-EDT-01…06, -13, -14, -15, FR-FMT-07, NFR-PERF-05, NFR-PERF-06
- **Builds on:** ADR 0001 (source-preserving documents)
- **Evidence:** `spikes/s2-editor/FINDINGS.md`

## Context

ADR 0001 keeps each note as its original text plus block ranges and changes files only by patches. The block editor (TipTap/ProseMirror, D-04, D-19) has its own document model, and serializing that model whole would undo ADR 0001.

## Decision

1. **Load:** each source block becomes one top-level editor node carrying `srcIndex`, the index of its source block. Blocks the editor can't represent losslessly, and raw blocks (HTML, footnote definitions, `$$` math, plugin fences), become read-only `rawBlock` nodes holding their source.
2. **Losslessness check:** a block is editable only if what the editor would write for it, read back in the note's context, gives exactly the same editor content.
3. **Normalization guard:** after loading, any block the editor changed by itself (plugin normalization) becomes read-only raw, so opening can never rewrite a note.
4. **Save (`reconcile`):** for each top-level node, in order: if it equals its original node, emit the source block byte-for-byte; otherwise render only that node (keeping its list-marker style). Gaps between consecutive original blocks are kept; new adjacencies get a blank line. No change → no write.
5. **Verify every save by re-parsing**: untouched blocks byte-identical, and every changed block reads back to the same editor content (text, marks, structure). If that fails, escalate: blank lines around changed blocks → a different marker for one of two adjacent same-marker lists → a `<!-- -->` separator after a list followed by an indented block. If none works, refuse the save rather than damage the note.
6. **Obsidian syntax is schema:** `wikiLink` and `tag` inline nodes, a `highlight` mark, `rawInline` for inline math, comments, inline HTML, footnote references and Markdown images. Paragraph edge spaces and hard breaks are trimmed before rendering; literal `==`, `%%`, `$` are escaped; a tag rules plugin keeps tag nodes equal to what the parser will read.
   The marker change and `<!-- -->` separator in step 5 change bytes of a block the user didn't edit; they are pending the owner's decision (AP-10).
7. The editor talks to the core only through `list` / `read` / `write` (bytes) over IPC; the core does atomic writes (FR-SYN-02).

## Consequences

- **Good:** unedited notes are never rewritten; edits change only the edited blocks; verified on 43 fixtures × all operations, a property test, WebKit end-to-end, and 923 real notes (provisional until the owner re-runs `npm run test:real`, see FINDINGS privacy note).
- **Cost:** a full re-parse per save and a per-block check on open; both need the MVP optimizations in FINDINGS (lazy check, region-limited verify) to meet D-59's reference targets.
- **Visible artefacts, rare:** a changed list marker when two lists become adjacent; a `<!-- -->` line after a list followed by indented code.

## Alternatives considered

- **Serialize the editor model whole** (TipTap's usual Markdown export): rejected by ADR 0001; rewrites every block.
- **BlockNote:** lossy Markdown conversion (D-19).
- **Diff the regenerated Markdown against the file:** fragile with reflowed or escaped content (S1 F1–F3).
