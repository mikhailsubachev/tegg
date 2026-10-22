# Acceptance Criteria: File Format & Round-Trip

See [README](README.md) for conventions. Fixtures live in `tests/fixtures/format/`.

---

### FR-FMT-07 Round-trip safety (most critical)

- **AC-1** Given every file in `tests/fixtures/format/roundtrip/` (Tegg-created notes, Obsidian notes, Capacities and Notion samples), when the file is parsed into the editor model and serialized **without edits**, then the output is **byte-identical** to the input.
- **AC-2** Given a note is opened in the app and closed without edits, then the file on disk is **not written at all** (modification time and inode unchanged).
- **AC-3** Given a note with 10 blocks, when the user edits the text of block 5 only, then the serialized output differs from the original **only within block 5's byte range** and the `modified` attribute (AP-5). All other bytes (spacing, list markers `*` vs `-`, emphasis `_` vs `*`, blank lines, trailing whitespace) are unchanged.
- **AC-4** Given content the editor does not understand: raw HTML (`<details>`, `<br>`), footnotes (`[^1]` and their definitions), unknown fenced code blocks (` ```dataview `), Obsidian comments (`%% … %%`), math (`$…$`, `$$…$$`), then each is shown as a **raw block** and is preserved byte-for-byte after editing other blocks.
- **AC-5** Given frontmatter with keys unknown to the type schema, unusual YAML styles (flow lists `[a, b]`, folded `>-` strings, quoted and unquoted values, comments), when the user edits **one** attribute, then only that attribute's line(s) change; key order, quoting style, comments and unknown keys are preserved.
- **AC-6** Given a file without a trailing newline, or with a trailing newline, then that state is preserved after any edit.
- **AC-7** Round-trip tests run in CI on every change to the parser, serializer or editor schema (AR-06).

### AR-06 Round-trip test corpus

- **AC-1** `tests/fixtures/format/roundtrip/` contains at least: 10 Obsidian-style notes (callouts, block IDs, embeds with size, heading links, tables, nested lists, checklists, tags inline and in frontmatter), 10 Capacities-style notes, 5 Notion-style notes, 5 Tegg-created notes using every MVP block type.
- **AC-2** Every finding C1–C19 and N1–N10 in BRD §15 that concerns file content is represented by at least one fixture; the fixture README maps finding → fixture file.
- **AC-3** [manual] `[real-export]` The local-only run parses every Markdown file in the real exports and reports the count of files that fail AC-1 (must be 0) by file index only.

### FR-FMT-01 YAML frontmatter

- **AC-1** Attributes are written in YAML frontmatter delimited by `---` lines at the top of the file.
- **AC-2** Value types are written as Obsidian Properties understands them: text → string, number → number, checkbox → `true`/`false`, date → `YYYY-MM-DD`, date-time → ISO 8601 with offset, list/multi-select → YAML list.
- **AC-3** [manual] A note with one attribute of each type opens in Obsidian (current version) with every value shown in the correct Properties type.

### FR-FMT-02 Stable id, type, timestamps

- **AC-1** A new object created in Tegg has `id` (26-character ULID), `type`, `created` and `modified` in its frontmatter.
- **AC-2** [MS2] Given an object is renamed, moved to another type folder, or edited in another editor, then its `id` is unchanged and the index still identifies it as the same object.
- **AC-3** Given an untyped Markdown file (no `id`), it is not modified on open; `id` and `type: page` are written on the first edit in Tegg (AP-4).
- **AC-4** `modified` changes only when content or an attribute changed (AP-5); `created` never changes after creation.

### FR-FMT-03 / FR-FMT-04 Links and embeds syntax

- **AC-1** The parser recognizes and the serializer writes: `[[Note]]`, `[[Note|alias]]`, `[[Note#Heading]]`, `[[Note#^blockid]]`, `![[Note]]`, `![[Note#^blockid]]`, `![[image.png|400]]`, `![[file.pdf#page=3]]`.
- **AC-2** Relation attributes are stored as quoted strings: single `"[[Note]]"`, multiple as a YAML list of quoted strings.
- **AC-3** A `|` inside a link in a Markdown table is written as `\|` and parsed back correctly.
- **AC-4** Links inside code spans and code blocks are **not** treated as links.

### FR-FMT-05 / FR-FMT-06 Mindmap and query blocks

- **AC-1** A mindmap block is stored as a callout `> [!mindmap]` (optional title) whose body is one list; a ` ```mermaid ` fence, `mindmap` or not, is a preserved raw fence (D-679, D-680; amended 2026-10-22, the test `fr_fmt_05_ac1_…` changes in slice MM with an `AC-Test-Change` trailer).
- **AC-2** A query block is stored as a ` ```query ` block containing YAML; the YAML parses without the app.
- **AC-3** [manual] Both blocks appear in Obsidian, the mindmap as a callout titled `Mindmap` (or its title) holding the list and the query as a plain code block, with no content lost (D-686).

### FR-FMT-09 Daily note file names

- **AC-1** With the default setting, the Daily Note for 9 Oct 2026 is `Daily/2026-10-09.md`.
- **AC-2** [MS2] With the date format set to `DD.MM.YYYY`, the same note is `Daily/09.10.2026.md`, and existing daily notes are still recognized by their `date` attribute.

### FR-FMT-10 Tags

- **AC-1** Applying tag `reading` to an object adds `reading` to its `tags:` list (no `#` in frontmatter).
- **AC-2** [MS4] An inline `#reading` in the body and `tags: [reading]` count as the same tag; the object is listed once on the tag page.
- **AC-3** Tag matching is case-insensitive and NFC-normalized (`#Čtení` = `#čtení`); the stored spelling is preserved.
- **AC-4** `#` followed by a digit only (`#1`), a heading `# Title`, and `#` inside URLs or code are **not** tags.

### FR-FMT-11 Date-only values and date-times

- **AC-1** A Date attribute set to 9 Oct 2026 is written as `2026-10-09` (unquoted, no time, no offset).
- **AC-2** Given the file contains `due: 2026-10-09`, when the app runs with the system time zone set to America/Los_Angeles, Europe/Prague and Asia/Tokyo, then the UI shows 9 Oct 2026 in all three.
- **AC-3** A Date-time attribute is written as ISO 8601 with offset, e.g. `2026-10-09T14:30:00+02:00`.
- **AC-4** [MS3] A Date range attribute `dates` is written as `dates-start: 2026-07-01` and `dates-end: 2026-07-14` (FR-TYP-02) and shown as one field.

### FR-FMT-12 Unicode normalization

- **AC-1** Given a file name in NFD (`Čtení.md` decomposed, as from some zip tools), then `[[Čtení]]` written in NFC resolves to it.
- **AC-2** All file names and link targets **written** by Tegg are NFC.
- **AC-3** [MS2] Given two files whose names differ only in normalization (NFC vs NFD), the app reports a name conflict instead of treating them as different objects or silently overwriting one.
- **AC-4** [MS2] Search and the quick switcher match `cteni` to `Čtení` (diacritic-insensitive, FR-SRC-04).

### FR-STO-02 One file per object

- **AC-1** Every object is exactly one `.md` file, UTF-8 without BOM, LF line endings.
- **AC-2** Given an existing file with CRLF line endings or a BOM, editing it in Tegg **keeps** its existing line endings and BOM (round-trip safety wins over normalization for existing files).

### FR-TYP-10 Untyped files

- **AC-1** [MS3] A file without a `type` key is shown as type Page.
- **AC-2** Opening, indexing and viewing it never writes the file (AC-2 of FR-FMT-07).

### FR-TYP-15 Reserved attribute keys

- **AC-1** [MS3] Creating a user attribute with key `source`, `id`, `file`, etc. is rejected with a message naming the reserved key.
- **AC-2** [MS7] On import, a colliding source attribute is renamed with the suffix `-text` (e.g. `source` → `source-text`), and the rename is listed in the import report.

### NFR-POR-01 Opens in Obsidian

- **AC-1** [manual] [MS3] A vault created by Tegg with the starter types and one object using every MVP feature opens in Obsidian with: content, links, embeds, images, attributes and mindmaps intact, and no Obsidian warnings about invalid properties.
- **AC-2** Automated proxy: every file written by Tegg in the test suite parses with a standard YAML parser and a CommonMark parser without errors.

### NFR-POR-02 Portable file names

- **AC-1** No file name written by Tegg contains `: \ / * ? " < > |`, control characters, or ends with a space or dot (AP-2).
- **AC-2** No file name exceeds 200 UTF-8 bytes before the extension (AP-1); longer titles are cut at a character boundary, never in the middle of a multi-byte character.
- **AC-3** Names reserved on Windows (`CON`, `PRN`, `AUX`, `NUL`, `COM1`…`COM9`, `LPT1`…`LPT9`, any case) get `_` appended, e.g. `CON_.md` (D-80).

### NFR-POR-03 Nothing only in the index

- **AC-1** [MS2] Given a vault, when the index directory in Application Support is deleted and the app restarted, then every title, attribute, link, tag, type and saved query is identical to before (see also AR-01).
