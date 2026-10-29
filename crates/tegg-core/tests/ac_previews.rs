//! v1.0 slice P (object previews) AC tests at the core (L4): `Core::path_by_id` (D-935, v1-previews §2) finds the
//! indexed object by its frontmatter `id` (NFC path), follows a rename with the same id, answers `None` for unknown,
//! trashed and template ids, picks what `resolve_links` picks among duplicate ids (FR-LNK-14) and gives the same answer
//! after an index rebuild (AR-01); FR-LNK-11 AC-11 (L4: the `vault:changed` events a live preview listens to, and the
//! rename follow), FR-LNK-11 AC-12 (L4: a preview's reads, `embed_load` and `path_by_id`, record no recency and write
//! nothing), FR-LNK-08 AC-10 (L4: what each link of Odkazy resolves to, which is what the popover shows), FR-LNK-10
//! AC-10 (L4: the tag counts, `tag_objects`). docs/acceptance/previews.md; interface docs/contracts/v1-previews.md §2.
//! Written from the ACs and the contract only (D-61).
//!
//! Fixture: tests/fixtures/vaults/previews (without its README.md) + new-empty/.tegg in a temporary directory on APFS,
//! with the runtime attachments of its README (`_attachments/graf.png`, `_attachments/Smlouva.pdf`). Bytes, mtime and
//! inode are compared with `common::snapshot`.
//!
//! Every test asserts on `path_by_id` (the slice's new core call) somewhere, so each is red while it is a stub.

mod common;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::Receiver;
use std::sync::Arc;
use std::time::Duration;

use common::*;
use tegg_core::{Core, CoreEvent, CoreOptions, LinkKind, LinkTarget};
use tegg_format::nfc;
use tegg_vault::{LocalFs, VaultFs};

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

const ROZPOCET: &str = "Pages/Rozpočet 2027.md";
const ODKAZY: &str = "Pages/Odkazy.md";
const ALFA: &str = "Projekty/Projekt Alfa.md";
const JANA: &str = "Osoby/Jana Nováková.md";
const PLAN_P: &str = "Pages/Plán.md";
const PLAN_Q: &str = "Quick Notes/Plán.md";
const UCTY: &str = "Tags/Účty.md";
const GRAF: &str = "Images/Graf.md";
const SMLOUVA: &str = "PDFs/Smlouva.md";
const DENNI: &str = "Daily/2026-10-07.md";
const SMAZANA: &str = ".trash/Pages/Smazaná.md";

const ID_ROZPOCET: &str = "01JBPV0000000000000000P001";
const ID_PLAN_P: &str = "01JBPV0000000000000000P015";
const ID_UCTY: &str = "01JBPV0000000000000000P012";
const ID_SMAZANA: &str = "01JBPV0000000000000000P022";

/// Every live object of the fixture with an id (README table), as (path, id).
const LIVE: &[(&str, &str)] = &[
    ("Pages/Rozpočet 2027.md", "01JBPV0000000000000000P001"),
    ("Osoby/Jana Nováková.md", "01JBPV0000000000000000P002"),
    ("Osoby/Petr Dvořák.md", "01JBPV0000000000000000P003"),
    ("Projekty/Projekt Alfa.md", "01JBPV0000000000000000P004"),
    ("Pages/Odkazy.md", "01JBPV0000000000000000P005"),
    ("Pages/Vložení.md", "01JBPV0000000000000000P006"),
    ("Pages/Kruh A.md", "01JBPV0000000000000000P007"),
    ("Pages/Kruh B.md", "01JBPV0000000000000000P008"),
    ("Tasks/Zavolat Janě.md", "01JBPV0000000000000000P009"),
    ("Pages/Porada 2026-10-27.md", "01JBPV0000000000000000P010"),
    ("Daily/2026-10-07.md", "01JBPV0000000000000000P011"),
    ("Tags/Účty.md", "01JBPV0000000000000000P012"),
    ("Images/Graf.md", "01JBPV0000000000000000P013"),
    ("PDFs/Smlouva.md", "01JBPV0000000000000000P014"),
    ("Pages/Plán.md", "01JBPV0000000000000000P015"),
    ("Quick Notes/Plán.md", "01JBPV0000000000000000P016"),
    ("Pages/Prázdná.md", "01JBPV0000000000000000P017"),
    ("Quick Notes/Nápad na podcast.md", "01JBPV0000000000000000P019"),
    ("Pages/Mapa.md", "01JBPV0000000000000000P020"),
];

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
/// `tests/fixtures/vaults/previews/` (without README.md) + `new-empty/.tegg/` + the runtime attachments, in
/// `<sandbox>/Náhledy`.
fn previews_vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Náhledy");
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fx.join("previews"), &root, &["README.md"]);
    copy_dir(&fx.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    // The fixture's own type files win over new-empty's (there are none with the same name, README).
    copy_dir(&fx.join("previews/.tegg"), &root.join(".tegg"), &[]);
    std::fs::create_dir_all(root.join("_attachments")).expect("setup: _attachments");
    std::fs::copy(fx.join("trash-media/_attachments/záhon.png"), root.join("_attachments/graf.png")).expect("setup: graf.png");
    std::fs::copy(fx.join("trash-media/_attachments/Rozpočet.pdf"), root.join("_attachments/Smlouva.pdf")).expect("setup: Smlouva.pdf");
    root
}
fn open(root: &Path, dirs: &tegg_vault::AppDirs, watch: bool) -> Core {
    let core = ok!(Core::open(root, dirs, CoreOptions { watch, sync: None }), "Core::open");
    assert!(core.wait_idle(Duration::from_secs(60)), "indexing did not become idle within 60 s");
    core
}
fn open_counting(root: &Path, sb: &Sandbox) -> (Core, Arc<CountingFs<LocalFs>>) {
    let fs = CountingFs::new(LocalFs::new(root));
    let core = ok!(Core::open_with(fs.clone() as Arc<dyn VaultFs>, &sb.dirs, CoreOptions { watch: false, sync: None }), "Core::open_with");
    assert!(core.wait_idle(Duration::from_secs(60)), "indexing did not become idle within 60 s");
    (core, fs)
}
fn fixture(rel: &str) -> String {
    std::fs::read_to_string(repo_root().join("tests/fixtures/vaults/previews").join(rel)).expect("setup: fixture")
}
fn strings(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}
fn changed(a: &BTreeMap<String, Entry>, b: &BTreeMap<String, Entry>) -> Vec<String> {
    let keys: BTreeSet<&String> = a.keys().chain(b.keys()).collect();
    keys.into_iter().filter(|k| a.get(*k) != b.get(*k)).map(|k| nfc(k)).collect()
}
fn changed_paths(rx: &Receiver<CoreEvent>) -> Vec<String> {
    let mut out = Vec::new();
    while let Ok(ev) = rx.try_recv() {
        if let CoreEvent::VaultChanged { paths } = ev {
            out.extend(paths.into_iter().map(|p| nfc(&p)));
        }
    }
    out
}
fn one(got: &[LinkTarget]) -> (LinkKind, Option<String>) {
    assert_eq!(got.len(), 1, "one result per target: {got:?}");
    (got[0].kind.clone(), got[0].path.as_deref().map(nfc))
}
fn note_at(path: &str) -> (LinkKind, Option<String>) {
    (LinkKind::Note, Some(path.to_string()))
}
fn swap(text: &str, from: &str, to: &str) -> String {
    assert!(text.contains(from), "fixture no longer contains {from:?}");
    text.replacen(from, to, 1)
}

// ------------------------------------------------------------------------------------------------ path_by_id (D-935)

#[test]
fn fr_lnk_11_ac11_path_by_id_finds_every_indexed_object_by_its_id() {
    let sb = sandbox();
    let root = previews_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let mut bad = Vec::new();
    for (path, id) in LIVE {
        let got = core.path_by_id(id);
        if got.as_deref() != Some(*path) {
            bad.push(format!("{id}: want {path:?}, got {got:?}"));
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "path_by_id(id) is the vault path of the object with that frontmatter id");
}

#[test]
fn fr_lnk_11_ac11_path_by_id_answers_an_nfc_path_for_an_nfd_file_name() {
    let sb = sandbox();
    let root = previews_vault(&sb);
    // FR-FMT-12: the file of Rozpočet renamed to its NFD-named form (git can't store NFD names, so it is made here).
    let nfd_name = format!("Pages/{}", "Rozpočet 2027.md".chars().collect::<String>().replace('č', "c\u{30C}"));
    assert_ne!(nfd_name, ROZPOCET, "setup: the name is decomposed");
    std::fs::rename(root.join(ROZPOCET), root.join(&nfd_name)).expect("setup: rename to NFD");
    let core = open(&root, &sb.dirs, false);
    assert_eq!(core.path_by_id(ID_ROZPOCET).as_deref(), Some(ROZPOCET), "the path is NFC (FR-FMT-12), written and compared");
    let r = core.resolve_links(ODKAZY, &strings(&["Rozpočet 2027"]));
    assert_eq!(one(&r), note_at(ROZPOCET), "the link resolves to the same NFC path");
    assert_eq!(r[0].title.as_deref().map(nfc).as_deref(), Some("Rozpočet 2027"), "the title in NFC");
}

#[test]
fn fr_lnk_11_ac11_path_by_id_is_none_for_unknown_trashed_and_template_ids() {
    let sb = sandbox();
    let root = previews_vault(&sb);
    // A template with an id of its own (the fixture's template has none, README): templates are never targets.
    write_raw(&root, "_templates/Page/Šablona s id.md", "---\nid: 01JBPV0000000000000000P040\ntype: page\ntitle: Šablona s id\n---\nText.\n".as_bytes());
    let core = open(&root, &sb.dirs, false);
    assert_eq!(core.path_by_id(ID_ROZPOCET).as_deref(), Some(ROZPOCET), "a live id answers its path");
    assert_eq!(core.path_by_id(ID_SMAZANA), None, "an id only in .trash/ is None (Smazaná, P022)");
    assert_eq!(core.path_by_id("01JBPV0000000000000000P040"), None, "an id only in _templates/ is None");
    assert_eq!(core.path_by_id("01JBPV0000000000000000P099"), None, "an unknown id is None");
    assert_eq!(core.path_by_id(""), None, "an empty id is None");
    assert_eq!(core.path_by_id(&ID_ROZPOCET.to_lowercase()), None, "the match is exact");
    assert_eq!(core.path_by_id("Rozpočet 2027"), None, "a title is not an id (FR-LNK-14)");
    assert_eq!(core.path_by_id(ROZPOCET), None, "a path is not an id");
}

#[test]
fn fr_lnk_14_path_by_id_with_a_duplicate_id_picks_what_resolve_links_picks() {
    let sb = sandbox();
    let root = previews_vault(&sb);
    // A copy of Pages/Plán.md (same id P015) in Quick Notes/, as a sync copy would make (FR-LNK-14 duplicates).
    write_raw(&root, "Quick Notes/Kopie plánu.md", fixture(PLAN_P).replace("title: Plán\n", "title: Kopie plánu\n").as_bytes());
    let core = open(&root, &sb.dirs, false);
    let picked = core.resolve_links(ODKAZY, &strings(&[ID_PLAN_P]));
    let (kind, path) = one(&picked);
    assert_eq!(kind, LinkKind::Note, "resolve_links resolves the id (setup)");
    let got = core.path_by_id(ID_PLAN_P);
    assert!(got.is_some(), "path_by_id answers one of the two files");
    assert_eq!(got.as_deref().map(nfc), path, "the file resolve_links picks for the id");
    let again: Vec<Option<String>> = (0..5).map(|_| core.path_by_id(ID_PLAN_P)).collect();
    assert!(again.iter().all(|p| *p == got), "the answer is stable: {again:?}");
}

#[test]
fn ar_01_path_by_id_is_the_same_after_an_index_rebuild() {
    let sb = sandbox();
    let root = previews_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let ids: Vec<&str> = LIVE.iter().map(|(_, id)| *id).chain([ID_SMAZANA, "01JBPV0000000000000000P099"]).collect();
    let first: Vec<Option<String>> = ids.iter().map(|id| core.path_by_id(id)).collect();
    assert_eq!(first[0].as_deref(), Some(ROZPOCET), "the index answers before the rebuild");
    drop(core);
    let core = open(&root, &fresh_dirs(&sb, "Rebuilt"), false);
    let second: Vec<Option<String>> = ids.iter().map(|id| core.path_by_id(id)).collect();
    assert_eq!(second, first, "the same answers from a rebuilt index (AR-01)");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-11 AC-11 (L4)

#[test]
fn fr_lnk_11_ac11_external_changes_give_events_and_the_rename_is_followed_by_id() {
    let sb = sandbox();
    let root = previews_vault(&sb);
    let core = open(&root, &sb.dirs, true);
    let rx = core.events();
    let limit = Duration::from_secs(2);
    let mut seen: Vec<String> = Vec::new();
    let mut saw = |rx: &Receiver<CoreEvent>, path: &str| {
        wait_until(limit, || {
            seen.extend(changed_paths(rx));
            seen.iter().any(|p| p == path)
        })
        .is_some()
    };

    // Another program appends a paragraph to Rozpočet: an event and fresh content from embed_load.
    let appended = format!("{}\nNový odstavec.\n", fixture(ROZPOCET));
    write_raw(&root, ROZPOCET, appended.as_bytes());
    assert!(saw(&rx, ROZPOCET), "vault:changed for {ROZPOCET} within 2 s");
    let n = core.embed_load(&strings(&[ROZPOCET]));
    assert_eq!(n.iter().map(|x| x.text.clone()).collect::<Vec<_>>(), vec![Some(appended.clone())], "embed_load returns the new text");

    // Its title changed to Rozpočet 2028.
    let retitled = swap(&appended, "title: Rozpočet 2027\n", "title: Rozpočet 2028\n");
    write_raw(&root, ROZPOCET, retitled.as_bytes());
    assert!(
        wait_until(limit, || core.resolve_links(ODKAZY, &strings(&[ID_ROZPOCET])).first().and_then(|l| l.title.clone()).map(|t| nfc(&t)) == Some("Rozpočet 2028".into())).is_some(),
        "the new title is indexed within 2 s"
    );

    // Renamed to Pages/Rozpočet 2028.md (same id): the preview follows the file (D-935).
    let renamed = "Pages/Rozpočet 2028.md";
    std::fs::rename(root.join(ROZPOCET), root.join(renamed)).expect("rename Rozpočet");
    assert!(saw(&rx, renamed), "vault:changed names the new path");
    assert!(wait_until(limit, || core.path_by_id(ID_ROZPOCET).as_deref() == Some(renamed)).is_some(), "path_by_id follows the rename within 2 s (got {:?})", core.path_by_id(ID_ROZPOCET));

    // Jana's role changed: an event for Jana.
    let jana = swap(&fixture(JANA), "role: Analytička\n", "role: Vedoucí\n");
    write_raw(&root, JANA, jana.as_bytes());
    assert!(saw(&rx, JANA), "vault:changed for {JANA}");

    // Moved to .trash/: no live object with the id any more.
    std::fs::create_dir_all(root.join(".trash/Pages")).expect("trash dir");
    std::fs::rename(root.join(renamed), root.join(".trash/Pages/Rozpočet 2028.md")).expect("move to trash");
    assert!(saw(&rx, renamed), "vault:changed for the trashed path");
    assert!(wait_until(limit, || core.path_by_id(ID_ROZPOCET).is_none()).is_some(), "path_by_id is None once the object is in .trash/");

    // Projekt Alfa deleted.
    std::fs::remove_file(root.join(ALFA)).expect("delete Alfa");
    assert!(saw(&rx, ALFA), "vault:changed for the deleted {ALFA}");
    assert!(wait_until(limit, || core.path_by_id("01JBPV0000000000000000P004").is_none()).is_some(), "path_by_id is None once the file is deleted");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-11 AC-12 (L4)

#[test]
fn fr_lnk_11_ac12_preview_reads_record_no_recency_and_write_nothing() {
    let sb = sandbox();
    let root = previews_vault(&sb);
    let (core, fs) = open_counting(&root, &sb);
    let before = snapshot(&root);
    let recent0 = format!("{:?}", core.switcher("", 50));
    assert!(core.last_opened().is_none(), "setup: nothing opened");
    // A preview of Rozpočet: the note, then its cards' targets in one call (D-933), then the rename follow (D-935).
    let first = core.embed_load(&strings(&[ROZPOCET]));
    assert_eq!(first.iter().map(|n| nfc(&n.path)).collect::<Vec<_>>(), strings(&[ROZPOCET]));
    let cards = core.embed_load(&strings(&[ALFA]));
    assert_eq!(cards.len(), 1, "the card target");
    for _ in 0..3 {
        assert_eq!(core.path_by_id(ID_ROZPOCET).as_deref(), Some(ROZPOCET), "path_by_id answers the previewed object's path");
    }
    // Previews of the other kinds of Odkazy's targets.
    let _ = core.embed_load(&strings(&[JANA, UCTY, GRAF, SMLOUVA, DENNI, PLAN_P, PLAN_Q]));
    let _ = core.tag_objects("účty");
    let _ = core.tag_objects("nápad");
    assert!(core.last_opened().is_none(), "showing a preview isn't opening it (D-138)");
    assert_eq!(format!("{:?}", core.switcher("", 50)), recent0, "the switcher's empty-query list is unchanged");
    assert_eq!(fs.write_count(), 0, "previews write nothing");
    drop(core);
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "no vault file changed or created");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-08 AC-10 (L4)

#[test]
fn fr_lnk_08_ac10_odkazy_links_resolve_to_the_objects_the_preview_shows() {
    let sb = sandbox();
    let root = previews_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let before = snapshot(&root);
    let nfd_rozpocet = "Rozpočet 2027".replace('č', "c\u{30C}");
    let cases: Vec<(String, (LinkKind, Option<String>))> = vec![
        ("Rozpočet 2027".into(), note_at(ROZPOCET)),
        ("Rozpočet 2027|rozpočet".into(), note_at(ROZPOCET)),
        ("Rozpočet 2027#Rozsah".into(), note_at(ROZPOCET)),
        ("Rozpočet 2027#^otazka1".into(), note_at(ROZPOCET)),
        (nfd_rozpocet.clone(), note_at(ROZPOCET)),
        ("Plán".into(), note_at(PLAN_P)),
        ("Quick Notes/Plán".into(), note_at(PLAN_Q)),
        ("Účty".into(), note_at(UCTY)),
        ("Graf".into(), note_at(GRAF)),
        ("Smlouva".into(), note_at(SMLOUVA)),
        ("2026-10-07".into(), (LinkKind::Daily, Some(DENNI.to_string()))),
        ("2026-10-30".into(), (LinkKind::DateMissing, None)),
        ("Neexistuje".into(), (LinkKind::Unresolved, None)),
        ("Šablona".into(), (LinkKind::Unresolved, None)),
        ("Smazaná".into(), (LinkKind::Trashed, Some(SMAZANA.to_string()))),
    ];
    let targets: Vec<String> = cases.iter().map(|(t, _)| t.clone()).collect();
    let got = core.resolve_links(ODKAZY, &targets);
    assert_eq!(got.len(), cases.len(), "one result per target");
    let mut bad = Vec::new();
    for ((t, want), g) in cases.iter().zip(&got) {
        let have = (g.kind.clone(), g.path.as_deref().map(nfc));
        if &have != want {
            bad.push(format!("{t:?}: want {want:?}, got {have:?}"));
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "link_resolve(\"Pages/Odkazy.md\", [target]) per R105 (never by title alone, FR-LNK-14)");

    // `[[graf.png]]` → the file, whose live Image object is Images/Graf.md (FR-ATT-07 AC-2): the preview shows Graf.
    let media = core.resolve_links_with_fields(ODKAZY, &strings(&["graf.png"]));
    assert_eq!(media.len(), 1);
    assert_eq!((media[0].0.kind.clone(), media[0].0.path.as_deref().map(nfc)), (LinkKind::Media, Some("_attachments/graf.png".to_string())), "graf.png is a media file");
    assert_eq!(format!("{:?}", media[0].1).contains("Images/Graf.md"), true, "its live object is Images/Graf.md: {:?}", media[0].1);

    // The popover's path is the resolved path, and the rename follow (D-935) lands on the same file.
    for (t, (kind, path)) in &cases {
        if *kind != LinkKind::Note {
            continue;
        }
        let path = path.clone().unwrap_or_default();
        let id = LIVE.iter().find(|(p, _)| *p == path).map(|(_, id)| *id).unwrap_or("?");
        assert_eq!(core.path_by_id(id).as_deref(), Some(path.as_str()), "{t:?}: path_by_id of the resolved object's id ({id}) is the same file");
    }
    drop(core);
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "resolving writes nothing");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-10 AC-10 (L4)

#[test]
fn fr_lnk_10_ac10_tag_counts_for_the_tag_file_and_the_virtual_tag() {
    let sb = sandbox();
    let root = previews_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let before = snapshot(&root);
    let ucty: BTreeSet<String> = core.tag_objects("účty").into_iter().map(|r| nfc(&r.path)).collect();
    assert_eq!(ucty, [ROZPOCET, ODKAZY].iter().map(|s| s.to_string()).collect::<BTreeSet<_>>(), "#účty: Rozpočet (tags:) and Odkazy (inline): 2 objects");
    let napad: Vec<String> = core.tag_objects("nápad").into_iter().map(|r| nfc(&r.path)).collect();
    assert_eq!(napad, strings(&[ODKAZY]), "#nápad (virtual, D-694): 1 object");
    // The Tag object's preview follows its file like any object's (D-935).
    assert_eq!(core.path_by_id(ID_UCTY).as_deref(), Some(UCTY), "path_by_id of the Tag file's id");
    drop(core);
    assert!(!root.join("Tags/nápad.md").exists(), "no Tags/nápad.md is created (FR-TAG-03)");
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "nothing is written");
}
