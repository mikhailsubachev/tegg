# Spike S1 Findings: Source-Preserving Markdown

**Date:** 2026-10-08 · **Branch:** `spike/s1-roundtrip` · **Decision record:** [ADR 0001](../../docs/adr/0001-source-preserving-documents.md)

## Verdict: GO

The patch model works. A file is kept as its original text plus block and frontmatter ranges; every change is a patch to one range. On 43 synthetic fixtures and both real exports:

| Check | Synthetic fixtures | Real Capacities export | Real Notion export |
| --- | --- | --- | --- |
| Unedited round-trip byte-identical (FR-FMT-07 AC-1) | 43 / 43 | **697 / 697** | **226 / 226** |
| Single-block edits that changed only that block, kept its type, every link and every tag (AC-3, AC-4) | all | **2,405 / 2,405** | **758 / 758** |
| Attribute edits that changed only that entry's lines (AC-5) | every key of every fixture | — | — |
| Random edit sequences (property test, 1,000 runs × several seeds) | pass | — | — |
| Zip entries read with correct UTF-8 names (FR-IMP-07) | — | 812 / 812 | **245 / 245** (system `unzip` failed on these) |
| Files with invalid / unclosed frontmatter | handled (NFR-REL-03) | 0 | 0 |

The real-export test prints counts only (D-50, R-10).

Test suite: 377 tests, `npm test` in this folder. Real exports: `npm run test:real` (skipped when `test exports/` is absent).

## What the spike found (all fixed in the prototype)

Each of these would have silently damaged notes in a naive "editor model → Markdown" design. They are now regression tests.

| # | Problem | Cause | Fix |
| --- | --- | --- | --- |
| F1 | **Every `[[link]]` and `![[embed]]` in an edited block became `\[\[link]]`** | CommonMark doesn't know wikilinks; the serializer escapes `[` in text | Wikilinks/embeds are real syntax: a micromark extension (`src/wikilink.ts`) whose node is written back verbatim |
| F2 | **A `#tag` at the start of a line became `\#tag`** (tag lost) | Same: `#` at line start looks like a heading to the serializer | Tags are real syntax too (`src/tag.ts`) |
| F3 | **Callouts turned into plain quotes** (`> [!note]` → `> \[!note]`) | Escaping of `[` | Unescape the callout marker when rendering a blockquote |
| F4 | **Two adjacent lists merged into one** after editing (`1)` list re-rendered as `1.` next to a `3.` list) | The list marker is what separates adjacent lists | An edited block keeps its original list marker style |
| F5 | **A paragraph was pulled into the quote above it** (found in the real Capacities export) | The quote's trailing empty `>` line was dropped; CommonMark "lazy continuation" then joins the next line | Keep trailing empty `>` lines; plus a general safety net (below) |
| F6 | Tags with diacritics in NFD (`c` + combining caron) were cut at the accent | Tag pattern lacked combining marks `\p{M}` | Added `\p{M}` |

**Safety net:** `editBlock` re-parses after every patch and checks that the block count and every other block are unchanged. If CommonMark adjacency rules would still merge the edited block with a neighbour, it adds one blank line to the gap next to the block (the smallest change that keeps the structure); if that doesn't help, it refuses the edit instead of writing a damaged file. This costs one re-parse per save (fast; measure in S4).

## Implications for S2 (TipTap editor)

1. **The editor never serializes the whole document.** It keeps, per block, the source range and raw text from `parse()`. On save, only blocks whose ProseMirror nodes changed are rendered (`renderBlock(node, originalRaw)`) and patched in (`editBlock`). Untouched blocks keep their bytes, whatever their style.
2. **Raw blocks** (HTML, footnote definitions, `$$` math, `%%` comments, indented code, plugin fences like `dataview`) are opaque ProseMirror nodes holding their source; they're never re-rendered.
3. **Obsidian inline syntax must be ProseMirror nodes/marks** that map to `wikiLink` and `tag` mdast nodes (and back), never plain text. Still to cover in S2: `==highlight==`, inline `%%comment%%`, inline `$math$`, block IDs `^id`: today they survive only because they're plain text that the serializer happens not to escape; S2 must add explicit tests for editing blocks that contain them.
4. **New blocks** use the canonical style (dialect §4). When a block's **type changes** (paragraph → list) or blocks are inserted/split/merged, adjacency rules apply; the editor should go through `editBlock`-style verification for the affected range and insert blank-line gaps where needed.
5. The mapping ProseMirror transaction → changed top-level blocks is the main S2 work item. Multi-block edits (paste, drag & drop, block move) become one patch over the contiguous range.

## Language split recommendation

- **TypeScript owns parsing for editing and all writes** of Markdown bodies (this model). It's where the editor lives, and the micromark/remark ecosystem made F1–F5 fixable in hours.
- **Frontmatter writes** are line-range patches with a YAML formatter; they're simple and can live in either language. Keep them in TypeScript for now, next to body edits, so one module owns "patch a file".
- **Rust (S4) owns reading for the index:** frontmatter, links, tags, titles. It needs a read-only extractor that matches this one; the fixture corpus and `links.test.ts` expectations become a shared conformance suite (export expectations as JSON so Rust tests can consume them).
- **Bulk rewrites** (rename links across 50 files, tag rename, attribute rename) are pure range patches. They can run in Rust using the same rules, or in TypeScript via the core; decide in S4 based on where the file-writing service lives. Either way, writes must follow FR-SYN-02 (atomic) and this patch model.

## Limits of this spike

- Prototype quality: no performance work, no streaming. Parse + verify is fast for typical notes; measure on the 5,000-note vault in S4.
- `setAttribute` formats values with a small formatter (dates, date-times, links, lists, strings via `yaml`); multi-line strings use YAML defaults; good enough for the spike, refine with the type system.
- Link targets are recognized by a regex scanner for indexing and renames, and by the micromark extension for editing. Both agree on all fixtures; S2/S4 should converge on one definition.
- Not covered: block IDs generation (FR-LNK-06), heading-link updates on heading rename, embeds of blocks.

## Dialect changes from S1

Recorded in `docs/markdown-dialect.md`: an edited block keeps its list-marker style; trailing empty `>` lines are kept; edits are verified and may add a blank line to an adjacent gap; tags allow combining marks.
