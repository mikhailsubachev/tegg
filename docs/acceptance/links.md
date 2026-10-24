# Acceptance Criteria: Link Integrity, Renames & Duplicates

See [README](README.md) for conventions. Fixtures live in `tests/fixtures/vaults/links/`.

Link resolution rule used throughout: a link target is resolved **by file name** (path-less, NFC, case-insensitive like Obsidian). Titles are shown, but never used alone to resolve a link (FR-LNK-14).

---

### FR-FMT-08 / FR-LNK-03 Rename updates all links

- **AC-1** [MS4] Given note `A` is linked from 50 notes in all forms (`[[A]]`, `[[A|alias]]`, `[[A#Heading]]`, `[[A#^id]]`, `![[A]]`, relation `"[[A]]"`, lists of relations), when `A` is renamed to `B`, then all 50 notes link to `B` with alias, heading and block parts preserved, and the file is `B.md`.
- **AC-2** [MS4] Only notes that contain a link to `A` are written (FR-SYN-06); each is written atomically.
- **AC-3** Links in code blocks and code spans are **not** changed.
- **AC-4** [MS4] A title with forbidden characters (`Q3: plan/budget`) produces file `Q3 plan budget.md` (AP-2) with `title: "Q3: plan/budget"`; the UI shows the full title everywhere; links are `[[Q3 plan budget|Q3: plan/budget]]`.
- **AC-5** [MS4] Rename is undoable as one action (restores the file name and all link changes).
- **AC-6** [MS4] Given another program edits a linking note during a rename, that note is not overwritten; it is listed as "link not updated" with a one-click retry (NFR-REL-02).

### FR-STO-04 / FR-TYP-07 Type change moves the file

AC-1 and AC-2 are v1.0 with slice 4E (D-372, D-750): checked at the release gate, not at MS4.

- **AC-1** Changing a note's type from Quick Note to Book moves it from `Quick Notes/` to `Books/`; its `id`, links and backlinks are unchanged (resolution is by file name, which doesn't change).
- **AC-2** If `Books/` already has a file with that name, the moved file gets a duplicate suffix (FR-LNK-14) and all links to it are updated.
- **AC-3** [MS3] Attributes that exist in the new type are kept; others stay in the file and appear under "Other properties". *(changed by D-228: was [MS4]; verified by types.md FR-TYP-07 AC-5)*

### FR-LNK-14 Duplicate titles

- **AC-1** Creating a second object titled `Senior Product Manager` creates `Senior Product Manager (2).md` with `title: Senior Product Manager`; a third gets `(3)`.
- ~~**AC-2** Links to the second are written as `[[Senior Product Manager (2)|Senior Product Manager]]`.~~ Verified by editor.md FR-EDT-06 AC-3(d) and AC-9, and types.md FR-EDT-07 AC-6 (D-756).
- ~~**AC-3** Link autocomplete and the quick switcher show both entries with distinguishing details: type, created date and up to 2 preview attributes.~~ Verified by backlinks.md FR-LNK-14 AC-6 (D-756).
- ~~**AC-4** The "Duplicate titles" check lists every group of objects sharing a title and offers merge.~~ Verified by backlinks.md FR-LNK-14 AC-8 and tags.md FR-LNK-14 AC-11…AC-14 (D-756).
- **AC-5** A duplicate-suffix file is not treated as a sync conflict (data-safety FR-SYN-04 AC-2).

### FR-LNK-04 Broken links

- ~~**AC-1** A link whose target doesn't exist is rendered with the broken-link style and counted in a "Broken links" list.~~ Verified by backlinks.md FR-LNK-07 AC-2, FR-LNK-04 AC-9 and AC-10 (D-756).
- ~~**AC-2** Clicking it offers "Create" with the vault's default type preselected; after creation the link is no longer broken and the source file is **not** rewritten.~~ Verified by backlinks.md FR-LNK-04 AC-4 and AC-5; since D-287 (backlinks.md AC-7) Create rewrites the clicked link when the target isn't a valid file name (D-756).
- ~~**AC-3** A date link (`[[2026-10-09]]`) is never shown as broken (FR-DLY-08 AC-2).~~ Verified by daily-notes.md FR-DLY-08 AC-5 and backlinks.md FR-LNK-04 AC-9 (D-756).

### FR-DLY-08 Date mentions

- **AC-1** Typing `@today` and confirming inserts `[[2026-10-08]]` (today's date as `YYYY-MM-DD`, whatever the `daily-format`; D-333).
- **AC-2** A link to a date whose Daily Note doesn't exist opens the virtual Daily Note for that date; no file is created until the user types in it (FR-DLY-02).
- **AC-3** The Daily Note for that date shows the mentioning note in its backlinks, even while it's virtual.

### FR-TYP-04 / FR-TAG-04 Bulk rewrites

The attribute-key rename (AC-1, AC-3's attribute part) is v1.0 with slice 4E (D-372, D-750); the tag rename (AC-2, AC-3's tag part) is built in 4D-lite.

- ~~**AC-1** Renaming attribute key `author` → `authors` on type Book rewrites only that key in every Book file.~~ Moved to v1.0 with slice 4E (D-372, D-750); it returns with 4E's ACs.
- ~~**AC-2** Renaming tag `reading` → `čtení` changes `tags:` entries and inline `#reading` in every object that has it, and renames `Tags/reading.md`; `#reading-list` (a different tag) is unchanged. *(marker added by D-228)*~~ Verified by tags.md FR-TAG-04 AC-4 and AC-9 (D-756).
- ~~**AC-3** Both operations show a confirmation with the number of affected files, show progress, create a backup first (NFR-REL-04 AC-1) and can be cancelled before writing starts. *(marker added by D-228)*~~ Split (D-756): the tag rename is verified by tags.md FR-TAG-04 AC-7 and AC-8; the attribute-key rename is v1.0 with slice 4E (D-372, D-750) and returns with 4E's ACs.

### FR-ATT-07 Image and PDF objects

- **AC-1** Pasting an image into a note creates `_attachments/<name>.png`, an Image object `Images/<title>.md` with `file: "[[<name>.png]]"`, type, size and width/height, and inserts `![[<name>.png]]` in the note.
- **AC-2** The note's embed resolves to the Image object: its preview shows the object's title and description, and the object's backlinks list the note.
- **AC-3** [manual] The note opens in Obsidian with the image rendered.
- **AC-4** Deleting the Image object asks whether to keep or trash the file; notes embedding it show the "moved to trash" placeholder (D-27).
