//! MS2 AC tests at the core: external changes, conflicts, sync adapter, zero writes, placeholders, rebuildable
//! index (docs/acceptance/data-safety.md, file-format.md [MS2], architecture-rules.md AR-04 AC-3/AC-4).
//! Written from the ACs and docs/contracts/ms2-core.md only (D-61).

mod common;

use std::collections::BTreeSet;
use std::path::Path;
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use chrono::NaiveDate;
use common::*;
use tegg_core::{Conflict, ConflictKind, Core, CoreEvent, CoreOptions, SearchQuery, SyncAdapter, VaultFs, WriteOutcome};
use tegg_vault::{AppDirs, FolderSync, LocalFs, MemFs};

const PRAGUE: chrono_tz::Tz = chrono_tz::Europe::Prague;

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

fn idle(core: &Core) {
    assert!(core.wait_idle(Duration::from_secs(60)), "indexing did not become idle within 60 s");
}

fn open_local(root: &Path, dirs: &AppDirs, watch: bool) -> Core {
    let core = ok!(Core::open(root, dirs, CoreOptions { watch, sync: None }), "Core::open");
    idle(&core);
    core
}

fn open_mem(fs: Arc<dyn VaultFs>, dirs: &AppDirs, sync: Option<Arc<dyn SyncAdapter>>) -> Core {
    let core = ok!(Core::open_with(fs, dirs, CoreOptions { watch: false, sync }), "Core::open_with");
    idle(&core);
    core
}

fn search_paths(core: &Core, text: &str) -> BTreeSet<String> {
    let p = ok!(core.search(&SearchQuery::text(text, PRAGUE)), format!("search {text}"));
    p.results.into_iter().map(|r| r.path).collect()
}

fn set(items: &[&str]) -> BTreeSet<String> {
    items.iter().map(|s| s.to_string()).collect()
}

fn conflicts_of(core: &Core, kind: ConflictKind) -> Vec<Conflict> {
    core.conflicts().into_iter().filter(|c| c.kind == kind).collect()
}

fn drain(rx: &Receiver<CoreEvent>) -> Vec<CoreEvent> {
    let mut out = Vec::new();
    while let Ok(e) = rx.recv_timeout(Duration::from_millis(200)) {
        out.push(e);
    }
    out
}

fn note(id: &str, title: &str, extra: &str, body: &str) -> String {
    format!("---\nid: {id}\ntype: page\ntitle: {title}\n{extra}---\n{body}")
}

/// 20 lines of body text, line `i` differs when `i` is in `changed`.
fn body(changed: &[usize]) -> String {
    (0..20).map(|i| if changed.contains(&i) { format!("Změněný řádek {i} úplně jinak.\n") } else { format!("Řádek {i}: tekoucí řeka a most.\n") }).collect()
}

// ---------------------------------------------------------------- FR-SYN-03 / NFR-REL-02

#[test]
fn fr_syn_03_ac1_external_change_reflected_within_2_s() {
    let sb = sandbox();
    let root = search_vault(&sb);
    let core = open_local(&root, &sb.dirs, true);
    assert_eq!(search_paths(&core, "rozpočet").len(), 5, "positive control");
    let text = std::fs::read_to_string(root.join(TOMAS)).unwrap_or_default();
    std::fs::write(root.join(TOMAS), text.replace("termín výletu", "termín výletu a šafránovou omáčku")).unwrap_or(());
    let seen = wait_until(Duration::from_secs(2), || search_paths(&core, "šafránovou") == set(&[TOMAS]));
    assert!(seen.is_some(), "external change not in the index within 2 s");
    let created = "Pages/Nová odjinud.md";
    write_raw(&root, created, "Vytvořeno jinou aplikací: kapradina.\n".as_bytes());
    let seen = wait_until(Duration::from_secs(2), || search_paths(&core, "kapradina") == set(&[created]));
    assert!(seen.is_some(), "externally created file not in the index within 2 s");
}

#[test]
fn fr_syn_03_ac5_external_rename_and_move_keep_identity_and_links() {
    let sb = sandbox();
    let root = search_vault(&sb);
    // Nápad links out to Rozpočet; another note links to Nápad by its id (FR-LNK-14: by file or id).
    let napad = std::fs::read_to_string(root.join(NAPAD)).unwrap_or_default();
    write_raw(&root, NAPAD, format!("{napad}\nViz [[Rozpočet 2026]].\n").as_bytes());
    write_raw(&root, "Pages/Rozcestník.md", "Odkaz na nápad: [[01JA0S0000000000000000S005]].\n".as_bytes());
    let core = open_local(&root, &sb.dirs, true);
    assert_eq!(core.backlinks(ROZPOCET), vec![NAPAD.to_string()], "setup: backlink before the move");

    let moved = "Pages/Výlet na hory.md";
    std::fs::rename(root.join(NAPAD), root.join(moved)).unwrap_or(());
    let seen = wait_until(Duration::from_secs(2), || core.object(moved).is_some() && core.object(NAPAD).is_none());
    assert!(seen.is_some(), "external move not reflected within 2 s");
    let obj = core.object(moved).map(|o| (o.id, o.folder, o.r#type));
    assert_eq!(obj, Some((Some("01JA0S0000000000000000S005".to_string()), "Pages".to_string(), "quick-note".to_string())));
    assert_eq!(core.backlinks(ROZPOCET), vec![moved.to_string()]);
    assert_eq!(core.resolve_link("01JA0S0000000000000000S005").as_deref(), Some(moved));
    assert_eq!(core.backlinks(moved), vec!["Pages/Rozcestník.md".to_string()]);
}

#[test]
fn fr_syn_03_ac7_save_checks_the_disk_version_first() {
    let fs = memfs_vault(&[("Pages/Řeka.md", "---\nid: 01JA0S0000000000000000S050\ntype: page\n---\nVltava teče.\n")]);
    let sb = sandbox();
    let core = open_mem(fs.clone(), &sb.dirs, None);
    let (_, base) = ok!(core.read_note("Pages/Řeka.md", SystemTime::now()), "read_note");
    // Same size, different content: only the hash tells them apart.
    let theirs = "---\nid: 01JA0S0000000000000000S050\ntype: page\n---\nOhře  teče.\n";
    assert_eq!(theirs.len(), "---\nid: 01JA0S0000000000000000S050\ntype: page\n---\nVltava teče.\n".len(), "setup");
    ok!(fs.write_external("Pages/Řeka.md", theirs.as_bytes()), "external write");
    let mine = "---\nid: 01JA0S0000000000000000S050\ntype: page\n---\nVltava teče do Labe.\n";
    let res = core.write_note("Pages/Řeka.md", mine.as_bytes(), Some(&base));
    assert!(!matches!(res, Ok(WriteOutcome::Written(_))), "stale base must not be written: {res:?}");
    assert_eq!(fs.read("Pages/Řeka.md").map(|(b, _)| b).unwrap_or_default(), theirs.as_bytes());
}

#[test]
fn fr_syn_03_ac8_stale_save_writes_nothing_and_emits_note_conflict() {
    let original = "---\nid: 01JA0S0000000000000000S051\ntype: page\n---\nPůvodní text.\n";
    let fs = memfs_vault(&[("Pages/Most.md", original)]);
    let sb = sandbox();
    let core = open_mem(fs.clone(), &sb.dirs, None);
    let events = core.events();
    let (_, base) = ok!(core.read_note("Pages/Most.md", SystemTime::now()), "read_note");
    let theirs = "---\nid: 01JA0S0000000000000000S051\ntype: page\n---\nJejich změna z jiného Macu.\n";
    ok!(fs.write_external("Pages/Most.md", theirs.as_bytes()), "external write");
    let disk = fs.version("Pages/Most.md").unwrap_or(None);
    let mine = "---\nid: 01JA0S0000000000000000S051\ntype: page\n---\nMoje změna v editoru.\n";
    let res = core.write_note("Pages/Most.md", mine.as_bytes(), Some(&base));
    assert!(!matches!(res, Ok(WriteOutcome::Written(_))), "{res:?}");
    assert_eq!(fs.read("Pages/Most.md").map(|(b, _)| b).unwrap_or_default(), theirs.as_bytes());
    let conflicts: Vec<CoreEvent> = drain(&events).into_iter().filter(|e| matches!(e, CoreEvent::NoteConflict { .. })).collect();
    assert_eq!(
        conflicts,
        vec![CoreEvent::NoteConflict {
            path: "Pages/Most.md".into(),
            mine: mine.as_bytes().to_vec(),
            theirs: theirs.as_bytes().to_vec(),
            disk: disk.unwrap_or_else(|| unreachable!()),
        }]
    );
}

#[test]
fn fr_syn_03_ac9_500_changes_at_once_are_all_indexed_within_30_s() {
    let sb = sandbox();
    let root = search_vault(&sb);
    for i in 0..250 {
        write_raw(&root, &format!("Pages/Dávka/Stará {i:03}.md"), format!("Stará poznámka {i}.\n").as_bytes());
    }
    let core = open_local(&root, &sb.dirs, true);
    let events = core.events();
    for i in 0..250 {
        write_raw(&root, &format!("Pages/Dávka/Stará {i:03}.md"), format!("Stará poznámka {i}, teď s jitrocelem.\n").as_bytes());
        write_raw(&root, &format!("Pages/Dávka/Nová {i:03}.md"), format!("Nová poznámka {i} s jitrocelem.\n").as_bytes());
    }
    let done = wait_until(Duration::from_secs(30), || core.search(&SearchQuery::text("jitrocelem", PRAGUE)).map(|p| p.total).unwrap_or(0) == 500);
    assert!(done.is_some(), "500 changes not processed within 30 s");
    let mut reported = BTreeSet::new();
    for e in drain(&events) {
        if let CoreEvent::VaultChanged { paths } = e {
            reported.extend(paths);
        }
    }
    let missing: Vec<String> = (0..250)
        .flat_map(|i| [format!("Pages/Dávka/Stará {i:03}.md"), format!("Pages/Dávka/Nová {i:03}.md")])
        .filter(|p| !reported.contains(p))
        .collect();
    assert_eq!(missing, Vec::<String>::new(), "every change is reported by a VaultChanged event");
}

// ---------------------------------------------------------------- FR-SYN-04 / FR-SYN-05

#[test]
fn fr_syn_04_ac1_duplicate_id_primary_is_the_file_named_like_the_title() {
    let id = "01JA0S0000000000000000S060";
    let fs = memfs_vault(&[
        ("Pages/Řeka.md", &note(id, "Řeka", "created: 2026-05-01T09:00:00+02:00\n", "Vltava.\n")),
        ("Pages/Řeka (conflicted copy 2026-10-07).md", &note(id, "Řeka", "created: 2026-01-01T09:00:00+02:00\n", "Vltava a Labe.\n")),
    ]);
    let sb = sandbox();
    let core = open_mem(fs, &sb.dirs, None);
    let c = conflicts_of(&core, ConflictKind::DuplicateId);
    assert_eq!(
        c,
        vec![Conflict { kind: ConflictKind::DuplicateId, primary: "Pages/Řeka.md".into(), others: vec!["Pages/Řeka (conflicted copy 2026-10-07).md".into()] }]
    );
    assert_eq!(core.resolve_link(id).as_deref(), Some("Pages/Řeka.md"));
}

#[test]
fn fr_syn_04_ac1_duplicate_id_primary_else_older_created() {
    let id = "01JA0S0000000000000000S061";
    let fs = memfs_vault(&[
        ("Pages/Horní tok.md", &note(id, "Prameny", "created: 2026-05-01T09:00:00+02:00\n", "A.\n")),
        ("Pages/Horní tok (conflicted copy 2026-10-07).md", &note(id, "Prameny", "created: 2026-01-01T09:00:00+02:00\n", "B.\n")),
    ]);
    let sb = sandbox();
    let core = open_mem(fs, &sb.dirs, None);
    let c = conflicts_of(&core, ConflictKind::DuplicateId);
    assert_eq!(c.iter().map(|c| (c.primary.clone(), c.others.clone())).collect::<Vec<_>>(), vec![(
        "Pages/Horní tok (conflicted copy 2026-10-07).md".to_string(),
        vec!["Pages/Horní tok.md".to_string()]
    )]);
    assert_eq!(core.resolve_link(id).as_deref(), Some("Pages/Horní tok (conflicted copy 2026-10-07).md"));
}

#[test]
fn fr_syn_04_ac1_duplicate_id_primary_else_shorter_path() {
    let id = "01JA0S0000000000000000S062";
    let same = "created: 2026-05-01T09:00:00+02:00\n";
    let fs = memfs_vault(&[
        ("Pages/Údolí.md", &note(id, "Krajina", same, "A.\n")),
        ("Pages/Údolí (conflicted copy 2026-10-07).md", &note(id, "Krajina", same, "B.\n")),
    ]);
    let sb = sandbox();
    let core = open_mem(fs, &sb.dirs, None);
    let c = conflicts_of(&core, ConflictKind::DuplicateId);
    assert_eq!(c.iter().map(|c| c.primary.clone()).collect::<Vec<_>>(), vec!["Pages/Údolí.md".to_string()]);
    assert_eq!(core.resolve_link(id).as_deref(), Some("Pages/Údolí.md"));
}

#[test]
fn fr_syn_04_ac2_conflict_copy_names_with_near_identical_content_are_possible_conflicts() {
    let original = note("01JA0S0000000000000000S070", "Řeka", "", &body(&[]));
    let near = |id: &str| note(id, "Řeka", "", &body(&[7])); // 1 of 24 lines differs
    let crlf = note("01JA0S0000000000000000S075", "Řeka", "", &body(&[])).replace('\n', "\r\n");
    let copies = [
        ("Pages/Řeka (conflicted copy 2026-10-07).md", near("01JA0S0000000000000000S071")),
        ("Pages/Řeka (Mikhail's conflicted copy 2026-10-07).md", near("01JA0S0000000000000000S072")),
        ("Pages/Řeka (1).md", near("01JA0S0000000000000000S073")),
        ("Pages/Řeka 2.md", crlf),
    ];
    let mut files: Vec<(&str, &str)> = vec![("Pages/Řeka.md", original.as_str())];
    files.extend(copies.iter().map(|(p, t)| (*p, t.as_str())));
    let fs = memfs_vault(&files);
    let sb = sandbox();
    let core = open_mem(fs, &sb.dirs, None);
    let mut flagged: Vec<String> = conflicts_of(&core, ConflictKind::PossibleCopy).into_iter().flat_map(|c| c.others).collect();
    flagged.sort();
    let mut want: Vec<String> = copies.iter().map(|(p, _)| p.to_string()).collect();
    want.sort();
    assert_eq!(flagged, want);
    assert!(conflicts_of(&core, ConflictKind::PossibleCopy).iter().all(|c| c.primary == "Pages/Řeka.md"));
}

#[test]
fn fr_syn_04_ac2_copy_names_with_different_content_and_tegg_duplicates_are_not_conflicts() {
    let original = note("01JA0S0000000000000000S080", "Řeka", "", &body(&[]));
    let half = |id: &str| note(id, "Řeka", "", &body(&[0, 2, 4, 6, 8, 10, 12, 14, 16, 18])); // 50 % lines differ
    let fs = memfs_vault(&[
        ("Pages/Řeka.md", original.as_str()),
        ("Pages/Řeka (conflicted copy 2026-10-07).md", half("01JA0S0000000000000000S081").as_str()),
        ("Pages/Řeka (1).md", half("01JA0S0000000000000000S082").as_str()),
        ("Pages/Řeka 2.md", half("01JA0S0000000000000000S083").as_str()),
        ("Pages/Řeka (2).md", note("01JA0S0000000000000000S084", "Řeka", "", "Jiná řeka se stejným názvem.\n").as_str()),
        // Positive control in the same vault: a near-identical Dropbox copy is flagged.
        ("Pages/Most.md", note("01JA0S0000000000000000S085", "Most", "", &body(&[])).as_str()),
        ("Pages/Most (conflicted copy 2026-10-07).md", note("01JA0S0000000000000000S086", "Most", "", &body(&[3])).as_str()),
    ]);
    let sb = sandbox();
    let core = open_mem(fs, &sb.dirs, None);
    let all = core.conflicts();
    assert_eq!(
        all,
        vec![Conflict { kind: ConflictKind::PossibleCopy, primary: "Pages/Most.md".into(), others: vec!["Pages/Most (conflicted copy 2026-10-07).md".into()] }]
    );
}

#[test]
fn fr_syn_04_ac2_conflict_copy_name_with_same_id_is_flagged_whatever_the_content() {
    let id = "01JA0S0000000000000000S090";
    let fs = memfs_vault(&[
        ("Pages/Řeka.md", &note(id, "Řeka", "", &body(&[]))),
        ("Pages/Řeka 2.md", &note(id, "Řeka", "", "Úplně jiný obsah.\n")),
    ]);
    let sb = sandbox();
    let core = open_mem(fs, &sb.dirs, None);
    let c = core.conflicts();
    assert_eq!(c.len(), 1, "{c:?}");
    assert_eq!((c[0].primary.as_str(), c[0].others.clone()), ("Pages/Řeka.md", vec!["Pages/Řeka 2.md".to_string()]));
}

#[test]
fn fr_syn_04_ac4_duplicate_id_without_copy_name_newer_file_is_reided_links_keep_resolving() {
    let id = "01JA0S0000000000000000S095";
    let older = note(id, "Řeka", "created: 2026-01-10T09:00:00+01:00\n", "Originál.\n");
    let newer = note(id, "Řeka", "created: 2026-06-10T09:00:00+02:00\n", "Kopie z Finderu.\n");
    let fs = memfs_vault(&[("Pages/Řeka.md", older.as_str()), ("Pages/Řeka kopie.md", newer.as_str()), ("Pages/Odkazy.md", &format!("[[{id}]] a [[Řeka kopie]]\n"))]);
    let sb = sandbox();
    let core = open_mem(fs.clone(), &sb.dirs, None);
    assert_eq!(
        core.conflicts(),
        vec![Conflict { kind: ConflictKind::DuplicateId, primary: "Pages/Řeka.md".into(), others: vec!["Pages/Řeka kopie.md".into()] }]
    );
    assert_eq!(core.resolve_link(id).as_deref(), Some("Pages/Řeka.md"));

    // After the user confirms, the UI gives the newer file a new id (through @tegg/doc) and saves it.
    let (_, base) = ok!(core.read_note("Pages/Řeka kopie.md", SystemTime::now()), "read_note");
    let reided = newer.replace(id, "01JA0S0000000000000000S096");
    let res = core.write_note("Pages/Řeka kopie.md", reided.as_bytes(), Some(&base));
    assert!(matches!(res, Ok(WriteOutcome::Written(_))), "{res:?}");
    idle(&core);
    assert_eq!(core.conflicts(), Vec::<Conflict>::new());
    assert_eq!(core.resolve_link(id).as_deref(), Some("Pages/Řeka.md"));
    assert_eq!(core.resolve_link("Řeka kopie").as_deref(), Some("Pages/Řeka kopie.md"));
    assert_eq!(core.resolve_link("01JA0S0000000000000000S096").as_deref(), Some("Pages/Řeka kopie.md"));
    assert_eq!(core.backlinks("Pages/Řeka.md"), vec!["Pages/Odkazy.md".to_string()]);
    assert_eq!(core.backlinks("Pages/Řeka kopie.md"), vec!["Pages/Odkazy.md".to_string()]);
}

// ---------------------------------------------------------------- AR-04 AC-3 / AC-4

/// A test sync adapter: the test applies a change to the MemFs, then reports it through the sink.
struct InjectingAdapter {
    sink: Mutex<Option<Box<dyn Fn(Vec<String>) + Send + Sync>>>,
}
impl SyncAdapter for InjectingAdapter {
    fn name(&self) -> &str {
        "test-injecting"
    }
    fn start(&self, sink: Box<dyn Fn(Vec<String>) + Send + Sync>) {
        if let Ok(mut s) = self.sink.lock() {
            *s = Some(sink);
        }
    }
}
impl InjectingAdapter {
    fn started(&self) -> bool {
        self.sink.lock().map(|s| s.is_some()).unwrap_or(false)
    }
    fn report(&self, paths: &[&str]) {
        if let Ok(s) = self.sink.lock() {
            if let Some(f) = s.as_ref() {
                f(paths.iter().map(|p| p.to_string()).collect());
            }
        }
    }
}

trait Driver {
    fn write(&self, path: &str, text: &str);
    fn remove(&self, path: &str);
    fn rename(&self, from: &str, to: &str);
}

struct Watcher(std::path::PathBuf);
impl Driver for Watcher {
    fn write(&self, path: &str, text: &str) {
        write_raw(&self.0, path, text.as_bytes());
    }
    fn remove(&self, path: &str) {
        let _ = std::fs::remove_file(self.0.join(path));
    }
    fn rename(&self, from: &str, to: &str) {
        let _ = std::fs::rename(self.0.join(from), self.0.join(to));
    }
}

struct Adapter(Arc<MemFs>, Arc<InjectingAdapter>);
impl Driver for Adapter {
    fn write(&self, path: &str, text: &str) {
        let _ = self.0.write_external(path, text.as_bytes());
        self.1.report(&[path]);
    }
    fn remove(&self, path: &str) {
        let _ = self.0.remove_external(path);
        self.1.report(&[path]);
    }
    fn rename(&self, from: &str, to: &str) {
        let _ = self.0.rename_external(from, to);
        self.1.report(&[from, to]);
    }
}

#[derive(Debug, PartialEq)]
struct Outcome {
    objects: Vec<(String, Option<String>)>,
    conflicts: Vec<Conflict>,
    safran: BTreeSet<String>,
    note_conflict: Vec<String>,
    tomas_on_disk_is_theirs: bool,
}

const COPY: &str = "Pages/Rozpočet 2026 (conflicted copy 2026-10-07).md";
const HORY: &str = "Quick Notes/Nápad na hory.md";

/// The FR-SYN-03/-04/-05 sync-simulator scenario: remote modify, conflict copy, delete, rename, and a save on a
/// stale base. Each step waits (≤ 2 s) until the index shows it.
fn scenario(core: &Core, d: &dyn Driver, read_disk: &dyn Fn(&str) -> Vec<u8>) -> Outcome {
    let events = core.events();
    let rozpocet = String::from_utf8(read_disk(ROZPOCET)).unwrap_or_default();
    assert!(rozpocet.contains("01JA0S0000000000000000S002"), "setup: fixture readable");

    let modified = rozpocet.replace("je schválený", "je schválený, se šafránem");
    d.write(ROZPOCET, &modified);
    let ok1 = wait_until(Duration::from_secs(2), || search_paths(core, "šafránem") == set(&[ROZPOCET]));
    assert!(ok1.is_some(), "remote modify not indexed");

    d.write(COPY, &modified);
    let ok2 = wait_until(Duration::from_secs(2), || !conflicts_of(core, ConflictKind::DuplicateId).is_empty());
    assert!(ok2.is_some(), "remote conflict copy not detected");

    d.remove(PROJEKT);
    let ok3 = wait_until(Duration::from_secs(2), || core.object(PROJEKT).is_none());
    assert!(ok3.is_some(), "remote delete not indexed");

    d.rename(NAPAD, HORY);
    let ok4 = wait_until(Duration::from_secs(2), || core.object(HORY).is_some() && core.object(NAPAD).is_none());
    assert!(ok4.is_some(), "remote rename not indexed");

    let (_, base) = ok!(core.read_note(TOMAS, SystemTime::now()), "read_note");
    let theirs = String::from_utf8(read_disk(TOMAS)).unwrap_or_default().replace("Probrat", "Vzdáleně: probrat");
    d.write(TOMAS, &theirs);
    std::thread::sleep(Duration::from_millis(50));
    let mine = String::from_utf8(read_disk(TOMAS)).unwrap_or_default().replace("Vzdáleně: probrat", "Lokálně: probrat");
    let _ = core.write_note(TOMAS, mine.as_bytes(), Some(&base));
    let note_conflict = drain(&events)
        .into_iter()
        .filter_map(|e| if let CoreEvent::NoteConflict { path, .. } = e { Some(path) } else { None })
        .collect();
    idle(core);
    let mut objects: Vec<(String, Option<String>)> = core.objects().into_iter().map(|o| (o.path, o.id)).collect();
    objects.sort();
    Outcome {
        objects,
        conflicts: core.conflicts(),
        safran: search_paths(core, "šafránem"),
        note_conflict,
        tomas_on_disk_is_theirs: read_disk(TOMAS) == theirs.as_bytes(),
    }
}

fn expected_outcome() -> Outcome {
    let mut objects: Vec<(String, Option<String>)> = vec![
            (CTENI.into(), Some("01JA0S0000000000000000S001".into())),
            (OBYCEJNA.into(), None),
            (COPY.into(), Some("01JA0S0000000000000000S002".into())),
            (ROZPOCET.into(), Some("01JA0S0000000000000000S002".into())),
            (HORY.into(), Some("01JA0S0000000000000000S005".into())),
            (TOMAS.into(), Some("01JA0S0000000000000000S004".into())),
    ];
    objects.sort();
    Outcome {
        objects,
        conflicts: vec![Conflict { kind: ConflictKind::DuplicateId, primary: ROZPOCET.into(), others: vec![COPY.into()] }],
        safran: set(&[ROZPOCET, COPY]),
        note_conflict: vec![TOMAS.into()],
        tomas_on_disk_is_theirs: true,
    }
}

fn run_with_adapter() -> Outcome {
    let fs = search_memfs();
    let adapter = Arc::new(InjectingAdapter { sink: Mutex::new(None) });
    let sb = sandbox();
    let core = open_mem(fs.clone(), &sb.dirs, Some(adapter.clone() as Arc<dyn SyncAdapter>));
    assert!(adapter.started(), "the core starts the sync adapter and hands it a sink");
    let fs2 = fs.clone();
    scenario(&core, &Adapter(fs, adapter), &move |p| fs2.read(p).map(|(b, _)| b).unwrap_or_default())
}

#[test]
fn ar_04_ac3_test_adapter_drives_index_and_conflict_detection() {
    assert_eq!(run_with_adapter(), expected_outcome());
}

#[test]
fn ar_04_ac3_folder_sync_adapter_adds_nothing_beyond_the_watcher() {
    let sb = sandbox();
    let root = search_vault(&sb);
    let core = ok!(
        Core::open(&root, &sb.dirs, CoreOptions { watch: true, sync: Some(Arc::new(FolderSync) as Arc<dyn SyncAdapter>) }),
        "Core::open with FolderSync"
    );
    idle(&core);
    let before = snapshot(&root);
    assert_eq!(search_paths(&core, "rozpočet").len(), 5, "positive control");
    write_raw(&root, "Pages/Ze synchronizace.md", "Přišlo přes Dropbox: jeřabina.\n".as_bytes());
    let seen = wait_until(Duration::from_secs(2), || search_paths(&core, "jeřabina") == set(&["Pages/Ze synchronizace.md"]));
    assert!(seen.is_some(), "folder sync relies on the watcher");
    let mut after = snapshot(&root);
    after.remove("Pages/Ze synchronizace.md");
    assert_eq!(after, before, "the folder adapter writes nothing");
}

#[test]
fn ar_04_ac4_watcher_and_adapter_give_the_same_outcomes() {
    let sb = sandbox();
    let root = search_vault(&sb);
    let core = open_local(&root, &sb.dirs, true);
    let r = root.clone();
    let via_watcher = scenario(&core, &Watcher(root), &move |p| std::fs::read(r.join(p)).unwrap_or_default());
    let via_adapter = run_with_adapter();
    assert_eq!(via_watcher, via_adapter);
    assert_eq!(via_watcher, expected_outcome());
}

// ---------------------------------------------------------------- FR-SYN-02 AC-2

#[test]
fn fr_syn_02_ac2_watcher_ignores_tegg_tmp_files() {
    let sb = sandbox();
    let root = search_vault(&sb);
    let core = open_local(&root, &sb.dirs, true);
    let events = core.events();
    write_raw(&root, "Pages/.Čtení knih.md.tegg-tmp", "---\ntype: page\n---\nRozepsáno: bezinkový.\n".as_bytes());
    write_raw(&root, ".Kořen.md.tegg-tmp", "Rozepsáno: bezinkový.\n".as_bytes());
    // Positive control: a real note written at the same time is indexed.
    write_raw(&root, "Pages/Skutečná.md", "Skutečná poznámka: bezinkový.\n".as_bytes());
    let seen = wait_until(Duration::from_secs(2), || !search_paths(&core, "bezinkový").is_empty());
    assert!(seen.is_some(), "positive control: real note not indexed within 2 s");
    std::thread::sleep(Duration::from_millis(500));
    assert_eq!(search_paths(&core, "bezinkový"), set(&["Pages/Skutečná.md"]));
    assert!(core.objects().iter().all(|o| !o.path.ends_with(".tegg-tmp")));
    let reported: Vec<String> = drain(&events)
        .into_iter()
        .filter_map(|e| if let CoreEvent::VaultChanged { paths } = e { Some(paths) } else { None })
        .flatten()
        .collect();
    assert!(reported.contains(&"Pages/Skutečná.md".to_string()), "{reported:?}");
    assert!(reported.iter().all(|p| !p.ends_with(".tegg-tmp")), "{reported:?}");
}

#[test]
fn fr_syn_02_ac2_own_writes_never_surface_temp_files() {
    let sb = sandbox();
    let root = search_vault(&sb);
    let core = open_local(&root, &sb.dirs, true);
    let events = core.events();
    let (bytes, base) = ok!(core.read_note(CTENI, SystemTime::now()), "read_note");
    let new = String::from_utf8(bytes).unwrap_or_default().replace("Seznam knih", "Seznam knih o vřesovišti");
    let res = core.write_note(CTENI, new.as_bytes(), Some(&base));
    assert!(matches!(res, Ok(WriteOutcome::Written(_))), "{res:?}");
    let seen = wait_until(Duration::from_secs(2), || search_paths(&core, "vřesovišti") == set(&[CTENI]));
    assert!(seen.is_some(), "own write indexed");
    std::thread::sleep(Duration::from_millis(500));
    let reported: Vec<String> = drain(&events)
        .into_iter()
        .filter_map(|e| if let CoreEvent::VaultChanged { paths } = e { Some(paths) } else { None })
        .flatten()
        .collect();
    assert!(reported.iter().all(|p| !p.ends_with(".tegg-tmp")), "{reported:?}");
    assert!(core.objects().iter().all(|o| !o.path.contains(".tegg-tmp")));
}

// ---------------------------------------------------------------- FR-SYN-06 AC-1

#[test]
fn fr_syn_06_ac1_open_index_read_search_switch_write_nothing_local_fs() {
    let sb = sandbox();
    let root = search_vault(&sb);
    let before = snapshot(&root);
    let core = open_local(&root, &sb.dirs, true);
    assert_eq!(search_paths(&core, "rozpočet").len(), 5, "positive control");
    for p in [CTENI, TOMAS, OBYCEJNA] {
        let r = core.read_note(p, SystemTime::now());
        assert!(r.is_ok(), "read_note {p}: {:?}", r.err());
    }
    let _ = core.switcher("cteni", 20);
    let _ = core.switcher("", 20);
    let _ = core.search(&SearchQuery::text("\"rozpočet projektu\" -tomášovi", PRAGUE));
    let _ = core.objects();
    let _ = core.conflicts();
    std::thread::sleep(Duration::from_millis(500));
    drop(core);
    assert_eq!(snapshot(&root), before);
}

#[test]
fn fr_syn_06_ac1_write_counter_stays_zero() {
    let fs = CountingFs::new(search_memfs());
    let sb = sandbox();
    let core = open_mem(fs.clone(), &sb.dirs, None);
    assert_eq!(search_paths(&core, "rozpočet").len(), 5, "positive control");
    let _ = core.read_note(CTENI, SystemTime::now());
    let _ = core.switcher("rozpo", 20);
    let _ = core.search(&SearchQuery::text("výlet", PRAGUE));
    assert_eq!(fs.write_count(), 0);
}

// ---------------------------------------------------------------- FR-VLT-03

fn placeholder_vault() -> (Arc<CountingFs<Arc<MemFs>>>, Arc<MemFs>) {
    let mem = search_memfs();
    let _ = mem.write_external("Pages/Jen v cloudu.md", "---\ntype: page\n---\nObsah, který tu není: mech.\n".as_bytes());
    mem.set_placeholder("Pages/Jen v cloudu.md", true);
    let _ = mem.write_external("Pages/.Horská chata.md.icloud", b"bplist00 stub");
    (CountingFs::new(mem.clone()), mem)
}

#[test]
fn fr_vlt_03_ac2_indexing_never_reads_placeholders_and_lists_them() {
    let (fs, _mem) = placeholder_vault();
    let sb = sandbox();
    let core = open_mem(fs.clone(), &sb.dirs, None);
    assert_eq!(search_paths(&core, "rozpočet").len(), 5, "positive control: the rest is indexed");
    let reads = fs.read_paths();
    assert!(reads.contains(&CTENI.to_string()), "positive control: present files are read: {reads:?}");
    assert!(!reads.iter().any(|p| p.contains("Jen v cloudu") || p.ends_with(".icloud")), "{reads:?}");
    assert!(core.object("Pages/Jen v cloudu.md").is_none());
    let listed = core.placeholders();
    assert!(listed.contains(&"Pages/Jen v cloudu.md".to_string()), "{listed:?}");
    assert_eq!(listed.len(), 2, "{listed:?}");
}

#[test]
fn fr_vlt_03_ac3_placeholder_count_reported_at_open() {
    let (fs, _mem) = placeholder_vault();
    let sb = sandbox();
    let core = ok!(Core::open_with(fs, &sb.dirs, CoreOptions { watch: false, sync: None }), "Core::open_with");
    assert_eq!(core.placeholders().len(), 2);
    idle(&core);
    assert_eq!(core.placeholders().len(), 2);
}

#[test]
fn fr_vlt_03_ac3_local_fs_recognizes_icloud_stub_names() {
    let sb = sandbox();
    let root = search_vault(&sb);
    write_raw(&root, "Pages/.Horská chata.md.icloud", b"bplist00 stub");
    write_raw(&root, "Quick Notes/.Nápad 2.md.icloud", b"bplist00 stub");
    let core = open_local(&root, &sb.dirs, false);
    assert_eq!(core.placeholders().len(), 2, "{:?}", core.placeholders());
    let fs = LocalFs::new(&root);
    assert!(matches!(fs.is_placeholder(CTENI), Ok(false)), "a present file is not a placeholder");
}

// ---------------------------------------------------------------- FR-FMT-02 AC-2

#[test]
fn fr_fmt_02_ac2_rename_move_and_external_edit_keep_the_id() {
    let sb = sandbox();
    let root = search_vault(&sb);
    let core = open_local(&root, &sb.dirs, true);
    assert_eq!(core.object(ROZPOCET).and_then(|o| o.id).as_deref(), Some("01JA0S0000000000000000S002"));

    std::fs::rename(root.join(ROZPOCET), root.join("Pages/Finance 2026.md")).unwrap_or(());
    let a = wait_until(Duration::from_secs(2), || core.object("Pages/Finance 2026.md").is_some());
    assert!(a.is_some(), "rename not reflected");
    std::fs::rename(root.join("Pages/Finance 2026.md"), root.join("Tasks/Finance 2026.md")).unwrap_or(());
    let b = wait_until(Duration::from_secs(2), || core.object("Tasks/Finance 2026.md").is_some());
    assert!(b.is_some(), "move not reflected");
    let text = std::fs::read_to_string(root.join("Tasks/Finance 2026.md")).unwrap_or_default();
    std::fs::write(root.join("Tasks/Finance 2026.md"), text.replace("schválený", "upravený v Obsidianu")).unwrap_or(());
    let c = wait_until(Duration::from_secs(2), || search_paths(&core, "Obsidianu").contains("Tasks/Finance 2026.md"));
    assert!(c.is_some(), "edit not reflected");

    let o = core.object("Tasks/Finance 2026.md").map(|o| (o.id, o.title, o.folder));
    assert_eq!(o, Some((Some("01JA0S0000000000000000S002".into()), "Rozpočet 2026".into(), "Tasks".into())));
    assert_eq!(core.resolve_link("01JA0S0000000000000000S002").as_deref(), Some("Tasks/Finance 2026.md"));
    assert_eq!(core.objects().iter().filter(|o| o.id.as_deref() == Some("01JA0S0000000000000000S002")).count(), 1);
}

// ---------------------------------------------------------------- FR-FMT-09 AC-2

#[test]
fn fr_fmt_09_ac2_daily_notes_recognized_by_date_attribute_with_custom_format() {
    let daily = |d: &str, id: &str| format!("---\nid: {id}\ntype: daily-note\ndate: {d}\n---\nDen.\n");
    let fs = memfs_vault(&[
        ("Daily/09.10.2026.md", &daily("2026-10-09", "01JA0S0000000000000000S101")),
        ("Daily/2026-10-08.md", &daily("2026-10-08", "01JA0S0000000000000000S102")),
        ("Daily/Starý zápis.md", &daily("2026-10-07", "01JA0S0000000000000000S103")),
    ]);
    let yml = fs.read(".tegg/vault.yml").map(|(b, _)| String::from_utf8(b).unwrap_or_default()).unwrap_or_default();
    let _ = fs.write_external(".tegg/vault.yml", yml.replace("daily-format: YYYY-MM-DD", "daily-format: DD.MM.YYYY").as_bytes());
    assert_eq!(tegg_format::daily_note_file_name(day(2026, 10, 9), "DD.MM.YYYY"), "09.10.2026.md");
    let sb = sandbox();
    let core = open_mem(fs, &sb.dirs, None);
    let got: Vec<Option<String>> = [9, 8, 7, 6].iter().map(|d| core.daily_note(day(2026, 10, *d))).collect();
    assert_eq!(
        got,
        vec![Some("Daily/09.10.2026.md".into()), Some("Daily/2026-10-08.md".into()), Some("Daily/Starý zápis.md".into()), None]
    );
}

fn day(y: i32, m: u32, d: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(y, m, d).unwrap_or_default()
}

// ---------------------------------------------------------------- NFR-POR-03 / FR-STO-07 / AR-01

fn por_vault(sb: &Sandbox) -> std::path::PathBuf {
    let root = search_vault(sb);
    write_raw(&root, "Pages/Rozcestník.md", "---\nid: 01JA0S0000000000000000S110\ntype: page\nsouvisí: \"[[Rozpočet 2026]]\"\ntags: [rozcestí]\n---\n[[Čtení knih]], [[Zavolat Tomášovi|Tomáš]] a ![[Nápad na výlet]] #Mapa\n".as_bytes());
    root
}

#[test]
fn nfr_por_03_ac1_everything_is_identical_after_deleting_the_index() {
    let sb = sandbox();
    let root = por_vault(&sb);
    let core = open_local(&root, &sb.dirs, false);
    let objects = core.objects();
    assert_eq!(objects.len(), 7, "positive control: {objects:?}");
    let rozc = core.object("Pages/Rozcestník.md");
    assert_eq!(rozc.as_ref().map(|o| o.tags.clone()), Some(vec!["rozcestí".to_string(), "mapa".to_string()]));
    let backlinks: Vec<Vec<String>> = [CTENI, TOMAS, NAPAD, ROZPOCET].iter().map(|p| core.backlinks(p)).collect();
    assert_eq!(backlinks, vec![vec!["Pages/Rozcestník.md".to_string()]; 4]);
    let dump = core.snapshot();
    assert!(!dump.is_empty(), "snapshot is a dump of the index");
    let local = core.vault().local_dir();
    drop(core);
    ok!(std::fs::remove_dir_all(&local), "delete index dir");
    let core = open_local(&root, &sb.dirs, false);
    assert_eq!(core.objects(), objects);
    assert_eq!([CTENI, TOMAS, NAPAD, ROZPOCET].iter().map(|p| core.backlinks(p)).collect::<Vec<_>>(), backlinks);
    assert_eq!(core.snapshot(), dump);
}

// ---------------------------------------------------------------- FR-SYN-07

#[test]
fn fr_syn_07_ac2_core_works_with_networking_denied() {
    if std::env::var("TEGG_TEST_NETWORK_DENIED").is_ok() {
        // Inside the sandbox: every MS2 core feature.
        let sb = sandbox();
        let root = search_vault(&sb);
        let core = open_local(&root, &sb.dirs, true);
        assert_eq!(search_paths(&core, "rozpočet").len(), 5);
        assert!(!core.switcher("cteni", 10).is_empty());
        let (bytes, base) = ok!(core.read_note(CTENI, SystemTime::now()), "read_note");
        let new = String::from_utf8(bytes).unwrap_or_default().replace("Seznam knih", "Seznam knih offline");
        assert!(matches!(core.write_note(CTENI, new.as_bytes(), Some(&base)), Ok(WriteOutcome::Written(_))));
        let created = core.create_note("Pages", "Bez sítě", "Bez sítě: rosnatka.\n".as_bytes());
        assert_eq!(created.ok().as_deref(), Some("Pages/Bez sítě.md"));
        let seen = wait_until(Duration::from_secs(2), || search_paths(&core, "rosnatka") == set(&["Pages/Bez sítě.md"]));
        assert!(seen.is_some());
        return;
    }
    let exe = std::env::current_exe().unwrap_or_default();
    let out = std::process::Command::new("/usr/bin/sandbox-exec")
        .args(["-p", "(version 1)(allow default)(deny network*)"])
        .arg(&exe)
        .args(["--exact", "fr_syn_07_ac2_core_works_with_networking_denied", "--test-threads=1"])
        .env("TEGG_TEST_NETWORK_DENIED", "1")
        .output();
    assert!(out.is_ok(), "sandbox-exec could not start: {:?}", out.as_ref().err());
    let out = out.unwrap_or_else(|_| unreachable!());
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(out.status.success() && stdout.contains("1 passed"), "core failed without network:\n{stdout}\n{}", String::from_utf8_lossy(&out.stderr));
}
