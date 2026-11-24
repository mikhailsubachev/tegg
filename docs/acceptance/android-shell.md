# Acceptance Criteria: The Android shell (slice AND-1)

See [README](README.md) for conventions. Slice **AND-1 "Shell"** of the Android MVP (D-2000…D-2012; plan `docs/plans/android-mvp-plan.md` §3.2, §3.3, §5, §6; spike report `spikes/android/FINDINGS.md`). AND-1 turns the spike's throwaway patch (commit `d4c753e6`, ported, never copied, D-83) into product code:
- a mobile entry point for `app/src-tauri`, with the desktop-only parts compiled out (F3);
- a way to choose the vault folder without a folder dialog (F4);
- the "All files access" check before a vault in shared storage opens (F5);
- machine-local data in the app's private storage (F7);
- a start order in which the page never asks for the vault before the shell has it (F2);
- the watcher fix in `tegg-vault` (F1);
- a signed release APK built by one command, without the `INTERNET` permission (F6, F9; D-2002, D-2011);
- a cross-compile step in the gates;
- an unchanged macOS app.

**Status: approved, 2026-11-22.** AP-2013…AP-2035 (end of this file) are D-2013…D-2035 in order (owner, "Accept all"; BRD v1.231): every proposal is the decision. A criterion that names an AP point follows its proposal. The names used here (`vault_start`, `vault_find`, `storage_access`, `storage_access_settings`, `test-env.json`, `tools/android/env.sh`, the `android-check` and `app-android-e2e` steps, `CoreOptions::bulk_jobs`, `fs_change_of`) are proposals that the contract (`docs/contracts/android-shell.md`, written after approval) starts from.

**Scope.**
- **AR-03** (the shell as the platform layer): the mobile entry point, gated desktop code, command sets per platform, the cross-compile step, the unchanged desktop build.
- **FR-VLT-01** on Android: the start flow, the permission screen, the Android chooser, finding vaults, the typed path, New vault, recent vaults.
- **FR-STO-07**: machine-local data in private storage, no Android backup of it.
- **FR-SYN-03**: the watcher ignores read events (F1).
- **FR-SYN-06**: no bulk job and no tidy run on the phone (D-2007), so opening a vault writes nothing.
- **FR-FMT-12**: NFD file names on a file system that doesn't normalise names (AP-2029).
- **FR-EDT-08**: a flush when the app goes to the background (AP-2027).
- **NFR-SEC-01**: no `INTERNET` permission, no sockets (D-2002).
- **AR-08** (Android part, AP-2023): the signed APK, its version and identity.
- **FR-UX-01**: the version label of the APK.

Reference tables RA1…RA7 (the Android track numbers its tables `RA<n>`, so they never collide with the desktop's `R<n>`).

**Out of scope.**
- AND-2: the phone layout, drawer, bottom bar, safe-area insets, back gesture, reading on a phone, Chromium runs of the UI tests (D-2009). In AND-1 the desktop layout shows on the phone; that is expected (F8).
- AND-3: editing on a phone (formatting bar, keyboard handling), and the read-only title of an existing object (D-2007).
- AND-4: built-in Drive sync, vaults in private storage (D-2003).
- Phone performance targets (D-2010). AND-1 measures nothing against a target; FR-SYN-03 AC-34 only bounds a defect.
- The owner's phone checks that AND-0 left open. They are listed under "Owner checks", not as criteria.

**Risk tiers** (test-strategy §3).
- **T1, data loss.** A bulk rewrite or tidy move on a partly synced vault (FR-SYN-06 AC-50). An edit lost when Android stops the app in the background (FR-EDT-08 AC-14). A second file written beside an NFD-named one (FR-FMT-12 AC-14). A write while access is off (FR-VLT-01 AC-22).
- **T2, silently wrong data.**
  - A vault shown empty because Android hides the files (F5; FR-VLT-01 AC-20…AC-22).
  - The index never settling (F1; FR-SYN-03 AC-32…AC-34).
  - A recent vault that can't be reopened because its path was stored in another normalisation (FR-VLT-01 AC-27).
  - Machine-local data in the vault, or uploaded by Android's backup (FR-STO-07 AC-13, AC-14).

  These criteria are marked **(T1)** or **(T2)**. The rest is T3/T4.

**Test layers.** Gates run only on the owner's Mac (D-60). Layers L0…L6 are as in [related.md](related.md); three are new for Android:

| Tag | Layer |
| --- | --- |
| L0 | Static rules over the source tree and config files (`tools/qa`), every commit |
| L1 | Unit tests on the Mac host. Rust: pure functions of the shell and the core (`fs_change_of`, `app_dirs_for`, `find_vaults`, `resolve_typed_path`, `version_code`), the command lists and capability files read as data. TS (Vitest, Node): the UI's platform handling, the release script's pure parts |
| L4 | Rust integration tests of the core on a temporary copy of the fixture on APFS (`crates/*/tests/ac_*.rs`) |
| L5 | Playwright on WebKit with the fake core over mocked IPC. `window.__TEGG_PLATFORM__` is set by the test to `android` or `macos` (AP-2026). The fake core answers the Android-only commands of RA2 |
| L6 | Appium `mac2` on the built `Tegg.app` (desktop, unchanged) |
| **XC** | **Cross-compile check:** the `android-check` step (`cargo check --target aarch64-linux-android`), push gate (AP-2033) |
| **APK** | **Built-APK check:** `tools/qa` script `apk-check <apk>` over a built APK with the SDK's `aapt2 dump badging`, `aapt2 dump xmltree … AndroidManifest.xml`, `apksigner verify --print-certs` and `unzip -l`. It runs inside the release command (AR-08 AC-6) and in the `app-android-e2e` step on the test APK |
| **LA** | **Android real app:** Appium with the UiAutomator2 driver on the arm64 emulator (Android 15, API 35, `google_apis`, headless) running the **test APK** (RA1). Tests live in `app/e2e-android/*.ac.test.ts`. Step `app-android-e2e` (AP-2031). They use synthetic fixtures and generated vaults only (D-62). Each test pushes a fresh copy of its vault to `/sdcard/Documents/tegg-la-<random>/` and sets the permission with `adb shell appops set <id> MANAGE_EXTERNAL_STORAGE allow\|deny`. It reads the app's private files with `adb shell run-as <id>` and gives test hooks through `test-env.json` (AP-2032). Web content is driven through the WebView context (chromedriver) or the accessibility tree, as the contract decides. **Untouched** on the device means the same SHA-256 (`sha256sum`), size, inode and mtime (`stat`) |
| manual | Owner checks on the owner's phone, recorded in `qa/manual/` |

**Fixtures.** No new fixture.
- `tests/fixtures/vaults/shell/` with `tests/fixtures/vaults/new-empty/.tegg/` copied in, as in [app-shell.md](app-shell.md). Its objects: Úvodní, Bez hlavičky, Čtvrtek, Druhý, Eva, Porada, Svíčková, Šablona (template), Smazaná (trashed). Type counts: Pages 2, Quick Notes 2, Tasks 1, Schůzky 1, `recept` 1.
- The generated reference vault: `tools/gen-vault --seed 1 --small-images`.
- Files that criteria add at runtime are named where they are used. Two recur:
  - **Stray:** `Pages/Zavolat Petrovi.md`, written as `---\nid: 01JAND1STRAY00000000000000\ntype: task\ntitle: Zavolat Petrovi\nstatus: todo\n---\nZavolat Petrovi kvůli chalupě.\n`. It is a Task outside `Tasks/`, which the desktop's tidy job would move (FR-STO-01 AC-7).
  - **NFD note:** `Pages/Poznámka.md`, whose name is written in NFD bytes (`Poznámka` with `a` + U+0301). Its body is `Rozpočet na zahradu.`

---

## Reference tables

### RA1. Builds and identities (AP-2019…AP-2022, AP-2032)

| Build | Made by | Application id | Debuggable | Version name / code | Sidebar label | Test hooks | Machine-local root |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Tegg.app (unchanged) | `npm run app:release -- <v>` | `app.tegg.preview` | n/a | `<v>` | `v<v>` | `TEGG_TEST=1` env (unchanged) | `~/Library/Application Support/Tegg Preview/` |
| Desktop test build (unchanged) | `npm run app:build` | `app.tegg.desktop` | n/a | `0.0.0` | `dev` | env | `~/Library/Application Support/Tegg/` |
| **Release APK** | `npm run app:release -- <v>` (AR-08 AC-1) | `app.tegg.preview` | no | `<v>` / RA7 rule | `v<v>` | never read | the app's private files dir, from the platform |
| **Test APK** | `npm run app:android-test` (AP-2032) | `app.tegg.desktop` | yes | `0.0.1` / `1` | `dev` | `test-env.json` in the private files dir | the app's private files dir, from the platform |

Both APKs:
- minSdk 30, targetSdk 35, compileSdk 36;
- native code for `arm64-v8a` only (AP-2020);
- app label `Tegg`;
- no `INTERNET` permission (NFR-SEC-01 AC-1);
- Android backup off (FR-STO-07 AC-14).

`tauri android dev` (the developer's live-reload build) is the only build that may hold `INTERNET`, through the `debug` source set, to reach the Vite dev server (AP-2034). It is never installed by a gate or a release.

### RA2. IPC commands per platform (plan §3.2, §8; D-2006, D-2007; AP-2024)

**Desktop:** the commands registered on main, unchanged by AND-1 (compared at the merge-base with main, D-2053; `7ff0fc0b` when AND-1 started); a later branch may add its own commands, never remove one (D-2168). Every desktop command is classified for Android: in the Android list or in an excluded group below; slice Q2-T's `task_views_restore` is in V (D-2053); slice OC's `type_card_example` is a read and stays on Android, like `type_get` and `type_usage` (D-2167). `type_misfits` is in `build.rs` and `capabilities/default.json` but not registered there (D-808); that also stays as it is.

**Android:** the desktop set minus the groups below, plus the four Android-only commands. On Android, an excluded command's function is not compiled, it isn't in the invoke handler, and no capability that applies to Android allows it.

| Group | Not registered on Android | Why |
| --- | --- | --- |
| P1 capture | `capture_context`, `capture_create`, `capture_ready`, `capture_hide`, `capture_resize`, `capture_open_main`, `capture_draft_get`, `capture_draft_set`, `capture_saved_show`, `capture_saved_hover`, `capture_suggest`, `capture_open`, `capture_media_add` | no capture window (plan §8) |
| P2 status item, hotkeys | `hotkeys`, `hotkeys_retry`, `shell_settings`, `shell_settings_set` | no menu bar item, no global hotkeys, no launch at login (D-547) |
| P3 import window | `import_pick_source`, `import_scan`, `import_cancel`, `import_where`, `import_check_target`, `import_plan`, `import_start`, `import_status`, `import_discard`, `import_transform_result` | no Capacities import (plan §8) |
| P4 dialogs | `vault_pick_dir`, `media_pick` | no folder dialog (F4); media picking comes with AND-3 if at all |
| P5 macOS system | `vault_reveal`, `media_reveal`, `backup_reveal`, `media_open`, `open_external`, `app_about`, `app_quit` | Finder, `/usr/bin/open`, the About panel and the quit flow (D-196) don't exist (AP-2027) |
| J bulk jobs, schema | `note_rename`, `tag_rename`, `tag_delete`, `merge_start`, `type_move_plan`, `type_move`, `folder_move_preview`, `tidy_now`, `value_remove_start`, `type_delete_start`, `inbox_bulk`, `starter_add`, `backup_restore`, `job_undo`, `job_redo`, `type_create`, `type_patch`, `type_delete` | D-2007, from AND-1 on (AP-2024) |
| V views, queries | `query_apply`, `query_revert`, `query_create`, `query_duplicate`, `query_rename`, `query_trash`, `query_restore`, `task_views_restore` | D-2006, D-2053 |
| O not in this version | `graph_neighbourhood`, `graph_presets_get`, `graph_presets_apply`, `index_related`, `trash_restore`, `trash_delete`, `trash_empty` | plan §8 |

**Android-only** (in `build.rs`'s manifest, allowed only by the Android capability, registered only on Android): `vault_start`, `vault_find`, `storage_access`, `storage_access_settings`.

Every other command stays on Android, for example `vault_current`, `vault_open`, `vault_create`, `vault_recent`, `note_read`, `note_write`, `jobs_ready`, `job_*` other than undo and redo, and `nav_swipe_scroll` (answers `false`).

### RA3. The start flow on Android (F2, F5; AP-2016, AP-2017)

`vault_start()` returns the current state, and the event `vault:start` carries each change. The UI on Android subscribes first, then calls `vault_start`, and renders only from the state. The desktop keeps `vault_current` and its start order unchanged.

| State | Shown | Entered when |
| --- | --- | --- |
| `needsAccess { path? }` | the permission screen (RA5), naming `path` when a remembered vault exists | at start, or on return to the foreground, without "All files access" |
| `opening { name, path }` | the frame's empty centre with the status `Opening <name>…` (`role="status"`); no sidebar entries, no chooser | access granted and a remembered vault exists |
| `open { vault }` | the landing of FR-UX-02 AC-16 | the core has opened the vault |
| `failed { path, kind }` | the chooser (RA4) with the FR-VLT-01 AC-7 message naming `path` | the remembered vault is missing or can't be opened |
| `none` | the chooser (RA4) | access granted and no vault remembered |

The shell decides the state. It checks access before any `Core::open` and opens the remembered vault on a background thread. On every return to the foreground (`RunEvent::Resumed`, or the activity's resume) it checks access again.

### RA4. The chooser on Android (F4; AP-2013, AP-2014, AP-2015, AP-2035)

| Part | Content |
| --- | --- |
| Heading | `Choose a vault` (`chooser.title`, as on the desktop) |
| `Recent vaults` | `vault_recent`'s entries that exist, most recent first, each a button with the name and the path (`data-user-content`). Missing ones are not shown |
| `Vaults on this phone` | `vault_find`'s result (RA6 rules), each a button with the name and the path relative to the shared-storage root. `Looking for vaults…` while it runs; `No vaults found in this phone's storage.` when it finds none |
| `Folder path` | a text field (no autocorrect, no capitalisation) and the button `Open` (`data-command="vault.openPath"`) |
| `Create new vault` | the New vault form of FR-VLT-01 AC-10, with `Location` as a text field holding `<shared root>/Documents` instead of the `Choose…` button |
| Absent on Android | `Import…` (`import.open`), `Choose…` (`vault.pickDir`), `Open existing folder` as a folder dialog |

**Typed path rules** (`resolve_typed_path`). Leading and trailing spaces and one trailing `/` are removed. A path starting with `/sdcard/` is read as `<shared root>/`. Then:
- a relative path is refused: `chooser.android.fullPath`;
- a path outside the shared-storage root, the app's private storage included, is refused: `chooser.android.outsideShared` (AP-2015);
- a missing folder gives the `NotFound` message;
- a folder without `.tegg/vault.yml` gives `chooser.android.notAVault` (AP-2035);
- otherwise the vault opens.

A typed name in NFC opens a folder stored in NFD bytes and the other way round. The path that is opened and remembered is the **on-disk** path.

### RA5. Strings (catalog keys, English text; NFR-OTH-02)

- `android.access.title` `Allow access to your notes`
- `android.access.body` `Tegg keeps your notes as files in a folder on this phone. Android shows that folder to Tegg only when “All files access” is on. Tegg opens only the vault folder you choose.`
- `android.access.vault` `Vault: {path}`
- `android.access.openSettings` `Open settings`
- `android.access.stillOff` `Access is still off. Turn on “Allow access to manage all files” for Tegg.`
- `vault.opening` `Opening {name}…`
- `chooser.android.recent` `Recent vaults`
- `chooser.android.found` `Vaults on this phone`
- `chooser.android.searching` `Looking for vaults…`
- `chooser.android.noneFound` `No vaults found in this phone's storage.`
- `chooser.android.path` `Folder path`
- `chooser.android.openPath` `Open`
- `chooser.android.fullPath` `Enter the full path of the folder, starting with /storage/emulated/0/.`
- `chooser.android.outsideShared` `Tegg can open vaults in this phone's shared storage only, for example in Documents.`
- `chooser.android.notAVault` `This folder isn't a Tegg vault.`
- `chooser.android.notAVaultHint` `Open a folder that holds .tegg/vault.yml, or create a new vault.`

`error.unsupported` (`This isn’t available yet.`) is reused for RA2's commands (AP-2026). No string has a count. `{path}` and `{name}` are user content.

### RA6. Watcher events and vault finding (F1, F4; AP-2028, AP-2013)

**`fs_change_of(event, base) -> Option<FsChange>`** (`tegg-vault`, pure; the `notify` callback in `local.rs` calls only this):

| `notify` event | Result |
| --- | --- |
| any event with `need_rescan()` | `Rescan` |
| `Access(Open(_))`, `Access(Read)`, `Access(Close(Read))`, `Access(Close(Execute))`, `Access(Close(Other))`, `Access(Close(Any))`, `Access(Any)`, `Access(Other)` | `None` |
| `Access(Close(Write))` | `Paths` (AP-2028) |
| `Create(_)`, `Modify(_)`, `Remove(_)`, `Any`, `Other` | `Paths` (kinds are never trusted, `FsChange`'s doc) |
| paths | made relative to `base`, NFC. Paths outside `base` and the empty relative path are dropped; no path left gives `None` |

**`find_vaults(root, platform) -> Vec<FoundVault>`** (shell, pure over the file system):
- **What counts.** A vault is a folder holding `.tegg/vault.yml` as a file, at depth 1, 2 or 3 below `root` (`Tegg`, `Documents/Tegg`, `Documents/Notes/Tegg`).
- **What isn't searched.** Folders named `Android` at depth 1, folders whose name starts with `.`, symbolic links and anything inside a found vault.
- **Result.** Sorted by name with D-122's collation, then by path in code-point order; at most 50.
- **Name.** The NFC folder name. The path is the on-disk path.
- **Unreadable folders.** They are skipped without error.

### RA7. The APK version (D-1512, D-2011, F9; AP-2022)

- `versionName` = `<v>`.
- `versionCode` = MAJOR × 1,000,000 + MINOR × 1,000 + PATCH, so `0.5.0` → `5000`, `0.12.3` → `12003`, `1.0.0` → `1000000`.
- The release command refuses a version whose MINOR or PATCH is above 999 (exit code 2, nothing built).
- The test APK is `0.0.1` / `1`. `tauri.conf.json` keeps `0.0.0` (F9: Android needs at least 0.0.1).

---

### AR-03 The platform shell on Android (adds to AC-1…AC-5)

- **AC-6** **The cross-compile step (plan §5; AP-2033).** `qa.config.json` has a step `android-check` at the `push` level.
  - **Inputs:** `crates`, `Cargo.toml`, `Cargo.lock`, `app/src-tauri` (`gen/` excluded) and `tools/android`.
  - **Run:** it sources `tools/android/env.sh`, then runs `cargo check --workspace --target aarch64-linux-android` in `crates/` and `cargo check --lib --target aarch64-linux-android` in `app/src-tauri`, with the UI build or the stub `dist` that `generate_context!` needs (the contract decides).
  - **Result:** it passes on the commit that builds AND-1. Without the NDK or the Rust target it fails, not skips. The output's last line names the missing tool and `tools/android/env.sh`.

  *(L0 for the step's definition; XC)* Test: `ar_03_ac6_android_cross_compile_step`
- **AC-7** **Desktop-only code is compiled out (F3).** An L0 rule over `app/src-tauri/src/**` checks these symbols:
  - `tauri::tray`, `tauri::menu`, `set_menu`, `on_menu_event`, `TitleBarStyle`, `title_bar_style`, `hidden_title`, `EffectsBuilder`, `.center(`, `.unminimize(`, `.always_on_top(`;
  - `tauri_plugin_dialog`, `pick_folder`, `UnixListener`, `single_instance`;
  - `install_hotkey_handler`, `register_hotkey`, `watch_mouse_buttons`, `launched_at_login`, `RunEvent::Reopen`, `/usr/bin/open`, `objc2`.

  Each may appear only inside an item, or a module, marked `#[cfg(desktop)]` or `#[cfg(target_os = "macos")]`. In `Cargo.toml`, `tauri-plugin-dialog` and the `tray-icon` feature are desktop-target dependencies only; `macos-private-api` stays on the shared `tauri` entry, which tauri-build checks against `tauri.conf.json` (D-2044). The rule's own test proves it fires on a sample file with an unguarded `TrayIconBuilder::new`. *(L0)* Test: `ar_03_ac7_desktop_only_code_is_gated`
- **AC-8** **The mobile entry point starts the app.** The library's `run` carries `tauri::mobile_entry_point` on mobile. On the emulator, `adb shell am start -W` of the test APK, with access granted and no vault remembered, has these results:
  - the chooser (RA4) shows within 15 s;
  - the perf log has `ui-ready`;
  - the shell's `setup-done` mark lists exactly one window, `main`;
  - no capture or saved-panel window exists, and no hotkey, tray or single-instance code ran (none of their perf marks is written);
  - `adb shell pidof <id>` gives one process.

  *(LA)* Test: `ar_03_ac8_mobile_entry_point_starts`
- **AC-9** **The command sets are data and match RA2 (AP-2024).** A host test reads three things:
  - the shell's two lists `commands::DESKTOP` and `commands::ANDROID` (exposed for tests);
  - `build.rs`'s manifest;
  - every file in `capabilities/`.

  It checks:
  - (a) `DESKTOP` equals the names in the desktop `generate_handler!` and holds the desktop set on main at the merge-base (D-2053), plus only the branch's own added commands (D-2168); every desktop command, each added one included, is in `ANDROID` or an excluded group;
  - (b) `ANDROID` = `DESKTOP` − RA2's groups + RA2's four Android-only commands;
  - (c) every RA2-excluded command's `allow-…` permission is only in capability files whose `platforms` is `["macOS"]`;
  - (d) the capability for the `main` window on Android allows exactly `ANDROID`, and no capability on Android names the `capture` or `saved` windows;
  - (e) the Android-only commands are allowed by no macOS capability.

  `cargo check --target aarch64-linux-android` (AC-6) fails if the Android handler names a command whose function is desktop-only, which ties `ANDROID` to the compiled handler. *(L1; XC)* Test: `ar_03_ac9_command_sets_per_platform`
- **AC-10** **Excluded commands are refused on the device.** On the test APK with the shell fixture open, invoking each of these from the `main` webview returns an error: `capture_create`, `import_start`, `note_rename`, `tag_rename`, `type_move`, `tidy_now`, `query_create`, `vault_pick_dir`, `app_quit`, `open_external`, `graph_neighbourhood`.
  - None has an effect: the vault is untouched, no window opens, and the app keeps running (same pid).
  - `vault_start`, `note_read` and `vault_recent` succeed (positive controls).

  *(LA)* Test: `ar_03_ac10_excluded_commands_refused_on_android`
- **AC-11** **The UI on Android doesn't reach for missing commands (AP-2026).** With `__TEGG_PLATFORM__ = 'android'`:
  - the IPC client sends no invoke for an RA2-excluded command and rejects the call with kind `Unsupported`; the page shows `error.unsupported` as a non-modal `alert` and keeps its state;
  - the chooser has no `import.open` and no `vault.pickDir` control;
  - the logo menu has no `About Tegg`;
  - the vault switcher's `Open folder as vault…` shows RA4;
  - the palette lists no command whose only action is an excluded command (`Import…`, `Reveal vault in Finder`, `Quick capture`, the tag, type and query edits of groups J and V);
  - the start reads `vault_start`, never `vault_current`.

  With `'macos'`, the palette registry, the chooser and the logo menu are the same as on `main` at `7ff0fc0b` (snapshot). *(L5; L1 for the client's refusal list, which equals RA2)* Test: `ar_03_ac11_ui_skips_missing_commands_on_android`
- **AC-12** **The macOS app is unchanged.**
  - (a) An L0 check over the AND-1 branch: no existing `*.ac.test.ts` or `tests/ac_*.rs` is changed or deleted, and none is changed except by a commit with an owner-approved `AC-Test-Change: <reason>; approved-by: owner` trailer (D-2052).
  - (b) `tauri.conf.json` (except a `bundle.android` block, and entries a branch adds under `bundle.macOS`, which only the Mac bundle reads, D-2169), `tauri.preview.conf.json` and `capabilities/capture.json` are equal to main at the merge-base (D-2053; AND-1's own `platforms` and `bundle.android` left out on both sides); every entry main has under `bundle.macOS` stays unchanged. The permission list of `capabilities/default.json` holds main's list at the merge-base, in its order, plus only the `allow-…` permissions of the branch's own added desktop commands, each classified for Android (D-2168); its other fields equal main's. The only other change in `default.json` and `capture.json` is their `platforms` field (D-2050).
  - (c) `./verify push` passes, and the `app-e2e` and `app-shell-test` steps pass on the built `Tegg.app`.
  - (d) FR-STO-07 AC-12's macOS cases pass.

  *(L0; the gates)* Test: `ar_03_ac12_desktop_build_unchanged`

### FR-SYN-03 / NFR-REL-02 The watcher on Linux-family systems (adds to AC-1…AC-31)

- **AC-32** **Read events are not changes (F1; T2).** `fs_change_of` maps the events of RA6 as listed. For the event's path `<base>/Pages/Úvodní stránka.md` (in NFD bytes where a case says so), the cases are:
  - `Access(Open(Any))`, `Access(Read)`, `Access(Close(Read))`, `Access(Any)` → `None`;
  - `Access(Close(Write))` → `Paths(["Pages/Úvodní stránka.md"])` (NFC);
  - `Modify(Data(Content))`, `Create(File)`, `Remove(File)`, `Modify(Metadata(Any))`, `Any`, `Other` → `Paths` with that path;
  - `Modify(Name(Both))` with `Pages/A.md` and `Pages/B.md` → both, in order;
  - an `Access(Open(Any))` with the rescan flag → `Rescan`;
  - a path outside `base` → `None`.

  The events are built in the test with `notify::Event::new(…).add_path(…)`, so the test runs on the Mac host. The regression test `bug_and0f1_fr_syn_03_access_events_are_not_changes` is committed red before the fix (CLAUDE.md, D-61). *(L1, Rust)* Test: `fr_syn_03_ac32_watcher_maps_event_kinds`
- **AC-33** **The index settles and still sees changes, on the device (F1; T2).** The shell fixture is in shared storage on the test APK. After the vault opens:
  - the perf log has exactly one `index-idle` mark in the 30 s after the first one;
  - over those 30 s, the app process uses at most 1.5 s of CPU (`utime + stime` from `/proc/<pid>/stat`, 5 %).

  Then, made with `adb shell`:
  - (a) a line appended to Úvodní is found by `index_search` within 2 s (AC-1);
  - (b) a new file `Pages/Nová.md` written as a temporary file plus `mv` is listed in Pages within 2 s;
  - (c) `mv` of Eva to `Tasks/Zavolat Evě a Petrovi.md` keeps Eva's `id` in the index within 2 s (AC-5).

  The vault's other files stay untouched. *(LA)* Test: `fr_syn_03_ac33_index_settles_on_android`
- **AC-34** **The generated vault settles on the device (F1; T2).** `tools/gen-vault --seed 1 --small-images` is pushed to shared storage and opened on the test APK. The index reaches `index-idle` within 120 s; this bounds a defect and is not a phone target (D-2010). In the 60 s after, there is no second `index-idle` and the process uses at most 3 s of CPU. `index_type_counts` equals the counts of the same vault indexed by the core on the Mac host. *(LA, nightly)* Test: `nightly_fr_syn_03_ac34_generated_vault_settles_on_android`

### FR-SYN-06 Minimal writes on the phone (adds to AC-49)

- **AC-50** **Opening a vault on Android writes nothing: no tidy job, no bulk job (D-2007; AP-2025; T1).**
  - **Core (L4, Mac host).** `Core::open` with `CoreOptions { bulk_jobs: false, .. }` is the option the Android shell always passes. It runs on a copy of the shell fixture plus the Stray, with `TEGG_TEST_QUIET_MS=200`. After the index is idle, `jobs().set_ui_ready()` is called, then the test waits 3 s and appends a line to Úvodní from outside (a watcher event). The test waits 3 s more.
    - Every file except Úvodní is untouched, and the Stray is still in `Pages/`.
    - `jobs().start(op)` returns `Unsupported`, starts nothing and writes nothing for each bulk `JobOp`: `FolderMove`, the rename, tag rename and delete, merge, type move, value remove and type delete ops, and the inbox bulk op.
    - The same vault opened with the desktop options moves the Stray to `Tasks/` (the 4E behaviour, positive control).
  - **Device (LA).** The same vault is on the test APK. The test opens three notes, leaves the app (HOME) and returns, and waits 60 s. The vault is untouched (Úvodní included).

  *(L4; LA)* Test: `fr_syn_06_ac50_no_writes_and_no_jobs_on_android`

### FR-VLT-01 Choosing and opening a vault on Android (adds to AC-1…AC-17)

- **AC-18** **A remembered vault never shows the chooser (F2; AP-2017).**
  - **L5.** The fake core holds `vault_start` at `opening { name: 'shell' }` for 3 s, then emits `vault:start` `open`. The test runs three orderings:
    - (a) the event before `vault_start` resolves;
    - (b) the event after it;
    - (c) `vault_start` answering `open` at once.

    In each, a `MutationObserver` records that the chooser (`main[aria-label="Choose a vault"]`) was never in the DOM. The page ends on the landing of FR-UX-02 AC-16 with at most one `link_resolve` (none for a landing without links) and one `note_read` for the landing (NFR-PERF-05 AC-3; D-2051).
  - **LA.** The test APK has the shell fixture remembered and access granted. Five cold starts (`am force-stop`, then `am start -W`) each reach the landing, and no UiAutomator dump taken every 250 ms contains `Choose a vault`.

  *(L5; LA)* Test: `fr_vlt_01_ac18_remembered_vault_never_shows_chooser`
- **AC-19** **While the vault opens, and when it can't (AP-2017).**
  - In `opening`, the page shows the `status` `Opening shell…` and no sidebar entry. The palette offers only D-137's no-vault commands.
  - `index:progress` after `open` shows as on the desktop (FR-UX-07 AC-7).
  - When the remembered folder was deleted (`adb shell rm -r`) while the app was stopped, the start ends in `failed`: the chooser with the FR-VLT-01 AC-7 message naming the old path. Nothing is created at that path, and no index for it appears in the private files dir.

  *(L5; LA for the deleted folder)* Test: `fr_vlt_01_ac19_opening_state_and_failure`
- **AC-20** **No vault opens without "All files access" (F5; AP-2016; T2).** Access is set to `deny` and the shell fixture is remembered.
  - The start shows only the permission screen (RA5): heading `Allow access to your notes`, the body, `Vault: <path>` and the button `Open settings`.
  - No chooser, no sidebar and no type count (in particular no `0`) is ever shown.
  - The perf log has no `vault-opened` mark.
  - The private files dir gets no index file for the vault, and its file listing (names, sizes) is the same before and after.
  - The vault is untouched.

  With no vault remembered and access off, the start shows the same screen without the `Vault:` line, and `vault_find` is not called. *(LA; L5 for the screen from `needsAccess`)* Test: `fr_vlt_01_ac20_no_vault_without_all_files_access`
- **AC-21** **`Open settings` and the way back (AP-2016).** On the permission screen, `Open settings` opens the system's "All files access" page for this app (intent `android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION` with data `package:<id>`). The foreground package becomes `com.android.settings`.
  - The test sets `appops … allow` and returns with Back. Within 2 s of the app's resume, the state moves on (`opening` then `open` with the remembered vault, else `none`). The open vault's type counts equal the fixture's (Pages 2, Quick Notes 2, Tasks 1, Schůzky 1, `recept` 1).
  - Returning without granting keeps the screen and adds `android.access.stillOff`. Nothing else happens.

  The screen's controls are reachable by TalkBack's linear order. Their names are RA5's strings. *(LA; L5)* Test: `fr_vlt_01_ac21_open_settings_and_recheck`
- **AC-22** **Access turned off while a vault is open (AP-2016; T1, T2).** With the shell fixture open, the test types `x` at the end of Úvodní's body, presses HOME within 300 ms, sets `appops … deny`, waits 2 s and brings the app back. The app may also have been stopped by the system; both paths are accepted.
  - The vault is closed (the core and its watcher stopped) and the permission screen shows.
  - Úvodní holds the `x` (written by FR-EDT-08 AC-14's flush before the app left), and no file was written after `deny`: every vault file's mtime is at most the time of `deny`.
  - Granting again reopens the vault with the same type counts and the same `index_search("Evě")` result as before.

  *(LA)* Test: `fr_vlt_01_ac22_access_revoked_while_open`
- **AC-23** **The Android chooser (F4; RA4).** With `__TEGG_PLATFORM__ = 'android'` and the fake core answering `vault_recent` (two entries, one missing) and `vault_find` (three entries), the chooser shows:
  - `Recent vaults` with exactly the existing entry;
  - `Vaults on this phone` with the three entries in order;
  - the `Folder path` field with `Open`;
  - `Create new vault`.

  It has no `Import…`, no `Choose…` and no folder dialog call (no `vault_pick_dir` in the fake core's log). `Looking for vaults…` shows while `vault_find` is pending (held 1 s), and `No vaults found in this phone's storage.` shows for an empty answer. Activating an entry calls `vault_open` with its path. Every control has a `data-command` (FR-UX-03 AC-8). *(L5)* Test: `fr_vlt_01_ac23_android_chooser`
- **AC-24** **Finding vaults (RA6; AP-2013; T2).** On a temporary tree on the Mac host, `find_vaults(root)` returns exactly, in this order: `Archiv` (`Documents/Staré/Archiv`, depth 3), `Notes` (`Notes`, depth 1), `Poznámky` (`Documents/Poznámky`, stored in NFD bytes, returned with the NFC name and the NFD on-disk path) and `Tegg` (`Documents/Tegg`). The tree is:
  - those four vaults;
  - `Documents/Tegg/Projects/Inner` (inside a vault);
  - `Documents/A/B/C/Deep` (depth 4);
  - `Android/data/Hidden` (under `Android`);
  - `.hidden/Vault` (under a hidden folder);
  - `Documents/Link` (a symbolic link to `Notes`);
  - `Documents/Fake` (`.tegg/vault.yml` is a folder);
  - `Documents/Locked` (`chmod 000`, skipped without error).

  With 60 vaults at depth 1, it returns the first 50 by name. *(L1, Rust, on a temporary folder)* Test: `fr_vlt_01_ac24_find_vaults`
- **AC-25** **A typed path (RA4's rules; AP-2015; T2).** On the device, with the shell fixture at `/storage/emulated/0/Documents/tegg-la-x/shell`:
  - typing that path, the same with a trailing `/` and spaces around it, or `/sdcard/Documents/tegg-la-x/shell` opens the vault, and `vault_recent`'s first entry is `/storage/emulated/0/Documents/tegg-la-x/shell`;
  - `Documents/tegg-la-x/shell` gives `chooser.android.fullPath`;
  - `/data/user/0/<id>/files` and `/storage/emulated/0/../../data` give `chooser.android.outsideShared`;
  - a missing path gives the `NotFound` message;
  - `/storage/emulated/0/Documents/tegg-la-x` (no `.tegg/`) gives `chooser.android.notAVault` with its hint.

  No refused path creates or changes anything. The pure function `resolve_typed_path(input, shared_root, private_root)` gives the same results on the Mac host with temporary roots. *(L1; LA)* Test: `fr_vlt_01_ac25_typed_path`
- **AC-26** **New vault on the phone (AP-2014).** The New vault form's `Location` holds `/storage/emulated/0/Documents`. The test types `Můj trezor` in NFD bytes into `Vault name`, chooses Empty and taps `Create`.
  - It creates `/storage/emulated/0/Documents/Můj trezor/` (NFC). Its files equal `tests/fixtures/vaults/new-empty/` byte for byte, apart from generated ids and timestamps (FR-VLT-02 AC-3). Nothing else is created in `Documents`.
  - The vault opens, and a cold start reopens it (AC-18).
  - A `Location` outside shared storage gives `chooser.android.outsideShared` and creates nothing.

  *(LA; L5 for the form)* Test: `fr_vlt_01_ac26_new_vault_on_android`
- **AC-27** **Recent vaults keep the on-disk path (FR-VLT-01 AC-17; T2).** A vault folder `Documents/Poznámky` is stored in NFD bytes. It is opened from `Vaults on this phone`, the app is force-stopped, and it is started again.
  - The vault reopens (AC-18).
  - `vault_recent` lists it once, with `exists: true` and the name `Poznámky` in NFC.
  - Opening it again from the list doesn't add a second entry: paths are compared after NFC (AC-17), and the stored path is the on-disk one.

  *(LA; L4 on the host for the list with an NFD path)* Test: `fr_vlt_01_ac27_recent_vaults_keep_disk_path`
- **AC-28** **The FR-VLT-01 rules hold on the phone.** On the test APK:
  - opening the shell fixture writes nothing (AC-4);
  - opening a second vault (`Můj trezor` from AC-26) from the vault switcher closes the first (AC-8);
  - its index lives in the private files dir (FR-STO-07 AC-13);
  - the switcher's menu lists both with `exists: true`.

  *(LA)* Test: `fr_vlt_01_ac28_vault_rules_on_android`

### FR-STO-07 Machine-local data on Android (adds to AC-1…AC-11)

- **AC-12** **Where machine-local data lives, from the platform (F7).** `app_dirs_for(platform)` (pure) gives:

  | Platform | Result |
  | --- | --- |
  | macOS, home `/Users/t`, no feature `preview` | `/Users/t/Library/Application Support/Tegg` |
  | macOS, same home, with `preview` | `…/Tegg Preview` |
  | macOS, `TEGG_TEST=1` and `TEGG_APP_SUPPORT=/tmp/x` | `/tmp/x` |
  | macOS, `TEGG_APP_SUPPORT` without `TEGG_TEST` | ignored |
  | Android, platform data dir `/data/user/0/app.tegg.preview/files` | exactly that dir |
  | Android, `$HOME` set | still the platform data dir, never `$HOME` |

  On Android the platform dir comes from Tauri's path API (`app_data_dir`), never from a constant. *(L1)* Test: `fr_sto_07_ac12_app_dirs_from_the_platform`
- **AC-13** **Nothing machine-local in shared storage (T2).** On the test APK, the test opens the shell fixture, opens two notes, switches the theme, force-stops the app and starts it again.
  - The index, `ui-state.json` and the recent-vaults list are under `run-as <id> ls -R files/`.
  - The vault folder's listing (names, sizes, SHA-256, inodes, mtimes) is the same as before the first start.
  - No other file under `/storage/emulated/0` was created or changed. The test compares a listing of `Documents`, `Download` and the root, taken before and after.

  *(LA)* Test: `fr_sto_07_ac13_machine_local_in_private_storage`
- **AC-14** **Android doesn't back machine-local data up (AP-2030; T2).** In both APKs' manifests, `application` has `android:allowBackup="false"` and `android:dataExtractionRules` pointing to rules that exclude every domain for cloud backup and device transfer. So the index, which holds note text, never leaves the phone through Android's backup. *(APK)* Test: `fr_sto_07_ac14_android_backup_off`

### FR-FMT-12 NFD file names on the phone (adds to AC-1…AC-13)

- **AC-14** **A note stored in NFD bytes on a file system that doesn't normalise names (AP-2029; T1, T2).** Android's shared storage keeps the bytes of an NFD name, so AC-1 is checked again on the device (it compares NFC and NFD as one name, D-2052).
  - **Pure function (L1, Mac host).** `on_disk_name(listing, nfc_path)` returns the listed entry whose NFC form equals `nfc_path`, `None` when there is none, and `Ambiguous` when two entries share it.
  - **Device (LA).** The shell fixture plus the NFD note is on the test APK:
    - (a) Pages lists Poznámka once;
    - (b) `index_search("zahradu")` finds it;
    - (c) opening it writes nothing;
    - (d) typing `x` at the end of its body and waiting 2 s writes nothing until AND-3 (D-2048): the file is unchanged, its name still NFD bytes, and there is no second `Poznámka.md` in either form;
    - (e) `[[Poznámka]]` in Úvodní resolves to it (AC-1).
  - **Both forms: not on the device (D-2052).** Android's shared storage treats the NFC and NFD spellings as one name (as APFS does), so the two files can't coexist there; the host layers keep AC-3's case. (d)'s file is read through `/data/media`, below the storage layer's per-spelling cache.

  *(L1; LA)* Test: `fr_fmt_12_ac14_nfd_names_on_android`

### FR-EDT-08 Autosave when the app leaves the screen (adds to AC-4…AC-13)

- **AC-14** **A pending edit is written when the app goes to the background (AP-2027; T1).**
  - **L5, Android.** With `__TEGG_PLATFORM__ = 'android'`, an edit made 100 ms earlier and `visibilitychange` to `hidden`, a `note_write` with the edit starts within 50 ms, without waiting for the 1 s debounce.
  - **L5, macOS.** With `'macos'`, `visibilitychange` changes nothing (AR-03 AC-12).
  - **LA.** The test types `Ahoj` at the end of Úvodní's body, presses HOME within 300 ms, waits 2 s and runs `am force-stop`. The file contains `Ahoj`, and no `.tegg-tmp` file is left (FR-SYN-02 AC-1).

  *(L5; LA)* Test: `fr_edt_08_ac14_flush_when_backgrounded`

### NFR-SEC-01 No network on the phone (D-2002)

- **AC-1** **No network permission in the APKs (F6).** The release APK and the test APK declare exactly these `uses-permission` entries:
  - `android.permission.MANAGE_EXTERNAL_STORAGE`;
  - permissions in the app's own namespace (`<application id>.*`, such as AndroidX's `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`).

  `android.permission.INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE` and `CHANGE_NETWORK_STATE` are named in the test's failure message when present. *(APK)* Test: `nfr_sec_01_ac1_apk_has_no_network_permission`
- **AC-2** **The sources ask for none.** These are checked:
  - The committed `app/src-tauri/gen/android/app/src/main/AndroidManifest.xml` and every other manifest outside a `debug` source set hold no `INTERNET` permission. A `tools:node="remove"` entry for it is allowed.
  - `cargo tree --target aarch64-linux-android` for `app/src-tauri` contains none of `tauri-plugin-http`, `tauri-plugin-updater` and `ureq`, and `reqwest` only as Tauri's own dependency (D-2046).
  - The Android capability grants no `http:` or `shell:` permission.

  *(L0)* Test: `nfr_sec_01_ac2_android_sources_ask_for_no_network`
- **AC-3** **No sockets while the app runs.** During the whole `app-android-e2e` run, a monitor samples `/proc/net/tcp`, `tcp6`, `udp` and `udp6` on the emulator every 2 s. No entry belongs to the app's uid (`dumpsys package <id>` `userId`). This is the Android twin of test-strategy §5.4's `lsof` check. *(LA)* Test: `nfr_sec_01_ac3_no_sockets_on_android`

### AR-08 The Android release (AP-2023: AR-08 gains the APK)

**Moved to AND-3's gate (D-2043).** The first APK is released after AND-3 (D-2042). Until then `npm run app:release -- <v>` builds the Mac app only and `--apk` opts in to the APK; where AC-1 says the APK is built by default and `--no-apk` skips it, read `--apk` adds it. The machinery stays built and its L1 and APK tests stay in the gates.

- **AC-1** **One command (D-2011; AP-2022).** `cd app && npm run app:release -- 0.5.0`, on a clean checkout of `main` with the signing config present (AC-3), does the following:
  - it builds `Tegg.app` as today (D-1512, D-1514) and a release APK (RA1);
  - it leaves `Tegg-0.5.0.dmg`, `Tegg-0.5.0.zip` and `Tegg-0.5.0.apk` in `app/src-tauri/target/release/bundle/release/`;
  - it installs `/Applications/Tegg.app` (D-2227) only after both builds and AC-6's check have passed.

  `--no-apk` builds only the Mac app, as today. A failed APK build exits non-zero, installs nothing and leaves no `.apk` in the release folder. *(L1 for the script's plan, with its build calls stubbed: the steps, their order, `--target aarch64`, `--features preview`, `TEGG_ANDROID_APP_ID=app.tegg.preview` (not the preview config, D-2045) and `TEGG_VERSION`; APK for the artifact)* Test: `ar_08_ac1_release_builds_the_apk`
- **AC-2** **The version (RA7; F9).** The APK built for `0.5.0` has `versionName` `0.5.0` and `versionCode` `5000` (`aapt2 dump badging`). `version_code()` gives RA7's three examples. `0.1000.0` and `0.1.1000` exit with code 2 before any build, with the usage message. `app/src-tauri/tauri.conf.json` still says `0.0.0` after the release. *(L1; APK)* Test: `ar_08_ac2_apk_version`
- **AC-3** **Signed with the owner's key, never unsigned (AP-2021).**
  - **Signature.** `apksigner verify --print-certs` passes with signature scheme v2 or later. The signer's SHA-256 equals the certificate of the key named by the signing config, and its subject is not `CN=Android Debug`.
  - **No signing config.** Without the config file, the release exits non-zero before building with one line naming the expected file. No `.apk` is in the release folder, and `/Applications/Tegg.app` is unchanged.
  - **Key inside the repo.** A config whose `storeFile` is inside the repository is refused the same way.
  - **Nothing committed.** No file matching `*.jks`, `*.keystore`, `keystore.properties` or `local.properties` is tracked (L0).

  *(L1 with a temporary config and a throwaway key; APK; L0)* Test: `ar_08_ac3_apk_signed_with_owner_key`
- **AC-4** **Identity and target (RA1; AP-2019, AP-2020).** The release APK has:
  - package `app.tegg.preview`;
  - `minSdkVersion` 30 and `targetSdkVersion` 35;
  - native libraries only under `lib/arm64-v8a/`;
  - no `android:debuggable="true"`;
  - application label `Tegg`.

  The test APK has package `app.tegg.desktop` and is debuggable. Neither APK contains `lib/armeabi-v7a/`, `lib/x86/` or `lib/x86_64/`. *(APK)* Test: `ar_08_ac4_apk_identity_and_target`
- **AC-5** **Test hooks stay out of the release (AP-2032).** The release APK's `lib/arm64-v8a/libtegg_app_lib.so` doesn't contain the bytes `test-env.json`, and the test APK's does. On the test APK, a `test-env.json` with `{"TEGG_TEST":"1","TEGG_VAULT":"<path>"}` opens that vault at start. The same file pushed to a release build installed for the test (re-signed only for this check) changes nothing. *(APK; LA)* Test: `ar_08_ac5_test_hooks_only_in_test_apk`
- **AC-6** **Every release checks its APK.** After building, the release command runs `apk-check` on `Tegg-<v>.apk`, which covers NFR-SEC-01 AC-1, FR-STO-07 AC-14 and AR-08 AC-2…AC-5. A failing check fails the release: exit non-zero, nothing installed and the APK deleted from the release folder. *(L1 with a stubbed check that fails)* Test: `ar_08_ac6_release_runs_apk_check`

### FR-UX-01 The version label on the phone (adds to AC-5)

- **AC-7** **`v<version>` in the release APK, `dev` elsewhere (D-1512; RA1).** The release APK built for `0.5.0` shows `v0.5.0` on the sidebar's bottom-left button, and the test APK shows `dev`. Both are checked on the emulator; the release-variant APK (built like the release and signed with the test key, made debuggable for this check, D-2051) is installed with access granted and the shell fixture typed in as a path, and the label is read through DevTools. The label comes from the same `versionLabel(TEGG_VERSION)` as on the desktop (AC-5's L1 cases unchanged). *(LA)* Test: `fr_ux_01_ac7_version_label_on_android`

---

## Owner checks (manual)

These come from AND-0's open items. They need the owner's phone or Google account, so they are recorded in `qa/manual/and-1.md` and are not criteria. Each runs on the first release APK of AND-1.

- **OC-1** [manual] **Install and access.** Sideload the release APK on the owner's phone and grant "All files access" through the permission screen. Open a copy of a generated vault (`--small-images`, 5,000 notes), not the real vault (D-62). Record the time to `index-idle` and to a note open (input for D-2010).
- **OC-2** [manual] **Typing with Gboard** in a note of that vault, with the desktop layout:
  - Czech diacritics, autocorrect and suggestions;
  - Enter in lists and backspace at a block start;
  - the file's diff shows only the typed text and `modified`.

  The findings go to AND-3's ACs.
- **OC-3** [manual] **The separate Drive sync app** (D-2004): it syncs `.tegg/` and `.trash/`, doesn't upload Tegg's temporary files, and names its conflict copies in a way the owner records.
- **OC-4** [manual] **The Drive API** (input for AND-4):
  - sign-in with the full `drive` scope and the token's lifetime;
  - the change list;
  - whether the Mac client uploads Tegg's atomic writes as an update or as a delete and a create.

---

## Real-app tests (D-382)

`app/e2e-android/` (test APK on the emulator, `test-env.json`, a fresh vault copy in shared storage per test):
- `android_shell.ac.test.ts`: AR-03 AC-8, AC-10; FR-VLT-01 AC-18…AC-22, AC-25…AC-28; FR-STO-07 AC-13; FR-EDT-08 AC-14; FR-UX-01 AC-7; AR-08 AC-5.
- `android_watcher.ac.test.ts`: FR-SYN-03 AC-33; FR-SYN-06 AC-50 (device part); FR-FMT-12 AC-14.
- `nightly_android_watcher.ac.test.ts`: FR-SYN-03 AC-34.
- NFR-SEC-01 AC-3 is the monitor that wraps the whole run.

The APK layer's tests are in `tools/qa/test/apk_check.ac.test.ts`. They run against the test APK built by the step, and against the release APK inside the release command.

---

## Trace: requirement → criteria

| Requirement / rule | Criteria | Decisions and points |
| --- | --- | --- |
| AR-03 | AC-6…AC-12 (7) | D-2000, D-2006, D-2007; F3; AP-2024, AP-2026, AP-2033 |
| FR-SYN-03 / NFR-REL-02 | AC-32…AC-34 (3) | F1; AP-2028 |
| FR-SYN-06 | AC-50 (1) | D-2007, D-805, D-819; AP-2025 |
| FR-VLT-01 | AC-18…AC-28 (11) | D-2003, D-98, D-137, D-219; F2, F4, F5; AP-2013…AP-2017, AP-2035 |
| FR-STO-07 | AC-12…AC-14 (3) | D-2003, D-1514; F7; AP-2030 |
| FR-FMT-12 | AC-14 (1) | AP-2029 |
| FR-EDT-08 | AC-14 (1) | D-196; AP-2027 |
| NFR-SEC-01 | AC-1…AC-3 (3) | D-2002; F6; AP-2034 |
| AR-08 (Android part) | AC-1…AC-6 (6) | D-2011, D-1512, D-1514; F9; AP-2019…AP-2023, AP-2032 |
| FR-UX-01 | AC-7 (1) | D-1512 |

**37 new criteria, all automated.** Four owner checks (manual) are not criteria.

**Changes when these criteria are approved** (not made by this draft):
- **README:** a row for this file in `docs/acceptance/README.md`.
- **BRD:** the decisions of AP-2013…AP-2035, and AR-08's Android sentence (AP-2023).
- **test-strategy:** the XC, APK and LA layers, the `app-android-e2e` step, and TS-I7's coverage rule extended to `app/e2e-android/` (AP-2031).
- **Contract:** `docs/contracts/android-shell.md` with `vault_start` and its states, `vault_find`, `storage_access`, `storage_access_settings`, `CoreOptions::bulk_jobs`, `fs_change_of`, `on_disk_name`, `app_dirs_for`, `resolve_typed_path`, `test-env.json`'s keys and the `setup-done` mark.

---

## Points for the owner (AP-2013…AP-2035, accepted as D-2013…D-2035)

Raised while writing these criteria. Each criterion that depends on one names it and follows its **proposal**.

| AP | Point | Proposal | Alternative | Affects |
| --- | --- | --- | --- | --- |
| AP-2013 | **How the vault folder is chosen without a folder dialog (F4).** The Storage Access Framework gives no real path (plan §3.3), and the plan names a scan or a typed path without settling roots, depth or order. | All three on one screen (RA4): `Recent vaults`, `Vaults on this phone` from a scan of the shared-storage root (from the platform), and a `Folder path` field. The scan looks 1–3 folders deep, skips `Android/`, hidden folders, symbolic links and the inside of a found vault, sorts by name and returns at most 50 (RA6). | A typed path only; or a scan of `Documents/` only | FR-VLT-01 AC-23…AC-25 |
| AP-2014 | **New vault on the phone in AND-1.** FR-VLT-01 offers "create" at first launch, but the owner's vault comes from the Mac through Drive. | Offer it: the desktop form with `Location` as a path field holding `<shared root>/Documents`, in shared storage only. It is cheap, uses `vault_create`, and helps when the sync app hasn't run yet. | No `Create new vault` on Android until AND-4 | FR-VLT-01 AC-26 |
| AP-2015 | **Vaults in the app's private storage in AND-1.** D-2003 allows them "with AND-4". | Not in AND-1. A path inside private storage, or anywhere outside shared storage, is refused with `chooser.android.outsideShared`. This also keeps machine-local data and the vault apart. | Allow private-storage vaults now (no permission needed, but no sync) | FR-VLT-01 AC-25, AC-26 |
| AP-2016 | **The permission screen: when, what, and after.** F5: without the permission the vault silently looks empty. | The screen comes before anything else whenever access is off: at start, with or without a remembered vault, and on every return to the foreground. It has RA5's texts and one button, `Open settings`, which opens the app's own "All files access" page. On return the shell checks again and moves on within 2 s. If access was turned off while a vault was open, the vault is closed (core and watcher stopped), the screen shows, and nothing is written until access is back. Revoking needs leaving the app, and AP-2027's flush has saved by then. | Show the chooser with a banner instead; or check only at start | FR-VLT-01 AC-20…AC-22 |
| AP-2017 | **How the page learns the vault is open (F2).** The spike opened the vault before creating the window. A large vault in shared storage took 1.6–5.0 s, which would be a blank screen. | An Android-only command `vault_start` and event `vault:start` with RA3's states (`needsAccess`, `opening`, `open`, `failed`, `none`). The shell checks access, then opens the remembered vault on a background thread, and the page shows `Opening <name>…`, never the chooser. The desktop keeps `vault_current` and its order unchanged (AR-03 AC-12). | Open before the window is created (simple, blank screen meanwhile); or change `vault_current` on both platforms | FR-VLT-01 AC-18, AC-19 |
| AP-2018 | **Native code, and whether `gen/android` is committed.** The permission check (`Environment.isExternalStorageManager()`), the settings intent and the shared-storage root need Kotlin. Signing, the manifest and backup rules live in the generated Gradle project. | (a) A small local Tauri plugin, `app/src-tauri/tegg-android/` (Rust plus an `android/` Kotlin library), compiled only for Android, holds the Kotlin. (b) `app/src-tauri/gen/android/` is committed without `build/`, `.gradle/`, `local.properties`, keystores or `keystore.properties` (ignored; AR-08 AC-3's L0 rule). (c) `tauri android init` is not run again by scripts, so its extra Rust targets (F11) stay out. | Kotlin directly in `gen/android` and the folder regenerated and patched by a script | AR-03, AR-08 AC-3, NFR-SEC-01 AC-2 |
| AP-2019 | **Application ids.** The desktop test build is `app.tegg.desktop` and the release is `app.tegg.preview` (D-1514). | The same on Android (RA1): the release APK is `app.tegg.preview` (one release config, `tauri.preview.conf.json`), and the test APK is `app.tegg.desktop`. They install side by side and never share private storage, as on the Mac. | `app.tegg.android` and `app.tegg.android.test` | AR-08 AC-4, FR-STO-07 AC-12 |
| AP-2020 | **SDK levels and ABIs.** `MANAGE_EXTERNAL_STORAGE` and `isExternalStorageManager` exist from API 30; Tauri's template defaults to minSdk 24 and adds 32-bit and x86 targets. | minSdk 30 (Android 11), targetSdk 35 (Android 15, the emulator of AND-0), compileSdk 36, `arm64-v8a` only. | minSdk 24 with the older `WRITE_EXTERNAL_STORAGE` path below 30 | AR-08 AC-4 |
| AP-2021 | **The signing key.** D-2011 says "the owner's own key" but not where it is kept or what happens without it. | A keystore the owner creates once and backs up, kept outside the repository. Its config is a properties file at `~/.config/tegg/android-signing.properties` (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`; mode 600), overridable with `TEGG_ANDROID_SIGNING=<file>`. Without it, or with `storeFile` inside the repo, the release stops before building with one line naming the file. There is never an unsigned or debug-signed "release". Note: losing the key means the next APK can't update the installed one. It must be uninstalled, which deletes only the private data (index, UI state), never the vault. | Passwords in the macOS Keychain (`security find-generic-password`) instead of the properties file | AR-08 AC-3 |
| AP-2022 | **The release command and the APK version.** D-2011: "built by `npm run app:release`". Unsettled: always or by a flag, where the APK goes, `versionCode`, the GitHub release. | `npm run app:release -- <v>` builds `Tegg.app` and the APK by default, `--no-apk` skips the APK, and nothing is installed unless both built and the APK check passed. The APK is `Tegg-<v>.apk` next to the DMG and zip and is attached to the GitHub release `Tegg <v>` as a third asset. `versionCode` = MAJOR·10⁶ + MINOR·10³ + PATCH (Tauri's own derivation), with MINOR and PATCH at most 999 (RA7). The sidebar shows `v<v>` (FR-UX-01 AC-7). | A separate `npm run app:release-android -- <v>`; or the APK not on GitHub (copied to the phone only) | AR-08 AC-1, AC-2, AC-6, FR-UX-01 AC-7 |
| AP-2023 | **No requirement covers the APK.** AR-08 speaks of the notarized DMG only, and D-2011 is a decision without a requirement. | Amend AR-08: "… and, on Android, a signed APK installed by sideloading (D-2011)". AR-08 AC-1…AC-6 hang on it. | A new requirement `AR-09` for the Android build | AR-08 |
| AP-2024 | **Which commands are not registered on Android, and when bulk jobs go (D-2007).** The plan says "commands for excluded features are not registered" without a list. D-2007's jobs could wait for AND-3, but the AND-1 build already shows the desktop UI, so the owner could rename a title on a partly synced vault while testing typing (OC-2). | RA2's list, removed in AND-1: the platform groups P1…P5, the bulk jobs and schema changes (J), the view and query edits (V) and the plan's out-of-scope features (O). Four Android-only commands are added. Desktop-only command functions are `#[cfg(desktop)]`, so the Android handler can't name them (AR-03 AC-9). | Keep groups J and V until AND-3 | AR-03 AC-9…AC-11 |
| AP-2025 | **The tidy job runs by itself.** On vault open and after each 30 s quiet period, the core moves objects that are outside their type's folder (FR-STO-01 AC-7, D-805, D-819). On a partly synced vault this is exactly the bulk move D-2007 rules out, and removing `tidy_now` doesn't stop it. | A core option `CoreOptions::bulk_jobs` (default `true`; the Android shell passes `false`). With `false`, the tidy scheduler never starts and `jobs().start` refuses every bulk op with `Unsupported`. It is platform-neutral (AR-03) and testable on the Mac (FR-SYN-06 AC-50). The per-save move of a note to its type's folder (4E) is editing and is decided in AND-3. | Rely on the UI never calling `jobs_ready` on Android | FR-SYN-06 AC-50 |
| AP-2026 | **The desktop UI on Android in AND-1.** The UI calls commands RA2 removes (Import, Reveal, About, rename by title, view edits…). | The init script sets `window.__TEGG_PLATFORM__` (`android` or `macos`). On Android the IPC client refuses RA2's commands locally with `Unsupported`, and the page shows the existing `error.unsupported` as a non-modal alert. Only the chooser, the vault switcher's `Open folder as vault…`, the logo menu's `About Tegg` and the palette are adapted in AND-1; the rest waits for AND-2/AND-3. | Hide every control that needs an excluded command now; or leave the raw IPC error | AR-03 AC-11 |
| AP-2027 | **The quit flow and the lifecycle on Android.** The desktop holds `ExitRequested` until the UI has saved (D-196), hides windows on close and has `app_quit`. Android has no quit; it stops a backgrounded app without asking. | On Android: no `ExitRequested`, `CloseRequested` or `Reopen` handling and no `app_quit`. The page flushes the open note's pending edit at once on `visibilitychange: hidden` (FR-EDT-08 AC-14); the desktop doesn't change. The system back gesture keeps Tauri's default until AND-2 designs navigation. | Leave the flush to AND-3 (AND-1 builds then risk losing the last second of typing during OC-2) | FR-EDT-08 AC-14, RA2 P5 |
| AP-2028 | **Which read events to drop (F1).** The spike dropped every `EventKind::Access`. On Linux, `Access(Close(Write))` is the event that marks the end of another program's write. | Drop every `Access` kind except `Close(Write)`. Tegg's own reads give `Open` and `Close(Read)`, so no loop, and a sync app's last write is never missed. | Drop all `Access` events, as the spike did | FR-SYN-03 AC-32 |
| AP-2029 | **NFD file names on Android.** `tegg-vault` lists names as NFC and opens `root.join(nfc)`. APFS finds an NFD file that way; Android's shared storage doesn't. A note whose name reached the phone in NFD (from a Mac, a zip or a sync app) would be listed but unreadable. An edit would write a second file beside it (T1), which then syncs back to the Mac as a conflict. | Fix it in AND-1. The local file system keeps the on-disk name of each listed entry and reads and writes existing files through it; new files are NFC (AC-2). An NFC and an NFD name for one note in a folder are a name conflict (FR-FMT-12 AC-3) and neither is written. AND-1 also checks on the emulator whether shared storage is case-insensitive and records it in the contract. | Leave it to AND-3 (editing), and in AND-1 only show such files as unreadable | FR-FMT-12 AC-14, FR-VLT-01 AC-24, AC-27 |
| AP-2030 | **Android backup.** By default Android backs up an app's private data to the user's Google Drive. That would upload the index, which holds note text, and the recent-vault paths. It is a network transfer of Tegg data that the owner didn't choose (NFR-SEC-01's spirit, FR-STO-07). | `android:allowBackup="false"` and data-extraction rules that exclude every domain, in both APKs. The index rebuilds from the files anyway (AR-01). | Allow backup of `ui-state.json` only | FR-STO-07 AC-14 |
| AP-2031 | **The Android real-app layer in the gates.** D-382 needs real-app tests per slice. The emulator is heavy (boot about 1 min, an APK build 1.5–3 min), and one gate runs at a time (D-1330). | A step `app-android-e2e` at the `milestone` level, like `app-e2e`, and again in `nightly`. It builds the test APK, boots a headless emulator from a fixed AVD (`tegg-and-35`, created by `tools/android/avd.sh`), runs `app/e2e-android/` and `apk-check`, and shuts the emulator down. `realAppTests` gains `app/e2e-android/`, so TS-I7's coverage check requires an LA test for every AC whose layer names LA. | Run LA only in the `release` gate; or manually before merging AND-1 | test-strategy, `qa.config.json`, every LA criterion |
| AP-2032 | **How test hooks reach the Android build.** Environment variables can't be set for an app that the launcher starts. | A **test APK** (RA1: `app.tegg.desktop`, debuggable, release-optimised Rust, version `0.0.1`). At start it reads `<private files>/test-env.json` (pushed with `run-as`), with the same keys as the desktop's `TEGG_*` variables (`TEGG_TEST`, `TEGG_VAULT`, `TEGG_PERF_LOG` as a private path, `TEGG_NOW`, `TEGG_TEST_TIDY`, `TEGG_TEST_QUIET_MS`). The code that reads it is compiled only without the `preview` feature, so the release APK can't read it (AR-08 AC-5). Perf marks on Android take their `ms` from the process start time in `/proc/self/stat` (today `NaN` off macOS). | Intent extras through `am start -e` (needs Kotlin to pass them to Rust) | AR-08 AC-5, every LA criterion |
| AP-2033 | **The Android build environment and the gates' reliability.** The NDK, SDK and JDK paths were a throwaway `env.sh` in the spike. `cargo check` for Android needs the NDK (bundled SQLite is compiled by a build script). | A committed `tools/android/env.sh` that the steps and the release script source. It defaults to `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`, NDK `28.2.13676358`, JDK 21 from `/usr/libexec/java_home -v 21`, and the NDK's `aarch64-linux-android26-clang` and `llvm-ar`; each can be overridden by the environment. It exits 3 naming what is missing. `android-check` is a **push** step that **fails** when something is missing: the gates run only on the owner's Mac, where it is installed, and a skip would hide a broken Android build. | `android-check` at nightly only; or skip with a warning when the NDK is absent | AR-03 AC-6, AR-08 AC-1 |
| AP-2034 | **`INTERNET` and the dev server.** `tauri android dev` loads the UI from the Vite dev server on the Mac, which needs `INTERNET`; D-2002 forbids it until AND-4. | Only the `debug` source set's manifest adds `INTERNET`, for `tauri android dev`. The release APK and the test APK (assets bundled, built as release variants) have none, and AC-1 checks the built files. | No live reload on Android (always build the APK) | NFR-SEC-01 AC-1, AC-2 |
| AP-2035 | **A folder that isn't a vault, on the phone.** On the desktop that leads to the importer or "Import isn't available yet" (D-91, D-93). Android has no importer (RA2 P3). | `This folder isn't a Tegg vault.` with the hint `Open a folder that holds .tegg/vault.yml, or create a new vault.` Nothing is written. | Reuse the desktop's `Import isn't available yet` | FR-VLT-01 AC-25 |
