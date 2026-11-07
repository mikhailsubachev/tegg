# Contract: Pinned items in the left sidebar (v1.0 slice PIN)

Public interfaces of slice PIN, for the test author (D-61) and the build. ACs: `docs/acceptance/pinned.md` (R131…R137;
FR-HOM-02 AC-1…AC-27, FR-NAV-04 AC-9, AC-10, FR-LNK-03 AC-22, FR-SYN-03 AC-26, AC-27, FR-SYN-02 AC-9, FR-SYN-06 AC-43,
FR-FMT-07 AC-28, FR-FMT-12 AC-8, NFR-POR-01 AC-4, FR-STO-06 AC-2, FR-UX-03 AC-39, AC-40, FR-UX-08 AC-16, AC-17,
FR-UX-05 AC-19, NFR-OTH-02 AC-16). Decisions: AP-1227…AP-1248, accepted as proposed: D-1370…D-1391 (BRD v1.151;
AP-n → D-(n−1227+1370)). Boards: `design/edit-note-page/SidebarPinned.dc.html`, `SidebarPinnedDark.dc.html` A–G.
Fixtures: `tests/fixtures/vaults/pinned/` and `tests/fixtures/pinned-files/` (each with its README). Precedent: the
graph presets file, [v1-graph.md](v1-graph.md) §16; this contract follows it wherever the ACs leave room, and §8 lists
each such choice.

PIN **writes one vault file**, `.tegg/pinned.yml`, only on `pin`, `unpin` and `move` (R131) and inside the rename,
move and tag-rename jobs ([ms4-jobs.md](ms4-jobs.md), §1.6 here). It never writes a note, a Tag file, a type file or
anything outside `.tegg/pinned.yml` (D-1372, NFR-POR-01 AC-4). Its only other write is `ui-state.json` in Application
Support (§4).

## 1. The pins module (`tegg-core`, AR-03)

A new module `crates/tegg-core/src/pinned.rs`, `pub mod pinned` in `lib.rs` (like `graph_presets`), platform-neutral:
no Tauri or desktop dependency; it reads and writes through `Vault` and reads the index through the core's lock. Nothing
about pins is stored in the index (AR-01, FR-STO-06 AC-2). Quoting and the first YAML document come from
`crate::yaml_text` (`scalar`, `top`), shared with `settings5b.rs` and `graph_presets.rs`.

### 1.1 Types

```rust
pub const PINNED_YML: &str = ".tegg/pinned.yml";
pub const PINS_VERSION: u32 = 1;

/// What a pin item stores, NFC (R131). `Object` has at least one of the two.
pub enum PinTarget {
    Object { id: Option<String>, path: Option<String> },
    Tag { key: String },     // tag_key: NFC, lower case, a leading `#` dropped
    Type { key: String },    // NFC, as the `type/<type>` route
}

/// One listed pin (R131's read rules passed, not a `query:` item), in file order.
pub struct PinItem {
    pub target: PinTarget,
    pub lines: std::ops::Range<usize>,   // 0-based line range of the item in the file, `- ` line first
}

pub enum PinsFileState { Missing, Ok, Newer { version: u64 }, Unreadable { line: Option<u32>, reason: String } }

/// The pure parse of the file's bytes (no index, no disk).
pub struct PinsFile {
    pub state: PinsFileState,
    pub items: Vec<PinItem>,       // empty when Missing or Unreadable
    pub patchable: bool,           // false: listed, but every write is refused (§1.4, D-1122 rule)
}

pub enum PinState { Ok, Pending, Trashed, Missing, NoObjects }

/// One row of the section: a listed pin and what it resolves to (R131 resolution, R133).
pub struct PinRow {
    pub index: usize,              // 0-based position among listed pins
    pub target: PinTarget,         // as stored (NFC)
    pub state: PinState,
    pub path: Option<String>,      // Ok object: its live path; Trashed object: its `.trash/…` path
    pub title: Option<String>,     // Ok / Trashed object: its title (stem when untitled, D-103)
    pub r#type: Option<String>,    // Ok / Trashed object: its matched type key (D-239)
    pub date: Option<String>,      // Ok Daily Note: its date (`daily/<date>` route)
}

pub struct Pins {
    pub version: Option<FileVersion>, // the file's version as read; None when Missing
    pub state: PinsFileState,
    pub patchable: bool,
    pub index_ready: bool,            // the first index build after open has ended
    pub rows: Vec<PinRow>,
}

/// A user action (R131 write rules). `at` / `to` are 0-based final positions among listed pins (R131's "position k"
/// is k − 1); `at: None` is the end.
pub enum PinOp {
    Pin { target: PinRequest, at: Option<usize> },
    Unpin { index: usize },
    Move { from: usize, to: usize },
}
/// What the UI asks to pin; the core turns it into a `PinTarget`.
pub enum PinRequest { Object { path: String }, Tag { key: String }, Type { key: String } }

pub enum PinError { NewerVersion, Unreadable, NotPinnable, NoSuchPin }

/// A change a job hands to the pins file (§1.6).
pub enum PinPatch {
    /// An object moved from `from` to `to` (rename, type move, folder move). `id`: the object's `id` after the job.
    Moved { from: String, to: String, id: Option<String> },
    /// A tag key renamed (tag rename, and each merged tag of a merge).
    TagRenamed { from: String, to: String },
}
```

`CoreError` gains `Pin(PinError)` (as `Preset(PresetError)`).

### 1.2 Pure functions (shared with the TS twin, §5)

```rust
pub fn read(bytes: &[u8]) -> PinsFile;
/// The new text after `edit`, or None when the bytes would stay equal. `text: None` = no file (a `Insert` creates it).
pub fn apply_text(text: Option<&str>, file: &PinsFile, edit: &PinEdit) -> Result<Option<String>, PinError>;
/// The job patch (§1.6); None when no item matches or the file can't be patched (it's then left alone).
pub fn patch_text(text: &str, file: &PinsFile, patches: &[PinPatch]) -> Option<String>;

/// `apply_text`'s edits: a `PinOp` with the request already turned into a stored target.
pub enum PinEdit { Insert { target: PinTarget, at: Option<usize> }, Remove { index: usize }, Move { from: usize, to: usize } }
```

- **Parsing** as `graph_presets.rs`: `yaml_rust2` for values, a line scanner for each item's line range. R131's read
  rules decide listed, skipped and `query:` items; skipped and `query:` items have no `PinItem` and are never touched.
  `Unreadable.line` is the parser's 1-based line, with D-1120's rule for an unclosed flow collection
  (`invalid-yaml.yml` → 5). Invalid UTF-8 → `Unreadable { line: None }`. An empty file, a comments-only file and
  `pins:` with no value read as `Ok` with no pins (D-1121).
- **Flow items** (`- {tag: účty}`, one line) are listed and patchable: their line range is that line. A non-empty flow
  sequence (`pins: [ … ]`), several YAML documents, or items the scanner can't line up with the parsed YAML give
  `patchable: false` (D-1122).
- **Writing** by R131's write rules and D-1124 (new items copy the last item's dash and key indentation, else 2 / 4
  spaces; a missing `version: 1` goes after the leading comment lines, `%` directives and the first `---`, only on a
  write that changes the file), D-1129 (comment and blank lines never end an item; a leading BOM stays first), CRLF and
  a missing final newline kept. A new file is `expected/created.yml`'s header comment line, `version: 1`, `pins:` and
  the item, LF. Values through `yaml_text::scalar`, paths and keys NFC.
- **Read-back check** (D-1129): before every write the new text is parsed again and must list exactly the expected
  pins with every other item and top-level key unchanged; otherwise the write is refused with `Unreadable`.

### 1.3 Resolution, one call (R131, R133; D-1372, D-1374)

```rust
impl Core {
    /// Reads `.tegg/pinned.yml` and resolves every listed pin; never writes, never creates.
    pub fn pins(&self) -> Pins;
}
```

- One file read, then **one** index lock for every row (never one lookup per row, FR-HOM-02 AC-25): a new
  `tegg_index::Index::pin_lookup(ids: &[String], paths: &[String]) -> PinLookup { by_id: HashMap<String, ObjectInfo>,
  by_path: HashMap<String, ObjectInfo> }` (ids through the index's existing `by_id`, which already picks the primary of
  a duplicate-id group; paths NFC), the index's tag keys, and the type counts. Trashed objects come from the core's
  cached `file_cache().trashed` (6A: their original paths and ids); type definitions from `Core::types()`.
- **Object pin**, in R131's order: `id` live → `Ok` (whatever its path now); `id` among trashed → `Trashed`; `path`
  live with no `id` or the same `id` → `Ok`; a live file at `path` with **another** `id` is never adopted;
  `.trash/<path>` → `Trashed`; else `Missing`.
- **Tag pin**: `Ok` when the key is a tag (tags.md R79: an occurrence or a Tag file), else `NoObjects`.
- **Type pin**: `Ok` when the key has a definition or at least one indexed object (D-121), else `Missing`.
- **Pending** (FR-HOM-02 AC-20): until the first index build after the vault opened has ended (the same flag as
  `graph_neighbourhood`'s `NotReady`, `shared.graph_ready`), every row that would be `Missing` or `NoObjects`, and every
  type pin without a definition, is `Pending`; `index_ready: false`. Resolution never depends on the region (FR-FMT-12
  AC-8); paths and keys compare NFC.

### 1.4 Writes

```rust
impl Core {
    /// One operation = at most one atomic write (FR-SYN-02). `base` is `Pins.version` as last read.
    pub fn pins_apply(&self, base: Option<FileVersion>, op: PinOp) -> Result<Pins, CoreError>;
}
```

- **Base check** exactly as `graph_presets_apply` (D-175: size + hash, so an mtime-only change isn't a conflict):
  `Vault(Conflict { disk })` when the disk content differs from `base`, and when `base` is None and the file exists
  (the create is exclusive, RENAME_EXCL, ms3-shell §13); `Vault(Gone)` when `base` is Some and the file is missing (no
  file is created).
- **Refusals** (nothing written): `Newer` → `Pin(NewerVersion)`, `Unreadable` → `Pin(Unreadable)` for every op
  (AP-1245 = D-1388); `patchable: false` → `Pin(Unreadable)`; `Unpin` / `Move` with an index not listed →
  `Pin(NoSuchPin)`.
- **`Pin`**: `Object { path }` → `NotPinnable` unless `path` names an existing `.md` file outside `.tegg/`, `.trash/`
  and `_templates/`. The `id` is read from that file's frontmatter (`tegg_format::extract`, not the index); a file
  without one is stored by `path` only (AP-4, D-1372). The note is never written. An object whose type is `tag` is
  stored as `Tag { key }` of its tag (D-1382). `Tag { key }` → `tag_key(key)`; `Type { key }` → NFC; a blank key →
  `NotPinnable`. A target already listed (same `id`, or same NFC path for path-only items, same tag or type key) is
  **moved** to `at` instead (D-1379).
- **No-op**: an op whose result equals the disk bytes (a `Move` to its own place) writes nothing and returns `Ok`.
- The write is `Vault::write(PINNED_YML, bytes, base)`: a `.pinned.yml.<…>.tegg-tmp` file in `.tegg/`, flushed, then
  renamed over the target (FR-SYN-02 AC-9). The file is never deleted (R131).

### 1.5 Watcher

`vault:changed` already carries `.tegg/…` paths (ms3-shell §3). The module keeps **no cache**: every `pins()` reads
the file (as `graph_presets`, v1-graph §16.11). Only the exact path `.tegg/pinned.yml` is read; sync conflict copies
(`pinned 2.yml`, `pinned (conflicted copy …).yml`) are never read, written or deleted (FR-SYN-03 AC-27).

### 1.6 Job hook (FR-LNK-03 AC-22, FR-HOM-02 AC-21; AP-1230 = D-1373)

`tegg-jobs` can't depend on `tegg-core`, so the jobs reach the patcher through their `Host` (as `write_type_folder`,
ms4-jobs §14.5):

```rust
// crates/tegg-jobs/src/host.rs
/// Patches `.tegg/pinned.yml` with `patches` (a base-checked line patch, v1-pinned §1.6). Ok(None): nothing written
/// (no file, no matching item, an unreadable, newer or unpatchable file, or equal bytes).
fn patch_pins(&self, patches: &[PinPatch]) -> Result<Option<PinsWrite>, WriteError> { let _ = patches; Ok(None) }

pub struct PinsWrite { pub pre: Vec<u8>, pub pre_v: FileVersion, pub post: Vec<u8>, pub post_v: FileVersion }
```

`PinPatch` and `PinsWrite` live in `tegg-jobs` (re-exported by `tegg-core::pinned`); `CoreHost` implements
`patch_pins` with `pinned::read` + `pinned::patch_text` and `Vault::write` against the version it just read.

- **Matching.** `Moved { from, to, id }`: an object item whose `id` equals the moved object's `id`, or a path-only item
  whose NFC `path` equals `from`. Its `path:` line gets `to` (NFC); a path-only item gets `- id: <id>` as its first line
  when `id` is Some (the rename wrote one, AP-4), giving `- id:` / `path:`. An item with another `id` and the same
  `path` is not touched. An `id`-only item is left as it is (it resolves by `id`). `TagRenamed { from, to }`: every
  listed `tag:` item with key `from` gets `to` (a flow item's value token is replaced in place; one the scanner can't
  locate is left).
- **Who calls it.** `note-rename` (4C) after its note's rename and its linking files, with the note's final path and
  `id`; its undo and redo; `type-move` and `folder-move` (4E-1) after the moves that really happened (ms4-jobs §14.3a);
  `tag-rename` and `merge` (4D-lite) after their notes. Not `tag-delete` (the row becomes `No objects`), not trash or
  restore (AP-1231 = D-1374), not `type-delete`, not external renames (followed by `id`, no write).
- **Inside the job.** The pins file is read and patched at its own write step, last, so the job's base is the version
  it just read. It is a row of the job like any other file: listed in `written`; undoable jobs keep its
  `pre`/`post` in their undo record (a byte row, ms4-jobs §7: undo writes `pre` only while the file is still `post`,
  else it is skipped `changed` and listed); the §8 journal of a single-note job gets an entry for it; zips already hold
  every `.tegg/` file (ms4-jobs §6, so the tag-rename zip includes it). `WriteError::Conflict` or `Gone` → skipped
  `changed` / `missing` and listed; the job still succeeds. It is not counted in `done` / `total` (FR-UX-07 AC-8).

## 2. IPC

| Command | Arguments | Returns | Notes |
| --- | --- | --- | --- |
| `pins_get` | — | `PinsDto` | `Core::pins`. Read-only. One call resolves every row. |
| `pins_apply` | `base: VersionDto \| null`, `op: PinOpDto` | `PinsDto` (the new state) | `Core::pins_apply`. Errors below. Calls are serialized in the UI (one in flight). |

New Tauri module `app/src-tauri/src/shellpin.rs`, registered next to `shellg3`. TS types in
`app/ui/src/ipc/pins.ts` (hand-written, as `graph/types.ts`); `ipc/client.ts` gains `pinsGet()` and
`pinsApply(base, op)`.

```ts
type PinStoredDto =
  | { kind: 'object'; id: string | null; path: string | null }
  | { kind: 'tag'; key: string }
  | { kind: 'type'; key: string };
type PinRowDto = {
  index: number;                                    // 0-based among listed pins
  target: PinStoredDto;
  state: 'ok' | 'pending' | 'trashed' | 'missing' | 'noObjects';
  path: string | null; title: string | null; type: string | null; date: string | null;   // §1.1
};
type PinsDto = {
  version: VersionDto | null;
  state: 'missing' | 'ok' | 'newer' | 'unreadable';
  error: { line: number | null; reason: string } | null;   // only for 'unreadable'
  patchable: boolean;
  indexReady: boolean;
  rows: PinRowDto[];
};
type PinRequestDto = { kind: 'object'; path: string } | { kind: 'tag'; key: string } | { kind: 'type'; key: string };
type PinOpDto =
  | { op: 'pin'; target: PinRequestDto; at: number | null }
  | { op: 'unpin'; index: number }
  | { op: 'move'; from: number; to: number };
// IpcError.kind: 'Conflict' (payload `disk: PinsDto`), 'Gone', 'NewerVersion', 'Unreadable', 'NotPinnable',
// 'NoSuchPin', 'Io', 'NoVault'.
```

`IpcError` gains a flattened `pins` extra (as G3's `presets`, v1-graph §16.11): `Conflict` carries `disk`, the pins as
on disk now.

**UI handling** (FR-SYN-03 AC-26): `Conflict` → draw `disk`; `Gone`, `NoSuchPin`, `NotPinnable` → `pins_get`, draw it;
each of these shows `pinned.changedOutside` and puts a dragged row back. `NewerVersion`, `Unreadable` → `pins_get`
(the notice or the read-only state follows from it). `Io` → `pinned.saveFailed`, rows unchanged. No error retries
automatically (D-1371).

**Events.** No new event. The section calls `pins_get` again on every `vault:changed` (any paths: a target's rename,
trash or type change changes rows), debounced 300 ms, and on `index:progress` with `done` while `indexReady` is false.
A result equal to the drawn one redraws nothing. A `pins_apply` answer replaces the state directly.

## 3. UI

### 3.1 Modules (`app/ui/src/pinned/`)

| Module | Owns |
| --- | --- |
| `model.ts` | Pure, L1-tested. `rowView(row, types: TypeEntry[], tagLook)` → `{ label, icon, color, description, tooltip, route: Route \| null, opens: 'route' \| 'trash' \| 'alert' \| 'none' }` (R133; types from `typeEntries`, as the Types list draws them; tag name and colour from `tags/store.ts`); `findPin(pins, target)` → listed index or null (NFC; a Tag object path maps to its tag); `targetOfRoute(route)` → `PinRequestDto \| 'unsaved' \| null`; `editReason(pins)` → `null \| 'pinned.fixFile' \| 'pinned.newer'`; `dropIndex(rowRects, y, from?)` → the 0-based final position for a pointer at `y` (R135's line); `moveTarget(index, dir, n)` → the new index or null at the ends. |
| `store.ts` | The one `PinsDto` of the open vault, as `tags/store.ts`: `usePins()`, `refreshPins()`, `pinTarget(request, at?)`, `unpin(index)`, `move(from, to)`. Serializes `pins_apply` (each call uses the version of the last answer), applies §2's error rules, keeps the alert (§3.3) and the live-region text. Sends nothing for a no-op (`move` to its own place, a move past an end). |
| `PinnedSection.tsx` | R132: header, list, rows, grip, Unpin buttons, empty area, alert, file notice, live region; the row menu; ⌥⌘↑/↓ and ⇧F10 on rows; the drop zone of §3.5. Mounted in `Frame.tsx`'s `Sidebar` between the top group (and `Conflicts`) and the `Types` section-head. |
| `PinMenu.tsx` | `pinMenuEntry(request, pins)` → the `Pin to sidebar` / `Unpin from sidebar` `MenuEntry` (disabled with `pinned.notSaved`, `pinned.fixFile` or `pinned.newer`), used first in the note `More` menu (`types/ChangeTypeMenu.tsx`), the task card menu (`tasks/CardMenu.tsx`) and `Tag actions` (`tags/TagPage.tsx`); `PinContextMenu({ label, anchor, request, onOpen, extra? })` → `Open` + the entry (+ `extra` after a separator), used on Types entries (`Frame.tsx`), All tags rows (`tags/AllTagsPage.tsx`), Search result rows (`pages/SearchPage.tsx`) and type-page rows (`pages/TypePage.tsx`, its menu keeps `Move to trash`). Built on `shell/Menu.tsx`'s `PopupMenu`. |
| `drag.ts` | The pointer drag of R135 (the Kanban's `mousedown` + window `mousemove`/`mouseup` capture listeners, the 5 px rule, the click swallowed after a drag): `pinDragSource({ request, label, icon, color } \| null)` → `{ onMouseDown, onDragStart, draggable: false }` for drag-in sources (null: not a source, nothing happens); `startRowDrag(index)` for rows; Esc (window `keydown` capture, propagation stopped) cancels; the drop zone is found with `elementFromPoint(…).closest('[data-pinned-drop]')`. |
| `DragLayer.tsx` | The lifted row (`data-pin-lifted`) or the drag-in chip (`data-pin-drag-chip`: the target's icon and label and the badge `pinned.badge`), drawn in a portal, `aria-hidden`. |
| `editorDrag.ts` | The editor chips as sources (AP-1238 = D-1381): `chipPinRequest(el)` → `PinRequestDto \| null` for resolved link chips, `#tag` chips and embed headers (null for broken chips, tags without an occurrence, and any chip of a note in `.trash/`). `EditorPane.tsx`'s `onMouseDownCapture` calls `pinDragSource` for such a chip and prevents ProseMirror's own `mousedown` and `dragstart` handling for it, so no transaction, selection change or native drag happens (FR-HOM-02 AC-13); a press and release under 5 px stays a click (the chip's own click). Text selection starting outside a chip is unchanged. |

Drag sources (R135): Types entries (`Frame.tsx`), type-page rows (`TypePage.tsx`), Search result rows
(`SearchPage.tsx`), All tags rows (`AllTagsPage.tsx`), tag-page rows (`TagPage.tsx`), Backlinks entries
(`links/BacklinksPanel.tsx`), editor chips (`editorDrag.ts`) and the Kanban card's title link (`tasks/TaskCard.tsx`:
`pinDragSource` on the title link only; the card keeps its status drag elsewhere). Not sources: the sidebar `Tags`,
`Inbox`, `Today`, `Tasks`, `Search` and `Trash` entries.

### 3.2 The section's DOM (R132, R133)

| Part | Element | Attributes |
| --- | --- | --- |
| Section | `div.sidebar-pinned` | `data-pinned-drop` (the drop zone), `data-drop-over` while a drag is over it |
| Header | `button` | `aria-label` `pinned.section`, `aria-expanded`, `aria-controls` the list, `aria-description` `pinned.countA11y` (none at 0), `data-command="sidebar.pinned.toggle"`; visible `Pinned` (CSS upper case), chevron, count in `--faint` (≥ 1 row) |
| List | `ul` | `aria-label` `pinned.section`; absent when collapsed or with 0 rows |
| Row | `li` > `a href="#"` | `data-pinned-row="<index>"`, `data-pin-state="<state>"`, `data-command="sidebar.pinned.open"`, `aria-current="page"` when shown, `title` = label, and for an object label + `\n` + its path (the stored path when not ok), `aria-description` = R133's kind description, then `, ` and the state description when not ok (an object row that is `pending` or `missing` has the state description only); a `span.sr-only` repeats the description for the macOS tree (the Inbox entry's way, R62) |
| Grip | `span.pin-grip` | `aria-hidden="true"`, `title` `pinned.grip` |
| Unpin | `button` | `aria-label` `pinned.unpinNamed`, `title` `pinned.unpin`, `data-command="sidebar.unpin"`; after its row's link in the Tab order |
| Empty area | `div.pinned-empty` | no role, not focusable; `pinned.empty` with `{path}` = `pinned.emptyPath` in `--text`, weight 600 |
| Drop line | `div` | `data-pin-drop-line="<k>"` (the 0-based final position), `aria-hidden` |
| Placeholder | `li` | `data-pin-placeholder`, `aria-hidden` |
| Alert | `div` | `role="alert"`; the missing text with a `button` `pinned.unpin`, `pinned.changedOutside` or `pinned.saveFailed`; cleared by the next pin action or after 10 s |
| File notice | `p.pinned-notice` | `pinned.unreadableLine` / `pinned.unreadable`; nothing extra for `newer` |
| Live region | `div.sr-live` | `role="status"`, `aria-live="polite"`: `pinned.pinnedAnnounce`, `pinned.unpinnedAnnounce`, `pinned.moved`, once per action, never on load or reload |
| Row menu | `PopupMenu` | `label` `pinned.menu`: `Open` (`pinned.open`), `Unpin from sidebar` (`cmd.unpin`), separator, `Move up`, `Move down` (`aria-disabled` at the ends) |

Editing controls (menu entries, palette commands, drops) are `aria-disabled` with `pinned.fixFile` while the file is
unreadable or unpatchable, and with `pinned.newer` while it is newer (FR-HOM-02 AC-22, AC-23); a drag then shows no
highlight. Focus after an Unpin from a row: the next row's link, else the previous, else the header (AC-8).

### 3.3 Strings (R137)

Every R137 key in `app/ui/src/i18n/catalog.ts`, plurals per D-133 (`pinned.countA11y`). Removed with the `pinned`
route: `route.pinned`, `purpose.pinned`, `cmd.goto.pinned`. The header comment of a new file is file content, not a
catalog string.

### 3.4 Commands and shortcuts (R136; `shell/commands.ts`, `shell/registry.ts`)

| Id | Title key | Section | Shortcut | Listed |
| --- | --- | --- | --- | --- |
| `sidebar.pin` | `cmd.pin` | `edit` | — | `actions.pinStatus()` non-null and not pinned |
| `sidebar.unpin` | `cmd.unpin` | `edit` | — | `actions.pinStatus()` pinned |
| `sidebar.pinned.moveUp` | `pinned.moveUp` | `edit` | ⌥⌘↑ | while the focus (or the palette's opener) is a pinned row's link or Unpin button |
| `sidebar.pinned.moveDown` | `pinned.moveDown` | `edit` | ⌥⌘↓ | same |

`ShellActions` gains `pinStatus?: () => { pinned: boolean; disabled: string | null } | null` (non-null on
`note/<path>`, `daily/YYYY-MM-DD`, `tag/<key>`, `type/<type>`, `new/<type>`; `new/<type>` and a virtual daily note give
`{ pinned: false, disabled: t('pinned.notSaved') }`), `pinCurrent?()`, `unpinCurrent?()` and
`movePinned?(dir: -1 | 1)`. `SHORTCUTS` gains `⌥⌘↑` → `sidebar.pinned.moveUp`, `⌥⌘↓` → `sidebar.pinned.moveDown`; the
key handler runs them only with the focus on a pinned row and leaves the key alone otherwise. ⇧F10 is handled by each
row and source element (`keydown`, the Tasks convention, D-479). `ROUTES` loses `pinned`, so `Go to Pinned` goes and
`pinned` parses as an unknown route (FR-NAV-04 AC-10). `Frame.tsx`'s `BOTTOM` loses its `pinned` entry.

## 4. Machine-local state

`ui-state.json` (`UiStateDto`'s flattened `vaults` map, as v1-graph §5; no Rust change):

```ts
vaults[<vault path, NFC>].sidebar = { pinnedCollapsed?: boolean }   // missing → expanded (AP-1240 = D-1383)
```

One `ui_state_set` per header toggle; nothing else of the section is stored. ⌃⌘S doesn't touch it.

## 5. Fake core and test hooks

- `app/ui/test/fake-pins.ts`, installed by `installFakeCore`: `pins_get` and `pins_apply` over the fake's
  `.tegg/pinned.yml`, a TypeScript twin of §1.2's parser and patcher plus §1.3's resolution over the fake's files
  (frontmatter `id`, `.trash/` files, tag keys as `fake-tags.ts`, types as `fake-schema.ts`). Entry points:
  `pinsRead(text: string | null, utf8 = true): PinsRead` (state, `patchable`, listed items with targets and line
  ranges), `pinsPatch(text | null, edit: PinEditDto, utf8 = true)` → `{ text: string \| null; read: PinsRead } \|
  { error }` (`text: null` = nothing to write), `pinsJobPatch(text, patches)` → `string | null`, `pinsResolve(read,
  files, indexReady)` → `PinRowDto[]`, and `handle(cmd, args, files, invalid)` as `fake-presets.ts`. It is checked
  against the Rust module on every `tests/fixtures/pinned-files/` input and `expected/` output (the L4 and L1 tests read
  the same files).
- The fake's rename, type-move, folder-move, tag-rename and merge jobs (`fake-jobs.ts`, `fake-moves.ts`,
  `fake-tags.ts`) call `pinsJobPatch` as §1.6 says.
- Handle additions: `pinCalls()` (the `pins_apply` calls in order, each `{ op, base }`), `pinsFail(kind)` (the next
  `pins_apply` fails with `Io`, `Conflict`, `Gone`, … without writing), `pinsNotReady(on)` (while on, `pins_get`
  answers `indexReady: false` with §1.3's pending rule; turning it off emits `index:progress` `done`). Existing hooks
  cover the rest: `setFile('.tegg/pinned.yml', text | Uint8Array | null, { silent: true })` makes a base stale without
  `vault:changed` (FR-SYN-03 AC-26), `sameBytesTouch` makes an mtime-only change; `renameFile`, `trash`, `restore` move
  targets; `delayCommand('pins_get', ms)` holds an answer; `writes()` / `writesTo()` count `pinned.yml` writes as vault
  writes; `calls()` counts `pins_get`; `uiState()` exposes `vaults[…].sidebar`.
- L6 (`TEGG_TEST=1`): the helper process `app/e2e/helpers/external.ts` replaces, deletes, renames and copies
  `.tegg/pinned.yml` and target notes; `TEGG_TEST_HOLD=first-index:<ms>` holds the end of the vault's first index build
  for `<ms>` (FR-HOM-02 AC-20); the data-safety kill harness runs at L4 (D-1113's way) with alternating `move`s of
  Lisabon (FR-SYN-02 AC-9).

## 6. Test layout

| Layer | Files |
| --- | --- |
| L0 | The AR-03 check covers `pinned.rs` (unchanged rule; FR-STO-06 AC-2) |
| L1 | `app/test/pinned.ac.test.ts` (the TS twin against every `expected/` file, `model.ts`, the `yaml`-package parse of every expected and twin output for NFR-POR-01 AC-4), `app/test/pinned_registry.ac.test.ts` (FR-HOM-02 AC-7, FR-UX-03 AC-39, FR-NAV-04 AC-10 registry parts), `app/test/pinned_catalog.ac.test.ts` (NFR-OTH-02 AC-16) |
| L2 | `crates/tegg-core/tests/ac_pinned_props.rs` (FR-FMT-07 AC-28 patch invariants), a fast-check twin in `app/test/pinned_props.ac.test.ts` |
| L4 | `crates/tegg-core/tests/ac_pinned.rs` (read rules, resolution incl. `stale` and duplicate titles, every `expected/` file, `Conflict`, `Gone`, RENAME_EXCL, `NewerVersion`, unreadable files, NFC, atomic writes and the kill harness, no pin in the index, one index lock), `ac_pinned_perf.rs` (FR-HOM-02 AC-25 on `tools/gen-vault --seed 1 --small-images` with 200 pins; report-only until MS8, D-152), `crates/tegg-jobs/tests/ac_pinned_jobs.rs` (FR-LNK-03 AC-22, FR-HOM-02 AC-21's tag rename, AC-22's jobs skipping, undo; real `Core` host and `NodeTransformer`) |
| L5 | `app/webkit/pinned.ac.test.ts` (FR-HOM-02 AC-1…AC-9, AC-11, AC-14, AC-15, AC-19), `pinned_drag.ac.test.ts` (AC-10, AC-12, AC-13, FR-UX-08 AC-17), `pinned_targets.ac.test.ts` (AC-16…AC-18, AC-20, AC-21, FR-LNK-03 AC-22), `pinned_file.ac.test.ts` (AC-22…AC-26, FR-SYN-03 AC-26, AC-27, FR-SYN-06 AC-43, FR-FMT-12 AC-8), `pinned_a11y.ac.test.ts` (FR-UX-03 AC-39, AC-40, FR-UX-08 AC-16, FR-UX-05 AC-19, NFR-OTH-02 AC-16, FR-NAV-04 AC-9, AC-10); helpers `app/webkit/pinned-helpers.ts` |
| L6 | `app/e2e/pinned.ac.test.ts` (every AC whose layer names L6: FR-HOM-02 AC-1, AC-5, AC-10, AC-13, AC-15 relaunch, AC-18, AC-20, AC-22; FR-SYN-03 AC-27; FR-SYN-06 AC-43; FR-UX-08 AC-16; FR-NAV-04 AC-9), in the red-test commit (D-382); keys only to Tegg (D-799) |
| manual | FR-HOM-02 AC-27 (`qa/manual/`) |

- **Fixtures** (own commit before the tests, byte-exact, D-50): `tests/fixtures/vaults/pinned/` (with
  `tests/fixtures/vaults/new-empty/.tegg/` copied in and **no** `.tegg/pinned.yml`; the NFD file name of Čajovna) and
  `tests/fixtures/pinned-files/` (`valid`, `unknown-keys` + `-crlf` + `-no-newline`, `entries`, `stale`, `nfd`,
  `invalid-yaml`, `newer-version`, `expected/*.yml`), each with a README mapping files to criteria.
  `expected/stale-after-rename-bez-hlavicky.yml` holds the placeholder `<ID>` for the id the note gets; the tests put
  the real id in before comparing.
- **No new `qa.config.json` step**: the tests live in packages that already have steps.
- **AC-Test-Change** (D-1390) with `AC-Test-Change: slice PIN builds the Pinned section (FR-HOM-02); approved-by:
  owner`: the files the ACs list (`app/e2e/ms6_v068.ac.test.ts`, `app/e2e/ms3_shell.ac.test.ts`,
  `app/webkit/sidebar_5b.ac.test.ts`, `sidebar_6a.ac.test.ts`, `sidebar_v068.ac.test.ts`, `layout.ac.test.ts`,
  `keyboard.ac.test.ts`, `vault.ac.test.ts`, `app/test/registry.ac.test.ts`, `registry_5b.ac.test.ts`,
  `shell-tables.ts`).

## 7. Open point for the owner

1. **The Types entry's context menu name.** R134 names it `<Type> actions`, but R137 has no key for it and
   NFR-OTH-02 AC-16 says the slice adds exactly R137's keys. Proposal: add `typeEntry.menu` `{name} actions` (the
   type's Name, `Schůzka actions`) to R137, or name the menu with the existing `typePage.rowMenu` (`Object actions`).
   Until decided, the build uses the proposal.

## 8. Contract choices (no owner decision needed)

1. One `pins_apply` command with an op enum, not three commands: one place for the base check and the patcher (v1-graph §16.8 1).
2. Ops address listed pins by their 0-based index from the read the base names; the base check makes the index unambiguous.
3. Positions in IPC are 0-based final indexes (`at`, `to`); R131's "position k" is k − 1, and `null` is the end.
4. A `pin` of an already listed target moves it (D-1379 in the core too, not only in the UI's drop).
5. The core reads a pinned object's `id` from its file, not the index, so a pin while the index loads is right.
6. A Tag object pinned as an object is stored as its tag (D-1382), in the core.
7. Flow items (`- {tag: účty}`) are patchable; flow sequences and multi-document files are listed but never written (`Unreadable`), as D-1122.
8. Every write is parsed back first and refused with `Unreadable` if it wouldn't list exactly the expected pins (D-1129).
9. No pins cache in the core; the UI re-reads on every `vault:changed` (debounced 300 ms) and on `index:progress` `done`, not on a new event.
10. Pending uses the core's existing first-build flag (`graph_ready`); `PinsDto.indexReady` tells the UI to re-read.
11. Rows carry data only; labels, icons, colours and descriptions come from the UI's type entries and tag store, so a recolour or new plural shows without a pins write (AC-2, AC-21).
12. The job patch goes through a new `Host::patch_pins`, written last in the job, as a normal undo, journal and report row; a conflict there is a skip, never a job failure.
13. A job patch adds `- id:` to a path-only item when the moved object has one, never touches an `id`-only item, and rewrites a renamed tag even if the new key is already pinned (the later item is then skipped by the read rules and kept).
14. The tooltip is the label, then a newline and the path for objects.
15. Row `aria-description` joins the kind and state descriptions with `, `; a `span.sr-only` repeats it for the macOS tree.
16. `data-command` ids for the section's controls: `sidebar.pinned.toggle`, `sidebar.pinned.open`, `sidebar.unpin`.
17. ⌥⌘↑/↓ are registered commands with shortcuts, listed and run only while a pinned row (or the palette's opener) has the focus; elsewhere the key is left alone.
18. Drag-in uses pointer events (the Kanban's way), not HTML5 drag and drop, so Tauri's file-drop handling isn't involved.
19. NFR-POR-01 AC-4's `yaml`-package parse runs in the L1 test over the expected files and the twin's outputs; the L4 test checks the core writes exactly the expected bytes.
20. `TEGG_TEST_HOLD=first-index:<ms>` is the L6 hook that makes the pending state observable.
21. The L4 kill harness follows D-1113 (re-running the test binary), no L6 harness mode.
