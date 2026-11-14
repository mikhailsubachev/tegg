//! Slice REL L4 tests of the core on a temporary copy of tests/fixtures/vaults/related (+ new-empty/.tegg)
//! (docs/acceptance/related.md; docs/contracts/v1-related.md §1.5, §1.10, §1.11, §7): FR-LNK-15 AC-7 (the index dir
//! deleted, reopened), AC-9 (the schema version one lower: one rebuild, no second one), AC-10, AC-16, AC-17 (runtime
//! changes through the watcher within 2 s), AC-19 (one read with the chip fields, no recency, no write), AC-29 (the
//! computed-lists counter after 60 s idle), AC-34 (a fresh Application Support), FR-FMT-07 AC-31 (indexing and ranking
//! write nothing) and FR-FMT-12 AC-11 (an NFD rename through the watcher). Expected lists come from the fixture README.
//! Written from the ACs and the contract only (D-61); every check is an assertion in this file (tools/qa CONTRACT §5.2).

mod common;
mod related_setup;

use std::collections::BTreeSet;
use std::time::{Duration, SystemTime};

use common::{fresh_dirs, sandbox, snapshot, wait_until, write_raw, CountingFs};
use related_setup::*;
use tegg_core::{Core, CoreEvent, ProgressState, RelatedList};

fn rel(core: &Core, path: &str, shown: bool) -> RelatedList {
    match core.related(&nfc(path), shown) {
        Ok(l) => l,
        Err(e) => {
            assert!(false, "index_related({path}, {shown}) answered {e:?}");
            unreachable!()
        }
    }
}
fn paths(l: &RelatedList) -> Vec<String> {
    l.entries.iter().map(|e| nfc(&e.path)).collect()
}
fn set(v: &[&str]) -> BTreeSet<String> {
    v.iter().map(|s| nfc(s)).collect()
}
/// Every object's answer, linked hidden and shown, as a comparable string (paths, order, excerpts, chip fields,
/// `linked`, `reason`; scores to 1e-9).
fn all_answers(core: &Core) -> Vec<String> {
    let mut out = Vec::new();
    for p in objects() {
        for shown in [false, true] {
            let l = rel(core, &p, shown);
            let es: Vec<String> = l
                .entries
                .iter()
                .map(|e| {
                    format!(
                        "{}|{}|{}|{:?}|{:?}|{:?}|{:?}|{}|{:?}|{:.9}|{}",
                        nfc(&e.path), e.title, e.r#type, e.review, e.status, e.due, e.completed, e.linked, e.excerpt, e.score, e.shared
                    )
                })
                .collect();
            out.push(format!("{p} {shown} {:?} {}", l.reason, es.join(" ; ")));
        }
    }
    out
}
fn wait_paths(core: &Core, path: &str, want: &BTreeSet<String>) -> BTreeSet<String> {
    let mut got = BTreeSet::new();
    let _ = wait_until(Duration::from_secs(2), || {
        got = core.related(&nfc(path), false).map(|l| paths(&l).into_iter().collect()).unwrap_or_default();
        &got == want
    });
    got
}

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-7

#[test]
fn fr_lnk_15_ac7_stem_table_rebuilt_from_files() {
    let sb = sandbox();
    let root = related_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    assert_eq!(paths(&rel(&core, ROZPOCET, false)), vec![nfc(DEN), nfc(UKOL)], "positive control: Rozpočet → [Den 30. 9., Úkol]");
    let mut missing = Vec::new();
    for p in objects() {
        if core.rel_terms(&p).is_none() {
            missing.push(p);
        }
    }
    assert_eq!((objects().len(), missing), (39, Vec::<String>::new()), "rel has one row per object outside _templates/ and .trash/");
    assert!(core.rel_terms(&nfc(SABLONA)).is_none() && core.rel_terms(&nfc(STARY)).is_none(), "the template and the trashed note have no rel row");
    let db = index_db(&core);
    let tables_before = sqlite(&db, "SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name").unwrap_or_default();
    let before = all_answers(&core);
    let tables_after = sqlite(&db, "SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name").unwrap_or_default();
    assert_eq!(tables_after, tables_before, "asking for every list creates no table");
    assert!(!tables_after.to_lowercase().contains("related"), "no table stores a Related list: {tables_after}");
    let local = core.vault().local_dir();
    drop(core);
    assert!(std::fs::remove_dir_all(&local).is_ok(), "the index dir is deleted");
    let core = open(&root, &sb.dirs, false);
    assert_eq!(all_answers(&core), before, "every answer is the same after the rebuild (AR-01)");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-9

fn progress_runs(rx: &std::sync::mpsc::Receiver<CoreEvent>) -> usize {
    let mut done = 0;
    while let Ok(e) = rx.recv_timeout(Duration::from_millis(300)) {
        if let CoreEvent::IndexProgress { state: ProgressState::Done, .. } = e {
            done += 1;
        }
    }
    done
}

#[test]
fn fr_lnk_15_ac9_index_version_rebuild_and_crash_safety() {
    let sb = sandbox();
    let root = related_vault(&sb);
    // D-1748: the first open goes through `open_with` too, so the version is lowered in the same `index.sqlite`
    // that the counting core reopens below (`open_with` keys its local folder on the fs identity, not the path).
    let core = open_with(CountingFs::new(local_fs(&root)), &sb.dirs);
    let db = index_db(&core);
    drop(core);
    let v = sqlite(&db, "PRAGMA user_version").unwrap_or_default().parse::<i64>().unwrap_or(0);
    assert!(v >= 7, "the index's schema version is at least 7 (contract §1.5): {v}");
    assert!(sqlite(&db, "PRAGMA user_version = 6").is_ok(), "setup: the version is set to 6 (before Related)");
    let before = snapshot(&root);
    let counting = CountingFs::new(local_fs(&root));
    let core = open_with(counting.clone(), &sb.dirs);
    assert_eq!(index_db(&core), db, "setup: the counting core reopens the database whose version was lowered");
    let rx = core.events();
    assert_eq!(progress_runs(&rx), 1, "one index:progress run to done");
    let notes = objects().len();
    assert!(counting.read_paths().iter().filter(|p| p.ends_with(".md")).count() >= notes, "the older index is rebuilt (every note read)");
    assert_eq!(sqlite(&db, "PRAGMA user_version").unwrap_or_default(), v.to_string(), "the rebuilt index has the current version");
    assert_eq!(paths(&rel(&core, SOUHVEZDI, false)).len(), 10, "Souhvězdí's list after the rebuild");
    assert_eq!(counting.write_count(), 0, "the rebuild writes nothing in the vault");
    drop(core);
    assert_eq!(snapshot(&root), before, "every vault file is untouched");
    let counting = CountingFs::new(local_fs(&root));
    let core = open_with(counting.clone(), &sb.dirs);
    let reads = counting.read_paths().iter().filter(|p| p.ends_with(".md")).count();
    assert!(reads < notes, "the next open doesn't rebuild ({reads} notes read)");
    assert_eq!(paths(&rel(&core, SOUHVEZDI, false)).len(), 10, "Souhvězdí's list on the next open");
}

// ------------------------------------------------------------------------------------------------ AC-10, AC-16, AC-17 (watcher)

#[test]
fn fr_lnk_15_ac10_candidates_by_type_and_folder_through_the_watcher() {
    let sb = sandbox();
    let root = related_vault(&sb);
    let core = open(&root, &sb.dirs, true);
    assert_eq!(paths(&rel(&core, VCELSTVO, false)), vec![nfc(PROHLIDKA)], "Včelstvo → [Prohlídka]");
    let orig = fixture_text(PROHLIDKA);
    write_raw(&root, PROHLIDKA, orig.replacen("type: page", "type: tag", 1).as_bytes());
    assert_eq!(wait_paths(&core, VCELSTVO, &BTreeSet::new()), BTreeSet::new(), "Prohlídka changed to a tag: Včelstvo's list is empty within 2 s");
    write_raw(&root, PROHLIDKA, orig.as_bytes());
    assert_eq!(wait_paths(&core, VCELSTVO, &set(&[PROHLIDKA])), set(&[PROHLIDKA]), "restored");
    assert!(std::fs::rename(root.join(STARY), root.join(STARY_RESTORED)).is_ok(), "setup: move Starý úl out of the trash");
    let want = set(&[PROHLIDKA, STARY_RESTORED]);
    assert_eq!(wait_paths(&core, VCELSTVO, &want), want, "Starý úl moved to Pages/: {{Prohlídka, Starý úl}} within 2 s");
}

#[test]
fn fr_lnk_15_ac16_unaccented_twin_is_equivalent_through_the_watcher() {
    let sb = sandbox();
    let root = related_vault(&sb);
    let core = open(&root, &sb.dirs, true);
    let lists = |c: &Core| [TERMINY_A, TERMINY_B, SKOLENI].map(|p| paths(&rel(c, p, false)));
    let before = lists(&core);
    assert_eq!(before[2], vec![nfc(TERMINY_B), nfc(TERMINY_A)], "Školení → [Terminy, Termíny] (root collation, CP-2)");
    let a = core.related_signature(&nfc(TERMINY_A)).unwrap_or_default();
    let b = core.related_signature(&nfc(TERMINY_B)).unwrap_or_default();
    assert!(!a.is_empty() && a.len() == b.len() && a.iter().zip(&b).all(|(x, y)| x.0 == y.0 && (x.1 - y.1).abs() <= 1e-9), "the twins' signatures are equal");
    write_raw(&root, TERMINY_A, nfd(&fixture_text(TERMINY_A)).as_bytes());
    std::thread::sleep(Duration::from_secs(2));
    assert!(core.wait_idle(Duration::from_secs(5)), "idle after the NFD rewrite");
    assert_eq!(lists(&core), before, "Termíny rewritten in NFD: all three lists are the same within 2 s");
}

#[test]
fn fr_lnk_15_ac17_tag_names_are_words_without_bonus_through_the_watcher() {
    let sb = sandbox();
    let root = related_vault(&sb);
    let core = open(&root, &sb.dirs, true);
    assert_eq!(paths(&rel(&core, SVATBA, false)), Vec::<String>::new(), "Svatba has no list");
    let text = fixture_text(SVATBA).replacen("title: Svatba Petra a Lucie\n", "title: Svatba Petra a Lucie\ntags: [kniha, praha, matka]\n", 1);
    write_raw(&root, SVATBA, text.as_bytes());
    let want = set(&[KNIHA, POZNAMKY]);
    assert_eq!(wait_paths(&core, SVATBA, &want), want, "Svatba with tags [kniha, praha, matka]: {{Kniha, Poznamky}} within 2 s");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-19

#[test]
fn fr_lnk_15_ac19_one_read_with_chip_fields() {
    let sb = sandbox();
    let root = related_vault(&sb);
    let counting = CountingFs::new(local_fs(&root));
    let core = open_with(counting.clone(), &sb.dirs);
    core.record_open(&nfc(KNIHA), SystemTime::now());
    let last = core.last_opened();
    let state = local_state(&core);
    let r = rel(&core, ROZPOCET, false);
    assert_eq!(paths(&r), vec![nfc(DEN), nfc(UKOL)], "Rozpočet → [Den 30. 9., Úkol] in one call");
    assert_eq!(r.reason, None, "reason null");
    let den = &r.entries[0];
    assert_eq!((den.r#type.as_str(), den.title.as_str()), ("daily-note", "2026-09-30"), "Den 30. 9.: type daily-note, title 2026-09-30");
    let ukol = &r.entries[1];
    assert_eq!((ukol.status.as_deref(), ukol.due.as_deref(), ukol.completed.as_deref()), (Some("To do"), Some("2026-11-27"), None), "Úkol: status To do, due 2026-11-27");
    assert_eq!(ukol.title, nfc("Poslat návrh rozpočtu financím"), "Úkol's title");
    let t = rel(&core, TERMINY_A, false);
    let sk = t.entries.iter().find(|e| nfc(&e.path) == nfc(SKOLENI));
    assert_eq!(sk.map(|e| e.review.clone()), Some(Some("unreviewed".to_string())), "Školení: review unreviewed");
    for e in r.entries.iter().chain(&t.entries) {
        assert!(e.score > 0.0 && e.shared >= 3, "{}: score > 0 and shared ≥ 3 ({}, {})", e.path, e.score, e.shared);
    }
    let answers = all_answers(&core);
    assert_eq!(core.last_opened(), last, "asking records no recency (the last-opened record)");
    assert_eq!(local_state(&core), state, "asking changes no machine-local file (recents, last opened)");
    assert_eq!(counting.write_count(), 0, "the write counter stays 0");
    let local = core.vault().local_dir();
    drop(core);
    let _ = std::fs::remove_dir_all(&local);
    let core = open(&root, &sb.dirs, false);
    assert_eq!(all_answers(&core), answers, "the answer is identical after a rebuild");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-29 (L4)

#[test]
fn fr_lnk_15_ac29_no_background_work_counter() {
    let sb = sandbox();
    let root = related_vault(&sb);
    let core = open(&root, &sb.dirs, true);
    write_raw(&root, SVATBA, format!("{}\nPřidaný řádek.\n", fixture_text(SVATBA)).as_bytes());
    std::thread::sleep(Duration::from_secs(60));
    assert!(core.wait_idle(Duration::from_secs(10)), "idle");
    assert_eq!(core.related_computed(), 0, "opened, indexed, an external change and 60 s idle: 0 Related lists computed");
    let _ = core.related(&nfc(ROZPOCET), false);
    assert_eq!(core.related_computed(), 1, "one request computes one list");
    assert_eq!(paths(&rel(&core, ROZPOCET, false)).len(), 2, "and it is Rozpočet's list");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-34

#[test]
fn fr_lnk_15_ac34_same_lists_on_a_fresh_machine() {
    let sb = sandbox();
    let root = related_vault(&sb);
    let a = open(&root, &sb.dirs, false);
    let first = all_answers(&a);
    assert_eq!(paths(&rel(&a, HIKING, false)), vec![nfc("Pages/Trail notes.md"), nfc(GEAR)], "Hiking → [Trail, gear list]");
    drop(a);
    let copy_sb = sandbox();
    let copy = related_vault_named(&copy_sb, "Kopie");
    let dirs = fresh_dirs(&copy_sb, "Druhý Mac");
    let b = open(&copy, &dirs, false);
    assert_eq!(all_answers(&b), first, "a copy of the vault on a fresh Application Support gives the same lists after its first index");
}

// ------------------------------------------------------------------------------------------------ FR-FMT-07 AC-31

#[test]
fn fr_fmt_07_ac31_related_indexing_writes_no_vault_file() {
    let sb = sandbox();
    let root = related_vault(&sb);
    let counting = CountingFs::new(local_fs(&root));
    let core = open_with(counting.clone(), &sb.dirs);
    let edited = format!("{}\nPozor na vosk.\n", fixture_text(VCELSTVO));
    write_raw(&root, VCELSTVO, edited.as_bytes());
    let after_edit = snapshot(&root);
    core.notify_changed(&[nfc(VCELSTVO)]);
    assert!(core.wait_idle(Duration::from_secs(10)), "the incremental update is done");
    let answers = all_answers(&core);
    assert!(answers.iter().any(|a| a.contains(&nfc(PROHLIDKA))), "the lists were computed");
    assert_eq!(counting.write_count(), 0, "the one write function was called 0 times");
    assert_eq!(snapshot(&root), after_edit, "every vault file is untouched (bytes, mtime, inode)");
}

// ------------------------------------------------------------------------------------------------ FR-FMT-12 AC-11 (core)

#[test]
fn fr_fmt_12_ac11_nfd_paths_and_bodies_in_related() {
    let sb = sandbox();
    let root = related_vault(&sb);
    let core = open(&root, &sb.dirs, true);
    assert_eq!(paths(&rel(&core, POZNAMKY, false)), vec![nfc(KNIHA)], "positive control: Poznamky → [Kniha]");
    assert!(std::fs::rename(root.join(KNIHA), root.join(nfd(KNIHA))).is_ok(), "setup: rename Kniha to its NFD-named form");
    std::thread::sleep(Duration::from_secs(2));
    assert!(core.wait_idle(Duration::from_secs(5)), "idle after the rename");
    let l = rel(&core, POZNAMKY, false);
    let kn: Vec<(String, String)> = l.entries.iter().filter(|e| nfc(&e.path) == nfc(KNIHA)).map(|e| (e.path.clone(), e.title.clone())).collect();
    assert_eq!(kn, vec![(nfc(KNIHA), nfc("Kniha vzpomínek"))], "Poznamky's list shows Kniha vzpomínek once, NFC (path and title)");
    assert!(core.rel_terms(&nfc(KNIHA)).is_some(), "the rel row is found by the NFC path");
    assert!(matches!(core.related(&nfd(POZNAMKY), false), Ok(ref x) if paths(x) == vec![nfc(KNIHA)]), "an NFD request path answers as its NFC form");
}
