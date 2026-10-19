//! MS5 slice 5B AC tests at the core (L4): the capture window's only write, `Core::capture_create`
//! (docs/acceptance/capture.md R57; docs/contracts/ms5-capture.md §3.3; D-540, D-552, AP-480). FR-CAP-04 AC-1 (one file,
//! these bytes, indexed at once), AC-2 (any capture type, its folder), AC-5 (file names: ` (2)`, D-68, D-80, 200 bytes,
//! NFC; the existing note untouched), AC-6 (create-exclusive: a kill before the rename leaves no `.md` and the next
//! start removes the temp file; a stem taken between plan and rename gives ` (2)`), AC-8 (the folder as defined at the
//! moment of the save, folders created); FR-CAP-01 AC-5 (a captured link resolves and is a backlink; an inline tag
//! counts); NFR-SEC-03 AC-3 (it never overwrites; it refuses Daily Note, Tag, Image, PDF, unknown keys and bytes
//! without the type, `review: unreviewed` or `captured`). Written from the ACs and the contract only (D-61). The bytes
//! are written literally as R57 gives them (the capture window builds them with `@tegg/doc`, tested at L1).
//!
//! Fixture: tests/fixtures/vaults/inbox + new-empty/.tegg in a temporary directory (its README.md isn't a vault file).

mod common;

use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use common::*;
use tegg_core::{Core, CoreError, CoreOptions, LinkKind};
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
const ID: &str = "01JB5B0000000000000000N001";
const Q1: &str = "Quick Notes/Koupit mléko.md";
const P2: &str = "Pages/Plán webu.md";

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
fn open(root: &Path, sb: &Sandbox) -> Core {
    let core = ok!(Core::open(root, &sb.dirs, CoreOptions { watch: false, sync: None }), "Core::open");
    assert!(core.wait_idle(Duration::from_secs(60)), "indexing did not become idle within 60 s");
    core
}
fn read(root: &Path, rel: &str) -> String {
    std::fs::read_to_string(root.join(rel)).unwrap_or_default()
}
/// Paths whose entry differs (bytes, mtime or inode), appeared or disappeared; NFC.
fn changed(a: &std::collections::BTreeMap<String, Entry>, b: &std::collections::BTreeMap<String, Entry>) -> Vec<String> {
    let keys: std::collections::BTreeSet<&String> = a.keys().chain(b.keys()).collect();
    keys.into_iter().filter(|k| a.get(*k) != b.get(*k)).map(|k| nfc(k)).collect()
}
fn strs(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}
/// R57 bytes of a captured object: `extra` lines go between `title` and `review` (schema keys, template keys, tags).
fn capture_bytes(r#type: &str, title_yaml: &str, extra: &str, body: &str) -> String {
    format!("---\nid: {ID}\ntype: {}\ntitle: {title_yaml}\n{extra}review: unreviewed\ncaptured: {NOW}\ncreated: {NOW}\nmodified: {NOW}\n---\n{body}", r#type)
}
fn quick(title_yaml: &str, body: &str) -> String {
    capture_bytes("quick-note", title_yaml, "", body)
}

// ------------------------------------------------------------------------------------------------ FR-CAP-04 AC-1

#[test]
fn fr_cap_04_ac1_capture_create_writes_exactly_one_file_indexed_at_once() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = open(&root, &sb);
    let before = snapshot(&root);
    let bytes = capture_bytes("quick-note", "Koupit dárek pro Janu", "tags: [nákup]\n", "Něco do 500 Kč, viz [[Plán webu]].\n");
    let path = ok!(core.capture_create("quick-note", "Koupit dárek pro Janu", bytes.as_bytes()), "capture_create");
    assert_eq!(nfc(&path), "Quick Notes/Koupit dárek pro Janu.md", "the type's folder, the sanitized title");
    assert_eq!(read(&root, &path), bytes, "exactly the given bytes");
    assert_eq!(changed(&before, &snapshot(&root)), strs(&["Quick Notes/Koupit dárek pro Janu.md"]), "exactly one file written");
    let o = core.object(&path);
    assert!(o.as_ref().is_some_and(|o| o.r#type == "quick-note" && o.id.as_deref() == Some(ID)), "indexed at once: {o:?}");
}

// ------------------------------------------------------------------------------------------------ FR-CAP-04 AC-2

#[test]
fn fr_cap_04_ac2_every_capture_type_writes_into_its_folder() {
    let body = "Něco do 500 Kč, viz [[Plán webu]].\n";
    let cases = [
        ("page", "Pages/Koupit dárek pro Janu.md", capture_bytes("page", "Koupit dárek pro Janu", "tags: [nákup]\n", body)),
        ("schůzka", "Schůzky/Koupit dárek pro Janu.md", capture_bytes("schůzka", "Koupit dárek pro Janu", "tags: [nákup]\n", body)),
        ("nápad", "Nápady/Koupit dárek pro Janu.md", capture_bytes("nápad", "Koupit dárek pro Janu", "hodnocení: 3\noblast: osobní\ntags: [nákup]\n", body)),
        ("task", "Tasks/Zavolat kominíkovi.md", capture_bytes("task", "Zavolat kominíkovi", "status: To do\npriority: High\ndue: 2026-10-15\ntags: [doma]\n", "")),
    ];
    for (key, want, bytes) in cases {
        // A fresh vault per type: stems are free vault-wide (D-291), so the same title twice in one vault gets ` (2)`.
        let sb = sandbox();
        let root = inbox_vault(&sb);
        let core = open(&root, &sb);
        let before = snapshot(&root);
        let title = if key == "task" { "Zavolat kominíkovi" } else { "Koupit dárek pro Janu" };
        let path = ok!(core.capture_create(key, title, bytes.as_bytes()), format!("capture_create({key})"));
        assert_eq!(nfc(&path), want, "{key}: path");
        assert_eq!(read(&root, &path), bytes, "{key}: bytes");
        assert_eq!(changed(&before, &snapshot(&root)), strs(&[want]), "{key}: one file");
    }
}

// ------------------------------------------------------------------------------------------------ FR-CAP-04 AC-5

#[test]
fn fr_cap_04_ac5_file_names_and_the_existing_note_untouched() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = open(&root, &sb);
    let q1 = snapshot(&root).get(Q1).cloned();
    let mut cases: Vec<(String, String, String)> = vec![
        ("Koupit mléko".into(), "Koupit mléko".into(), "Quick Notes/Koupit mléko (2).md".into()),
        ("Q3: plán/rozpočet".into(), "\"Q3: plán/rozpočet\"".into(), "Quick Notes/Q3 plán rozpočet.md".into()),
        ("C# tipy".into(), "\"C# tipy\"".into(), "Quick Notes/C tipy.md".into()),
        ("CON".into(), "CON".into(), "Quick Notes/CON_.md".into()),
    ];
    // NFD input becomes an NFC file name (FR-FMT-12).
    let nfd = "Čaj o páté".chars().flat_map(|c| match c { 'Č' => vec!['C', '\u{30C}'], 'á' => vec!['a', '\u{301}'], 'é' => vec!['e', '\u{301}'], x => vec![x] }).collect::<String>();
    cases.push((nfd.clone(), nfd.clone(), "Quick Notes/Čaj o páté.md".into()));
    for (title, yaml, want) in &cases {
        let path = ok!(core.capture_create("quick-note", title, quick(yaml, "").as_bytes()), format!("capture_create({title:?})"));
        assert_eq!(nfc(&path), *want, "{title:?}: file name");
        assert_eq!(path, nfc(&path), "{title:?}: the returned path is NFC");
        assert!(root.join(want).exists(), "{want} exists on disk");
    }
    assert_eq!(snapshot(&root).get(Q1).cloned(), q1, "Quick Notes/Koupit mléko.md untouched (bytes, mtime, inode)");
    // A 250-byte Czech title: the stem is cut to at most 200 UTF-8 bytes at a character boundary; the title stays whole.
    let long = format!("Řeřicha a {}konec", "žluťoučký kůň ".repeat(17));
    assert!(long.len() > 250, "fixture: {} bytes", long.len());
    let path = ok!(core.capture_create("quick-note", &long, quick(&long, "").as_bytes()), "capture_create(long)");
    let stem = Path::new(&path).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    assert!(stem.len() <= 200 && !stem.is_empty(), "stem of {} bytes", stem.len());
    assert!(long.starts_with(stem.trim_end()), "the stem is a prefix of the title, cut at a character boundary");
    assert!(read(&root, &path).contains(&format!("title: {long}\n")), "the full title");
}

// ------------------------------------------------------------------------------------------------ FR-CAP-04 AC-6

/// A kill after the temp write and before the rename (D-344: the wrapper lives in the test, over `LocalFs`).
struct KillBeforeRename {
    inner: LocalFs,
    dead: AtomicBool,
}
impl KillBeforeRename {
    fn hit(path: &str) -> bool {
        nfc(path).contains("Koupit dárek pro Janu")
    }
    fn gate(&self) -> io::Result<()> {
        if self.dead.load(Ordering::SeqCst) { Err(io::Error::other("killed (test)")) } else { Ok(()) }
    }
}
impl VaultFs for KillBeforeRename {
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
        self.gate()?;
        self.inner.replace(path, bytes)
    }
    fn create_new(&self, path: &str, bytes: &[u8]) -> io::Result<FileVersion> {
        self.gate()?;
        if Self::hit(path) {
            self.dead.store(true, Ordering::SeqCst);
            return Err(io::Error::other("killed before rename (test)"));
        }
        self.inner.create_new(path, bytes)
    }
    fn rename_no_replace(&self, from: &str, to: &str) -> io::Result<()> {
        self.gate()?;
        if Self::hit(to) {
            self.dead.store(true, Ordering::SeqCst);
            return Err(io::Error::other("killed before rename (test)"));
        }
        self.inner.rename_no_replace(from, to)
    }
    fn create_dir_all(&self, path: &str) -> io::Result<()> {
        self.gate()?;
        self.inner.create_dir_all(path)
    }
    fn remove_file(&self, path: &str) -> io::Result<()> {
        self.gate()?;
        self.inner.remove_file(path)
    }
    fn is_placeholder(&self, path: &str) -> io::Result<bool> {
        self.inner.is_placeholder(path)
    }
}

#[test]
fn fr_cap_04_ac6_a_kill_before_the_rename_leaves_no_note_and_the_temp_file_goes() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let before = snapshot(&root);
    let bytes = quick("Koupit dárek pro Janu", "Něco do 500 Kč.\n");
    {
        let fs = Arc::new(KillBeforeRename { inner: LocalFs::new(&root), dead: AtomicBool::new(false) });
        let core = ok!(Core::open_with(fs as Arc<dyn VaultFs>, &sb.dirs, CoreOptions { watch: false, sync: None }), "Core::open_with");
        assert!(core.wait_idle(Duration::from_secs(60)), "idle");
        let r = core.capture_create("quick-note", "Koupit dárek pro Janu", bytes.as_bytes());
        assert!(matches!(r, Err(CoreError::Vault(_))), "the killed write fails with a vault error: {r:?}");
    }
    assert!(!root.join("Quick Notes/Koupit dárek pro Janu.md").exists(), "no .md file");
    // The temp file the dead process left (`.<name>.tegg-tmp` in the target folder, D-344), older than a minute.
    write_raw(&root, "Quick Notes/.Koupit dárek pro Janu.md.tegg-tmp", &bytes.as_bytes()[..40]);
    let old = SystemTime::now() - Duration::from_secs(120);
    std::fs::File::options().write(true).open(root.join("Quick Notes/.Koupit dárek pro Janu.md.tegg-tmp")).and_then(|f| f.set_modified(old)).expect("setup: age the temp file");
    let core = open(&root, &sb);
    assert!(!root.join("Quick Notes/.Koupit dárek pro Janu.md.tegg-tmp").exists(), "the next launch removes the .tegg-tmp file (FR-SYN-02 AC-4)");
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "nothing else changed");
    // Then the capture is written once, on the plain file system.
    let path = ok!(core.capture_create("quick-note", "Koupit dárek pro Janu", bytes.as_bytes()), "capture_create after restart");
    assert_eq!(nfc(&path), "Quick Notes/Koupit dárek pro Janu.md");
}

/// Another program creates the planned file just before the exclusive create.
struct Racer {
    inner: LocalFs,
    root: PathBuf,
    raced: AtomicBool,
}
impl VaultFs for Racer {
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
        self.inner.replace(path, bytes)
    }
    fn create_new(&self, path: &str, bytes: &[u8]) -> io::Result<FileVersion> {
        self.race(path);
        self.inner.create_new(path, bytes)
    }
    fn rename_no_replace(&self, from: &str, to: &str) -> io::Result<()> {
        self.race(to);
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
impl Racer {
    fn race(&self, path: &str) {
        if nfc(path) == "Quick Notes/Koupit dárek pro Janu.md" && !self.raced.swap(true, Ordering::SeqCst) {
            std::fs::write(self.root.join("Quick Notes/Koupit dárek pro Janu.md"), b"Cizi soubor.\n").expect("setup: the other program's file");
        }
    }
}

#[test]
fn fr_cap_04_ac6_a_stem_taken_before_the_rename_gives_the_next_free_name() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let fs = Arc::new(Racer { inner: LocalFs::new(&root), root: root.clone(), raced: AtomicBool::new(false) });
    let core = ok!(Core::open_with(fs as Arc<dyn VaultFs>, &sb.dirs, CoreOptions { watch: false, sync: None }), "Core::open_with");
    assert!(core.wait_idle(Duration::from_secs(60)), "idle");
    let bytes = quick("Koupit dárek pro Janu", "");
    let path = ok!(core.capture_create("quick-note", "Koupit dárek pro Janu", bytes.as_bytes()), "capture_create");
    assert_eq!(nfc(&path), "Quick Notes/Koupit dárek pro Janu (2).md", "written as (2); the returned path names the file written");
    assert_eq!(read(&root, "Quick Notes/Koupit dárek pro Janu.md"), "Cizi soubor.\n", "the other file is untouched");
    assert_eq!(read(&root, &path), bytes, "the capture's bytes");
}

// ------------------------------------------------------------------------------------------------ FR-CAP-04 AC-8

#[test]
fn fr_cap_04_ac8_the_folder_as_defined_at_the_moment_of_saving() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = open(&root, &sb);
    let base = core.type_get("quick-note").and_then(|t| t.version);
    ok!(core.type_patch("quick-note", base.as_ref(), &[TypeOp::SetFolder("Doručené/Rychlé".into())]), "type_patch quick-note folder");
    assert!(!root.join("Doručené").exists(), "fixture: the folder doesn't exist yet");
    let path = ok!(core.capture_create("quick-note", "Nový nápad", quick("Nový nápad", "").as_bytes()), "capture_create");
    assert_eq!(nfc(&path), "Doručené/Rychlé/Nový nápad.md", "the folder from the type file at the save");
    assert!(root.join("Doručené/Rychlé/Nový nápad.md").exists(), "both folders created");
}

// ------------------------------------------------------------------------------------------------ FR-CAP-01 AC-5

#[test]
fn fr_cap_01_ac5_the_captured_link_resolves_and_is_a_backlink() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = open(&root, &sb);
    let bytes = quick("Schůzka k webu", "**Program:**\n- [ ] projít [[Plán webu]]\n- termín #práce\n");
    let path = ok!(core.capture_create("quick-note", "Schůzka k webu", bytes.as_bytes()), "capture_create");
    let t = core.resolve_links(&path, &["Plán webu".to_string()]);
    assert_eq!(t.first().map(|x| (x.kind, x.path.as_deref().map(nfc))), Some((LinkKind::Note, Some(P2.to_string()))), "link_resolve from the capture");
    assert!(core.backlinks(P2).iter().any(|p| nfc(p) == nfc(&path)), "Plán webu's backlinks list the capture");
    let o = core.object(&path);
    assert!(o.as_ref().is_some_and(|o| o.tags.iter().any(|t| nfc(t) == "práce")), "#práce in the body is a tag of the note (D-185): {o:?}");
    assert!(!read(&root, &path).contains("\ntags:"), "and isn't added to tags:");
}

// ------------------------------------------------------------------------------------------------ NFR-SEC-03 AC-3

#[test]
fn nfr_sec_03_ac3_refuses_types_that_are_not_capture_targets() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = open(&root, &sb);
    // Red guard: a valid capture is accepted.
    ok!(core.capture_create("quick-note", "Platný", quick("Platný", "").as_bytes()), "capture_create(quick-note)");
    let before = snapshot(&root);
    for key in ["daily-note", "tag", "image", "pdf", "neexistuje", "Daily Note"] {
        let bytes = capture_bytes(&key.to_lowercase().replace(' ', "-"), "Zkouška", "", "");
        let r = core.capture_create(key, "Zkouška", bytes.as_bytes());
        assert!(matches!(r, Err(CoreError::UnsupportedType)), "{key}: UnsupportedType, got {r:?}");
    }
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "nothing written");
}

#[test]
fn nfr_sec_03_ac3_refuses_bytes_that_are_not_a_capture() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = open(&root, &sb);
    ok!(core.capture_create("quick-note", "Platný", quick("Platný", "").as_bytes()), "capture_create(quick-note)");
    let before = snapshot(&root);
    let bad = [
        ("no review", format!("---\nid: {ID}\ntype: quick-note\ntitle: Zkouška\ncaptured: {NOW}\ncreated: {NOW}\nmodified: {NOW}\n---\n")),
        ("reviewed", format!("---\nid: {ID}\ntype: quick-note\ntitle: Zkouška\nreview: reviewed\ncaptured: {NOW}\ncreated: {NOW}\nmodified: {NOW}\n---\n")),
        ("no captured", format!("---\nid: {ID}\ntype: quick-note\ntitle: Zkouška\nreview: unreviewed\ncreated: {NOW}\nmodified: {NOW}\n---\n")),
        ("another type", capture_bytes("page", "Zkouška", "", "")),
        ("no frontmatter", "Zkouška\n".to_string()),
    ];
    for (what, bytes) in bad {
        let r = core.capture_create("quick-note", "Zkouška", bytes.as_bytes());
        assert!(matches!(r, Err(CoreError::NotACapture)), "{what}: NotACapture, got {r:?}");
    }
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "nothing written");
}

#[test]
fn nfr_sec_03_ac3_never_overwrites_an_existing_file() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = open(&root, &sb);
    let before = snapshot(&root);
    let existing: Vec<String> = before.keys().filter(|k| k.ends_with(".md")).cloned().collect();
    let mut written = Vec::new();
    for title in ["Koupit mléko", "Přečteno", "Dvojník", "Holý text", "Bez stavu", "Smazaná", "Quick Note", "Nápad na článek"] {
        match core.capture_create("quick-note", title, quick(title, "").as_bytes()) {
            Ok(p) => written.push(nfc(&p)),
            Err(e) => assert!(!matches!(e, CoreError::NotImplemented), "{title}: a real refusal or a new file, got {e:?}"),
        }
    }
    let after = snapshot(&root);
    for p in &existing {
        assert_eq!(before.get(p), after.get(p), "{p} is never overwritten");
    }
    let added: Vec<String> = changed(&before, &after).into_iter().filter(|p| !p.ends_with('/')).collect();
    assert_eq!(added.len(), written.len(), "every success is one new file: {added:?}");
    assert_eq!(written.len(), 8, "every title got a free stem");
    assert!(written.iter().all(|p| !existing.iter().any(|e| nfc(e) == *p)), "only new paths: {written:?}");
}
