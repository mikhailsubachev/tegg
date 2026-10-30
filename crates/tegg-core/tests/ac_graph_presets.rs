//! Slice G3 L4 tests of the graph filter presets in `.tegg/graph.yml` (docs/acceptance/graph.md part two, R118;
//! docs/contracts/v1-graph.md §16.1): FR-GRP-02 AC-13…AC-21 (the write rules byte for byte against
//! tests/fixtures/graph-presets/expected/, name validation, Default never stored, unknown keys kept, unreadable and
//! newer files never rewritten, skipped entries kept), FR-SYN-03 AC-22…AC-24 (the base check with `FileVersion`,
//! `Gone`, sync conflict copies untouched, a first save never replaces a new file), FR-SYN-02 AC-8 (atomic writes: a
//! new inode each time, temp names, the SIGKILL harness over 200 alternating updates), FR-FMT-07 AC-27 (comments,
//! unknown keys, CRLF, a missing final newline), FR-FMT-12 AC-7 (NFC names), NFR-POR-01 AC-3 (standard YAML: the `yaml`
//! npm package reads the same presets) and FR-STO-06 AC-1 (a vault file only; AR-01, AR-03). Interface:
//! `Core::graph_presets`, `Core::graph_presets_apply`, `PresetOp`, `PresetError`, `PresetsState`, `CoreError::Preset`.
//! Written from the ACs, the fixtures and the contract only (D-61); every check is an assertion in this file.
//!
//! Vault: a temporary copy of tests/fixtures/vaults/graph with new-empty/.tegg (graph_setup), the vault's type order
//! (D-977, D-994): page, task, quick-note, daily-note, cesta, osoba, projekt, schůzka, image, pdf, tag, recept.

mod common;
mod graph_presets_setup;
mod graph_setup;

use std::collections::BTreeMap;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use common::*;
use graph_presets_setup::*;
use graph_setup::open;
use tegg_core::{Core, CoreError, GraphPreset, GraphPresets, PresetError, PresetOp, PresetsState, VaultError};
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

fn names(p: &GraphPresets) -> Vec<String> {
    p.presets.iter().map(|x| x.name.clone()).collect()
}
fn preset(name: &str, t: &[&str], k: &[&str]) -> GraphPreset {
    GraphPreset { name: nfc(name), hidden_types: strs(t), hidden_kinds: strs(k) }
}
fn changed(a: &BTreeMap<String, Entry>, b: &BTreeMap<String, Entry>) -> Vec<String> {
    let keys: std::collections::BTreeSet<&String> = a.keys().chain(b.keys()).collect();
    keys.into_iter().filter(|k| a.get(*k) != b.get(*k)).map(|k| nfc(k)).collect()
}
fn yml_only() -> Vec<String> {
    vec![YML.to_string()]
}
/// Reads, then applies `op` with the version just read as base.
fn apply_fresh(core: &Core, op: PresetOp) -> Result<GraphPresets, CoreError> {
    let base = core.graph_presets().version;
    core.graph_presets_apply(base, op)
}
fn is_preset_err(r: &Result<GraphPresets, CoreError>, want: &PresetError) -> bool {
    matches!(r, Err(CoreError::Preset(e)) if e == want)
}
fn reread(core: &Core) {
    core.notify_changed(&[YML.to_string()]);
    let _ = core.wait_idle(Duration::from_secs(30));
}

/// Plán's preset list of `valid.yml` (R118 read rules).
fn valid_presets() -> Vec<GraphPreset> {
    vec![
        preset("Bez štítků", &["tag", "kniha"], &[]),
        preset("Jen vztahy", &[], &["link", "embed", "tag"]),
        preset("Lidé a schůzky", &["page", "task", "quick-note", "daily-note", "cesta", "projekt", "image", "pdf", "tag", "recept"], &[]),
    ]
}

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-13

#[test]
fn fr_grp_02_ac13_modified_update_and_revert() {
    let sb = sandbox();
    let root = vault_fx(&sb, "valid.yml");
    let core = open(&root, &sb.dirs);
    let read = core.graph_presets();
    assert_eq!(read.state, PresetsState::Ok, "valid.yml reads as Ok");
    assert_eq!(read.presets, valid_presets(), "the three presets in file order, unknown `kniha` and `recept` kept (D-907, AP-945)");
    assert!(read.version.is_some(), "the file's version as read");
    let before = snapshot(&root);
    let ino0 = ino(&root, YML);
    let after = ok!(core.graph_presets_apply(read.version.clone(), update("Bez štítků", &["kniha"], &[])), "update Bez štítků to [kniha]");
    assert_eq!(disk(&root, YML), Some(fx("expected/valid-after-update.yml")), "byte-identical to expected/valid-after-update.yml (only line 5)");
    assert_eq!(changed(&before, &snapshot(&root)), yml_only(), "one file written: .tegg/graph.yml");
    assert_ne!(ino(&root, YML), ino0, "an atomic replace (a new inode, FR-SYN-02)");
    assert_eq!(after.presets[0], preset("Bez štítků", &["kniha"], &[]), "the returned state holds the new values");
    let again = snapshot(&root);
    ok!(core.graph_presets_apply(after.version.clone(), update("Bez štítků", &["kniha"], &[])), "the same update again");
    assert_eq!(changed(&again, &snapshot(&root)), Vec::<String>::new(), "an update with unchanged sets writes nothing (FR-SYN-06 AC-40)");
    ok!(core.graph_presets_apply(after.version.clone(), update("Jen vztahy", &[], &["tag", "embed", "link"])), "the same sets in another order");
    assert_eq!(changed(&again, &snapshot(&root)), Vec::<String>::new(), "sets compare unordered: still nothing written");
}

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-14

#[test]
fn fr_grp_02_ac14_save_as_new_creates_the_file_once() {
    let sb = sandbox();
    let root = vault_with(&sb, None);
    let core = open(&root, &sb.dirs);
    let read = core.graph_presets();
    assert_eq!((read.state.clone(), read.version.clone(), read.presets.len()), (PresetsState::Missing, None, 0), "no graph.yml: Missing, no version, no presets");
    assert!(disk(&root, YML).is_none(), "reading creates nothing");
    let before = snapshot(&root);
    let saved = ok!(core.graph_presets_apply(None, save("Bez štítků", &["tag"], &[])), "the first save (base none)");
    assert_eq!(disk(&root, YML), Some(fx("expected/created.yml")), "byte-identical to expected/created.yml");
    assert_eq!(changed(&before, &snapshot(&root)), yml_only(), "exactly one file created");
    assert_eq!((saved.state.clone(), names(&saved)), (PresetsState::Ok, strs(&["Bez štítků"])), "the new state lists it");
    assert!(saved.version.is_some(), "with the new file's version");

    // Validation (AP-928), on valid.yml: nothing is written for any refusal.
    let sb2 = sandbox();
    let root2 = vault_fx(&sb2, "valid.yml");
    let core2 = open(&root2, &sb2.dirs);
    let stamp0 = stamp(&root2, YML);
    let taken = PresetError::NameTaken { existing: nfc("Bez štítků") };
    let default = PresetError::NameTaken { existing: "Default".into() };
    let long: String = "ř".repeat(101);
    let cases: Vec<(String, PresetError)> = vec![
        ("bez ŠTÍTKŮ".into(), taken.clone()),
        (" Bez štítků ".into(), taken.clone()),
        ("Default".into(), default.clone()),
        ("default".into(), default.clone()),
        ("".into(), PresetError::NameEmpty),
        ("   ".into(), PresetError::NameEmpty),
        (long, PresetError::NameTooLong),
        ("Lidé\tschůzky".into(), PresetError::NameControl),
        ("Nový\u{7}".into(), PresetError::NameControl),
    ];
    for (name, want) in &cases {
        let r = apply_fresh(&core2, save(name, &["tag"], &[]));
        assert!(is_preset_err(&r, want), "save {name:?}: {want:?}, got {r:?}");
    }
    assert_eq!(stamp(&root2, YML), stamp0, "no refused save wrote anything (bytes, mtime, inode)");
    let s100 = ok!(apply_fresh(&core2, save(&"ř".repeat(100), &[], &[])), "100 characters (200 UTF-8 bytes) are allowed");
    assert_eq!(s100.presets.len(), 4, "the 100-character name is listed");
    let s = ok!(apply_fresh(&core2, save("Lidé: #1", &[], &["tag"])), "save `Lidé: #1`");
    let text = disk_s(&root2, YML).unwrap_or_default();
    assert!(text.contains("\n  - name: \"Lidé: #1\"\n"), "a name YAML wouldn't read back plain is double-quoted (D-230): {text}");
    assert_eq!(s.presets.last().map(|p| p.name.clone()), Some(nfc("Lidé: #1")), "and reads back as `Lidé: #1`");
    reread(&core2);
    assert_eq!(core2.graph_presets().presets.last().map(|p| p.name.clone()), Some(nfc("Lidé: #1")), "a fresh read too");
}

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-15

#[test]
fn fr_grp_02_ac15_rename_in_place() {
    let sb = sandbox();
    let root = vault_fx(&sb, "valid.yml");
    let core = open(&root, &sb.dirs);
    let valid = fxs("valid.yml");
    let before = snapshot(&root);
    let r = ok!(apply_fresh(&core, rename("Jen vztahy", "jen VZTAHY")), "a case-only rename: Jen vztahy → jen VZTAHY");
    assert_eq!(disk_s(&root, YML), Some(line_set(&valid, 7, Some("  - name: jen VZTAHY"))), "a case-only rename is written (only line 7)");
    assert_eq!(changed(&before, &snapshot(&root)), yml_only(), "one file written");
    let r2 = ok!(core.graph_presets_apply(r.version.clone(), rename("jen VZTAHY", "Vztahy")), "rename → Vztahy");
    assert_eq!(disk_s(&root, YML), Some(line_set(&valid, 7, Some("  - name: Vztahy"))), "only line 7 changes: `  - name: Vztahy`");
    assert_eq!(names(&r2), strs(&["Bez štítků", "Vztahy", "Lidé a schůzky"]), "the rename keeps its place (AP-945)");
    let same = snapshot(&root);
    let r3 = core.graph_presets_apply(r2.version.clone(), rename("Vztahy", "Bez štítků"));
    assert!(is_preset_err(&r3, &PresetError::NameTaken { existing: nfc("Bez štítků") }), "renaming to a taken name: {r3:?}");
    ok!(core.graph_presets_apply(r2.version.clone(), rename("Vztahy", "Vztahy")), "renaming to the same name");
    assert_eq!(changed(&same, &snapshot(&root)), Vec::<String>::new(), "a refused rename and a rename to the same name write nothing");
    let r4 = core.graph_presets_apply(r2.version.clone(), rename("Neexistuje", "Cokoli"));
    assert!(is_preset_err(&r4, &PresetError::NoSuchPreset), "a preset not listed: NoSuchPreset, got {r4:?}");
    let r5 = core.graph_presets_apply(r2.version.clone(), rename("Vztahy", "Default"));
    assert!(is_preset_err(&r5, &PresetError::NameTaken { existing: "Default".into() }), "renaming to Default is refused: {r5:?}");
    assert_eq!(changed(&same, &snapshot(&root)), Vec::<String>::new(), "still nothing written");
}

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-16

#[test]
fn fr_grp_02_ac16_delete_keeps_the_file_and_the_filters() {
    let sb = sandbox();
    let root = vault_fx(&sb, "valid.yml");
    let core = open(&root, &sb.dirs);
    let valid = fxs("valid.yml");
    let r = ok!(apply_fresh(&core, delete("Jen vztahy")), "delete Jen vztahy");
    assert_eq!(disk_s(&root, YML), Some(lines_cut(&valid, 7, 9)), "exactly lines 7–9 removed");
    assert_eq!(names(&r), strs(&["Bez štítků", "Lidé a schůzky"]), "two left");
    let again = core.graph_presets_apply(r.version.clone(), delete("Jen vztahy"));
    assert!(is_preset_err(&again, &PresetError::NoSuchPreset), "deleting it again: NoSuchPreset, got {again:?}");
    let r = ok!(core.graph_presets_apply(r.version.clone(), delete("Bez štítků")), "delete Bez štítků");
    let r = ok!(core.graph_presets_apply(r.version.clone(), delete("Lidé a schůzky")), "delete the last preset");
    assert_eq!(disk(&root, YML), Some(fx("expected/valid-after-deleting-all.yml")), "`presets: []`, byte-identical to expected/valid-after-deleting-all.yml");
    assert!(root.join(YML).is_file(), "the file is never deleted (AP-926)");
    assert_eq!((r.state.clone(), r.presets.len()), (PresetsState::Ok, 0), "no presets listed");
    let s = ok!(core.graph_presets_apply(r.version.clone(), save("Nová", &["tag"], &[])), "a save after deleting all");
    assert_eq!(names(&s), strs(&["Nová"]), "replaces `presets: []`");
    let text = disk_s(&root, YML).unwrap_or_default();
    assert!(text.ends_with("presets:\n  - name: Nová\n    hidden-types: [tag]\n    hidden-kinds: []\n") && !text.contains("[]\n  - name"), "the item replaces `presets: []`: {text}");

    let sb2 = sandbox();
    let root2 = vault_fx(&sb2, "unknown-keys.yml");
    let core2 = open(&root2, &sb2.dirs);
    ok!(apply_fresh(&core2, delete("Lidé: schůzky")), "delete `Lidé: schůzky` on unknown-keys");
    assert_eq!(disk(&root2, YML), Some(fx("expected/unknown-keys-after-delete.yml")), "expected/unknown-keys-after-delete.yml");
}

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-17

#[test]
fn fr_grp_02_ac17_default_is_never_stored() {
    let sb = sandbox();
    let root = vault_fx(&sb, "valid.yml");
    let core = open(&root, &sb.dirs);
    assert_eq!(names(&core.graph_presets()), strs(&["Bez štítků", "Jen vztahy", "Lidé a schůzky"]), "Default is never listed by the core");
    let stamp0 = stamp(&root, YML);
    for name in ["Default", "DEFAULT", " default "] {
        let r = apply_fresh(&core, save(name, &["tag"], &[]));
        assert!(is_preset_err(&r, &PresetError::NameTaken { existing: "Default".into() }), "save {name:?} is refused: {r:?}");
    }
    let u = apply_fresh(&core, update("Default", &["tag"], &[]));
    assert!(is_preset_err(&u, &PresetError::NoSuchPreset), "Default can't be updated: {u:?}");
    let d = apply_fresh(&core, delete("Default"));
    assert!(is_preset_err(&d, &PresetError::NoSuchPreset), "Default can't be deleted: {d:?}");
    let n = apply_fresh(&core, rename("Default", "Výchozí"));
    assert!(is_preset_err(&n, &PresetError::NoSuchPreset), "Default can't be renamed: {n:?}");
    assert_eq!(stamp(&root, YML), stamp0, "the file keeps its bytes, mtime and inode");
}

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-18

#[test]
fn fr_grp_02_ac18_presets_store_hidden_keys_and_keep_unknown_ones() {
    let sb = sandbox();
    let root = vault_fx(&sb, "valid.yml");
    let core = open(&root, &sb.dirs);
    let valid = fxs("valid.yml");
    let r = ok!(apply_fresh(&core, update("Jen vztahy", &["recept", "kniha", "tag", "osoba", "page"], &["tag", "link"])), "update Jen vztahy");
    let want = line_set(&line_set(&valid, 8, Some("    hidden-types: [page, osoba, tag, recept, kniha]")), 9, Some("    hidden-kinds: [link, tag]"));
    assert_eq!(disk_s(&root, YML), Some(want), "types in the D-977 order then unknown keys as given; kinds link, relation, embed, tag (R118)");
    assert_eq!(r.presets[0], preset("Bez štítků", &["tag", "kniha"], &[]), "Bez štítků keeps `kniha`");
    assert_eq!(r.presets[2].hidden_types.last().cloned(), Some("recept".to_string()), "Lidé a schůzky keeps `recept`");
    let r = ok!(core.graph_presets_apply(r.version.clone(), save("Výběr", &["kniha", "schůzka", "daily-note", "neznámý"], &["tag", "relation"])), "save Výběr");
    let text = disk_s(&root, YML).unwrap_or_default();
    assert!(
        text.ends_with("  - name: Výběr\n    hidden-types: [daily-note, schůzka, kniha, neznámý]\n    hidden-kinds: [relation, tag]\n"),
        "save writes the keys in R118's order, unknown ones in their given order: {text}"
    );
    assert_eq!(r.presets.len(), 4, "listed last");
    for (n, l) in [(5, "    hidden-types: [tag, kniha]"), (11, "    hidden-types: [page, task, quick-note, daily-note, cesta, projekt, image, pdf, tag, recept]")] {
        assert_eq!(text.lines().nth(n - 1), Some(l), "line {n} keeps its unknown keys");
    }
}

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-19

#[test]
fn fr_grp_02_ac19_unreadable_file_is_never_rewritten() {
    let valid = fxs("valid.yml");
    let mut not_utf8 = fx("valid.yml");
    let at = valid.find("Bez štítků").expect("setup: line 4's name") + 3;
    not_utf8.insert(at, 0xFF);
    let variants: Vec<(&str, Vec<u8>, Option<u32>)> = vec![
        ("invalid-yaml", fx("invalid-yaml.yml"), Some(5)),
        ("version: 0", valid.replacen("version: 1\n", "version: 0\n", 1).into_bytes(), None),
        ("version: \"1\"", valid.replacen("version: 1\n", "version: \"1\"\n", 1).into_bytes(), None),
        ("version: 1.5", valid.replacen("version: 1\n", "version: 1.5\n", 1).into_bytes(), None),
        ("invalid UTF-8", not_utf8, None),
        ("a top-level list", b"- a\n".to_vec(), None),
        ("presets not a list", "version: 1\npresets: Bez štítků\n".as_bytes().to_vec(), None),
    ];
    for (what, bytes, line) in variants {
        let sb = sandbox();
        let root = vault_with(&sb, Some(&bytes));
        let core = open(&root, &sb.dirs);
        let stamp0 = stamp(&root, YML);
        let read = core.graph_presets();
        match (&read.state, line) {
            (PresetsState::Unreadable { line: got, .. }, Some(want)) => assert_eq!(*got, Some(want), "{what}: the parser's line"),
            (PresetsState::Unreadable { .. }, None) => {}
            (other, _) => assert!(false, "{what}: Unreadable, got {other:?}"),
        }
        assert_eq!(read.presets.len(), 0, "{what}: no presets listed");
        assert!(read.version.is_some(), "{what}: the file's version is known (the file exists)");
        for op in [save("Nový", &["tag"], &[]), update("Bez štítků", &[], &[]), rename("Bez štítků", "Jiný"), delete("Bez štítků")] {
            let r = core.graph_presets_apply(read.version.clone(), op.clone());
            assert!(is_preset_err(&r, &PresetError::Unreadable), "{what}: {op:?} is refused with Unreadable, got {r:?}");
        }
        let r = core.graph_presets_apply(None, save("Nový", &[], &[]));
        assert!(matches!(r, Err(CoreError::Preset(PresetError::Unreadable)) | Err(CoreError::Vault(VaultError::Conflict { .. }))), "{what}: a base-less save never replaces it: {r:?}");
        assert_eq!(stamp(&root, YML), stamp0, "{what}: the file keeps its bytes, mtime and inode");
        if what == "invalid-yaml" {
            write_raw(&root, YML, valid.as_bytes());
            reread(&core);
            assert_eq!(names(&core.graph_presets()), strs(&["Bez štítků", "Jen vztahy", "Lidé a schůzky"]), "fixed by another program: the presets are read");
        }
    }
}

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-20

#[test]
fn fr_grp_02_ac20_invalid_entries_are_skipped_and_kept() {
    let sb = sandbox();
    let root = vault_fx(&sb, "entries.yml");
    let core = open(&root, &sb.dirs);
    let entries = fxs("entries.yml");
    let read = core.graph_presets();
    assert_eq!(read.state, PresetsState::Ok, "entries.yml is readable");
    assert_eq!(
        read.presets,
        vec![preset("Lidé", &["page"], &[]), preset("Bez druhů", &["task"], &[]), preset("Neznámé spoje", &[], &["link", "backlink"])],
        "listed: Lidé, Bez druhů (no hidden-kinds = none), Neznámé spoje (`backlink` kept as a raw value)"
    );
    let taken = core.graph_presets_apply(read.version.clone(), save("lidé", &[], &[]));
    assert!(is_preset_err(&taken, &PresetError::NameTaken { existing: nfc("Lidé") }), "saving `lidé` is refused as taken by `Lidé`: {taken:?}");
    let r = ok!(core.graph_presets_apply(read.version.clone(), rename("Lidé", "Lidé 2")), "rename Lidé → Lidé 2");
    let step1 = line_set(&entries, 4, Some("  - name: Lidé 2"));
    assert_eq!(disk_s(&root, YML), Some(step1.clone()), "only line 4 changes");
    let r = ok!(core.graph_presets_apply(r.version.clone(), update("Bez druhů", &["task", "page"], &[])), "update Bez druhů");
    let step2 = lines_insert_after(&line_set(&step1, 25, Some("    hidden-types: [page, task]")), 25, &["    hidden-kinds: []"]);
    assert_eq!(disk_s(&root, YML), Some(step2.clone()), "line 25 rewritten and `    hidden-kinds: []` added after the item's last line");
    ok!(core.graph_presets_apply(r.version.clone(), delete("Neznámé spoje")), "delete Neznámé spoje");
    let step3 = lines_cut(&step2, 27, 29);
    assert_eq!(disk_s(&root, YML), Some(step3.clone()), "only Neznámé spoje's lines removed");
    for kept in ["  - name: lidé\n", "  - name: Default\n", "  - name: \"   \"\n", "  - hidden-types: [task]\n", "  - name: Špatný seznam\n    hidden-types: tag\n", "  - name: 42\n"] {
        assert!(step3.contains(kept), "the skipped entry {kept:?} stays byte for byte");
    }
}

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-21

#[test]
fn fr_grp_02_ac21_newer_and_missing_versions() {
    let sb = sandbox();
    let root = vault_fx(&sb, "newer-version.yml");
    let core = open(&root, &sb.dirs);
    let read = core.graph_presets();
    assert_eq!(read.state, PresetsState::Newer { version: 2 }, "version 2: read-only (AP-923)");
    assert_eq!(read.presets, vec![preset("Bez štítků", &["tag"], &[])], "its presets are listed");
    let stamp0 = stamp(&root, YML);
    for op in [save("Nový", &[], &[]), update("Bez štítků", &[], &[]), rename("Bez štítků", "Jiný"), delete("Bez štítků")] {
        let r = core.graph_presets_apply(read.version.clone(), op.clone());
        assert!(is_preset_err(&r, &PresetError::NewerVersion), "{op:?}: NewerVersion, got {r:?}");
    }
    assert_eq!(stamp(&root, YML), stamp0, "the newer file keeps its bytes, mtime and inode");

    let sb2 = sandbox();
    let no_version = line_set(&fxs("valid.yml"), 2, None);
    let root2 = vault_with(&sb2, Some(no_version.as_bytes()));
    let before = snapshot(&root2);
    let core2 = open(&root2, &sb2.dirs);
    let read2 = core2.graph_presets();
    assert_eq!((read2.state.clone(), read2.presets.clone()), (PresetsState::Ok, valid_presets()), "a missing version reads as 1");
    assert_eq!(changed(&before, &snapshot(&root2)), Vec::<String>::new(), "nothing is written on open");
    ok!(core2.graph_presets_apply(read2.version.clone(), update("Bez štítků", &["kniha"], &[])), "the first update");
    assert_eq!(disk(&root2, YML), Some(fx("expected/valid-after-update.yml")), "adds `version: 1` as line 2 and changes only the updated values");
}

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-22

#[test]
fn fr_syn_03_ac22_graph_yml_writes_check_the_base() {
    let theirs = format!("{}  - name: Cizí\n    hidden-types: [page]\n    hidden-kinds: []\n", fxs("valid.yml"));
    let ops = [save("Moje", &["tag"], &[]), update("Bez štítků", &[], &[]), rename("Jen vztahy", "Vztahy"), delete("Lidé a schůzky")];
    for op in ops {
        let sb = sandbox();
        let root = vault_fx(&sb, "valid.yml");
        let core = open(&root, &sb.dirs);
        let base = core.graph_presets().version;
        assert!(base.is_some(), "{op:?}: the version of the last read");
        write_raw(&root, YML, theirs.as_bytes()); // another program, no event
        let r = core.graph_presets_apply(base.clone(), op.clone());
        assert!(matches!(r, Err(CoreError::Vault(VaultError::Conflict { .. }))), "{op:?} with a stale base: Conflict, got {r:?}");
        assert_eq!(disk_s(&root, YML), Some(theirs.clone()), "{op:?}: the disk bytes stay");
        reread(&core);
        let fresh = core.graph_presets();
        assert_eq!(fresh.presets.last().map(|p| p.name.clone()), Some(nfc("Cizí")), "{op:?}: a re-read lists the other program's preset");
        ok!(core.graph_presets_apply(fresh.version.clone(), op.clone()), "the second attempt on the new version");
        let text = disk_s(&root, YML).unwrap_or_default();
        assert!(text.contains("  - name: Cizí\n"), "{op:?}: the other program's preset stays");
    }
    // The same bytes with a new mtime are not a conflict (D-175).
    let sb = sandbox();
    let root = vault_fx(&sb, "valid.yml");
    let core = open(&root, &sb.dirs);
    let base = core.graph_presets().version;
    std::thread::sleep(Duration::from_millis(20));
    write_raw(&root, YML, &fx("valid.yml"));
    ok!(core.graph_presets_apply(base.clone(), update("Bez štítků", &["kniha"], &[])), "an mtime-only change isn't a conflict");
    assert_eq!(disk(&root, YML), Some(fx("expected/valid-after-update.yml")), "the update is written");
    // A base given while the file is gone: Gone, nothing created.
    let base = core.graph_presets().version;
    std::fs::remove_file(root.join(YML)).expect("setup: delete graph.yml");
    let r = core.graph_presets_apply(base, save("Moje", &[], &[]));
    assert!(matches!(r, Err(CoreError::Vault(VaultError::Gone))), "the file is gone: Gone, got {r:?}");
    assert!(!root.join(YML).exists(), "nothing is created");
}

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-23

#[test]
fn fr_syn_03_ac23_synced_changes_and_conflict_copies() {
    let sb = sandbox();
    let root = vault_fx(&sb, "valid.yml");
    let copy = format!("{}  - name: Z jiného Macu\n    hidden-types: [osoba]\n    hidden-kinds: []\n", fxs("valid.yml"));
    write_raw(&root, COPY_A, copy.as_bytes());
    write_raw(&root, COPY_B, copy.as_bytes());
    let core = open(&root, &sb.dirs);
    let copies0 = (stamp(&root, COPY_A), stamp(&root, COPY_B));
    assert_eq!(names(&core.graph_presets()), strs(&["Bez štítků", "Jen vztahy", "Lidé a schůzky"]), "only .tegg/graph.yml is read (AP-925)");
    // A tour of AC-12…AC-16's writes.
    let r = ok!(apply_fresh(&core, update("Bez štítků", &["kniha"], &[])), "update");
    let r = ok!(core.graph_presets_apply(r.version.clone(), rename("Jen vztahy", "Vztahy")), "rename");
    let r = ok!(core.graph_presets_apply(r.version.clone(), save("Moje", &["tag"], &[])), "save");
    ok!(core.graph_presets_apply(r.version.clone(), delete("Moje")), "delete");
    assert_eq!((stamp(&root, COPY_A), stamp(&root, COPY_B)), copies0, "the conflict copies keep their bytes, mtime and inode");
    // Another device's version arrives as an atomic replace.
    let theirs = format!("{}  - name: Z jiného Macu\n    hidden-types: [osoba]\n    hidden-kinds: []\n", disk_s(&root, YML).unwrap_or_default());
    replace_atomically(&root, YML, theirs.as_bytes());
    reread(&core);
    let read = core.graph_presets();
    assert_eq!(names(&read), strs(&["Bez štítků", "Vztahy", "Lidé a schůzky", "Z jiného Macu"]), "the synced preset is listed");
    let s = ok!(core.graph_presets_apply(read.version.clone(), save("Moje", &[], &["link"])), "save Moje on the synced version");
    assert_eq!(names(&s), strs(&["Bez štítků", "Vztahy", "Lidé a schůzky", "Z jiného Macu", "Moje"]), "all four earlier presets and Moje last");
    assert_eq!((stamp(&root, COPY_A), stamp(&root, COPY_B)), copies0, "still untouched");
    let tegg: Vec<String> = std::fs::read_dir(root.join(".tegg")).expect("setup: .tegg").map(|e| e.expect("entry").file_name().to_string_lossy().into_owned()).collect();
    assert!(tegg.iter().any(|n| n == "graph (conflicted copy 2026-10-28).yml") && tegg.iter().any(|n| n == "graph 2.yml"), "neither copy is renamed or deleted: {tegg:?}");
}

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-24

#[test]
fn fr_syn_03_ac24_first_save_never_replaces_a_new_file() {
    let sb = sandbox();
    let root = vault_with(&sb, None);
    let core = open(&root, &sb.dirs);
    let read = core.graph_presets();
    assert_eq!((read.state.clone(), read.version.clone()), (PresetsState::Missing, None), "no file read (base none)");
    write_raw(&root, YML, &fx("valid.yml")); // another program creates it before Save
    let ino0 = ino(&root, YML);
    let r = core.graph_presets_apply(None, save("Bez štítků", &["tag"], &[]));
    assert!(matches!(r, Err(CoreError::Vault(VaultError::Conflict { .. }))), "Conflict (RENAME_EXCL semantics), got {r:?}");
    assert_eq!((disk(&root, YML), ino(&root, YML)), (Some(fx("valid.yml")), ino0), "the other program's file stays byte for byte (same inode)");
    reread(&core);
    assert_eq!(names(&core.graph_presets()), strs(&["Bez štítků", "Jen vztahy", "Lidé a schůzky"]), "its presets are read");
}

// ------------------------------------------------------------------------------------------------ FR-SYN-02 AC-8

#[test]
fn fr_syn_02_ac8_graph_yml_atomic_writes() {
    let sb = sandbox();
    let root = vault_fx(&sb, "valid.yml");
    let core = open(&root, &sb.dirs);
    let mut inodes = vec![ino(&root, YML)];
    let mut base = core.graph_presets().version;
    for i in 0..6 {
        let t: &[&str] = if i % 2 == 0 { &["kniha"] } else { &["tag", "kniha"] };
        let r = ok!(core.graph_presets_apply(base.clone(), update("Bez štítků", t, &[])), "update");
        base = r.version.clone();
        inodes.push(ino(&root, YML));
    }
    let distinct: std::collections::BTreeSet<_> = inodes.iter().collect();
    assert_eq!(distinct.len(), inodes.len(), "each write renames a new file over the target (a new inode each time): {inodes:?}");
    let leftovers: Vec<String> = std::fs::read_dir(root.join(".tegg"))
        .expect("setup: .tegg")
        .map(|e| e.expect("entry").file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".tegg-tmp"))
        .collect();
    assert_eq!(leftovers, Vec::<String>::new(), "no temp file stays after the writes");
}

const KILL_TEST: &str = "fr_syn_02_ac8_graph_yml_atomic_writes_survive_sigkill";
const KILL_CYCLES: usize = 200;

/// Child mode: alternate `update`s of Bez štítků for at most 20 s until killed; writes `failed` on an error.
fn kill_child(root: &Path, app: &Path, ready: &Path) -> ! {
    let dirs = tegg_core::AppDirs { root: app.to_path_buf() };
    let Ok(core) = Core::open(root, &dirs, tegg_core::CoreOptions { watch: false, sync: None }) else { std::process::exit(3) };
    let _ = core.wait_idle(Duration::from_secs(30));
    let mut base = core.graph_presets().version;
    std::fs::write(ready, b"ready").ok();
    let start = Instant::now();
    let mut i = 0usize;
    while start.elapsed() < Duration::from_secs(20) {
        i += 1;
        let t: Vec<String> = if i % 2 == 0 { strs(&["tag", "kniha"]) } else { strs(&["kniha"]) };
        match core.graph_presets_apply(base.clone(), PresetOp::Update { name: nfc("Bez štítků"), hidden_types: t, hidden_kinds: vec![] }) {
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
fn fr_syn_02_ac8_graph_yml_atomic_writes_survive_sigkill() {
    if let Ok(dir) = std::env::var("TEGG_PRESETS_KILL_CHILD") {
        let dir = std::path::PathBuf::from(dir);
        let ready = std::path::PathBuf::from(std::env::var("TEGG_PRESETS_KILL_READY").expect("setup: ready path"));
        kill_child(&dir.join("vault"), &dir.join("app"), &ready);
    }
    let sb = sandbox();
    let work = sb.base.join("kill");
    let root = work.join("vault");
    std::fs::create_dir_all(&root).expect("setup: vault");
    graph_setup::copy_dir(&repo_root().join("tests/fixtures/vaults/new-empty/.tegg"), &root.join(".tegg"), &[]);
    std::fs::write(root.join(YML), fx("valid.yml")).expect("setup: graph.yml");
    std::fs::create_dir_all(work.join("app")).expect("setup: app dir");
    let old = fx("valid.yml");
    let new = fx("expected/valid-after-update.yml");
    let exe = std::env::current_exe().expect("setup: test binary");
    let mut seed: u64 = 0x6733_2026_1030;
    let mut bad: Vec<String> = Vec::new();
    for cycle in 0..KILL_CYCLES {
        let ready = work.join(format!("ready-{cycle}"));
        let mut child = Command::new(&exe)
            .args(["--exact", KILL_TEST, "--nocapture", "--test-threads=1"])
            .env("TEGG_PRESETS_KILL_CHILD", &work)
            .env("TEGG_PRESETS_KILL_READY", &ready)
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
        std::thread::sleep(Duration::from_micros(seed % 20_000));
        let _ = child.kill();
        let _ = child.wait();
        if let Ok(e) = std::fs::read_to_string(ready.with_extension("failed")) {
            assert!(false, "cycle {cycle}: the writer's update failed: {e}");
        }
        assert!(ready.exists(), "cycle {cycle}: the writer opened the vault and started updating");
        let bytes = std::fs::read(root.join(YML)).unwrap_or_default();
        if bytes != old && bytes != new {
            bad.push(format!("cycle {cycle}: graph.yml is neither the complete old nor the complete new bytes ({} bytes)", bytes.len()));
        }
        if bad.len() > 5 {
            break;
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "SIGKILL never leaves a partial graph.yml");
    let core = open(&root, &sb.dirs);
    assert_eq!(core.graph_presets().presets.len(), 3, "a leftover temp file is never listed as presets");
}

// ------------------------------------------------------------------------------------------------ FR-FMT-07 AC-27

#[test]
fn fr_fmt_07_ac27_graph_yml_minimal_patches() {
    let cases: [(PresetOp, &str); 4] = [
        (rename("Bez štítků", "Bez tagů"), "expected/unknown-keys-after-rename.yml"),
        (update("Lidé: schůzky", &["page", "task", "quick-note", "tag"], &["embed", "tag"]), "expected/unknown-keys-after-update.yml"),
        (delete("Lidé: schůzky"), "expected/unknown-keys-after-delete.yml"),
        (save("Jen vztahy", &[], &["link", "embed", "tag"]), "expected/unknown-keys-after-save.yml"),
    ];
    for (op, want) in cases {
        for eol in ["LF", "CRLF"] {
            let sb = sandbox();
            let input = if eol == "LF" { fxs("unknown-keys.yml") } else { crlf(&fxs("unknown-keys.yml")) };
            let root = vault_with(&sb, Some(input.as_bytes()));
            let core = open(&root, &sb.dirs);
            let read = core.graph_presets();
            assert_eq!(names(&read), strs(&["Lidé: schůzky", "Bez štítků"]), "{eol}: unknown-keys lists Lidé: schůzky, Bez štítků");
            let stamp0 = stamp(&root, YML);
            let _ = core.graph_presets();
            assert_eq!(stamp(&root, YML), stamp0, "{eol}: reading changes no byte");
            ok!(core.graph_presets_apply(read.version.clone(), op.clone()), format!("{eol} {op:?}"));
            let expect = if eol == "LF" { fxs(want) } else { crlf(&fxs(want)) };
            assert_eq!(disk_s(&root, YML), Some(expect), "{eol}: {op:?} gives exactly {want}");
        }
    }
    // valid.yml in CRLF and without its final newline.
    for (what, input, expect) in [
        ("CRLF", crlf(&fxs("valid.yml")), crlf(&fxs("expected/valid-after-update.yml"))),
        ("no final newline", fxs("valid.yml").trim_end_matches('\n').to_string(), fxs("expected/valid-after-update.yml").trim_end_matches('\n').to_string()),
    ] {
        let sb = sandbox();
        let root = vault_with(&sb, Some(input.as_bytes()));
        let core = open(&root, &sb.dirs);
        ok!(apply_fresh(&core, update("Bez štítků", &["kniha"], &[])), format!("{what}: update"));
        assert_eq!(disk_s(&root, YML), Some(expect), "{what}: the line endings and the missing final newline stay");
    }
    let sb = sandbox();
    let root = vault_with(&sb, Some(fxs("valid.yml").trim_end_matches('\n').as_bytes()));
    let core = open(&root, &sb.dirs);
    ok!(apply_fresh(&core, save("Nová", &[], &["tag"])), "no final newline: save");
    let text = disk_s(&root, YML).unwrap_or_default();
    assert!(text.ends_with("    hidden-kinds: []\n  - name: Nová\n    hidden-types: []\n    hidden-kinds: [tag]"), "a save keeps the missing final newline missing: {text:?}");
}

// ------------------------------------------------------------------------------------------------ FR-FMT-12 AC-7

#[test]
fn fr_fmt_12_ac7_preset_names_are_nfc() {
    let sb = sandbox();
    let input = nfd_names(&fxs("valid.yml"));
    assert_ne!(input, fxs("valid.yml"), "setup: the NFD copy differs");
    let root = vault_with(&sb, Some(input.as_bytes()));
    let core = open(&root, &sb.dirs);
    let read = core.graph_presets();
    assert_eq!(names(&read), strs(&["Bez štítků", "Jen vztahy", "Lidé a schůzky"]), "names are listed in NFC");
    assert!(read.presets.iter().all(|p| p.name == nfc(&p.name)), "every listed name is NFC");
    for typed in [nfc("Bez štítků"), nfd("Bez štítků")] {
        let r = core.graph_presets_apply(read.version.clone(), save(&typed, &[], &[]));
        assert!(is_preset_err(&r, &PresetError::NameTaken { existing: nfc("Bez štítků") }), "saving {typed:?} is refused as taken: {r:?}");
    }
    ok!(core.graph_presets_apply(read.version.clone(), rename(&nfd("Lidé a schůzky"), &nfd("Lidé a porady"))), "rename the NFD Lidé a schůzky");
    let want = line_set(&input, 10, Some(&nfc("  - name: Lidé a porady")));
    assert_eq!(disk_s(&root, YML), Some(want), "that line is written in NFC; the other NFD names keep their bytes");
}

// ------------------------------------------------------------------------------------------------ NFR-POR-01 AC-3

/// The presets as the `yaml` npm package (YAML 1.2) reads `bytes`: `[name, hidden-types, hidden-kinds]` per item.
fn yaml_npm(bytes: &[u8], sb: &Sandbox) -> Option<Vec<(String, Vec<String>, Vec<String>)>> {
    let f = sb.base.join(format!("y-{}.yml", bytes.len()));
    std::fs::write(&f, bytes).ok()?;
    let script = "import YAML from 'yaml'; import { readFileSync } from 'node:fs'; \
        const d = YAML.parse(readFileSync(process.argv[1], 'utf8')); \
        console.log(JSON.stringify((d.presets ?? []).map((p) => [String(p.name).normalize('NFC'), p['hidden-types'] ?? [], p['hidden-kinds'] ?? []])));";
    let out = Command::new("node").current_dir(repo_root().join("app")).args(["--input-type=module", "-e", script]).arg(&f).output().ok()?;
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).ok()?;
    let list = |x: &serde_json::Value| x.as_array().map(|a| a.iter().map(|s| nfc(s.as_str().unwrap_or("<not a string>"))).collect()).unwrap_or_default();
    Some(v.as_array()?.iter().map(|it| (nfc(it[0].as_str().unwrap_or("")), list(&it[1]), list(&it[2]))).collect())
}

#[test]
fn nfr_por_01_ac3_graph_yml_is_standard_yaml() {
    let sb = sandbox();
    let root = vault_with(&sb, None);
    let core = open(&root, &sb.dirs);
    let before = snapshot(&root);
    let mut r = ok!(core.graph_presets_apply(None, save("Bez štítků", &["tag"], &[])), "the first save");
    let tricky = ["Lidé: #1", "123", "true", "- pomlčka", "\"uvozovky\"", "Ano #ne", "'apostrof'", "[seznam]", "null", "Klíč: hodnota"];
    for (i, name) in tricky.iter().enumerate() {
        let t: &[&str] = if i % 2 == 0 { &["recept", "osoba"] } else { &[] };
        r = ok!(core.graph_presets_apply(r.version.clone(), save(name, t, &["embed"])), format!("save {name:?}"));
    }
    r = ok!(core.graph_presets_apply(r.version.clone(), rename("123", "Nová: 2")), "rename");
    r = ok!(core.graph_presets_apply(r.version.clone(), update("true", &["page", "kniha"], &["link"])), "update");
    ok!(core.graph_presets_apply(r.version.clone(), delete("null")), "delete");
    let bytes = disk(&root, YML).unwrap_or_default();
    let ours: Vec<(String, Vec<String>, Vec<String>)> = core.graph_presets().presets.into_iter().map(|p| (p.name, p.hidden_types, p.hidden_kinds)).collect();
    assert_eq!(ours.len(), 10, "Tegg lists every saved preset (11 saved, one deleted)");
    assert_eq!(yaml_npm(&bytes, &sb), Some(ours), "the `yaml` npm package reads the same presets Tegg lists");
    for fixture in ["expected/created.yml", "expected/valid-after-update.yml", "expected/unknown-keys-after-save.yml"] {
        assert!(yaml_npm(&fx(fixture), &sb).is_some_and(|l| !l.is_empty()), "{fixture} is standard YAML");
    }
    let diff = changed(&before, &snapshot(&root));
    assert_eq!(diff, yml_only(), "no G3 action writes outside .tegg/graph.yml (no note, no .obsidian/)");
}

// ------------------------------------------------------------------------------------------------ FR-STO-06 AC-1

fn contains_bytes(hay: &[u8], needle: &[u8]) -> bool {
    hay.windows(needle.len()).any(|w| w == needle)
}
fn files_under(dir: &Path) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                out.extend(files_under(&p));
            } else {
                out.push(p);
            }
        }
    }
    out
}

#[test]
fn fr_sto_06_ac1_presets_are_a_vault_file_only() {
    let sb = sandbox();
    let root = vault_fx(&sb, "valid.yml");
    let core = open(&root, &sb.dirs);
    assert_eq!(core.graph_presets().presets, valid_presets(), "the presets of the vault");
    drop(core);
    // A copy of the vault folder in a second, empty Application Support.
    let copy = sb.base.join("Kopie");
    graph_setup::copy_dir(&root, &copy, &[]);
    let other = fresh_dirs(&sb, "Jiný Mac");
    let c2 = open(&copy, &other);
    assert_eq!(c2.graph_presets().presets, valid_presets(), "a copy opened elsewhere lists the same three presets");
    drop(c2);
    // Without the index.
    for p in files_under(&sb.dirs.root) {
        let _ = std::fs::remove_file(p);
    }
    let c3 = open(&root, &sb.dirs);
    assert_eq!(c3.graph_presets().presets, valid_presets(), "after deleting the index the same presets");
    let db: Vec<_> = files_under(&sb.dirs.root).into_iter().chain(files_under(&other.root)).collect();
    assert!(!db.is_empty(), "setup: the index exists");
    let hits: Vec<String> = db.iter().filter(|p| std::fs::read(p).is_ok_and(|b| contains_bytes(&b, "Jen vztahy".as_bytes()))).map(|p| p.display().to_string()).collect();
    assert_eq!(hits, Vec::<String>::new(), "no preset name in the index or any machine-local file (AR-01)");
    // AR-03: the module is platform-neutral.
    let src = std::fs::read_to_string(repo_root().join("crates/tegg-core/src/graph_presets.rs")).unwrap_or_default();
    assert!(!src.is_empty(), "crates/tegg-core/src/graph_presets.rs exists");
    for bad in ["tauri::", "use tauri", "objc::", "cocoa::", "core_foundation::", "std::process::", "notify::"] {
        assert!(!src.contains(bad), "graph_presets.rs doesn't use {bad} (AR-03)");
    }
}
