# Android MVP: a minimal Tegg APK on a local folder (2026-11-20)

Status: **accepted by the owner on 2026-11-20 ("Accept all"): AP-2000…AP-2012 are D-2000…D-2012 in order (BRD v1.230).** Route in the owner's words: "local folder first", then "peer-to-peer is in the future version let's start with google drive first". Nothing here is built. Next: spike AND-0 (§6).

The Android, Tauri and Google Drive facts in this plan come from general knowledge and were **not checked on a device**. Slice AND-0 (§6) checks them before any product code.

## 1. What is built

A sideloaded Android app (`.apk`) that opens a Tegg vault in a folder on the phone and lets the owner:

- browse the vault: types, pinned items, tags, type pages with their views;
- read a note;
- edit a note and save it;
- create a new object and open the daily note;
- search.

The vault is a plain local folder on the phone, kept in step with the vault's Google Drive folder. No server is involved. This happens in two stages:

1. **First APK (slices AND-1…AND-3):** a separate Drive sync app that the owner installs keeps the folder in step. Tegg itself makes no network calls (NFR-SEC-01 holds unchanged).
2. **Built-in Drive sync (slice AND-4):** Tegg syncs the folder itself through the Google Drive API, and the separate app is no longer needed. This needs an exception to NFR-SEC-01 (AP-2002).

The Mac keeps using the Google Drive desktop client (FR-SYN-01), as today.

Not in this plan (§8): the graph, Related notes, editing queries and views, peer-to-peer sync.

## 2. Where we are

- **Mobile is a planned phase with the platform open** (D-100, was D-02). The BRD expects Phase 2 API sync before mobile (D-03, FR-SYN-20…22); this plan gets a first version without it (AP-2001).
- **The core is platform-neutral** (AR-03): `tegg-format`, `tegg-vault`, `tegg-index`, `tegg-schema`, `tegg-jobs`, `tegg-core` are plain Rust crates with no Tauri dependency. Their third-party dependencies (`rusqlite` bundled, `notify`, `blake3`, `libc`, `icu_collator`, `pulldown-cmark`) are expected to build for `aarch64-linux-android`; AND-0 proves it.
- **The UI packages have no Tauri imports**: `@tegg/doc`, `@tegg/editor`, `@tegg/schema`; only `app/ui/src/ipc` talks to the shell. Jobs run in a Web Worker in the webview (D-82), which Android's WebView supports.
- **The shell is desktop-only today**: `app/src-tauri` (about 7,900 lines) uses the tray icon, `macos-private-api`, global hotkeys, the capture window, the import window, the mouse back/forward hook, native menus and the folder dialog.
- **There is no phone layout.** FR-UX-04 (responsive layout) was moved to v1.0 (D-374) and is not built. The 44 pt touch-target rule exists only as a review rule.
- **The WebKit test layer does not cover Android.** Android's WebView is Chromium; the gates run WebKit.
- **Tauri mobile is newer than its desktop side** (risk R-07, which asks for a spike before mobile).

## 3. Approach

### 3.1 One codebase

The Android app is a second target of the same Tauri 2 project: the same Rust core, the same React UI, the same `@tegg/doc` text engine.

A native Kotlin app was considered and rejected: it would need a second Markdown reader and writer, which breaks "one text engine" (D-82, ADR 0003) and puts round-trip safety (FR-FMT-07) at risk.

### 3.2 The shell

- `app/src-tauri` gets a mobile entry point next to the desktop one. Desktop-only modules are compiled out on Android: tray, global hotkeys, capture window, import window, mouse-button hook, menus, multi-window.
- IPC commands that the phone UI needs stay; commands for excluded features (§8) are not registered on Android, so the UI cannot call them.
- Machine-local data (index, UI state) goes to the app's private storage, the Android twin of `~/Library/Application Support/Tegg/` (FR-STO-07). It is never written to the vault.

### 3.3 The vault folder

Two places the vault can live (AP-2003):

| Place | Sync apps can reach it | Permission | Notes |
| --- | --- | --- | --- |
| A folder in shared storage (for example `Documents/Tegg`) | Yes | "All files access" (`MANAGE_EXTERNAL_STORAGE`) | Needed while a separate app does the sync. Fine for a sideloaded app; Google Play restricts it. |
| The app's private storage | No | None | Enough once Tegg syncs by itself (AND-4), or for a vault that never syncs. |

The plan uses **shared storage** for the first APK, because a vault that can't sync with the Mac is of little use. With AND-4 a new vault can live in private storage and the permission is no longer needed. The core reads and writes it through `tegg-vault` with ordinary paths, so atomic writes (FR-SYN-02), minimal writes (FR-SYN-06) and the watcher (FR-SYN-03) work as on the Mac. Android's Storage Access Framework is not used: it gives no real paths, no rename-into-place and no watcher.

### 3.4 Sync: Google Drive

Tegg cannot open Drive files in place on Android: there is no Drive folder on the file system, and Drive's file picker does not give access to a whole folder. So the phone always holds a **local copy** of the vault, and something keeps it in step with Drive.

**Stage 1: a separate Drive sync app (first APK)**

- **Mac:** the Google Drive desktop client, as today. **Phone:** a two-way Drive folder sync app (for example Autosync for Google Drive, AP-2004) syncs the vault's Drive folder into the shared-storage folder that Tegg opens.
- Tegg sees a folder that changes underneath it, which is the case FR-SYN-01…07 already cover. No sync code and no network access in Tegg.
- AND-0 confirms three things about the app: it syncs the hidden folders `.tegg/` and `.trash/` (some sync apps skip dot-folders), it does not upload Tegg's temporary files, and its conflict copies have a name the Conflicts view knows (Drive's own is `Name (1)`, D-757).

Limits of stage 1: the app syncs on a schedule, so changes arrive with a delay; Android restricts its background work unless it is exempt from battery saving; a third-party app gets access to the Drive account.

**Stage 2: built-in sync (AND-4)**

- **A new core crate `tegg-sync`**, platform-neutral (AR-03). The remote is behind an interface: Google Drive is the first adapter, and a peer on the local network can be a second one later (§8).
- **The vault stays a real local folder.** `tegg-vault`, the index and the editor do not change; sync is a separate step that brings the folder and Drive together.
- **Sync state is machine-local** (FR-STO-07): for each path, the Drive file, the remote checksum and the local hash at the last sync. It lives in app storage and can be rebuilt by comparing both sides.
- **Incremental:** Drive's change list on the remote side, the watcher plus a scan on start on the local side.
- **When:** on start, on return to the app, after a save, and on request. Only while Tegg is open; no background service in this version.
- **Files are matched by path, not by Drive file ID**, because the Mac client may upload Tegg's atomic write as a delete and a create. Drive also allows two files with one name in a folder; the adapter treats that as a conflict.
- **Conflicts follow the existing rules** (FR-SYN-20, NFR-REL-02). Before an upload the remote checksum is compared with the last synced one. If both sides changed: the open note shows the merge; any other note keeps both versions, the remote one as a conflict copy that the Conflicts view lists. Nothing is overwritten silently.
- **Deletes:** a file deleted on one side is deleted on the other only if it is unchanged there since the last sync; otherwise it is kept.
- **Writes stay atomic and minimal** (FR-SYN-02, FR-SYN-06): a download is written to a temp file and renamed; an unchanged file is never uploaded or rewritten.
- **Attachments on demand:** files in `_attachments/` are downloaded when a note that shows them is opened, with a setting to download all. Notes, `.tegg/` and `.trash/` always sync fully.
- **Sign-in:** the owner's own Google Cloud project and the full `drive` scope (AP-2005). The narrower `drive.file` scope cannot see files that the Mac client uploaded. The token is kept in the Android Keystore, never in the vault.
- **Network:** opt-in, Google's API hosts only (AP-2002). No telemetry, nothing else.

The Mac is not changed: it keeps the desktop client. FR-SYN-21 (no mixing of folder sync and API sync on one device) holds, because each device uses one route.

### 3.5 The phone layout

A new layout for narrow screens, chosen by window width so the same build also serves a narrow desktop window later (FR-UX-04):

- one column; the sidebar becomes a drawer;
- **a note opens as its own full-screen page**, never beside the sidebar (owner, 2026-11-20, on the first emulator screenshot: "we should open each note as a new tab/page"). Whether open notes are also kept as tabs to switch between is settled on the design boards;
- no right panel (Backlinks, Graph, Related are out, §8);
- a bottom bar: sidebar, search, new object, today's daily note;
- touch targets ≥ 44 pt (FR-UX-04);
- light and dark themes (FR-UX-05), following the system setting.

Design boards for the phone screens come before the ACs, as for other slices (AP-2008).

### 3.6 Views on the phone

Type pages and query pages show their saved views **read-only**:

- **List:** as on the desktop.
- **Table:** scrolls sideways; the first column stays in place.
- **Board:** lanes scroll sideways; no dragging of cards.

Sort, columns, grouping and filters are shown as saved. The controls that change them are hidden (AP-2006).

### 3.7 The editor

`@tegg/editor` as it is, plus:

- a formatting bar above the on-screen keyboard (the phone has no ⌘ shortcuts): heading, list, task, bold, italic, link, undo;
- `[[` link completion and `#` tag completion in a sheet sized for touch;
- task checkboxes toggle by tap, in the read view too.

The main risk is typing: ProseMirror with Android keyboards (Gboard composition, autocorrect, Czech diacritics) is a known trouble area. AND-0 tests it before anything is built on it.

Saving follows the desktop rules: only what changed is re-serialized (FR-FMT-07), writes are atomic, and an external change to the open note reloads it or shows the merge (NFR-REL-02).

### 3.8 No bulk jobs on the phone

Renaming a title (which rewrites links across the vault, FR-FMT-08), type moves, tag renames and schema changes are **not offered** on Android in this version (AP-2007). A bulk rewrite on a vault that is only partly synced is the largest data-loss risk in this plan, and restore points (FR-HIS-04) depend on version history that the phone does not have yet.

A new object still gets its file name from its title when it is created. Changing the title afterwards is done on the Mac.

## 4. Scope

**In:**

| Area | What |
| --- | --- |
| Vault | Choose a folder, open it, index it, reopen the last vault on start |
| Navigation | Drawer with Types, Pinned, Tags, Inbox; back navigation with the system back gesture |
| Type and query pages | List, Table, Board views, read-only (§3.6) |
| Reading | Read view with links, embeds, images, callouts, mindmaps (drawn, not editable), tables |
| Editing | Body text, lists, tasks, headings, links, tags; attribute values of the open object |
| Creating | New object with the type picker (D-1431), today's daily note |
| Tasks | All tasks view (read), checkbox toggle |
| Search | The Search page (title-first, D-1340…D-1343) |
| Sync safety | Watcher, silent reload, merge on both-changed, Conflicts view |
| Sync (AND-4) | Sign in to Google, choose the vault's Drive folder, sync on start, on return to the app, after a save and on request |

**Out** is listed in §8.

## 5. Testing

All testing stays local (D-60), through `./verify`.

- **Cross-compile check:** `cargo check --target aarch64-linux-android` for the core crates and the shell, as a new step in `qa.config.json` (push gate).
- **Core behaviour:** unchanged; the existing Rust AC tests cover the crates. A run of the core test suite on the Android emulator is added to the nightly gate if AND-0 shows differences in file-system behaviour (case sensitivity, rename, watcher).
- **Phone layout and views:** component and WebKit tests at phone width, plus a Chromium run of the same tests, because Android's WebView is Chromium (AP-2009).
- **Real-app tests (D-382):** Appium with the UiAutomator2 driver on an arm64 emulator on the owner's Mac, the Android twin of the `mac2` suite. They use synthetic and generated vaults only (D-62).
- **Round trip on the device:** the round-trip corpus (`tests/fixtures/format/roundtrip/`) is opened and saved through the Android build; every file must stay byte-identical (FR-FMT-07, AR-06).
- **Performance:** new phone targets are needed (AP-2010). The Mac's NFR-PERF targets do not apply to a phone; AND-0 measures index build and note open times on the 5,000-note vault so the targets are set from numbers.
- **Sync:** `tegg-sync` is tested against a fake in-memory remote, so no test touches the network or a real account (D-60, D-62): both-changed, delete on either side, duplicate names, an interrupted run, a kill between download and rename. Runs against the real Drive with the Mac are manual, like the two-Mac sync checks of MS8.

## 6. Slices

Each slice follows the usual order: ACs, owner approval, contract, red tests by a separate agent (D-61), build, QA review.

**AND-0: spike (throwaway code, report kept in `spikes/android/FINDINGS.md`)**

Go or no-go on:

1. The core crates and the shell compile for Android and the current app starts on an emulator and on the owner's phone.
2. Index build time and note open time on the 5,000-note vault (`tools/gen-vault --small-images`).
3. Typing in the editor with Gboard: Czech diacritics, autocorrect, composition, Enter in lists, backspace at block starts.
4. Round-trip corpus byte-identical through the Android build.
5. "All files access": real paths, atomic rename and the watcher work in shared storage.
6. The separate Drive sync app: it syncs the hidden folders `.tegg/` and `.trash/`, it does not upload Tegg's temporary files, and what it names a conflict copy.
7. The Drive API, for AND-4: sign-in with the full `drive` scope on the owner's own Google Cloud project and how long the token lasts; the change list; how the Mac client's uploads of Tegg's atomic writes appear (an update of the same file, or a delete and a create).

**AND-1: shell.** Mobile entry point, desktop modules compiled out, vault folder choice and permission, index in app storage, a signed release APK built by one command.

**AND-2: phone layout and reading.** Drawer, bottom bar, type and query pages with read-only views, read view, search, themes.

**AND-3: editing and creating.** Editor with the formatting bar, save, external-change handling, new object, daily note, task toggle.

After AND-3 the owner has a usable APK, with the separate Drive sync app.

**AND-4: built-in Google Drive sync.** The `tegg-sync` crate with a fake remote for tests, the Drive adapter, sign-in, sync state on the phone, conflicts, attachments on demand, a sync status in the UI (§3.4). After AND-4 the separate app is no longer needed.

Releases follow the desktop convention (D-1514): the same version number, an `.apk` built next to `Tegg.app` (AP-2011). **The first released APK ships after AND-3** (D-2042, owner 2026-11-22: "lets wait till and-3 with apk"): 0.5.0 stays Mac only; AND-1 and AND-2 builds are unversioned test builds showing `dev`, installed by hand for the owner's phone checks; the APK's first release is its own MINOR release after AND-3, and AND-4 a later one.

## 7. Risks

| Risk | What reduces it |
| --- | --- |
| Editor typing is unreliable with Android keyboards | AND-0 item 3; if it fails, the plan stops and the options go to the owner |
| Tauri's Android target lacks something the shell needs (R-07) | AND-0 item 1 |
| A partly synced vault looks like data loss (missing notes, broken links) | No bulk jobs (§3.8); links resolve by file and `id` (FR-LNK-14), a missing target shows as unresolved, nothing is rewritten |
| Sync conflicts between phone and Mac edits | The existing merge and Conflicts rules (§3.4) |
| The phone is too slow for a large vault | AND-0 item 2; images are not thumbnailed at index time |
| "All files access" is refused or removed by a later Android version | App-private storage stays as a fallback for an unsynced vault |
| The separate Drive sync app misbehaves or disappears | It is needed only until AND-4; the vault is a plain folder, so any folder sync app replaces it |
| The Mac's atomic writes reach Drive as delete-and-create, so Drive file IDs change | Built-in sync keys files by path, not by Drive ID (§3.4); AND-0 item 7 |
| Google changes the OAuth rules for the full `drive` scope | AND-0 item 7; the separate sync app stays as the fallback |

## 8. Not in this version

- The graph (full view and panel), Related notes, Backlinks panel, object previews, the outline rail.
- Creating or editing saved queries and views; the query block renders but its settings can't be changed.
- Type settings, schema changes, type moves, title rename, tag rename (§3.8).
- Capacities import, the capture window, the menu bar item, global hotkeys.
- Mindmap editing, trash management (restore, empty), version history.
- Tablet layout.
- **Peer-to-peer sync** (owner, 2026-11-20: a future version). Later path: a second adapter of the `tegg-sync` engine of AND-4 (discovery on the local network, pairing by QR code, encrypted transport, a listener in the Mac app). Until then a folder sync app such as Syncthing works on the same local folder without any change in Tegg, apart from its conflict-file name, which the Conflicts view does not know.
- Sync in the background while Tegg is closed; Dropbox and iCloud API sync (FR-SYN-20, FR-SYN-22); built-in sync on the Mac (FR-SYN-21).
- Google Play distribution, iOS.

## 9. Points for the owner

| Point | Question | Proposed |
| --- | --- | --- |
| AP-2000 | Which mobile platform (D-100 left it open)? | Android first; iOS undecided |
| AP-2001 | D-03 and FR-SYN-20 make API sync a prerequisite for mobile. May the first APK ship before it? | Yes: AND-1…AND-3 run on a local folder synced by a separate Drive app; built-in Drive sync follows as AND-4 |
| AP-2002 | NFR-SEC-01 allows no network calls except opt-in update checks. Is built-in Drive sync a second exception? | Yes, from AND-4: opt-in, Google's API hosts only, nothing else. Until then the APK has no `INTERNET` permission |
| AP-2003 | Where does the vault live on the phone? | Shared storage with "All files access" for the first APK; app-private storage becomes possible with AND-4 |
| AP-2004 | Which separate Drive sync app do the setup notes name for the first APK? | Autosync for Google Drive, if it passes AND-0 item 6; Tegg does not depend on it or detect it |
| AP-2005 | How does built-in sync sign in to Google? | The owner's own Google Cloud project, the full `drive` scope, sign-in in the system browser, the token in the Android Keystore |
| AP-2006 | Are views read-only on the phone (no sort, column, group or filter changes)? | Yes |
| AP-2007 | Are bulk jobs, including title rename, off on the phone? | Yes |
| AP-2008 | Who makes the phone design boards? | The owner's boards first, as for slice REL (AP-1432) |
| AP-2009 | Is a Chromium run of the UI tests added to the gates? | Yes, push gate for phone-layout tests, nightly for the rest |
| AP-2010 | Phone performance targets and the reference phone | The owner's phone; targets set from AND-0's numbers |
| AP-2011 | Versioning and release of the APK | Same version as `Tegg.app`, built by `npm run app:release`; signed with the owner's own key, sideloaded |
| AP-2012 | Where does this sit in the release phasing (§11)? | A separate track after v1.0 items in progress; AND-0 can run at any time |
