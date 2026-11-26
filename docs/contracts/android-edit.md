# Contract: Editing and creating on the phone (slice AND-3)

**Status: accepted, 2026-11-25** (owner: "Accept all proposals"; CP-1…CP-14 → D-2527…D-2540, AC fixes D-2541, BRD v1.322; written 2026-11-25 under D-2526, before the owner's checks OC-2 and OC-3; §21 lists
what depends on them).

Public interfaces of slice AND-3, for the test author (D-61) and the build. ACs: `docs/acceptance/android-edit.md`
(approved; RA14…RA19; FR-EDT-01 AC-15…AC-20, FR-UX-04 AC-8…AC-11, FR-EDT-02 AC-27, FR-EDT-03 AC-6, FR-EDT-04 AC-5, FR-EDT-05
AC-8, AC-9, FR-EDT-06 AC-12…AC-14, FR-EDT-15 AC-7, FR-EDT-09 AC-7, FR-EDT-14 AC-8, FR-EDT-08 AC-15…AC-18, FR-EDT-07
AC-24…AC-26, FR-EDT-10 AC-12, FR-FMT-07 AC-38, AC-39, FR-FMT-12 AC-18, FR-FMT-08 AC-11, FR-SYN-02 AC-16, AC-17, FR-SYN-03
AC-40…AC-44, FR-SYN-04 AC-14…AC-16, FR-SYN-06 AC-56, AC-57, FR-VLT-05 AC-16, AC-17, FR-NAV-01 AC-25, FR-LNK-04 AC-14,
FR-DLY-02 AC-11, FR-TSK-02 AC-14, FR-TSK-11 AC-5, FR-INB-02 AC-18, FR-HOM-02 AC-33, FR-HIS-01 AC-16, FR-MMP-02 AC-37, FR-UX-03
AC-60, AR-03 AC-15, FR-UX-08 AC-30, FR-UX-05 AC-29, NFR-OTH-02 AC-27, AR-08 AC-7, NFR-PERF-06 AC-8, NFR-PERF-05 AC-7, NFR-SEC-01
AC-5, FR-UX-01 AC-10). Decisions: D-2000…D-2012 (plan `docs/plans/android-mvp-plan.md`), D-2500…D-2525 (the ACs'
AP-2065…AP-2090, in order), D-2526. Builds on [android-shell.md](android-shell.md) (AND-1: RA2, the plugin, `test-env.json`,
the LA harness, the create and NFD rules of §3.2) and [android-phone.md](android-phone.md) (AND-2: the phone frame,
`isPhone()`, the bridge, the registry, the harnesses; "AND-2 §n" below). The phone editor reuses
[ms3-shell.md](ms3-shell.md) §13 (editor, autosave, merge), [ms5-capture.md](ms5-capture.md) (the type picker, drafts),
[v1-search.md](v1-search.md) §9 (create buttons), [ms5-tasks.md](ms5-tasks.md), [v1-pinned.md](v1-pinned.md),
[ms4-links.md](ms4-links.md) (the Create offer), [ms4-daily.md](ms4-daily.md) (virtual days) and
[mm-mindmap.md](mm-mindmap.md).

The desktop does not change (AR-03 AC-15): every item below is Android-only, chosen by `isPhone()` (AND-2 §4.1), an
editor option the desktop doesn't pass, or a pure function both platforms share with unchanged desktop results. The one
shared DTO change (`NoteDto.nfdName`, §2.3) is always `false` on macOS. Every write goes through the desktop's write
paths: atomic, minimal, base-checked or exclusive (RA17, §2.4); the editor's round trip is the desktop's (FR-FMT-07).
§22 lists the points for the owner (CP-1…CP-14); §23 holds readings of the ACs, not decisions.

## 1. Files

| Path | Owns |
| --- | --- |
| `app/ui/src/pages/NotePage.tsx` | the note route on the phone: mode, title, save state, focus, banners (§7) |
| `app/ui/src/phone/FormatBar.tsx` | RA15: the `toolbar` `Formatting` and its `Block type` row (§8) |
| `app/ui/src/phone/caret.ts` | `caretBand`, `caretScroll`, `keepCaretInView` (§4.2, §9.3) |
| `app/ui/src/phone/press.ts` | `contextmenuAllowed` (§4.3); used by `PhoneFrame`'s `contextmenu` rule |
| `app/ui/src/phone/MergeBanner.tsx` | the `alert` `Changed outside Tegg`, the recovered banner, `Compare versions` (§10.6) |
| `app/ui/src/phone/recovery.ts` | `recoveryKey`, `keepForRecovery`, `takeRecovery` (§4.5, §11.2) |
| `app/ui/src/phone/PhoneProperties.tsx` | the `Properties` sheet with controls (moves out of `read/PropertiesStrip.tsx`, §10.5) |
| `app/ui/src/phone/ConflictResolve.tsx` | `Keep this version`, the confirmation, `Merge versions` (§10.8) |
| `app/ui/src/phone/commands.ts` | the lists of §13 |
| `app/ui/src/phone/routes.ts` | `PHONE_NOT_OFFERED` loses `new/<type>` (§13.1) |
| `app/ui/src/phone/contentCommands.ts` | `PAGE_COMMAND_PREFIXES` gains §13.3's prefixes |
| `app/ui/src/phone/back.ts` | `systemBack()` gains the merge banner's step (§10.6) |
| `app/ui/src/edit/EditorPane.tsx` | the phone's panels docked above the keyboard, the hidden parts, input handling (§9, §10.1) |
| `app/ui/src/edit/autosave.ts` | `Saver.flush({ composing })` (§11.1) |
| `app/ui/src/edit/phoneInput.ts` | `installPhoneInput(ed)` (§9.1) |
| `packages/editor/src/format.ts` | `formatState` (§4.1) |
| `packages/editor/src/editor.ts` | new `TeggEditor.commands` and `EditorOptions.protectMindmaps` (§5) |
| `app/src-tauri/src/commands.rs` | `ANDROID` gains `trash_restore` and §2.2's commands; `ANDROID_ONLY` gains §2.2's (§2.1) |
| `app/src-tauri/src/shell6a.rs` | `trash_restore` loses `#[cfg(desktop)]` |
| `app/src-tauri/src/mobile.rs` | `android_recovery_put`, `android_recovery_get`, `android_recovery_drop`, `android_ime` (§2.2) |
| `app/src-tauri/src/dto.rs` | `NoteDto.nfdName` (§2.3) |
| `app/ui/src/ipc/android.ts` | `ANDROID_EXCLUDED` loses `trash_restore`; `ANDROID_HIDDEN_COMMANDS` loses `trash.restore` only if listed nowhere else (§2.1) |
| `app/ui/src/ipc/client.ts` | `ipc.androidRecoveryPut`, `…Get`, `…Drop`, `ipc.androidIme` |
| `app/ui/test/phone-writes.ts` | `READ_COMMANDS` gains §2.2's four commands (§2.5) |
| `app/src-tauri/tegg-android/` (Kotlin `TeggStoragePlugin`) | `ime(show)`, the renderer's death (§6) |
| `crates/tegg-vault/src/local.rs`, `lib.rs` | the create check's test seam (§3.2) |
| `app/scripts/release.mjs`, `release-plan.mjs` | the APK by default, `parseReleaseArgs`, `githubRelease` (§16.1) |
| `tools/android/test-ime/` | the test input method (Kotlin, emulator only, D-2519; §16.2) |
| `tools/android/test-ime.sh` | builds and installs it (§16.2) |
| `tools/qa/src/apk-check.ts` | the "no test IME in a product APK" rule (§16.3) |
| `app/webkit/phone-helpers.ts`, `app/webkit/phone-ime.ts` | the L5p harness and `ime(page, steps)` (§17.1) |
| `app/e2e-android/helpers/ime.ts`, `helpers/phone.ts` | the LA harness for the test IME, the renderer and recovery (§17.2) |
| `tests/fixtures/vaults/phone-edit/` | the overlay (§18) |

## 2. Commands

### 2.1 The lists (AR-03 AC-15, AC-9; RA2; D-2514)

- `ANDROID_ONLY` becomes AND-2's six plus `android_recovery_put`, `android_recovery_get`, `android_recovery_drop`,
  `android_ime` (in that order).
- `ANDROID` is AND-2's list with `trash_restore` inserted after `object_trash` (source order of `DESKTOP`), ending with the
  ten `ANDROID_ONLY` commands.
- RA2 group O loses `trash_restore`; `ANDROID_EXCLUDED` (`app/ui/src/ipc/android.ts`) loses it too. `trash_delete` and
  `trash_empty` stay excluded. `ANDROID_HIDDEN_COMMANDS` keeps `trash.restore` and `trash.delete` (the Trash page's
  commands; the phone has no Trash page).
- `shell6a.rs`'s `trash_restore` is compiled on every target; `build.rs`, the Android `generate_handler!` and
  `capabilities/android.json` list it and §2.2's commands.

AR-03 AC-9's two tests (`app/src-tauri/tests/ac_android_commands.rs`, `app/test/android_platform.ac.test.ts`) change under
`AC-Test-Change` (§20).

### 2.2 New Android-only commands

`Result<T, IpcError>`, camelCase DTOs (`ts-rs`).

| Command | Arguments | Returns |
| --- | --- | --- |
| `android_recovery_put` | `{ copy: RecoveryDto }` | `()`. Writes `<files_dir>/recovery/<key>.json` (§11.2) with `write_local_file` (temp file and rename in that folder). Never touches the vault. Refuses with kind `NoVault` when no vault is open |
| `android_recovery_get` | `{ path: string }` | `RecoveryDto \| null`: the copy for the open vault and that NFC path |
| `android_recovery_drop` | `{ path: string }` | `()`: removes that copy; a missing one is fine |
| `android_ime` | `{ show: boolean }` | `()`. The plugin's `ime(show)` (§6.1): `InputMethodManager.showSoftInput(webView, 0)` / `hideSoftInputFromWindow` on the UI thread (CP-5) |

```ts
type RecoveryDto = { vault: string; path: string; id: string | null; title: string; text: string; base: VersionDto | null; savedAt: string };
```

`vault` is the open vault's on-disk root; `path` vault-relative NFC; `base` the version the editor's text was based on
(`null` for a file that was gone); `savedAt` an ISO 8601 date-time with offset (FR-FMT-11). Client calls:
`ipc.androidRecoveryPut(copy)`, `ipc.androidRecoveryGet(path)`, `ipc.androidRecoveryDrop(path)`, `ipc.androidIme(show)`.

### 2.3 Changed commands

- **`note_read`**: `NoteDto` gains `nfdName: boolean`: true exactly when the core reached the file through an on-disk name
  whose bytes differ from its NFC form (android-shell §3.2's `OnDiskName::Found` with other bytes). Always `false` on
  macOS and for ASCII paths, so desktop results are unchanged apart from the field (CP-7). `embed_load`'s `EmbedNoteDto`
  gains the same field, so an embedded task's checkbox can stay disabled (FR-FMT-12 AC-18).
- **Writes to an NFD-named file** keep android-shell §3.2's refusal (D-2048, D-2512): the core fails with
  `PermissionDenied`, mapped to the `IpcError` kind `ReadOnlyName` (new; the desktop never produces it). The UI never
  sends such a write (§7.1); the refusal is the backstop for the L4 part of FR-FMT-12 AC-18.
- **`trash_restore`**: unchanged behaviour; on the phone it is called only with the `to` path `object_trash` returned for
  the note just moved (§12.6).
- No other command changes. `note_create`, `note_create_exact`, `link_create` and `daily_create` keep their arguments and
  their create rule (§3.2).

### 2.4 The write list (RA17)

Every row is the desktop's code path; the phone adds no write command. "Base" is the version the view was loaded with
(or the last version this page wrote); "excl." is an exclusive create (§3.2). The refusal column is FR-SYN-03 AC-42's
"that surface's desktop alert".

| # | Action | Client path | Commands, in order | Base | On `Conflict` |
| --- | --- | --- | --- | --- | --- |
| 1 | Autosave | `Saver` (`edit/autosave.ts`) | `note_write(path, text, base)` | base | the merge banner (§10.6) |
| 2 | A property value | `AttributePanel`'s `onCommit` → `ed.applyFrontmatter` → `Saver` | `note_write` | base | the merge banner (CP-2) |
| 3 | A checklist item | editor transaction → `Saver` | `note_write` | base | the merge banner |
| 4 | A task checkbox | `writeTask(row, defs, 'complete' \| 'reopen', 'row')` (`tasks/write.ts`) | `note_write(task, text, rowVersion)` | row | `task.changedOutside` alert, the view reloads |
| 5 | `Reviewed` | Inbox row: `changeItem(path, base, { review })` (`inbox/actions.ts`); strip: the note's `setReviewed` → `Saver` | `note_write` | base | `inbox.changedOutside`; on the note, the merge banner |
| 6 | A draft's first write | `Saver.create` → App's `onCreate` (`new/<type>`) | `note_create(type, title, text)`, then `note_read(path)` | excl. | — (a taken name gets ` (2)`) |
| 7 | `Create “<q>”` | `Search`'s `createDefault` / `as…` | `note_create`, `note_read` | excl. | — |
| 8 | `[[`, `@`, relation create | `createObject` (`types/create.ts`), then the editor's insert → `Saver` | `note_create`; then `note_write` of the edited note | excl.; base | the merge banner for the note |
| 9 | The Create offer | `CreateLinkOffer` | `link_create_plan`, `link_create(from, target, expect, text, asType?)` (it writes the source's rewrite itself, ms4-links) | excl.; `expect` | ms4-links' re-check (FR-LNK-04 AC-11) |
| 10 | Today's first keystroke | `Saver.create` → `daily.virtual.onCreate` | `daily_create(date, text)` | excl. | — (D-326: ` (2)`) |
| 11 | `Keep mine` / `Keep both` | NotePage `keepMine` / `keepBoth` | `note_write(path, mine, theirsVersion)` / `note_create_exact(<stem> (conflict <stamp>).md, mine)` | disk version; excl. | the banner again |
| 12 | `Restore file` | NotePage `restore` | `note_create_exact(path, text)` | excl. | `NameTaken` → the merge banner (FR-SYN-03 AC-43) |
| 13 | Resolve a pair | `ConflictResolve` (§10.8) | keep primary: `note_trash(copy, copyV)`; keep copy: `note_write(primary, copyText, primaryV)`, `note_trash(copy, copyV)`; new id: `note_write(copy, …, copyV)`; merge: `note_write(kept, draft, keptV)`, `note_trash(other, otherV)` | both versions | the row reloads (editor FR-SYN-04 AC-11) |
| 14 | `Pin` / `Unpin` | App's `pinCurrent` / `unpinCurrent` | `pins_apply(base, op)` | `pinned.yml`'s version | `pinned.changedOutside`, the section reloads |
| 15 | `Move to trash`, `Undo` | `moveToTrash` (`trash/moveToTrash.ts`) after `flush()` | `object_trash(path, base)`; `Undo`: `trash_restore(to)` | base | `trash.conflict` (CP-1) |

Never sent by a phone surface (FR-SYN-06 AC-57): `note_rename`, `type_move`, `type_move_plan`, `folder_move_preview`,
`tidy_now`, `merge_start`, `tag_rename`, `tag_delete`, `inbox_bulk`, `type_patch`, `vault_settings_patch`, `media_add`,
`media_add_paths`, `trash_delete`, `trash_empty`, every `query_*` write and every `job_*` command. `media_add` and
`media_add_paths` stay registered on Android (RA2 didn't exclude them); the phone never calls them (D-2518).

### 2.5 Write and read classification (AND-2 §2.3)

`WRITE_COMMANDS` is unchanged. `READ_COMMANDS` gains `android_recovery_put`, `android_recovery_get`,
`android_recovery_drop`, `android_ime` (private storage and the keyboard: allowed writers, like `ui_state_set`). AR-03
AC-13's L1 check (the two lists cover `DESKTOP ∪ ANDROID_ONLY`, disjoint) runs on the new lists.

## 3. Core and vault

### 3.1 NFD names (FR-FMT-12 AC-18; D-2048, D-2512)

`Core::read_note` reports `nfd_name` from `LocalFs`'s resolution (android-shell §3.2); `note_read` and `embed_load` pass
it as `nfdName`. The write refusal of android-shell §3.2 stays; `Core::write_note`, `trash_object`, `trash_note`,
`create_exact` onto that name and the task and inbox writes all reach it. The L4 test
`crates/tegg-vault/tests/ac_android_names.rs` (`fr_fmt_12_ac18_nfd_named_note_read_only_on_the_phone`) checks the refusal
for `write`, `rename_no_replace` and `trash` on a stored NFD name and `OnDiskName::Found` with other bytes (the field).
List rows learn it from the core too (D-2554): `inbox_list`'s rows and the task rows (`index_type_rows`, `task_list`) carry
`readOnly: true` for a file whose on-disk name has other bytes than its NFC form (always `false` on macOS), so the phone
disables their checkboxes with the read-only reason instead of sending a write the core refuses.
`pins_apply` writes `.tegg/pinned.yml` only, so `Pin` works on such a note.

### 3.2 Creates on shared storage (FR-SYN-02 AC-17; D-2047, D-2513)

The create rule is AND-1's, now decided for good: `LocalFs::create_new` writes the temp file in the target folder and
`sync_all`s it (`write_temp`), then `rename_no_clobber`; off macOS `no_clobber_via` tries a hard link and, on `ENOSYS`,
`EACCES`, `EPERM`, `EOPNOTSUPP` or `EXDEV`, checks the target and renames. The check is made name-blind:

```rust
/// True when `listing` (one folder's entry names as on disk) holds `name` under NFC and Unicode lower case.
pub fn name_taken(listing: &[String], name: &str) -> bool          // crates/tegg-vault/src/local.rs, re-exported
#[doc(hidden)] pub mod testing { pub use crate::local::no_clobber_via; }   // crates/tegg-vault/src/lib.rs
```

`no_clobber_via(from, to, primitive)` checks `symlink_metadata(to)` and then `name_taken(<to's folder listing>, <to's
name>)` before the rename; either gives `AlreadyExists`. `Vault::create_file` already retries the next ` (n)` name on
`AlreadyExists`, so a name taken during a draft's first write becomes `Nákup (2).md`. No placeholder file is made
(D-2513). The L4 test is `crates/tegg-vault/tests/ac_android_create.rs` (`fr_syn_02_ac17_create_never_replaces_a_file`): it
calls `testing::no_clobber_via` with a primitive that fails `ENOSYS`, on a target that exists, on one that exists in
another case or normalization (`nákup.md` in NFD for `Nákup.md`), and on a free one, and checks that only the free one is
renamed and every existing file keeps its bytes, inode and mtime.

### 3.3 No bulk job, no move (FR-SYN-06 AC-57; D-2025, D-2517)

Unchanged from android-shell §3.3: the Android core is opened with `OpenExtras { bulk_jobs: false }`. No phone write
moves a file: a save never calls `type_move`, and `note_write` writes at the note's path whatever its type's folder.

### 3.4 Sync-app copy names (FR-SYN-04 AC-16; D-2501)

`copy_bases` (`crates/tegg-index/src/lib.rs`) keeps Dropbox's, Google Drive's `Name (1)` and iCloud's patterns. OC-3's
recorded name is added there as one more pattern, for every platform, still only as a hint next to the same `id` or
90 % equal lines (§21). The L4 test `crates/tegg-index/tests/ac_android_copies.rs`
(`fr_syn_04_ac16_sync_app_copies_are_found`) uses `Plán (1).md` until then.

## 4. Pure functions (L1, Vitest in Node)

### 4.1 `formatState` (RA15; FR-EDT-02 AC-27, FR-EDT-05 AC-8, FR-EDT-09 AC-7)

```ts
// packages/editor/src/format.ts, exported from @tegg/editor
export type FormatState = {
  block: 'paragraph' | 'heading' | 'bulletList' | 'orderedList' | 'checklist' | 'other';
  level: 1 | 2 | 3 | 4 | 5 | 6 | null;           // heading level
  bold: boolean; italic: boolean;                 // the mark at the selection, or stored for the next typed text
  link: boolean;                                  // the caret or selection is inside a link or chip
  canIndent: boolean; canOutdent: boolean;        // sinkListItem / liftListItem would apply
  canUndo: boolean; canRedo: boolean;             // prosemirror-history undoDepth / redoDepth > 0
  editable: boolean;                              // the caret's block is editable (not a source block, map or query)
};
export function formatState(state: import('@tiptap/pm/state').EditorState): FormatState;
```

`block` is the innermost list item's list (`- [ ] ` is `checklist`) or the caret's text block; `other` for quotes,
callouts and code blocks. `canIndent` is false outside list items and on a list's first item; `canOutdent` false outside
list items. The bar renders from it on every transaction (§8).

### 4.2 The caret band (FR-UX-04 AC-9)

```ts
// app/ui/src/phone/caret.ts
export type Band = { top: number; bottom: number };          // viewport px
export function caretBand(appBarBottom: number, coverTop: number): Band;   // { top: appBarBottom, bottom: coverTop − 8 }
export function caretScroll(caret: { top: number; bottom: number }, band: Band, scrollTop: number, maxScroll: number): number;
```

`coverTop` is the top of whatever covers the bottom of `main`: the bar, a docked panel, else the viewport's bottom.
`caretScroll` returns `scrollTop` unchanged when the caret lies inside the band, else the smallest change that brings it
inside (clamped to `0…maxScroll`).

### 4.3 Long press (FR-EDT-01 AC-17; D-2506)

```ts
// app/ui/src/phone/press.ts
export function contextmenuAllowed(target: Element | null): boolean;
```

True when `target` is inside an element with `contenteditable="true"` (the `Note body`, a draft's `Title`) or is an
`input` or `textarea`, and not inside `.chip`, `.tag`, `.tag-chip`, `[data-wikilink]`, `a`, `[role="link"]`,
`[role="button"]`, `[contenteditable="false"]` or a `.checklist-item .check`. `PhoneFrame`'s `contextmenu` listener
prevents the event unless `contextmenuAllowed(e.target)`; AND-2 §8.5's `-webkit-touch-callout: none` and
`user-select: none` stay on links, chips, rows, cards and buttons and are removed from the body's text.

### 4.4 The slash list on the phone (FR-EDT-03 AC-6; D-2505)

```ts
export const PHONE_SLASH: readonly string[] = ['text', 'heading1', 'heading2', 'heading3', 'bulletList', 'orderedList', 'checklist', 'quote', 'callout', 'codeBlock', 'divider'];
export function phoneSlashItems<T extends { id: string }>(items: readonly T[]): T[];   // app/ui/src/phone/commands.ts
```

`phoneSlashItems(SLASH_ITEMS)` keeps `PHONE_SLASH`'s ids in `SLASH_ITEMS`' order; `table`, `mindmap`, `query`, embeds,
media, `task` and `turnInto*` are dropped.

### 4.5 The recovery key (FR-EDT-08 AC-17; D-2511)

```ts
export function recoveryKey(vault: string, path: string): string;   // app/ui/src/phone/recovery.ts
```

```rust
pub fn recovery_key(vault: &str, path: &str) -> String              // app/src-tauri/src/phone.rs, every target
```

Lower-case hex SHA-256 of `vault + "\u{0}" + NFC(path)`. Both have the same table test.

### 4.6 The release arguments (AR-08 AC-7; D-2522)

```js
// app/scripts/release-plan.mjs
export function parseReleaseArgs(argv)   // → { version, apk } or { usage: true }
export function githubRelease({ version, sha, outputs })   // → { cmd: 'gh', args: [...] } (CP-11)
```

`parseReleaseArgs(['0.8.0'])` → `{ version: '0.8.0', apk: true }`; with `--no-apk` → `apk: false`; `--apk` is accepted and
changes nothing; an unknown flag, no version or two versions → `{ usage: true }` (exit 2). `githubRelease` returns
`['release', 'create', 'v<v>', '--target', <sha>, '--title', 'Tegg <v>', ...outputs]`, `outputs` being `releasePlan`'s
(DMG, zip, then the APK when built); a short `sha` throws.

## 5. The editor package (`@tegg/editor`)

### 5.1 New commands (RA15; FR-EDT-02 AC-27)

`TeggEditor.commands` gains, each one undo step, each `false` without effect:

```ts
setBlock(kind: 'paragraph' | 'heading', level?: 1 | 2 | 3): boolean;   // the caret's text block; R6's written forms
toggleBulletList(): boolean;     // a paragraph → `- ` item; a bulleted item → paragraph
toggleChecklistBlock(): boolean; // a paragraph → `- [ ] ` item; a checklist item → paragraph (never a Task, FR-TSK-11)
indent(): boolean;               // editor FR-EDT-02 AC-17's Tab
outdent(): boolean;              // ⇧Tab
insertTrigger(t: '[[' | '#'): boolean;   // inserts the text as typed text would (a space before `#` after a non-space), so the suggestion plugins open
```

`toggleMark('bold' | 'italic')`, `undo()`, `redo()`, `setUrlLink`, `removeLink`, `insertLink`, `pasteText`, `pasteHtml`
are the existing ones. `toggleChecklist()` (the existing toggle of a checklist item's state) is unchanged.

### 5.2 `EditorOptions.protectMindmaps` (FR-MMP-02 AC-37; D-2516)

`protectMindmaps?: boolean` (default `false`; only the phone passes `true`). With it, a mindmap callout block is a
protected range: its node view has `contenteditable="false"` in both `Map` and `List`, its list items' checkboxes don't
toggle, and a `filterTransaction` plus `appendTransaction` pair narrows every user step to the text outside protected
ranges: a deletion or replacement that covers part or all of the block removes only the selected text of the blocks
around it and keeps the callout's lines; Backspace at the start of the next block moves the caret before the block
without joining; the bar's block commands with the caret beside the block change only the caret's block. Loads, undo,
redo and `reload()` are never filtered. The L1 test is in `packages/editor/test/protect.ac.test.ts`
(`fr_mmp_02_ac37_…` with the rule cases).

### 5.3 The latency probe (NFR-PERF-06 AC-8)

The editor host's probe (`EditorPane`) also starts a measurement on `beforeinput` with `inputType` `insertText` or
`insertCompositionText` (one per event), besides its `keydown` rule, so keyboards that send `keydown` 229 are measured.
It writes `perf_mark('key', frame, ms)` as on the desktop (enabled by `__TEGG_TEST_MODE__`, set on the test APK by
`TEGG_TEST=1`).

## 6. The plugin `tauri-plugin-tegg-android`

### 6.1 `ime(show)` (CP-5)

`TeggStoragePlugin` gains `@Command fun ime(invoke)` with `{ show: Boolean }`: on the UI thread `webView.requestFocus()`
then `InputMethodManager.showSoftInput(webView, 0)`, or `hideSoftInputFromWindow(webView.windowToken, 0)`. The Rust side
`TeggAndroid` gains `ime(show)`; `android_ime` calls it.

### 6.2 The renderer's death (FR-EDT-08 AC-18; D-2521; CP-3)

In `load`, the plugin replaces wry's `WebViewClient` (`webView.webViewClient`, API 26+) with
`TeggWebViewClient(inner)`, which forwards `shouldInterceptRequest`, `shouldOverrideUrlLoading`, `onPageStarted`,
`onPageFinished` and `onReceivedError` (the methods wry's `RustWebViewClient` overrides) to `inner` and overrides
`onRenderProcessGone(view, detail)`: it logs `tegg: renderer gone (crash=<detail.didCrash()>)`, removes and destroys the
dead `WebView`, calls `activity.recreate()` and returns `true` (the process and the Rust core stay; the vault stays
open). The new page starts as on a resume: `vault_start` answers `open`, and the landing is the desktop's (D-2421): the
last opened note. Text typed after the last autosave (at most 1 s, `MAX_WAIT_MS`) is lost; a `note_write` already in
the core completes. Written only to the log; no `test-env.json` key.

### 6.3 Unchanged

Insets, the keyboard push, Back, night mode, the font size and `openUrl` (AND-2 §5). The keyboard push's
`keyboard: true` drives the bar (§8).

## 7. The note on the phone (RA14)

### 7.1 Mode (FR-EDT-01 AC-15, FR-EDT-10 AC-12; D-2415, D-2512)

On the phone `NotePage` no longer forces `readView`. The mode is the desktop's rule plus one reason:

| Mode | When | Reason shown |
| --- | --- | --- |
| `utf8`, `invalidFrontmatter`, `editorFailed` | as on the desktop (editor.md NFR-REL-03 AC-6…AC-8) | the desktop's alert |
| `readView` | a path under `.trash/`; `nfdName` (new) | `alert` `phone.nfdReadOnly` for `nfdName`; the trash banner otherwise |
| `edit` | every other note, the draft (`new/<type>`), the virtual day | — |

In every read-only mode `Save state` is `Read-only`, the body is the read view (no `contenteditable`, no keyboard), and
each write control (checkboxes, `Reviewed`, the sheet's controls, `Move to trash`, the Create offer's rewrite case) is
`aria-disabled="true"` with `aria-description` = the reason (`phone.nfdReadOnly`, `readOnly.utf8`, …). `More actions`
lists `Properties` and `Show Markdown source` only, plus `Pin` / `Unpin` for `nfdName` (FR-FMT-12 AC-18). `editor_open`
and `editor_close` are sent as on the desktop.

### 7.2 Title (FR-EDT-01 AC-18; D-2503)

- **A file exists:** the title is the app bar's `h1` (AND-2's `PageHeading`), `tabIndex=-1`, `id` = the body's
  description id (§7.6), `aria-description` = `phone.title.fixed`; no `textbox` `Title`. A tap focuses nothing editable.
- **A draft (`new/<type>`):** the app bar's `h1` reads `cmd.newOfType` (`New <Name>`); `main` starts with the existing
  `TitleField` (`role="textbox"` `Title`, `contenteditable`, `enterkeyhint="next"`), then `p[role="status"]`
  `newObject.notSaved`, then the strip and the body. Typing writes nothing (D-522). Enter (`beforeinput`
  `insertParagraph`, or `keydown` Enter) or `Saver.flush` commits: `forceFirst`, one `note_create`; the route becomes
  `note/<path>` without remounting (App's `history.replace`); the caret moves to the start of the body (§7.5); the
  `TitleField` is replaced by the fixed `h1`. An empty title writes `Untitled` (D-523).
- No phone surface calls `note_rename` or writes `title:` to an existing file: on the phone `NotePage`'s title commit
  path (`onTitleBlur` → rename) exists only for drafts.

### 7.3 Save state

`span[role="status"][aria-live="polite"][aria-label="Save state"].save-state` in the app bar, before `More actions`.
`Saved` and `Saving…` render the icon with the text in `span.visually-hidden`; `Not saved`, `Changed outside Tegg` and
`Read-only` render visible text. The desktop's `save.*` keys. The `io` and `verify` alerts render below the app bar as
on the desktop.

### 7.4 `More actions` (RA14; D-2406, D-2514)

The menu `More actions` (AND-2 §9.1), in this order:

| Item | Command | Shown |
| --- | --- | --- |
| `Properties` | `phone.properties` | always |
| `Show Markdown source` / `Show formatted note` | `note.toggleSource` | always; leaving the editor flushes first (editor FR-EDT-10 AC-9); back restores the caret (`NotePageApi.caret`) |
| `Pin` (`phone.pin`) / `Unpin` (`pinned.unpin`) | `sidebar.pin` / `sidebar.unpin` | a file exists (on a draft or virtual day `aria-disabled` with `pinned.notSaved`, the desktop's `pinStatus` reason) |
| `Move to trash` (`cmd.trash`) | `object.trash` | always; `aria-disabled` with `trash.nothing` on a draft and a virtual day, with the read-only reason in a read-only mode |

### 7.5 Focus and the keyboard on open (FR-EDT-01 AC-16; D-2502)

`NotePageApi.placeFocus` on the phone: the app bar's `h1` (D-130) for every open (list row, link, pin, Back, cold start,
`Today`, Search's and the offer's creates); for a draft from `New`, `Title` followed by `ipc.androidIme(true)` (CP-5). No
caret is placed and `android_ime` is not called otherwise. After a draft's title commit the caret goes to the start of
the body (`caretToStart()`) and the keyboard stays. `note-ready` is marked once the editor is mounted and editable
(§15.2).

### 7.6 The body (FR-UX-08 AC-30)

`EditorPane`'s `div[role="textbox"][aria-label="Note body"][aria-multiline="true"][contenteditable="true"]`, with
`aria-describedby` = the `h1`'s id (or `Title`'s on a draft). `inputmode` and `enterkeyhint` are not set (the keyboard's
defaults). On the phone `EditorPane` renders none of RA14's hidden parts: no `Add block below`, no `Drag to move, click
for block menu`, no `Block actions` menu, no `toolbar` `Formatting` popover, no `Selection` menu, no block `draggable`,
and the block-selection keys (Esc, ⇧-click, ⇧↑/↓) are not bound (`blockSelection()` stays `null`). Query blocks, source
blocks and lossy tables stay read-only as on the desktop; table cells are editable, with no row or column actions.

### 7.7 Taps in the body

A tap on a link chip opens it (D-140, D-2506): `EditorPane`'s chip click handler on the phone runs the open without
modifiers. A tap beside a chip places the caret. A tap on a checklist item's box (`.checklist-item .check`) toggles it
through `toggleChecklist` at that item, with `pointerdown` prevented, so neither the caret nor the keyboard moves
(FR-TSK-11 AC-5). Embeds open as AND-2 §10 (`read.openEmbed:<n>`).

## 8. The formatting bar (RA15; FR-UX-04 AC-8…AC-10; D-2504)

`FormatBar`: `div[role="toolbar"][aria-label="Formatting"].phone-format-bar`, `position: fixed`, `bottom: 0`, height
48 px, `padding-left: var(--inset-left)`, `padding-right: var(--inset-right)`, `overflow-x: auto`, rendered while
`nativeState().keyboard` is true and `document.activeElement` is the `Note body` (not `Title`, a sheet's field, `Search
query`, the type sheet's field or the link panel's field). The WebView ends at the keyboard (AND-2 §5.1), so the bar's
bottom is the keyboard's top. `main` gets `padding-bottom: 48px` while the bar is shown. The bottom bar isn't rendered
while the keyboard is shown (AND-2 §8.6).

Buttons, 48 × 48 px, each `button[type="button"][tabindex="-1"]` with `onPointerDown` and `onMouseDown`
`preventDefault()` (the focus, the selection and the keyboard stay; FR-UX-04 AC-10):

| # | Name | `data-command` | State from `formatState` |
| --- | --- | --- | --- |
| 1 | `Heading` (`phone.edit.heading`) | `edit.blockType` | `aria-pressed` = `block === 'heading'` |
| 2 | `Bold` (`toolbar.bold`) | `edit.bold` | `aria-pressed` = `bold` |
| 3 | `Italic` (`toolbar.italic`) | `edit.italic` | `aria-pressed` = `italic` |
| 4 | `Link` (`toolbar.link`) | `edit.link` | — |
| 5 | `Tag` (`phone.edit.tag`) | `edit.tag` | — |
| 6 | `Bulleted list` (`slash.bulletList`) | `edit.bulletList` | `aria-pressed` = `block === 'bulletList'` |
| 7 | `Checklist` (`slash.checklist`) | `edit.checklist` | `aria-pressed` = `block === 'checklist'` |
| 8 | `Indent` (`phone.edit.indent`) | `edit.indent` | `aria-disabled` = `!canIndent` |
| 9 | `Outdent` (`phone.edit.outdent`) | `edit.outdent` | `aria-disabled` = `!canOutdent` |
| 10 | `Undo` (`phone.edit.undo`) | `edit.undo` | `aria-disabled` = `!canUndo` |
| 11 | `Redo` (`phone.edit.redo`) | `edit.redo` | `aria-disabled` = `!canRedo` |

`Heading` replaces the row with `div[role="radiogroup"][aria-label="Block type"]`: `role="radio"` buttons `Text`,
`Heading 1`, `Heading 2`, `Heading 3` (`slash.*`; `aria-checked` from `block`/`level`; commands
`edit.blockType:text`, `edit.blockType:heading1`, `…:heading2`, `…:heading3`) and `button` `Close` (`phone.close`,
`edit.blockType:close`). A choice runs `setBlock` and brings the row back. A disabled button does nothing and sends
nothing. When `formatState().editable` is false (the caret beside a protected block), the block buttons act on the
caret's own block only (§5.2).

`Link`: with a selection, the link panel (§10.2); without, `insertTrigger('[[')`. `Tag`: `insertTrigger('#')`.

## 9. Keyboard input (RA16; FR-EDT-01 AC-19, AC-20; FR-EDT-04 AC-5; T1)

### 9.1 `installPhoneInput(ed)` (`app/ui/src/edit/phoneInput.ts`)

Installed by `EditorPane` on the phone only; returns the uninstall. ProseMirror's own DOM-observer path handles
composition, `insertText`, `insertReplacementText` and `insertCompositionText` (as Chrome on Android does today). The
module adds:

- **Enter:** `beforeinput` `insertParagraph` or `insertLineBreak` (from `keydown` 229 or `Enter`) is prevented and runs
  the editor's Enter keymap (`ed.editor.commands.keyboardShortcut('Enter')`) after ProseMirror has read a pending
  composition (`view.domObserver.flush()`), so the composed word is committed once and the block splits once. In `Title`
  the same event commits the title (§7.2).
- **Backspace:** `beforeinput` `deleteContentBackward` with a collapsed selection at a block start or right after an
  atom node (chip, tag) is prevented and runs the `Backspace` keymap (join, lift, or the whole node, editor FR-EDT-05
  AC-5). A non-collapsed one (`deleteSurroundingText`'s one-character selection) is left to ProseMirror unless it
  starts at a block start, where it runs the keymap too.
- **NFC:** text inserted by `insertText`, `insertReplacementText`, a committed composition or a paste is normalised to
  NFC in an `appendTransaction` that replaces only the inserted range and keeps the caret after it (FR-EDT-01 AC-20).
  Text not touched keeps its bytes (FR-FMT-12 AC-5). Search folds as today (`zlutoucky` finds `Žluťoučký`).
- **Triggers:** `[[`, `@`, `#<letter>` and `/` arriving by `insertText` or inside a composition open their panels as
  typed keys do (the suggestion plugins read the doc, not keys); Markdown shortcuts (R7) run through the input rules,
  which apply to `insertText` and to a composition's committed text.
- **Images:** a paste whose clipboard holds no text and an image shows the page notice `phone.imagesLater`; nothing is
  inserted, written or sent (`onImagePaste`; FR-EDT-14 AC-8).

The desktop keeps its key handling; this module is never installed there.

### 9.2 What OC-2 may change

The event sequences of RA16 are the ACs' model of Gboard. If OC-2 records other sequences (§21), §9.1's handlers and
§17's helpers follow OC-2 under an AC fix; the expected results (the desktop's) don't change.

### 9.3 Caret in view (FR-UX-04 AC-9)

`keepCaretInView(view, main)` (`phone/caret.ts`) runs after every transaction that changes the selection or the doc,
after each `tegg:native` keyboard change and after each `visualViewport` resize: it reads `view.coordsAtPos(head)` and
sets `main.scrollTop = caretScroll(caret, caretBand(appBar.bottom, coverTop), main.scrollTop, max)`.

## 10. Panels and sheets (RA18)

### 10.1 Suggestion panels (FR-EDT-06 AC-12…AC-14, FR-EDT-15 AC-7, FR-EDT-03 AC-6; D-2507)

The existing listboxes (`listbox` `Link suggestions` (`suggest.links`), `Tag suggestions` (`suggest.tags`), `Insert
block` (`slash.label`)) render on the phone in `div.phone-panel` instead of the popover: `position: fixed`, `bottom: 0`,
side insets, replacing the bar while open; rows `role="option"` ≥ 56 px; `max-height: 224px` (4 rows) with its own
scroller. Rows keep the desktop's content (type icon, title, `DuplicateDetails`). `pointerdown` on a row is prevented
(the focus and the keyboard stay); a tap chooses it. The panel closes as Esc does (the typed trigger stays as text) when
the keyboard hides or the selection leaves the trigger's range. The last two rows of `Link suggestions` are the
desktop's `Create “<q>”` and `Create “<q>” as…` (the latter opens the type sheet, §10.3). `Insert block` lists
`phoneSlashItems` (§4.4).

### 10.2 The link panel (FR-EDT-05 AC-9; D-145)

`div[role="dialog"][aria-label="Link"].phone-link-panel` (non-modal), docked like §10.1: the field `input` `Link`
(`linkField.label`, `enterkeyhint="done"`, focused on open), with `listbox` `Link suggestions` above it. A choice runs
`insertLink`; Done with a URL runs `setUrlLink` after the desktop's check (`SAFE_URL`; refused with
`linkField.refused`, nothing changes). With the caret in a link, `button` `Remove link` (`linkField.remove`,
`data-command="phone.link.remove"`) runs `removeLink`. Closing returns the focus to the body with the selection.

### 10.3 The type sheet (FR-VLT-05 AC-16, AC-17; D-1431, D-1432, D-2508)

`object.new` on the phone opens AND-2's `Sheet` with title `New object` (`newObject.title`): the existing
`NewObjectPicker` content (`combobox` `Choose a type` with `newPicker.placeholder`, `listbox` `Types` in `pickerTypes`
order, the default `aria-selected` and marked `Default`), the field not focused at opening. A row tap calls App's
`newOf(key)`: `new/<type>` for every type, `Task` included, and today's Daily Note for `daily-note` (D-353). The scrim,
`Close` (`phone.sheet.close`) and system Back close it; nothing is written. `as…` (Search, `[[`) and the Create offer's
`Type` open the same sheet in a chooser mode that returns the key instead of navigating.

### 10.4 The Create offer (FR-LNK-04 AC-14; D-2525)

The offer handler (`setOfferHandler`) on the phone opens `Sheet` `Create note` (`createLink.title`) with the desktop's
`CreateLinkOffer` content (`createLink.noNote`, `createLink.type`, the `Type` button opening §10.3's chooser,
`button` `Create "<target>"` with `data-command="phone.offer.create"`). `Create` runs the desktop's `link_create` flow and
opens the new note (§7.5: no keyboard). In a read-only mode `Create` is `aria-disabled` only when the plan rewrites the
source. `phone.noNote` is removed.

### 10.5 The Properties sheet (FR-EDT-07 AC-24…AC-26; D-2413, D-2509)

`PhoneProperties` (`phone/PhoneProperties.tsx`) renders the strip (AND-2 §9.2) and the sheet `Properties`:
- **Strip:** values only. On a Quick Note, a Daily Note with a file and a type with the review workflow, the first item
  is `ReviewCheck` (`checkbox` `Mark reviewed` / `Reviewed`, 48 × 48 px hit area, `data-command` `note.markReviewed` /
  `note.markUnreviewed`, or `daily.*` on a day). A tap on a strip value opens the sheet scrolled to that row
  (`data-command="phone.prop.show:<key>"`).
- **Sheet:** `AttributePanel` with `variant="sheet"` (new prop; the desktop passes nothing): one row per panel row
  (≥ 48 px), the R10 control adapted to touch (Select and Multi-select as a `listbox` of options; Date and Date-time
  through `PickDate` as a `dialog` within the viewport, D-763; Relation through the relation picker, whose `Create` is
  §2.4 row 8), plus the universal `Tags`, `Aliases`, `Description`, `Source`. Read-only rows: `Type` (icon and name, a
  link to `type/<key>`), `Title`, `Created`, `Modified`. No `Change type…`, `Add property` or `Delete property`. Each
  control except text inputs carries `data-command="phone.prop:<key>"`.
- **Commits:** ⏎/Done, leaving the field, a choice, and closing the sheet (scrim, `Close`, system Back) commit a typed
  value first, then close (one write). Each commit is `onCommit` → `ed.applyFrontmatter` → `Saver.changed()`: a
  property change and a body edit within 1 s are one `note_write`. A refused write shows the merge banner (CP-2).

### 10.6 The merge banner and `Compare versions` (FR-SYN-03 AC-41, AC-43; D-2510)

On the phone `NotePage` renders `MergeBanner` instead of `MergeDialog`:
- `div[role="alert"][aria-label="Changed outside Tegg"].phone-merge` first in `main` below the app bar: `phone.conflict.title`,
  `phone.conflict.text`, then `button`s `Compare` (`phone.merge.compare`), `Keep mine` (`phone.merge.keepMine`),
  `Keep theirs` (`phone.merge.keepTheirs`), `Keep both` (`phone.merge.keepBoth`), with the `merge.*` texts. No device
  name or time.
- While shown: the editor is `setEditable(false)` (`contenteditable="false"`) and `android_ime(false)` hides the
  keyboard; `systemBack()` gains a step after the overlays and before history: if the banner (or the deleted alert,
  CP-10) is shown, focus it and return `true`; the app bar's `Back` does the same.
- `Compare` opens `div[role="dialog"][aria-modal="true"][aria-label="Compare versions"]` within the insets: `Compare`
  stacked (`compare.mine` above `compare.theirs`, changed lines `data-diff="changed"`), the same four buttons and
  `Close`.
- The choices are NotePage's existing `keepMine`, `keepTheirs`, `keepBoth` (§2.4 row 11); each removes a recovery copy
  (§11.2). The deleted alert (`deleted.*`, `phone.deleted.restore`, `phone.deleted.discard`) keeps its desktop behaviour.
- **Recovered edits:** a note opened with a recovery copy (§11.2) shows the same banner with `phone.recovered`
  (`{title}` = the copy's title) instead of `phone.conflict.text`, `Your version` = the copy's text, `Version on disk` =
  the file; `Keep mine` writes the copy with the disk version as base.

### 10.7 The broken-link, Search and daily creates

- **Search** (FR-NAV-01 AC-25; D-2412): `SearchPage` passes `noCreate={false}`: the desktop's `search.create` and
  `search.createAs` buttons and the empty state `search.noMatchCreate`. `Create` opens the new note (§7.5); `as…` opens
  §10.3's chooser. The search key opens the first result and never creates. `phone.search.noMatch` is removed.
- **Today** (FR-DLY-02 AC-11): the virtual day opens in the editor with `daily.notSaved`; the first changed transaction
  writes through `daily_create` (§2.4 row 10); the `hidden` flush writes it (§11.1).

### 10.8 Conflict resolution (FR-SYN-04 AC-14, AC-15; D-2410, D-2524)

`ConflictsPage` on the phone renders `ConflictResolve` under the stacked `Compare`:
- under each version a `button` `Keep this version` (`phone.keepThis`), `aria-description` = that version's path,
  `data-command` `phone.conflict.keep:1` (the primary) / `phone.conflict.keep:2` (the copy);
- `Merge…` (`conflicts.merge`, `phone.conflict.merge`); `Give the copy a new id` (`conflicts.newId`,
  `phone.conflict.newId`) where the desktop offers it (kind `duplicateId`);
- `Keep this version` opens `Sheet` `Move to trash?` (`conflicts.trashConfirmTitle`) with `phone.trashCopy`
  (`{name}` = the other file's name) and `Move to trash` (`conflicts.move`, `phone.conflict.confirm`), `Cancel`
  (`conflicts.cancel`, `phone.conflict.cancel`); the writes are §2.4 row 13 (the desktop's `keepLeft` / `keepRight`);
- `Merge…` opens `div[role="dialog"][aria-modal="true"][aria-label="Merge versions"]` (`phone.mergeVersions`) full
  screen: the version links resolve to (the primary) as an editable phone editor with the bar (§8), above the other
  version read-only (`Compare`'s column). `Done` (`conflicts.done`, `phone.conflictMerge.done`) is §2.4 row 13's merge;
  `Cancel` (`phone.conflictMerge.cancel`) and system Back write nothing.

## 11. Saving and the Android lifecycle

### 11.1 The flush (FR-EDT-08 AC-15, AC-16; D-2027)

`Saver.flush(o?: { composing?: boolean })`: with `composing: true` the write doesn't wait for `view.composing` and
saves the document as shown, the composing text included (ProseMirror has read it into the doc); the composition itself
isn't ended. Without it, the desktop's rule (no write while composing) holds, so no debounce write ever holds an
uncommitted word.

App's Android `visibilitychange: hidden` listener (AND-1 §9.4) calls, in this order, within the same task:
1. `noteApi.flushHidden()` (new on `NotePageApi`): a typed but uncommitted draft title or sheet field is committed (a
   draft's first write, D-522); then `saver.flush({ composing: true })`;
2. when the open note's edits can't be written (`Saver.isBlocked()` with the merge banner or the deleted alert, or
   `state === 'failed'`), `keepForRecovery()` (§11.2) instead.

`pagehide` runs the same. The desktop adds no listener.

### 11.2 The recovery copy (FR-EDT-08 AC-17; D-2511; CP-4)

- `keepForRecovery()`: `ipc.androidRecoveryPut({ vault, path, id, title, text: ed.text(), base: saver.base, savedAt })`
  within 100 ms of `hidden`. Nothing is written to the vault.
- `takeRecovery(path)`: on every note load on the phone, `ipc.androidRecoveryGet(path)`; a copy shows §10.6's recovered
  banner.
- `ipc.androidRecoveryDrop(path)` after any banner choice, after a successful `note_write` of that path from this page,
  and after `Discard`.
- Folder `<files_dir>/recovery/` (FR-STO-07: machine-local, never in the vault, excluded from backups by AND-1's
  `data_extraction_rules`). One file per vault and path: `<recoveryKey(vault, path)>.json`, the `RecoveryDto` as UTF-8
  JSON. A copy for a note that's gone opens with the deleted alert's choices.

### 11.3 After the renderer's death (FR-EDT-08 AC-18)

§6.2. The page starts again and lands on the last opened note (D-2421); no recovery copy is involved (the page could
not run).

## 12. Other writes on the phone

### 12.1 Task checkboxes (FR-TSK-02 AC-14; D-2407)

On the phone the task checkboxes of table rows, board cards (`Schedule`, `Kanban`), `Tasks due` and task embeds are
enabled: `role="checkbox"`, `aria-label` `Complete "<title>"` / `Mark "<title>" not done` (R43), hit area ≥ 48 × 48 px,
`data-command="task.complete:<path>"` (NFC path). A tap runs `writeTask` (§2.4 row 4). A task that opens read-only
(`nfdName`, invalid frontmatter) stays `aria-disabled` with its reason and no command. Status, priority and due controls
and drags stay off (D-2474). `phone.viewOnly` stays on views' other controls.

### 12.2 The Inbox (FR-INB-02 AC-18; D-2403, D-2515)

`InboxPage` on the phone renders, after each row's title, `input[type="checkbox"]` `Reviewed` (`inbox.reviewed`) in a
48 × 48 px label, `data-command` `note.markReviewed:<path>` (unchecked) / `note.markUnreviewed:<path>` (checked)
(CP-8). A change runs `changeItem` (§2.4 row 5); the row stays, dimmed and checked, until the route changes. No `Mark
all reviewed`, selection, swipe or `Convert to`.

### 12.3 Checklist items, mindmaps

§7.7 and §5.2.

### 12.4 Pin (FR-HOM-02 AC-33; D-2514)

`sidebar.pin` / `sidebar.unpin` run App's `pinCurrent` / `unpinCurrent` (v1-pinned: appended last, removed by `id`,
base-checked). The drawer's `PinnedSection` stays `readOnly` (no reorder, drag or row menu).

### 12.5 Drafts and creates

§7.2, §10.3, §10.4, §10.7. A note created on the phone opens with its title fixed (§7.2).

### 12.6 Move to trash (FR-HIS-01 AC-16; D-2514; CP-1)

`object.trash` on the phone: `await flush()`; `trashTarget()`; `moveToTrash([item])` (`object_trash`); then
`actions.back()` (history's previous entry, else `inbox` replacing the entry). The notice (AND-2's `div.phone-notice`)
shows `trash.moved` with `button` `Undo` (`save.undo`, `data-command="phone.notice.undo"`) for 4,000 ms; `Undo` calls
`trash_restore(<to>)` and opens the restored path. A conflict shows `trash.conflict` and nothing moves. No Trash page or
drawer entry.

## 13. Routes and commands

### 13.1 Routes

`PHONE_NOT_OFFERED` loses `new/<type>`; the rest stays (AND-2 §7).

### 13.2 `PHONE_HIDDEN_COMMANDS` and the exceptions (FR-UX-03 AC-60, AR-03 AC-15)

The list keeps its prefixes and loses exactly `note.markReviewed`, `note.markUnreviewed`, `daily.markReviewed`,
`daily.markUnreviewed`, `object.trash`, `sidebar.pin`, `sidebar.unpin`. `phoneHidden(id)`'s exceptions become
`inbox.open`, the board folds, `task.complete`, `edit.undo`, `edit.redo`, `edit.bold`, `edit.italic`, `edit.link`, and
the phone's own `edit.blockType`, `edit.tag`, `edit.bulletList`, `edit.checklist`, `edit.indent`, `edit.outdent` (with
their `:` forms). `phoneCommands` no longer overrides `object.new` (no `phone.newLater`). Every other desktop `edit.*`
id (`edit.strike`, `edit.code`, `edit.highlight`, `edit.moveBlock*`, `edit.blockMenu`, `edit.selectBlock`,
`edit.openOrToggle`, `edit.pastePlain`, `edit.saveNow`, `edit.embedObject`, `edit.openEmbed`, `edit.displayEmbedAs`,
`edit.turnInto*`, `edit.copyBlockLink`) and every other `task.*` stays hidden.

### 13.3 The phone's new commands

Registered by `own(ctx)` (they don't exist on the desktop, so the desktop palette is unchanged):

| Id | Title key | Where | Runs |
| --- | --- | --- | --- |
| `edit.blockType`, `edit.blockType:<text\|heading1\|heading2\|heading3\|close>` | `cmd.edit.blockType` | a route with an editor | §8 |
| `edit.tag`, `edit.bulletList`, `edit.checklist`, `edit.indent`, `edit.outdent` | `cmd.edit.tag`, `cmd.edit.bulletList`, `cmd.edit.checklist`, `cmd.edit.indent`, `cmd.edit.outdent` | same | §5.1 |
| `phone.link.remove` | `linkField.remove` | the link panel | `removeLink` |
| `phone.merge.compare`, `…keepMine`, `…keepTheirs`, `…keepBoth` | `merge.*` | the banner shown | §10.6 |
| `phone.deleted.restore`, `phone.deleted.discard` | `deleted.*` | the deleted alert shown | §10.6 |
| `phone.offer.create` | `createLink.create` | the offer shown | §10.4 |
| `phone.conflict.keep:1`, `…keep:2`, `phone.conflict.merge`, `…newId`, `…confirm`, `…cancel`, `phone.conflictMerge.done`, `…cancel` | `conflicts.*`, `phone.keepThis` | `conflicts` | §10.8 |
| `phone.prop:<key>`, `phone.prop.show:<key>` | `cmd.phone.editProperty` | the sheet / the strip | focus or open that control; open the sheet at the row |
| `phone.notice.undo` | `save.undo` | the trash notice shown | §12.6 |
| `task.complete:<path>` | `cmd.task.complete` | a checkbox shown | §12.1 |
| `note.markReviewed:<path>`, `note.markUnreviewed:<path>` | `cmd.markReviewed`, `cmd.markUnreviewed` | an Inbox row shown | §12.2 |

`PAGE_COMMAND_PREFIXES` gains `task.complete:`, `note.markReviewed:`, `note.markUnreviewed:`, `phone.prop:`,
`phone.prop.show:`, `phone.conflict.keep:`, `edit.blockType:`. `PHONE_FRAME_COMMANDS` is unchanged apart from
`object.new` now running. `__TEGG_TEST__.run(id)` has the tap's effect for every id here (D-2447).

The AR-03 AC-13 L1 rule still holds: no listed command reaches an `ANDROID_EXCLUDED` command or a `PHONE_NOT_OFFERED`
route; `trash_restore` is no longer excluded.

## 14. Strings (RA19; NFR-OTH-02 AC-27)

All in `app/ui/src/i18n/catalog.ts`; no literal in `app/ui/src/phone/` or the phone branches. Existing keys are reused
where RA19's text equals them (CP-9): the bar `toolbar.label` `Formatting`, `toolbar.bold`, `toolbar.italic`,
`toolbar.link`; `slash.text`, `slash.heading1`…`3`, `slash.bulletList`, `slash.checklist`; `phone.close`;
`newObject.*`, `newPicker.*`, `createLink.*`, `merge.*`, `compare.*`, `deleted.*`, `conflicts.*`, `save.*`,
`search.create*`, `search.noMatchCreate`, `trash.*`, `pinned.unpin`, `inbox.reviewed`, `linkField.*`, `suggest.*`.

New keys:
- `phone.edit.heading` `Heading` · `phone.edit.blockType` `Block type` · `phone.edit.tag` `Tag` · `phone.edit.indent`
  `Indent` · `phone.edit.outdent` `Outdent` · `phone.edit.undo` `Undo` · `phone.edit.redo` `Redo`
- `phone.title.fixed` `Rename this note on the Mac.`
- `phone.nfdReadOnly` `This note's file name uses a Unicode form the phone can't save safely. Edit it on the Mac.`
- `phone.conflict.title` `Changed outside Tegg` · `phone.conflict.text` `This note changed on disk while you were editing.
  Nothing is saved until you choose.`
- `phone.recovered` `Tegg kept your unsaved changes to “{title}” on this phone.`
- `phone.keepThis` `Keep this version` · `phone.trashCopy` `Move “{name}” to the trash?` · `phone.mergeVersions`
  `Merge versions` · `phone.pin` `Pin`
- `phone.imagesLater` `Adding images comes later on the phone.`
- command titles: `cmd.edit.blockType` `Change block type`, `cmd.edit.tag` `Insert tag`, `cmd.edit.bulletList`
  `Bulleted list`, `cmd.edit.checklist` `Checklist`, `cmd.edit.indent` `Indent list item`, `cmd.edit.outdent` `Outdent
  list item`, `cmd.phone.editProperty` `Edit property`.

Removed: `phone.newLater`, `phone.noNote`, `phone.search.noMatch`. `{title}` and `{name}` are user content
(`data-user-content` on their element).

## 15. Test hooks and perf marks

### 15.1 In the page (`window.__TEGG_TEST__`, Android, in-memory)

| Hook | Does |
| --- | --- |
| `visibility(state: 'hidden' \| 'visible')` | overrides `document.visibilityState` and dispatches `visibilitychange` (then `pagehide` for `hidden`): the same listeners as the system's |
| `formatState()` | `formatState(ed.view.state)` of the shown note's editor, or `null` |
| `editor` (existing, ms3-shell §13.6) | `text()`, `dirty()`, `historyDepth()` on the phone too |
| `faults.editorLoad` (existing) | the editor-load failure of editor.md NFR-REL-03 AC-8 |
| `keyboard`, `insets`, `systemBack`, `run`, … | AND-2 §12.2, unchanged |

### 15.2 Perf marks (NFR-PERF-05 AC-7, NFR-PERF-06 AC-8; D-2520)

- `note-ready`: on the phone, once the editor is mounted and editable (no caret), repeatable on Android with
  `nav-start:<route>` (AND-2 §12.3). A read-only mode marks it once the read view has painted.
- `first-write` (new): `ipc.perfTimed('first-write', ms)`, `ms` = from a draft's title commit (`performance.now()` at
  the Enter or flush) to `note_create`'s answer; written on every occurrence (timed lines always are).
- `key`: §5.3.

### 15.3 On the device

`test-env.json` keys are unchanged (`TEGG_TEST`, `TEGG_VAULT`, `TEGG_PERF_LOG`, `TEGG_IPC_LOG`, `TEGG_LAYOUT`, `TEGG_NOW`,
…). The IPC log records §2.2's commands like every other.

## 16. Builds and tools

### 16.1 Release (AR-08 AC-7; D-2022, D-2042, D-2043, D-2522; CP-11)

`release.mjs` takes its arguments from `parseReleaseArgs` (§4.6): the APK is built by default, `--no-apk` skips it,
`--apk` is a no-op. The plan is `releasePlan`'s, unchanged (AND-1 §10.1). At the end the script prints the
`githubRelease(...)` command for the owner's release step; it doesn't run it. AR-08 AC-1…AC-6 run in AND-3's merge gate
(`./verify merge`) because `app-android-e2e` and the release tests are in it. The L1 tests are in
`app/test/release_plan.ac.test.ts` (`ar_08_ac7_every_release_builds_the_apk`).

### 16.2 The test input method (D-2519; CP-13)

`tools/android/test-ime/`: a Gradle project of its own (not in `app/src-tauri/gen/android/`), application id
`app.tegg.testime`, one `InputMethodService` `app.tegg.testime.TestIme` with an empty 1 px input view, `minSdk 30`,
`targetSdk 35`, debug-signed. When it has an input connection it registers a receiver (`RECEIVER_EXPORTED`) for
`app.tegg.testime.CMD`; each ordered broadcast runs one operation on `currentInputConnection` and answers with result
data `ok`, or `no-connection` / `bad-op`:

| `op` extra | Extras | Calls |
| --- | --- | --- |
| `compose` | `b64` (UTF-8 text, base64), `cursor` (int, default 1) | `setComposingText(text, cursor)` |
| `commit` | `b64`, `cursor` | `commitText(text, cursor)` |
| `finish` | — | `finishComposingText()` |
| `region` | `start`, `end` | `setComposingRegion(start, end)` |
| `delete` | `before`, `after` | `deleteSurroundingText(before, after)` |
| `key` | `code` (`KEYCODE_*` int) | `sendKeyEvent(DOWN)`, `sendKeyEvent(UP)` |
| `select` | `start`, `end` | `setSelection(start, end)` |
| `type` | `b64`, `interval` (ms) | commits one code point every `interval` ms on the IME's handler thread; answers `started` |
| `stop` | — | stops a running `type`; answers the count committed |

`tools/android/test-ime.sh build` builds `.verify/android/test-ime.apk`; `install` installs it, `ime enable` and `ime
set app.tegg.testime/.TestIme`; `restore` sets the emulator's default keyboard back. The `app-android-e2e` steps run
`build` and `install` after `avd.sh up`. The product's Gradle project never references it.

### 16.3 `apk-check` (D-2519)

New rule for both `--expect release` and `--expect test`: the APK's dex files contain no class under
`app/tegg/testime/` and its manifest declares no `android.view.InputMethod` service. Unit-tested on `ApkFacts`
(`tools/qa/test/apk_check.ac.test.ts`).

### 16.4 `qa.config.json`

The L5p projects pick up `phone_edit_*.ac.test.ts` through AND-2's `PHONE` pattern (`app/playwright.config.ts`, no
change). `app-android-e2e` and `app-android-e2e-nightly` gain `sh ../tools/android/test-ime.sh build && sh
../tools/android/test-ime.sh install` after `avd.sh up`; `tools/android/test-ime` joins `android-check`'s inputs.

## 17. The harnesses

### 17.1 L5p (`app/webkit/phone-helpers.ts`, `app/webkit/phone-ime.ts`)

```ts
export type ImeStep =
  | { compose: string; cursor?: number }        // set the composing text (start a composition if none)
  | { commit: string }                          // commit text (ends a composition)
  | { finish: true }                            // end the composition, keeping its text
  | { text: string }                            // insertText outside a composition
  | { replace: string; over: number }           // insertReplacementText over the `over` characters before the caret
  | { enter: true; via?: 'key' | '229' }        // Enter; a composition is committed first
  | { backspace: true; via?: 'key' | '229' }
  | { deleteSurrounding: { before: number; after: number } }
  | { paste: { 'text/plain'?: string; 'text/html'?: string; 'image/png'?: true }; via?: 'menu' | 'keyboard' };
export async function ime(page: Page, steps: ImeStep[]): Promise<void>;
```

- **Chromium (authoritative, the WebView's engine):** `compose` → CDP `Input.imeSetComposition({ text, selectionStart:
  cursor, selectionEnd: cursor })` (preceded by `Input.dispatchKeyEvent` `rawKeyDown` `key: 'Unidentified'`,
  `windowsVirtualKeyCode: 229`); `commit`/`text` → `Input.insertText`; `finish` → `Input.insertText` of the composing
  text; `replace` → the DOM selection over the range, then `Input.insertText`; `enter` → `Input.dispatchKeyEvent`
  `keyDown` `Enter` (`text: '\r'`, `windowsVirtualKeyCode: 13`), or with `via: '229'` a 229 `keyDown` and a synthetic
  `beforeinput` `insertParagraph`; `backspace` likewise with `Backspace`/`deleteContentBackward`; `deleteSurrounding` →
  the DOM selection over `before`/`after` characters, then `Backspace`; `paste` → a synthetic `paste` event with a
  `DataTransfer` (menu) or `Input.insertText` (keyboard).
- **WebKit:** each step dispatches the same event sequence from script: `keydown` (229, `Unidentified`),
  `compositionstart` / `compositionupdate` / `compositionend`, a cancelable `beforeinput` with RA16's `inputType` and
  `data`, and, when it isn't prevented, the default action through `document.execCommand('insertText' |
  'insertParagraph' | 'delete')`, then `input`. A case WebKit can't reproduce faithfully is skipped on WebKit only
  (`test.skip(browserName === 'webkit', …)`), as AND-2's pinch (D-2471) (CP-14).
- **The fake core** gains `android_recovery_put`, `_get`, `_drop` (in-memory, exposed as `recoveries()` on
  `PhoneHandle`) and `android_ime` (recorded as `imeCalls()`; read-only). Helpers: `formatBar(page)`,
  `barButton(page, name)`, `panel(page, name)`, `mergeBanner(page)`, `typeSheet(page)`, `visibility(page, state)`,
  `editorText(page)`, `writesPerPath(core)` (FR-SYN-06 AC-56), `assertWritesExactly(core, list)` (the ACs' "writes
  exactly X"), `desktopEditorResult(browser, vault, path, caret, keys)` (the comparison editor at `macos` 1440 × 900
  with real key presses, for RA16 and FR-EDT-07 AC-24).

### 17.2 LA (`app/e2e-android/helpers/ime.ts`, `helpers/phone.ts`)

`ime.ts`: `imeUse()` (`test-ime.sh install` once per run, `ime set`), `imeRestore()`, `imeCompose(text, cursor?)`,
`imeCommit(text, cursor?)`, `imeFinish()`, `imeRegion(start, end)`, `imeDelete(before, after)`, `imeKey(code)`,
`imeSelect(start, end)`, `imeType(text, intervalMs)`, `imeStop()`; each runs `adb shell am broadcast -a
app.tegg.testime.CMD -p app.tegg.testime --es op <op> …` and throws unless the result data is `ok` (or `started`).
`phone.ts` gains `rendererPid()` (`adb root`; the app's `:sandboxed_process` renderer from `ps -A`),
`killRenderer()` (`kill -9`), `amKill(id)` (`am kill` after HOME), `removeTask(id)` (`am stack remove` /
`cmd activity` of the app's task, the Recents swipe), `recoveryFiles(id)` (`run-as <id> ls files/recovery`),
`tmpFiles(vault)` (`.tegg-tmp` files under the vault), `pushReplace(path, text)` (`adb shell` temp file then `mv`, the
sync app's way), `uiEditable(name)` (`uiautomator dump`: a node with that text and `editable`).

## 18. Fixtures (D-50, D-62)

New overlay `tests/fixtures/vaults/phone-edit/`, copied on top of `editor/` + `new-empty/.tegg/`; LF, NFC, UTF-8
without BOM, a final newline; frontmatter `id`, `type: page`, `title`, `created` and `modified`
`2026-10-14T09:00:00+02:00`, in that order (the editor fixture's form):

| File | `id` | Body (blocks separated by one blank line) |
| --- | --- | --- |
| `Pages/Psaní.md` | `01JBAN3000000000000000E001` | `# Nákup`; `- mléko` / `- chléb`; `- [ ] Zavolat` / `- [x] Hotovo`; `1. první` / `2. druhý`; `Text s [[Cíl]] a #projekt.`; `Konec.` |
| `Pages/Mapa v textu.md` | `01JBAN3000000000000000E002` | `Před mapou.`; `> [!mindmap] Plán` / `> - Cesta` / `>   - Vlak` / `>   - [ ] Jízdenky`; `Po mapě.` |
| `Pages/Tabulka.md` | `01JBAN3000000000000000E003` | `\| A \| B \|` / `\| --- \| --- \|` / `\| 1 \| 2 \|` |
| `README.md` | — | what the overlay is for and which ACs use it (as `phone-content/README.md`) |

Every other fixture is the ACs' list, unchanged.

## 19. Test files

- **L5p** (`app/webkit/`, both phone projects): `phone_edit_note.ac.test.ts` (FR-EDT-01 AC-15…AC-20, FR-EDT-10 AC-12,
  FR-MMP-02 AC-37), `phone_edit_bar.ac.test.ts` (FR-UX-04 AC-8…AC-11, FR-EDT-02 AC-27, FR-EDT-05 AC-8, AC-9, FR-EDT-09
  AC-7, FR-EDT-04 AC-5), `phone_edit_panels.ac.test.ts` (FR-EDT-03 AC-6, FR-EDT-06 AC-12…AC-14, FR-EDT-15 AC-7, FR-EDT-14
  AC-8), `phone_edit_save.ac.test.ts` (FR-EDT-08 AC-15…AC-17, FR-EDT-07 AC-24…AC-26, FR-FMT-07 AC-38, AC-39, FR-FMT-08
  AC-11), `phone_edit_sync.ac.test.ts` (FR-SYN-03 AC-40…AC-44, FR-SYN-04 AC-14, AC-15, FR-SYN-06 AC-56, AC-57),
  `phone_edit_create.ac.test.ts` (FR-VLT-05 AC-16, AC-17, FR-NAV-01 AC-25, FR-LNK-04 AC-14, FR-DLY-02 AC-11),
  `phone_edit_writes.ac.test.ts` (FR-TSK-02 AC-14, FR-TSK-11 AC-5, FR-INB-02 AC-18, FR-HOM-02 AC-33, FR-HIS-01 AC-16,
  FR-FMT-12 AC-18), `phone_edit_quality.ac.test.ts` (FR-UX-03 AC-60, AR-03 AC-15, FR-UX-08 AC-30, FR-UX-05 AC-29,
  NFR-OTH-02 AC-27).
- **L1:** `app/test/android_edit.ac.test.ts` (FR-UX-03 AC-60, AR-03 AC-15, NFR-OTH-02 AC-27: the lists and the
  catalog; `contextmenuAllowed`, `caretScroll`, `phoneSlashItems`, `recoveryKey`), `packages/editor/test/format.ac.test.ts`
  (`formatState`, §5.1's commands for FR-EDT-02 AC-27), `packages/editor/test/protect.ac.test.ts` (FR-MMP-02 AC-37),
  `app/test/release_plan.ac.test.ts` (AR-08 AC-7).
- **L4:** `crates/tegg-vault/tests/ac_android_create.rs`, `crates/tegg-vault/tests/ac_android_names.rs` (gains
  FR-FMT-12 AC-18), `crates/tegg-index/tests/ac_android_copies.rs`, `crates/tegg-core/tests/ac_android_edit.rs`
  (FR-SYN-03 AC-42, AC-44, FR-FMT-08 AC-11, FR-SYN-06 AC-57: base checks and names on the host).
- **LA** (`app/e2e-android/`): the ACs' three files `android_edit.ac.test.ts`, `android_edit_sync.ac.test.ts`,
  `nightly_android_edit.ac.test.ts`.
- **APK:** `tools/qa/test/apk_check.ac.test.ts` gains §16.3's rule (NFR-SEC-01 AC-5's APK part reuses AC-1's).
- **Rust host:** `app/src-tauri/tests/ac_android_commands.rs` (AR-03 AC-15's command set), `recovery_key`'s table in
  `app/src-tauri/src/phone.rs`.

## 20. Changes to AND-1's and AND-2's contracts and tests

All under one `AC-Test-Change` trailer naming D-2514 and android-edit.md's "Changes when approved", written with the
red tests.

| Item | Change |
| --- | --- |
| android-shell §2.1, RA2 group O; `ar_03_ac9_command_sets_per_platform` (`app/src-tauri/tests/ac_android_commands.rs`, `app/test/android_platform.ac.test.ts`) | `trash_restore` in `ANDROID`; the four §2.2 commands in `ANDROID_ONLY`; `ANDROID_EXCLUDED` without `trash_restore` |
| android-shell §3.2 "Read-only until AND-3" and "revisited in AND-3" | stay in force (D-2512, D-2513); the text points here |
| android-shell §10.1, `release.mjs`'s header; `ar_08_ac1_release_builds_the_apk` | default APK, `--apk` a no-op; the test adds the CLI's default through `parseReleaseArgs` |
| android-phone §2.3, `app/ui/test/phone-writes.ts` | `READ_COMMANDS` gains §2.2's four |
| android-phone §7 (`PHONE_NOT_OFFERED`); `app/test/android_phone.ac.test.ts` `ar_03_ac13_…`'s `NOT_OFFERED_TABLE`; `app/webkit/phone-helpers.ts` `NOT_OFFERED`; `phone_quality.ac.test.ts` `ar_03_ac13_phone_offers_no_excluded_action` | `new/<type>` offered |
| android-phone §8.2 (`New`), §10 (`object.new` disabled); `phone_frame.ac.test.ts` `fr_ux_04_ac2_phone_frame` | `New` enabled, opens §10.3 |
| android-phone §8.5 (long press); `phone_nav.ac.test.ts` / `phone_quality.ac.test.ts` checks of `contextmenu` | the body's text excepted (§4.3) |
| android-phone §9.1 (the read view); `phone_read.ac.test.ts` `fr_edt_10_ac10_note_is_the_read_view_on_the_phone`, `e2e-android/android_phone.ac.test.ts` `fr_edt_10_ac10_…` | the editor; the read view only for §7.1's read-only modes |
| android-phone §9.2 (sheet without inputs); `phone_read.ac.test.ts` `fr_edt_07_ac23_properties_strip_and_sheet` | "No input" for the read-only rows only; the strip's review checkbox |
| android-phone §9.3 (`phone.noNote`); `phone_read.ac.test.ts` `fr_edt_10_ac11_links_by_tap` | the Create offer sheet |
| android-phone §9.5 (task checkboxes view-only); `phone_views.ac.test.ts` `fr_tsk_04_ac31_tasks_read_only_on_the_phone` | checkboxes enabled with `task.complete:<path>`; the rest stays view-only |
| android-phone §9.7 (Inbox); `phone_pages.ac.test.ts` `fr_inb_01_ac14_inbox_read_only_on_the_phone` | the `Reviewed` checkbox per row |
| android-phone §9.8 (Search `noCreate`, Conflicts read-only); `phone_pages.ac.test.ts` `fr_src_03_ac22_search_page_on_the_phone`, `fr_syn_04_ac13_conflicts_read_only_on_the_phone` | create buttons; `Keep this version` and `Merge…` |
| android-phone §10 (lists, D-2475's exemption); `phone_quality.ac.test.ts` `fr_ux_03_ac58_commands_without_a_palette`, `phone_content.ac.test.ts` `fr_ux_03_ac59_content_controls_on_the_phone`, `app/test/android_phone.ac.test.ts` `ar_03_ac13_…` (its `PHONE_HIDDEN_COMMANDS` table) | §13.2, §13.3; task checkboxes carry `task.complete:<path>` |
| android-phone §11 (RA13 keys); `phone_quality.ac.test.ts` and `app/test/android_phone.ac.test.ts` `nfr_oth_02_ac26_phone_strings` | without `phone.newLater`, `phone.noNote`, `phone.search.noMatch` |
| `phone_quality.ac.test.ts`, `e2e-android/android_phone_sync.ac.test.ts` `fr_syn_06_ac54_reading_on_the_phone_writes_nothing` | the tour keeps zero writes but no longer taps checkboxes or `New` as "does nothing" (they write now) |

AND-2's other tests (frame, drawer, Back, views, maps, themes, settings) don't change.

The phone's editor page stays an `article` named by the note's title, as AND-2's read view was (D-2553), so AND-2's tests
that find the open note by `getByRole('article', { name })` or `main article` (phone_read FR-EDT-02 AC-26, FR-NAV-08
AC-3 at L5p and LA, FR-ATT-01 AC-17) stay valid. D-2550's two further AND-2 test changes are approved (D-2553).

## 21. What depends on OC-2 and OC-3 (D-2526)

- **OC-2 (Gboard typing):** §9.1's event handling, RA16's sequences in §17.1's `ime` steps and §16.2's IME operations
  are the ACs' model. If OC-2 fails, AND-3 stops (D-2500). If it passes with other event sequences, they are added to
  RA16 and §17 as an AC fix before the red tests.
- **OC-3 (the sync app):** the copy name pattern of §3.4 (FR-SYN-04 AC-16) and whether the sync app uploads a rewritten
  NFD-named file (§3.1 keeps such notes read-only either way). Whether the sync app writes by temp file and rename,
  which §17.2's `pushReplace` imitates.

## 22. Points for the owner (CP-1…CP-14 → D-2527…D-2540, accepted as proposed)

| CP | Point | Proposal | Alternative | Affects |
| --- | --- | --- | --- | --- |
| CP-1 | **Move to trash: `note_trash` or `object_trash`.** RA17 row 15 and FR-HIS-01 AC-16 name `note_trash(path, base)`; the desktop's `Move to trash` is `moveToTrash` → `object_trash` (6A, D-620), which also moves an Image or PDF object's file and gives `trash_restore` its `to`. On a note it is the same one rename. | The phone reuses `moveToTrash` (`object_trash`), the desktop's toast logic and alerts; AC fix to RA17 row 15 and FR-HIS-01 AC-16. | `note_trash` as written (a second trash path; an Image object's file would stay behind) | §2.4, §12.6, FR-HIS-01 AC-16 |
| CP-2 | **A property write that meets a changed file.** FR-EDT-07 AC-26 wants an alert and a reload; on the desktop a panel commit is a pending change of the note (types.md FR-EDT-07 AC-4) and a conflict opens the merge dialog, and AC-26's third bullet (one write with a body edit) needs that same path. An alert and reload would drop the user's value. | The merge banner (§10.6), which keeps the value as `Your version`; AC fix to FR-EDT-07 AC-26's first bullet (and FR-SYN-03 AC-42 row 2 names the banner). | AC-26 as written: when only property commits are pending, drop them with the alert and reload | §2.4, §10.5, FR-EDT-07 AC-26, FR-SYN-03 AC-42 |
| CP-3 | **Surviving the renderer's death.** wry's `WebViewClient` doesn't override `onRenderProcessGone`, so today Android kills the app. A dead WebView can't be reused. | The plugin wraps wry's client, returns `true` and calls `activity.recreate()` (§6.2). Needs a build check that Tauri 2.12 rebuilds its WebView on a recreated activity with the core still open; if it can't, CP-3's alternative and an AC fix to FR-EDT-08 AC-18 ("the process keeps running"). | Restart the process (a `PendingIntent` restart, then `killProcess`): the vault reopens, at most 1 s of typing lost as well | §6.2, FR-EDT-08 AC-18 |
| CP-4 | **Where recovery copies live and how they come back.** | Four Android-only commands (§2.2) keep one JSON file per vault and note in `<files_dir>/recovery/`; the copy is offered when that note next opens (the landing reopens it after a kill, D-2421), and dropped after any choice or a later successful save. | Keep them in `ui-state.json` (no new commands; the whole file rewritten with note text in it) | §2.2, §11.2, FR-EDT-08 AC-17 |
| CP-5 | **Showing the keyboard for a draft's `Title`.** Chromium shows the keyboard on a script `focus()` only with a recent user activation; the draft opens after an async route change. FR-VLT-05 AC-17 and FR-EDT-01 AC-16 need the keyboard there, deterministically. The merge banner must also hide it. | An Android-only command `android_ime { show }` (the plugin's `InputMethodManager` call), sent after focusing `Title` and when the banner appears. | Rely on the tap's transient activation and `blur()` only (no new command; may fail on a slow route) | §2.2, §6.1, §7.5, §10.6 |
| CP-6 | **The flush during a composition.** The desktop's saver never writes while composing (editor FR-EDT-08 AC-12); FR-EDT-08 AC-15 wants `hidden` to save the composing word. | `Saver.flush({ composing: true })` on `hidden` only, saving the doc as shown without ending the composition; every other write keeps waiting (§11.1). | Ask the keyboard to finish the composition first (`android_ime(false)` hides it, which commits on most keyboards, not all) | §11.1, FR-EDT-08 AC-15, AC-16 |
| CP-7 | **How the page knows a file has an NFD name.** | `NoteDto.nfdName` (and `EmbedNoteDto.nfdName`), always `false` on macOS; the refusal stays in the core as the backstop with a new `IpcError` kind `ReadOnlyName`. | An Android-only command `android_name_form(path)` (no shared DTO change, one more call per open) | §2.3, §3.1, §7.1, FR-FMT-12 AC-18 |
| CP-8 | **Command ids for controls FR-UX-03 AC-60 names but RA15 doesn't.** The Inbox row's `Reviewed` (desktop: `inbox.markReviewed`, under the hidden `inbox.*`), the `Block type` row, the link panel's `Remove link` (desktop `link.remove`, hidden), the banner, the offer, the conflict actions, the sheet's controls. | Per-row page ids inside AC-60's list (`note.markReviewed:<path>`, `task.complete:<path>`, `edit.blockType:<choice>`) and phone-own `phone.*` ids for the rest (§13.3); no further desktop command comes off `PHONE_HIDDEN_COMMANDS`. | Unhide the desktop's `inbox.markReviewed`, `inbox.markUnreviewed` and `link.remove` (an AC fix to AC-60's "exactly") | §12.2, §13, FR-UX-03 AC-60 |
| CP-9 | **RA19's keys or the existing ones.** RA19 proposes `phone.edit.bar`, `phone.edit.bold`, `phone.edit.italic`, `phone.edit.link`, `phone.edit.text`, `phone.edit.bulletList`, `phone.edit.checklist`, whose texts equal `toolbar.*` and `slash.*` keys. | Reuse the existing keys; new keys only for new texts (§14). | RA19's keys as written (duplicate texts in the catalog, translated twice) | §8, §14, NFR-OTH-02 AC-27 |
| CP-10 | **Back while the merge banner is shown.** FR-SYN-03 AC-41 says Back moves the focus to the banner. The deleted alert (AC-43) has unsaved edits too. | Both: `systemBack()`'s new first-after-overlays step focuses the banner or the deleted alert while either is shown; Back works again after a choice. | The merge banner only (Back from the deleted alert leaves; the edits go to a recovery copy on `hidden`) | §10.6, FR-SYN-03 AC-41, AC-43 |
| CP-11 | **The GitHub asset.** AR-08 AC-7 wants "the release command's plan for GitHub" to attach the APK; today the release script stops at the install, and the release is published by a separate `gh release create` step. | A pure `githubRelease()` (§4.6) that the script prints at the end with the three assets; publishing stays a separate step. L1 checks the command. | The script runs `gh release create` itself behind `--publish` | §4.6, §16.1, AR-08 AC-7 |
| CP-12 | **What the editor does with the caret beside a protected mindmap.** FR-MMP-02 AC-37 lists the edits that must leave the callout's lines; it doesn't say whether a selection across the block is narrowed or refused. | Narrowed: the selected text outside the block is deleted or replaced; the block stays (§5.2), matching "those edits change only the paragraphs". | Refused: the edit does nothing while the selection touches the block | §5.2, FR-MMP-02 AC-37 |
| CP-13 | **How LA talks to the test IME.** | Ordered broadcasts to the IME's own receiver, text in base64, result data `ok` (so a test knows the call ran); a `type` operation that types inside the IME at a fixed interval for the timing ACs (FR-SYN-02 AC-16, NFR-PERF-06 AC-8), since one `adb` call takes 50–150 ms. | One broadcast per key from the test (simpler; intervals at the mercy of `adb`) | §16.2, §17.2 |
| CP-14 | **RA16 on WebKit.** WebKit has no IME API in Playwright; RA16's L5p rows run "on both engines". | Chromium is authoritative (CDP IME calls); WebKit runs the same steps as synthetic events with `execCommand` defaults (§17.1), and a step WebKit can't reproduce is skipped on WebKit only, as D-2471 allows for the pinch. | Run RA16's keyboard-input cases on Chromium only (an AC fix to the layer line) | §17.1, FR-EDT-01 AC-19, AC-20, FR-EDT-04 AC-5, FR-EDT-08 AC-15 |

## 23. Notes on the ACs (readings, not decisions)

- **AR-08 AC-7's test location.** The ACs put it "in `tools/qa/test/` with the release script's L1 tests"; those tests
  are in `app/test/release_plan.ac.test.ts`, where AC-7's test goes (§16.1). An AC fix is listed.
- **FR-VLT-05 AC-17's "not the desktop's quick-add row".** Since D-1906 the desktop's `New object › Task` opens a
  `new/task` draft too (`newOf`); the phone does the same. The wording is kept as a reminder.
- **FR-UX-03 AC-60's "hidden commands AND-3 shows are exactly …".** Read as: the desktop ids that leave
  `PHONE_HIDDEN_COMMANDS` (or become exceptions) are exactly those, counting their `:<param>` page forms; new phone-own
  ids (§13.3) are allowed. Listbox options in the panels (`role="option"`) stay exempt as rows of object lists, as on
  the desktop.
- **FR-SYN-03 AC-41's conflict file name.** `Pages/Psaní (conflict 2026-10-14 12-00).md` is NotePage's existing
  `stamp()` (the app's zone), unchanged.
- **FR-SYN-04 AC-14's `Give the copy a new id`.** Offered where the desktop offers it: pairs of kind `duplicateId`.
  The `conflicts/` fixture's Rozpočet pair must be of that kind for the bullet to hold.
- **FR-EDT-01 AC-16's "Opening … puts no caret in it".** The focus goes to the `h1` (§7.5); FR-NAV-03's Back restores
  scroll, not the caret, on the phone (the caret restore would raise the keyboard).
- **RA14's `Save state` "left of `More actions`".** Read as: in the app bar's right group, before `More actions` (§7.3).
- **FR-FMT-12 AC-18's `[[Poznámka` create → `Quick Notes/Poznámka (2).md`.** The core's vault-wide stem rule
  (backlinks.md FR-LNK-14 AC-10) already gives it; the NFD file is counted under its NFC stem.
- **FR-SYN-02 AC-17's "NFC and case-insensitively, as shared storage compares names".** FUSE's own check covers it on
  the device; `name_taken` (§3.2) makes the same check on a case-sensitive host, so the L4 test doesn't depend on the
  host's file system.
- **NFR-PERF-05 AC-7's `note-ready` "no caret".** The phone's mark moves from "caret placed" (the desktop's) to "mounted
  and editable" only on the phone; the desktop mark is unchanged.
- **FR-EDT-08 AC-16 (d) "removed from Recents".** Android sends `onStop` and `hidden` before the task goes; the flush
  is the same as HOME's. The LA helper `removeTask` removes the task through `am`.
