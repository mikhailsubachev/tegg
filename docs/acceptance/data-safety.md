# Acceptance Criteria: Data Safety, Storage & Sync

See [README](README.md) for conventions. Fixtures live in `tests/fixtures/vaults/`.

---

### FR-SYN-02 / NFR-REL-01 Atomic writes, zero data loss

- **AC-1** Every write to a vault file goes to a temporary file **in the same folder**, is flushed (`fsync`), and then renamed over the target. No code path opens a vault file for in-place writing (enforced by a code check: one write function for the whole app).
- **AC-2** The temporary file name starts with `.` and ends with `.tegg-tmp`, so sync clients and Obsidian ignore it; the file watcher ignores it too.
- **AC-3** Given a write is interrupted (process killed with `SIGKILL` at random points during 1,000 save cycles in a test harness), then after every interruption the target file is either the complete old version or the complete new version, never empty, truncated or mixed.
- **AC-4** Given leftover `.tegg-tmp` files from a crash, on next vault open they are deleted if older than 1 minute, and never treated as notes.
- **AC-5** [manual] Force-quitting the app while typing loses at most the last 1 s of typing (FR-EDT-08) and never corrupts the file.

### FR-EDT-08 Autosave

- **AC-1** After the last keystroke, the file is written within **1 s**.
- **AC-2** Continuous typing for 10 s causes at most 10 writes (debounced), not one per keystroke.
- **AC-3** Closing a note, switching notes, closing a tab and quitting the app flush pending changes before closing.

### FR-SYN-06 Minimal writes

- **AC-1** Opening the vault, indexing, opening notes, searching and running queries cause **zero** writes to vault files (verified by file modification times and a write counter in tests).
- **AC-2** Saving a note writes exactly one file, unless the change requires others (e.g. rename → link updates).
- **AC-3** A bulk operation (rename, tag rename) writes only files whose content actually changes.
- **AC-4** `modified` is not updated when nothing changed (AP-5).

### FR-SYN-03 / NFR-REL-02 External changes

- **AC-1** Given a note is changed by another program while the app is open, the index reflects the change within **2 s** (NFR-PERF-08).
- **AC-2** Given the changed note is open with **no unsaved edits**, it reloads silently and keeps the cursor position as close as possible.
- **AC-3** Given the changed note is open **with unsaved edits**, the app does **not** write its version; it shows a merge dialog with both versions (mine / theirs / compare). Nothing is written until the user decides.
- **AC-4** Given a note is deleted externally while open with unsaved edits, the app keeps the content in the editor and offers "Restore file" or "Discard".
- **AC-5** Given a file is renamed or moved externally, the index updates within 2 s and the object keeps its identity (by `id`) and backlinks.
- **AC-6** Given 500 files change at once (e.g. a sync client catching up), the app stays responsive (typing latency within NFR-PERF-06) and processes all changes within 30 s.
- **AC-7** Before saving, the app checks that the file on disk is still the version it loaded (modification time + size + content hash); if not, AC-3 applies.

### FR-SYN-04 / FR-SYN-05 Conflict copies and duplicate ids

- **AC-1** Given two files with the **same `id`** (e.g. `Note.md` and `Note (conflicted copy 2026-10-07).md`), the app lists them in the **Conflicts** view and treats only one as the object for links (the one whose name matches the title; else the older `created`; else the shorter path). (AP-3)
- **AC-2** File names matching known patterns, Dropbox `(conflicted copy …)`, `(… conflicted copy …)`, Google Drive `Name (1).md`, iCloud `Name 2.md`, are flagged as **possible** conflicts only when they also share an `id` or have nearly identical content (AP-3). A Tegg duplicate-title file `Title (2).md` with its own `id` is **not** a conflict.
- **AC-3** The Conflicts view offers: side-by-side compare, keep left, keep right, and merge (manual). Resolving keeps the surviving file's `id`, moves the other to `.trash/`, and never breaks a link.
- **AC-4** Given a duplicate `id` without a conflict-copy name (e.g. a file copied in Finder), the app gives the **newer** file a new `id` after the user confirms, and links by title keep working.

### FR-SYN-01 / FR-SYN-07 Any synced folder, offline

- **AC-1** The app makes no network calls and has no code that detects or depends on a specific sync provider (except FR-VLT-03 placeholder detection).
- **AC-2** All features work with networking disabled.
- **AC-3** [manual] A vault in Dropbox, Google Drive and iCloud Drive each: create, edit, rename, and delete a note on Mac A; the change appears on Mac B, and Tegg on Mac B shows it within 2 s of the file arriving.

### FR-VLT-03 Online-only files

- **AC-1** Given a vault containing a file that is a cloud placeholder (iCloud `.icloud` stub, a dataless file flagged by APFS, Dropbox/Google Drive File Provider placeholder), when the vault is opened, the app shows a warning naming the number of files and how to make the folder available offline.
- **AC-2** Indexing does **not** trigger downloads of placeholder files (it reads only files that are present locally) and lists skipped files.

### FR-STO-01 / -03 / -05 / -06 / -08 / -09 Vault layout

- **AC-1** All vault content stays inside the chosen folder; the app never writes outside it except to Application Support.
- **AC-2** A new object of type Book goes to `Books/` (the type's configured folder); changing the type's folder applies to new objects and offers to move existing ones.
- **AC-3** Attachments go to `_attachments/`; a second `photo.png` becomes `photo (2).png`.
- **AC-4** `.tegg/vault.yml`, `.tegg/types/*.yml`, `.tegg/queries/*.yml` and `_templates/<Type>/*.md` are human-readable YAML/Markdown and contain everything needed to rebuild types, queries and templates on another Mac.
- **AC-5** Deleting an object moves it to `.trash/` keeping its relative path; restore puts it back at the original path (or with a suffix if taken).
- **AC-6** Files that aren't Markdown or recognized attachments (e.g. `.docx`, `.obsidian/`, `.git/`) are never modified, moved or deleted.

### FR-STO-07 / AR-01 Machine-local data, rebuildable index

- **AC-1** The index, caches, window state, recent list and backups live under `~/Library/Application Support/Tegg/`; nothing machine-local is written into the vault.
- **AC-2** Deleting the index and restarting produces the same state: objects, titles, attributes, links, backlinks, tags, search results and query results are identical (compare snapshots before/after on the reference vault).
- **AC-3** A full rebuild runs in the background; the UI stays usable (NFR-PERF-02).

### NFR-REL-03 Invalid frontmatter

- **AC-1** Given files with invalid YAML (unclosed quote, bad indentation, duplicate keys, tab characters, a `---` that never closes), the app does not crash; each opens in source mode with a warning naming the problem and line.
- **AC-2** Such files are indexed by file name and body text; they are never rewritten automatically.

### NFR-REL-04 / FR-HIS-04 Backup before bulk operations (MVP)

- **AC-1** Before an import, attribute rename, tag rename or bulk type change, the app writes a **vault backup zip** to Application Support (AP-7) and doesn't start the operation if the backup fails.
- **AC-2** The backup contains every `.md` file and `.tegg/` of the vault (attachments only when the operation touches them) and can be restored from Settings in one action.
- **AC-3** The newest 10 backups are kept; older ones are deleted automatically.
