//! S4-QA AC-5: an index rebuilt from scratch equals the incrementally updated index after random
//! sequences of file creates, edits, renames and deletes (AR-01: the index is a disposable cache).

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use proptest::prelude::*;
use s4_index::index::Index;
use s4_index::watch::watch;

#[derive(Debug, Clone)]
enum Op {
    Create { folder: usize, name: usize, body: usize },
    Edit { file: usize, body: usize },
    Rename { file: usize, name: usize },
    Move { file: usize, folder: usize },
    Delete { file: usize },
    RenameFolder { folder: usize, name: usize },
}

const FOLDERS: &[&str] = &["Pages", "Tasks", "Books", "Nové poznámky"];
const NAMES: &[&str] = &["Alpha", "Žluťoučký kůň", "Zlutoucky kun", "Q3 plan", "Kůň (2)", "café", "cafe\u{301} NFD", "Read me", "A b c"];
const BODIES: &[&str] = &[
    "Plain text about a river.",
    "---\ntitle: Titulek\ntype: Book\ntags: [čtení, books]\nrating: 4\n---\nLinks [[Alpha]] and [[Q3 plan#Goals|goals]] #idea",
    "---\nid: 123e4567\ntype: Task\nstatus: Done\ndue: 2026-10-12\n---\n- [x] done #ukol\n- [ ] [[Žluťoučký kůň]]",
    "---\nbad: [unclosed\n---\nInvalid YAML keeps the body: #tag [[Read me]]",
    "```\n[[not a link]] #nottag\n```\n![[img.png]] text $x #m$",
    "---\naliases: [Koník, Horse]\n---\n# Heading\n\n> [!note] callout with [[A b c]]",
    "",
];

fn op() -> impl Strategy<Value = Op> {
    prop_oneof![
        3 => (0..FOLDERS.len(), 0..NAMES.len(), 0..BODIES.len()).prop_map(|(folder, name, body)| Op::Create { folder, name, body }),
        3 => (0..64usize, 0..BODIES.len()).prop_map(|(file, body)| Op::Edit { file, body }),
        1 => (0..64usize, 0..NAMES.len()).prop_map(|(file, name)| Op::Rename { file, name }),
        1 => (0..64usize, 0..FOLDERS.len()).prop_map(|(file, folder)| Op::Move { file, folder }),
        1 => (0..64usize).prop_map(|file| Op::Delete { file }),
        1 => (0..FOLDERS.len(), 0..NAMES.len()).prop_map(|(folder, name)| Op::RenameFolder { folder, name }),
    ]
}

fn notes(vault: &Path) -> Vec<PathBuf> {
    s4_index::index::walk_notes(vault)
}

/// Applies `op` to the files; returns the paths whose state changed (old and new sides).
fn apply(vault: &Path, op: &Op) -> Vec<PathBuf> {
    let files = notes(vault);
    let pick = |i: usize| (!files.is_empty()).then(|| files[i % files.len()].clone());
    match op {
        Op::Create { folder, name, body } => {
            let dir = vault.join(FOLDERS[*folder]);
            fs::create_dir_all(&dir).unwrap();
            let p = dir.join(format!("{}.md", NAMES[*name]));
            fs::write(&p, BODIES[*body]).unwrap();
            vec![p]
        }
        Op::Edit { file, body } => pick(*file).map_or(vec![], |p| {
            fs::write(&p, format!("{}\n{}", BODIES[*body], p.display().to_string().len())).unwrap();
            vec![p]
        }),
        Op::Rename { file, name } => pick(*file).map_or(vec![], |p| {
            let to = p.with_file_name(format!("{}.md", NAMES[*name]));
            if to.exists() {
                return vec![];
            }
            fs::rename(&p, &to).unwrap();
            vec![p, to]
        }),
        Op::Move { file, folder } => pick(*file).map_or(vec![], |p| {
            let dir = vault.join(FOLDERS[*folder]);
            fs::create_dir_all(&dir).unwrap();
            let to = dir.join(p.file_name().unwrap());
            if to.exists() {
                return vec![];
            }
            fs::rename(&p, &to).unwrap();
            vec![p, to]
        }),
        Op::Delete { file } => pick(*file).map_or(vec![], |p| {
            fs::remove_file(&p).unwrap();
            vec![p]
        }),
        Op::RenameFolder { folder, name } => {
            let from = vault.join(FOLDERS[*folder]);
            let to = vault.join(format!("{} dir", NAMES[*name]));
            if !from.is_dir() || to.exists() {
                return vec![];
            }
            fs::rename(&from, &to).unwrap();
            vec![from, to]
        }
    }
}

fn seed_vault(vault: &Path) {
    let o = gen_vault::Options { seed: 3, notes: 40, images: 3, tags: 10, full_images: false };
    gen_vault::generate(vault, &o).unwrap();
}

/// Lines only in one side, for readable failures.
fn diff(got: &str, want: &str) -> String {
    let (g, w): (std::collections::BTreeSet<&str>, std::collections::BTreeSet<&str>) = (got.lines().collect(), want.lines().collect());
    let mut out = String::new();
    for l in g.difference(&w) { out += &format!("- incremental: {}\n", l.chars().take(300).collect::<String>()); }
    for l in w.difference(&g) { out += &format!("+ rebuilt:     {}\n", l.chars().take(300).collect::<String>()); }
    out
}

fn rebuilt_dump(vault: &Path, scratch: &Path) -> String {
    let db = scratch.join(format!("rebuilt-{}.db", Instant::now().elapsed().as_nanos()));
    let mut fresh = Index::open(vault, &db).unwrap();
    fresh.rebuild().unwrap();
    fresh.fts_integrity().unwrap();
    fresh.dump().unwrap()
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 64, ..ProptestConfig::default() })]

    #[test]
    fn s4_qa_ac5_incremental_equals_rebuild(ops in prop::collection::vec(op(), 1..40)) {
        let dir = tempfile::tempdir().unwrap();
        let vault = dir.path().join("vault");
        seed_vault(&vault);
        let mut ix = Index::open(&vault, &dir.path().join("inc.db")).unwrap();
        ix.rebuild().unwrap();
        for op in &ops {
            for p in apply(&vault, op) {
                if p.exists() || p.extension().is_some_and(|e| e == "md") {
                    ix.update_path(&p).unwrap();
                } else {
                    ix.remove_prefix(&p).unwrap();
                }
            }
        }
        ix.fts_integrity().unwrap();
        let (got, want) = (ix.dump().unwrap(), rebuilt_dump(&vault, dir.path()));
        prop_assert!(got == want, "ops {:?}\n{}", ops, diff(&got, &want));
    }
}

/// The same property with the real file watcher in between (FSEvents coalesces and reorders
/// events). Fewer cases: each waits for the watcher to go quiet.
#[test]
fn s4_qa_ac5_watcher_driven_index_equals_rebuild() {
    let mut runner = proptest::test_runner::TestRunner::new(ProptestConfig { cases: 12, ..ProptestConfig::default() });
    runner
        .run(&prop::collection::vec(op(), 5..30), |ops| {
            let dir = tempfile::tempdir().unwrap();
            let vault = dir.path().join("vault");
            seed_vault(&vault);
            let mut ix = Index::open(&vault, &dir.path().join("w.db")).unwrap();
            ix.rebuild().unwrap();
            let ix = Arc::new(Mutex::new(ix));
            let (tx, rx) = channel();
            let w = watch(ix.clone(), tx).unwrap();
            std::thread::sleep(Duration::from_millis(200));
            for op in &ops {
                apply(&vault, op);
            }
            // Quiet for 1.5 s = watcher caught up.
            while rx.recv_timeout(Duration::from_millis(1500)).is_ok() {}
            drop(w);
            let got = ix.lock().unwrap().dump().unwrap();
            let want = rebuilt_dump(&vault, dir.path());
            prop_assert!(got == want, "ops {:?}\n{}", ops, diff(&got, &want));
            Ok(())
        })
        .unwrap();
}

#[test]
fn nfr_perf_02_ac2_sync_catches_up_with_offline_changes() {
    let dir = tempfile::tempdir().unwrap();
    let vault = dir.path().join("vault");
    seed_vault(&vault);
    let db = dir.path().join("s.db");
    Index::open(&vault, &db).unwrap().rebuild().unwrap();
    // "App closed": change files directly.
    for op in [
        Op::Create { folder: 3, name: 1, body: 1 },
        Op::Edit { file: 5, body: 2 },
        Op::Delete { file: 7 },
        Op::RenameFolder { folder: 0, name: 3 },
    ] {
        apply(&vault, &op);
    }
    let mut ix = Index::open(&vault, &db).unwrap();
    assert!(ix.sync().unwrap() > 0);
    assert_eq!(ix.dump().unwrap(), rebuilt_dump(&vault, dir.path()));
    assert_eq!(ix.sync().unwrap(), 0, "second sync finds nothing");
}

#[test]
fn fr_src_01_search_is_diacritics_insensitive_with_type_filter() {
    let dir = tempfile::tempdir().unwrap();
    let vault = dir.path().join("vault");
    fs::create_dir_all(vault.join("Books")).unwrap();
    fs::write(vault.join("Books/Kniha.md"), "---\ntype: Book\n---\nPříliš žluťoučký kůň úpěl ďábelské ódy.").unwrap();
    fs::write(vault.join("Books/Other.md"), "---\ntype: Page\n---\nZlutoucky kun bez diakritiky.").unwrap();
    let mut ix = Index::open(&vault, &dir.path().join("x.db")).unwrap();
    ix.rebuild().unwrap();
    let hits = ix.search("zlutoucky kun", None).unwrap();
    assert_eq!(hits.len(), 2);
    let books = ix.search("žluť", Some("Book")).unwrap();
    assert_eq!(books.iter().map(|h| h.path.as_str()).collect::<Vec<_>>(), vec!["Books/Kniha.md"]);
    assert!(books[0].snippet.contains("[žluťoučký]"), "{}", books[0].snippet);
    assert_eq!(ix.search("\"kůň úpěl\"", None).unwrap().len(), 1);
    assert_eq!(ix.search("\"úpěl kůň\"", None).unwrap().len(), 0);
}
