# MS6 Trash and Media Interface Contract (slice 6A)

- **Status:** draft, 2026-10-22. Written before the 6A red tests (as D-430, D-552). Follows D-609…D-623 (BRD v1.78).
- **ACs:** [docs/acceptance/trash-media.md](../acceptance/trash-media.md) (FR-HIS-01 AC-1…AC-15, FR-ATT-01/-07/-08 AC-1…AC-16, FR-NAV-04 AC-6, AC-7, FR-FMT-07 AC-22, FR-SYN-06 AC-29, AC-30) and the `[MS6]` criteria it takes over: conversion.md FR-CNV-08 AC-6, capture.md FR-CAP-01 AC-12, inbox.md FR-INB-02 AC-10, tasks.md R43's `Move to trash`.
- **Builds on** [ms3-shell.md](ms3-shell.md) (§1 launching and test hooks, §5 fake core, §11.1 link resolution, §13.2 `note_read` / `note_write`), [ms4-links.md](ms4-links.md) (§1 resolution, D-184 link text, D-291), [ms4-embeds.md](ms4-embeds.md) (embed blocks, `embed_load`, D-428), [ms4-jobs.md](ms4-jobs.md) (the undo toast), [ms5-capture.md](ms5-capture.md) (§2 capture ACL, §3.3 `capture_create`, §11 fake core), [ms5-tasks.md](ms5-tasks.md) §11.6 (`note_trash`, `note_discard`).
- **Writes.** Move to trash and Restore are renames only (one per file; a pair is two, object first). A media add is create-exclusive writes: the file, then the object, then (in the UI) the note's normal autosave. Delete permanently and Empty trash move files out of the vault into the system trash; Tegg never unlinks a vault file except Tegg's own just-written media file after a failed add (§3.4) and `note_discard` (D-492).

Until a part is implemented, it exists as a stub that compiles and returns a deliberately wrong result (an empty list, `None`, the input unchanged, or an `Io` error). A test then fails on its assertion, never on a build or import error (TS-I1).

---

## 1. Trash in the core (`tegg-core`, new module `trash6a.rs`; `tegg-vault`)

### 1.1 Vault additions (`tegg-vault`)

- `FileVersion` is unchanged. `Fs::changed_ns(path) -> io::Result<Option<i128>>`: the entry's status-change time (`st_ctime` on Unix, the last write time elsewhere). A rename into `.trash/` sets it on macOS (APFS); it is the trash time of R71 (D-614). The in-memory test file system (`MemFs`) keeps a counter set on every rename, so L4 order tests are deterministic.
- `Vault::trash`, `trash_checked`, `trash_dir`, `restore` exist (FR-STO-08, D-195, D-225). New: `Vault::restore_dir(trashed_dir) -> Result<String>` (one rename, ` (2)` suffix if taken) and `Vault::remove_to(path, sink: &dyn SystemTrash) -> Result<()>` for §1.4.
- `trait SystemTrash { fn trash(&self, abs: &Path) -> io::Result<()>; }` lives in `tegg-vault` (AR-03: the core stays platform-neutral). The shell implements it with `NSFileManager trashItemAtURL:resultingItemURL:error:` (`objc2-foundation`); with `TEGG_TEST=1` and `TEGG_TEST_SYSTEM_TRASH=<dir>` it moves the file into `<dir>` instead (renamed with a counter on collision), so tests never touch the user's Trash. L4 uses a recording implementation.

### 1.2 Listing (`Core::trash_list() -> Vec<TrashEntry>`)

```rust
pub struct TrashEntry {
    pub path: String,          // the row's main entry under `.trash/` (object file, bare file or folder), NFC
    pub kind: TrashKind,       // Object | File | Folder
    pub original: String,      // `path` without the `.trash/` prefix
    pub folder: String,        // the original's parent folder (`Pages`, `_attachments`, `` for the root), or the folder itself for Folder
    pub title: String,         // object title (title, else stem); file name for File; folder name for Folder
    pub type_key: Option<String>, // object type key; None for File and Folder
    pub files: Vec<String>,    // every vault path the row moves (the object and its paired file; all files of a folder)
    pub count: u32,            // Folder: number of `.md` files inside; else 1
    pub trashed_ns: i128,      // `changed_ns` of `path` (Folder: of the folder)
}
```

- **Rows.** Every `.md` directly or deeply under `.trash/` is an Object row, except files inside a trashed folder that is itself a row. A trashed **folder row** is a directory directly under `.trash/` whose name is not a system folder of a type that still exists live (`Pages`, `Tasks`, `Quick Notes`, `Daily`, `Tags`, `Images`, `PDFs`, `_attachments`, the folders of the vault's live types): `.trash/Recepty/` is a folder row, `.trash/Pages/` is not (its files are rows). A non-`.md` file is a File row unless an Object row pairs it (§1.3). `_templates` inside `.trash/` is listed like any other folder.
- **Order** (R71): `trashed_ns` descending, then `path` ascending (NFC, case-insensitive). The UI keeps the core's order.
- **No index.** The list reads the file system only (AR-01, FR-HIS-01 AC-10); objects are parsed with the same frontmatter reader as the index (`title`, `type`, `file`).

### 1.3 Pairs (D-612)

`Core::pair_of(object_path) -> Option<String>`: the vault path of the file an Image or PDF object's `file:` links to, resolved by §3.2's media resolution from the object's folder (for a trashed object: inside `.trash/` first, then live). The pair is **shared** when another live object (excluding `_templates/` and `.trash/`) has a `file:` resolving to the same file; a shared file never moves with the object (FR-HIS-01 AC-15).

### 1.4 Operations

| Core function | Does | Errors |
| --- | --- | --- |
| `trash_object(path, base: &FileVersion) -> Result<Vec<Moved>>` | The version check of `trash_checked`, then the object rename, then its unshared pair's rename. If the pair's rename fails, the object is renamed back and the error returned. `Moved { from, to }`. | `Conflict { disk }`, `Gone`, `NotFound`, `Io`, `Invalid` (a path already under `.trash/` or under `.tegg/`; templates can be trashed) |
| `trash_restore(path) -> Result<Vec<Moved>>` | `path` is a row's `path`. Object: restore the object, then its trashed pair (if the pair's original is taken, ` (2)`, and the object's `file:` is **not** rewritten: Obsidian's shortest-path still finds a suffixed name only if unique, so the suffix case is reported in `Moved` and the UI says `Restored "{title}" as "{path}"`). File: restore the file. Folder: `restore_dir`. Missing parent folders are created. | `NotFound`, `Io` |
| `trash_delete(paths: &[String], sink) -> TrashRemoval` | For each row path: every file of the row (`files`) through `remove_to`; a folder row by its folder. Each path must be under `.trash/`. | per path, collected |
| `trash_empty(sink) -> TrashRemoval` | Every top-level entry of `.trash/` through `remove_to`; `.trash/` itself stays. | collected |

`TrashRemoval { removed: Vec<String>, failed: Vec<(String, String)> }` (path, reason). `note_trash` stays (Conflicts view, conversion undo); the UI's Move to trash uses `object_trash` (§4) everywhere else.

### 1.5 Reading a trashed note

`note_read` already reads any vault path; for a path under `.trash/` the result gets `readOnly: true` with reason `trash` (NoteReadDto's existing `readOnly` field gains the reason value `trash`), and `note_write`, `note_rename`, `link_create` refuse paths under `.trash/` with `Invalid`. `link_resolve` from a trashed note resolves as from its original path (so its chips work in the read-only view) but its links are never backlinks (D-278 unchanged).

## 2. Links to trashed objects (D-611)

`LinkKind` gains `Trashed` and `Media` (§3.2). Resolution order for one target: (1) the existing rules over live objects; (2) if unresolved and the target names a media file, §3.2; (3) if still unresolved, the same rules run over the objects under `.trash/` with the `.trash/` prefix removed from their paths (the D-291 rules from the source's folder, ids included): a match gives `Trashed` with `path` = the trashed path, `title`, `type`. A media target whose file is only in `.trash/` gives `Trashed` with `path` = the trashed **object** when one pairs it, else the trashed file.

- `LinkTargetDto.kind` adds `'trashed'` and `'media'`; new optional nullable field `object: string | null` (§3.2). TS types regenerated (`dto.rs` `decl()`).
- Broken links (ms4-links §3) exclude `Trashed` targets (FR-HIS-01 AC-13). Backlinks: a `Trashed` target is not a backlink of anything.
- The index keeps a second, small table of trashed objects (path, id, stem, title, type) built from `.trash/` at open and on watcher events under `.trash/`; it is part of the disposable index (AR-01).
- `embed_load(paths)` returns state `trashed` (new) with `title` for a path under `.trash/` that exists.

## 3. Media

### 3.1 Metadata (`tegg-core`, new module `media6a.rs`)

`pub fn media_info(bytes: &[u8]) -> Option<MediaInfo>`; `MediaInfo { media_type: &'static str, ext: &'static str, width: Option<u32>, height: Option<u32>, pages: Option<u32> }`. By magic bytes only (R72): PNG `89 50 4E 47`, JPEG `FF D8 FF`, GIF `GIF87a`/`GIF89a`, WebP `RIFF….WEBP`, HEIC `ftyp` with brand `heic`/`heix`/`mif1`/`msf1`, PDF `%PDF-`, SVG (UTF-8 text whose first element after an optional XML declaration, comments and doctype is `<svg`). Sizes with the `imagesize` crate (JPEG width/height swapped when the EXIF orientation is 5…8, read with `kamadak-exif`); SVG from the root's `width`/`height` when they are plain numbers or `px`, else from `viewBox`, else none; PDF pages = the `/Count` of the root `/Pages` object when found by a byte scan, else the number of `/Type /Page` (not `/Pages`) objects, else none. `None` = refused (`media.refused`). Empty input is refused. Over 200 MB is refused by the callers before reading (D-621).

### 3.2 Media resolution

A link target whose last path segment has an extension other than `.md` names a **media file**. It resolves against the vault's files (not only objects; the file list of `Vault::files`) by Obsidian's rules: an exact vault path (case-insensitive, NFC) first, then the file with that name in the source's folder, then the unique file with that name anywhere (several: the shortest path, then path order). Templates and `.trash/` excluded. Result `LinkKind::Media`: `path` = the file, `object` = the live Image/PDF object whose `file:` resolves to it (several: path order; none: null), `title` = the object's title or the file name, `type` = `image` / `pdf` from the object, else from `media_info` of the extension class (`png|jpe?g|gif|webp|heic|svg` → `image`, `pdf` → `pdf`, else null). A media target that resolves nowhere live is `Trashed` (§2) or `Unresolved`.

FR-ATT-07 backlinks: an `![[file]]` or `[[file]]` link to a paired file counts as a link to its object (the object's backlinks list the note; FR-ATT-01 AC-15).

### 3.3 Names and titles (D-617; R72, R73)

`pub fn media_names(vault_files: &dyn Fn(&str) -> bool, objects: …, req: &NameRequest) -> MediaNames` in `media6a.rs` (pure, L4 unit tests):

- **File name.** `req.name` (from the drop/picker path's file name, or the UI's `Pasted image <yyyyMMddHHmmss>` for a paste; the UI computes the local time with `appZone()` and the clock, ms5-tasks §1, since the core never decides local time), NFC, D-51 sanitizing (forbidden characters → space, trimmed, ≤ 200 UTF-8 bytes keeping the extension), extension kept as given; when the given name has no extension, `MediaInfo::ext` is added. Taken (case-insensitive) in the attachments folder → ` (2)`, ` (3)` before the extension.
- **Title.** The stem, unless generic (R73's list and regex, case-insensitive, on the stem after trimming), then `<owner title> <n>` with the smallest `n ≥ 1` such that `<type folder>/<owner title> <n>.md` is free; without an owner (capture without a title), `Capture <yyyy-MM-dd> <n>` with the UI's local date. The owner title is the note's title (title, else stem) passed by the UI.
- **Object path.** `<type folder>/<sanitized title>.md` with the free-stem rule (ms4-links §3.1) for non-generic titles (` (2)` suffix).

### 3.4 Adding (`Core::media_add(req: MediaAdd) -> Result<MediaAdded>`)

```rust
pub struct MediaAdd { pub bytes: Vec<u8>, pub name: String, pub owner: Option<OwnerRef>, pub now: SystemTime, pub zone_date: String /* yyyy-MM-dd, for capture titles */ }
pub struct OwnerRef { pub path: String, pub title: String }
pub struct MediaAdded { pub file: String, pub object: String, pub title: String, pub embed: String /* the text inside `![[…]]` */, pub info: MediaInfo, pub version: FileVersion /* the object's */ }
```

Steps: `media_info` (refuse → `Refused`); names (§3.3); create-exclusive the file in the attachments folder (vault setting `attachments`, D-551; folder created if missing); create-exclusive the object with the bytes of §3.5; on failure of the object write, `discard_checked` the file just written (FR-ATT-01 AC-7) and return the error. `embed` is the file name when it is unique in the vault (Obsidian's shortest form), else the vault path (D-184 rule for files). `TEGG_TEST_FAIL_MEDIA=object|file` (with `TEGG_TEST=1`) fails that step once with `Io`.

### 3.5 Object bytes (`@tegg/doc` twin for the fake core: `packages/doc/src/media.ts` `mediaObject(...)`)

```
---
id: <ULID>
type: image
title: <title>
created: <now, ISO with offset>
modified: <same>
file: "[[<embed>]]"
media-type: image/png
size: <bytes>
width: <px>
height: <px>
source: "[[<owner D-184 link text>]]"
---
```

`pdf`: `pages` instead of `width`/`height`. Absent values are omitted (no empty keys). Strings are double-quoted only where the D-174/D-232 writer quotes them (titles with `:`, `#`, leading special characters). `\n` line endings, final newline, no body. Rust and TS produce identical bytes for the same inputs (L1 + L4 twin test on the same table).

### 3.6 The media scheme (D-622)

`tegg-media://localhost/<percent-encoded vault path>` registered with `register_asynchronous_uri_scheme_protocol` on the main window's builder. It answers `GET` only: the path is NFC-normalized, joined to the open vault's root, canonicalized (symlinks resolved), and must stay inside the canonical root and outside `.tegg/`; the file must exist and its `media_info` class must be one of R72's. Then `200` with `Content-Type` = the sniffed media type, `Cache-Control: no-cache`, the bytes (HTTP `Range` honoured for PDFs). Everything else: `404` with an empty body (no listing, no error text). Trashed files are served (the Trash view shows them). `tegg-media://localhost/stage/<token>` serves a capture staging token (§5) to the capture window only (the request's webview label must be `capture`).

The UI builds every media URL through `app/ui/src/ipc/media.ts` `mediaUrl(path)`. In tests `window.__TEGG_MEDIA_BASE__` (set by the fake core) replaces the scheme with `http://localhost:5177/__media/`, which the fake serves from its in-memory files through `page.route` (WebKit can't route custom schemes).

## 4. IPC (main window)

| Command | Args | Returns | Notes |
| --- | --- | --- | --- |
| `trash_list` | — | `TrashEntryDto[]` | §1.2; `trashedAt` = ISO instant with the vault zone's offset of `trashed_ns`. |
| `object_trash` | `path`, `base: VersionDto` | `MovedDto[]` | §1.4 `trash_object`. Errors `Conflict` (with `disk`), `Gone`, `NotFound`, `Invalid`, `Io`. |
| `trash_restore` | `path` | `MovedDto[]` | §1.4. |
| `trash_delete` | `paths: string[]` | `TrashRemovalDto` | §1.4 through the shell's `SystemTrash`. |
| `trash_empty` | — | `TrashRemovalDto` | §1.4. |
| `media_add` | raw body = the bytes; headers `x-tegg-name` (percent-encoded), `x-tegg-owner` (percent-encoded vault path, optional), `x-tegg-owner-title`, `x-tegg-date` (`yyyy-MM-dd`) | `MediaAddedDto` | Tauri 2 raw `InvokeBody` (no base64, no JSON array). Errors `Refused`, `TooLarge`, `Io`. |
| `media_add_paths` | `paths: string[]`, `owner`, `ownerTitle`, `date` | `MediaAddResultDto[]` | Drop and picker: the shell reads each path (outside the vault is fine: the bytes are copied; the original is untouched), in order; per path `{ ok: MediaAddedDto } \| { error: 'Refused' \| 'TooLarge' \| 'Io', name }`. A directory is `Refused`. |
| `media_pick` | `kind: 'any' \| 'image' \| 'pdf'` | `string[]` | `tauri-plugin-dialog` open dialog, multiple, R72 extensions filter; Cancel → `[]`. `TEGG_TEST_PICK_FILES=<path>[:<path>…]` answers without a dialog. |
| `media_open` | `path` | — | `NSWorkspace openURL` of the vault file (default app). `TEGG_TEST_REVEAL=<file>` records `open <path>` instead (existing hook, ms5-capture §11.1). |
| `media_reveal` | `path` | — | `NSWorkspace activateFileViewerSelectingURLs`; the same hook records `reveal <path>`. |

```ts
type TrashEntryDto = { path: string; kind: 'object' | 'file' | 'folder'; original: string; folder: string; title: string; type: string | null; files: string[]; count: number; trashedAt: string };
type MovedDto = { from: string; to: string };
type TrashRemovalDto = { removed: string[]; failed: { path: string; reason: string }[] };
type MediaAddedDto = { file: string; object: string; title: string; embed: string; mediaType: string; size: number; width: number | null; height: number | null; pages: number | null };
```

**Events.** The watcher's `vault:changed` already carries paths; paths under `.trash/` are now included (they were dropped), and the shell additionally emits `trash:changed` (no payload, debounced 200 ms) for any change under `.trash/`. The Trash page re-reads `trash_list` on it (FR-HIS-01 AC-4); link chips re-resolve on `vault:changed` as today.

**Drag and drop.** Tauri's window drag-drop stays enabled (default). The editor listens to `getCurrentWebview().onDragDropEvent`: on `drop` with `paths` and `position` (logical px), it maps the position to a document position (`posAtCoords`), calls `media_add_paths`, then inserts. While a file drag is over the editor, a drop caret is shown (`.media-drop-caret`). Drops outside an editor are ignored. HTML5 drags inside the webview (text, blocks) are unaffected.

## 5. Capture window (D-620; capability `capture`)

New capture command `capture_media_add` (in `capabilities/capture.json`): raw body with headers `x-tegg-name`, or JSON `{ paths: string[] }` for drops, or `{ pick: true }` for the picker (the shell opens the dialog; the capture window gets no `media_pick`). It **stages** the files in shell memory (never the vault), checks `media_info` and the size, and returns `StagedMediaDto[] = { token, name, mediaType, size, width, height, pages }` or per-file errors as `media_add_paths`. Thumbnails load from `tegg-media://localhost/stage/<token>`. Tokens are dropped when the capture is saved, cancelled, or the window hides for more than 10 minutes.

`capture_create` gains `media: string[]` (tokens, in display order): after its checks and before the note's create, each staged file is written through `Core::media_add` with owner = the capture's future path and title (`Capture <date>` titles when the capture has no title), then the note is created with `![[<embed>]]` paragraphs appended after its text (one per file, blank-line separated, D-620). If a media add fails, nothing more is written, the pairs already written stay (valid on their own), and the error is returned as `Io` with the file name. The capture page's `paste` handler stages an image item instead of D-545's notice; the drop zone `Add an image or PDF` is enabled. §2.3 of ms5-capture is amended: the capture page reads pasted image bytes from the paste event's `clipboardData.files` (still no clipboard API).

## 6. Editor and views

### 6.1 `@tegg/editor`

- `EditorUi.media?(target: LinkInfo, block: HTMLElement): void`: called for a block embed whose resolved kind is `media`; the app renders the figure or card into `block` (the editor owns no `img`). Kind `trashed` calls the existing embed placeholder hook with state `trashed`.
- `EditorUi.onFiles?(files: File[], pos: number): boolean`: the editor's `handlePaste` calls it first when the clipboard has files (image items win over text, AC-1); returning `true` consumes the paste.
- `insertEmbeds(view, embeds: string[], pos?: number)`: inserts one paragraph `![[<embed>]]` per item at `pos` (default: after the caret's block), as one transaction (one undo step, AC-8); the caret goes after the last one.
- The media block is an embed block (D-428): selectable with a click, ⌫ deletes the paragraph, copy/paste copies the text `![[…]]`. Double-click and ⌘-click call `EditorUi.openLink(target)`.

### 6.2 App UI

| Module | Content |
| --- | --- |
| `app/ui/src/trash/TrashPage.tsx`, `trash/useTrash.ts` | R70, AC-4…AC-9; keys per R70's hint |
| `app/ui/src/trash/moveToTrash.ts` | `moveToTrash(items: { path, base, title }[])`: flush autosave of open notes in `items` (D-196), `object_trash` each, toast `trash.moved` / `trash.movedMany` with `Undo` (→ `trash_restore` of each `to`) through the jobs toast (`jobs/jobs.ts`), navigation per AC-1; used by the note page (More menu, ⌘⌫ command `object.trash`), the task card menu, the Inbox, the type page rows |
| `app/ui/src/media/MediaFigure.tsx`, `media/PdfCard.tsx`, `media/addMedia.ts` | R77 rendering; `addMedia(editor, source, pos)` for paste (bytes → `media_add`), drop and picker (`media_add_paths`), then `insertEmbeds`; errors as `media.refused` / `media.failed` alerts |
| `app/ui/src/media/MediaObjectView.tsx` | R76, shown by `NotePage` above the body for `image` / `pdf` objects |
| `app/ui/src/links/chip.ts` | trashed chips: `data-link-state="trashed"`, class `chip-trashed`, description `trash.inTrash` |
| `app/ui/src/embeds/Embed.tsx` | `trashed` placeholder with `Restore` (D-27; FR-CNV-08 AC-6) for notes and media |

**Registry (R75).** Route `home` removed from `ROUTES`; `home` in `parseRoute` gives the not-found route; `TOP` in `Frame.tsx` loses Home; `BOTTOM` gains `{ id: 'trash', label: 'route.trash', icon: 'trash' }` last; the launch fallback in `App.tsx` `land()` is `{ id: 'inbox' }` (D-610). Commands: `goto.home` removed; `object.trash` (⌘⌫; enabled on a note page, a focused Inbox card, task card or type-page row; aria-disabled `trash.nothing` = `Nothing to delete yet.` on a virtual Daily Note or unsaved object); `goto.trash`; `trash.restore` (R), `trash.delete` (⌘⌫ on the Trash page); `media.add` (⇧⌘A in an editor). The controls of R75 lose their `due`. The milestone check (`VERIFY_MILESTONE=MS6`) fails while any MS6 control or route is still TBD.

**⌘⌫ in the editor.** In a text editor ⌘⌫ keeps its text meaning (delete to line start) whenever the editor has focus; `object.trash` fires only when the focus is outside a text field or editor (the page's header, the More menu, a card or row). The palette entry always works on the current note.

## 7. Marks and timing

`route-ready:trash` when the list is painted. `media-ready:<vault path>` when an image's `load` event fires (tests wait for it, AC-1's "within 1 s", AC-16). No other new marks.

## 8. Strings

R78's keys in `app/ui/src/i18n/catalog.ts`; `trash.nothing` `Nothing to delete yet.`; `trash.conflict` `"{title}" changed outside Tegg. It wasn't moved to the trash.`; `trash.removeFailed` `{count} items couldn't be removed.` (plural forms); `media.dropHint` `Drop to add`; `media.tooLarge` = `media.refused`'s text (D-621 uses the same message). The capture keys `capture.mediaLater` is retired; `capture.drop` (exists) is now a button.

## 9. Test environment, fake core and layout

### 9.1 Test hooks (only with `TEGG_TEST=1`)

| Variable | Effect |
| --- | --- |
| `TEGG_TEST_SYSTEM_TRASH=<dir>` | `SystemTrash` moves into `<dir>` (§1.1) |
| `TEGG_TEST_PICK_FILES=<p1>:<p2>` | `media_pick` and the capture picker answer these paths |
| `TEGG_TEST_FAIL_MEDIA=file\|object` | §3.4 fault injection, once |
| `TEGG_TEST_REVEAL=<file>` | (exists) also records `media_open` / `media_reveal` |

### 9.2 Fake core additions (ms3-shell §5)

- `trash_list` from the in-memory files; each entry's `trashedAt` from `FakeOptions.trashedAt[path]` (ISO), else the time the fake moved it (the fake's clock), else `2026-10-01T00:00:00+02:00`. `object_trash`, `trash_restore`, `trash_delete`, `trash_empty` over the in-memory files with the §1.4 rules (a TS twin `app/ui/test/fake-trash.ts`), counted by `writes()` as kind `trash` / `restore` / `remove`; `systemTrash()` on the handle returns what was removed.
- `link_resolve` with the `trashed` and `media` kinds and `object` (TS twin of §2, §3.2 in `fake-core.ts`); `embed_load` state `trashed`.
- `media_add` / `media_add_paths` / `media_pick` with `FakeOptions.files: Record<absPath, Uint8Array>` for paths outside the vault and `FakeOptions.pick: string[]`; names, titles and object bytes from `packages/doc/src/media.ts` (`mediaNames`, `mediaObject`, `mediaInfo` TS twins of §3.1, §3.3, §3.5).
- `handle.dropFiles(paths, { x, y })` emits Tauri's drag-drop event (`tauri://drag-drop` with `paths` and `position`); `handle.paste(page, { files: [{ name, type, bytes }] })` dispatches a synthetic paste with `clipboardData.files`.
- `window.__TEGG_MEDIA_BASE__` and the `/__media/` route serve in-memory files with the sniffed content type (§3.6), and `/__media/stage/<token>` for the capture page.
- `media_open` / `media_reveal` recorded in `handle.calls()`.

### 9.3 Test layout

| Layer | Files |
| --- | --- |
| L0 | `app/test/media_static.ac.test.ts`: no `asset:` protocol or `assetProtocol` in `tauri.conf.json`; `tegg-media` registered; `capture.json` gains exactly `allow-capture-media-add` |
| L1 | `packages/doc/test/media.ac.test.ts` (R72, R73 names and titles, §3.5 bytes, `mediaInfo` on the fixture files); `app/test/registry_6a.ac.test.ts` (R75, no `home`), `app/test/catalog_6a.ac.test.ts` (R78), `app/test/trash_order.ac.test.ts` (fake twin of §1.2 rows and order) |
| L2 | `packages/editor/test/media.prop.ac.test.ts` (FR-FMT-07 AC-22: insert/remove media paragraphs on the round-trip corpus); `crates/tegg-core/tests/ac_trash_prop.rs` (trash + restore returns bytes and mtime) |
| L4 | `crates/tegg-core/tests/ac_trash.rs` (FR-HIS-01 AC-1, AC-2, AC-4, AC-5, AC-7, AC-8, AC-10, AC-14, AC-15), `ac_trash_links.rs` (AC-11…AC-13: `trashed` kind, broken links, backlinks), `ac_media.rs` (FR-ATT-01 AC-1, AC-4…AC-7, AC-9, AC-15; §3.1 per format; §3.5 Rust/TS twin table), `ac_media_links.rs` (§3.2), `ac_media_obsidian.rs` (AC-10 with the obsidian-check harness); `app/src-tauri/tests/ac_media_scheme.rs` (§3.6: inside/outside/symlink/`.tegg`/non-media → 404), `ac_capture_acl.rs` extended (`capture_media_add` allowed, `media_add` refused from `capture`) |
| L5 | `app/webkit/trash.ac.test.ts` (FR-HIS-01 AC-1, AC-3…AC-9), `trash_links.ac.test.ts` (AC-11, AC-12, FR-CNV-08 AC-6), `media_add.ac.test.ts` (FR-ATT-01 AC-1…AC-4, AC-6…AC-8), `media_view.ac.test.ts` (AC-12…AC-15, R76), `capture_media.ac.test.ts` (AC-11, FR-CAP-01 AC-12), `sidebar_6a.ac.test.ts` (FR-NAV-04 AC-6, AC-7's UI branch), `inbox_trash.ac.test.ts` (FR-INB-02 AC-10's 6A part), with `app/webkit/trash-media-helpers.ts` |
| L6 | `app/e2e/ms6_trash_media.ac.test.ts`: FR-HIS-01 AC-1 (once), AC-7 with `TEGG_TEST_SYSTEM_TRASH`, FR-ATT-01 AC-1 (NSPasteboard PNG), AC-2 (a real Finder drag is not automatable: the drop is sent through the test hook `TEGG_TEST_DROP=<paths>@<x>,<y>`, which emits the same window event), AC-3 (pick hook), AC-11, AC-12 (real scheme), AC-13, FR-NAV-04 AC-6, AC-7 (launch on `inbox`), FR-SYN-06 AC-29, AC-30; `app/e2e/perf_media.ts` (AC-16, report-only) |

**Fixture.** `tests/fixtures/vaults/trash-media/` is written from its `README.md` in its own commit (`Fixture-Change:` trailer) before the red tests. The binary files are generated by `tests/fixtures/vaults/trash-media/make-media.mjs` (Node, no dependencies: zlib for PNG, hand-written PDF objects, a tiny JPEG with EXIF orientation 6 for §3.1, GIF, WebP, a minimal HEIC header sample, SVG) and committed together with the script. R71's trash times can't be committed (git sets no ctime): L4 and L6 setup re-touch each trashed entry in R71's order by renaming it out of `.trash/` and back with a ≥ 20 ms pause; L5 passes `FakeOptions.trashedAt` with R71's instants.

## 10. Contract choices (no owner decision needed)

1. **Pairs are found through `file:`, not by name**, so a renamed Image object (FR-ATT-08) still trashes its file.
2. **A restored pair whose file name is taken is not re-linked.** Rewriting `file:` and every `![[…]]` would be a 4C job on files the user didn't touch; the suffix case is rare and reported.
3. **Trash time from `ctime`.** It is approximate on synced vaults (a sync client may re-create files), which is acceptable for display and order; no file in the vault records it (AR-01).
4. **The core never computes local time:** paste names and capture titles carry the UI's local date-time (ms5-tasks §1).
5. **Raw IPC bodies for bytes** (Tauri 2 `InvokeBody::Raw`) keep a 10-MB paste within AC-16's 1 s; JSON arrays would be ~4× larger and slow.
6. **One scheme for main and capture** with the staging path limited to the capture webview, so the capture window still reads nothing from the vault (D-553).
7. **The trash table in the index** is rebuilt from the file system like everything else (AR-01) and exists only to make §2's `Trashed` resolution as fast as live resolution (NFR-PERF-05 AC-3 unchanged).
