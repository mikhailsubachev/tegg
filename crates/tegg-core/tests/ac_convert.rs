//! MS5 slice 5A-2 AC tests at the core (L4): block → object conversion (docs/acceptance/conversion.md; D-490…D-499).
//! FR-CNV-02 AC-3 (backlinks follow the moved link), AC-7 (NFC file name), FR-CNV-03 AC-1 (the create: one new file,
//! create-exclusive), AC-5 (free stems vault-wide, a stem taken between the popover and the write), AC-10 (a virtual
//! Daily Note as source: the task, then the Daily Note's first write), AC-11 (the written embed resolves to the new
//! file); FR-CNV-04 AC-1 (`source` resolves back, also from a planned path), AC-3 (backlinks both ways); FR-CNV-06
//! AC-1 (`note_discard`: an unchanged new file is deleted, never trashed), AC-2 (redo: create exact, next free stem
//! when taken), AC-3 (a changed new file is trashed). Every conversion test ends with the conversion's undo at the
//! core (the source's save, then `note_discard` of the new file, §11.4, §11.9 item 2), so it also checks that no
//! residue is left (FR-CNV-06 AC-1). Interface docs/contracts/ms5-tasks.md §11.2, §11.6 (`Core::discard_note`, new;
//! `create_object`, `create_exact`, `trash_note`, `write_note`, `resolve_links`, `daily_create`, `backlinks`
//! unchanged). Written from the ACs and the contract only (D-61). The new object's bytes are written literally here as
//! the AC gives them (the app builds them with `@tegg/doc` `newObject`, tested at L1).
//!
//! Not here (they can't be red, `./verify check-red`, see the red-test report AP-457): FR-CNV-01 AC-6's refusal
//! (`create_object("daily-note")` → `UseDailyNote`, already ac_daily.rs), FR-CNV-03 AC-6's failed create and FR-CNV-05
//! AC-7's base check (`write_note` with a stale base, already ac_tasks.rs FR-TSK-02 AC-11); their L5 tests cover them.
//!
//! Fixture: tests/fixtures/vaults/tasks + new-empty/.tegg in a temporary directory (its README.md isn't a vault file).
//! Bytes, mtime and inode are compared with `common::snapshot`.

mod common;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use common::*;
use tegg_core::{Core, CoreError, CoreOptions, LinkKind, VaultError};
use tegg_format::nfc;

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

const BLOKY: &str = "Pages/Bloky.md";
const LEPIDLO: &str = "Pages/Koupit lepidlo.md";
const ZASEDACKA: &str = "Pages/Zasedačka.md";
const DVOJNIK_P: &str = "Pages/Dvojník.md";
const DVOJNIK_Q: &str = "Quick Notes/Dvojník.md";
const C_TIPS: &str = "Pages/C tips.md";
const NEW: &str = "Tasks/Zavolat do servisu kvůli kolu.md";
const NOW: &str = "2026-10-14T12:00:00+02:00";

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
fn tasks_vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Úkoly");
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fx.join("tasks"), &root, &["README.md"]);
    copy_dir(&fx.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    root
}
fn open(root: &Path, sb: &Sandbox) -> Core {
    let core = ok!(Core::open(root, &sb.dirs, CoreOptions { watch: false, sync: None }), "Core::open");
    assert!(core.wait_idle(Duration::from_secs(60)), "indexing did not become idle within 60 s");
    core
}
fn read(root: &Path, rel: &str) -> String {
    std::fs::read_to_string(root.join(rel)).expect("setup: read")
}
fn swap(text: &str, from: &str, to: &str) -> String {
    assert!(text.contains(from), "fixture no longer contains {from:?}");
    text.replacen(from, to, 1)
}
fn changed(a: &BTreeMap<String, Entry>, b: &BTreeMap<String, Entry>) -> Vec<String> {
    let keys: BTreeSet<&String> = a.keys().chain(b.keys()).collect();
    keys.into_iter().filter(|k| a.get(*k) != b.get(*k)).map(|k| nfc(k)).collect()
}
fn strs(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}
type Res = (LinkKind, Option<String>);
/// What `link_resolve(from, [target])` gives: kind and NFC path.
fn resolves(core: &Core, from: &str, target: &str) -> Res {
    let t = core.resolve_links(from, &[target.to_string()]).into_iter().next().expect("one result per target");
    (t.kind, t.path.map(|p| nfc(&p)))
}
fn note(p: &str) -> Res {
    (LinkKind::Note, Some(p.to_string()))
}
/// FR-CNV-03 AC-1: the new task's bytes (D-232, AP-400), with `id` and `source` as given.
fn task_bytes(id: &str, title: &str, source: &str, body: &str) -> String {
    let t = if title.contains(':') || title.contains('#') { format!("\"{title}\"") } else { title.to_string() };
    format!("---\nid: {id}\ntype: task\ntitle: {t}\nstatus: To do\nsource: \"[[{source}]]\"\ncreated: {NOW}\nmodified: {NOW}\n---\n{body}")
}
fn version(core: &Core, rel: &str) -> tegg_vault::FileVersion {
    ok!(core.read_note(rel, SystemTime::now()), format!("read_note {rel}")).1
}
/// Bloky with the conversion's embed in place of lines 3–4 of the body (FR-CNV-03 AC-2).
fn bloky_converted(root: &Path, target: &str) -> String {
    let b = read(root, BLOKY);
    let b = swap(&b, "Zavolat do servisu kvůli kolu\na domluvit termín.", &format!("![[{target}]]"));
    swap(&b, "modified: 2026-10-01T09:00:00+02:00", &format!("modified: {NOW}"))
}

/// FR-CNV-06 AC-1 at the core (D-492, §11.4 `undo.ts`): the conversion's undo discards the new file with the
/// version it was created with — deleted, never trashed, and gone from the index. Every conversion test below ends
/// with it, so each one checks that its conversion leaves no residue once undone (T1).
fn undo_create(core: &Core, root: &Path, rel: &str) {
    let v = version(core, rel);
    let r = core.discard_note(rel, &v);
    assert!(r.is_ok(), "undo: note_discard({rel}) with its creation version: {r:?}");
    assert!(!root.join(rel).exists(), "undo: {rel} no longer exists");
    assert!(!root.join(".trash").join(rel).exists(), "undo: {rel} isn't moved to .trash/");
    assert!(core.object(rel).is_none(), "undo: {rel} is gone from the index");
}
/// FR-CNV-06 AC-1: the source's undo save, back to its original body (frontmatter: `modified` only).
fn undo_source(core: &Core, rel: &str, original: &str) {
    let base = version(core, rel);
    let back = original.replacen("modified: 2026-10-01T09:00:00+02:00", &format!("modified: {NOW}"), 1);
    ok!(core.write_note(rel, back.as_bytes(), Some(&base)), format!("undo: save {rel}"));
}

// ------------------------------------------------------------------------------------------------ FR-CNV-03 AC-1

#[test]
fn fr_cnv_03_ac1_the_create_writes_exactly_one_new_file_and_undo_leaves_none() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    let core = open(&root, &sb);
    let original = read(&root, BLOKY);
    let before = snapshot(&root);
    let bytes = task_bytes("01JB5A0000000000000000C002", "Zavolat do servisu kvůli kolu", "Bloky", "a domluvit termín.\n");
    let path = ok!(core.create_object("task", "Zavolat do servisu kvůli kolu", bytes.as_bytes()), "create_object");
    assert_eq!(nfc(&path), NEW, "the Task folder, the title as the stem");
    assert_eq!(read(&root, NEW), bytes, "the AC-1 bytes, byte for byte");
    assert_eq!(changed(&before, &snapshot(&root)), strs(&[NEW]), "exactly one new file; every other file untouched");
    let leftovers: Vec<_> = std::fs::read_dir(root.join("Tasks")).expect("setup").filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().to_string()).filter(|n| n.contains(".tegg-tmp")).collect();
    assert!(leftovers.is_empty(), "no temp file left: {leftovers:?}");
    // Then the source note's ordinary save with its version as base (AP-428 order).
    let base = version(&core, BLOKY);
    ok!(core.write_note(BLOKY, bloky_converted(&root, "Zavolat do servisu kvůli kolu").as_bytes(), Some(&base)), "the source save");
    assert_eq!(changed(&before, &snapshot(&root)), strs(&[BLOKY, NEW]), "a conversion writes exactly two files (FR-SYN-06 AC-23)");
    // Undo: the source first, then the new file (§11.9 item 2).
    undo_source(&core, BLOKY, &original);
    undo_create(&core, &root, NEW);
    assert_eq!(changed(&before, &snapshot(&root)), strs(&[BLOKY]), "after undo only Bloky differs (its modified); nothing in .trash/");
}

// ------------------------------------------------------------------------------------------------ FR-CNV-02 AC-7

#[test]
fn fr_cnv_02_ac7_the_file_name_is_nfc() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    let core = open(&root, &sb);
    let nfd_title: String = "Úkol v NFD".chars().flat_map(|c| if c == 'Ú' { vec!['U', '\u{301}'] } else { vec![c] }).collect();
    assert_ne!(nfd_title, "Úkol v NFD", "setup: an NFD title");
    let bytes = task_bytes("01JB5A0000000000000000C003", "Úkol v NFD", "NFD host", "");
    let path = ok!(core.create_object("task", &nfd_title, bytes.as_bytes()), "create_object");
    assert_eq!(path, "Tasks/Úkol v NFD.md", "the returned path is NFC (FR-FMT-12)");
    let on_disk = || -> Vec<String> {
        std::fs::read_dir(root.join("Tasks")).expect("setup").filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().to_string()).filter(|n| nfc(n) == "Úkol v NFD.md").collect()
    };
    assert_eq!(on_disk(), strs(&["Úkol v NFD.md"]), "the name on disk is NFC");
    assert_eq!(resolves(&core, "Pages/NFD host.md", "Úkol v NFD"), note("Tasks/Úkol v NFD.md"), "the NFC embed resolves");
    undo_create(&core, &root, "Tasks/Úkol v NFD.md");
    assert!(on_disk().is_empty(), "undo: the NFC-named file is the one removed");
}

// ------------------------------------------------------------------------------------------------ FR-CNV-03 AC-5, AC-11

#[test]
fn fr_cnv_03_ac5_free_stems_are_vault_wide_and_the_embed_names_the_file_created() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    let core = open(&root, &sb);
    let before = snapshot(&root);
    let k = ok!(core.create_object("task", "Koupit lepidlo", task_bytes("01JB5A0000000000000000C004", "Koupit lepidlo", "Bloky", "").as_bytes()), "create Koupit lepidlo");
    assert_eq!(nfc(&k), "Tasks/Koupit lepidlo (2).md", "Pages/Koupit lepidlo.md holds the stem (D-291)");
    assert_eq!(snapshot(&root).get(LEPIDLO), before.get(LEPIDLO), "Lepidlo untouched");
    assert_eq!(resolves(&core, BLOKY, "Koupit lepidlo (2)"), note("Tasks/Koupit lepidlo (2).md"), "![[Koupit lepidlo (2)]] resolves to the new file");
    assert_eq!(resolves(&core, BLOKY, "Koupit lepidlo"), note(LEPIDLO), "the old stem still resolves to the page");
    let q = ok!(core.create_object("task", "Q3: rozpočet/plán", task_bytes("01JB5A0000000000000000C005", "Q3: rozpočet/plán", "Bloky", "").as_bytes()), "create Q3");
    assert_eq!(nfc(&q), "Tasks/Q3 rozpočet plán.md", "forbidden characters become spaces (FR-FMT-08)");
    assert!(read(&root, "Tasks/Q3 rozpočet plán.md").contains("title: \"Q3: rozpočet/plán\"\n"), "the title as typed");
    assert_eq!(resolves(&core, BLOKY, "Q3 rozpočet plán"), note("Tasks/Q3 rozpočet plán.md"));
    // The stem is taken on disk between the popover and the write: the next free stem, and the embed names it.
    write_raw(&root, NEW, "---\ntype: task\ntitle: Cizí\n---\n".as_bytes());
    let p = ok!(core.create_object("task", "Zavolat do servisu kvůli kolu", task_bytes("01JB5A0000000000000000C006", "Zavolat do servisu kvůli kolu", "Bloky", "a domluvit termín.\n").as_bytes()), "create while the stem is taken");
    assert_eq!(nfc(&p), "Tasks/Zavolat do servisu kvůli kolu (2).md", "never the planned path");
    assert_eq!(read(&root, NEW), "---\ntype: task\ntitle: Cizí\n---\n", "the other file keeps its bytes (create-exclusive)");
    // Undo removes exactly the files these conversions created, never the same-stem neighbours.
    for created in ["Tasks/Koupit lepidlo (2).md", "Tasks/Q3 rozpočet plán.md", "Tasks/Zavolat do servisu kvůli kolu (2).md"] {
        undo_create(&core, &root, created);
    }
    assert_eq!(snapshot(&root).get(LEPIDLO), before.get(LEPIDLO), "Lepidlo still untouched");
    assert_eq!(read(&root, NEW), "---\ntype: task\ntitle: Cizí\n---\n", "the neighbour stays");
}

#[test]
fn fr_cnv_03_ac11_dvojnik_hosts_get_their_own_files_and_embeds() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    let core = open(&root, &sb);
    let a = ok!(core.create_object("task", "Úkol z dvojníka", task_bytes("01JB5A0000000000000000C007", "Úkol z dvojníka", "Dvojník", "").as_bytes()), "from Pages/Dvojník");
    let b = ok!(core.create_object("task", "Úkol z dvojníka", task_bytes("01JB5A0000000000000000C008", "Úkol z dvojníka", "Quick Notes/Dvojník", "").as_bytes()), "from Quick Notes/Dvojník");
    assert_eq!((nfc(&a), nfc(&b)), ("Tasks/Úkol z dvojníka.md".to_string(), "Tasks/Úkol z dvojníka (2).md".to_string()), "two new files");
    let mut originals = Vec::new();
    for (host, target, file) in [(DVOJNIK_P, "Úkol z dvojníka", "Tasks/Úkol z dvojníka.md"), (DVOJNIK_Q, "Úkol z dvojníka (2)", "Tasks/Úkol z dvojníka (2).md")] {
        let text = read(&root, host);
        let base = version(&core, host);
        ok!(core.write_note(host, swap(&text, "Úkol z dvojníka\n", &format!("![[{target}]]\n")).as_bytes(), Some(&base)), format!("save {host}"));
        assert_eq!(resolves(&core, host, target), note(file), "{host}: the embed names its own file (FR-LNK-14)");
        originals.push((host, text));
    }
    // Bloky's conversion: the written embed resolves to the new file.
    let n = ok!(core.create_object("task", "Zavolat do servisu kvůli kolu", task_bytes("01JB5A0000000000000000C009", "Zavolat do servisu kvůli kolu", "Bloky", "a domluvit termín.\n").as_bytes()), "create");
    let original = read(&root, BLOKY);
    let base = version(&core, BLOKY);
    ok!(core.write_note(BLOKY, bloky_converted(&root, "Zavolat do servisu kvůli kolu").as_bytes(), Some(&base)), "save Bloky");
    assert_eq!(resolves(&core, BLOKY, "Zavolat do servisu kvůli kolu"), note(&nfc(&n)));
    // Undo each conversion: each host's undo removes its own file only.
    undo_source(&core, DVOJNIK_Q, &originals[1].1);
    undo_create(&core, &root, "Tasks/Úkol z dvojníka (2).md");
    assert!(root.join("Tasks/Úkol z dvojníka.md").exists(), "the other host's task stays");
    assert_eq!(resolves(&core, DVOJNIK_P, "Úkol z dvojníka"), note("Tasks/Úkol z dvojníka.md"), "and its embed still resolves");
    undo_source(&core, DVOJNIK_P, &originals[0].1);
    undo_create(&core, &root, "Tasks/Úkol z dvojníka.md");
    undo_source(&core, BLOKY, &original);
    undo_create(&core, &root, NEW);
}

// ------------------------------------------------------------------------------------------------ FR-CNV-03 AC-10

#[test]
fn fr_cnv_03_ac10_a_virtual_daily_note_as_source() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    let core = open(&root, &sb);
    let before = snapshot(&root);
    assert!(!root.join("Daily/2026-10-14.md").exists(), "setup: today's Daily Note is virtual");
    let t = ok!(core.create_object("task", "Zavolat zubaři", task_bytes("01JB5A0000000000000000C011", "Zavolat zubaři", "2026-10-14", "").as_bytes()), "the task first");
    assert_eq!(nfc(&t), "Tasks/Zavolat zubaři.md");
    let daily = format!("---\nid: 01JB5A0000000000000000C012\ntype: daily-note\ntitle: \"2026-10-14\"\ndate: 2026-10-14\nreview: unreviewed\ncreated: {NOW}\nmodified: {NOW}\n---\n![[Zavolat zubaři]]\n");
    let d = chrono::NaiveDate::from_ymd_opt(2026, 10, 14).expect("setup");
    let made = ok!(core.daily_create(d, daily.as_bytes()), "then the Daily Note's first write");
    assert_eq!(nfc(&made.path), "Daily/2026-10-14.md");
    assert_eq!(read(&root, "Daily/2026-10-14.md"), daily, "its body is the embed");
    assert_eq!(changed(&before, &snapshot(&root)), strs(&["Daily/2026-10-14.md", "Tasks/Zavolat zubaři.md"]), "exactly two files");
    assert_eq!(resolves(&core, "Tasks/Zavolat zubaři.md", "2026-10-14"), (LinkKind::Daily, Some("Daily/2026-10-14.md".to_string())), "source \"[[2026-10-14]]\" resolves to the Daily Note (D-162)");
    assert_eq!(resolves(&core, "Daily/2026-10-14.md", "Zavolat zubaři"), note("Tasks/Zavolat zubaři.md"));
    // Undo: the Daily Note keeps its file (now without the embed); the task is discarded.
    let base = version(&core, "Daily/2026-10-14.md");
    ok!(core.write_note("Daily/2026-10-14.md", daily.replace("![[Zavolat zubaři]]\n", "").as_bytes(), Some(&base)), "undo: the Daily Note's save");
    undo_create(&core, &root, "Tasks/Zavolat zubaři.md");
    assert_eq!(changed(&before, &snapshot(&root)), strs(&["Daily/2026-10-14.md"]), "only the Daily Note's first write remains");
}

// ------------------------------------------------------------------------------------------------ FR-CNV-04 AC-1, AC-3

#[test]
fn fr_cnv_04_ac1_every_source_value_resolves_back_from_the_new_file() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    let core = open(&root, &sb);
    // From the planned path (not created yet, §11.2): the stem test the app uses for the link text.
    assert_eq!(resolves(&core, "Tasks/Úkol z dvojníka.md", "Dvojník"), note(DVOJNIK_P), "from Tasks/ the stem resolves to the shorter path");
    assert_eq!(resolves(&core, "Tasks/Úkol z tipů.md", "C tips"), note(C_TIPS));
    assert_eq!(resolves(&core, "Tasks/Zavolat do servisu kvůli kolu.md", "Bloky"), note(BLOKY));
    let cases: [(&str, &str, &str, Res); 4] = [
        ("Zavolat do servisu kvůli kolu", "C013", "Bloky", note(BLOKY)),
        ("Úkol z tipů", "C014", "C tips|C# tips", note(C_TIPS)),
        ("Úkol z dvojníka", "C015", "Dvojník", note(DVOJNIK_P)),
        ("Úkol z rychlého dvojníka", "C016", "Quick Notes/Dvojník", note(DVOJNIK_Q)),
    ];
    for (title, id, source, want) in cases {
        let p = ok!(core.create_object("task", title, task_bytes(&format!("01JB5A0000000000000000{id}"), title, source, "").as_bytes()), format!("create {title}"));
        assert_eq!(resolves(&core, &p, source), want, "{title}: source \"[[{source}]]\" resolves to the source");
        let row = core.tasks().into_iter().find(|r| nfc(&r.path) == nfc(&p)).expect("the new task is a task");
        assert_eq!(row.source.map(|s| (s.kind, s.path.map(|x| nfc(&x)))), Some(want), "{title}: the task row's source");
        undo_create(&core, &root, &nfc(&p));
        assert!(core.tasks().iter().all(|r| nfc(&r.path) != nfc(&p)), "{title}: undo removes the task row");
    }
}

#[test]
fn fr_cnv_04_ac3_backlinks_both_ways() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    let core = open(&root, &sb);
    let original = read(&root, BLOKY);
    ok!(core.create_object("task", "Zavolat do servisu kvůli kolu", task_bytes("01JB5A0000000000000000C017", "Zavolat do servisu kvůli kolu", "Bloky", "a domluvit termín.\n").as_bytes()), "create");
    let base = version(&core, BLOKY);
    ok!(core.write_note(BLOKY, bloky_converted(&root, "Zavolat do servisu kvůli kolu").as_bytes(), Some(&base)), "save Bloky");
    let of = |p: &str| core.backlinks(p).into_iter().map(|x| nfc(&x)).collect::<Vec<_>>();
    assert!(of(NEW).contains(&BLOKY.to_string()), "the task's backlinks list Bloky (the embed): {:?}", of(NEW));
    assert!(of(BLOKY).contains(&NEW.to_string()), "Bloky's backlinks list the task (its source): {:?}", of(BLOKY));
    undo_source(&core, BLOKY, &original);
    undo_create(&core, &root, NEW);
    assert!(!of(BLOKY).contains(&NEW.to_string()), "after undo Bloky's backlinks no longer list the task: {:?}", of(BLOKY));
}

#[test]
fn fr_cnv_02_ac3_the_link_moves_with_the_text() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    let core = open(&root, &sb);
    let title = "Objednat nový projektor pro Zasedačka";
    let body = "Objednat **nový** projektor pro [[Zasedačka]]\n\n- zjistit cenu\n- porovnat nabídky\n";
    let bytes = format!("---\nid: 01JB5A0000000000000000C018\ntype: task\ntitle: {title}\nstatus: To do\ntags: [práce]\nsource: \"[[Bloky]]\"\ncreated: {NOW}\nmodified: {NOW}\n---\n{body}");
    let p = ok!(core.create_object("task", title, bytes.as_bytes()), "create");
    let b = read(&root, BLOKY);
    let b2 = swap(&b, "- [ ] Objednat **nový** projektor pro [[Zasedačka]] #práce\n  - zjistit cenu\n  - porovnat nabídky\n- [ ] Rezervovat sál", &format!("\n![[{title}]]\n\n- [ ] Rezervovat sál"));
    let base = version(&core, BLOKY);
    ok!(core.write_note(BLOKY, b2.as_bytes(), Some(&base)), "save Bloky");
    let back = || -> Vec<String> { core.backlinks(ZASEDACKA).into_iter().map(|x| nfc(&x)).collect() };
    assert!(back().contains(&nfc(&p)), "Zasedačka's backlinks list the new task: {:?}", back());
    assert!(back().contains(&BLOKY.to_string()), "and Bloky still (its own ![[Zasedačka]]): {:?}", back());
    undo_source(&core, BLOKY, &b);
    undo_create(&core, &root, &nfc(&p));
    assert!(!back().contains(&nfc(&p)) && back().contains(&BLOKY.to_string()), "after undo the link is back in Bloky only: {:?}", back());
}

// ------------------------------------------------------------------------------------------------ FR-CNV-06

#[test]
fn fr_cnv_06_ac1_discard_deletes_an_unchanged_new_file_without_trash() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    let core = open(&root, &sb);
    let bytes = task_bytes("01JB5A0000000000000000C019", "Zavolat do servisu kvůli kolu", "Bloky", "a domluvit termín.\n");
    ok!(core.create_object("task", "Zavolat do servisu kvůli kolu", bytes.as_bytes()), "create");
    let before = snapshot(&root);
    let v = version(&core, NEW);
    let r = core.discard_note(NEW, &v);
    assert!(r.is_ok(), "note_discard with the current version: {r:?}");
    assert!(!root.join(NEW).exists(), "the new file no longer exists");
    assert!(!root.join(".trash").join(NEW).exists(), "nothing is moved to .trash/ (D-492)");
    assert_eq!(changed(&before, &snapshot(&root)), strs(&[NEW]), "no other file is touched");
    assert!(core.object(NEW).is_none(), "and it is gone from the index");
    assert!(core.tasks().iter().all(|t| nfc(&t.path) != NEW), "and from the task query");
}

#[test]
fn fr_cnv_06_ac1_discard_refuses_a_changed_missing_or_protected_file() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    let core = open(&root, &sb);
    let bytes = task_bytes("01JB5A0000000000000000C020", "Zavolat do servisu kvůli kolu", "Bloky", "a domluvit termín.\n");
    ok!(core.create_object("task", "Zavolat do servisu kvůli kolu", bytes.as_bytes()), "create");
    let v = version(&core, NEW);
    // Guard: the current version deletes (so the refusals below aren't a stub that refuses everything).
    let probe = "Tasks/Pokus.md";
    ok!(core.create_exact(probe, b"---\ntype: task\ntitle: Pokus\n---\n"), "setup: probe");
    let pv = version(&core, probe);
    assert!(core.discard_note(probe, &pv).is_ok() && !root.join(probe).exists(), "the guard: discard with the current version works");
    std::thread::sleep(Duration::from_millis(5));
    let changed_bytes = swap(&bytes, "a domluvit termín.", "a domluvit termín. Doplněno.");
    ok!(core.write_note(NEW, changed_bytes.as_bytes(), Some(&v)), "the card edit");
    let r = core.discard_note(NEW, &v);
    assert!(matches!(r, Err(CoreError::Vault(VaultError::Conflict { .. }))), "an old base: Conflict: {r:?}");
    assert_eq!(read(&root, NEW), changed_bytes, "a changed file is never deleted");
    let r2 = core.discard_note("Tasks/Nikdy nebyl.md", &v);
    assert!(matches!(r2, Err(CoreError::Vault(VaultError::NotFound))), "absent: NotFound: {r2:?}");
    for rel in ["_templates/Task/Task.md", ".trash/Tasks/Smazaný úkol.md", ".tegg/types/projekt.yml"] {
        let pv = std::fs::metadata(root.join(rel)).is_ok();
        assert!(pv, "setup: {rel} exists");
        let before = snapshot(&root);
        let any = core.read_note(rel, SystemTime::now()).map(|x| x.1).unwrap_or_else(|_| v.clone());
        let r = core.discard_note(rel, &any);
        assert!(r.is_err(), "{rel}: refused (only Markdown outside .tegg/, _templates/, .trash/): {r:?}");
        assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "{rel}: untouched");
    }
}

#[test]
fn fr_cnv_06_ac2_redo_recreates_the_same_bytes_or_the_next_free_stem() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    let core = open(&root, &sb);
    let bytes = task_bytes("01JB5A0000000000000000C021", "Zavolat do servisu kvůli kolu", "Bloky", "a domluvit termín.\n");
    ok!(core.create_object("task", "Zavolat do servisu kvůli kolu", bytes.as_bytes()), "create");
    let v = version(&core, NEW);
    ok!(core.discard_note(NEW, &v), "undo: discard");
    let before = snapshot(&root);
    ok!(core.create_exact(NEW, bytes.as_bytes()), "redo: note_create_exact");
    assert_eq!(read(&root, NEW), bytes, "same path, same bytes, same id");
    assert_eq!(changed(&before, &snapshot(&root)), strs(&[NEW]), "only the new file");
    let v2 = version(&core, NEW);
    ok!(core.discard_note(NEW, &v2), "undo again");
    write_raw(&root, NEW, "---\ntype: page\ntitle: Mezitím\n---\n".as_bytes());
    core.notify_changed(&[NEW.to_string()]);
    assert!(core.wait_idle(Duration::from_secs(10)), "idle");
    let r = core.create_exact(NEW, bytes.as_bytes());
    assert!(matches!(r, Err(CoreError::Vault(VaultError::NameTaken))), "the path was taken meanwhile: NameTaken: {r:?}");
    let p = ok!(core.create_object("task", "Zavolat do servisu kvůli kolu", bytes.as_bytes()), "then the next free stem");
    assert_eq!(nfc(&p), "Tasks/Zavolat do servisu kvůli kolu (2).md");
    assert!(read(&root, &p).contains("id: 01JB5A0000000000000000C021\n"), "the same id");
    assert_eq!(read(&root, NEW), "---\ntype: page\ntitle: Mezitím\n---\n", "the other file keeps its bytes");
}

#[test]
fn fr_cnv_06_ac3_a_changed_new_file_is_trashed_not_deleted() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    let core = open(&root, &sb);
    let bytes = task_bytes("01JB5A0000000000000000C022", "Zavolat do servisu kvůli kolu", "Bloky", "a domluvit termín.\n");
    ok!(core.create_object("task", "Zavolat do servisu kvůli kolu", bytes.as_bytes()), "create");
    let v = version(&core, NEW);
    std::thread::sleep(Duration::from_millis(5));
    let edited = swap(&bytes, "a domluvit termín.", "a domluvit termín. Doplněno.");
    ok!(core.write_note(NEW, edited.as_bytes(), Some(&v)), "the card body edit");
    // Guard: an unchanged new file is discarded (so the refusal below isn't a stub that refuses everything).
    ok!(core.create_exact("Tasks/Pokus.md", "---\ntype: task\ntitle: Pokus\n---\n".as_bytes()), "setup: probe");
    undo_create(&core, &root, "Tasks/Pokus.md");
    // §11.4 undo.ts: discard refuses (Conflict), so the file is trashed with its current version.
    assert!(core.discard_note(NEW, &v).is_err(), "discard with the creation version is refused");
    assert!(root.join(NEW).exists(), "so nothing is deleted");
    let cur = version(&core, NEW);
    let to = ok!(core.trash_note(NEW, &cur), "note_trash");
    assert_eq!(nfc(&to), ".trash/Tasks/Zavolat do servisu kvůli kolu.md", "FR-STO-08 path");
    assert_eq!(read(&root, ".trash/Tasks/Zavolat do servisu kvůli kolu.md"), edited, "the edit is kept in the trash");
    assert!(!root.join(NEW).exists());
}
