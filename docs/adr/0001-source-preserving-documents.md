# ADR 0001: Source-preserving documents (patch, don't regenerate)

- **Status:** Proposed (from spike S1, 2026-10-08)
- **Requirements:** FR-FMT-07, FR-SYN-06, NFR-REL-01, NFR-POR-01, AR-06; risk R-01
- **Evidence:** `spikes/s1-roundtrip/FINDINGS.md`

## Context

Tegg edits plain Markdown files that must stay Obsidian-compatible and unchanged except where the user edited (FR-FMT-07). Block editors (ProseMirror/TipTap) normally serialize the whole document from their model, which normalizes list markers, emphasis, spacing and frontmatter on every save. That breaks the round-trip guarantee, creates sync churn (FR-SYN-06) and conflict copies (R-02).

## Decision

1. A document is its **original text plus ranges**: an optional frontmatter range with per-key line ranges, and top-level blocks with their source ranges; text between blocks (gaps) belongs to no block.
2. **Every change is a patch** to one or more ranges: a block (`editBlock`), a frontmatter entry (`setAttribute` / `removeAttribute`), or link targets (`renameLinkTarget`). Nothing outside the patched ranges is ever rewritten.
3. Only **changed blocks are rendered** to Markdown, with the canonical dialect style, except that an edited block keeps its own list-marker style and trailing empty quote lines.
4. Obsidian syntax (wikilinks, embeds, tags) is **real syntax** in the parser and serializer, never plain text.
5. Each block edit is **verified by re-parsing**. If the structure of neighbouring blocks would change, a blank line is added to the adjacent gap; if that is not enough, the edit is refused.
6. Unknown or unsupported syntax becomes **raw blocks**, which are never re-rendered.
7. Writes to disk use these patches and the atomic write path (FR-SYN-02). Before writing, the original text is compared with the file on disk (FR-SYN-03 AC-7).

## Consequences

- **Good:** byte-identical round-trips by construction (verified on 923 real notes), minimal diffs, no sync churn, unknown syntax preserved, simple conflict detection (the patch base is known).
- **Cost:** the editor (S2) must track source ranges per top-level block and map transactions to changed blocks; inline Obsidian syntax must be modelled as nodes/marks; one re-parse per save.
- **Language split:** TypeScript owns body parsing for editing and Markdown writes; Rust (S4) reads frontmatter, links and tags for the index with a matching extractor, verified against the same fixture corpus.

## Alternatives considered

- **Serialize the whole document from the editor model** (the usual approach): fails FR-FMT-07; found 6 ways it damages notes (FINDINGS F1–F6).
- **Store the editor's JSON alongside the Markdown:** violates "files are the source of truth" (AR-01) and Obsidian compatibility.
- **Diff the regenerated Markdown against the original and keep unchanged lines:** fragile when the serializer reflows content; doesn't help with escaping (F1–F3).
