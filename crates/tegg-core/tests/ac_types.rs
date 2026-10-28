//! MS3 slice 3D AC tests at the core (L4): AR-07 AC-2…AC-4, AC-7; FR-TYP-01 AC-2, AC-4, AC-6 (watcher), AC-7;
//! FR-TYP-03 AC-5 (counts), AC-11 (D-808: a retype writes only the type line), AC-14 (4E-2, type-moves.md), AC-12 (folder, name, one write, index); FR-TYP-04 AC-5; FR-TYP-05 AC-1,
//! AC-2, AC-5; FR-TYP-06 AC-1, AC-4; FR-TYP-09 AC-2 (query), AC-9 (watcher); FR-TYP-12 AC-3; FR-TYP-13 AC-1…AC-3;
//! FR-VLT-02 AC-6, AC-7, AC-9. docs/acceptance/types.md; interface docs/contracts/ms3-shell.md §14.1, §14.2.
//! Written from the ACs and the contract only (D-61). Fixture: tests/fixtures/vaults/types + new-empty/.tegg in a
//! temporary directory (APFS); bytes, mtime and inode are compared with `common::snapshot`.

mod common;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use common::*;
use tegg_core::{Core, CoreError, CoreEvent, CoreOptions, FileVersion, StarterSkip, TypeInfo, VaultError};
use tegg_schema::{AttrChange, AttrType, OptionDef, Readability, SchemaError, TypeOp};
use tegg_vault::{LocalFs, Vault, VaultFs, VaultKind};

macro_rules! ok {
    ($e:expr, $what:expr) => {
        match $e {
            Ok(v) => v,
            Err(e) => {
                assert!(false, "{} failed: {:?}", $what, e);
                unreachable!()
            }
        }
    };
}

const PORADA: &str = "Schůzky/2026-10-07 Porada.md";
const PRAZDNA: &str = "Schůzky/Prázdná schůzka.md";
const VE_STRANKACH: &str = "Pages/Schůzka ve stránkách.md";
const ROZPOCET: &str = "Projekty/Rozpočet 2027.md";
const VELKA: &str = "Projekty/Velká písmena.md";
const DVA_TYPY: &str = "Pages/Dva typy.md";
const JANA: &str = "Osoby/Jana Nováková.md";
const PETR: &str = "Osoby/Petr Dvořák.md";

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).expect("create dir");
    for e in std::fs::read_dir(from).expect("read_dir") {
        let e = e.expect("entry");
        if e.file_type().expect("type").is_dir() {
            copy_dir(&e.path(), &to.join(e.file_name()));
        } else {
            std::fs::copy(e.path(), to.join(e.file_name())).expect("copy");
        }
    }
}

/// `tests/fixtures/vaults/types/` plus `new-empty/.tegg/` in `<sandbox>/Trezor` (types.md "Fixtures").
fn types_vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Trezor");
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fx.join("types"), &root);
    copy_dir(&fx.join("new-empty/.tegg"), &root.join(".tegg"));
    root
}

fn open(root: &Path, sb: &Sandbox, watch: bool) -> Core {
    let core = ok!(Core::open(root, &sb.dirs, CoreOptions { watch, sync: None }), "Core::open");
    assert!(core.wait_idle(Duration::from_secs(60)), "indexing did not become idle within 60 s");
    core
}

fn open_counting(root: &Path, sb: &Sandbox) -> (Core, Arc<CountingFs<LocalFs>>) {
    let fs = CountingFs::new(LocalFs::new(root));
    let core = ok!(Core::open_with(fs.clone() as Arc<dyn VaultFs>, &sb.dirs, CoreOptions { watch: false, sync: None }), "Core::open_with");
    assert!(core.wait_idle(Duration::from_secs(60)), "indexing did not become idle within 60 s");
    (core, fs)
}

fn read(root: &Path, rel: &str) -> String {
    std::fs::read_to_string(root.join(rel)).unwrap_or_default()
}
fn fixture(rel: &str) -> String {
    std::fs::read_to_string(repo_root().join("tests/fixtures").join(rel)).expect("setup: fixture")
}

/// Paths whose entry differs between two snapshots (added, removed, or bytes/mtime/inode changed).
fn changed(a: &BTreeMap<String, Entry>, b: &BTreeMap<String, Entry>) -> Vec<String> {
    let keys: BTreeSet<&String> = a.keys().chain(b.keys()).collect();
    keys.into_iter().filter(|k| a.get(*k) != b.get(*k)).map(|k| tegg_format::nfc(k)).collect()
}

/// The type as the core reads it now; a missing type is an assertion failure.
fn get(core: &Core, key: &str) -> TypeInfo {
    match core.type_get(key) {
        Some(t) => t,
        None => {
            assert!(false, "type_get({key:?}) returned None");
            unreachable!()
        }
    }
}
fn base(core: &Core, key: &str) -> FileVersion {
    match get(core, key).version {
        Some(v) => v,
        None => {
            assert!(false, "type_get({key:?}).version is None");
            unreachable!()
        }
    }
}

fn swap(text: &str, from: &str, to: &str) -> String {
    assert!(text.contains(from), "fixture no longer contains {from:?}");
    text.replacen(from, to, 1)
}

fn notes_of(root: &Path) -> Vec<String> {
    indexable_notes(root).into_iter().map(|p| tegg_format::nfc(&p)).collect()
}

fn row_paths(core: &Core, key: &str) -> BTreeSet<String> {
    core.type_rows(key).into_iter().map(|r| tegg_format::nfc(&r.path)).collect()
}

fn set(items: &[&str]) -> BTreeSet<String> {
    items.iter().map(|s| s.to_string()).collect()
}

fn changed_paths(rx: &std::sync::mpsc::Receiver<CoreEvent>) -> Vec<String> {
    let mut out = Vec::new();
    while let Ok(ev) = rx.try_recv() {
        if let CoreEvent::VaultChanged { paths } = ev {
            out.extend(paths.into_iter().map(|p| tegg_format::nfc(&p)));
        }
    }
    out
}

// ------------------------------------------------------------------------------------------------ AR-07

#[test]
fn ar_07_ac2_missing_version_reads_as_1_writes_nothing_and_first_change_adds_it() {
    let sb = sandbox();
    let root = types_vault(&sb);
    let orig = read(&root, ".tegg/types/osoba.yml");
    write_raw(&root, ".tegg/types/osoba.yml", swap(&orig, "version: 1\n", "").as_bytes());
    let before = snapshot(&root);
    let core = open(&root, &sb, false);
    let t = get(&core, "osoba");
    assert_eq!((t.readability.clone(), t.def.declared_version, t.invalid), (Readability::Ok, None, false), "read as version 1, no warning");
    let _ = core.type_rows("osoba");
    let _ = core.types();
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "opening, the type page and settings write nothing");
    let b = base(&core, "osoba");
    let _ = ok!(core.type_patch("osoba", Some(&b), &[TypeOp::SetColor("teal".into())]), "type_patch");
    assert_eq!(read(&root, ".tegg/types/osoba.yml"), swap(&orig, "color: purple\n", "color: teal\n"), "version: 1 inserted first, only color changed");
    assert_eq!(changed(&before, &snapshot(&root)), vec![".tegg/types/osoba.yml".to_string()]);
}

#[test]
fn ar_07_ac3_newer_version_is_used_and_the_core_refuses_writing_it() {
    let sb = sandbox();
    let root = types_vault(&sb);
    let before = snapshot(&root);
    let core = open(&root, &sb, false);
    let t = get(&core, "budoucí");
    assert_eq!(t.readability, Readability::Newer(2));
    assert_eq!((t.name.as_str(), t.plural.as_str(), t.folder.as_str(), t.color.as_str(), t.invalid), ("Budoucí", "Budoucí", "Budoucí", "blue", false));
    let b = base(&core, "budoucí");
    let r = core.type_patch("budoucí", Some(&b), &[TypeOp::SetColor("red".into())]);
    assert!(matches!(r, Err(CoreError::Schema(SchemaError::NewerVersion))), "refused with NewerVersion, got {r:?}");
    let d = core.type_delete("budoucí", &b);
    assert!(d.is_err(), "delete of a newer type refused, got {d:?}");
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "budoucí.yml unchanged");
}

#[test]
fn ar_07_ac4_invalid_type_is_listed_by_key_and_never_rewritten() {
    let sb = sandbox();
    let root = types_vault(&sb);
    let before = snapshot(&root);
    let core = open(&root, &sb, false);
    let t = get(&core, "rozbitý");
    assert!(matches!(t.readability, Readability::Invalid { line: 4, .. }), "error at line 4, got {:?}", t.readability);
    assert!(t.invalid);
    assert_eq!((t.name.as_str(), t.plural.as_str()), ("rozbitý", "rozbitý"));
    let b = base(&core, "rozbitý");
    let r = core.type_patch("rozbitý", Some(&b), &[TypeOp::SetColor("blue".into())]);
    assert!(matches!(r, Err(CoreError::Schema(SchemaError::Invalid))), "refused, got {r:?}");
    let _ = core.type_rows("rozbitý");
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new());
}

#[test]
fn ar_07_ac7_nothing_only_in_the_index() {
    let sb = sandbox();
    let root = types_vault(&sb);
    let state = |core: &Core| {
        let types = core.types().into_iter().map(|t| format!("{t:?}")).collect::<Vec<_>>();
        let counts = core.type_counts();
        let mut rows = BTreeMap::new();
        let mut defs = BTreeMap::new();
        for k in counts.keys().cloned().chain(core.types().into_iter().map(|t| t.key)) {
            let mut r: Vec<String> = core.type_rows(&k).into_iter().map(|r| format!("{} {:?} {:?} {:?} {}", r.path, r.title, r.modified, r.values, r.type_single)).collect();
            r.sort();
            rows.insert(k.clone(), r);
            defs.insert(k.clone(), core.type_get(&k).map(|t| format!("{:?}", t.def)));
        }
        (types, counts, rows, defs)
    };
    let core = open(&root, &sb, false);
    let first = state(&core);
    assert!(first.2.get("schůzka").map_or(0, |r| r.len()) == 3, "setup through the index: three Schůzka rows, got {:?}", first.2.get("schůzka"));
    drop(core);
    std::fs::remove_dir_all(&sb.dirs.root).expect("delete Application Support");
    std::fs::create_dir_all(&sb.dirs.root).expect("recreate");
    let core = open(&root, &sb, false);
    assert_eq!(state(&core), first, "types, counts, rows and schemas identical after rebuilding the index");
}

// ------------------------------------------------------------------------------------------------ FR-TYP-01

#[test]
fn fr_typ_01_ac2_create_writes_exactly_the_type_file() {
    let sb = sandbox();
    let root = types_vault(&sb);
    let before = snapshot(&root);
    let core = open(&root, &sb, false);
    let t = ok!(core.type_create("Čajovna", "Čajovny"), "type_create");
    assert_eq!((t.key.as_str(), t.name.as_str(), t.plural.as_str(), t.exists), ("čajovna", "Čajovna", "Čajovny", true));
    assert_eq!(read(&root, ".tegg/types/čajovna.yml"), fixture("types/expected/čajovna.yml"), "byte-identical to the expected file");
    assert_eq!(changed(&before, &snapshot(&root)), vec![".tegg/types/čajovna.yml".to_string()], "one file, no folder, no template");
    assert!(core.types().iter().any(|x| x.key == "čajovna"), "listed");
    assert_eq!(core.type_counts().get("čajovna").copied().unwrap_or(0), 0);
    // NFD input gives the NFC file.
    let n = ok!(core.type_create("C\u{30C}ajov\u{e1} ceremonie", "Čajové ceremonie"), "type_create NFD");
    assert_eq!(n.key, "čajová-ceremonie");
    assert!(root.join(".tegg/types/čajová-ceremonie.yml").exists());
}

#[test]
fn fr_typ_01_ac2_a_file_that_appears_before_the_write_is_never_overwritten() {
    let sb = sandbox();
    let root = types_vault(&sb);
    let core = open(&root, &sb, false);
    assert!(core.type_get("osoba").is_some(), "red guard: type_get is built");
    let theirs = "# z jiného Macu\nversion: 1\nname: Čajovna\nplural: Čajovny\nattributes: []\n";
    write_raw(&root, ".tegg/types/čajovna.yml", theirs.as_bytes()); // no watcher: the core learns it only at the write
    let r = core.type_create("Čajovna", "Čajovny");
    assert!(
        matches!(r, Err(CoreError::Vault(VaultError::NameTaken)) | Err(CoreError::Schema(SchemaError::Rule(tegg_schema::RuleError::KeyTaken)))),
        "refused as a taken name, got {r:?}"
    );
    assert_eq!(read(&root, ".tegg/types/čajovna.yml"), theirs, "the other file is kept");
}

#[test]
fn fr_typ_01_ac3_create_refused_by_the_rules_writes_nothing() {
    let sb = sandbox();
    let root = types_vault(&sb);
    let core = open(&root, &sb, false);
    assert!(core.type_create("Kniha", "Knihy").is_ok(), "red guard: a valid name is created");
    let before = snapshot(&root);
    for (name, plural) in [("Page", "Stránky"), ("QUICK NOTE", "Rychlé"), ("Osoba", "Lidé"), ("  ", "Nic"), ("a/b", "Ab"), ("Kniha 2", "Osoby"), ("c\u{30C}ajovna", "x")] {
        let _ = core.type_create("Čajovna", "Čajovny"); // so the NFD case has something to collide with
        let snap = snapshot(&root);
        let r = core.type_create(name, plural);
        assert!(r.is_err(), "{name:?} / {plural:?} must be refused, got {r:?}");
        assert_eq!(changed(&snap, &snapshot(&root)), Vec::<String>::new(), "{name:?}: nothing written");
    }
    let _ = before;
    // A key used only by objects without a definition is allowed (D-121); those objects become its objects.
    write_raw(&root, "Recepty/Svíčková.md", "---\nid: 01JB0T0000000000000000T099\ntype: recept\ntitle: Svíčková\n---\n".as_bytes());
    core.notify_changed(&["Recepty/Svíčková.md".to_string()]);
    assert!(core.wait_idle(Duration::from_secs(10)));
    let t = ok!(core.type_create("Recept", "Recepty"), "type_create Recept");
    assert_eq!(t.key, "recept");
    assert_eq!(core.type_usage("recept").objects, 1);
}

#[test]
fn fr_typ_01_ac4_general_edits_write_only_the_type_file() {
    let sb = sandbox();
    let root = types_vault(&sb);
    let before = snapshot(&root);
    let core = open(&root, &sb, false);
    for op in [
        TypeOp::SetName("Porada".into()),
        TypeOp::SetPlural("Porady".into()),
        TypeOp::SetDescription(Some("Všechny porady.".into())),
        TypeOp::SetIcon("briefcase".into()),
        TypeOp::SetColor("orange".into()),
    ] {
        let b = base(&core, "schůzka");
        let what = format!("{op:?}");
        let _ = ok!(core.type_patch("schůzka", Some(&b), &[op]), what);
    }
    let t = get(&core, "schůzka");
    assert_eq!((t.key.as_str(), t.name.as_str(), t.plural.as_str(), t.icon.as_str(), t.color.as_str()), ("schůzka", "Porada", "Porady", "briefcase", "orange"));
    assert_eq!(t.def.description.as_deref(), Some("Všechny porady."));
    assert_eq!(changed(&before, &snapshot(&root)), vec![".tegg/types/schůzka.yml".to_string()], "only schůzka.yml (name kept), no note");
    assert_eq!(core.type_counts().get("schůzka").copied(), Some(3), "objects keep `type: schůzka`");
    let b = base(&core, "schůzka");
    let r = core.type_patch("schůzka", Some(&b), &[TypeOp::SetName("Po:rada".into())]);
    assert!(matches!(r, Err(CoreError::Schema(SchemaError::Rule(_)))), "invalid name refused, got {r:?}");
}

#[test]
fn fr_typ_01_ac6_external_type_file_changes_are_seen_within_2s() {
    let sb = sandbox();
    let root = types_vault(&sb);
    let core = open(&root, &sb, true);
    let rx = core.events();
    let _ = changed_paths(&rx);
    assert_eq!(core.type_get("osoba").map(|t| t.color), Some("purple".to_string()), "setup: osoba is purple");
    let before = snapshot(&root);
    let limit = Duration::from_secs(2);
    let osoba = read(&root, ".tegg/types/osoba.yml");
    write_raw(&root, ".tegg/types/osoba.yml", swap(&osoba, "color: purple\n", "color: teal\n").as_bytes());
    let mut seen = Vec::new();
    let ok_color = wait_until(limit, || {
        seen.extend(changed_paths(&rx));
        core.type_get("osoba").map(|t| t.color) == Some("teal".into()) && seen.iter().any(|p| p == ".tegg/types/osoba.yml")
    });
    assert!(ok_color.is_some(), "colour change not seen within 2 s (events {seen:?})");
    write_raw(&root, ".tegg/types/kniha.yml", fixture("types/expected/čajovna.yml").replace("Čajovna", "Kniha").replace("Čajovny", "Knihy").as_bytes());
    assert!(wait_until(limit, || core.types().iter().any(|t| t.key == "kniha")).is_some(), "added type listed within 2 s");
    std::fs::remove_file(root.join(".tegg/types/schůzka.yml")).expect("delete");
    assert!(wait_until(limit, || core.type_get("schůzka").is_none()).is_some(), "deleted type gone within 2 s");
    assert_eq!(core.type_counts().get("schůzka").copied(), Some(3), "its objects stay under the undefined key (D-121)");
    let mut after = snapshot(&root);
    after.remove(".tegg/types/kniha.yml");
    let mut b2 = before.clone();
    b2.remove(".tegg/types/schůzka.yml");
    after.remove(".tegg/types/osoba.yml");
    b2.remove(".tegg/types/osoba.yml");
    assert_eq!(changed(&b2, &after), Vec::<String>::new(), "the core wrote nothing");
}

#[test]
fn fr_typ_01_ac7_a_type_write_on_a_changed_file_is_refused() {
    let sb = sandbox();
    let root = types_vault(&sb);
    let core = open(&root, &sb, false);
    let b = base(&core, "osoba");
    let theirs = swap(&read(&root, ".tegg/types/osoba.yml"), "color: purple\n", "color: red\n");
    std::thread::sleep(Duration::from_millis(20));
    write_raw(&root, ".tegg/types/osoba.yml", theirs.as_bytes());
    let r = core.type_patch("osoba", Some(&b), &[TypeOp::SetColor("teal".into())]);
    assert!(matches!(r, Err(CoreError::Vault(VaultError::Conflict { .. }))), "Conflict, got {r:?}");
    assert_eq!(read(&root, ".tegg/types/osoba.yml"), theirs, "the external bytes stay");
    // Delete with a stale base is refused the same way.
    let p = base(&core, "prázdný");
    write_raw(&root, ".tegg/types/prázdný.yml", swap(&read(&root, ".tegg/types/prázdný.yml"), "color: gray\n", "color: blue\n").as_bytes());
    let d = core.type_delete("prázdný", &p);
    assert!(matches!(d, Err(CoreError::Vault(VaultError::Conflict { .. }))), "delete Conflict, got {d:?}");
    assert!(root.join(".tegg/types/prázdný.yml").exists());
}

// ------------------------------------------------------------------------------------------------ FR-TYP-03, -04

#[test]
fn fr_typ_03_ac5_option_use_counts_from_the_index() {
    let sb = sandbox();
    let root = types_vault(&sb);
    let core = open(&root, &sb, false);
    let u = core.type_usage("projekt");
    assert_eq!(u.objects, 3, "Rozpočet, Chybné, Velká písmena");
    let stav = u.options.get("stav").cloned().unwrap_or_default();
    assert_eq!((stav.get("Běží").copied(), stav.get("Hotovo").copied(), stav.get("Plánovaný").copied().unwrap_or(0)), (Some(1), Some(1), 0));
    let oblasti = u.options.get("oblasti").cloned().unwrap_or_default();
    assert_eq!((oblasti.get("Práce").copied(), oblasti.get("Rodina").copied().unwrap_or(0)), (Some(2), 0));
    assert_eq!(u.values.get("stav").copied(), Some(3), "non-empty stav values");
    assert_eq!(u.values.get("web").copied(), Some(2));
}

/// D-808 (AC-Test-Change approved by the owner): no misfits are counted any more; a retype from the widen-only menu
/// writes only the item's `type:` line, and no note file, even when a note holds a value (Porada's `místo`).
#[test]
fn fr_typ_03_ac11_a_widening_retype_writes_only_the_type_line() {
    let sb = sandbox();
    let root = types_vault(&sb);
    let porada = read(&root, PORADA);
    write_raw(&root, PORADA, swap(&porada, "místo:\n", "místo: Zasedačka\n").as_bytes());
    let core = open(&root, &sb, false);
    let before = snapshot(&root);
    let op = TypeOp::UpdateAttribute { key: "místo".into(), change: AttrChange { r#type: Some(AttrType::LongText), ..Default::default() } };
    ok!(core.type_patch("schůzka", Some(&base(&core, "schůzka")), &[op]), "místo Text → Long text");
    assert_eq!(read(&root, ".tegg/types/schůzka.yml"), swap(&fixture("vaults/types/.tegg/types/schůzka.yml"), "    name: Místo\n    type: text\n", "    name: Místo\n    type: long-text\n"), "only the item's type line");
    assert_eq!(changed(&before, &snapshot(&root)), vec![".tegg/types/schůzka.yml".to_string()], "no note file is written");
}

/// Slice 4E-2, type-moves.md FR-TYP-03 AC-14 (L4): on the type-moves fixture (+ new-empty/.tegg), Kniha's `hodnocení`
/// Number → Text from the widen-only menu writes only the item's `type:` line of `kniha.yml`; no note is written; and
/// Select → Text drops the options that no longer apply (ms4-jobs §14.9.7: `type_patch` as today). Added to this file
/// (not a new one) because the rule already holds: a new AC file must be red in its commit (CONTRACT §5.2).
fn moves_vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Přesuny");
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fx.join("type-moves"), &root);
    let _ = std::fs::remove_file(root.join("README.md"));
    copy_dir(&fx.join("new-empty/.tegg"), &root.join(".tegg"));
    root
}

#[test]
fn fr_typ_03_ac14_a_wider_type_writes_only_the_items_type_line() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = open(&root, &sb, false);
    let kniha = fixture("vaults/type-moves/.tegg/types/kniha.yml");
    let to = |k: &str, t: AttrType| TypeOp::UpdateAttribute { key: k.into(), change: AttrChange { r#type: Some(t), ..Default::default() } };
    let before = snapshot(&root);
    ok!(core.type_patch("kniha", Some(&base(&core, "kniha")), &[to("hodnocení", AttrType::Text)]), "Hodnocení: Number → Text");
    let one = swap(&kniha, "    name: Hodnocení\n    type: number\n", "    name: Hodnocení\n    type: text\n");
    assert_eq!(read(&root, ".tegg/types/kniha.yml"), one, "only hodnocení's type line");
    assert_eq!(changed(&before, &snapshot(&root)), vec![".tegg/types/kniha.yml".to_string()], "no note is written (Duna keeps `hodnocení: 5`)");
    ok!(core.type_patch("kniha", Some(&base(&core, "kniha")), &[to("stav", AttrType::Text)]), "Stav: Select → Text");
    let two = swap(&one, "    type: select\n    options:\n      - { label: Rozečtená, color: blue }\n      - { label: Dočtená, color: green }\n", "    type: text\n");
    assert_eq!(read(&root, ".tegg/types/kniha.yml"), two, "the options that no longer apply are dropped");
    assert_eq!(changed(&before, &snapshot(&root)), vec![".tegg/types/kniha.yml".to_string()], "still no note written");
}

fn object_text(type_key: &str, title: &str, id: &str) -> String {
    format!("---\nid: {id}\ntype: {type_key}\ntitle: {title}\ncreated: 2026-10-14T10:00:00+02:00\nmodified: 2026-10-14T10:00:00+02:00\n---\n")
}

#[test]
fn fr_typ_03_ac12_create_object_writes_one_file_in_the_type_folder_and_indexes_it() {
    let sb = sandbox();
    let root = types_vault(&sb);
    let (core, fs) = open_counting(&root, &sb);
    let before = snapshot(&root);
    let bytes = "---\nid: 01JB0T0000000000000000T100\ntype: nápad\ntitle: Nový nápad\nhodnocení: 3\nzdroj-nápadu: kniha\nreview: unreviewed\ncreated: 2026-10-14T10:00:00+02:00\nmodified: 2026-10-14T10:00:00+02:00\n---\n## Proč na tom záleží\n";
    let w0 = fs.write_count();
    let path = ok!(core.create_object("nápad", "Nový nápad", bytes.as_bytes()), "create_object");
    assert_eq!(tegg_format::nfc(&path), "Nápady/Nový nápad.md");
    assert_eq!(read(&root, "Nápady/Nový nápad.md"), bytes, "the bytes from @tegg/doc, unchanged");
    assert!(fs.write_count() - w0 <= 2, "one file write (plus at most its folder), got {}", fs.write_count() - w0);
    assert_eq!(changed(&before, &snapshot(&root)), vec!["Nápady/Nový nápad.md".to_string()]);
    let o = core.object(&path);
    assert_eq!(o.map(|o| o.r#type), Some("nápad".to_string()), "indexed at once");
    // Same title again: ` (2)` (FR-LNK-14).
    let p2 = ok!(core.create_object("nápad", "Nový nápad", object_text("nápad", "Nový nápad", "01JB0T0000000000000000T101").as_bytes()), "second");
    assert_eq!(tegg_format::nfc(&p2), "Nápady/Nový nápad (2).md");
    // A system type without a file is allowed; an unknown key and a mismatching `type` are refused.
    let q = ok!(core.create_object("quick-note", "Rychlá", object_text("quick-note", "Rychlá", "01JB0T0000000000000000T102").as_bytes()), "quick-note");
    assert_eq!(tegg_format::nfc(&q), "Quick Notes/Rychlá.md");
    let snap = snapshot(&root);
    let r = core.create_object("neexistuje", "X", object_text("neexistuje", "X", "01JB0T0000000000000000T103").as_bytes());
    assert!(matches!(r, Err(CoreError::UnknownType)), "unknown type refused, got {r:?}");
    let m = core.create_object("schůzka", "Y", object_text("osoba", "Y", "01JB0T0000000000000000T104").as_bytes());
    assert!(m.is_err(), "bytes whose type doesn't match refused, got {m:?}");
    assert_eq!(changed(&snap, &snapshot(&root)), Vec::<String>::new(), "refusals write nothing");
}

#[test]
fn fr_typ_03_ac12_new_objects_follow_the_current_folder() {
    let sb = sandbox();
    let root = types_vault(&sb);
    let core = open(&root, &sb, false);
    let b = base(&core, "schůzka");
    let _ = ok!(core.type_patch("schůzka", Some(&b), &[TypeOp::SetFolder("Práce/Porady".into())]), "folder");
    let path = ok!(core.create_object("schůzka", "Plánování", object_text("schůzka", "Plánování", "01JB0T0000000000000000T105").as_bytes()), "create");
    assert_eq!(tegg_format::nfc(&path), "Práce/Porady/Plánování.md", "folders created then (data-safety FR-STO-01 AC-2)");
    assert!(root.join(PORADA).exists() && root.join(PRAZDNA).exists(), "existing Schůzka files aren't moved");
}

#[test]
fn fr_typ_04_ac5_schema_changes_write_only_the_type_file() {
    let sb = sandbox();
    let root = types_vault(&sb);
    let before = snapshot(&root);
    let core = open(&root, &sb, false);
    let upd = |k: &str, c: AttrChange| TypeOp::UpdateAttribute { key: k.into(), change: c };
    let ops: Vec<(&str, TypeOp)> = vec![
        ("schůzka", upd("místo", AttrChange { name: Some("Místnost".into()), ..Default::default() })),
        ("schůzka", upd("místo", AttrChange { description: Some(Some("Kde to bylo".into())), ..Default::default() })),
        ("projekt", upd("stav", AttrChange { default: Some(Some(serde_json::json!("Běží"))), ..Default::default() })),
        ("projekt", upd("web", AttrChange { required: Some(true), ..Default::default() })),
        (
            "projekt",
            upd(
                "oblasti",
                AttrChange {
                    options: Some(["Práce", "Rodina", "Zdraví", "Koníčky"].iter().map(|l| OptionDef { label: (*l).into(), color: Some("gray".into()), extra: vec![] }).collect()),
                    ..Default::default()
                },
            ),
        ),
        ("schůzka", TypeOp::MoveAttribute { key: "místo".into(), to: 0 }),
    ];
    for (key, op) in ops {
        let b = base(&core, key);
        let what = format!("{key} {op:?}");
        let _ = ok!(core.type_patch(key, Some(&b), &[op]), what);
    }
    let mut got = changed(&before, &snapshot(&root));
    got.sort();
    assert_eq!(got, vec![".tegg/types/projekt.yml".to_string(), ".tegg/types/schůzka.yml".to_string()], "every note byte-identical, same mtime and inode");
}

// ------------------------------------------------------------------------------------------------ FR-TYP-05, -06

#[test]
fn fr_typ_05_ac1_delete_moves_the_type_file_and_template_folder_to_the_trash() {
    let sb = sandbox();
    let root = types_vault(&sb);
    let before = snapshot(&root);
    let core = open(&root, &sb, false);
    let b = base(&core, "prázdný");
    let trashed = ok!(core.type_delete("prázdný", &b), "type_delete");
    let trashed: Vec<String> = trashed.iter().map(|p| tegg_format::nfc(p)).collect();
    assert!(trashed.contains(&".trash/.tegg/types/prázdný.yml".to_string()), "returned trash paths {trashed:?}");
    assert_eq!(read(&root, ".trash/.tegg/types/prázdný.yml"), fixture("vaults/types/.tegg/types/prázdný.yml"));
    assert_eq!(read(&root, ".trash/_templates/Prázdný/Prázdný.md"), fixture("vaults/types/_templates/Prázdný/Prázdný.md"));
    assert!(!root.join(".tegg/types/prázdný.yml").exists() && !root.join("_templates/Prázdný").exists());
    let mut got = changed(&before, &snapshot(&root));
    got.retain(|p| !p.ends_with('/'));
    got.sort();
    assert_eq!(got, vec![".tegg/types/prázdný.yml", ".trash/.tegg/types/prázdný.yml", ".trash/_templates/Prázdný/Prázdný.md", "_templates/Prázdný/Prázdný.md"], "nothing else written");
    assert!(core.type_get("prázdný").is_none() && !core.types().iter().any(|t| t.key == "prázdný"), "the type is gone");
}

#[test]
fn fr_typ_05_ac1_a_taken_trash_path_gets_a_2_suffix() {
    let sb = sandbox();
    let root = types_vault(&sb);
    write_raw(&root, ".trash/.tegg/types/prázdný.yml", b"# older\n");
    let core = open(&root, &sb, false);
    let b = base(&core, "prázdný");
    let _ = ok!(core.type_delete("prázdný", &b), "type_delete");
    assert_eq!(read(&root, ".trash/.tegg/types/prázdný.yml"), "# older\n", "the older trashed file is kept");
    assert_eq!(read(&root, ".trash/.tegg/types/prázdný (2).yml"), fixture("vaults/types/.tegg/types/prázdný.yml"));
}

#[test]
fn fr_typ_05_ac2_object_counts_resolve_types_and_skip_templates_and_trash() {
    let sb = sandbox();
    let root = types_vault(&sb);
    let core = open(&root, &sb, false);
    let n = |k: &str| core.type_usage(k).objects;
    assert_eq!((n("prázdný"), n("schůzka"), n("projekt")), (0, 3, 3));
    let c = core.type_counts();
    assert_eq!((c.get("prázdný").copied().unwrap_or(0), c.get("schůzka").copied(), c.get("projekt").copied()), (0, Some(3), Some(3)));
    let b = base(&core, "schůzka");
    let r = core.type_delete("schůzka", &b);
    assert!(matches!(r, Err(CoreError::HasObjects(3))), "a type with objects is refused (D-225), got {r:?}");
}

#[test]
fn fr_typ_05_ac5_delete_rechecks_objects_at_the_call() {
    let sb = sandbox();
    let root = types_vault(&sb);
    let core = open(&root, &sb, false);
    let b = base(&core, "prázdný");
    write_raw(&root, "Prázdné/Nový.md", object_text("prázdný", "Nový", "01JB0T0000000000000000T110").as_bytes());
    core.notify_changed(&["Prázdné/Nový.md".to_string()]);
    assert!(core.wait_idle(Duration::from_secs(10)));
    let before = snapshot(&root);
    let r = core.type_delete("prázdný", &b);
    assert!(matches!(r, Err(CoreError::HasObjects(1))), "HasObjects(1), got {r:?}");
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "nothing written");
}

#[test]
fn fr_typ_06_ac1_system_types_cannot_be_deleted() {
    let sb = sandbox();
    let root = types_vault(&sb);
    let core = open(&root, &sb, false);
    let before = snapshot(&root);
    for key in ["page", "task", "quick-note", "daily-note", "tag", "image", "pdf"] {
        let b = base(&core, key);
        let r = core.type_delete(key, &b);
        assert!(matches!(r, Err(CoreError::SystemType)), "{key}: SystemType, got {r:?}");
    }
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new());
}

#[test]
fn fr_typ_06_ac4_missing_system_file_uses_built_in_defaults_and_the_first_change_creates_it() {
    let sb = sandbox();
    let root = types_vault(&sb);
    std::fs::remove_file(root.join(".tegg/types/task.yml")).expect("delete task.yml");
    let before = snapshot(&root);
    let core = open(&root, &sb, false);
    let t = get(&core, "task");
    let want = tegg_schema::parse("task", &fixture("vaults/new-empty/.tegg/types/task.yml")).def;
    assert_eq!((t.exists, t.version.is_none(), t.name.as_str()), (false, true, "Task"));
    assert_eq!(t.def, want, "built-in defaults identical to new-empty's task.yml");
    assert!(core.types().iter().any(|x| x.key == "task"), "still listed");
    let _ = core.type_rows("task");
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "opening its page and settings writes nothing");
    let _ = ok!(core.type_patch("task", None, &[TypeOp::SetColor("red".into())]), "first change");
    assert_eq!(read(&root, ".tegg/types/task.yml"), swap(&fixture("vaults/new-empty/.tegg/types/task.yml"), "color: blue\n", "color: red\n"));
}

// ------------------------------------------------------------------------------------------------ FR-TYP-09, -12, -13

#[test]
fn fr_typ_09_ac2_rows_come_from_one_index_query() {
    let sb = sandbox();
    let root = types_vault(&sb);
    let (core, fs) = open_counting(&root, &sb);
    let reads0 = fs.read_paths().len();
    let rows = core.type_rows("schůzka");
    assert_eq!(fs.read_paths().len(), reads0, "no note is read for the rows");
    assert_eq!(rows.iter().map(|r| tegg_format::nfc(&r.path)).collect::<BTreeSet<_>>(), set(&[PORADA, PRAZDNA, VE_STRANKACH]), "wherever stored; never templates or .trash/");
    let porada = rows.iter().find(|r| tegg_format::nfc(&r.path) == PORADA);
    let p = match porada {
        Some(p) => p,
        None => {
            assert!(false, "Porada row");
            unreachable!()
        }
    };
    assert_eq!((p.title.as_str(), p.modified.as_deref(), p.type_single), ("2026-10-07 Porada", Some("2026-10-07T10:15:00+02:00"), true));
    assert_eq!(p.values.get("datum"), Some(&serde_json::json!("2026-10-07")), "preview datum");
    assert_eq!(p.values.get("účastníci"), Some(&serde_json::json!(["[[Jana Nováková]]", "[[Petr Dvořák]]"])), "preview účastníci");
    assert!(p.values.get("místo").is_none() && p.values.get("nálada").is_none(), "only preview keys");
    let link_paths: BTreeSet<String> = p.links.iter().filter_map(|l| l.path.clone()).map(|x| tegg_format::nfc(&x)).collect();
    assert_eq!(link_paths, set(&[JANA, PETR]), "resolved relation values");
    // A date range preview is given as its two halves.
    let r = core.type_rows("projekt");
    let rz = r.iter().find(|x| tegg_format::nfc(&x.path) == ROZPOCET);
    assert_eq!(rz.map(|x| (x.values.get("období-start").cloned(), x.values.get("období-end").cloned())), Some((Some(serde_json::json!("2027-01-01")), Some(serde_json::json!("2027-12-31")))));
}

#[test]
fn fr_typ_09_ac9_rows_follow_external_changes_within_2s() {
    let sb = sandbox();
    let root = types_vault(&sb);
    let core = open(&root, &sb, true);
    assert_eq!(row_paths(&core, "schůzka").len(), 3, "setup: three rows");
    let limit = Duration::from_secs(2);
    let new = "Schůzky/Nová porada.md";
    write_raw(&root, new, b"---\nid: 01JB0T0000000000000000T120\ntype: schu\xcc\x8azka\ntitle: Nov\xc3\xa1 porada\ndatum: 2026-10-20\n---\n");
    assert!(wait_until(limit, || row_paths(&core, "schůzka").contains(new)).is_some(), "added row");
    let porada = read(&root, PORADA);
    write_raw(&root, PORADA, swap(&porada, "datum: 2026-10-07\n", "datum: 2026-10-08\n").as_bytes());
    let datum = |c: &Core| c.type_rows("schůzka").into_iter().find(|r| tegg_format::nfc(&r.path) == PORADA).and_then(|r| r.values.get("datum").cloned());
    assert!(wait_until(limit, || datum(&core) == Some(serde_json::json!("2026-10-08"))).is_some(), "changed datum, got {:?}", datum(&core));
    std::fs::remove_file(root.join(PRAZDNA)).expect("delete");
    assert!(wait_until(limit, || !row_paths(&core, "schůzka").contains(PRAZDNA)).is_some(), "removed row");
}

#[test]
fn fr_typ_12_ac3_turning_review_on_rewrites_no_object() {
    let sb = sandbox();
    let root = types_vault(&sb);
    let before = snapshot(&root);
    let core = open(&root, &sb, false);
    let b = base(&core, "schůzka");
    let t = ok!(core.type_patch("schůzka", Some(&b), &[TypeOp::SetReview(true)]), "review on");
    assert_eq!(t.def.review, tegg_schema::Review::On);
    assert_eq!(changed(&before, &snapshot(&root)), vec![".tegg/types/schůzka.yml".to_string()], "Porada stays without review");
}

#[test]
fn fr_typ_13_ac1_type_values_match_by_key_without_rewriting() {
    let sb = sandbox();
    let root = types_vault(&sb);
    write_raw(&root, "Pages/NFD schůzka.md", "---\nid: 01JB0T0000000000000000T130\ntype: schu\u{30A}zka\ntitle: NFD schůzka\n---\n".as_bytes());
    write_raw(&root, "Pages/Rychlá s mezerou.md", b"---\nid: 01JB0T0000000000000000T131\ntype: Quick Note\ntitle: Rychl\xc3\xa1 s mezerou\n---\n");
    let before = snapshot(&root);
    let core = open(&root, &sb, false);
    assert!(row_paths(&core, "projekt").contains(VELKA), "Velká písmena (`type: Projekt`) is a Projekt row");
    assert!(row_paths(&core, "schůzka").contains("Pages/NFD schůzka.md"), "NFD value is a Schůzka");
    assert!(row_paths(&core, "quick-note").contains("Pages/Rychlá s mezerou.md"), "`Quick Note` is a Quick Note");
    let c = core.type_counts();
    assert_eq!((c.get("projekt").copied(), c.get("Projekt").copied()), (Some(3), None), "counted under the matched key");
    assert_eq!(core.object(VELKA).map(|o| o.r#type), Some("projekt".to_string()));
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "never rewritten");
}

#[test]
fn fr_typ_13_ac2_values_that_are_not_one_type_are_pages() {
    let sb = sandbox();
    let root = types_vault(&sb);
    for (name, v) in [("Číslo", "type: 5"), ("Prázdný typ", "type:"), ("Prázdný řetězec", "type: \"\"")] {
        write_raw(&root, &format!("Pages/{name}.md"), format!("---\nid: 01JB0T00000000000000{:06}\n{v}\ntitle: {name}\n---\n", name.len()).as_bytes());
    }
    let before = snapshot(&root);
    let core = open(&root, &sb, false);
    let pages = core.type_rows("page");
    for p in [DVA_TYPY, "Pages/Číslo.md", "Pages/Prázdný typ.md", "Pages/Prázdný řetězec.md"] {
        let r = pages.iter().find(|r| tegg_format::nfc(&r.path) == p);
        assert_eq!(r.map(|r| r.type_single), Some(false), "{p}: a Page row with type_single = false");
    }
    let bez = pages.iter().find(|r| tegg_format::nfc(&r.path) == "Pages/Bez hlavičky.md");
    assert_eq!(bez.map(|r| r.type_single), Some(true), "a missing type is a plain Page (D-103)");
    let all: usize = core.type_counts().values().sum();
    assert_eq!(all, notes_of(&root).len(), "each counted once");
    assert!(!row_paths(&core, "projekt").contains(DVA_TYPY) && !row_paths(&core, "osoba").contains(DVA_TYPY));
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new());
}

#[test]
fn fr_typ_13_ac3_each_object_is_a_row_of_exactly_one_type() {
    let sb = sandbox();
    let root = types_vault(&sb);
    let core = open(&root, &sb, false);
    let counts = core.type_counts();
    let notes = notes_of(&root);
    assert_eq!(counts.values().sum::<usize>(), notes.len(), "sum of counts = indexed objects outside templates and .trash/");
    let mut seen: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for k in counts.keys() {
        for p in row_paths(&core, k) {
            seen.entry(p).or_default().push(k.clone());
        }
    }
    let wrong: Vec<_> = notes.iter().filter(|n| seen.get(*n).map_or(0, |v| v.len()) != 1).map(|n| format!("{n}: {:?}", seen.get(n))).collect();
    assert!(wrong.is_empty(), "objects not in exactly one type page:\n{}", wrong.join("\n"));
}

// ------------------------------------------------------------------------------------------------ FR-VLT-02

#[test]
fn fr_vlt_02_ac6_starter_kind_is_supported() {
    let sb = sandbox();
    let parent = sb.base.join("Nové");
    std::fs::create_dir_all(&parent).expect("parent");
    let r = Vault::create(&parent, "Startovní", VaultKind::Starter(tegg_schema::STARTER_FILES), &sb.dirs);
    assert!(r.is_ok(), "vault_create kind starter no longer Unsupported, got {:?}", r.err());
}

#[test]
fn fr_vlt_02_ac7_starter_vault_is_new_empty_plus_new_starter_byte_for_byte() {
    let sb = sandbox();
    let parent = sb.base.join("Nové");
    std::fs::create_dir_all(&parent).expect("parent");
    let _ = Vault::create(&parent, "Startovní", VaultKind::Starter(tegg_schema::STARTER_FILES), &sb.dirs);
    let got: BTreeMap<String, Vec<u8>> = if parent.join("Startovní").exists() { files_with_bytes(&parent.join("Startovní")).into_iter().map(|(p, b)| (tegg_format::nfc(&p), b)).collect() } else { BTreeMap::new() };
    let fx = repo_root().join("tests/fixtures/vaults");
    let mut want: BTreeMap<String, Vec<u8>> = files_with_bytes(&fx.join("new-empty")).into_iter().map(|(p, b)| (tegg_format::nfc(&p), b)).collect();
    want.extend(files_with_bytes(&fx.join("new-starter")).into_iter().map(|(p, b)| (tegg_format::nfc(&p), b)));
    assert_eq!(want.len(), 8 + 14, "setup: 8 new-empty files + 7 types + 7 templates");
    assert_eq!(got.keys().collect::<Vec<_>>(), want.keys().collect::<Vec<_>>(), "exactly these files, no notes, no type folders");
    assert!(got == want, "byte for byte");
    // STARTER_FILES is the overlay, type files first, then templates.
    let paths: Vec<&str> = tegg_schema::STARTER_FILES.iter().map(|(p, _)| *p).collect();
    assert_eq!(paths.len(), 14);
    assert!(paths[..7].iter().all(|p| p.starts_with(".tegg/types/")) && paths[7..].iter().all(|p| p.starts_with("_templates/")));
}

#[test]
fn fr_vlt_02_ac9_add_starter_types_skips_taken_names_and_folders() {
    let sb = sandbox();
    let root = types_vault(&sb);
    write_raw(&root, ".tegg/types/person.yml", fixture("types/expected/čajovna.yml").replace("Čajovna", "Person").replace("Čajovny", "Persons").as_bytes());
    write_raw(&root, ".tegg/types/kniha.yml", fixture("types/expected/čajovna.yml").replace("Čajovna", "Kniha").replace("folder: Čajovny", "folder: Books").replace("Čajovny", "Knihy").as_bytes());
    write_raw(&root, "_templates/Meeting/Meeting.md", "## Moje agenda\n".as_bytes());
    let before = snapshot(&root);
    let core = open(&root, &sb, false);
    let plan = core.starter_plan();
    assert_eq!(plan.add, vec!["reading-note", "idea", "meeting", "project", "trip"], "R11 order without Book and Person");
    assert_eq!(plan.skip, vec![("book".to_string(), StarterSkip::FolderUsed { folder: "Books".into() }), ("person".to_string(), StarterSkip::NameExists)]);
    assert_eq!(plan.skip_templates, vec!["_templates/Meeting/Meeting.md"]);
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "the plan is read-only");
    let applied = ok!(core.starter_add(), "starter_add");
    assert_eq!(applied, plan);
    let mut got = changed(&before, &snapshot(&root));
    got.retain(|p| !p.ends_with('/'));
    got.sort();
    let mut want: Vec<String> = ["reading-note", "idea", "meeting", "project", "trip"].iter().map(|k| format!(".tegg/types/{k}.yml")).collect();
    want.extend(["_templates/Reading Note/Reading Note.md", "_templates/Idea/Idea.md", "_templates/Project/Project.md", "_templates/Trip/Trip.md"].iter().map(|s| s.to_string()));
    want.sort();
    assert_eq!(got, want, "only the five type files and their templates; no existing file changed");
    assert_eq!(read(&root, "_templates/Meeting/Meeting.md"), "## Moje agenda\n");
    for k in ["reading-note", "idea", "meeting", "project", "trip"] {
        assert_eq!(read(&root, &format!(".tegg/types/{k}.yml")), fixture(&format!("vaults/new-starter/.tegg/types/{k}.yml")), "{k} byte-equal to the overlay");
    }
}

#[test]
fn fr_vlt_02_ac9_nothing_to_add_writes_nothing() {
    let sb = sandbox();
    let root = types_vault(&sb);
    copy_dir(&repo_root().join("tests/fixtures/vaults/new-starter/.tegg/types"), &root.join(".tegg/types"));
    copy_dir(&repo_root().join("tests/fixtures/vaults/new-starter/_templates"), &root.join("_templates"));
    let core = open(&root, &sb, false);
    let plan = core.starter_plan();
    assert!(plan.add.is_empty() && plan.skip.len() == 7, "all seven present: nothing to add, seven skipped, got {plan:?}");
    let before = snapshot(&root);
    let applied = ok!(core.starter_add(), "starter_add");
    assert!(applied.add.is_empty());
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new());
}
