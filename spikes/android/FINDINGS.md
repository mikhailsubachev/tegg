# Spike AND-0 Findings: Tegg on Android (emulator part)

**Date:** 2026-11-20 · **Branch:** `claude/tegg-android-mvp-plan-9e9b45` · **Host:** the owner's M2 Pro · **Device:** Android emulator, Android 15 (API 35), arm64, 4 cores, 4 GB, system WebView 124 · **Toolchain:** Tauri CLI 2.12.1, NDK 28.2, SDK platform 36, JDK 21, Rust 1.99 · **Plan:** `docs/plans/android-mvp-plan.md` §6 (D-2000…D-2012)

## Verdict: GO for AND-1, three checks carried into it

The current app, with a small gating patch and no changes to the core's logic, builds as an APK, starts on Android, opens the 5,000-note reference vault from shared storage, shows it, opens a note and saves an edit with a minimal diff. One real defect was found in the core (the watcher, F1) and one in the start-up order (F2); both have a clear fix.

Not done yet, so the verdict is not final: typing with a real on-screen keyboard on a real phone (item 3), the separate Drive sync app (item 6) and the Drive API (item 7). All three need the owner's phone or Google account.

| Item (plan §6) | Result |
| --- | --- |
| 1. Core and shell compile for Android; the app starts | **Pass** on the emulator. Core: no changes. Shell: 16 compile errors, all desktop-only calls (F3). Not run on a phone yet |
| 2. Index and open times on the reference vault | **Pass** on the emulator (table below). A phone will be slower; not measured |
| 3. Typing with Gboard, Czech diacritics | **Open.** Injected key events reach the editor and save correctly; real keyboard composition and autocorrect were not tested |
| 4. Round trip | **Partly.** Opening a note writes nothing (same checksum); an edit changes only the typed text and `modified`. The full round-trip corpus was not run through the Android WebView |
| 5. "All files access": real paths, atomic rename, watcher in shared storage | **Pass** on the emulator, with the permission granted over `adb` |
| 6. The separate Drive sync app | **Open** (owner's phone and account) |
| 7. Drive API: sign-in, change list, how the Mac's atomic writes appear | **Open** (owner's Google Cloud project) |

## Performance (p95 of 3 runs, release build of `tools/core-perf`, run over `adb`)

Reference vault, seed 1, `--small-images`: 5,000 notes + 2,000 Image objects + 200 Tag objects = 7,200 indexed objects. The watcher fix of F1 is applied in both Android columns.

| Metric | Mac target (D-59) | Mac | Emulator, private storage | Emulator, shared storage (FUSE) |
| --- | ---: | ---: | ---: | ---: |
| NFR-PERF-02 full index | 18,000 ms | 1,502 ms | 2,457 ms | 5,253 ms |
| NFR-PERF-02/AC-2 reopen, 100 files changed offline | 2,250 ms | 381 ms | 391 ms | 775 ms |
| NFR-PERF-03 switcher, per keystroke | 75 ms | 34.8 ms | 55.8 ms | 55.8 ms |
| NFR-PERF-04 search, first 50 with snippets | 150 ms | 18.3 ms | 18.6 ms | 21.0 ms |
| NFR-PERF-08 external change searchable | 1,500 ms | 70.5 ms | 61.1 ms | 55.1 ms |

- The emulator runs on the Mac's own cores, so these are a **lower bound** for a phone, not phone numbers. Phone targets (D-2010) still need a run on the owner's phone.
- Shared storage costs about 2× on file-heavy work, because every file access goes through Android's FUSE layer.
- In the app (debug build), opening the vault with an existing index took 1.6–5.0 s for 7,200 files in shared storage.

## Findings

**F1. The watcher never lets the index go idle on Android (defect, core).** `tegg-vault`'s `watch` passes every `notify` event to the index. On macOS FSEvents reports changes only; on Linux and Android inotify also reports **reads** (open, close). The indexer's own reads come back as changes, it reads again, and the loop never ends: the index thread used a full core for more than 5 minutes and `wait_idle` timed out after 600 s. Ignoring `EventKind::Access` events fixes it (one line; NFR-PERF-08 then passes at 61 ms). This is a product bug on any Linux-family platform, to be fixed test-first in AND-1 (a regression test with a fake change source that emits read events).

**F2. The page loads before the vault is open (defect, shell).** On the Mac the page starts loading after `setup` returns. On Android the WebView loads while `setup` still runs, so the page's single `vault_current` call got "no vault" and showed the vault chooser, although the core opened the vault moments later. Opening the vault before the window is created fixed it in the spike. The product fix is either that order or an event that tells the page the vault is open.

**F3. The shell needs gating, not a rewrite.** All 16 Android compile errors are desktop-only calls: the app menu, the tray item, window decoration and title-bar calls, `center`, `unminimize`, and the folder dialog's `pick_folder`. Gating them (`cfg(desktop)` / `cfg(mobile)`) and adding the mobile entry point took about 60 changed lines. The capture windows, hotkeys, single-instance socket and mouse-button hook are simply not started on mobile.

**F4. No folder picker.** `tauri-plugin-dialog` has no `pick_folder` on Android. AND-1 needs its own way to choose the vault folder (a small list of folders that hold `.tegg/`, or a typed path), because the Storage Access Framework picker gives no real path (plan §3.3).

**F5. Without the permission the vault looks empty, with no error.** Before "All files access" was granted, the app opened the vault folder and showed every count as 0: Android hides the files instead of refusing access. AND-1 must check the permission before opening a vault in shared storage and send the user to the system setting.

**F6. The app runs without the `INTERNET` permission.** Tauri's Android template adds it; the spike removed it and the app started, showed the vault and saved an edit. D-2002 ("no `INTERNET` permission until AND-4") is feasible.

**F7. App data location.** `app_dirs()` builds the path from `$HOME/Library/Application Support`, which does not exist on Android. The spike hard-coded the app's private files folder; AND-1 takes it from the platform.

**F8. The desktop layout is unusable on a phone, as expected.** The sidebar and the page share the screen, the page is cut off on the right, and the app draws under the status bar (the top row overlaps the clock and is hard to tap). The on-screen keyboard covers the lower half without resizing the page. This is the work of AND-2 and AND-3 (plan §3.5, §3.7), including safe-area insets. The owner's input from the first screenshot: each note opens as its own full-screen page.

**F9. Tauri needs a version of at least 0.0.1 for Android.** `tauri.conf.json` has `0.0.0`; the spike passed the version on the command line. The release script must set it for the APK too (D-2011).

**F10. Build size and time.** The debug APK is 884 MB (unstripped debug libraries); a release build will be far smaller and was not measured. A first Android build took about 3 minutes, a rebuild about 1.5 minutes.

**F11. `tauri android init` installs more than it says.** It added the Rust targets `armv7-linux-androideabi` and `i686-linux-android` on its own.

## What worked without any change

- Every core crate compiles for `aarch64-linux-android`, including bundled SQLite, BLAKE3, ICU collation and the watcher. The macOS-only calls in `tegg-vault` already had portable fallbacks (AR-03 AC-3 did its job).
- Atomic writes in shared storage: the edit left no temporary file behind.
- Czech file names and text (NFC) list, open and save correctly.
- The UI state survives a restart: the app reopened the last note.
- Touch navigation: tapping sidebar rows and table rows opens them.

## How it was run

- Toolchain: `brew install --cask android-commandlinetools`; `sdkmanager` for platform tools, platform 36, build tools 36.0.0, NDK 28.2.13676358, the emulator and the `android-35` `google_apis` arm64 image (about 8.3 GB in `/opt/homebrew/share/android-commandlinetools`); `rustup target add aarch64-linux-android x86_64-linux-android`. The environment: `JAVA_HOME` (JDK 21), `ANDROID_HOME`, `NDK_HOME`, and for the core build `CC_aarch64_linux_android`, `AR_aarch64_linux_android` and `CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER` pointing at the NDK's `aarch64-linux-android26-clang` and `llvm-ar`.
- Core: `cargo build --release --target aarch64-linux-android --manifest-path tools/core-perf/Cargo.toml`, pushed to `/data/local/tmp` and run with `TMPDIR` in private storage and in `/sdcard/Documents`.
- App: a throwaway patch of about 60 lines over `app/src-tauri` and one line in `tegg-vault` (F1…F3, F7; the product code is unchanged), `npx tauri android init`, `npx tauri android build --debug --apk --target aarch64 --config '{"version":"0.0.1"}'`, installed with `adb`, permission granted with `adb shell appops set app.tegg.desktop MANAGE_EXTERNAL_STORAGE allow`. The vault was the generated reference vault in `/sdcard/Documents/TeggVault`.
- Only generated data was used (D-62).
- The spike's patch, environment file, generated Android project, APK and emulator device were removed on 2026-11-22 (owner: "keep just findings", as D-1366 did for S1–S5); the patch and the environment file are in commit `d4c753e6`. The Android SDK, NDK and Rust targets stay installed for slice AND-1.

## Open items, moved to slice AND-1

The spike was closed on 2026-11-22 with these checks open; they run on the first AND-1 build instead of a spike APK.

1. **On the owner's phone:** install the AND-1 build, grant "All files access", type in a note with Gboard (Czech diacritics, autocorrect, Enter in lists, backspace at block starts), and time the index.
2. **The separate Drive sync app:** hidden folders `.tegg/` and `.trash/`, Tegg's temporary files, conflict-copy names.
3. **Drive API:** sign-in with the full `drive` scope and token lifetime, the change list, and whether the Mac client uploads Tegg's atomic writes as an update or as a delete and a create.
4. The round-trip corpus and the UI tests on Chromium (D-2009).
