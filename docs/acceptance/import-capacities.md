# Acceptance Criteria: Capacities Importer (MVP, D-41)

See [README](README.md) for conventions. Synthetic fixtures live in `tests/fixtures/import/capacities/`, each named after the BRD §15 finding it reproduces (e.g. `c03-utc-midnight-dates/`). `[real-export]` criteria also run locally against `test exports/` and print only counts and IDs.

**Overall acceptance (§11.1):** every object, attachment and link in the selected space is either imported or listed in the import report. Nothing disappears silently.

---

### FR-IMP-07 Input

- **AC-1** Import accepts a `.zip` file or an extracted folder and produces the same result for both.
- **AC-2** A zip with non-ASCII names (Czech diacritics, emoji, `?`, names near 255 bytes) is read with correct UTF-8 names, without using the system `unzip`; all names are converted to NFC (FR-FMT-12).
- **AC-3** A 100 MB+ zip shows progress (files processed / total) and can be cancelled; cancelling before the write phase leaves the vault untouched.
- **AC-4** `[real-export]` The real Capacities zip is read with 0 unreadable entries.

### FR-IMP-22 Space selection

- **AC-1** Given an export with spaces `IDC`, `PKM`, `Work`, the preview lists them with object counts, and the user selects **one**.
- **AC-2** Only files from the selected space are imported; links to objects in other spaces are reported as unresolved (with the target space name).
- **AC-3** Importing a second space into the same vault offers mapping its types onto existing vault types (e.g. Work `Tasks` → existing Task type).

### FR-IMP-05 / FR-IMP-19 Preview and report

- **AC-1** Before writing anything, the preview shows: counts per source type and target type, the attribute mapping, unresolved links count, dropped files count, renamed attributes, values needing a decision (dates without year), and the **losses** (query definitions, tag colors).
- **AC-2** "Cancel" in the preview leaves the vault byte-identical.
- **AC-3** After import, a report is saved as a Page `Import report <date> <space>.md` containing every item from AC-1 with links to the affected objects.
- **AC-4** `[real-export]` imported + reported = total, for objects, attachments and links (counts printed per type).

### FR-IMP-08 Type, attribute and value mapping

- **AC-1** Default mapping: `Page` → Page, `Task` → Task, `DailyNote` → Daily Note, `Image` → Image, `PDF` → PDF, `Query` → Page (stub, FR-IMP-16), `Weblink` → Page (FR-IMP-24), every other type → a new user type with the same name.
- **AC-2** Each source attribute maps to an existing attribute, a new attribute (type inferred: date, number, checkbox, select, relation, text) or "drop" (reported).
- **AC-3** Select values are merged case-insensitively with a choice of the canonical spelling (`High`/`high` → `High`), shown in the preview.
- **AC-4** Task status values (`Not Started`, `In Progress`, `Done`, empty) map to Task statuses with semantic states (open, in progress, done, open).
- **AC-5** Comma-separated people in a text attribute can be split into a list (option in the mapping).

### FR-IMP-09 Dates

- **AC-1** `'2026-03-19T00:00:00.000Z'` in a date attribute → `2026-03-19` (date-only), in all three test time zones (FR-FMT-11 AC-2).
- **AC-2** A non-midnight UTC date-time `'2026-04-07T19:46:20.601Z'` → `2026-04-07T21:46:20+02:00` in Europe/Prague (AP-6).
- **AC-3** `start -> end` text → Date range `<key>-start` / `<key>-end`.
- **AC-4** `null` → attribute omitted (not written as `null`).

### FR-IMP-10 Links

- **AC-1** `[[Title]]` and `[[Title|alias]]` → wikilink to the imported file (by source file, so it survives renames and duplicate suffixes).
- **AC-2** Relative Markdown links `[text](../Tasks/Plan%20the%20release.md)` → `[[Plan the release|text]]`; `%20` and other escapes decoded.
- **AC-3** `[[Date/2026-02-01]]` → `[[2026-02-01]]` (Daily Note link, FR-DLY-08).
- **AC-4** `[[NOTE/<uuid>]]` and other unresolvable targets → kept as text `[[NOTE/<uuid>]]`, marked unresolved, listed in the report with the source note.
- **AC-5** Relation attributes `'[[Jana]]'` → `"[[Jana]]"` pointing at the imported Person.

### FR-IMP-11 Titles

- **AC-1** The title comes from `title:`, not the file name: `11 2026-03-19 Jana.md` with `title: 1:1 2026-03-19 Jana` → `title: "1:1 2026-03-19 Jana"`, file `1 1 2026-03-19 Jana.md` (AP-2).
- **AC-2** Trailing spaces in titles (`'Tomáš '`) are trimmed.
- **AC-3** 17 Weblinks titled `Article` → 17 objects titled `Article`, files `Article.md`, `Article (2).md` … `Article (17).md` (FR-LNK-14), each link pointing at the right one.

### FR-IMP-14 Media

- **AC-1** `Images/<x>.md` + `Images/Media/<x>.jpeg` → Image object in `Images/` with title, description, tags, `source`, `file: "[[<x>.jpeg]]"`, and the file in `_attachments/`.
- **AC-2** `Media: ![Image](./Media/Mapa%20%C5%99eky.jpeg)` in a body → `![[Mapa řeky.jpeg]]`.
- **AC-3** Generic names (`image (3).png`, `Untitled (44).png`) are renamed to `<owning note title> <n>.png`.
- **AC-4** A reference to a missing file is dropped from the body and listed in the report.
- **AC-5** `[real-export]` Every media file in the selected space is either an Image/PDF object or listed as dropped.

### FR-IMP-15 Metadata

- **AC-1** `createdAt` → `created`, `lastUpdated` → `modified` (original values, not import time).
- **AC-2** `reviewed: true` → `review: reviewed`; `reviewed: false` → `review: unreviewed`.
- **AC-3** Task `completed` → completed date; `deadline` → `due`, falling back to `date` when `deadline` is empty (FR-TSK-13).
- **AC-4** `icon` → `icon`, `coverImage` → `cover` (as an Image object link), `aliases` and `description` kept.
- **AC-5** Every imported object gets a new `id` and `import-id: capacities:<space>/<source path>` (FR-IMP-20).

### FR-IMP-16 Query stubs

- **AC-1** Each Capacities Query object → a Page with its title and description, tag `needs-rebuilding`, and a body note saying the definition wasn't exported.
- **AC-2** The report lists all stubs.

### FR-IMP-17 Clean-up

- **AC-1** U+200B (zero-width space), U+FEFF (BOM) and U+200C/U+200D outside emoji sequences are removed from titles, attributes and bodies; the count is reported.
- **AC-2** All text and names are NFC; line endings are LF.
- **AC-3** Capacities template scaffolding is kept as-is (no content deletion beyond AC-1).

### FR-IMP-20 Repeat import warning

- **AC-1** Given the vault already has objects with matching `import-id`s, the preview warns "N objects were already imported; importing again creates duplicates" and recommends a new vault.

### FR-IMP-21 Tags

- **AC-1** `tags: [Learning, Archive]` → tags `Learning` and `Archive`, created as virtual tags (no Tag files, FR-TAG-03).
- **AC-2** Header-only tag-collection CSVs are reported as "tag colors and collections not exported".
- **AC-3** An attribute whose values are links to tag-like objects (`[[in progress]]`) can be mapped to a select attribute in the preview.

### FR-IMP-24 Weblinks

- **AC-1** A Weblink → object of the mapped type (default Page) with `url` and `description`; `domain`, `iframeUrl`, `category`, `topic` are mapped or dropped per the mapping.
- **AC-2** A stored preview image becomes an Image object set as `cover`; a missing one is reported.

### FR-TYP-15 Reserved keys on import

- **AC-1** Capacities `source: kniha` (plain text) → `source-text: kniha`; listed in the report.

### FR-HIS-04 Backup before import (MVP)

- **AC-1** Importing into a non-empty vault creates a backup zip first (NFR-REL-04 AC-1); importing into a new vault is the recommended default in the import wizard.
