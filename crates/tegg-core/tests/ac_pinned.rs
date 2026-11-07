//! Slice PIN L4 tests of `.tegg/pinned.yml` (docs/acceptance/pinned.md R131; docs/contracts/v1-pinned.md §1): the
//! parser, resolver and patcher in `tegg_core::pinned` and `Core::pins` / `Core::pins_apply`. FR-HOM-02 AC-4 (duplicate
//! titles by id), AC-5 (the created bytes; the note untouched), AC-8 (unpin bytes, unpin all), AC-16 (stale paths, a
//! reused path never adopted), AC-17 (trashed), AC-21 (types without a definition), AC-22 (unreadable files never
//! rewritten), AC-23 (newer read-only, a missing version), AC-24 (skipped entries kept), AC-26 (query items kept),
//! FR-SYN-03 AC-26 (`Conflict`, `Gone`, an mtime-only change), AC-27 (RENAME_EXCL, conflict copies), FR-SYN-02 AC-9
//! (atomic writes, the SIGKILL harness over 200 alternating moves), FR-FMT-07 AC-28 (unknown-keys bytes, CRLF, no final
//! newline), FR-FMT-12 AC-8 (NFC), NFR-POR-01 AC-4 (the `yaml` npm package reads the same pins) and FR-STO-06 AC-2 (a
//! vault file only; AR-01, AR-03). Written from the ACs, the fixtures and the contract only (D-61); every check is an
//! assertion in this file.

mod common;
mod pinned_setup;

use std::collections::BTreeMap;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use common::{fresh_dirs, repo_root, sandbox, snapshot, Entry, Sandbox};
use pinned_setup::*;
use tegg_core::pinned::{self, PinError, PinState, PinTarget, Pins, PinsFileState};
use tegg_core::{Core, CoreError, VaultError};
use tegg_format::nfc;

macro_rules! ok {
    ($e:expr, $what:expr) => {
        match $e {
            Ok(v) => v,
            Err(e) => {
                assert!(false, "{} answered {:?}", $what, e);
                unreachable!()
            }
        }
    };
}

fn st(s: &PinState) -> &'static str {
    match s {
        PinState::Ok => "ok",
        PinState::Pending => "pending",
        PinState::Trashed => "trashed",
        PinState::Missing => "missing",
        PinState::NoObjects => "noObjects",
    }
}
fn file_st(s: &PinsFileState) -> String {
    match s {
        PinsFileState::Missing => "missing".into(),
        PinsFileState::Ok => "ok".into(),
        PinsFileState::Newer { version } => format!("newer {version}"),
        PinsFileState::Unreadable { line, .. } => format!("unreadable {line:?}"),
    }
}
fn tgt(t: &PinTarget) -> String {
    match t {
        PinTarget::Object { id, path } => format!("object {} {}", id.clone().unwrap_or_default(), path.clone().unwrap_or_default()),
        PinTarget::Tag { key } => format!("tag {key}"),
        PinTarget::Type { key } => format!("type {key}"),
    }
}
/// (stored target, state, live path, title) per row.
fn rows(p: &Pins) -> Vec<(String, String, String, String)> {
    p.rows.iter().map(|r| (tgt(&r.target), st(&r.state).to_string(), r.path.clone().unwrap_or_default(), r.title.clone().unwrap_or_default())).collect()
}
fn states(p: &Pins) -> Vec<String> {
    p.rows.iter().map(|r| st(&r.state).to_string()).collect()
}
fn titles(p: &Pins) -> Vec<String> {
    p.rows.iter().map(|r| r.title.clone().unwrap_or_default()).collect()
}
fn apply_fresh(core: &Core, op: pinned::PinOp) -> Result<Pins, CoreError> {
    let base = core.pins().version;
    core.pins_apply(base, op)
}
fn is_pin_err(r: &Result<Pins, CoreError>, want: fn(&PinError) -> bool) -> bool {
    matches!(r, Err(CoreError::Pin(e)) if want(e))
}
fn changed(a: &BTreeMap<String, Entry>, b: &BTreeMap<String, Entry>) -> Vec<String> {
    let keys: std::collections::BTreeSet<&String> = a.keys().chain(b.keys()).collect();
    keys.into_iter().filter(|k| a.get(*k) != b.get(*k)).map(|k| nfc(k)).collect()
}
fn yml_only() -> Vec<String> {
    vec![YML.to_string()]
}
const VALID_TITLES: [&str; 5] = ["Rozpočet 2027", "Výjezd Lisabon 2026", "2026-10-07 Týdenní porada", "", ""];

// ------------------------------------------------------------------------------------------------ R131 read rules

#[test]
fn fr_hom_02_ac1_valid_lists_five_pins_in_file_order() {
    let f = pinned::read(&fx("valid.yml"));
    assert_eq!(file_st(&f.state), "ok", "valid.yml reads");
    let t: Vec<String> = f.items.iter().map(|i| tgt(&i.target)).collect();
    assert_eq!(t, vec![format!("object {} {ROZPOCET}", id("01")), format!("object {} {LISABON}", id("02")), format!("object {} {PORADA}", id("03")), "tag offsite".into(), "type projekt".into()], "five listed pins; the query item isn't listed (AP-1233)");
    let lines: Vec<(usize, usize)> = f.items.iter().map(|i| (i.lines.start, i.lines.end)).collect();
    assert_eq!(lines, vec![(3, 5), (5, 7), (7, 9), (9, 10), (10, 11)], "0-based line ranges, `- ` line first");
    assert!(f.patchable, "patchable");
}

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-4

#[test]
fn fr_hom_02_ac4_duplicate_titles_resolve_by_id() {
    let sb = sandbox();
    let text = format!("{}  - id: {}\n    path: {PLAN}\n  - id: {}\n    path: {PLAN2}\n", fxs("expected/created.yml").split("  - id:").next().unwrap_or(""), id("10"), id("11"));
    let root = vault_with(&sb, Some(text.as_bytes()));
    let core = open(&root, &sb.dirs);
    let p = core.pins();
    let r: Vec<(String, String)> = p.rows.iter().map(|r| (r.title.clone().unwrap_or_default(), r.path.clone().unwrap_or_default())).collect();
    assert_eq!(r, vec![("Plán".into(), PLAN.into()), ("Plán".into(), PLAN2.into())], "both read Plán, each resolves to its own file");
}

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-5

#[test]
fn fr_hom_02_ac5_pin_from_more_creates_the_file_once() {
    let sb = sandbox();
    let root = vault_with(&sb, None);
    let core = open(&root, &sb.dirs);
    let before = snapshot(&root);
    let p0 = core.pins();
    assert_eq!(file_st(&p0.state), "missing", "no file");
    assert!(p0.version.is_none(), "no version without a file");
    assert_eq!(disk(&root, YML), None, "Core::pins never creates the file");
    let r = ok!(core.pins_apply(None, pin_obj(ROZPOCET, None)), "the first pin");
    assert_eq!(disk(&root, YML), Some(fx("expected/created.yml")), "expected/created.yml");
    let bez = stamp(&root, BEZ);
    ok!(core.pins_apply(r.version.clone(), pin_obj(BEZ, None)), "pin Bez hlavičky");
    assert_eq!(disk(&root, YML), Some(fx("expected/created-idless.yml")), "expected/created-idless.yml (path only, AP-4)");
    assert_eq!(stamp(&root, BEZ), bez, "Bez hlavičky untouched: no id written (AP-1229)");
    assert_eq!(changed(&before, &snapshot(&root)), yml_only(), "only .tegg/pinned.yml written");
}

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-8

#[test]
fn fr_hom_02_ac8_unpin_removes_only_the_entry() {
    let sb = sandbox();
    let root = vault_fx(&sb, "valid.yml");
    let core = open(&root, &sb.dirs);
    let before = snapshot(&root);
    ok!(apply_fresh(&core, unpin(2)), "unpin Porada");
    assert_eq!(disk(&root, YML), Some(fx("expected/valid-after-unpin-porada.yml")), "lines 8–9 removed");
    assert_eq!(changed(&before, &snapshot(&root)), yml_only(), "the note and every other file untouched");
    for _ in 0..4 {
        ok!(apply_fresh(&core, unpin(0)), "unpin the first");
    }
    assert_eq!(disk(&root, YML), Some(fx("expected/valid-after-unpin-all.yml")), "expected/valid-after-unpin-all.yml: the query item kept, the file not deleted");
    let sb2 = sandbox();
    let r2 = vault_fx(&sb2, "expected/created.yml");
    let c2 = open(&r2, &sb2.dirs);
    ok!(apply_fresh(&c2, unpin(0)), "unpin the last item");
    assert!(disk_s(&r2, YML).is_some_and(|t| t.lines().any(|l| l == "pins: []")), "the last unpin leaves `pins: []`");
    assert!(is_pin_err(&apply_fresh(&c2, unpin(0)), |e| matches!(e, PinError::NoSuchPin)), "an index not listed: NoSuchPin");
}

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-16, AC-17

#[test]
fn fr_hom_02_ac16_external_renames_resolve_by_id_never_by_reused_path() {
    let sb = sandbox();
    let root = vault_fx(&sb, "stale.yml");
    let core = open(&root, &sb.dirs);
    let p = core.pins();
    assert_eq!(states(&p), vec!["ok", "ok", "trashed", "missing", "missing", "noObjects", "missing"], "R131 resolution of stale.yml");
    assert_eq!(p.rows[0].path.as_deref(), Some(ROZPOCET), "Rozpočet by id, whatever its stored path");
    assert_eq!(p.rows[1].path.as_deref(), Some(BEZ), "Bez hlavičky by path");
    assert_eq!(p.rows[2].path.as_deref(), Some(KOS), "Starý plán trashed, with its .trash/ path");
    assert_eq!(p.rows[4].path, None, "…ZY: a path held by another id (Plán, 10) is never adopted");
    // An external rename is followed by id with no write.
    let before = stamp(&root, YML);
    std::fs::rename(root.join(ROZPOCET), root.join("Projekty/Rozpočet 2028.md")).expect("setup: rename");
    reread(&core, &[ROZPOCET, "Projekty/Rozpočet 2028.md"]);
    assert_eq!(core.pins().rows[0].path.as_deref(), Some("Projekty/Rozpočet 2028.md"), "the row follows the id");
    std::fs::rename(root.join(BEZ), root.join("Pages/Jen text.md")).expect("setup: rename Bez");
    reread(&core, &[BEZ, "Pages/Jen text.md"]);
    assert_eq!(st(&core.pins().rows[1].state), "missing", "Bez hlavičky renamed away: missing");
    std::fs::rename(root.join("Pages/Jen text.md"), root.join(BEZ)).expect("setup: rename back");
    reread(&core, &[BEZ, "Pages/Jen text.md"]);
    assert_eq!(st(&core.pins().rows[1].state), "ok", "renamed back: ok");
    assert_eq!(stamp(&root, YML), before, "pinned.yml untouched (AP-1230)");
}

#[test]
fn fr_hom_02_ac17_trashed_targets_stay_pinned() {
    let sb = sandbox();
    let root = vault_fx(&sb, "valid.yml");
    let core = open(&root, &sb.dirs);
    let before = stamp(&root, YML);
    std::fs::create_dir_all(root.join(".trash/Schůzky")).expect("setup: .trash/Schůzky");
    std::fs::rename(root.join(PORADA), root.join(format!(".trash/{PORADA}"))).expect("setup: trash Porada");
    reread(&core, &[PORADA, &format!(".trash/{PORADA}")]);
    let p = core.pins();
    assert_eq!(states(&p), vec!["ok", "ok", "trashed", "ok", "ok"], "Porada trashed, still pinned");
    std::fs::rename(root.join(format!(".trash/{PORADA}")), root.join(PORADA)).expect("setup: restore");
    reread(&core, &[PORADA, &format!(".trash/{PORADA}")]);
    assert_eq!(states(&core.pins()), vec!["ok"; 5], "restored");
    std::fs::remove_file(root.join(PORADA)).expect("setup: delete");
    reread(&core, &[PORADA]);
    assert_eq!(states(&core.pins())[2], "missing", "deleted: missing, never removed (AP-1231)");
    assert_eq!(stamp(&root, YML), before, "pinned.yml never written");
}

#[test]
fn fr_hom_02_ac21_tag_and_type_pins_follow_their_keys() {
    let sb = sandbox();
    let root = vault_fx(&sb, "valid.yml");
    let core = open(&root, &sb.dirs);
    std::fs::remove_file(root.join(".tegg/types/projekt.yml")).expect("setup: delete projekt.yml");
    reread(&core, &[".tegg/types/projekt.yml"]);
    assert_eq!(states(&core.pins())[4], "ok", "no definition, objects remain: ok (D-121)");
    for p in [ROZPOCET, LISABON] {
        std::fs::remove_file(root.join(p)).expect("setup: delete projekt object");
    }
    reread(&core, &[ROZPOCET, LISABON]);
    assert_eq!(states(&core.pins())[4], "missing", "no definition and no objects: missing");
    // AP-1273 (D-1416): `Delete tag…` is the TagDelete job (ms4-tags §2): it removes `#offsite` from Odkazy and moves
    // Tags/Offsite.md to `.trash/`. Deleting only the Tag file would leave the occurrence, so the tag would still exist (R79).
    let report = tag_delete(&core, "offsite");
    assert_eq!(report.phase, tegg_jobs::Phase::Done, "the TagDelete job ends done: {report:?}");
    let _ = core.wait_idle(Duration::from_secs(30));
    assert!(!root.join(STITEK).exists(), "the job moved Tags/Offsite.md to the trash");
    assert_eq!(states(&core.pins())[3], "noObjects", "offsite without a file or an occurrence: no objects");
}

/// Runs `JobOp::TagDelete { tag, keep_text: false }` (ms4-tags §2) with the real `@tegg/doc` transformer
/// (`npm run build --prefix packages/doc`), confirming it when it asks, and returns its report (60 s).
fn tag_delete(core: &Core, tag: &str) -> tegg_jobs::JobReport {
    let t = match tegg_jobs::testing::NodeTransformer::from_repo(&repo_root()) {
        Ok(t) => t,
        Err(e) => panic!("setup: NodeTransformer (npm run build --prefix packages/doc): {e}"),
    };
    core.jobs().set_transformer(std::sync::Arc::new(t));
    let job = ok!(core.jobs().start(tegg_jobs::JobOp::TagDelete { tag: tag.into(), keep_text: false }), "Jobs::start(TagDelete)");
    let end = Instant::now() + Duration::from_secs(30);
    while core.jobs().confirm(job).is_err() && core.jobs().report(job).is_none() {
        assert!(Instant::now() < end, "the TagDelete job never asked for confirmation");
        std::thread::sleep(Duration::from_millis(10));
    }
    match core.jobs().wait(job, Duration::from_secs(60)) {
        Some(r) => r,
        None => panic!("no TagDelete report within 60 s"),
    }
}

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-20 (core)

#[test]
fn fr_hom_02_ac20_pins_are_pending_never_missing_before_the_first_build() {
    let sb = sandbox();
    let root = vault_fx(&sb, "stale.yml");
    let core = match Core::open(&root, &sb.dirs, tegg_core::CoreOptions { watch: false, sync: None }) {
        Ok(c) => c,
        Err(e) => panic!("setup: open: {e:?}"),
    };
    let p = core.pins();
    if !p.index_ready {
        assert!(!states(&p).iter().any(|s| s == "missing" || s == "noObjects"), "before the first build ends nothing is missing: {:?}", states(&p));
        assert_eq!(states(&p)[6], "pending", "a type pin without a definition is pending");
    }
    let _ = core.wait_idle(Duration::from_secs(60));
    let p = core.pins();
    assert!(p.index_ready, "index_ready after the first build");
    assert_eq!(states(&p)[3], "missing", "then missing");
}

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-22, AC-23

fn unreadable_variants() -> Vec<(&'static str, Vec<u8>, Option<u32>)> {
    let valid = fxs("valid.yml");
    let mut bad = valid.clone().into_bytes();
    let at = valid.find("Rozpočet").expect("setup: Rozpočet");
    bad.insert(at, 0xff);
    vec![
        ("invalid-yaml", fx("invalid-yaml.yml"), Some(5)),
        ("version 0", valid.replace("version: 1", "version: 0").into_bytes(), None),
        ("version \"1\"", valid.replace("version: 1", "version: \"1\"").into_bytes(), None),
        ("version 1.5", valid.replace("version: 1", "version: 1.5").into_bytes(), None),
        ("invalid UTF-8", bad, None),
        ("top-level list", b"- tag: offsite\n".to_vec(), None),
        ("pins not a list", b"version: 1\npins: offsite\n".to_vec(), None),
    ]
}

#[test]
fn fr_hom_02_ac22_unreadable_pins_file_is_never_rewritten() {
    for (name, bytes, line) in unreadable_variants() {
        let sb = sandbox();
        let root = vault_with(&sb, Some(&bytes));
        let core = open(&root, &sb.dirs);
        let p = core.pins();
        assert!(matches!(p.state, PinsFileState::Unreadable { line: l, .. } if l == line), "{name}: unreadable with line {line:?}, got {}", file_st(&p.state));
        assert!(p.rows.is_empty(), "{name}: no rows");
        let before = stamp(&root, YML);
        for op in [pin_obj(CAJOVNA, None), unpin(0), mv(0, 1)] {
            assert!(is_pin_err(&core.pins_apply(p.version.clone(), op), |e| matches!(e, PinError::Unreadable)), "{name}: refused with Unreadable");
        }
        assert_eq!(stamp(&root, YML), before, "{name}: bytes, mtime and inode unchanged");
    }
}

#[test]
fn fr_hom_02_ac23_newer_and_missing_versions() {
    let sb = sandbox();
    let root = vault_fx(&sb, "newer-version.yml");
    let core = open(&root, &sb.dirs);
    let p = core.pins();
    assert_eq!(file_st(&p.state), "newer 2", "newer");
    assert_eq!(titles(&p)[..3], VALID_TITLES[..3], "the rows are listed");
    let before = stamp(&root, YML);
    assert!(is_pin_err(&core.pins_apply(p.version.clone(), unpin(0)), |e| matches!(e, PinError::NewerVersion)), "refused with NewerVersion");
    assert_eq!(stamp(&root, YML), before, "the file keeps its bytes");
    let sb2 = sandbox();
    let no_v = fxs("valid.yml").replace("version: 1\n", "");
    let r2 = vault_with(&sb2, Some(no_v.as_bytes()));
    let c2 = open(&r2, &sb2.dirs);
    assert_eq!(file_st(&c2.pins().state), "ok", "a missing version reads as 1");
    assert_eq!(disk_s(&r2, YML), Some(no_v), "nothing written on open");
    ok!(apply_fresh(&c2, pin_obj(CAJOVNA, None)), "the first pin");
    let want = format!("{}  - id: {}\n    path: {CAJOVNA}\n", fxs("valid.yml"), id("04"));
    assert_eq!(disk_s(&r2, YML), Some(want), "`version: 1` as line 2 and the new item, nothing else");
}

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-24, AC-26

#[test]
fn fr_hom_02_ac24_skipped_entries_are_kept() {
    for (name, op) in [("pin", pin_obj(CAJOVNA, Some(1))), ("unpin", unpin(1)), ("move", mv(2, 0))] {
        let sb = sandbox();
        let root = vault_fx(&sb, "entries.yml");
        let core = open(&root, &sb.dirs);
        let p = core.pins();
        let t: Vec<String> = p.rows.iter().map(|r| tgt(&r.target)).collect();
        assert_eq!(t, vec![format!("object {} {ROZPOCET}", id("01")), "tag offsite".into(), "type schůzka".into()], "three listed");
        ok!(core.pins_apply(p.version.clone(), op), name);
        assert_eq!(disk(&root, YML), Some(fx(&format!("expected/entries-after-{name}.yml"))), "{name}: expected/entries-after-{name}.yml");
    }
}

#[test]
fn fr_hom_02_ac26_query_entries_are_kept_not_shown() {
    let sb = sandbox();
    let root = vault_fx(&sb, "valid.yml");
    let core = open(&root, &sb.dirs);
    assert_eq!(core.pins().rows.len(), 5, "the query item isn't a row");
    ok!(apply_fresh(&core, mv(1, 3)), "move");
    ok!(apply_fresh(&core, pin_tag("účty", None)), "pin at the end");
    ok!(apply_fresh(&core, unpin(0)), "unpin");
    let t = disk_s(&root, YML).unwrap_or_default();
    assert_eq!(t.matches("  - query: Otevřené úkoly tento týden\n").count(), 1, "the query item kept byte for byte");
    let lines: Vec<&str> = t.lines().collect();
    let q = lines.iter().position(|l| l.contains("query:")).unwrap_or(0);
    assert_eq!(lines.get(q - 1).copied(), Some("  - type: projekt"), "still after its neighbour");
    assert_eq!(lines.get(q + 1).copied(), Some("  - tag: účty"), "a pin at the end goes after the list's last line");
}

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-26, AC-27

#[test]
fn fr_syn_03_ac26_pins_writes_check_the_base() {
    for (name, op) in [("pin", pin_obj(CAJOVNA, None)), ("unpin", unpin(0)), ("move", mv(0, 2))] {
        let sb = sandbox();
        let root = vault_fx(&sb, "valid.yml");
        let core = open(&root, &sb.dirs);
        let base = core.pins().version;
        let other = format!("{}  - tag: účty\n", fxs("valid.yml"));
        std::fs::write(root.join(YML), &other).expect("setup: change on disk");
        let r = core.pins_apply(base, op);
        assert!(matches!(r, Err(CoreError::Vault(VaultError::Conflict { .. }))), "{name}: Conflict");
        assert_eq!(disk_s(&root, YML), Some(other), "{name}: nothing written");
    }
    // An mtime-only change isn't a conflict (D-175).
    let sb = sandbox();
    let root = vault_fx(&sb, "valid.yml");
    let core = open(&root, &sb.dirs);
    let base = core.pins().version;
    std::thread::sleep(Duration::from_millis(20));
    std::fs::write(root.join(YML), fx("valid.yml")).expect("setup: same bytes, new mtime");
    ok!(core.pins_apply(base.clone(), unpin(2)), "an mtime-only change");
    assert_eq!(disk(&root, YML), Some(fx("expected/valid-after-unpin-porada.yml")), "written");
    // Gone: nothing is created.
    let base = core.pins().version;
    std::fs::remove_file(root.join(YML)).expect("setup: delete");
    assert!(matches!(core.pins_apply(base, unpin(0)), Err(CoreError::Vault(VaultError::Gone))), "Gone");
    assert_eq!(disk(&root, YML), None, "nothing is created");
}

#[test]
fn fr_syn_03_ac27_external_and_synced_pins_changes() {
    let sb = sandbox();
    let root = vault_with(&sb, None);
    let copy = format!("{}  - tag: účty\n", fxs("valid.yml"));
    std::fs::write(root.join(COPY_A), &copy).expect("setup: copy A");
    std::fs::write(root.join(COPY_B), &copy).expect("setup: copy B");
    let core = open(&root, &sb.dirs);
    let copies = (stamp(&root, COPY_A), stamp(&root, COPY_B));
    assert_eq!(file_st(&core.pins().state), "missing", "conflict copies are never read");
    // A file created by another program while none was read: the first pin is a Conflict, nothing replaced.
    std::fs::write(root.join(YML), fx("valid.yml")).expect("setup: another program creates it");
    assert!(matches!(core.pins_apply(None, pin_obj(CAJOVNA, None)), Err(CoreError::Vault(VaultError::Conflict { .. }))), "RENAME_EXCL: Conflict");
    assert_eq!(disk(&root, YML), Some(fx("valid.yml")), "no file replaced");
    replace_atomically(&root, YML, copy.as_bytes());
    reread(&core, &[YML]);
    assert_eq!(core.pins().rows.len(), 6, "an atomic replace is read at once (no cache)");
    ok!(apply_fresh(&core, mv(0, 1)), "a move");
    assert_eq!((stamp(&root, COPY_A), stamp(&root, COPY_B)), copies, "conflict copies: bytes, mtime and inode unchanged");
}

// ------------------------------------------------------------------------------------------------ FR-SYN-02 AC-9

#[test]
fn fr_syn_02_ac9_pinned_yml_atomic_writes() {
    let sb = sandbox();
    let root = vault_fx(&sb, "valid.yml");
    let core = open(&root, &sb.dirs);
    let mut inodes = vec![ino(&root, YML)];
    for i in 0..6 {
        let op = if i % 2 == 0 { mv(1, 3) } else { mv(3, 1) };
        ok!(apply_fresh(&core, op), "move");
        inodes.push(ino(&root, YML));
    }
    let distinct: std::collections::BTreeSet<_> = inodes.iter().collect();
    assert_eq!(distinct.len(), inodes.len(), "a new inode each write: {inodes:?}");
    let leftovers: Vec<String> = std::fs::read_dir(root.join(".tegg")).expect("setup: .tegg").map(|e| e.expect("entry").file_name().to_string_lossy().into_owned()).filter(|n| n.ends_with(".tegg-tmp")).collect();
    assert_eq!(leftovers, Vec::<String>::new(), "no temp file stays");
}

const KILL_TEST: &str = "fr_syn_02_ac9_pinned_yml_atomic_writes_survive_sigkill";
const KILL_CYCLES: usize = 200;

fn kill_child(root: &Path, app: &Path, ready: &Path) -> ! {
    let dirs = tegg_core::AppDirs { root: app.to_path_buf() };
    let Ok(core) = Core::open(root, &dirs, tegg_core::CoreOptions { watch: false, sync: None }) else { std::process::exit(3) };
    let _ = core.wait_idle(Duration::from_secs(30));
    let mut base = core.pins().version;
    std::fs::write(ready, b"ready").ok();
    let start = Instant::now();
    let mut i = 0usize;
    while start.elapsed() < Duration::from_secs(20) {
        i += 1;
        let op = if i % 2 == 1 { mv(1, 3) } else { mv(3, 1) };
        match core.pins_apply(base.clone(), op) {
            Ok(r) => base = r.version,
            Err(e) => {
                std::fs::write(ready.with_extension("failed"), format!("{e:?}")).ok();
                std::process::exit(3)
            }
        }
    }
    std::process::exit(0)
}

#[test]
fn fr_syn_02_ac9_pinned_yml_atomic_writes_survive_sigkill() {
    if let Ok(dir) = std::env::var("TEGG_PINS_KILL_CHILD") {
        let dir = std::path::PathBuf::from(dir);
        let ready = std::path::PathBuf::from(std::env::var("TEGG_PINS_KILL_READY").expect("setup: ready path"));
        kill_child(&dir.join("vault"), &dir.join("app"), &ready);
    }
    let sb = sandbox();
    let work = sb.base.join("kill");
    let root = work.join("vault");
    std::fs::create_dir_all(&root).expect("setup: vault");
    copy_dir(&repo_root().join("tests/fixtures/vaults/pinned"), &root, &["README.md"]);
    copy_dir(&repo_root().join("tests/fixtures/vaults/new-empty/.tegg"), &root.join(".tegg"), &[]);
    std::fs::write(root.join(YML), fx("valid.yml")).expect("setup: pinned.yml");
    std::fs::create_dir_all(work.join("app")).expect("setup: app dir");
    let old = fx("valid.yml");
    let new = fx("expected/valid-after-move.yml");
    let exe = std::env::current_exe().expect("setup: test binary");
    let mut seed: u64 = 0x5049_4e20_2611_07;
    let mut bad: Vec<String> = Vec::new();
    for cycle in 0..KILL_CYCLES {
        // AP-1274 (D-1417): every child starts with the same move, so each cycle starts from `valid.yml` (a kill after an
        // odd number of writes would otherwise leave the moved order, and the next cycle's move a third order).
        std::fs::write(root.join(YML), &old).expect("setup: restore valid.yml");
        let ready = work.join(format!("ready-{cycle}"));
        let mut child = Command::new(&exe)
            .args(["--exact", KILL_TEST, "--nocapture", "--test-threads=1"])
            .env("TEGG_PINS_KILL_CHILD", &work)
            .env("TEGG_PINS_KILL_READY", &ready)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("setup: spawn the writer");
        let deadline = Instant::now() + Duration::from_secs(20);
        while !ready.exists() && Instant::now() < deadline && child.try_wait().ok().flatten().is_none() {
            std::thread::sleep(Duration::from_micros(300));
        }
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        std::thread::sleep(Duration::from_micros(200 + seed % 3000));
        let _ = child.kill();
        let _ = child.wait();
        if ready.with_extension("failed").exists() {
            bad.push(format!("cycle {cycle}: the writer failed: {}", std::fs::read_to_string(ready.with_extension("failed")).unwrap_or_default()));
        }
        let now = std::fs::read(root.join(YML)).unwrap_or_default();
        if now != old && now != new {
            bad.push(format!("cycle {cycle}: torn file ({} bytes)", now.len()));
        }
        let rows = pinned::read(&now).items.len();
        if rows != 5 {
            bad.push(format!("cycle {cycle}: {rows} listed pins"));
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "after every kill pinned.yml is the complete old or new bytes, and a temp file is never read as pins");
}

// ------------------------------------------------------------------------------------------------ FR-FMT-07 AC-28

#[test]
fn fr_fmt_07_ac28_pinned_yml_minimal_patches() {
    for variant in ["", "-crlf", "-no-newline"] {
        for (name, op) in [("pin", pin_obj(CAJOVNA, Some(1))), ("unpin", unpin(1)), ("move", mv(2, 0))] {
            let sb = sandbox();
            let root = vault_fx(&sb, &format!("unknown-keys{variant}.yml"));
            let core = open(&root, &sb.dirs);
            ok!(apply_fresh(&core, op), format!("{name}{variant}"));
            assert_eq!(disk(&root, YML), Some(fx(&format!("expected/unknown-keys{variant}-after-{name}.yml"))), "{name}{variant}: expected bytes");
        }
    }
    // Reading writes nothing; a move to its own place writes nothing.
    let sb = sandbox();
    let root = vault_fx(&sb, "unknown-keys.yml");
    let core = open(&root, &sb.dirs);
    let before = stamp(&root, YML);
    let _ = core.pins();
    ok!(apply_fresh(&core, mv(1, 1)), "a move to its own place");
    assert_eq!(stamp(&root, YML), before, "no write");
    // The pure functions agree with the core.
    let text = fxs("valid.yml");
    let file = pinned::read(text.as_bytes());
    let out = ok!(pinned::apply_text(Some(&text), &file, &pinned::PinEdit::Move { from: 1, to: 3 }), "apply_text");
    assert_eq!(out, Some(fxs("expected/valid-after-move.yml")), "apply_text: expected/valid-after-move.yml");
    let same = ok!(pinned::apply_text(Some(&text), &file, &pinned::PinEdit::Move { from: 2, to: 2 }), "apply_text no-op");
    assert_eq!(same, None, "equal bytes: None");
}

// ------------------------------------------------------------------------------------------------ FR-FMT-12 AC-8

#[test]
fn fr_fmt_12_ac8_pins_are_nfc() {
    let sb = sandbox();
    let root = vault_fx(&sb, "nfd.yml");
    let core = open(&root, &sb.dirs);
    let p = core.pins();
    assert_eq!(states(&p), vec!["ok"; 5], "all five NFD rows resolve");
    assert_eq!(tgt(&p.rows[1].target), format!("object {} {LISABON}", id("02")), "stored targets are NFC");
    let r = ok!(apply_fresh(&core, pin_obj(&nfd(LISABON), None)), "pin Lisabon again (NFD)");
    assert_eq!(r.rows.len(), 5, "the NFD path matches as NFC: no second item");
    ok!(apply_fresh(&core, pin_obj(&nfd(CAJOVNA), None)), "pin Čajovna (NFD file name)");
    assert!(disk_s(&root, YML).is_some_and(|t| t.ends_with(&format!("    path: {CAJOVNA}\n"))), "written NFC");
    let nfd_bytes = fxs("nfd.yml");
    for l in nfd_bytes.lines().filter(|l| l.contains("path:")) {
        assert!(disk_s(&root, YML).is_some_and(|t| t.contains(l)), "the other items keep their NFD bytes: {l:?}");
    }
}

// ------------------------------------------------------------------------------------------------ NFR-POR-01 AC-4

fn yaml_npm(bytes: &[u8], sb: &Sandbox) -> Option<Vec<String>> {
    let f = sb.base.join(format!("y-{}.yml", bytes.len()));
    std::fs::write(&f, bytes).ok()?;
    let script = "import YAML from 'yaml'; import { readFileSync } from 'node:fs'; \
        const d = YAML.parse(readFileSync(process.argv[1], 'utf8')); \
        console.log(JSON.stringify((d.pins ?? []).filter((p) => p && typeof p === 'object' && !('query' in p)).map((p) => 'tag' in p ? 'tag ' + p.tag : 'type' in p ? 'type ' + p.type : 'object ' + (p.id ?? '') + ' ' + String(p.path ?? '').normalize('NFC'))));";
    let out = Command::new("node").current_dir(repo_root().join("app")).args(["--input-type=module", "-e", script]).arg(&f).output().ok()?;
    serde_json::from_slice::<Vec<String>>(&out.stdout).ok()
}

#[test]
fn nfr_por_01_ac4_pinned_yml_is_standard_yaml() {
    let sb = sandbox();
    let root = vault_with(&sb, None);
    let core = open(&root, &sb.dirs);
    let before = snapshot(&root);
    let mut r = ok!(core.pins_apply(None, pin_obj(ROZPOCET, None)), "pin");
    for op in [pin_tag("#Účty", None), pin_type("schůzka", Some(0)), pin_obj(BEZ, Some(1)), pin_obj(&nfd(CAJOVNA), None), pin_tag("123", None), pin_tag("true", None)] {
        r = ok!(core.pins_apply(r.version.clone(), op), "pin");
    }
    r = ok!(core.pins_apply(r.version.clone(), mv(4, 0)), "move");
    ok!(core.pins_apply(r.version.clone(), unpin(2)), "unpin");
    let ours: Vec<String> = core.pins().rows.iter().map(|x| tgt(&x.target).trim_end().to_string()).collect();
    let theirs: Option<Vec<String>> = yaml_npm(&disk(&root, YML).unwrap_or_default(), &sb).map(|v| v.into_iter().map(|s| s.trim_end().to_string()).collect());
    assert_eq!(theirs, Some(ours), "the `yaml` npm package reads the same pins Tegg lists");
    assert_eq!(changed(&before, &snapshot(&root)), yml_only(), "no pin action writes outside .tegg/pinned.yml (no note, no .obsidian/)");
}

// ------------------------------------------------------------------------------------------------ FR-STO-06 AC-2

fn files_under(dir: &Path) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() { out.extend(files_under(&p)); } else { out.push(p); }
        }
    }
    out
}

#[test]
fn fr_sto_06_ac2_pins_are_a_vault_file_only() {
    let sb = sandbox();
    let root = vault_fx(&sb, "valid.yml");
    let core = open(&root, &sb.dirs);
    let want = rows(&core.pins());
    assert_eq!(want.len(), 5, "five rows");
    drop(core);
    let copy = sb.base.join("Kopie");
    copy_dir(&root, &copy, &[]);
    let other = fresh_dirs(&sb, "Jiný Mac");
    let c2 = open(&copy, &other);
    let got: Vec<(String, String, String, String)> = rows(&c2.pins()).into_iter().map(|(t, s, _, title)| (t, s, String::new(), title)).collect();
    assert_eq!(got, want.iter().map(|(t, s, _, title)| (t.clone(), s.clone(), String::new(), title.clone())).collect::<Vec<_>>(), "a copy elsewhere lists the same rows");
    drop(c2);
    for p in files_under(&sb.dirs.root) {
        let _ = std::fs::remove_file(p);
    }
    let c3 = open(&root, &sb.dirs);
    assert_eq!(rows(&c3.pins()), want, "after deleting the index the same rows");
    let hits: Vec<String> = files_under(&sb.dirs.root).iter().chain(files_under(&other.root).iter()).filter(|p| std::fs::read(p).is_ok_and(|b| b.windows("Otevřené úkoly".len()).any(|w| w == "Otevřené úkoly".as_bytes()))).map(|p| p.display().to_string()).collect();
    assert_eq!(hits, Vec::<String>::new(), "no pin in the index or any machine-local file (AR-01)");
    let src = std::fs::read_to_string(repo_root().join("crates/tegg-core/src/pinned.rs")).unwrap_or_default();
    assert!(!src.is_empty(), "crates/tegg-core/src/pinned.rs exists");
    for bad in [concat!("tau", "ri::"), concat!("use ", "tau", "ri"), "objc::", "cocoa::", "core_foundation::", "std::process::", "notify::"] {
        assert!(!src.contains(bad), "pinned.rs doesn't use {bad} (AR-03)");
    }
}
