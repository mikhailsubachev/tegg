//! FR-DLY-01 AC-12 (D-1546, amends D-319; docs/acceptance/daily-notes.md, docs/contracts/v1-import.md §12.3): among
//! several Daily Notes of one date, a note without `import-id` comes before every note with one; D-319 / D-335's order
//! decides only inside each group. L4, on a temporary copy of `tests/fixtures/vaults/daily/`; the third note for
//! 12 Oct is written at test time (no committed file, contract §16.2). Written from the AC and the contract only (D-61).
//! A new file instead of an addition to `ac_daily.rs`, so the existing AC test file stays unmodified (TS-I3).

mod common;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use chrono::NaiveDate;
use common::*;
use tegg_core::{Core, CoreOptions};
use tegg_format::nfc;

const D12: &str = "Daily/2026-10-12.md";
const D12B: &str = "Daily/2026-10-12 (2).md";
const D12C: &str = "Daily/2026-10-12 (3).md";
const ZMINKY: &str = "Pages/Zmínky.md";
const IMPORT_LINE: &str = "import-id: \"capacities:PKM/DailyNotes/2026-10-12.md\"\n";

/// The AC's third note, byte for byte (LF, NFC). `import_line` is the `import-id` line or "".
fn imported(import_line: &str) -> String {
    format!(
        "---\nid: 01JB4B0000000000000000D015\ntype: daily-note\ntitle: \"2026-10-12\"\ndate: 2026-10-12\nreview: unreviewed\n{import_line}created: 2026-11-12T10:00:00+01:00\nmodified: 2026-11-12T10:00:00+01:00\n---\nImportovaný zápis.\n"
    )
}

// ------------------------------------------------------------------------------------------------ setup (no AC assertions)

fn copy_dir(from: &Path, to: &Path, skip: &[&str]) {
    std::fs::create_dir_all(to).expect("setup: create dir");
    for e in std::fs::read_dir(from).expect("setup: read_dir") {
        let e = e.expect("setup: entry");
        if skip.iter().any(|s| e.file_name() == std::ffi::OsStr::new(s)) {
            continue;
        }
        if e.file_type().expect("setup: type").is_dir() {
            copy_dir(&e.path(), &to.join(e.file_name()), &[]);
        } else {
            std::fs::copy(e.path(), to.join(e.file_name())).expect("setup: copy");
        }
    }
}
fn daily_vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Deník");
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fx.join("daily"), &root, &["README.md"]);
    copy_dir(&fx.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    write_raw(&root, D12C, imported(IMPORT_LINE).as_bytes());
    root
}
fn open_dirs(root: &Path, dirs: &tegg_vault::AppDirs) -> Option<Core> {
    let core = Core::open(root, dirs, CoreOptions { watch: false, sync: None }).ok()?;
    core.wait_idle(Duration::from_secs(60)).then_some(core)
}
fn read(root: &Path, rel: &str) -> String {
    std::fs::read_to_string(root.join(rel)).expect("setup: read")
}
fn ext_write(core: &Core, root: &Path, rel: &str, text: &str) -> bool {
    write_raw(root, rel, text.as_bytes());
    core.notify_changed(&[rel.to_string()]);
    core.wait_idle(Duration::from_secs(10))
}
fn day(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").expect("setup: date")
}
fn view(core: &Core) -> (Option<String>, Vec<String>) {
    let v = core.daily_view(day("2026-10-12"));
    (v.path.map(|p| nfc(&p)), v.duplicates.iter().map(|p| nfc(p)).collect())
}
fn some(p: &str) -> Option<String> {
    Some(p.to_string())
}
fn strs(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}
fn changed(a: &BTreeMap<String, Entry>, b: &BTreeMap<String, Entry>) -> Vec<String> {
    let keys: BTreeSet<&String> = a.keys().chain(b.keys()).collect();
    keys.into_iter().filter(|k| a.get(*k) != b.get(*k)).map(|k| nfc(k)).collect()
}
/// With an `import-id` line put before `created:` (the fixture notes have none).
fn with_import_id(text: &str, value: &str) -> String {
    assert!(text.contains("\ncreated: "), "setup: the fixture note has a created line");
    text.replacen("\ncreated: ", &format!("\nimport-id: {value}\ncreated: "), 1)
}

// ------------------------------------------------------------------------------------------------ tests

#[test]
fn fr_dly_01_ac12_an_imported_note_never_takes_the_day() {
    let sb = sandbox();
    let root = daily_vault(&sb);
    let core = open_dirs(&root, &sb.dirs);
    assert!(core.is_some(), "the vault opens and indexes");
    let core = core.unwrap_or_else(|| unreachable!());
    let before = snapshot(&root);

    // (3) has the newest `created` of the three, and an import-id: it never takes the day.
    let (path, losers) = view(&core);
    assert_eq!(path, some(D12B), "12 Oct still opens (2): a note without import-id comes before every note with one");
    assert_eq!(losers, strs(&[D12, D12C]), "the notice lists Daily/2026-10-12.md, then the imported (3)");
    assert_eq!(core.daily_note(day("2026-10-12")).map(|p| nfc(&p)), some(D12B), "Core::daily_note answers the same note");
    let link = core.resolve_links(ZMINKY, &["2026-10-12".to_string()]);
    assert_eq!(link.first().and_then(|l| l.path.clone()).map(|p| nfc(&p)), some(D12B), "Zmínky's [[2026-10-12]] opens (2)");
    let group: Option<BTreeSet<String>> =
        core.duplicate_titles().into_iter().find(|g| g.key == "2026-10-12").map(|g| g.objects.iter().map(|o| nfc(&o.path)).collect());
    assert_eq!(group, Some(strs(&[D12, D12B, D12C]).into_iter().collect()), "the duplicate-titles group 2026-10-12 has the three notes");

    // Opening and reading write nothing.
    for p in [D12, D12B, D12C] {
        let _ = core.read_note(p, SystemTime::now());
    }
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "opening and reading write nothing");
}

#[test]
fn fr_dly_01_ac12_removing_and_restoring_the_import_id_line_moves_the_day() {
    let sb = sandbox();
    let root = daily_vault(&sb);
    let core = open_dirs(&root, &sb.dirs);
    assert!(core.is_some(), "the vault opens and indexes");
    let core = core.unwrap_or_else(|| unreachable!());

    assert_eq!(view(&core).0, some(D12B), "start: (2) is the day's note");
    assert!(ext_write(&core, &root, D12C, &imported("")), "idle after the external change");
    assert_eq!(view(&core), (some(D12C), strs(&[D12B, D12])), "without the line (3) is the newest note without import-id");
    assert!(ext_write(&core, &root, D12C, &imported(IMPORT_LINE)), "idle after the external change");
    assert_eq!(view(&core), (some(D12B), strs(&[D12, D12C])), "with the line back, (2) opens again");

    // `import-id: "x"` on the other two as well: all three are imported, and D-319's order alone decides.
    let a = read(&root, D12);
    let b = read(&root, D12B);
    assert!(ext_write(&core, &root, D12, &with_import_id(&a, "\"x\"")), "idle after the external change");
    assert!(ext_write(&core, &root, D12B, &with_import_id(&b, "\"x\"")), "idle after the external change");
    assert_eq!(view(&core), (some(D12C), strs(&[D12B, D12])), "all three imported: the newest created wins, (3)");
}

#[test]
fn fr_dly_01_ac12_an_empty_or_null_import_id_counts_as_none() {
    for (value, what) in [("\"\"", "an empty string"), ("", "an empty value"), ("null", "null")] {
        let sb = sandbox();
        let root = daily_vault(&sb);
        // (2) is the only note without an import-id key at all; (3) gets an import-id that doesn't count.
        write_raw(&root, D12C, imported(&format!("import-id: {value}\n")).replace("import-id: \n", "import-id:\n").as_bytes());
        let core = open_dirs(&root, &sb.dirs);
        assert!(core.is_some(), "the vault opens and indexes");
        let core = core.unwrap_or_else(|| unreachable!());
        assert_eq!(view(&core), (some(D12C), strs(&[D12B, D12])), "import-id with {what} counts as no import-id: the newest created wins");
        // A real import-id on the two fixture notes then leaves (3) alone in the first group, whatever its created.
        let a = read(&root, D12);
        let b = read(&root, D12B);
        assert!(ext_write(&core, &root, D12, &with_import_id(&a, "\"capacities:PKM/DailyNotes/a.md\"")), "idle");
        assert!(ext_write(&core, &root, D12B, &with_import_id(&b, "\"capacities:PKM/DailyNotes/b.md\"")), "idle");
        assert_eq!(view(&core), (some(D12C), strs(&[D12B, D12])), "{what}: (3) first, then the imported two by created");
        // And an older note without one beats newer imported ones: flip (3) to imported, drop the line from the oldest.
        assert!(ext_write(&core, &root, D12C, &imported(IMPORT_LINE)), "idle");
        assert!(ext_write(&core, &root, D12, &a), "idle");
        assert_eq!(view(&core), (some(D12), strs(&[D12C, D12B])), "the oldest note is the only one without import-id, so it is the day's note");
    }
}

#[test]
fn fr_dly_01_ac12_same_after_a_rebuild_and_in_both_zones() {
    // The rule reads only files (AR-01): a fresh Application Support (no index) gives the same answer.
    let sb = sandbox();
    let root = daily_vault(&sb);
    for name in ["AS první", "AS druhý"] {
        let core = open_dirs(&root, &fresh_dirs(&sb, name));
        assert!(core.is_some(), "the vault opens and indexes");
        let core = core.unwrap_or_else(|| unreachable!());
        assert_eq!(view(&core), (some(D12B), strs(&[D12, D12C])), "a fresh index ({name}): (2) opens, losers (1) then (3)");
    }
    // The other zone: the main test again, in a child process of this binary with TZ set (TZ is process-wide).
    if std::env::var_os("TEGG_AC12_CHILD").is_none() {
        for tz in ["Europe/Prague", "America/Los_Angeles"] {
            let out = std::process::Command::new(std::env::current_exe().expect("setup: test binary"))
                .args(["--exact", "fr_dly_01_ac12_an_imported_note_never_takes_the_day"])
                .env("TZ", tz)
                .env("TEGG_AC12_CHILD", "1")
                .output()
                .expect("setup: child");
            assert!(out.status.success(), "with TZ={tz} the day's note, the notice and the group are the same");
        }
    }
}
