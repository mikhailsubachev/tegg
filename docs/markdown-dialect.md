# Tegg Markdown Dialect

Status: validated by spike S1 (`spikes/s1-roundtrip/FINDINGS.md`, ADR 0001). Defines exactly what Tegg **reads** and **writes** in a vault `.md` file. Requirements: FR-FMT-01…12, FR-STO-02, FR-TYP-02, FR-TYP-15, D-05, D-51…D-55.

## 1. Principles

1. **Read generously, write conservatively.** Tegg reads CommonMark, GFM and Obsidian syntax plus the exports it imports. It writes only the canonical forms below, and only where the user changed something.
2. **Patch, don't regenerate** (FR-FMT-07). A file is kept as its original text. Every change replaces a byte range: one block, one frontmatter entry, or one link target. Everything else stays byte-identical, including syntax Tegg doesn't understand.
3. **Obsidian is the compatibility reference** (D-05, NFR-POR-01). If Obsidian renders a construct differently from this spec, that's a bug in the spec.
4. **Edited blocks keep their structure** (from spike S1, ADR 0001):
   - An edited block keeps its own list-marker style (`*`, `+`, `-`, `1.`, `1)`); only new blocks use the canonical style. Markers separate adjacent lists.
   - Trailing empty quote lines (`>`) of an edited quote are kept; they stop the next line from becoming a lazy continuation.
   - Every block edit is verified by re-parsing. If the edited block would merge with a neighbour, one blank line is added to the gap next to it; otherwise the edit is refused.
   - Wikilinks, embeds and tags are syntax nodes, written back verbatim, never escaped. So are `==highlight==`, inline `%%comment%%` and `$math$` (spike S2).
5. **Saving from the block editor** (spike S2, ADR 0002):
   - Unchanged blocks are written byte-for-byte, even when moved; only changed or new blocks are rendered. Leading and trailing spaces of a rendered paragraph, heading or table cell are dropped (Markdown ignores them; otherwise they'd be written as `&#x20;`).
   - When two lists with the same marker become adjacent (e.g. the block between them was deleted), one of them is written with another marker (`-` → `*`, `1.` → `1)`), because a blank line doesn't separate them.
   - When a list is newly followed by an indented block (indented code), a `<!-- -->` line is written between them; CommonMark would otherwise make the indented block part of the list.

## 2. File envelope

| Aspect | Reading | Writing new files | Editing existing files |
| --- | --- | --- | --- |
| Encoding | UTF-8, with or without BOM | UTF-8, no BOM | Keep BOM as found |
| Line endings | LF, CRLF, mixed | LF | Keep the file's dominant ending; new lines use it too |
| Final newline | Either | Exactly one `\n` | Keep as found |
| Unicode | Any normalization | NFC (FR-FMT-12) | Edited text written in NFC; untouched text unchanged |

## 3. Frontmatter (FR-FMT-01)

- Starts with `---` as the **very first line** (after an optional BOM) and ends at the next line that is exactly `---` (or `...`). If the closing line is missing, the file has **no frontmatter** and the opening `---` is treated as body (a thematic break), with a warning (NFR-REL-03).
- Content is YAML 1.2. Invalid YAML: the file opens in source mode with the error line; it is never rewritten automatically (NFR-REL-03).
- **Editing** an attribute replaces only that key's source lines (key through the end of its value, including multi-line lists and folded strings). Key order, comments, quoting style and unknown keys elsewhere are preserved. A new attribute is appended as the last entry.

### Value formats

| Attribute type | Written as | Also read |
| --- | --- | --- |
| Text | plain scalar; quoted with `"` only when YAML requires it | any scalar style, `'…'`, `>-`, `|` |
| Number | `12`, `3.5` | quoted numbers are text |
| Checkbox | `true` / `false` | `yes`/`no` are text (YAML 1.2) |
| Date | `2026-10-09` (FR-FMT-11) | `'2026-10-09'`, ISO date-time at UTC midnight (import only) |
| Date-time | `2026-10-09T14:30:00+02:00` | any ISO 8601 |
| Date range `k` | `k-start: 2026-07-01` and `k-end: 2026-07-14` (FR-TYP-02) | — |
| Select | plain scalar | — |
| Multi-select, lists | block list (`- a` lines) | flow list `[a, b]` |
| Relation | `"[[Note]]"`; multiple as a block list of quoted links | unquoted `[[Note]]` is invalid YAML (a nested list) and is reported |
| Empty | key omitted | `key:`, `key: null`, `key: ~` all mean empty |

Reserved keys (FR-TYP-15): `id, type, title, description, aliases, tags, created, modified, source, review, icon, cover, previous, file, import-id`. `id` is a 26-character ULID written on creation or on first edit of an untyped file (D-54). `modified` changes only when content changes (D-55). `tags` is a list of tag names without `#`.

## 4. Blocks (body)

A **block** is a top-level CommonMark/GFM construct. Text between blocks (blank lines) belongs to no block and is never rewritten.

| Block | Syntax read | Canonical written form |
| --- | --- | --- |
| Paragraph | CommonMark | — |
| Heading 1–3 | ATX `#`…`######`, Setext | ATX, `#`–`###` |
| Bulleted list | `-`, `*`, `+` | `-` |
| Numbered list | `1.`, `1)` | `1.` |
| Checklist item (FR-TSK-11) | `- [ ]`, `- [x]`, `- [X]` | `- [ ]` / `- [x]` |
| Quote | `>` | `>` |
| Callout | `> [!type] Title` (Obsidian), optional `+`/`-` fold marker | `> [!note] Title` |
| Code block | fenced ```` ``` ```` / `~~~`, indented | fenced ```` ``` ```` |
| Divider | `---`, `***`, `___` | `---` |
| Table | GFM; `\|` escapes a pipe inside cells (also inside links) | GFM |
| Mindmap (FR-FMT-05) | fenced `mermaid` whose first non-empty line is `mindmap` | same |
| Query (FR-FMT-06) | fenced `query` containing YAML | same |
| Embed block | a paragraph containing only `![[…]]` | `![[…]]` |
| Raw (preserved) | HTML blocks, footnote definitions `[^1]:`, math `$$…$$`, comment blocks `%%…%%`, unknown fences (`dataview`, …) | never rewritten |

## 5. Inline syntax

| Element | Syntax | Notes |
| --- | --- | --- |
| Emphasis | `*em*`, `_em_`, `**strong**`, `__strong__` | written as `*` / `**` |
| Strikethrough, highlight, code | `~~s~~`, `==h==`, `` `c` `` | |
| Markdown link | `[text](url)`, `[text](path.md)` | relative `.md` links are read as links (URL-decoded) |
| Wikilink (FR-FMT-03) | `[[Target]]`, `[[Target\|alias]]`, `[[Target#Heading]]`, `[[Target#^blockid]]` | inside table cells the `\|` form |
| Embed (FR-FMT-04) | `![[Target]]`, `![[Target#^id]]`, `![[img.png\|400]]`, `![[img.png\|400x300]]`, `![[doc.pdf#page=3]]` | |
| Image (Markdown) | `![alt](path)` | read; written only as `![[…]]` |
| Block ID | ` ^abc123` at the end of a block | `[A-Za-z0-9-]+` |
| Tag (FR-FMT-10) | `#name` | see below |
| Comment | `%%text%%` inline | preserved, hidden in the editor |
| Math | `$x$` | preserved |

**Not links:** anything inside code spans, fenced or indented code, math, HTML, or comments.

### Tags

A tag is `#` followed by one or more of: Unicode letters, combining marks (for NFD text), digits, `_`, `-`, `/` (D-40: `/` is part of a flat name), containing **at least one non-digit**, where `#` is at the start of a line or after whitespace or `(`. Not tags: `#1`, `# Heading` (space after `#`), `#` inside URLs (`site.com/#x`), code or links. Matching is case-insensitive and NFC; the stored spelling is kept.

## 6. Link resolution

1. Strip `#heading`, `#^block` and `|alias`; NFC-normalize; compare case-insensitively.
2. Match against **file names** without `.md` (attachments with extension). If several files share the name in different folders, prefer the same folder, then the shortest path (Obsidian behavior).
3. Titles are display text only; they never resolve a link alone (FR-LNK-14). A date `YYYY-MM-DD` resolves to that day's Daily Note, existing or virtual (FR-DLY-08).

## 7. File names (FR-FMT-08, NFR-POR-02)

- Title → file name: replace `/ : \ * ? " < > |` and control characters with a space (D-52), collapse spaces, trim leading/trailing spaces and dots, NFC, cut to **200 UTF-8 bytes** at a character boundary (D-51). Windows reserved names (`CON`, `NUL`, …) get ` (note)`.
- If the file name differs from the title, `title:` holds the real title.
- Duplicates: ` (2)`, ` (3)`, … before `.md` (FR-LNK-14, D-53).
- Daily notes: `YYYY-MM-DD.md` by default (FR-FMT-09).
