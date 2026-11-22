# Contract: The Android shell (slice AND-1)

Public interfaces of slice AND-1, for the test author (D-61) and the build. ACs: `docs/acceptance/android-shell.md`
(approved; RA1…RA7; AR-03 AC-6…AC-12, FR-SYN-03 AC-32…AC-34, FR-SYN-06 AC-50, FR-VLT-01 AC-18…AC-28, FR-STO-07
AC-12…AC-14, FR-FMT-12 AC-14, FR-EDT-08 AC-14, NFR-SEC-01 AC-1…AC-3, AR-08 AC-1…AC-6, FR-UX-01 AC-7). Decisions:
D-2000…D-2012 (plan `docs/plans/android-mvp-plan.md`), D-2013…D-2035 (the ACs' AP-2013…AP-2035, in order). Spike
report: `spikes/android/FINDINGS.md` (F1…F11). Precedents: [ms2-shell.md](ms2-shell.md), [ms3-shell.md](ms3-shell.md)
(IPC, perf marks, test environment), [ms5-capture.md](ms5-capture.md) §2.1 (the command manifest and capabilities).

The desktop app does not change (AR-03 AC-12): every item below is either Android-only, a pure function both platforms
share with unchanged desktop results, or a core change whose desktop behaviour is the old one. §11 lists the points for
the owner (CP-1…CP-6).

## 1. Files

| Path | Owns |
| --- | --- |
| `crates/tegg-vault/src/local.rs` | `fs_change_of` (§3.1), the watcher callback calling only it; on-disk name resolution (§3.2) |
| `crates/tegg-vault/src/lib.rs` | re-exports `fs_change_of`, `on_disk_name`, `OnDiskName`, and `pub use notify` (so tests build `notify::Event`s without their own dependency) |
| `crates/tegg-core/src/lib.rs` | `OpenExtras`, `Core::open_ext` (§3.3, CP-1) |
| `app/src-tauri/src/platform.rs` | `Platform`, `app_dirs_for` (§4.1); compiled on every target |
| `app/src-tauri/src/commands.rs` | `DESKTOP`, `ANDROID`, `ANDROID_ONLY` (§2.1); compiled on every target |
| `app/src-tauri/src/vaultfind.rs` | `find_vaults`, `resolve_typed_path`, `FoundVault`, `PathRefusal` (§4.2, §4.3); compiled on every target |
| `app/src-tauri/src/mobile.rs` | `#[cfg(mobile)]`: the start flow (§5), the four Android-only commands (§2.2), `test-env.json` (§7) |
| `app/src-tauri/src/start.rs` | `StartState`, `start_state` (§5.1); pure, compiled on every target |
| `app/src-tauri/tegg-android/` | the local Tauri plugin crate `tauri-plugin-tegg-android` (Rust + `android/` Kotlin library, D-2018), §6 |
| `app/src-tauri/gen/android/` | the Gradle project, committed without build outputs, `local.properties`, keystores (D-2018), §8 |
| `app/src-tauri/capabilities/default.json` | gains `"platforms": ["macOS"]`; nothing else changes (AR-03 AC-12) |
| `app/src-tauri/capabilities/android.json` | new: window `main`, `platforms: ["android"]`, exactly `ANDROID`'s `allow-…` permissions plus `core:default` |
| `app/ui/src/platform.ts` | `platform(): 'android' \| 'macos'` from `window.__TEGG_PLATFORM__` (default `macos`) |
| `app/ui/src/ipc/android.ts` | `ANDROID_EXCLUDED: readonly string[]` (RA2's groups) and the refusal (§9.1) |
| `app/ui/src/pages/AndroidStart.tsx` | the permission screen and the `opening` state (§9.2) |
| `app/ui/src/pages/AndroidChooser.tsx` | RA4 (§9.3) |
| `app/scripts/release.mjs`, `app/scripts/release-plan.mjs` | the release (§10.1); `release-plan.mjs` exports the pure parts |
| `app/scripts/android-test.mjs` | `npm run app:android-test` (§10.2) |
| `tools/android/env.sh`, `tools/android/avd.sh`, `tools/android/sign.sh` | the build environment, the emulator, the test key (§10.3) |
| `tools/qa/src/apk-check.ts` | `apk-check` (§10.4) |
| `app/e2e-android/` | the LA tests and `helpers/` (§12) |

## 2. Commands

### 2.1 The lists (AR-03 AC-9)

`commands.rs` holds three `pub const …: &[&str]` in source order of the desktop `generate_handler!`:

- `DESKTOP`: every command the desktop registers, unchanged from `7ff0fc0b` (`type_misfits` stays out, D-808).
- `ANDROID_ONLY`: `vault_start`, `vault_find`, `storage_access`, `storage_access_settings`.
- `ANDROID`: `DESKTOP` minus RA2's groups P1…P5, J, V, O, then `ANDROID_ONLY`.

The lib exposes `pub mod commands`. `build.rs` lists `ANDROID_ONLY` in its manifest after the desktop's commands. The
desktop `generate_handler!` and the Android one are two macro calls under `#[cfg(desktop)]` / `#[cfg(mobile)]`; a host
test compares each list with the macro's names in `lib.rs`'s source text. Every function of an RA2-excluded command is
`#[cfg(desktop)]`, so the Android handler can't name one (XC fails).

### 2.2 Android-only commands

All return `Result<T, IpcError>` unless noted; DTOs are camelCase (`ts-rs`, `app/ui/src/ipc/types.ts`).

| Command | Arguments | Returns |
| --- | --- | --- |
| `vault_start` | — | `StartStateDto` (§5.1), the current state |
| `vault_find` | — | `FoundVaultDto[]` `{ name, path, rel }`: RA6's result under the shared root; `rel` is `path` relative to it. Requires access (else `IpcError` kind `NoAccess`) |
| `storage_access` | — | `{ granted: boolean, sharedRoot: string }` |
| `storage_access_settings` | — | `()`; opens the system page (§6) and returns at once |

`vault_open` and `vault_create` stay. On Android both pass their path through `resolve_typed_path` first (§4.3) and
refuse with the `IpcError` kinds `FullPath`, `OutsideShared`, `NotFound`, `NotATeggVault`; `vault_create`'s
`parent` must resolve to an existing folder in shared storage (its `.tegg/` check is skipped). Both refuse with
`NoAccess` while access is off. The opened path and the recent-vaults entry are the on-disk path.

### 2.3 Events

- `vault:start` with `StartStateDto`, to `main`, on every state change (§5).
- Every desktop event is unchanged. `capture:*`, `import:*`, `nav:mouse`, `shell:route` from the menu and
  `app:quit-requested` are never emitted on Android.

## 3. Core

### 3.1 `fs_change_of` (FR-SYN-03 AC-32, D-2028)

```rust
pub fn fs_change_of(ev: &notify::Event, base: &Path) -> Option<FsChange>
```

RA6's table, exactly. `base` is the canonical vault root; paths are stripped of it, NFC, empty ones dropped. The
`notify` callback in `LocalFs::watch` is `|res| match res { Ok(ev) => if let Some(c) = fs_change_of(&ev, &base) { sink(c) }, Err(_) => sink(FsChange::Rescan) }`.
The regression test `bug_and0f1_fr_syn_03_access_events_are_not_changes` lives in `crates/tegg-vault/src/local.rs`'s
test module (it may call the function, which exists with today's behaviour once the red commit adds it as a stub that
treats every event as a change). The AC test is `crates/tegg-vault/tests/ac_android_watcher.rs`.

### 3.2 On-disk names (FR-FMT-12 AC-14, D-2029)

```rust
pub enum OnDiskName { Found(String), Missing, Ambiguous }
pub fn on_disk_name(listing: &[String], nfc_name: &str) -> OnDiskName
```

`listing` is one folder's entry names as read from disk (any normalisation); `nfc_name` one path component. `Found`
holds the listed bytes of the single entry whose NFC form equals `nfc_name`; two such entries give `Ambiguous`.

`LocalFs` resolves a vault path for reading, stat, rename source and replacing write: the path as given if it exists;
otherwise component by component with `on_disk_name` over `read_dir`. `Ambiguous` is `io::ErrorKind::InvalidData`
(the note is listed once as a name conflict through the existing FR-FMT-12 AC-3 path and never written). A new file is
created under its NFC name. On APFS the first lookup always succeeds, so the desktop does no extra work.

### 3.3 No bulk jobs (FR-SYN-06 AC-50, D-2025; CP-1)

```rust
#[derive(Clone, Copy, Debug)]
pub struct OpenExtras { pub bulk_jobs: bool }
impl Default for OpenExtras { /* bulk_jobs: true */ }
impl Core {
    pub fn open_ext(root: &Path, dirs: &AppDirs, opts: CoreOptions, extras: OpenExtras) -> Result<Core, CoreError>;
}
```

`Core::open(root, dirs, opts)` is `open_ext(…, OpenExtras::default())`. With `bulk_jobs: false` the tidy scheduler
(`tidy4e::spawn`) is not started, and `jobs().start(op)` returns `JobError::Unsupported` (new variant; `job_err` maps it
to the `IpcError` kind `Unsupported`) for every `JobOp` except `TestBackup`: `NoteRename`, `Undo`, `Redo`,
`TagRename`, `TagDelete`, `Merge`, `KeyRename`, `ValueRemove`, `TypeMove`, `FolderMove`, `TypeDelete`, `Inbox`,
`Restore`, `QueryRename` (and any op added later unless it is listed here), before any plan or write. The Android shell always passes
`bulk_jobs: false`. The test is `crates/tegg-core/tests/ac_android_jobs.rs`.

## 4. Shell pure functions (host-tested)

### 4.1 `app_dirs_for` (FR-STO-07 AC-12)

```rust
pub enum Platform { MacOs { home: PathBuf, preview: bool, test: bool, app_support: Option<String> }, Android { files_dir: PathBuf } }
pub fn app_dirs_for(p: &Platform) -> AppDirs
```

macOS: `app_support` when `test` and non-empty, else `<home>/Library/Application Support/Tegg[ Preview]`. Android:
`files_dir`, nothing else (no `$HOME`, no constant). The desktop's `app_dirs()` builds `Platform::MacOs` from the
environment and calls it. On Android `files_dir` is `Context.getFilesDir()` from the plugin (§6, CP-2), and
`AppState` is managed in `setup` once it is known.

### 4.2 `find_vaults` (FR-VLT-01 AC-24)

```rust
pub struct FoundVault { pub name: String, pub path: PathBuf }
pub fn find_vaults(root: &Path) -> Vec<FoundVault>
```

RA6's rules. Order: `tegg_format`'s title collation (`und`, the one `index_list` sorts with), then the path's bytes.

### 4.3 `resolve_typed_path` (FR-VLT-01 AC-25, AC-26)

```rust
pub enum PathRefusal { FullPath, OutsideShared, NotFound, NotAVault }
pub fn resolve_typed_path(input: &str, shared_root: &Path, private_root: &Path, need_vault: bool) -> Result<PathBuf, PathRefusal>
```

RA4's rules, in order: trim; strip one trailing `/`; `/sdcard` prefix → `shared_root`; not absolute → `FullPath`;
lexically normalised (`.`/`..` folded without touching the disk) and then canonicalised when it exists; not under
`shared_root` (or under `private_root`) → `OutsideShared`; missing → `NotFound`; with `need_vault`, no
`.tegg/vault.yml` file → `NotAVault`. Each component is matched on disk with `on_disk_name`, so the result is the
on-disk path. `vault_create` calls it with `need_vault: false` for `parent`.

## 5. The start flow on Android (FR-VLT-01 AC-18…AC-22)

### 5.1 States

```rust
pub enum StartState { NeedsAccess { path: Option<String> }, Opening { name: String, path: String }, Open { vault: VaultInfo }, Failed { path: String, kind: String }, None }
pub fn start_state(access: bool, remembered: Option<&Path>, opened: Option<Result<VaultInfo, String>>) -> StartState
```

`StartStateDto` is `{ state: 'needsAccess', path?: string } | { state: 'opening', name, path } | { state: 'open', vault } |
{ state: 'failed', path, kind } | { state: 'none' }`. `remembered` is `TEGG_VAULT` (test APK, §7) or the last opened
vault, whether or not the folder exists (a missing one ends in `failed`, kind `NotFound`).

### 5.2 Order

1. `setup`: register the plugin, read `files_dir`, load `test-env.json` (test APK), manage `AppState`, build the
   `main` window with `init_script` (it sets `window.__TEGG_PLATFORM__ = 'android'`), write the mark `setup-done`
   with `{"windows":["main"]}` (§7.2).
2. Then, on a background thread: check access. Off → `NeedsAccess`. On → `Opening` (if remembered), then `open_vault`
   with `OpenExtras { bulk_jobs: false }` → `Open` or `Failed`; nothing remembered → `None`.
3. `RunEvent::Resumed`, and `vault_start` called while in `NeedsAccess`, check access again. Off while a vault is open:
   the core is dropped (watcher stopped), `AppState.vault` cleared, state `NeedsAccess { path }`. On while in
   `NeedsAccess`: step 2.
4. The page: subscribe to `vault:start`, then `vault_start`, render from the latest state; on
   `visibilitychange: visible` it calls `vault_start` again (the resume fallback).

The shell never calls `Core::open` while access is off. The desktop keeps `vault_current` and opening in `setup`.

## 6. The plugin `tauri-plugin-tegg-android` (D-2018)

Crate `app/src-tauri/tegg-android` (target-gated dependency of the shell: `[target.'cfg(target_os = "android")'.dependencies]`),
Kotlin package `app.tegg.android`, class `TeggStoragePlugin`, registered with `register_android_plugin("app.tegg.android", "TeggStoragePlugin")`.

| Kotlin command | Returns | Does |
| --- | --- | --- |
| `access` | `{ granted, sharedRoot }` | `Environment.isExternalStorageManager()`, `Environment.getExternalStorageDirectory()` |
| `filesDir` | `{ path }` | `context.filesDir.absolutePath` |
| `openSettings` | `{}` | `startActivity(Intent(ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:<id>")))` |

On `load`, when the app is debuggable, it calls `WebView.setWebContentsDebuggingEnabled(true)` (the LA layer, §12; the
release APK is not debuggable). The plugin's Rust side exposes `TeggAndroid { access(), files_dir(), open_settings() }`
as managed state; it adds no Tauri commands of its own.

## 7. Test hooks on Android (D-2032)

### 7.1 `test-env.json`

The test APK (no feature `preview`) reads `<files_dir>/test-env.json` once in `setup`, before anything else: a JSON
object of string values, the same keys as the desktop's environment (`TEGG_TEST`, `TEGG_VAULT`, `TEGG_PERF_LOG`,
`TEGG_NOW`, `TEGG_THEME`, `TEGG_ROUTE`, `TEGG_TEST_TIDY`, `TEGG_TEST_QUIET_MS`, …). `test_var(name)` reads that map
first, then the environment; `TEGG_TEST` from the map counts as the environment's. The code is under
`#[cfg(all(mobile, not(feature = "preview")))]`, so the string `test-env.json` is not in the release library
(AR-08 AC-5). `TEGG_PERF_LOG` holds a path inside `files_dir`.

### 7.2 Marks

On Android `ms_since_process_start` reads field 22 (`starttime`, clock ticks) of `/proc/self/stat` against
`/proc/uptime`. New marks, written only with `TEGG_PERF_LOG`: `setup-done` (with `"windows": [labels]`),
`vault-opened` (each time a core opens; repeatable), `access` (with `"granted": bool`, repeatable). `index-idle` is
written on Android as on the desktop (D-207). Repeatable marks go through `mark_repeat`.

## 8. The Gradle project (D-2018…D-2020, D-2030, D-2034)

`app/src-tauri/gen/android/` comes from `tauri android init` once (Tauri CLI 2.12.1) and is then edited and committed;
no script runs `init` again. `.gitignore` there excludes `build/`, `.gradle/`, `local.properties`, `*.jks`,
`*.keystore`, `keystore.properties`, `app/src/main/jniLibs/`, `app/src/main/assets/`.

- `app/build.gradle.kts`: `minSdk 30`, `targetSdk 35`, `compileSdk 36`, `abiFilters += "arm64-v8a"`;
  `applicationId` from the Tauri config's `identifier`; `versionName`/`versionCode` from `tauri.properties`, which the
  Tauri CLI writes from the version (RA7's formula is Tauri's own); a `release` signing config read from the file named
  by `TEGG_ANDROID_SIGNING` (the release and test scripts always set it; no default inside the project).
- `app/src/main/AndroidManifest.xml`: `MANAGE_EXTERNAL_STORAGE` only; `INTERNET` declared with
  `tools:node="remove"`; `android:allowBackup="false"`, `android:dataExtractionRules="@xml/data_extraction_rules"`,
  `android:fullBackupContent="false"`; label `Tegg`.
- `app/src/main/res/xml/data_extraction_rules.xml`: `<cloud-backup>` and `<device-transfer>` each exclude the domains
  `root`, `file`, `database`, `sharedpref`, `external`.
- `app/src/debug/AndroidManifest.xml`: `INTERNET` (the dev server, `tauri android dev`). The test APK is the
  `release` variant, so it never has it.
- `tauri.conf.json` gains `bundle.android` with `minSdkVersion: 30` only; the identifier stays.

## 9. UI

### 9.1 Platform and refusals (AR-03 AC-11, D-2026)

`init_script` adds `window.__TEGG_PLATFORM__ = "android"` on Android and `"macos"` on the desktop. `platform()` reads
it. The IPC client's `invoke` wrapper, when `platform() === 'android'` and the command is in `ANDROID_EXCLUDED`,
rejects with `{ kind: 'Unsupported', message: '' }` without calling Tauri. `ANDROID_EXCLUDED` equals RA2's groups;
`app/test/android_platform.ac.test.ts` compares it with `commands::ANDROID` through a JSON file the Rust test writes
(`app/src-tauri/target/commands.json`; CP-3). An `Unsupported` rejection of a user action shows `error.unsupported` in
the existing non-modal alert.

On Android the palette registry drops the commands whose only action is excluded (ids `import.open`,
`vault.reveal`, `capture.open`, `app.about` and the group J/V commands); the logo menu drops `About Tegg`; the vault
switcher's `Open folder as vault…` routes to `AndroidChooser`. On `macos` all of these are unchanged.

### 9.2 Start (FR-VLT-01 AC-18…AC-21)

`App.tsx` on Android renders from `StartStateDto` (§5.1): `needsAccess` → `AccessScreen` (`main[aria-label="Allow access
to your notes"]`, RA5 texts, button `data-command="android.openSettings"`, `android.access.stillOff` after a return
that is still `needsAccess`); `opening` → the frame with `role="status"` `Opening <name>…` and no sidebar entries;
`open` → the vault as `opened(v)` does today; `failed` → `AndroidChooser` with the FR-VLT-01 AC-7 message; `none` →
`AndroidChooser`. It never calls `vault_current` on Android.

### 9.3 `AndroidChooser` (RA4, FR-VLT-01 AC-23, AC-25, AC-26)

`main[aria-label="Choose a vault"]` with sections `Recent vaults` (`data-command="vault.openRecent"`),
`Vaults on this phone` (`data-command="vault.openFound"`), the `Folder path` input (`autocapitalize="off"`,
`autocorrect="off"`, `spellcheck=false`) and `Open` (`data-command="vault.openPath"`), and `Create new vault`
(`data-command="vault.new"`, the desktop form with a `Location` text input, `data-command="vault.create"`). Error kinds
map to RA5: `FullPath` → `chooser.android.fullPath`, `OutsideShared` → `chooser.android.outsideShared`,
`NotATeggVault` → `chooser.android.notAVault` + hint, others → `errorMessage(kind)`.

### 9.4 Flush when hidden (FR-EDT-08 AC-14)

On Android the editor host listens to `visibilitychange`; on `hidden` it flushes the pending save at once (the same
call as the debounce's end). On `macos` it adds no listener.

## 10. Builds and tools

### 10.1 Release (AR-08 AC-1…AC-3, AC-6; D-2021, D-2022)

`npm run app:release -- <v> [--no-apk]`. `release-plan.mjs` exports:

```js
export function versionCode(v)            // RA7; throws RangeError for MINOR or PATCH > 999 or a bad version
export function releasePlan({ version, apk, signing, repo })  // → { steps: [{ id, cmd, args, env }], outputs }
export function signingConfig(path, repo) // → { storeFile, … } or throws Error naming the file / 'inside the repository'
```

Plan order with the APK: `check-signing`, `build-app` (as today), `build-apk`
(`npx tauri android build --apk --target aarch64 --features preview --config src-tauri/tauri.preview.conf.json --config '{"version":"<v>"}'`
with `TEGG_VERSION=<v>`, `TEGG_ANDROID_SIGNING=<file>`), `copy-apk` (to `bundle/release/Tegg-<v>.apk`), `apk-check`
(`--expect release --version <v>`), then the existing DMG, zip, install and GitHub steps (the APK is the third asset).
A failing step stops the run; `build-apk` or `apk-check` failing removes `Tegg-<v>.apk`. A bad version exits 2 before
any step; a missing or in-repo signing config exits 1 before any build. The signing config default is
`~/.config/tegg/android-signing.properties`, overridden by `TEGG_ANDROID_SIGNING`.

### 10.2 Test APK (D-2032)

`npm run app:android-test`: builds the release variant for `aarch64` without `preview`, version `0.0.1`, signed by the
throwaway key `tools/android/sign.sh` creates in `.verify/android/test-signing.properties` (ignored), and copies it to
`app/src-tauri/target/android/Tegg-test.apk`. The identifier is `app.tegg.desktop`; it is debuggable through
`--config '{"bundle":{"android":{…}}}'`-free Gradle property `-Ptegg.debuggable=true` passed by the script (CP-4).

### 10.3 Environment (D-2033)

`tools/android/env.sh` (sourced): sets `JAVA_HOME`, `ANDROID_HOME`, `NDK_HOME`, `CC_aarch64_linux_android`,
`AR_aarch64_linux_android`, `CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER` from the defaults of D-2033 unless set; checks
the JDK, SDK, NDK and `rustup target list --installed | grep aarch64-linux-android`; on a miss prints
`android env: missing <what> (see tools/android/env.sh)` and returns 3. `tools/android/avd.sh up|down` creates (once)
and boots the headless AVD `tegg-and-35` (`system-images;android-35;google_apis;arm64-v8a`, 4 GB, `-no-window
-no-audio -no-snapshot-save`) and waits for `sys.boot_completed`, or kills it.

`qa.config.json`:
- `android-check` (lane `cargo`, `push`, inputs per AR-03 AC-6):
  `. tools/android/env.sh && (cd crates && cargo check --workspace --target aarch64-linux-android --quiet) && (cd app && mkdir -p dist && cd src-tauri && cargo check --lib --target aarch64-linux-android --quiet)`.
  An empty `app/dist/` is enough for `generate_context!` in a check (CP-5).
- `app-android-e2e` (lane `browser`, `milestone` and `nightly`): `npm run app:android-test`, `avd.sh up`, `apk-check
  --expect test`, `node --test app/e2e-android/*.ac.test.ts` (nightly adds `nightly_*`), `avd.sh down` always.

### 10.4 `apk-check` (NFR-SEC-01 AC-1, FR-STO-07 AC-14, AR-08 AC-2…AC-5)

`node tools/qa/src/apk-check.ts <apk> --expect release|test [--version <v>] [--json]`: reads the APK with the SDK's
`aapt2 dump badging`, `aapt2 dump xmltree --file AndroidManifest.xml`, `apksigner verify --print-certs -v` and the
zip listing. Exports `checkApk(facts, expect)` → `string[]` (failures) over a parsed `ApkFacts` object, so the rules are
unit-tested on given facts; the CLI exits 1 with one failure per line. Rules: RA1's identity, permissions (NFR-SEC-01
AC-1), backup (FR-STO-07 AC-14), version (RA7), ABIs, debuggable, signer not `CN=Android Debug` (release), and
`test-env.json` in `lib/arm64-v8a/libtegg_app_lib.so` only for `test`.

## 11. Points for the owner (CP-1…CP-6)

| CP | Point | Proposal | Alternative | Affects |
| --- | --- | --- | --- | --- |
| CP-1 | **`CoreOptions { bulk_jobs }` breaks 69 test files.** `CoreOptions` is built as a struct literal (`CoreOptions { watch, sync: None }`) in 69 files, most of them AC tests. A new field stops them compiling, and AC tests may not change without a trailer. | `OpenExtras { bulk_jobs }` and `Core::open_ext(…)`; `Core::open` is unchanged. FR-SYN-06 AC-50 reads `CoreOptions { bulk_jobs: false, .. }` as `open_ext(…, OpenExtras { bulk_jobs: false })`. | Add the field and change the 69 files under one `AC-Test-Change` trailer | §3.3, FR-SYN-06 AC-50 |
| CP-2 | **"Tauri's path API (`app_data_dir`)" is not the private files dir.** On Android Tauri's `app_data_dir` is `/data/user/0/<id>/<id>` (`dataDir` plus the identifier), while RA1 and FR-STO-07 AC-12, AC-13 name `/data/user/0/<id>/files` (`run-as … ls files/`). | Take `Context.getFilesDir()` from the plugin (§6): still the platform's own answer, never a constant. | Use `app_data_dir` and read AC-12/AC-13's paths as `<id>/<id>` | §4.1, §6 |
| CP-3 | **How the UI's refusal list is tied to the Rust lists.** | The Rust AC-9 test writes `commands.json` (`DESKTOP`, `ANDROID`) to `app/src-tauri/target/`; the TS test reads it and fails when it is missing. The `app-shell-test` step runs Rust before the UI tests. | A hand-kept copy checked only by review | §9.1, AR-03 AC-9, AC-11 |
| CP-4 | **The LA layer without Appium.** The ACs name Appium UiAutomator2 "or the accessibility tree, as the contract decides". Appium needs the UiAutomator2 driver and a chromedriver matching WebView 124, both downloads. | Drive the device with `adb` (install, `am`, `input keyevent`, `appops`, `run-as`, `dumpsys`, `uiautomator dump` for native screens) and the WebView through the Chrome DevTools Protocol over `adb forward tcp:<port> localabstract:webview_devtools_remote_<pid>` (Node's built-in `WebSocket`); the test APK is debuggable and the plugin enables WebView debugging only then (§6). No new dependency. AC-18's "UiAutomator dump every 250 ms" becomes a CDP `MutationObserver` check (a `uiautomator dump` takes about 1 s). | Appium UiAutomator2 with chromedriver (`npm run e2e:setup-android` downloads both) | §12, every LA criterion |
| CP-5 | **`generate_context!` needs `frontendDist`.** `cargo check` of the shell fails without `app/dist`. | The step creates an empty `app/dist` when missing; a check doesn't embed the UI. | Build the UI first in the step (about 20 s more) | §10.3, AR-03 AC-6 |
| CP-6 | **Debuggable test APK.** Tauri builds `release` variants non-debuggable; the LA layer needs `run-as` and WebView debugging. | `gen/android/app/build.gradle.kts` sets `isDebuggable = true` on `release` when the Gradle property `tegg.debuggable` is `true`; only `app:android-test` passes it, and `apk-check --expect release` fails on a debuggable APK (AR-08 AC-4). | A third build type `teggTest` | §8, §10.2 |

## 12. The LA harness (CP-4)

`app/e2e-android/helpers/device.ts` exports: `adb(args)`, `install(apk)`, `start(id, { cold })` (`am force-stop`, `am
start -W -n <id>/.MainActivity`, returns pid), `home()`, `back()`, `foregroundPackage()`, `appops(id, 'allow'|'deny')`,
`runAs(id, cmd)`, `pushVault(fixture)` (a fresh `/sdcard/Documents/tegg-la-<random>/<name>`, returns its path),
`writeTestEnv(id, env)`, `perfMarks(id)`, `fileState(path)` (`sha256sum`, `stat -c '%s %i %Y'`), `cpuTicks(pid)`,
`socketsOf(uid)`; and `webview(id)` → `{ eval(expr), waitFor(selector), click(selector), type(text), observeNever(selector) }`
over CDP. Every test file starts with `requireDevice()` (fails, never skips, when no emulator is attached under a gate).
The NFR-SEC-01 AC-3 monitor is `helpers/socket-monitor.ts`, started by the step around the whole run.
