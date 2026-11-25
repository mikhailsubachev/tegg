//! Slice AND-3, L4 (Mac host, temporary copies): docs/acceptance/android-edit.md, the host parts of the phone's writes
//! (docs/contracts/android-edit.md §2.4, §3; RA17), each on a core opened with the Android shell's extras
//! (`OpenExtras { bulk_jobs: false }`):
//! - FR-SYN-03 AC-42 (T1): a write of an existing file whose bytes changed on disk without an event (other bytes between
//!   the read and the write) is refused with `Conflict` and writes nothing: `write_note` (rows 1…5, 11), `trash_object`
//!   (row 15) and `trash_note` (row 13); the file keeps the external bytes;
//! - FR-SYN-03 AC-44 (T1, T2): (a) `daily_create` while another device's `Daily/2026-10-14.md` (another `id`) exists
//!   writes `Daily/2026-10-14 (2).md` and keeps the other file's bytes; (b) after the phone's `Quick Notes/Lisabon.md`,
//!   another device's `Pages/Lisabon.md` arrives: nothing is renamed or rewritten, and `[[Lisabon]]` resolves as the
//!   desktop's core resolves it on the same files;
//! - FR-FMT-08 AC-11 (T2): names of objects made on the phone (`create_object`, the `note_create` path): the sanitised stem (`Q3: plán? #1` →
//!   `Q3 plán 1.md`, `title:` unchanged), a 250-byte Czech title cut at a character boundary to ≤ 200 bytes, a stem used
//!   anywhere in the vault (NFC, case-insensitive) gets ` (2)`, NFC names;
//! - FR-EDT-07 AC-26 (L4 for the base check) and FR-SYN-04 AC-14 (L4 for the vault result: keeping Plán.md trashes the
//!   copy; `[[Plán]]` resolves to Plán.md, id …K001; the pair leaves the conflicts);
//! - FR-SYN-06 AC-57 (T1): editing and saving Kniha jinde (`type-moves/`, a `kniha` outside `Knihy/`) leaves it at its
//!   path.
//! Red-test reading (reported): these are the desktop's write paths, which the phone reuses unchanged (§2.4); where they
//! already hold, the file is committed apart from the red tests for the owner's Red-First-Exempt decision (D-1044's
//! precedent).
//! Written from the ACs and the contract only (D-61).

mod common;

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use common::{repo_root, sandbox, snapshot};
use tegg_core::{Core, CoreError, CoreOptions, OpenExtras, VaultError};

fn copy_tree(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).expect("setup: mkdir");
    for e in std::fs::read_dir(from).expect("setup: read fixture") {
        let e = e.expect("setup: entry");
        let t = to.join(e.file_name());
        if e.file_type().expect("setup: type").is_dir() {
            copy_tree(&e.path(), &t);
        } else if e.file_name() != "README.md" {
            std::fs::copy(e.path(), &t).expect("setup: copy");
        }
    }
}
/// `fixtures` (repo-relative under tests/fixtures/vaults; a name starting with `.` goes under that name) copied into
/// `<sandbox>/<name>`.
fn vault(base: &Path, name: &str, fixtures: &[&str]) -> PathBuf {
    let root = base.join(name);
    for f in fixtures {
        let src = repo_root().join("tests/fixtures/vaults").join(f);
        let leaf = Path::new(f).file_name().and_then(|s| s.to_str()).unwrap_or("");
        copy_tree(&src, &if leaf.starts_with('.') { root.join(leaf) } else { root.clone() });
    }
    root
}
fn android(root: &Path, sb: &common::Sandbox) -> Core {
    let core = match Core::open_ext(root, &sb.dirs, CoreOptions { watch: false, sync: None }, OpenExtras { bulk_jobs: false }) {
        Ok(c) => c,
        Err(e) => panic!("setup: Core::open_ext: {e:?}"),
    };
    let _ = core.wait_idle(Duration::from_secs(30));
    core
}
fn is_conflict<T: std::fmt::Debug>(r: &Result<T, CoreError>) -> bool {
    matches!(r, Err(CoreError::Vault(VaultError::Conflict { .. })))
}

#[test]
fn fr_syn_03_ac42_every_phone_write_checks_its_base() {
    let sb = sandbox();
    let root = vault(&sb.base, "Editor", &["editor", "new-empty/.tegg", "phone-edit"]);
    let core = android(&root, &sb);
    for path in ["Pages/Psaní.md", "Pages/Úkoly.md", "Pages/Cíl.md"] {
        let (bytes, base) = match core.read_note(path, SystemTime::now()) {
            Ok(r) => r,
            Err(e) => panic!("setup: read {path}: {e:?}"),
        };
        let external = format!("{}Řádek z jiného zařízení.\n", String::from_utf8_lossy(&bytes));
        std::fs::write(root.join(path), &external).expect("setup: the other device's bytes");
        let mine = format!("{}Můj řádek.\n", String::from_utf8_lossy(&bytes));
        let w = core.write_note(path, mine.as_bytes(), Some(&base));
        assert!(is_conflict(&w), "{path}: write_note with the old base is refused with Conflict: {w:?}");
        assert_eq!(std::fs::read_to_string(root.join(path)).ok().as_deref(), Some(external.as_str()), "{path}: the file keeps the external bytes");
        let t = core.trash_object(path, &base);
        assert!(is_conflict(&t), "{path}: trash_object (Move to trash, row 15) with the old base is refused with Conflict: {t:?}");
        let t2 = core.trash_note(path, &base);
        assert!(is_conflict(&t2), "{path}: trash_note (a conflict pair, row 13) with the old base is refused with Conflict: {t2:?}");
        assert!(root.join(path).exists(), "{path}: nothing moved");
        assert!(!root.join(".trash").join(path).exists(), "{path}: nothing in .trash/");
    }
}

#[test]
fn fr_syn_03_ac44_new_files_on_a_partly_synced_vault() {
    // (a) the other device's Daily Note arrived before the phone's first write
    let sb = sandbox();
    let root = vault(&sb.base, "Editor", &["editor", "new-empty/.tegg", "phone-edit"]);
    let theirs = "---\nid: 01JBAN3000000000000000D901\ntype: daily-note\ntitle: 2026-10-14\ndate: 2026-10-14\ncreated: 2026-10-14T08:00:00+02:00\nmodified: 2026-10-14T08:00:00+02:00\n---\nZ Macu.\n";
    std::fs::create_dir_all(root.join("Daily")).expect("setup: Daily");
    std::fs::write(root.join("Daily/2026-10-14.md"), theirs).expect("setup: the pushed Daily Note");
    let core = android(&root, &sb);
    let date = chrono::NaiveDate::from_ymd_opt(2026, 10, 14).expect("date");
    let mine = "---\nid: 01JBAN3000000000000000D902\ntype: daily-note\ntitle: 2026-10-14\ndate: 2026-10-14\ncreated: 2026-10-14T12:00:00+02:00\nmodified: 2026-10-14T12:00:00+02:00\n---\nDnes\n";
    let made = core.daily_create(date, mine.as_bytes());
    assert!(made.is_ok(), "daily_create: {:?}", made.as_ref().err());
    assert_eq!(made.as_ref().map(|d| d.path.clone()).unwrap_or_default(), "Daily/2026-10-14 (2).md", "the phone's note is Daily/2026-10-14 (2).md");
    assert_eq!(std::fs::read_to_string(root.join("Daily/2026-10-14.md")).ok().as_deref(), Some(theirs), "the pushed file keeps its bytes");
    drop(core);

    // (b) a [[ create, then another device's Pages/Lisabon.md
    let sb2 = sandbox();
    let root2 = vault(&sb2.base, "Editor", &["editor", "new-empty/.tegg", "phone-edit"]);
    let core2 = android(&root2, &sb2);
    let quick = "---\nid: 01JBAN3000000000000000L001\ntype: quick-note\ntitle: Lisabon\ncreated: 2026-10-14T12:00:00+02:00\nmodified: 2026-10-14T12:00:00+02:00\n---\n";
    let created = core2.create_object("quick-note", "Lisabon", quick.as_bytes());
    assert_eq!(created.as_ref().ok().map(String::as_str), Some("Quick Notes/Lisabon.md"), "the [[Lisabon create writes Quick Notes/Lisabon.md: {created:?}");
    drop(core2);
    let page = "---\nid: 01JBAN3000000000000000L002\ntype: page\ntitle: Lisabon\ncreated: 2026-10-13T09:00:00+02:00\nmodified: 2026-10-13T09:00:00+02:00\n---\nZ Macu.\n";
    std::fs::write(root2.join("Pages/Lisabon.md"), page).expect("setup: the other device's Pages/Lisabon.md");
    let before = snapshot(&root2);
    let phone = android(&root2, &sb2);
    let on_phone = phone.resolve_link("Lisabon");
    drop(phone);
    let desk = match Core::open(&root2, &common::fresh_dirs(&sb2, "Mac"), CoreOptions { watch: false, sync: None }) {
        Ok(c) => c,
        Err(e) => panic!("setup: desktop Core::open: {e:?}"),
    };
    let _ = desk.wait_idle(Duration::from_secs(30));
    assert_eq!(on_phone, desk.resolve_link("Lisabon"), "[[Lisabon]] resolves on the phone as the desktop resolves it on the same files");
    assert!(on_phone.is_some(), "[[Lisabon]] resolves to one of the two files");
    drop(desk);
    assert_eq!(snapshot(&root2), before, "no file is renamed, merged or rewritten");
}

#[test]
fn fr_fmt_08_ac11_names_of_objects_made_on_the_phone() {
    let sb = sandbox();
    let root = vault(&sb.base, "Editor", &["editor", "new-empty/.tegg", "phone-edit"]);
    let core = android(&root, &sb);
    let fm = |title: &str| format!("---\nid: 01JBAN3000000000000000F{:03}\ntype: quick-note\ntitle: \"{}\"\ncreated: 2026-10-14T12:00:00+02:00\nmodified: 2026-10-14T12:00:00+02:00\n---\n", title.len() % 1000, title.replace('"', "\\\""));
    let p = core.create_object("quick-note", "Q3: plán? #1", fm("Q3: plán? #1").as_bytes());
    assert_eq!(p.as_ref().ok().map(String::as_str), Some("Quick Notes/Q3 plán 1.md"), "the sanitised stem: {p:?}");
    let text = std::fs::read_to_string(root.join("Quick Notes/Q3 plán 1.md")).unwrap_or_default();
    assert!(text.contains("title: \"Q3: plán? #1\""), "the full title in title: {text}");

    let mut long = String::new();
    for ch in "Žluťoučký kůň úpěl ďábelské ódy ".repeat(10).chars() {
        if long.len() >= 250 {
            break;
        }
        long.push(ch);
    }
    let long = long.trim().to_string();
    assert!(long.len() >= 245 && long.len() <= 252, "setup: a Czech title of about 250 UTF-8 bytes ({})", long.len());
    let p = core.create_object("quick-note", &long, fm(&long).as_bytes());
    let path = p.as_ref().ok().cloned().unwrap_or_default();
    let stem = path.trim_start_matches("Quick Notes/").trim_end_matches(".md");
    assert!(!stem.is_empty() && stem.len() <= 200, "the stem is at most 200 bytes ({}): {p:?}", stem.len());
    assert!(long.starts_with(stem.trim_end()), "cut at a character boundary from the title's start: {stem:?}");

    let p = core.create_object("quick-note", "cíl", fm("cíl").as_bytes());
    assert_eq!(p.as_ref().ok().map(String::as_str), Some("Quick Notes/cíl (2).md"), "a stem used anywhere in the vault (Pages/Cíl.md, NFC, case-insensitive) gets (2): {p:?}");
    let nfd_title = "Pi\u{301}sen\u{30c}";
    let p = core.create_object("quick-note", nfd_title, fm(nfd_title).as_bytes());
    let path = p.as_ref().ok().cloned().unwrap_or_default();
    assert_eq!(path.as_bytes(), "Quick Notes/Píseň.md".as_bytes(), "names are NFC: {p:?}");
}

#[test]
fn fr_syn_06_ac57_still_no_bulk_job_or_move_on_the_phone() {
    let sb = sandbox();
    let root = vault(&sb.base, "Knihovna", &["type-moves", "new-empty/.tegg"]);
    let core = android(&root, &sb);
    let path = "Pages/Kniha jinde.md";
    let (bytes, base) = match core.read_note(path, SystemTime::now()) {
        Ok(r) => r,
        Err(e) => panic!("setup: read: {e:?}"),
    };
    let edited = format!("{}Doplněno na telefonu.\n", String::from_utf8_lossy(&bytes));
    let w = core.write_note(path, edited.as_bytes(), Some(&base));
    assert!(w.is_ok(), "the edit saves: {w:?}");
    let _ = core.wait_idle(Duration::from_secs(10));
    assert_eq!(std::fs::read_to_string(root.join(path)).ok().as_deref(), Some(edited.as_str()), "Kniha jinde is saved at its path");
    assert!(!root.join("Knihy/Kniha jinde.md").exists(), "and not moved to Knihy/");
}

/// FR-EDT-07 AC-26 (L4 for the base check): a property value written on a base the file no longer has is refused with
/// `Conflict`, and the external bytes stay (the merge banner keeps the value, D-2528).
#[test]
fn fr_edt_07_ac26_property_write_checks_its_base() {
    let sb = sandbox();
    let root = vault(&sb.base, "Typy", &["types", "new-empty/.tegg"]);
    let core = android(&root, &sb);
    let path = "Schůzky/2026-10-07 Porada.md";
    let (bytes, base) = match core.read_note(path, SystemTime::now()) {
        Ok(r) => r,
        Err(e) => panic!("setup: read: {e:?}"),
    };
    let text = String::from_utf8_lossy(&bytes).into_owned();
    let external = text.replace("nálada: dobrá", "nálada: skvělá");
    std::fs::write(root.join(path), &external).expect("setup: the other device's bytes");
    let mine = text.replace("místo:\n", "místo: Sál C\n");
    assert_ne!(mine, text, "setup: Porada has an empty místo entry");
    let w = core.write_note(path, mine.as_bytes(), Some(&base));
    assert!(is_conflict(&w), "the property write on the old base is refused with Conflict: {w:?}");
    assert_eq!(std::fs::read_to_string(root.join(path)).ok().as_deref(), Some(external.as_str()), "the file keeps the external bytes");
}

/// FR-SYN-04 AC-14 (L4 for the vault result): keeping `Pages/Plán.md` trashes the copy only; afterwards `[[Plán]]`
/// resolves to `Pages/Plán.md` with id `01JB0K0000000000000000K001` and the pair leaves the conflicts.
#[test]
fn fr_syn_04_ac14_keep_one_vault_result() {
    let sb = sandbox();
    let root = vault(&sb.base, "Konflikty", &["conflicts", "new-empty/.tegg"]);
    let core = android(&root, &sb);
    let copy = "Pages/Plán (conflicted copy 2026-10-07).md";
    let (_, v) = match core.read_note(copy, SystemTime::now()) {
        Ok(r) => r,
        Err(e) => panic!("setup: read the copy: {e:?}"),
    };
    let t = core.trash_note(copy, &v);
    assert!(t.is_ok(), "note_trash on the copy: {t:?}");
    let _ = core.wait_idle(Duration::from_secs(10));
    assert!(!root.join(copy).exists(), "the copy left Pages/");
    assert_eq!(core.resolve_link("Plán").as_deref(), Some("Pages/Plán.md"), "[[Plán]] resolves to Pages/Plán.md");
    let plan = std::fs::read_to_string(root.join("Pages/Plán.md")).unwrap_or_default();
    assert!(plan.contains("id: 01JB0K0000000000000000K001"), "with id …K001");
    let pair = core.conflicts().into_iter().filter(|c| c.primary == "Pages/Plán.md" || c.others.iter().any(|o| o == "Pages/Plán.md")).count();
    assert_eq!(pair, 0, "the pair leaves the conflicts");
}
