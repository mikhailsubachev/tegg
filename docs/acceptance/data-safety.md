# Acceptance Criteria: Data Safety, Storage & Sync

See [README](README.md) for conventions. Fixtures live in `tests/fixtures/vaults/`.

---

### FR-SYN-02 / NFR-REL-01 Atomic writes, zero data loss

- **AC-1** Every write to a vault file goes to a temporary file **in the same folder**, is flushed (`fsync`), and then renamed over the target. No code path opens a vault file for in-place writing (enforced by a code check: one write function for the whole app).
- **AC-2** [MS2] The temporary file name starts with `.` and ends with `.tegg-tmp`, so sync clients and Obsidian ignore it; the file watcher ignores it too.
- **AC-3** Given a write is interrupted (process killed with `SIGKILL` at random points during 1,000 save cycles in a test harness), then after every interruption the target file is either the complete old version or the complete new version, never empty, truncated or mixed.
- **AC-4** Given leftover `.tegg-tmp` files from a crash, on next vault open they are deleted if older than 1 minute, and never treated as notes.
- **AC-5** [manual] [MS3] Force-quitting the app while typing loses at most the last 1 s of typing (FR-EDT-08) and never corrupts the file.

### FR-EDT-08 Autosave

- **AC-1** After the last keystroke, the file is written within **1 s**.
- **AC-2** Continuous typing for 10 s causes at most 10 writes (debounced), not one per keystroke.
- **AC-3** Closing a note, switching notes, closing a tab and quitting the app flush pending changes before closing.

### FR-SYN-06 Minimal writes

- **AC-1** [MS2] Opening the vault, indexing, opening notes, searching and running queries cause **zero** writes to vault files (verified by file modification times and a write counter in tests).
- **AC-2** Saving a note writes exactly one file, unless the change requires others (e.g. rename → link updates).
- **AC-3** [MS4] A bulk operation (rename, tag rename) writes only files whose content actually changes.
- **AC-4** `modified` is not updated when nothing changed (AP-5).

### FR-SYN-03 / NFR-REL-02 External changes

- **AC-1** Given a note is changed by another program while the app is open, the index reflects the change within **2 s** (NFR-PERF-08).
- **AC-2** [MS3] Given the changed note is open with **no unsaved edits**, it reloads silently; the cursor stays in the same block if that block still exists, else moves to the nearest preceding block (D-111).
- **AC-3** [MS3] Given the changed note is open **with unsaved edits**, the app does **not** write its version; it shows a merge dialog with both versions (mine / theirs / compare). Nothing is written until the user decides.
- **AC-4** [MS3] Given a note is deleted externally while open with unsaved edits, the app keeps the content in the editor and offers "Restore file" or "Discard".
- **AC-5** Given a file is renamed or moved externally, the index updates within 2 s and the object keeps its identity (by `id`); links that still resolve (a move that keeps the stem, links by `id`) keep their backlinks, and links that no longer resolve become broken and appear in the Broken links list within 2 s (backlinks.md FR-LNK-04 AC-9). Tegg rewrites no other file on its own. *(changed by D-294)*
- **AC-6** [MS3] Given 500 files change at once (e.g. a sync client catching up), the app stays responsive (typing latency within NFR-PERF-06) and processes all changes within 30 s.
- **AC-7** Before saving, the app checks that the file on disk is still the version it loaded (size + content hash; the modification time only decides whether to re-hash, D-175); if not, AC-3 applies. Identical bytes are never a conflict.
- **AC-8** Given a save request whose base version no longer matches the file on disk, the core writes nothing and emits `note:conflict` carrying both versions (mine and theirs) (D-110).
- **AC-9** Given 500 files change at once, the core processes all changes into the index within 30 s and every event is reflected (D-110).

### FR-SYN-04 / FR-SYN-05 Conflict copies and duplicate ids

- **AC-1** Given two files with the **same `id`** (e.g. `Note.md` and `Note (conflicted copy 2026-10-07).md`), the app lists them in the **Conflicts** view and treats only one as the object for links (the one whose name matches the title; else the older `created`; else the shorter path). (AP-3)
- **AC-2** File names matching known patterns, Dropbox `(conflicted copy …)`, `(… conflicted copy …)`, Google Drive `Name (1).md`, iCloud `Name 2.md`, are flagged as **possible** conflicts only when they also share an `id` or have nearly identical content: at least 90% equal lines after normalizing line endings (AP-3, D-111). A Tegg duplicate-title file `Title (2).md` with its own `id` is **not** a conflict.
- **AC-3** [MS3] The Conflicts view offers: side-by-side compare, keep left, keep right, and merge (manual). Resolving keeps the surviving file's `id`, moves the other to `.trash/`, and never breaks a link.
- **AC-4** Given a duplicate `id` without a conflict-copy name (e.g. a file copied in Finder), the app gives the **newer** file a new `id` after the user confirms, links to the older file keep resolving to it, and links by file name to the newer file resolve to the newer file (FR-LNK-14, D-111).

### FR-SYN-01 / FR-SYN-07 Any synced folder, offline

- **AC-1** The app makes no network calls and has no code that detects or depends on a specific sync provider (except FR-VLT-03 placeholder detection).
- **AC-2** All features work with networking disabled.
- **AC-3** [manual] [MS8] A vault in Dropbox, Google Drive and iCloud Drive each: create, edit, rename, and delete a note on Mac A; the change appears on Mac B, and Tegg on Mac B shows it within 2 s of the file arriving.

### FR-VLT-01 Create or open a vault

- **AC-1** [MS3] Given no vault is configured (first launch), the app shows a chooser with **Create new vault** and **Open existing folder**, and writes nothing (in any folder or in Application Support) until the user picks one.
- **AC-2** **Create:** given a parent folder and a vault name, the app creates `<parent>/<name>/` with `.tegg/vault.yml` and the type definitions of FR-VLT-02 (D-90), and nothing else; then the vault is open. A name is sanitized like a file name (D-52, D-80).
- **AC-3** Creating a vault where the target folder already exists and is not empty is refused with a message (the user can open it instead); no file in it is touched.
- **AC-4** **Open a Tegg vault** (a folder with `.tegg/vault.yml`): the vault opens with **zero writes** to its files (FR-SYN-06 AC-1).
- **AC-5** [MS3] **Open a folder that is not a Tegg vault** (no `.tegg/`, e.g. an Obsidian vault or plain Markdown): the app offers to **import** it and starts the matching importer (an Obsidian vault, recognized by `.obsidian/`, → the Obsidian importer, FR-IMP-01) (D-91). A plain Markdown folder without `.obsidian/` goes to the same importer (D-93). Nothing is written to the folder before the user confirms in the importer; cancel writes nothing. Until the importer exists (MS7), the app says "Import isn't available yet" and writes nothing.
- **AC-6** A folder inside a sync provider's folder (Dropbox, Google Drive `~/Library/CloudStorage/…`, iCloud Drive `~/Library/Mobile Documents/…`) is created and opened exactly like any other folder; the app has no provider-specific code path (FR-SYN-01 AC-1). Real providers are checked manually at MS8 (FR-SYN-01 AC-3).
- **AC-7** [MS3] The open vault's path is remembered in Application Support (FR-STO-07) and reopened at the next launch. If the folder is missing or moved, the app shows the chooser with a message naming the old path and never recreates the vault there.
- **AC-8** [MS3] One vault is open at a time (D-35): opening another vault flushes pending saves of the current one (FR-EDT-08 AC-3) and closes it.

### FR-VLT-02 Empty or starter vault

- **AC-1** **Empty vault:** `.tegg/types/` contains exactly one definition per system type: Page, Task, Quick Note, Daily Note, Tag, Image, PDF (D-89), one `.tegg/types/<type>.yml` each (D-90). No user types, no templates, no notes, no type folders (folders are created with their first object, FR-SYN-06).
- **AC-2** [MS3] **Starter vault** (built in MS3, D-92): additionally the user types Book, Reading Note, Idea, Meeting, Person, Project and Trip (D-23), each with a definition in `.tegg/types/` and one default template in `_templates/<Type>/`. They behave like any user type: editable and deletable (FR-TYP-01).
- **AC-3** Both kinds are deterministic: apart from generated ids and timestamps, the created files equal the committed fixtures `tests/fixtures/vaults/new-empty/` and `tests/fixtures/vaults/new-starter/` byte for byte (names NFC, LF line endings, valid YAML that `tegg-schema` reads back without warnings).
- **AC-4** [MS3] **Add starter types later** (MS3, D-92) (Settings): adds only the starter types the vault doesn't have; a type with the same name or folder is never overwritten (it is skipped and listed). Adding writes only the new definition and template files.
- **AC-5** [MS3] A new vault of either kind opens in Obsidian with no warnings or stray notes: `.tegg/` is hidden there, and template files are ordinary Markdown (NFR-POR-01).

### FR-VLT-03 Online-only files

- **AC-1** [MS3] Given a vault containing a file that is a cloud placeholder (iCloud `.icloud` stub, a dataless file flagged by APFS, Dropbox/Google Drive File Provider placeholder), when the vault is opened, the app shows a warning naming the number of files and how to make the folder available offline.
- **AC-2** Indexing does **not** trigger downloads of placeholder files (it reads only files that are present locally) and lists skipped files.
- **AC-3** Placeholders are detected as iCloud `.<name>.icloud` stubs and files with the `SF_DATALESS` stat flag; the core reports their count when a vault is opened. Tested with synthetic stubs and a flag injected through the vault file-system abstraction (AR-04); real providers are checked manually at MS8 (D-112).

### FR-STO-01 / -03 / -05 / -06 / -08 / -09 Vault layout

- **AC-1** All vault content stays inside the chosen folder; the app never writes outside it except to Application Support.
- **AC-2** [MS3] A new object of type Book goes to `Books/` (the type's configured folder); changing the type's folder applies to new objects and moves no existing file. *(changed by D-226: the "offers to move" part is AC-7)*
- **AC-3** Attachments go to `_attachments/`; a second `photo.png` becomes `photo (2).png`.
- **AC-4** `.tegg/vault.yml`, `.tegg/types/*.yml`, `.tegg/queries/*.yml` and `_templates/<Type>/*.md` are human-readable YAML/Markdown and contain everything needed to rebuild types, queries and templates on another Mac.
- **AC-5** Deleting an object moves it to `.trash/` keeping its relative path; restore puts it back at the original path (or with a suffix if taken).
- **AC-6** Files that aren't Markdown or recognized attachments (e.g. `.docx`, `.obsidian/`, `.git/`) are never modified, moved or deleted.
- **AC-7** *(v1.0 with slice 4E, D-226, D-372, D-750)* After a type's folder changes, the app offers to move the existing objects of that type to the new folder, with a restore point first (FR-HIS-04, D-57); links keep resolving. *(split from AC-2 by D-226)*

### FR-STO-07 / AR-01 Machine-local data, rebuildable index

- **AC-1** The index, caches, window state, recent list and backups live under `~/Library/Application Support/Tegg/`; nothing machine-local is written into the vault.
- **AC-2** [MS2] Deleting the index and restarting produces the same state: objects, titles, attributes, links, backlinks, tags, search results and query results are identical (compare snapshots before/after on the reference vault).
- **AC-3** [MS2] A full rebuild runs in the background; the UI stays usable (NFR-PERF-02).

### NFR-REL-03 Invalid frontmatter

- **AC-1** [MS3] Given files with invalid YAML (unclosed quote, bad indentation, duplicate keys, tab characters, a `---` that never closes), the app does not crash; each opens in source mode with a warning naming the problem and line.
- **AC-2** Such files are indexed by file name and body text; they are never rewritten automatically.

### NFR-REL-04 / FR-HIS-04 Backup before bulk operations (MVP)

- **AC-1** Before an import, attribute rename, tag rename or bulk type change, the app writes a **vault backup zip** to Application Support (AP-7) and doesn't start the operation if the backup fails.
- **AC-2** The backup contains every `.md` file and `.tegg/` of the vault (attachments only when the operation touches them) and can be restored from Settings in one action.
- **AC-3** The newest 10 backups are kept; older ones are deleted automatically.
