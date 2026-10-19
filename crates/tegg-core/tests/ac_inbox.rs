//! MS5 slice 5B AC tests at the core (L4): the Inbox query and the writes of single Inbox actions
//! (docs/acceptance/inbox.md R61; docs/contracts/ms5-capture.md §7.1, §7.3; D-554…D-559). FR-INB-01 AC-1 (exactly the 13
//! members with their fields; `Unreviewed`), AC-2 (the raw stamps the UI's instants come from), AC-5 (the query follows
//! external changes), AC-8 (identical after a rebuild), AC-9 (a read-only file is listed and never written); FR-INB-02
//! AC-2 (the envelope of the written bytes), AC-3 (an external change is never overwritten), AC-4 (a failed write leaves
//! no partial or temp file; the retry writes), AC-5 (a converted Task is in the task query), AC-6 (append: two writes,
//! every link resolves as before; a virtual today's note gets its first write), AC-7 (append failures), AC-8 (link to:
//! backlinks and the D-184 target); FR-INB-03 AC-2 (core creates are members), AC-3 (opt-in per type); FR-INB-04 AC-1,
//! AC-2 (converting keeps `id`, path and links, also after a rebuild); FR-DLY-05 AC-5 (Daily Notes in the Inbox).
//! Interface: `Core::inbox_list`, `inbox_count` (new); `write_note`, `read_note`, `resolve_links`, `backlinks`, `tasks`,
//! `create_object`, `capture_create`, `daily_view`, `daily_draft`, `daily_create`, `type_patch` (existing). Single
//! actions are one `note_write` with the loaded version as base (§7.3); their bytes come from `@tegg/doc` (tested at
//! L1) and are written literally here. Written from the ACs and the contract only (D-61).
//!
//! Fixture: tests/fixtures/vaults/inbox + new-empty/.tegg in a temporary directory (its README.md isn't a vault file).

mod common;

use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use chrono::NaiveDate;
use common::*;
use tegg_core::{AppDirs, Core, CoreError, CoreOptions, InboxRow, LinkKind, TaskState, VaultError};
use tegg_format::nfc;
use tegg_schema::TypeOp;
use tegg_vault::{FileVersion, FsEntry, LocalFs, VaultFs};

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

const NOW: &str = "2026-10-14T12:00:00+02:00";
const Q1: &str = "Quick Notes/Koupit mléko.md";
const Q2: &str = "Quick Notes/Nápad na článek.md";
const Q3: &str = "Quick Notes/Přečteno.md";
const Q4: &str = "Quick Notes/Bez stavu.md";
const Q5: &str = "Quick Notes/Divná hodnota.md";
const Q6: &str = "Quick Notes/Žluťoučký kůň.md";
const Q7: &str = "Quick Notes/Bez offsetu.md";
const Q8: &str = "Quick Notes/Bez data.md";
const D1: &str = "Daily/2026-10-13.md";
const D2: &str = "Daily/2026-10-12.md";
const D3: &str = "Daily/2026-10-07.md";
const N1: &str = "Nápady/Aplikace na čaj.md";
const P1: &str = "Pages/Zachycená stránka.md";
const P2: &str = "Pages/Plán webu.md";
const T1: &str = "Tasks/Zavolat instalatérovi.md";
const S1: &str = "Schůzky/Porada týmu.md";
const DQ: &str = "Quick Notes/Dvojník.md";
const DP: &str = "Pages/Dvojník.md";
const MEMBERS: [&str; 13] = [Q1, Q2, Q4, Q5, Q6, Q7, Q8, D1, D3, N1, P1, T1, S1];

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
fn inbox_vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Doručené");
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fx.join("inbox"), &root, &["README.md"]);
    copy_dir(&fx.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    root
}
fn open_dirs(root: &Path, dirs: &AppDirs) -> Core {
    let core = ok!(Core::open(root, dirs, CoreOptions { watch: false, sync: None }), "Core::open");
    assert!(core.wait_idle(Duration::from_secs(60)), "indexing did not become idle within 60 s");
    core
}
fn open(root: &Path, sb: &Sandbox) -> Core {
    open_dirs(root, &sb.dirs)
}
fn read(root: &Path, rel: &str) -> String {
    std::fs::read_to_string(root.join(rel)).unwrap_or_default()
}
fn fixture(rel: &str) -> String {
    std::fs::read_to_string(repo_root().join("tests/fixtures/vaults/inbox").join(rel)).expect("setup: fixture file")
}
fn swap(text: &str, from: &str, to: &str) -> String {
    assert!(text.contains(from), "fixture no longer contains {from:?}");
    text.replacen(from, to, 1)
}
fn changed(a: &BTreeMap<String, Entry>, b: &BTreeMap<String, Entry>) -> Vec<String> {
    let keys: std::collections::BTreeSet<&String> = a.keys().chain(b.keys()).collect();
    keys.into_iter().filter(|k| a.get(*k) != b.get(*k)).map(|k| nfc(k)).collect()
}
fn strs(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}
fn paths(rows: &[InboxRow]) -> Vec<String> {
    rows.iter().map(|r| nfc(&r.path)).collect()
}
fn sorted(v: &[&str]) -> Vec<String> {
    let mut out: Vec<String> = v.iter().map(|s| nfc(s)).collect();
    out.sort();
    out
}
fn listed(core: &Core, p: &str) -> bool {
    core.inbox_list().iter().any(|r| nfc(&r.path) == nfc(p))
}
fn version(core: &Core, rel: &str) -> FileVersion {
    ok!(core.read_note(rel, SystemTime::now()), format!("read_note {rel}")).1
}
fn resolves(core: &Core, from: &str, target: &str) -> (LinkKind, Option<String>) {
    let t = core.resolve_links(from, &[target.to_string()]).into_iter().next().expect("one result per target");
    (t.kind, t.path.map(|p| nfc(&p)))
}
fn note(p: &str) -> (LinkKind, Option<String>) {
    (LinkKind::Note, Some(p.to_string()))
}
fn day(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").expect("date")
}
/// The fixture text with `review` set and `modified` → NOW (FR-INB-02 AC-1's rule).
fn reviewed(rel: &str, from_review: &str, to_review: &str, modified: &str) -> String {
    swap(&swap(&fixture(rel), from_review, to_review), modified, &format!("modified: {NOW}"))
}

// ------------------------------------------------------------------------------------------------ FR-INB-01 AC-1

#[test]
fn fr_inb_01_ac1_the_query_lists_exactly_the_13_members() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = open(&root, &sb);
    let rows = core.inbox_list();
    assert_eq!(paths(&rows), sorted(&MEMBERS), "exactly R61's 13 items, in path order");
    assert_eq!(core.inbox_count(), 13, "inbox_count");
    for never in [Q3, D2, "Nápady/Starý nápad.md", P2, "Quick Notes/Holý text.md", DQ, DP, "_templates/Quick Note/Quick Note.md", "_templates/Nápad/Nápad.md", ".trash/Quick Notes/Smazaná.md"] {
        assert!(!listed(&core, never), "{never} is never listed");
    }
    let by: BTreeMap<String, InboxRow> = rows.into_iter().map(|r| (nfc(&r.path), r)).collect();
    let q1 = by.get(Q1).cloned();
    assert_eq!(
        q1.map(|r| (r.id, r.title, r.r#type, r.review_raw, r.captured, r.created, r.modified, r.tags, r.excerpt, r.read_only)),
        Some((
            Some("01JB5B0000000000000000F001".to_string()), "Koupit mléko".to_string(), "quick-note".to_string(), Some("unreviewed".to_string()),
            Some("2026-10-14T08:15:00+02:00".to_string()), Some("2026-10-14T08:15:00+02:00".to_string()), Some("2026-10-14T08:15:00+02:00".to_string()),
            strs(&["nákup"]), "Polotučné, 2 litry.".to_string(), false,
        )),
        "Q1's row"
    );
    assert_eq!(by.get(N1).and_then(|r| r.review_raw.clone()).as_deref(), Some("unreviewed"), "N1: a quoted value");
    assert_eq!(by.get(Q5).and_then(|r| r.review_raw.clone()).as_deref(), Some("maybe"), "Q5: raw");
    assert_eq!(by.get(Q4).map(|r| r.review_raw.clone()), Some(None), "Q4: missing");
    assert_eq!(by.get(Q6).map(|r| r.title.clone()), Some(nfc("Žluťoučký kůň")), "Q6: title NFC");
    assert_eq!(by.get(D1).map(|r| (r.title.clone(), r.r#type.clone())), Some(("2026-10-13".to_string(), "daily-note".to_string())), "D1");
    assert_eq!(by.get(S1).map(|r| r.r#type.clone()).as_deref(), Some("schůzka"), "S1: matched key");
    assert_eq!(by.get(Q2).map(|r| r.excerpt.clone()).as_deref(), Some("O synchronizaci přes Dropbox. Viz Plán webu."), "Q2: plain text, no link brackets");
}

#[test]
fn fr_inb_01_ac1_unreviewed_with_a_capital_u() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    write_raw(&root, "Pages/Velké U.md", b"---\nid: 01JB5B0000000000000000R101\ntype: page\ntitle: Velk\xc3\xa9 U\nreview: Unreviewed\ncreated: 2026-10-14T11:00:00+02:00\nmodified: 2026-10-14T11:00:00+02:00\n---\n");
    write_raw(&root, "Quick Notes/Velké U.md", b"---\nid: 01JB5B0000000000000000R102\ntype: quick-note\ntitle: Velk\xc3\xa9 U\nreview: Unreviewed\ncreated: 2026-10-14T11:00:00+02:00\nmodified: 2026-10-14T11:00:00+02:00\n---\n");
    let core = open(&root, &sb);
    assert!(!listed(&core, "Pages/Velké U.md"), "a Page with review: Unreviewed isn't listed");
    assert!(listed(&core, "Quick Notes/Velké U.md"), "a Quick Note with an unknown value is (locked type)");
    assert_eq!(core.inbox_count(), 14, "13 + 1");
}

// ------------------------------------------------------------------------------------------------ FR-INB-01 AC-2

#[test]
fn fr_inb_01_ac2_rows_carry_the_raw_stamps_for_the_instants() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = open(&root, &sb);
    let by: BTreeMap<String, InboxRow> = core.inbox_list().into_iter().map(|r| (nfc(&r.path), r)).collect();
    let stamps = |p: &str| by.get(p).map(|r| (r.captured.clone(), r.created.clone(), r.modified.clone()));
    assert_eq!(stamps(Q7), Some((None, Some("2026-10-14T06:30:00".into()), Some("2026-10-14T06:30:00".into()))), "Q7: offset-less, as written (D-365 in the UI)");
    assert_eq!(stamps(Q8), Some((None, None, None)), "Q8: none");
    assert_eq!(stamps(Q2), Some((None, Some("2026-10-13T21:40:00+02:00".into()), Some("2026-10-13T21:40:00+02:00".into()))), "Q2: created");
    assert_eq!(stamps(P1).and_then(|s| s.0), Some("2026-10-11T18:20:00+02:00".into()), "P1: captured");
}

// ------------------------------------------------------------------------------------------------ FR-INB-01 AC-5

#[test]
fn fr_inb_01_ac5_the_query_follows_external_changes() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = open(&root, &sb);
    assert_eq!(core.inbox_count(), 13, "start: 13");
    write_raw(&root, "Quick Notes/Odjinud.md", b"---\nid: 01JB5B0000000000000000R201\ntype: quick-note\ntitle: Odjinud\nreview: unreviewed\ncreated: 2026-10-14T11:30:00+02:00\nmodified: 2026-10-14T11:30:00+02:00\n---\n");
    core.notify_changed(&strs(&["Quick Notes/Odjinud.md"]));
    assert!(wait_until(Duration::from_secs(2), || listed(&core, "Quick Notes/Odjinud.md")).is_some(), "a new unreviewed Quick Note from another program is listed within 2 s");
    write_raw(&root, Q1, reviewed(Q1, "review: unreviewed", "review: reviewed", "modified: 2026-10-14T08:15:00+02:00").as_bytes());
    core.notify_changed(&strs(&[Q1]));
    assert!(wait_until(Duration::from_secs(2), || !listed(&core, Q1)).is_some(), "Q1 reviewed elsewhere leaves");
    std::fs::rename(root.join(Q2), root.join(".trash/Quick Notes/Nápad na článek.md")).expect("setup: move into .trash");
    core.notify_changed(&strs(&[Q2, ".trash/Quick Notes/Nápad na článek.md"]));
    assert!(wait_until(Duration::from_secs(2), || !listed(&core, Q2)).is_some(), "Q2 moved into .trash/ leaves");
    std::fs::remove_file(root.join(Q4)).expect("setup: delete");
    core.notify_changed(&strs(&[Q4]));
    assert!(wait_until(Duration::from_secs(2), || !listed(&core, Q4)).is_some(), "Q4 deleted leaves");
    write_raw(&root, S1, swap(&fixture(S1), "type: schůzka", "type: page").as_bytes());
    core.notify_changed(&strs(&[S1]));
    assert!(
        wait_until(Duration::from_secs(2), || core.inbox_list().iter().any(|r| nfc(&r.path) == S1 && r.r#type == "page")).is_some(),
        "S1 changed to page stays (explicit unreviewed) with the type page"
    );
    assert_eq!(core.inbox_count(), 13 + 1 - 3, "the count follows");
}

// ------------------------------------------------------------------------------------------------ FR-INB-01 AC-8

#[test]
fn fr_inb_01_ac8_the_query_is_identical_after_a_rebuild() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let first = open(&root, &sb).inbox_list();
    assert_eq!(first.len(), 13, "13 items");
    let rebuilt = open_dirs(&root, &fresh_dirs(&sb, "Bez indexu")).inbox_list();
    assert_eq!(rebuilt, first, "identical rows from the files alone (AR-01, NFR-POR-03)");
}

// ------------------------------------------------------------------------------------------------ FR-INB-01 AC-9

#[test]
fn fr_inb_01_ac9_a_read_only_file_is_listed_and_never_written() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let mut bytes = fixture(Q1).into_bytes();
    let at = bytes.windows(4).position(|w| w == b"Polo").expect("fixture body");
    bytes.insert(at, 0xFF);
    write_raw(&root, "Quick Notes/Koupit mléko kopie.md", &bytes);
    let core = open(&root, &sb);
    let row = core.inbox_list().into_iter().find(|r| nfc(&r.path) == "Quick Notes/Koupit mléko kopie.md");
    assert!(row.as_ref().is_some_and(|r| r.read_only), "listed, read-only (D-180): {row:?}");
    let before = snapshot(&root);
    let base = version(&core, "Quick Notes/Koupit mléko kopie.md");
    let r = core.write_note("Quick Notes/Koupit mléko kopie.md", b"---\nreview: reviewed\n---\n", Some(&base));
    assert!(matches!(r, Err(CoreError::NotUtf8)), "never written: {r:?}");
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "bytes, mtime and inode unchanged");
}

// ------------------------------------------------------------------------------------------------ FR-INB-02 AC-2

#[test]
fn fr_inb_02_ac2_written_bytes_keep_the_envelope_and_leave_the_inbox() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = open(&root, &sb);
    for p in [Q5, Q6, N1, S1, Q4, Q8] {
        assert!(listed(&core, p), "{p} is listed before");
    }
    let q5 = fixture(Q5);
    let cases = [
        (Q5, swap(&swap(&q5, "review: maybe\r\n", "review: reviewed\r\n"), "modified: 2026-10-09T16:45:00+02:00\r\n", &format!("modified: {NOW}\r\n"))),
        (Q6, reviewed(Q6, "review: unreviewed", "review: reviewed", "modified: 2026-10-14T10:00:00+02:00")),
        (N1, reviewed(N1, "review: \"unreviewed\"", "review: \"reviewed\"", "modified: 2026-10-14T09:00:00+02:00")),
        (S1, reviewed(S1, "review: unreviewed", "review: reviewed", "modified: 2026-10-12T14:00:00+02:00")),
        (Q4, swap(&fixture(Q4), "modified: 2026-10-10T10:00:00+02:00\n---\n", &format!("modified: {NOW}\nreview: reviewed\n---\n"))),
        (Q8, swap(&fixture(Q8), "review: unreviewed\n---\n", &format!("review: reviewed\nmodified: {NOW}\n---\n"))),
    ];
    for (p, text) in cases {
        let base = version(&core, p);
        ok!(core.write_note(p, text.as_bytes(), Some(&base)), format!("write {p}"));
        assert_eq!(std::fs::read(root.join(p)).unwrap_or_default(), text.as_bytes(), "{p}: exactly these bytes on disk");
        assert!(!listed(&core, p), "{p}: reviewed, no longer listed");
    }
    assert_eq!(core.inbox_count(), 7, "13 − 6");
}

// ------------------------------------------------------------------------------------------------ FR-INB-02 AC-3

#[test]
fn fr_inb_02_ac3_an_external_change_is_never_overwritten() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = open(&root, &sb);
    assert!(listed(&core, Q1), "Q1 listed");
    let base = version(&core, Q1);
    let theirs = swap(&fixture(Q1), "Polotučné, 2 litry.", "Polotučné, 3 litry (změněno jinde).");
    write_raw(&root, Q1, theirs.as_bytes()); // no notify: changed on disk without an event
    let mine = reviewed(Q1, "review: unreviewed", "review: reviewed", "modified: 2026-10-14T08:15:00+02:00");
    let r = core.write_note(Q1, mine.as_bytes(), Some(&base));
    assert!(matches!(r, Err(CoreError::Vault(VaultError::Conflict { .. }))), "refused with Conflict: {r:?}");
    assert_eq!(read(&root, Q1), theirs, "the file keeps the external bytes");
    core.notify_changed(&strs(&[Q1]));
    assert!(
        wait_until(Duration::from_secs(2), || core.inbox_list().iter().any(|x| nfc(&x.path) == Q1 && x.excerpt.contains("3 litry"))).is_some(),
        "the reloaded card shows the external text"
    );
}

// ------------------------------------------------------------------------------------------------ FR-INB-02 AC-4

/// Fails every replacing write of one path with `Io` before anything is written.
struct FailWrites {
    inner: LocalFs,
    path: String,
    fail: AtomicBool,
}
impl VaultFs for FailWrites {
    fn list(&self) -> io::Result<Vec<FsEntry>> {
        self.inner.list()
    }
    fn read(&self, path: &str) -> io::Result<(Vec<u8>, FileVersion)> {
        self.inner.read(path)
    }
    fn version(&self, path: &str) -> io::Result<Option<FileVersion>> {
        self.inner.version(path)
    }
    fn replace(&self, path: &str, bytes: &[u8]) -> io::Result<FileVersion> {
        if nfc(path) == self.path && self.fail.load(Ordering::SeqCst) {
            return Err(io::Error::other("disk full (test)"));
        }
        self.inner.replace(path, bytes)
    }
    fn create_new(&self, path: &str, bytes: &[u8]) -> io::Result<FileVersion> {
        self.inner.create_new(path, bytes)
    }
    fn rename_no_replace(&self, from: &str, to: &str) -> io::Result<()> {
        self.inner.rename_no_replace(from, to)
    }
    fn create_dir_all(&self, path: &str) -> io::Result<()> {
        self.inner.create_dir_all(path)
    }
    fn remove_file(&self, path: &str) -> io::Result<()> {
        self.inner.remove_file(path)
    }
    fn is_placeholder(&self, path: &str) -> io::Result<bool> {
        self.inner.is_placeholder(path)
    }
}
fn open_failing(root: &Path, sb: &Sandbox, path: &str) -> (Core, Arc<FailWrites>) {
    let fs = Arc::new(FailWrites { inner: LocalFs::new(root), path: path.to_string(), fail: AtomicBool::new(true) });
    let core = ok!(Core::open_with(fs.clone() as Arc<dyn VaultFs>, &sb.dirs, CoreOptions { watch: false, sync: None }), "Core::open_with");
    assert!(core.wait_idle(Duration::from_secs(60)), "idle");
    (core, fs)
}

#[test]
fn fr_inb_02_ac4_a_failed_write_leaves_nothing_and_try_again_writes() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let (core, fs) = open_failing(&root, &sb, Q1);
    assert!(listed(&core, Q1), "Q1 listed");
    let before = snapshot(&root);
    let base = version(&core, Q1);
    let mine = reviewed(Q1, "review: unreviewed", "review: reviewed", "modified: 2026-10-14T08:15:00+02:00");
    assert!(core.write_note(Q1, mine.as_bytes(), Some(&base)).is_err(), "the write fails (Io)");
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "no partial or temp file");
    assert!(listed(&core, Q1), "still unreviewed");
    fs.fail.store(false, Ordering::SeqCst);
    let base = version(&core, Q1);
    ok!(core.write_note(Q1, mine.as_bytes(), Some(&base)), "Try again with the current base");
    assert_eq!(read(&root, Q1), mine, "written");
    assert!(!listed(&core, Q1), "reviewed");
}

// ------------------------------------------------------------------------------------------------ FR-INB-02 AC-5

#[test]
fn fr_inb_02_ac5_a_quick_note_converted_to_task_is_an_open_unscheduled_task() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = open(&root, &sb);
    assert!(listed(&core, Q1), "Q1 listed before");
    let base = version(&core, Q1);
    let text = swap(&reviewed(Q1, "review: unreviewed", "review: reviewed", "modified: 2026-10-14T08:15:00+02:00"), "type: quick-note", "type: task");
    let before = snapshot(&root);
    ok!(core.write_note(Q1, text.as_bytes(), Some(&base)), "write Q1 converted");
    assert_eq!(changed(&before, &snapshot(&root)), strs(&[Q1]), "one write, the file stays at its path (D-372)");
    let t = core.tasks().into_iter().find(|t| nfc(&t.path) == Q1);
    assert!(t.as_ref().is_some_and(|t| t.status.is_none() && t.state == TaskState::Open && t.due.is_none()), "Open, Not scheduled, No status (D-471): {t:?}");
    assert!(!listed(&core, Q1), "converted and reviewed (D-557)");
}

// ------------------------------------------------------------------------------------------------ FR-INB-02 AC-6

#[test]
fn fr_inb_02_ac6_append_writes_the_target_then_the_item_and_links_keep_resolving() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = open(&root, &sb);
    assert!(listed(&core, Q4), "Q4 listed before");
    let links_before: Vec<_> = [(Q4, "Dvojník"), (Q4, "Plán webu"), (P2, "Nápad na článek"), (P2, "Dvojník")].iter().map(|(f, t)| resolves(&core, f, t)).collect();
    assert_eq!(links_before, vec![note(DQ), note(P2), note(Q2), note(DP)], "fixture resolution (D-291)");
    let before = snapshot(&root);
    let target = swap(&fixture(P2), "modified: 2026-10-01T09:00:00+02:00", &format!("modified: {NOW}")) + "\n## Bez stavu\n\nViz [[Quick Notes/Dvojník|Dvojník]] a [[Plán webu]].\n";
    let b1 = version(&core, P2);
    ok!(core.write_note(P2, target.as_bytes(), Some(&b1)), "write the target first");
    let item = swap(&fixture(Q4), "modified: 2026-10-10T10:00:00+02:00\n---\n", &format!("modified: {NOW}\nreview: reviewed\n---\n"));
    let b2 = version(&core, Q4);
    ok!(core.write_note(Q4, item.as_bytes(), Some(&b2)), "then the item");
    assert_eq!(changed(&before, &snapshot(&root)), sorted(&[P2, Q4]), "exactly the two files");
    // The appended link resolves from Pages/ to DQ, as it did from Quick Notes/; every earlier link resolves as before.
    assert_eq!(resolves(&core, P2, "Quick Notes/Dvojník"), note(DQ), "the re-targeted link resolves to DQ");
    let links_after: Vec<_> = [(Q4, "Dvojník"), (Q4, "Plán webu"), (P2, "Nápad na článek"), (P2, "Dvojník")].iter().map(|(f, t)| resolves(&core, f, t)).collect();
    assert_eq!(links_after, links_before, "every link resolves to the same file");
    assert!(root.join(Q4).exists(), "Q4 is kept");
    assert!(!listed(&core, Q4), "Q4 reviewed");
}

#[test]
fn fr_inb_02_ac6_append_to_a_virtual_todays_note_is_its_first_write() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = open(&root, &sb);
    assert!(listed(&core, Q1), "Q1 listed before");
    assert_eq!(core.daily_view(day("2026-10-14")).path, None, "fixture: today's note is virtual");
    let draft = ok!(core.daily_draft(day("2026-10-14")), "daily_draft");
    let text = draft.text.replace("{{id}}", "01JB5B0000000000000000N014").replace("{{now}}", NOW) + "## Koupit mléko\n\nPolotučné, 2 litry.\n";
    let made = ok!(core.daily_create(day("2026-10-14"), text.as_bytes()), "daily_create with the appended section");
    assert_eq!(nfc(&made.path), "Daily/2026-10-14.md", "the first write");
    assert_eq!(read(&root, "Daily/2026-10-14.md"), text, "the appended section as the body after the template");
    assert!(listed(&core, "Daily/2026-10-14.md"), "the new Daily Note is unreviewed (FR-DLY-05 AC-1)");
}

// ------------------------------------------------------------------------------------------------ FR-INB-02 AC-7

#[test]
fn fr_inb_02_ac7_a_changed_target_writes_neither_file() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = open(&root, &sb);
    assert!(listed(&core, Q4), "Q4 listed");
    let b1 = version(&core, P2);
    let theirs = fixture(P2) + "\nDopsáno jinde.\n";
    write_raw(&root, P2, theirs.as_bytes());
    let before = snapshot(&root);
    let target = swap(&fixture(P2), "modified: 2026-10-01T09:00:00+02:00", &format!("modified: {NOW}")) + "\n## Bez stavu\n\nViz [[Quick Notes/Dvojník|Dvojník]] a [[Plán webu]].\n";
    let r = core.write_note(P2, target.as_bytes(), Some(&b1));
    assert!(matches!(r, Err(CoreError::Vault(VaultError::Conflict { .. }))), "the target write is refused: {r:?}");
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "nothing written to either file (the item waits for the target)");
    assert!(listed(&core, Q4), "the item stays unreviewed");
}

#[test]
fn fr_inb_02_ac7_a_failed_item_write_keeps_it_unreviewed_and_try_again_writes_only_review() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let (core, fs) = open_failing(&root, &sb, Q4);
    assert!(listed(&core, Q4), "Q4 listed");
    let target = swap(&fixture(P2), "modified: 2026-10-01T09:00:00+02:00", &format!("modified: {NOW}")) + "\n## Bez stavu\n\nViz [[Quick Notes/Dvojník|Dvojník]] a [[Plán webu]].\n";
    let b1 = version(&core, P2);
    ok!(core.write_note(P2, target.as_bytes(), Some(&b1)), "the target write");
    let item = swap(&fixture(Q4), "modified: 2026-10-10T10:00:00+02:00\n---\n", &format!("modified: {NOW}\nreview: reviewed\n---\n"));
    let b2 = version(&core, Q4);
    assert!(core.write_note(Q4, item.as_bytes(), Some(&b2)).is_err(), "the item write fails");
    assert!(listed(&core, Q4), "the item stays unreviewed (its content is in both files: duplicated, nothing lost)");
    fs.fail.store(false, Ordering::SeqCst);
    let after_target = read(&root, P2);
    let b2 = version(&core, Q4);
    ok!(core.write_note(Q4, item.as_bytes(), Some(&b2)), "Try again: only the item's review");
    assert_eq!(read(&root, P2), after_target, "no second append");
    assert_eq!(read(&root, Q4), item, "the item is reviewed");
}

// ------------------------------------------------------------------------------------------------ FR-INB-02 AC-8

#[test]
fn fr_inb_02_ac8_link_to_makes_a_backlink_and_uses_the_d184_target() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = open(&root, &sb);
    let base = version(&core, Q1);
    let text = swap(&fixture(Q1), "modified: 2026-10-14T08:15:00+02:00", &format!("modified: {NOW}")) + "\n[[Plán webu]]\n";
    ok!(core.write_note(Q1, text.as_bytes(), Some(&base)), "write Q1 with the link");
    assert!(core.backlinks(P2).iter().any(|p| nfc(p) == Q1), "Plán webu's backlinks list Koupit mléko (D-368)");
    assert!(listed(&core, Q1), "review unchanged: still listed (D-559)");
    assert_eq!(resolves(&core, Q1, "Dvojník"), note(DQ), "from Quick Notes/ the stem resolves to DQ");
    assert_eq!(resolves(&core, Q1, "Pages/Dvojník"), note(DP), "so DP is linked as [[Pages/Dvojník|Dvojník]] (D-184)");
}

// ------------------------------------------------------------------------------------------------ FR-INB-03 AC-2

#[test]
fn fr_inb_03_ac2_core_creates_of_quick_notes_are_members() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = open(&root, &sb);
    let created = format!("---\nid: 01JB5B0000000000000000N301\ntype: quick-note\ntitle: Nová rychlá\nreview: unreviewed\ncreated: {NOW}\nmodified: {NOW}\n---\n");
    let p1 = ok!(core.create_object("quick-note", "Nová rychlá", created.as_bytes()), "create_object (⌘N draft's first write, switcher, [[, @, Create offer)");
    let captured = format!("---\nid: 01JB5B0000000000000000N302\ntype: quick-note\ntitle: Zachyceno\nreview: unreviewed\ncaptured: {NOW}\ncreated: {NOW}\nmodified: {NOW}\n---\n");
    let p2 = ok!(core.capture_create("quick-note", "Zachyceno", captured.as_bytes()), "capture_create");
    assert!(listed(&core, &p1) && listed(&core, &p2), "both new Quick Notes are in the Inbox at once");
    assert_eq!(core.inbox_count(), 15, "13 + 2");
}

// ------------------------------------------------------------------------------------------------ FR-INB-03 AC-3

#[test]
fn fr_inb_03_ac3_review_is_opt_in_per_type() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = open(&root, &sb);
    let napad = format!("---\nid: 01JB5B0000000000000000N311\ntype: nápad\ntitle: Nový nápad\nhodnocení: 3\noblast: osobní\nreview: unreviewed\ncreated: {NOW}\nmodified: {NOW}\n---\n");
    let pn = ok!(core.create_object("nápad", "Nový nápad", napad.as_bytes()), "create a Nápad");
    let schuzka = format!("---\nid: 01JB5B0000000000000000N312\ntype: schůzka\ntitle: Nová schůzka\ncreated: {NOW}\nmodified: {NOW}\n---\n");
    let ps = ok!(core.create_object("schůzka", "Nová schůzka", schuzka.as_bytes()), "create a Schůzka");
    assert!(listed(&core, &pn), "a new Nápad (review on) is listed");
    assert!(!listed(&core, &ps), "a new Schůzka (review off, no key) isn't");
    let before = snapshot(&root);
    let v = core.type_get("schůzka").and_then(|t| t.version);
    ok!(core.type_patch("schůzka", v.as_ref(), &[TypeOp::SetReview(true)]), "Schůzka review on");
    assert_eq!(changed(&before, &snapshot(&root)), strs(&[".tegg/types/schůzka.yml"]), "toggling writes only the type file");
    assert!(!listed(&core, &ps), "a Schůzka without the key stays unlisted");
    assert!(listed(&core, S1), "S1 (explicit unreviewed) is listed whatever the switch");
    let v = core.type_get("nápad").and_then(|t| t.version);
    ok!(core.type_patch("nápad", v.as_ref(), &[TypeOp::SetReview(false)]), "Nápad review off");
    assert!(listed(&core, N1), "N1 stays listed");
}

// ------------------------------------------------------------------------------------------------ FR-INB-04 AC-1, AC-2

fn converted_q2() -> String {
    swap(&swap(&fixture(Q2), "type: quick-note", "type: nápad"), "review: unreviewed", "review: reviewed").replacen("modified: 2026-10-13T21:40:00+02:00", &format!("modified: {NOW}"), 1)
}

#[test]
fn fr_inb_04_ac1_converting_q2_keeps_id_path_and_links() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = open(&root, &sb);
    assert!(listed(&core, Q2), "Q2 listed before");
    let base = version(&core, Q2);
    let text = converted_q2();
    ok!(core.write_note(Q2, text.as_bytes(), Some(&base)), "write Q2 converted");
    let o = core.object(Q2);
    assert!(o.as_ref().is_some_and(|o| o.r#type == "nápad" && o.id.as_deref() == Some("01JB5B0000000000000000F002")), "type nápad, same id, same path: {o:?}");
    assert_eq!(resolves(&core, P2, "Nápad na článek"), note(Q2), "P2's link still resolves to Q2");
    assert!(core.backlinks(Q2).iter().any(|p| nfc(p) == P2), "Q2's backlinks still list P2");
    assert_eq!(resolves(&core, Q2, "Plán webu"), note(P2), "Q2's [[Plán webu]] still resolves");
    assert!(!listed(&core, Q2), "converted = reviewed");
}

#[test]
fn fr_inb_04_ac2_the_same_after_a_rebuild() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    {
        let core = open(&root, &sb);
        assert!(listed(&core, Q2), "Q2 listed before");
        let base = version(&core, Q2);
        ok!(core.write_note(Q2, converted_q2().as_bytes(), Some(&base)), "write Q2 converted");
    }
    let core = open_dirs(&root, &fresh_dirs(&sb, "Znovu"));
    let o = core.object(Q2);
    assert!(o.as_ref().is_some_and(|o| o.r#type == "nápad" && o.id.as_deref() == Some("01JB5B0000000000000000F002")), "after a rebuild: {o:?}");
    assert_eq!(resolves(&core, P2, "Nápad na článek"), note(Q2), "links");
    assert!(core.backlinks(Q2).iter().any(|p| nfc(p) == P2), "backlinks");
    assert_eq!(core.inbox_count(), 12, "the Inbox without Q2");
}

// ------------------------------------------------------------------------------------------------ FR-DLY-05 AC-5

#[test]
fn fr_dly_05_ac5_daily_notes_in_the_inbox() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = open(&root, &sb);
    assert!(listed(&core, D1) && listed(&core, D3), "D1 and D3 are listed");
    assert!(!listed(&core, D2), "D2 (reviewed) isn't");
    assert_eq!(core.daily_view(day("2026-10-14")).path, None, "today is virtual");
    assert!(!core.inbox_list().iter().any(|r| r.path.contains("2026-10-14")), "a virtual Daily Note is never listed");
    let draft = ok!(core.daily_draft(day("2026-10-14")), "daily_draft");
    let text = draft.text.replace("{{id}}", "01JB5B0000000000000000N401").replace("{{now}}", NOW) + "D\n";
    assert!(text.contains("\nreview: unreviewed\n"), "the first write carries review: unreviewed (FR-DLY-05 AC-1)");
    let made = ok!(core.daily_create(day("2026-10-14"), text.as_bytes()), "the first write");
    assert!(listed(&core, &made.path), "listed at once");
}
