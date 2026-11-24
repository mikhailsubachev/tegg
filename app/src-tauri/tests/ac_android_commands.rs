//! Slice AND-1, L1 (Mac host): docs/acceptance/android-shell.md AR-03 AC-9 "The command sets are data and match RA2"
//! (AP-2024 → D-2024), through docs/contracts/android-shell.md §2.1: the shell's `commands::DESKTOP`, `ANDROID` and
//! `ANDROID_ONLY`, the two `generate_handler!` calls in `src/lib.rs`'s source text (under `#[cfg(desktop)]` and
//! `#[cfg(mobile)]`), the desktop handler on main at the merge-base (`git show`; D-2053), `build.rs`'s manifest and every file in
//! `capabilities/`. The XC half (an Android handler naming a desktop-only function fails `cargo check --target
//! aarch64-linux-android`) is the `android-check` step (AR-03 AC-6).
//!
//! CP-3 → D-2038: the test writes `target/commands.json` (`{"DESKTOP": [...], "ANDROID": [...], "ANDROID_ONLY": [...]}`)
//! under this package, which `app/test/android_platform.ac.test.ts` reads (AR-03 AC-11's L1 part).
//!
//! Red-test reading (reported to the owner): AC-9 (c), (d) require every RA2-excluded command, the capture ones
//! included, to be allowed only by capability files with `platforms: ["macOS"]`, and no capability on Android to name
//! the `capture` window. A capability without `platforms` applies to every platform (Tauri), so `capture.json` needs
//! `platforms: ["macOS"]` too; AR-03 AC-12 (b) is read as "equal apart from that field" for it, as for `default.json`.
//! Written from the ACs and the contract only (D-61).

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;
use tegg_app_lib::commands::{ANDROID, ANDROID_ONLY, DESKTOP};

const P1: &[&str] = &[
    "capture_context", "capture_create", "capture_ready", "capture_hide", "capture_resize", "capture_open_main", "capture_draft_get",
    "capture_draft_set", "capture_saved_show", "capture_saved_hover", "capture_suggest", "capture_open", "capture_media_add",
];
const P2: &[&str] = &["hotkeys", "hotkeys_retry", "shell_settings", "shell_settings_set"];
const P3: &[&str] = &[
    "import_pick_source", "import_scan", "import_cancel", "import_where", "import_check_target", "import_plan", "import_start", "import_status",
    "import_discard", "import_transform_result",
];
const P4: &[&str] = &["vault_pick_dir", "media_pick"];
const P5: &[&str] = &["vault_reveal", "media_reveal", "backup_reveal", "media_open", "open_external", "app_about", "app_quit"];
const J: &[&str] = &[
    "note_rename", "tag_rename", "tag_delete", "merge_start", "type_move_plan", "type_move", "folder_move_preview", "tidy_now", "value_remove_start",
    "type_delete_start", "inbox_bulk", "starter_add", "backup_restore", "job_undo", "job_redo", "type_create", "type_patch", "type_delete",
];
const V: &[&str] = &["query_apply", "query_revert", "query_create", "query_duplicate", "query_rename", "query_trash", "query_restore", "task_views_restore"];
const O: &[&str] = &["graph_neighbourhood", "graph_presets_get", "graph_presets_apply", "index_related", "trash_restore", "trash_delete", "trash_empty"];
// Slice AND-2 (docs/contracts/android-phone.md §2.1, CP-4 → D-2204; AP-2056 → D-2192): RA2 gains `android_open_url` and
// `android_window`, so ANDROID_ONLY lists six commands (AC-Test-Change, approved by the owner with the contract).
const ONLY: &[&str] = &["vault_start", "vault_find", "storage_access", "storage_access_settings", "android_open_url", "android_window"];

fn excluded() -> BTreeSet<&'static str> {
    [P1, P2, P3, P4, P5, J, V, O].iter().flat_map(|g| g.iter().copied()).collect()
}

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn perm(cmd: &str) -> String {
    format!("allow-{}", cmd.replace('_', "-"))
}

/// Drops `//` comments (line ends) so names in comments don't count.
fn strip_comments(src: &str) -> String {
    src.lines().map(|l| l.split("//").next().unwrap_or("")).collect::<Vec<_>>().join("\n")
}

/// Every `generate_handler![…]` call of `src`: (byte offset, command names in order; a path's last segment).
fn handlers(src: &str) -> Vec<(usize, Vec<String>)> {
    let src = strip_comments(src);
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(i) = src[from..].find("generate_handler!") {
        let at = from + i;
        let open = at + src[at..].find('[').unwrap_or(0);
        let close = open + src[open..].find(']').unwrap_or(0);
        let names = src[open + 1..close]
            .split(',')
            .map(|t| t.trim())
            .filter(|t| !t.is_empty())
            .map(|t| t.rsplit("::").next().unwrap_or(t).trim().to_string())
            .collect();
        out.push((at, names));
        from = close.max(at + 1);
    }
    out
}

/// The nearest `#[cfg(…)]` attribute before `at` in `src`, if any.
fn cfg_before(src: &str, at: usize) -> Option<String> {
    let s = &src[..at];
    let i = s.rfind("#[cfg(")?;
    let end = s[i..].find(")]").map(|e| i + e + 2).unwrap_or(s.len());
    Some(s[i..end].to_string())
}

fn git_show(rev_path: &str) -> Option<String> {
    let out = Command::new("git").arg("show").arg(rev_path).current_dir(manifest_dir()).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// D-2053: the commit the desktop is compared with: the merge-base of HEAD and main (`origin/main`, else `main`);
/// HEAD itself when neither exists. On main that is HEAD, so the comparison holds there by construction.
fn desktop_base() -> String {
    let run = |args: &[&str]| Command::new("git").args(args).current_dir(manifest_dir()).output().ok().filter(|o| o.status.success()).map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
    for main in ["origin/main", "main"] {
        if let Some(b) = run(&["merge-base", "HEAD", main]) {
            return b;
        }
    }
    "HEAD".to_string()
}

fn quoted_strings(src: &str) -> Vec<String> {
    let src = strip_comments(src);
    let mut out = Vec::new();
    let mut it = src.split('"');
    it.next();
    while let Some(s) = it.next() {
        out.push(s.to_string());
        it.next();
    }
    out
}

struct Cap {
    file: String,
    platforms: Option<Vec<String>>,
    windows: Vec<String>,
    permissions: BTreeSet<String>,
}

fn capabilities(dir: &Path) -> Vec<Cap> {
    let mut out = Vec::new();
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir).map(|d| d.filter_map(|e| e.ok()).map(|e| e.path()).collect()).unwrap_or_default();
    files.sort();
    for f in files {
        if f.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let text = std::fs::read_to_string(&f).unwrap_or_default();
        let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
        let strs = |k: &str| v.get(k).and_then(|a| a.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect::<Vec<_>>());
        let permissions = v
            .get("permissions")
            .and_then(|a| a.as_array())
            .map(|a| a.iter().filter_map(|p| p.as_str().map(String::from).or_else(|| p.get("identifier").and_then(|i| i.as_str()).map(String::from))).collect())
            .unwrap_or_default();
        out.push(Cap { file: f.file_name().unwrap().to_string_lossy().into_owned(), platforms: strs("platforms"), windows: strs("windows").unwrap_or_default(), permissions });
    }
    out
}

fn applies_to(c: &Cap, platform: &str) -> bool {
    c.platforms.as_ref().map(|p| p.iter().any(|x| x.eq_ignore_ascii_case(platform))).unwrap_or(true)
}

#[test]
fn ar_03_ac9_command_sets_per_platform() {
    // CP-3: the lists for the UI's refusal test, written first so that test can read whatever the shell holds.
    let json = serde_json::json!({ "DESKTOP": DESKTOP, "ANDROID": ANDROID, "ANDROID_ONLY": ANDROID_ONLY });
    let target = manifest_dir().join("target");
    let _ = std::fs::create_dir_all(&target);
    let _ = std::fs::write(target.join("commands.json"), serde_json::to_string_pretty(&json).unwrap_or_default());

    let lib = std::fs::read_to_string(manifest_dir().join("src/lib.rs")).unwrap_or_default();
    // D-2053: the desktop set is the one on main where this branch last met it (the merge-base), not a fixed commit.
    let base = desktop_base();
    let old_lib = git_show(&format!("{base}:app/src-tauri/src/lib.rs"));
    assert!(old_lib.is_some(), "git show {base}:app/src-tauri/src/lib.rs (the desktop set of RA2)");
    let old = handlers(&old_lib.unwrap());
    // Before AND-1 there is one handler; once AND-1 is on main, the desktop one (the one not naming vault_start).
    let old_desk: Vec<_> = old.iter().filter(|(_, n)| !n.iter().any(|c| c == "vault_start")).collect();
    assert_eq!(old_desk.len(), 1, "setup: one desktop generate_handler! at {base}");
    let old_set: BTreeSet<String> = old_desk[0].1.iter().cloned().collect();

    assert_eq!(ANDROID_ONLY, ONLY, "ANDROID_ONLY lists RA2's six Android-only commands in order (AND-1's four, then android_open_url and android_window)");
    assert!(!DESKTOP.is_empty(), "commands::DESKTOP lists the desktop commands");

    // (a) DESKTOP = the desktop generate_handler! (source order) = the desktop set on main at the merge-base (D-2053).
    let now = handlers(&lib);
    assert_eq!(now.len(), 2, "lib.rs has two generate_handler! calls, one per platform (contract §2.1)");
    let stripped = strip_comments(&lib);
    let (desk, mobile): (Vec<_>, Vec<_>) = now.iter().partition(|(_, names)| !names.iter().any(|n| n == "vault_start"));
    assert_eq!((desk.len(), mobile.len()), (1, 1), "one desktop handler and one Android handler (the one naming vault_start)");
    let (desk_at, desk_names) = desk[0];
    let (mob_at, mob_names) = mobile[0];
    let desk_cfg = cfg_before(&stripped, *desk_at).unwrap_or_default();
    let mob_cfg = cfg_before(&stripped, *mob_at).unwrap_or_default();
    assert!(desk_cfg.contains("desktop"), "the desktop handler is under #[cfg(desktop)]; nearest cfg: {desk_cfg:?}");
    assert!(mob_cfg.contains("mobile") || mob_cfg.contains("android"), "the Android handler is under #[cfg(mobile)]; nearest cfg: {mob_cfg:?}");
    let desktop: Vec<String> = DESKTOP.iter().map(|s| s.to_string()).collect();
    assert_eq!(&desktop, desk_names, "(a) DESKTOP equals the desktop generate_handler!, in source order");
    let desktop_set: BTreeSet<String> = desktop.iter().cloned().collect();
    assert_eq!(desktop_set, old_set, "(a) DESKTOP equals the desktop set on main at {base} (AND-1 changes none)");
    assert!(!desktop_set.contains("type_misfits"), "(a) type_misfits stays unregistered (D-808)");

    // (b) ANDROID = DESKTOP − RA2's groups + the four Android-only commands.
    let ex = excluded();
    // D-2053: every desktop command is classified for Android: in ANDROID or in one of RA2's excluded groups.
    for c in &desktop {
        assert!(ANDROID.contains(&c.as_str()) || ex.contains(c.as_str()), "classify the desktop command {c} for Android: add it to commands::ANDROID or to an excluded group (RA2, D-2053)");
    }
    for c in &ex {
        assert!(desktop_set.contains(*c), "setup: RA2's excluded {c} is a desktop command");
    }
    let mut want: Vec<String> = DESKTOP.iter().filter(|c| !ex.contains(*c)).map(|s| s.to_string()).collect();
    want.extend(ONLY.iter().map(|s| s.to_string()));
    let android: Vec<String> = ANDROID.iter().map(|s| s.to_string()).collect();
    assert_eq!(android, want, "(b) ANDROID = DESKTOP minus P1…P5, J, V, O, then ANDROID_ONLY");
    assert_eq!(mob_names, &android, "(b) the Android generate_handler! names exactly ANDROID");
    for keep in ["vault_current", "vault_open", "vault_create", "vault_recent", "note_read", "note_write", "jobs_ready", "nav_swipe_scroll"] {
        assert!(android.contains(&keep.to_string()), "(b) {keep} stays on Android");
    }

    // build.rs's manifest lists the Android-only commands after the desktop's.
    let build = std::fs::read_to_string(manifest_dir().join("build.rs")).unwrap_or_default();
    let manifest = quoted_strings(&build);
    for c in DESKTOP.iter().chain(["type_misfits"].iter()).chain(ONLY.iter()) {
        assert!(manifest.iter().any(|m| m == c), "build.rs's manifest lists {c}");
    }
    let last_desktop = DESKTOP.iter().filter_map(|c| manifest.iter().position(|m| m == c)).max().unwrap_or(0);
    let first_only = ONLY.iter().filter_map(|c| manifest.iter().position(|m| m == c)).min().unwrap_or(0);
    assert!(first_only > last_desktop, "build.rs lists ANDROID_ONLY after the desktop's commands");

    // (c)…(e) the capability files.
    let caps = capabilities(&manifest_dir().join("capabilities"));
    assert!(caps.iter().any(|c| c.file == "android.json"), "capabilities/android.json exists (contract §1)");
    for c in &ex {
        let p = perm(c);
        for cap in caps.iter().filter(|cap| cap.permissions.contains(&p)) {
            assert_eq!(cap.platforms.as_deref(), Some(&["macOS".to_string()][..]), "(c) {p} is only in capabilities with platforms [\"macOS\"]; {} has {:?}", cap.file, cap.platforms);
        }
    }
    let on_android: Vec<&Cap> = caps.iter().filter(|c| applies_to(c, "android")).collect();
    let main: Vec<&&Cap> = on_android.iter().filter(|c| c.windows.iter().any(|w| w == "main")).collect();
    assert_eq!(main.len(), 1, "(d) one capability for the main window applies to Android: {:?}", main.iter().map(|c| &c.file).collect::<Vec<_>>());
    let allowed: BTreeSet<String> = main[0].permissions.iter().filter(|p| p.starts_with("allow-")).cloned().collect();
    let want_perms: BTreeSet<String> = ANDROID.iter().map(|c| perm(c)).collect();
    assert_eq!(allowed, want_perms, "(d) the Android main capability allows exactly ANDROID");
    for cap in &on_android {
        for w in &cap.windows {
            assert!(!w.starts_with("capture"), "(d) no capability on Android names the {w} window ({})", cap.file);
        }
        for p in &cap.permissions {
            assert!(!p.starts_with("http:") && !p.starts_with("shell:") && !p.starts_with("dialog:"), "(d) {} grants no {p} on Android", cap.file);
        }
    }
    for cap in caps.iter().filter(|c| applies_to(c, "macOS")) {
        for c in ONLY {
            assert!(!cap.permissions.contains(&perm(c)), "(e) {} (macOS) doesn't allow the Android-only {c}", cap.file);
        }
    }
}
