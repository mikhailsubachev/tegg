# MS5 Capture and Inbox Interface Contract (slice 5B)

- **Status:** accepted, 2026-10-19. Written before the 5B red tests (D-552, as D-487). Follows D-539…D-567 (BRD v1.72); §13's AP-495 is decided as D-567.
- **ACs:** [docs/acceptance/capture.md](../acceptance/capture.md) (FR-CAP-01 AC-1…AC-14, FR-CAP-03 AC-1…AC-5, FR-CAP-04 AC-1…AC-8, FR-CAP-05 AC-1…AC-9, FR-TSK-10 AC-9…AC-12, FR-VLT-05 AC-1…AC-7, FR-SET-01 AC-1…AC-10, FR-SET-03 AC-1…AC-5, FR-SET-05 AC-1…AC-6, NFR-SEC-03 AC-1…AC-5, NFR-PERF-10 AC-2…AC-5, FR-SYN-06 AC-24, AC-25; tables R55…R59) and [docs/acceptance/inbox.md](../acceptance/inbox.md) (FR-INB-01 AC-1…AC-11, FR-INB-02 AC-1…AC-15, FR-INB-03 AC-1…AC-6, FR-INB-04 AC-1…AC-3, FR-NAV-02 AC-1, FR-NAV-04 AC-1…AC-5, FR-NAV-05 AC-1, FR-DLY-05 AC-5, FR-FMT-07 AC-21, FR-SYN-06 AC-26…AC-28; tables R60…R63). Where this contract and the ACs disagree, the ACs win, and this contract is corrected before the red tests.
- **Builds on** [ms3-shell.md](ms3-shell.md) (§1 launching and test hooks, §5 fake core, §13.2 `note_read` / `note_write`, §14 types and the creation path §14.2.3), [ms4-links.md](ms4-links.md) (§1 resolution, §3.1 free stem, D-184 link text), [ms4-daily.md](ms4-daily.md) (§1 dates, `daily_create`), [ms4-jobs.md](ms4-jobs.md) (job engine, transformer, backups) and [ms5-tasks.md](ms5-tasks.md) (§1 clock and first weekday, §6.4 quick-add parsing). Everything in those contracts stays valid unless this one changes it.
- **Writes.** A capture is one create-exclusive file (`capture_create`). A single Inbox action is one `note_write` with a base version (Append to: two, target first). A settings change is one file (`vault_settings_patch` or `type_patch`). An Inbox action on more than one file is a `tegg-jobs` job of the new kind `inbox` (§7.3); only a bulk convert makes a backup zip (D-561).

Until a part is implemented, it exists as a stub that compiles and returns a deliberately wrong result (an empty list, `None`, the input unchanged, or an `Io` error). A test then fails on its assertion, never on a build or import error (TS-I1).

---

## 1. Process, windows and lifecycle (`app/src-tauri`)

### 1.1 Plugins and dependencies

| Need | Choice |
| --- | --- |
| Status item | Tauri's `tray-icon` feature (as S3); template image `icons/tray.png` (+ `@2x`) |
| Global hotkeys | `tauri-plugin-global-shortcut` 2 (as S3) |
| Single instance (D-71) | `tauri-plugin-single-instance` 2, registered first; the second launch's callback shows the main window (§1.3) and exits the second process |
| Login item (FR-SET-05) | `SMAppService.mainAppService` through `objc2-service-management` (`register` / `unregister` / `status`); listed under Login Items › Open at Login |
| Previous app | `NSWorkspace.frontmostApplication` (objc2-app-kit, already a dependency) |

No other plugin. No `fs`, `shell`, `clipboard-manager`, `opener` or `http` plugin (NFR-SEC-01, NFR-SEC-03).

### 1.2 Windows

| Label | Page | Created | Properties |
| --- | --- | --- | --- |
| `main` | `index.html` | at startup (as today) | **hidden** at startup when launched at login (§1.5); otherwise shown |
| `capture` | `capture.html` | at startup, hidden (pre-warmed, FR-CAP-03) | 420 pt wide, height set by the page (`capture_resize(height)`), not resizable, no title bar (`decorations: false`, rounded transparent background), `always_on_top`, `skip_taskbar`, `visible_on_all_workspaces` (current Space, also over full-screen apps), the same `initialization_script` as `main` (UI state, region, test mode, TZ, clock) |
| `capture-saved` | `capture.html#saved` | at startup, hidden | the confirmation panel (R55 "After saving"): 320 × 64 pt, no title bar, `always_on_top`, `focused(false)`; shown with `orderFrontRegardless` without making it key, hidden after 4 s |

- **Closing the main window hides it** (close button, ⌘W): `CloseRequested` → `prevent_close` and `hide()`; the app keeps running (FR-CAP-03 AC-1). The current D-196 save-before-exit flow moves from `CloseRequested` to quitting only (⌘Q, `Quit Tegg`, the Quit Apple Event).
- **Dock click** (`RunEvent::Reopen`) shows and focuses `main` on its current route. The activation policy stays `Regular` (Dock icon always; FR-SET-05 AC-3).
- **Closing or hiding `capture`** never quits the app.

### 1.3 Opening the capture window

`open_capture(trigger, kind)` in the shell, for every trigger:

| Trigger | `trigger` | `kind` |
| --- | --- | --- |
| Status item click | `status-item` | `default` |
| Status menu `Quick Capture` / `New Task` | `status-menu` | `default` / `task` |
| ⌃⌥Space / ⌃⌥T | `hotkey` | `default` / `task` |
| Palette `Quick Capture` / `Capture a task`, Inbox zero `Quick Capture` | `palette` | `default` / `task` |

Steps: record `t0 = Instant::now()` and a new `seq`; record the frontmost application (unless it is Tegg); emit `capture:open { seq, trigger, kind }` to `capture`; position it (below the status item's rect for `status-item` / `status-menu`; else centred horizontally in the upper third of the screen with the pointer, D-542); `show()` and `set_focus()`. When `capture` is already visible: emit the same event (the page keeps its text; `task` switches the type, D-542) and focus it. The main window is never shown or ordered front by this path (FR-CAP-03 AC-3).

Hiding (`capture_hide`): `hide()`, then re-activate the recorded application (`NSRunningApplication.activateWithOptions`) when Tegg's main window isn't visible or wasn't key before the trigger (FR-CAP-01 AC-4).

### 1.4 Status item (R56, D-547)

Built at startup when `showStatusItem` (§5.2) is true; removed and rebuilt by `shell_settings_set`. `show_menu_on_left_click(false)`; left click → `open_capture(status-item, default)`; the menu (R56 strings from the shell's own catalog, §9) shows ⌃⌥Space / ⌃⌥T as accelerators only while that hotkey is `active`. `Open Tegg` shows `main`; `Settings…` shows `main` and emits `shell:route { route: 'settings/appearance' }`; `Quit Tegg` runs the quit flow.

### 1.5 Launch at login (D-547)

The app counts as launched at login when the launch Apple event carries `keyAELaunchedAsLogInItem`, or with `TEGG_TEST=1` and `TEGG_TEST_LAUNCHED_AT_LOGIN=1`. Then `main` is created hidden; the vault opens as usual; the status item and hotkeys are set up; the first Dock click or `Open Tegg` shows `main` on the D-132 landing route.

### 1.6 Global hotkeys (FR-CAP-05, D-548)

Fixed: `quick-capture` = ⌃⌥Space, `new-task` = ⌃⌥T (not stored, FR-CAP-05 AC-8). Registered at startup after the status item; each registration result is kept as `HotkeyState { id, keys: "⌃⌥Space", state: 'active' | 'taken' }`. Changes emit `hotkeys:state` (the whole list) to `main`. Unregistered on quit (the plugin's drop; FR-CAP-05 AC-7).

## 2. IPC of the capture window (capability `capture`, NFR-SEC-03)

### 2.1 Capabilities (D-552, D-553)

`build.rs` declares the app's commands with `tauri_build::Attributes::app_manifest(AppManifest::new().commands(&[...]))`, so every command needs an explicit `allow-<command>` permission:

- `capabilities/default.json`: windows `["main"]`; today's permissions plus `allow-<command>` for every main-window command (all commands except §2.2's capture-only ones).
- `capabilities/capture.json` (new): windows `["capture", "capture-saved"]`; exactly `core:event:allow-listen`, `core:event:allow-unlisten`, `core:window:allow-start-dragging` and the `allow-` permissions of §2.2. No plugin permission.

A refused call never reaches a command function (NFR-SEC-03 AC-2, tested through `tauri::test::mock_builder` with the window label `capture`).

### 2.2 Commands

| Command | Args | Returns | Notes |
| --- | --- | --- | --- |
| `capture_context` | — | `CaptureContextDto` | Everything the window may read (D-553): see below. |
| `capture_create` | `vault: string` (the `vaultId` it showed), `type`, `title`, `text` | `CapturedDto { path, title, typeName }` | §3.3. Errors: `NoVault`, `VaultChanged`, `UnsupportedType`, `NotACapture`, `Io`. |
| `capture_ready` | `seq` | — | Writes the `capture-ready` mark (§8) once per `seq`. |
| `capture_hide` | — | — | §1.3 hiding. |
| `capture_resize` | `height` | — | Sets the window's content height (min 160, max 560 pt). |
| `capture_open_main` | `path: string \| null` | — | Shows `main`; with a path emits `shell:route { route: 'note/<path>' }` (the panel's `Open`, FR-CAP-01 AC-13; `Open Tegg`). |
| `capture_draft_get` / `capture_draft_set` | — / `draft: CaptureDraftDto \| null` | `CaptureDraftDto \| null` / — | `capture-draft.json` in Application Support (FR-STO-07, FR-CAP-01 AC-8); `null` deletes it. |
| `capture_saved_show` | `typeName`, `title`, `path` | — | Fills and shows `capture-saved` for 4 s (§1.2). |

```ts
type CaptureContextDto = {
  vault: { id: string; name: string; color: string | null } | null; // id: an opaque token that changes when another vault opens
  types: CaptureTypeDto[];       // R55 order: Page, Task, Quick Note, then user types by D-122 (the UI sorts with its collator)
  defaultType: string;           // capture's default key (D-541: Daily Note or invalid → quick-note)
  tags: string[];                // index tag names in D-185 spelling
};
type CaptureTypeDto = {
  key: string; name: string; icon: string; color: string; folder: string;
  review: 'off' | 'on' | 'locked';
  attributes: { key: string; type: string; default?: unknown; options?: { label: string; color?: string | null; state?: string | null }[] }[];
  templateHead: string | null;   // the default template's frontmatter block only, `---` lines included, no body (D-567)
};
type CaptureDraftDto = { text: string; type: string; tags: string[]; due: string | null; priority: string | null; savedAt: string };
```

Events to `capture`: `capture:open { seq, trigger, kind }`; `capture:context-changed` (after `vault:changed` touching `.tegg/`, a tag change, or a vault switch; the page re-reads `capture_context` within 2 s, FR-VLT-05 AC-5, FR-CAP-04 AC-8). The capture window gets no `vault:changed` payloads (paths stay in the main window).

### 2.3 What the capture page never does (NFR-SEC-03 AC-4)

No `navigator.clipboard`, no clipboard plugin, no `postMessage`, no `window.open`, no fetch. Paste works only through the textarea's native ⌘V. A pasted image (`paste` event with an image item) is prevented and shows `capture.mediaLater` (D-545); a dropped file is prevented (`dragover`/`drop` default prevented on the document).

## 3. Capture text → object

### 3.1 `@tegg/doc` `capture.ts` (new, exported from the index)

```ts
/** R57 (D-539): title, body and trailing tags of a capture's text. NFC, CRLF → LF. */
export function captureParts(text: string, linkTitle: (target: string) => string | null): {
  title: string;        // '' when no line has non-space characters
  body: string;         // '' or ending with exactly one '\n'
  tags: string[];       // trailing `#tag` tokens of the title line, in order, as written (without '#')
  keptTitleLine: boolean;
};
```

- The title line's plain text uses `objectFromUnit`'s first-line rules (ms5-tasks §11.1, D-491); `linkTitle` gives a link's target title when it has no alias (the capture window has no index access: it passes `() => null`, so an alias-less link's title is its target text without folder and `.md`; §12 item 2).
- The UI turns `title === ''` into `Untitled` (D-523) only when saving.

### 3.2 `newObject` gains `captured` (D-540)

`newObject({ …, captured?: string })`. With `captured`: `review: unreviewed` is written whatever `type.review` is; `captured: <captured>` follows it; then `created`, `modified` (both = `now`, and the caller passes `captured === now`); the template's `id, type, title, tags, review, captured, created, modified` entries are ignored; `body` is required (the template's body is never used). The capture window builds the template input from `templateHead` (§2.2).

Task fields: `values` gets `priority` (the chosen label, as written) and `due` (`{ date }`) when set; `status` comes from the D-470 rule already in `newObject`. `tags` = the chips, then `captureParts().tags`, duplicates dropped by `tagKey` (first spelling wins), NFC.

### 3.3 Core `capture_create` (`tegg-core`, `capture5b.rs`)

`Core::capture_create(type_key, title, bytes) -> Result<String, CoreError>`:

1. `type_key` matched by D-239; `daily-note`, `tag`, `image`, `pdf` and unknown keys → `UnsupportedType`.
2. The bytes' frontmatter must carry this type (as `create_object`), `review: unreviewed` and a `captured` value → else `NotACapture`.
3. Then exactly `create_object` (folder re-read now, folders created, `free_stem`, `create_file` with `RENAME_EXCL`, indexed at once). No path argument exists.

The shell command checks `vault` against the current `vaultId` (`VaultChanged`) and that a vault is open (`NoVault`) before calling the core.

### 3.4 Quick-add tokens (D-544)

The capture page reuses `app/ui/src/tasks/quickAdd.ts` (ms5-tasks §6.4, D-483) on the first line while the type is Task: on each input event the trailing tokens are moved into Due, Priority and chips; the Due control's `Clear` and the chip's remove put the token back at the end of the first line, as typed. The draft stores the text after the move.

## 4. The capture page (`app/ui/src/capture/`)

- `capture.html` is a second Vite input (`build.rollupOptions.input: { main: 'index.html', capture: 'capture.html' }`); its entry `capture/main.tsx` imports only `@tegg/doc`, `capture/*`, `i18n/*`, `theme/*`, `tasks/quickAdd.ts`, `ipc/capture.ts` (a client with §2.2's commands only) and shared presentational components (`shell/Icon`). An L0 test checks the import graph of the built `capture` chunk: no `ipc/client.ts`, no `@tegg/editor`.
- `CaptureApp.tsx` (R55), `TypeMenu.tsx`, `TagField.tsx` (also used by the Inbox's `Add tags…`, §6), `Saved.tsx` (the `#saved` panel), `draft.ts`.
- On `capture:open`: restore the draft if any (else empty), apply `kind`, focus `Capture text` with the caret at the end, wait two animation frames, call `capture_ready(seq)`.
- Save: `captureParts` → `newObject` with `now = captured = localIso(Date.now())` → `capture_create`; on success clear the draft, `capture_saved_show`, `capture_hide`; on error keep everything and show R55's status (FR-CAP-01 AC-10, AC-11). ⌘↩ while a save is in flight is ignored (one file per capture).
- Esc: empty → `capture_hide`; else `capture_draft_set` then `capture_hide`. `Discard`: `capture_draft_set(null)`, clear, `capture_hide`.
- Theme: `theme/*` with the stored theme from `__TEGG_UI_STATE__`; `ui:state` events (emitted by `ui_state_set`) re-apply theme and date format.

## 5. Settings

### 5.1 Vault settings (FR-VLT-05, FR-SET-01; D-541, D-551)

Core (`tegg-core`, `settings5b.rs`) and `tegg-schema` (`vault_yml.rs`, Rust edits YAML as for type files, D-235):

```rust
pub struct VaultSettings {
    pub version: Option<FileVersion>,          // None when vault.yml is missing
    pub default_type: DefaultTypeSetting,      // { raw: Option<String>, key: String, valid: bool }
    pub daily_format: String,                  // raw or "YYYY-MM-DD"
    pub attachments: String,                   // raw or "_attachments"
}
pub fn vault_settings(&self) -> VaultSettings;
pub fn vault_settings_patch(&self, base: Option<FileVersion>, key: VaultKey, value: String) -> Result<VaultSettings, CoreError>;
pub enum VaultKey { DefaultType, DailyFormat, Attachments }
```

- `default_type.key`: D-239 match of `raw` against the defined types; `valid = false` (key `quick-note`) when missing, empty, not a string, or no such type; a raw `Daily Note` is valid (⌘N keeps D-353). Capture's default is `quick-note` when the key is `daily-note` or invalid. `load_default_type` uses this, so the switcher's create row and ⌘N follow it. Reading never writes.
- `vault_settings_patch` writes only that key's line (`default-type: <key>`, as the type key; `daily-format`, `attachments` as given, YAML-quoted when needed, D-230), appending the key after the last entry when missing, keeping comments and other lines byte for byte; refused with `Conflict` when `base` isn't the current version, `Invalid { reason }` for a D-336-rejected format or a D-222-rejected folder (`check_folder`). Equal value → no write, `Ok`.
- The daily notes folder uses `type_patch('daily-note', base, [SetFolder])` (the whole default file is written when it is missing, D-90).

| IPC (main window) | Args | Returns |
| --- | --- | --- |
| `vault_settings` | — | `VaultSettingsDto` |
| `vault_settings_patch` | `base: VersionDto \| null`, `key: 'default-type' \| 'daily-format' \| 'attachments'`, `value` | `VaultSettingsDto` |
| `vault_reveal` | — | — (`/usr/bin/open -R <vault>`; with `TEGG_TEST=1` appends the path to `TEGG_TEST_REVEAL` instead) |

### 5.2 Machine settings (FR-SET-05, FR-SET-03; D-547, D-566)

- **Shell settings** (owned by the shell, `shell-settings.json` in Application Support): `{ showStatusItem: true, openAtLogin: false }` as defaults. IPC `shell_settings` → `ShellSettingsDto`; `shell_settings_set(settings)` applies at once (status item built/removed; login item `register`/`unregister`, or with `TEGG_TEST=1` one line `register` / `unregister` appended to `TEGG_TEST_LOGIN_ITEM`) and stores. `openAtLogin` shown on the page is `SMAppService` status when not in test mode.
- **Hotkeys:** IPC `hotkeys` → `HotkeyStateDto[]`; `hotkeys_retry(id)` re-registers that one and returns the list; event `hotkeys:state`. The main window shows the once-per-launch notice (`hotkeys.notice`) when the first `hotkeys` result after launch has a `taken` entry.
- **Date & time** in `UiStateDto.dateTime?: { date: 'region' | 'iso' | 'long'; time: 'region' | '24' | '12'; week: 'region' | 'monday' | 'sunday' }` (missing = all `region`). `app/ui/src/i18n/dates.ts` (new) is the one formatter: `formatDate(date, setting)`, `formatDateTime(instant, setting, zone)`, `firstDay(setting, region)`; every date shown in the UI (attribute panel, task rows and chips, Inbox footer, daily header, calendar) goes through it; the calendar (D-329) and Tasks bucketing (ms5-tasks §4) take `firstDay(...)` instead of `firstWeekday(region)` directly. Date inputs parse the region format and ISO whatever the setting (D-566).

## 6. Default type in the create paths (FR-VLT-05 AC-2…AC-4, D-550)

- `app/ui/src/types/defaultType.ts` (new): `defaultTypeKey(): Promise<string>` from `vault_settings` (cached, refreshed on `vault:changed` of `.tegg/vault.yml` or a type file); replaces the `switcher('?')` lookup in `App.tsx`.
- **Create offer:** the `Type` combobox is enabled (removes `ctl.typePickerLink`); its options are the capture targets (relation offers: the allowed types).
- **Switcher, `[[`, `@`:** a second create row `Create "<q>" as…` (kind `create-as`, added by the UI, not the core); it and ⌥⏎ on the create row open the shared `TypeMenu` (§4); the chosen type goes through `prepareObject(type).create(title)` (one creation path).
- **Unwritten draft:** `Change type…` on `new/<type>` replaces the draft route with `new/<other>` keeping the typed title; nothing is written (D-520, D-522).

## 7. Inbox

### 7.1 Core query (`tegg-core`, `inbox5b.rs`; R61, D-554)

```rust
pub struct InboxRow {
    pub path: String,               // NFC
    pub id: Option<String>,
    pub title: String,              // falls back to the stem (ObjectInfo rule)
    pub r#type: String,             // matched key (D-239)
    pub review_raw: Option<String>, // as written (NFC, trimmed), None when missing or not a string
    pub captured: Option<String>,   // raw values; the UI parses them (§7.2)
    pub created: Option<String>,
    pub modified: Option<String>,
    pub tags: Vec<String>,          // frontmatter then inline tags, D-185 spelling, unique by key
    pub excerpt: String,            // tegg_index::text::excerpt (plain text, ≤ 300 chars)
    pub read_only: bool,            // last read not valid UTF-8 (D-180)
}
pub fn inbox_list(&self) -> Vec<InboxRow>;   // members only, in path order
pub fn inbox_count(&self) -> usize;
```

Membership exactly R61 (D-554) from the index's stored frontmatter: `review_raw == "unreviewed"`, or type `quick-note`/`daily-note` with `review_raw != Some("reviewed")`; never `_templates/`, `.trash/`, files without frontmatter, or virtual Daily Notes. The index must store `review` and `captured` raw values (rebuilt from files, AR-01). `vault:changed` already follows index updates; a member-set change also emits `inbox:count { count }` (the sidebar, FR-NAV-04 AC-2).

| IPC | Args | Returns |
| --- | --- | --- |
| `inbox_list` | — | `InboxRowDto[]` |
| `inbox_count` | — | `number` |

### 7.2 Order and groups (`app/ui/src/inbox/bucket.ts`, pure TypeScript; D-555)

`inboxInstant(row, zone): number | null` with `@tegg/doc` `parseInstant` (offset-less in `zone`, D-365; a date alone is local midnight); `inboxOrder(rows, zone, collator)`; `inboxGroups(rows, todayLocal, firstDay, zone)` → `today | yesterday | week | older`. The page re-derives today every 30 s (the ms5-tasks §1 timer).

### 7.3 Writes

Text changes are `@tegg/doc` functions (new `inbox.ts`), each returning the new text or `unchanged`, editing only their lines (D-230 append rule; quote style kept; CRLF, BOM and final-newline state kept):

```ts
export type InboxChange =
  | { op: 'set-review'; value: 'reviewed' | 'unreviewed'; now: string }
  | { op: 'set-type'; type: string; now: string }                // writes `type`, `review: reviewed`, `modified` (D-557)
  | { op: 'add-tags'; tags: string[]; now: string }               // flow list append, unique by tagKey
  | { op: 'append-link'; target: string; now: string }            // blank line + `[[target]]` paragraph (D-559)
export function applyInboxChange(text: string, change: InboxChange): { kind: 'bytes'; text: string } | { kind: 'unchanged' };
/** D-558: `## <title>` + the item's body appended to `target`, links rewritten by `retarget` (D-184 text or null = keep). */
export function appendSection(target: string, title: string, itemBody: string, retarget: (link: string) => string | null, now: string): string;
```

- **One item:** `note_read` → `applyInboxChange` → `note_write(path, text, base)` with the version the page loaded (FR-INB-02 AC-3: `Conflict` → reload + alert). Append to: compute `retarget` by `link_resolve(itemPath, links)` vs `link_resolve(targetPath, links)` and `linkText` (ms4-links D-184) for each link whose resolution differs; write the target (`note_write`, or `daily_create(date, text)` for a virtual today, FR-DLY-02 AC-2), then the item with `set-review reviewed` (FR-INB-02 AC-7: a failed item write is retried alone).
- **Several items:** the job kind `inbox` (ms4-jobs §1 table gains a row): `JobOp::Inbox { paths, change: InboxJobChange }` (`SetReview`, `SetType`, `AddTags`, `AppendLink`); flags `needsConfirm: false` (the page confirms `Mark all reviewed` itself), `backup: true` only for `SetType` (D-561, operation label `backup.convert`), `undoable: false`, cancellable in `planning` and `backup`. The planner lists the given paths with their index versions; the transformer gets the matching new `TextOp`s (`set-review`, `set-type`, `add-tags`, `append-link`, added to `@tegg/doc` `transform` as thin wrappers of `applyInboxChange`). Changed and read-only files are skipped (`changed`, `readOnly`) and listed in the report; the page shows `inbox.skipped`.
- IPC `inbox_bulk(paths, change)` → `{ jobId }`; progress, report and cancel use the existing job IPC.

### 7.4 UI (`app/ui/src/inbox/`)

`InboxPage.tsx` (route `inbox`, R60), `Card.tsx`, `TriageMenu.tsx`, `Picker.tsx` (switcher matching without the create row; Append lists `Today's note` first), `actions.ts` (§7.3), `bucket.ts`, `selection.ts`. Virtualized card list (FR-INB-01 AC-10). Remembered filter in `UiStateDto.inbox?: { filter: string }` (D-555). The `route-ready:inbox` mark after the visible cards have painted.

## 8. Marks and timing (NFR-PERF-10)

- `capture-ready`: the shell computes `t0 → capture_ready(seq)` in ms and appends `{"mark":"capture-ready","trigger":…,"kind":…,"ms":…}` to `TEGG_PERF_LOG` (test builds only), as S3. The L6 suite also reads the external time from the accessibility tree (S3's upper bound).
- `route-ready:inbox` as every route (ms3-shell §1).
- Benchmarks: `app/e2e/perf_capture.ts` (20 runs per trigger; NFR-PERF-10 AC-2…AC-5) and `app/e2e/perf_inbox.ts` (FR-INB-01 AC-10), report-only unless `TEGG_PERF_REF=1` (D-152), in the `app-perf` step.

## 9. Strings

R59 and R63 keys in `app/ui/src/i18n/catalog.ts`. The status item's menu is built in Rust before any webview loads: its six strings live in `app/src-tauri/src/strings.rs` as a table keyed like the catalog (`menubar.*`), and an L1 test checks they equal the catalog's English values (NFR-OTH-02).

## 10. Registry (R62)

Route, tab, control, shortcut and command changes exactly as inbox.md R62, in `shell/registry.ts`. New routes `inbox`, `settings/vault`, `settings/menu-bar`, `settings/shortcuts`, `settings/date-time` are built; `capture` is removed; `home`, `pinned`, `outline` and the four Appearance extras are due `v1.0`.

## 11. Test environment, fake core and layout

### 11.1 Test hooks (only with `TEGG_TEST=1`)

| Variable | Effect |
| --- | --- |
| `TEGG_TEST_LAUNCHED_AT_LOGIN=1` | start as if launched at login (§1.5) |
| `TEGG_TEST_LOGIN_ITEM=<file>` | login item calls append `register` / `unregister` lines instead of calling `SMAppService` |
| `TEGG_TEST_REVEAL=<file>` | `vault_reveal` appends the path instead of opening Finder |
| `TEGG_TEST_FAIL_CAPTURE=io` | the next `capture_create` fails with `Io` before writing (L6 alternative to the read-only folder) |

Existing hooks apply (`TEGG_APP_SUPPORT`, `TEGG_VAULT`, `TEGG_NOW`, `TZ`, `TEGG_PERF_LOG`, `TEGG_TEST_PICK_DIR`). The L6 hotkey holder is `app/e2e/helpers/holdhotkey.swift` (Carbon `RegisterEventHotKey` for ⌃⌥Space until killed), compiled with `swiftc` into the test's temp folder by the suite's setup (Xcode is an L6 prerequisite).

### 11.2 Fake core additions (ms3-shell §5)

- Main window: `vault_settings`, `vault_settings_patch` (same line rules through a TS twin in `app/ui/test/fake-settings.ts`), `vault_reveal` (recorded), `shell_settings`, `shell_settings_set` (recorded), `hotkeys`, `hotkeys_retry` (states from `FakeOptions.hotkeys`), `inbox_list`, `inbox_count`, `inbox_bulk` (a job over the in-memory files with the real `@tegg/doc`, `FakeOptions.writeControl` honoured per path), `inbox:count` and `hotkeys:state` events.
- Capture page: `installFakeCore(page, vault, { window: 'capture' })` serves `capture.html` with §2.2's commands only (any other command rejects with `Forbidden`, as the ACL); `handle.openCapture({ trigger, kind })` emits `capture:open`; `capture_create` writes into the same in-memory files, so a second page on `index.html` sharing the handle's vault sees the capture.
- `app/ui/test/fake-inbox.ts`: the TS twin of `inbox_list` (R61) for L1 and L2.

### 11.3 Test layout

| Layer | Files |
| --- | --- |
| L0 | `app/test/capture_static.ac.test.ts` (capability files, the capture chunk's imports, no clipboard / `postMessage` in the capture bundle) |
| L1 | `packages/doc/test/capture.ac.test.ts`, `packages/doc/test/inbox.ac.test.ts`; `app/ui/src/**/*.test.ts` for `bucket.ts`, `dates.ts`, `quickAdd` in capture; `app/test/catalog_5b.ac.test.ts` (strings, Rust menu table) |
| L2 | `packages/doc/test/inbox.prop.ac.test.ts` (FR-FMT-07 AC-21, FR-INB-04 AC-3), `app/test/inbox_members.prop.ac.test.ts` (FR-SYN-06 AC-28) |
| L4 | `crates/tegg-core/tests/ac_capture.rs`, `ac_inbox.rs`, `ac_vault_settings.rs`; `crates/tegg-jobs/tests/ac_inbox_job.rs`; `app/src-tauri/tests/ac_capture_acl.rs` (mock runtime, NFR-SEC-03 AC-2) |
| L5 | `app/webkit/capture.ac.test.ts`, `capture_tags.ac.test.ts`, `default_type.ac.test.ts`, `settings_vault.ac.test.ts`, `settings_machine.ac.test.ts`, `inbox.ac.test.ts`, `inbox_actions.ac.test.ts`, `inbox_bulk.ac.test.ts`, `sidebar_5b.ac.test.ts` |
| L6 | `app/e2e/ms5_capture.ac.test.ts` (FR-CAP-*, FR-TSK-10, FR-SET-05, NFR-SEC-03 AC-4, AC-5, FR-SYN-06 AC-24, AC-25), `app/e2e/ms5_inbox.ac.test.ts` (FR-INB-*, FR-SYN-06 AC-26, AC-27), `app/e2e/nfr_perf_10.ac.test.ts` + `perf_capture.ts`, `perf_inbox.ts` |

The fixture `tests/fixtures/vaults/inbox/` is written byte-exact from its README in its own commit (with `Fixture-Change:`), before the red tests.

## 12. Contract choices (no owner decision needed)

1. **App command ACL.** Tauri 2 lets every window call every app command unless the app declares a command manifest; declaring it (§2.1) is what makes NFR-SEC-03 AC-2 enforceable.
2. **Alias-less links in a capture's title** show their target text (no index read from the capture window, D-553); FR-CAP-04 AC-4's `[[Plán webu]]` row gives `Plán webu` either way.
3. **Shell settings in their own file**, written only by the shell, because the shell needs them before any webview loads; date-and-time choices stay in `UiStateDto` with the other UI state.
4. **`capture-saved` is a separate pre-warmed window** so the confirmation never makes the capture window key again and never activates the app.
5. **Single-item Inbox actions are not jobs**: one `note_write` each, as the Tasks page (D-480); only multi-file actions go through `tegg-jobs` for base checks, progress and skips.
6. **The Inbox instant is computed in TypeScript** like the Tasks buckets (ms5-tasks §1: the core never decides "today").
7. **Login item risk:** `SMAppService.mainAppService` needs the app in `/Applications` or `~/Applications` and may refuse an ad-hoc-signed build; the failure is shown on `settings/menu-bar` as the switch returning off with `Couldn’t add Tegg to the login items.` (new key `settings.menubar.loginFailed`), and FR-SET-05 AC-4's manual part runs on the installed preview.

## 13. Points for the owner

| # | Issue | Recommendation | Alternatives | Affects |
| --- | --- | --- | --- | --- |
| AP-495 | **The template's frontmatter in the capture window.** D-540 applies a type's template frontmatter to captures, and D-552 builds the bytes in the capture window; D-553 lets the window read only type definitions, the default type, tag names and the vault name. The template is a vault file. | Count the default template's **frontmatter block** as part of the type definition: `capture_context` sends it as `templateHead` (no body, never shown in the DOM); the template body never reaches the capture window. **Accepted: D-567.** | (b) The core merges the template frontmatter into the capture's bytes in `capture_create` (Rust editing YAML of a note: against D-82). (c) Captures ignore the template entirely (amends D-540; FR-CAP-04 AC-2's `hodnocení: 3`, `oblast: osobní` become the default `1` and nothing). | §2.2, §3.2; FR-CAP-04 AC-2; NFR-SEC-03 AC-4 |
