//! MS4 slice 4F AC tests at the core (L4): FR-EMB-01 AC-2 (embed targets resolve like links, from the host and,
//! through `embed_load`, from each embedded file's own path), AC-6 (inserted targets resolve to the chosen files);
//! FR-EMB-02 AC-6 (effective and raw `embed` of every type), AC-7 (`TypeOp::SetEmbed` through `type_patch`: bytes,
//! no write for the same value, Task materialised from its built-in text, D-90), AC-10 (events and fresh content for
//! created, changed and deleted targets and a changed type file), AC-11 (`embed_load` records no recency, D-138);
//! FR-EMB-03 AC-3 (the version `embed_load` returns is the base of the embed's save: an external change is a
//! `Conflict`, NFR-REL-02) and AC-11's data part (a file with an invalid UTF-8 byte loads with `utf8: false`).
//! docs/acceptance/embeds.md; interface docs/contracts/ms4-embeds.md §3, §4. Written from the ACs and the contract
//! only (D-61).
//!
//! Fixture: tests/fixtures/vaults/embeds (without its README.md) + new-empty/.tegg in a temporary directory on APFS.
//! Bytes, mtime and inode are compared with `common::snapshot`.

mod common;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::Receiver;
use std::sync::Arc;
use std::time::Duration;

use common::*;
use tegg_core::{Core, CoreEvent, CoreOptions, EmbedLoadState, EmbedNote, LinkKind, LinkTarget, TypeInfo, WriteOutcome};
use tegg_format::nfc;
use tegg_schema::{EmbedMode, Readability, TypeOp};
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

const CIL: &str = "Pages/Cíl.md";
const JANA: &str = "Osoby/Jana Nováková.md";
const SVICKOVA: &str = "Recepty/Svíčková.md";
const SATURNIN: &str = "Knihy/Saturnin.md";
const REZIMY: &str = "Pages/Režimy.md";
const ROZBITA: &str = "Pages/Rozbitá vložení.md";
const NFD_HOST: &str = "Pages/NFD vložení.md";
const VLOZENI_DVOJNIKA: &str = "Quick Notes/Vložení dvojníka.md";
const DVOJNIK_HOST: &str = "Pages/Dvojník host.md";
const DVOJNIK_P: &str = "Pages/Dvojník.md";
const DVOJNIK_Q: &str = "Quick Notes/Dvojník.md";
const DENNI: &str = "Daily/2026-10-07.md";
const UPRAVY: &str = "Pages/Úpravy.md";
const UPRAVITELNA: &str = "Pages/Upravitelná.md";
const VKLADANI: &str = "Pages/Vkládání.md";
const SABLONA: &str = "_templates/Page/Šablona.md";
const SMAZANA: &str = ".trash/Pages/Smazaná.md";

const NFD_CIL: &str = "Ci\u{301}l";
const NFD_UVOD: &str = "U\u{301}vod";

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
/// `tests/fixtures/vaults/embeds/` (without its README.md) plus `new-empty/.tegg/` in `<sandbox>/Vložení`.
fn embeds_vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Vložení");
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fx.join("embeds"), &root, &["README.md"]);
    copy_dir(&fx.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
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
    std::fs::read_to_string(repo_root().join("tests/fixtures/vaults").join(rel)).expect("setup: fixture")
}
fn swap(text: &str, from: &str, to: &str) -> String {
    assert!(text.contains(from), "fixture no longer contains {from:?}");
    text.replacen(from, to, 1)
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
fn get(core: &Core, key: &str) -> TypeInfo {
    match core.type_get(key) {
        Some(t) => t,
        None => {
            assert!(false, "type_get({key:?}) returned None");
            unreachable!()
        }
    }
}

/// The target part of a link target as the UI asks for it: before `#` / `|`, trimmed, NFC.
fn base_target(t: &str) -> String {
    let t = nfc(t);
    let cut = t.find(['#', '|']).unwrap_or(t.len());
    t[..cut].trim().to_string()
}
/// The one note `embed_load` returned for `path`; a missing entry is an assertion failure.
fn loaded<'a>(notes: &'a [EmbedNote], path: &str) -> &'a EmbedNote {
    match notes.iter().find(|n| nfc(&n.path) == path) {
        Some(n) => n,
        None => {
            assert!(false, "embed_load returned no entry for {path:?}; got {:?}", notes.iter().map(|n| n.path.clone()).collect::<Vec<_>>());
            unreachable!()
        }
    }
}
/// Every link of a loaded note whose target part is `target`, as (kind, NFC path).
fn link_of(n: &EmbedNote, target: &str) -> Vec<(LinkKind, Option<String>)> {
    n.links.iter().filter(|l| base_target(&l.target) == target).map(|l| (l.kind.clone(), l.path.as_deref().map(nfc))).collect()
}
fn one(got: &[LinkTarget]) -> (LinkKind, Option<String>) {
    assert_eq!(got.len(), 1, "one result per target: {got:?}");
    (got[0].kind.clone(), got[0].path.as_deref().map(nfc))
}
fn note_at(path: &str) -> (LinkKind, Option<String>) {
    (LinkKind::Note, Some(path.to_string()))
}

// ------------------------------------------------------------------------------------------------ FR-EMB-01 AC-2

#[test]
fn fr_emb_01_ac2_embed_targets_resolve_by_the_link_rules_from_the_host() {
    let sb = sandbox();
    let root = embeds_vault(&sb);
    write_raw(&root, DVOJNIK_HOST, "---\nid: 01JB4F0000000000000000R001\ntype: page\ntitle: Dvojník host\n---\n![[Dvojník]]\n".as_bytes());
    let core = open(&root, &sb, false);

    // From the host, in its one batch call (ms3-shell §11.1).
    let nfd = core.resolve_links(NFD_HOST, &strings(&[NFD_CIL, &format!("{NFD_CIL}#{NFD_UVOD}")]));
    assert_eq!(nfd.iter().map(|l| (l.kind.clone(), l.path.as_deref().map(nfc))).collect::<Vec<_>>(), vec![note_at(CIL), note_at(CIL)], "NFD targets");
    assert_eq!(one(&core.resolve_links(VLOZENI_DVOJNIKA, &strings(&["Dvojník"]))), note_at(DVOJNIK_Q), "same folder first");
    assert_eq!(one(&core.resolve_links(DVOJNIK_HOST, &strings(&["Dvojník"]))), note_at(DVOJNIK_P), "same folder from Pages/");
    assert_eq!(one(&core.resolve_links(REZIMY, &strings(&["2026-10-07"]))), (LinkKind::Daily, Some(DENNI.to_string())), "date first (D-162)");
    let broken = core.resolve_links(ROZBITA, &strings(&["Chybí", "Šablona", "Smazaná", "Reading list", "2026-10-20"]));
    assert_eq!(
        broken.iter().map(|l| l.kind.clone()).collect::<Vec<_>>(),
        vec![LinkKind::Unresolved, LinkKind::Unresolved, LinkKind::Unresolved, LinkKind::Unresolved, LinkKind::DateMissing],
        "aliases, templates and .trash/ never resolve (D-141, FR-TPL-07, D-102)"
    );

    // The same resolution through `embed_load`: each file's own targets, resolved from its own path.
    let notes = core.embed_load(&strings(&[NFD_HOST, VLOZENI_DVOJNIKA, DVOJNIK_HOST, REZIMY, ROZBITA, CIL]));
    assert_eq!(notes.len(), 6, "one entry per path");
    for n in &notes {
        assert_eq!(n.state, EmbedLoadState::Ok, "{}: state", n.path);
        let again = core.resolve_links(&n.path, &n.links.iter().map(|l| l.target.clone()).collect::<Vec<_>>());
        assert_eq!(n.links, again, "{}: embed_load links equal resolve_links from the file's own path", n.path);
    }
    let h = loaded(&notes, NFD_HOST);
    assert!(!h.links.is_empty() && h.links.iter().all(|l| (l.kind.clone(), l.path.as_deref().map(nfc)) == note_at(CIL)), "NFD vložení: both embeds → Cíl: {:?}", h.links);
    assert_eq!(link_of(loaded(&notes, VLOZENI_DVOJNIKA), "Dvojník"), vec![note_at(DVOJNIK_Q)]);
    assert_eq!(link_of(loaded(&notes, DVOJNIK_HOST), "Dvojník"), vec![note_at(DVOJNIK_P)]);
    let rez = loaded(&notes, REZIMY);
    assert_eq!(link_of(rez, "2026-10-07"), vec![(LinkKind::Daily, Some(DENNI.to_string()))]);
    for (t, p) in [("Jana Nováková", JANA), ("Svíčková", SVICKOVA), ("Saturnin", SATURNIN)] {
        let got = link_of(rez, t);
        assert!(!got.is_empty() && got.iter().all(|g| *g == note_at(p)), "Režimy: {t} → {p}: {got:?}");
    }
    let roz = loaded(&notes, ROZBITA);
    for t in ["Chybí", "Šablona", "Smazaná", "Reading list"] {
        assert_eq!(link_of(roz, t).into_iter().map(|g| g.0).collect::<Vec<_>>(), vec![LinkKind::Unresolved], "Rozbitá vložení: {t}");
    }
    assert_eq!(link_of(roz, "2026-10-20").into_iter().map(|g| g.0).collect::<Vec<_>>(), vec![LinkKind::DateMissing]);
    assert!(link_of(roz, "obrázek.png").is_empty(), "attachments aren't embed targets");
    // A link inside an embedded note resolves from that note's path.
    assert_eq!(link_of(loaded(&notes, CIL), "Jana Nováková"), vec![note_at(JANA)], "Cíl's [[Jana Nováková]]");
}

#[test]
fn fr_emb_01_ac2_an_embed_and_a_link_to_the_same_target_resolve_to_the_same_file() {
    let sb = sandbox();
    let root = embeds_vault(&sb);
    let oba = "Quick Notes/Oba tvary.md";
    write_raw(&root, oba, "---\nid: 01JB4F0000000000000000R002\ntype: quick-note\n---\nOdkaz [[Dvojník]] a [[Dvojník|jinak]].\n\n![[Dvojník]]\n".as_bytes());
    let core = open(&root, &sb, false);
    let notes = core.embed_load(&strings(&[oba]));
    let n = loaded(&notes, oba);
    let got = link_of(n, "Dvojník");
    assert!(!got.is_empty(), "the links of {oba}: {:?}", n.links);
    assert!(got.iter().all(|g| *g == note_at(DVOJNIK_Q)), "link and embed both → {DVOJNIK_Q}: {got:?}");
    let mut seen = BTreeSet::new();
    assert!(n.links.iter().all(|l| seen.insert(l.target.clone())), "targets deduplicated in first-seen order: {:?}", n.links);
}

#[test]
fn fr_emb_01_ac2_templates_trash_and_missing_files_load_as_missing() {
    let sb = sandbox();
    let root = embeds_vault(&sb);
    let core = open(&root, &sb, false);
    let notes = core.embed_load(&strings(&["Pages/Chybí.md", SABLONA, SMAZANA, CIL]));
    assert_eq!(notes.len(), 4, "one entry per path: {notes:?}");
    for p in ["Pages/Chybí.md", SABLONA, SMAZANA] {
        let n = loaded(&notes, p);
        assert_eq!((n.state, n.text.is_none(), n.version.is_none()), (EmbedLoadState::Missing, true, true), "{p}: missing, no text, no version");
    }
    assert_eq!(loaded(&notes, CIL).state, EmbedLoadState::Ok, "Cíl loads");
}

// ------------------------------------------------------------------------------------------------ FR-EMB-01 AC-6

#[test]
fn fr_emb_01_ac6_inserted_targets_resolve_to_the_chosen_files() {
    let sb = sandbox();
    let root = embeds_vault(&sb);
    // A runtime copy of Cíl with an NFD file name; the embed is written in NFC (FR-FMT-12).
    let copy_nfd = format!("Pages/{NFD_CIL} kopie.md");
    write_raw(&root, &copy_nfd, swap(&fixture("embeds/Pages/Cíl.md"), "E001", "R003").as_bytes());
    // Vkládání after the insertions of AC-6 (a)…(e).
    let body = "Odstavec před.\n\n![[Cíl]]\n\n![[C tips]]\n\n![[Senior Product Manager (2)]]\n\n![[Dvojník]]\n\n![[Quick Notes/Dvojník]]\n\n![[Cíl kopie]]\n\nOdstavec po.\n";
    let text = swap(&fixture("embeds/Pages/Vkládání.md"), "Odstavec před.\n\nOdstavec po.\n", body);
    write_raw(&root, VKLADANI, text.as_bytes());
    let core = open(&root, &sb, false);
    let targets = strings(&["Cíl", "C tips", "Senior Product Manager (2)", "Dvojník", "Quick Notes/Dvojník", "Cíl kopie"]);
    let want = vec![
        note_at(CIL),
        note_at("Pages/C tips.md"),
        note_at("Pages/Senior Product Manager (2).md"),
        note_at(DVOJNIK_P),
        note_at(DVOJNIK_Q),
        note_at("Pages/Cíl kopie.md"),
    ];
    let got = core.resolve_links(VKLADANI, &targets);
    assert_eq!(got.iter().map(|l| (l.kind.clone(), l.path.as_deref().map(nfc))).collect::<Vec<_>>(), want, "link_resolve from Vkládání (FR-LNK-14)");
    let notes = core.embed_load(&strings(&[VKLADANI]));
    let v = loaded(&notes, VKLADANI);
    for (t, w) in targets.iter().zip(want.iter()) {
        assert_eq!(link_of(v, t), vec![w.clone()], "embed_load links of Vkládání: {t}");
    }
}

// ------------------------------------------------------------------------------------------------ FR-EMB-02 AC-6

#[test]
fn fr_emb_02_ac6_types_return_the_effective_mode_and_the_raw_value() {
    let sb = sandbox();
    let root = embeds_vault(&sb);
    let before = snapshot(&root);
    let core = open(&root, &sb, false);
    let want: [(&str, EmbedMode, Option<&str>); 11] = [
        ("page", EmbedMode::Full, None),
        ("quick-note", EmbedMode::Full, None),
        ("daily-note", EmbedMode::Full, None),
        ("task", EmbedMode::Card, None),
        ("tag", EmbedMode::Card, None),
        ("image", EmbedMode::Card, None),
        ("pdf", EmbedMode::Card, None),
        ("osoba", EmbedMode::Card, None),
        ("recept", EmbedMode::Full, Some("full")),
        ("kniha", EmbedMode::Link, Some("link")),
        ("místo", EmbedMode::Card, Some("obrovský")),
    ];
    let all = core.types();
    for (key, mode, raw) in want {
        let t = get(&core, key);
        assert_eq!((t.embed, t.embed_raw.as_deref()), (mode, raw), "type_get({key:?})");
        let listed = all.iter().find(|x| x.key == key);
        assert_eq!(listed.map(|x| (x.embed, x.embed_raw.clone())), Some((mode, raw.map(str::to_string))), "vault_types: {key}");
    }
    assert_eq!(get(&core, "místo").readability, Readability::Ok, "an unknown value isn't an error");
    let _ = core.type_rows("místo");
    let _ = core.embed_load(&strings(&["Místa/Praha.md"]));
    drop(core);
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "reading, opening and indexing never change a file (D-417)");
}

// ------------------------------------------------------------------------------------------------ FR-EMB-02 AC-7

#[test]
fn fr_emb_02_ac7_type_patch_set_embed_writes_one_line() {
    let sb = sandbox();
    let root = embeds_vault(&sb);
    let core = open(&root, &sb, false);
    let osoba = fixture("embeds/.tegg/types/osoba.yml");
    let before = snapshot(&root);
    let base = get(&core, "osoba").version;
    assert!(base.is_some(), "setup: osoba.yml has a version");
    let t = ok!(core.type_patch("osoba", base.as_ref(), &[TypeOp::SetEmbed(EmbedMode::Full)]), "Full");
    assert_eq!(read(&root, ".tegg/types/osoba.yml"), swap(&osoba, "preview: [firma, role]\n", "preview: [firma, role]\nembed: full\n"), "exactly the line `embed: full` after preview");
    assert_eq!((t.embed, t.embed_raw.as_deref()), (EmbedMode::Full, Some("full")), "returned type");
    assert_eq!(changed(&before, &snapshot(&root)), vec![".tegg/types/osoba.yml".to_string()], "only osoba.yml is written; no note");
    let t2 = ok!(core.type_patch("osoba", t.version.as_ref(), &[TypeOp::SetEmbed(EmbedMode::Card)]), "Card");
    assert_eq!(read(&root, ".tegg/types/osoba.yml"), swap(&osoba, "preview: [firma, role]\n", "preview: [firma, role]\nembed: card\n"), "the key stays, its value changes");
    assert_eq!(t2.embed, EmbedMode::Card);
    let mid = snapshot(&root);
    let t3 = ok!(core.type_patch("osoba", t2.version.as_ref(), &[TypeOp::SetEmbed(EmbedMode::Card)]), "Card again");
    assert_eq!(t3.embed, EmbedMode::Card);
    assert_eq!(changed(&mid, &snapshot(&root)), Vec::<String>::new(), "the option already checked writes nothing (bytes, mtime, inode)");
}

#[test]
fn fr_emb_02_ac7_task_without_a_file_is_created_from_the_built_in_text() {
    let sb = sandbox();
    let root = embeds_vault(&sb);
    std::fs::remove_file(root.join(".tegg/types/task.yml")).expect("setup: delete task.yml");
    let core = open(&root, &sb, false);
    assert_eq!(get(&core, "task").embed, EmbedMode::Card, "Task without a file: R31 card");
    let before = snapshot(&root);
    let t = ok!(core.type_patch("task", None, &[TypeOp::SetEmbed(EmbedMode::Full)]), "Full on task");
    let builtin = fixture("new-empty/.tegg/types/task.yml");
    assert_eq!(
        read(&root, ".tegg/types/task.yml"),
        swap(&builtin, "preview: [status, priority, due]\n", "preview: [status, priority, due]\nembed: full\n"),
        "task.yml created from the built-in file with `embed: full` after preview (D-90)"
    );
    assert_eq!((t.embed, t.exists), (EmbedMode::Full, true));
    assert_eq!(changed(&before, &snapshot(&root)), vec![".tegg/types/task.yml".to_string()], "exactly one file created");
}

// ------------------------------------------------------------------------------------------------ FR-EMB-02 AC-10

#[test]
fn fr_emb_02_ac10_changed_created_and_deleted_targets_give_events_and_fresh_content() {
    let sb = sandbox();
    let root = embeds_vault(&sb);
    let core = open(&root, &sb, true);
    let rx = core.events();
    let limit = Duration::from_secs(2);
    let mut seen: Vec<String> = Vec::new();
    let saw = |core: &Core, rx: &Receiver<CoreEvent>, path: &str, seen: &mut Vec<String>| {
        let _ = core;
        wait_until(limit, || {
            seen.extend(changed_paths(rx));
            seen.iter().any(|p| p == path)
        })
        .is_some()
    };

    // Another program appends a paragraph to Cíl.
    let cil = format!("{}\nNový odstavec.\n", fixture("embeds/Pages/Cíl.md"));
    write_raw(&root, CIL, cil.as_bytes());
    assert!(saw(&core, &rx, CIL, &mut seen), "vault:changed for {CIL} within 2 s (got {seen:?})");
    let n = core.embed_load(&strings(&[CIL]));
    assert_eq!(n.iter().map(|x| x.text.clone()).collect::<Vec<_>>(), vec![Some(cil.clone())], "embed_load returns the new text, from the file");

    // Svíčková's title, Jana's role.
    let sv = swap(&fixture("embeds/Recepty/Svíčková.md"), "title: Svíčková\n", "title: Svíčková na smetaně\n");
    write_raw(&root, SVICKOVA, sv.as_bytes());
    let jana = swap(&fixture("embeds/Osoby/Jana Nováková.md"), "role: Analytička\n", "role: Vedoucí\n");
    write_raw(&root, JANA, jana.as_bytes());
    assert!(saw(&core, &rx, SVICKOVA, &mut seen) && saw(&core, &rx, JANA, &mut seen), "events for Svíčková and Jana (got {seen:?})");
    let n = core.embed_load(&strings(&[SVICKOVA, JANA]));
    assert_eq!(n.iter().map(|x| x.text.clone()).collect::<Vec<_>>(), vec![Some(sv), Some(jana)], "fresh texts");

    // Saturnin deleted: its embed becomes broken.
    std::fs::remove_file(root.join(SATURNIN)).expect("delete Saturnin");
    assert!(saw(&core, &rx, SATURNIN, &mut seen), "event for the deleted {SATURNIN}");
    assert!(wait_until(limit, || one(&core.resolve_links(REZIMY, &strings(&["Saturnin"]))).0 == LinkKind::Unresolved).is_some(), "Saturnin no longer resolves");
    assert_eq!(core.embed_load(&strings(&[SATURNIN])).iter().map(|x| x.state).collect::<Vec<_>>(), vec![EmbedLoadState::Missing]);

    // Pages/Chybí.md created: `![[Chybí]]` resolves and loads.
    write_raw(&root, "Pages/Chybí.md", "---\ntype: page\n---\n".as_bytes());
    assert!(saw(&core, &rx, "Pages/Chybí.md", &mut seen), "event for the created Pages/Chybí.md");
    assert!(wait_until(limit, || one(&core.resolve_links(ROZBITA, &strings(&["Chybí"]))) == note_at("Pages/Chybí.md")).is_some(), "Chybí resolves within 2 s");
    assert_eq!(core.embed_load(&strings(&["Pages/Chybí.md"])).iter().map(|x| x.state).collect::<Vec<_>>(), vec![EmbedLoadState::Ok]);

    // recept.yml changed to `embed: card`.
    let recept = swap(&read(&root, ".tegg/types/recept.yml"), "embed: full\n", "embed: card\n");
    write_raw(&root, ".tegg/types/recept.yml", recept.as_bytes());
    assert!(saw(&core, &rx, ".tegg/types/recept.yml", &mut seen), "event for recept.yml");
    assert!(wait_until(limit, || core.type_get("recept").map(|t| (t.embed, t.embed_raw)) == Some((EmbedMode::Card, Some("card".into())))).is_some(), "recept's default becomes card within 2 s");
}

// ------------------------------------------------------------------------------------------------ FR-EMB-02 AC-11

#[test]
fn fr_emb_02_ac11_embed_load_records_no_recency_and_reads_each_path_once() {
    let sb = sandbox();
    let root = embeds_vault(&sb);
    let (core, fs) = open_counting(&root, &sb);
    let before = snapshot(&root);
    let recent0 = format!("{:?}", core.switcher("", 50));
    assert!(core.last_opened().is_none(), "setup: nothing opened");
    let reads0 = fs.read_paths().len();
    let notes = core.embed_load(&strings(&[CIL, JANA, SVICKOVA, CIL, DENNI, JANA]));
    assert_eq!(notes.iter().map(|n| nfc(&n.path)).collect::<Vec<_>>(), strings(&[CIL, JANA, SVICKOVA, DENNI]), "deduplicated, first-seen order");
    for n in &notes {
        let disk = read(&root, &nfc(&n.path));
        assert_eq!((n.state, n.utf8, n.text.as_deref()), (EmbedLoadState::Ok, true, Some(disk.as_str())), "{}: text from the file", n.path);
        let v = n.version.as_ref();
        assert_eq!(v.map(|v| v.size), Some(disk.len() as u64), "{}: version of the file read", n.path);
    }
    let reads: Vec<String> = fs.read_paths()[reads0..].iter().map(|p| nfc(p)).collect();
    for p in [CIL, JANA, SVICKOVA, DENNI] {
        assert_eq!(reads.iter().filter(|r| r.as_str() == p).count(), 1, "{p} read exactly once ({reads:?})");
    }
    assert!(core.last_opened().is_none(), "showing an embed isn't opening it (D-138)");
    assert_eq!(format!("{:?}", core.switcher("", 50)), recent0, "the switcher's empty-query list is unchanged");
    assert_eq!(fs.write_count(), 0, "embed_load writes nothing");
    drop(core);
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "no vault file changed");
}

// ------------------------------------------------------------------------------------------------ FR-EMB-03 AC-3

#[test]
fn fr_emb_03_ac3_an_external_change_after_loading_is_a_conflict() {
    for watch in [false, true] {
        let sb = sandbox();
        let root = embeds_vault(&sb);
        let core = open(&root, &sb, watch);
        let notes = core.embed_load(&strings(&[UPRAVITELNA]));
        let n = loaded(&notes, UPRAVITELNA);
        let base = n.version.clone();
        assert!(base.is_some(), "embed_load gives the embed's base version");
        let orig = n.text.clone().unwrap_or_default();
        // Another program changes the file after it was loaded.
        let theirs = swap(&orig, "Text třetí části.", "Text třetí části, upravený jinde.");
        write_raw(&root, UPRAVITELNA, theirs.as_bytes());
        if watch {
            let _ = wait_until(Duration::from_secs(2), || core.embed_load(&strings(&[UPRAVITELNA])).first().and_then(|x| x.text.clone()) == Some(theirs.clone()));
        }
        let upravy = snapshot(&root).get(UPRAVY).cloned();
        let mine = swap(&orig, "První odstavec k úpravě.", "První odstavec k úpravě. Doplněno.");
        let res = core.write_note(UPRAVITELNA, mine.as_bytes(), base.as_ref());
        assert!(format!("{res:?}").contains("Conflict"), "watch={watch}: the editor's version is refused (base check): {res:?}");
        assert_eq!(read(&root, UPRAVITELNA), theirs, "watch={watch}: the other program's bytes are kept");
        assert_eq!(snapshot(&root).get(UPRAVY).cloned(), upravy, "watch={watch}: Úpravy isn't written");
    }
}

#[test]
fn fr_emb_03_ac3_saves_chain_on_the_returned_version() {
    // FR-EMB-03 AC-8's core part: two instances of one file save in order, the second on the first's result.
    let sb = sandbox();
    let root = embeds_vault(&sb);
    let core = open(&root, &sb, false);
    let notes = core.embed_load(&strings(&[UPRAVITELNA]));
    let n = loaded(&notes, UPRAVITELNA);
    let orig = n.text.clone().unwrap_or_default();
    let a = swap(&orig, "k úpravě.", "k úpravě.A");
    let r1 = ok!(core.write_note(UPRAVITELNA, a.as_bytes(), n.version.as_ref()), "first write");
    let v1 = match r1 {
        WriteOutcome::Written(v) => v,
        other => {
            assert!(false, "first write wrote nothing: {other:?}");
            unreachable!()
        }
    };
    let ab = swap(&orig, "k úpravě.", "k úpravě.AB");
    let r2 = core.write_note(UPRAVITELNA, ab.as_bytes(), Some(&v1));
    assert!(matches!(r2, Ok(WriteOutcome::Written(_))), "second write on the first's version: no Conflict: {r2:?}");
    assert_eq!(read(&root, UPRAVITELNA), ab);
}

// ------------------------------------------------------------------------------------------------ FR-EMB-03 AC-11 (data)

#[test]
fn fr_emb_03_ac11_invalid_utf8_and_invalid_frontmatter_load_with_their_flags() {
    let sb = sandbox();
    let root = embeds_vault(&sb);
    let copy = "Pages/Upravitelná neplatná.md";
    let mut bytes = fixture("embeds/Pages/Upravitelná.md").replace("E022", "R004").into_bytes();
    let at = bytes.windows(6).position(|w| w == b"Prvn\xC3\xAD").expect("setup: 'První' in the copy");
    bytes.insert(at, 0xFF);
    write_raw(&root, copy, &bytes);
    let core = open(&root, &sb, false);
    let notes = core.embed_load(&strings(&[copy, "Pages/Chyba hlavičky.md"]));
    let bad = loaded(&notes, copy);
    assert_eq!((bad.state, bad.utf8), (EmbedLoadState::Ok, false), "not UTF-8: loads, flagged");
    assert!(bad.text.as_deref().unwrap_or("").contains("\u{FFFD}První odstavec k úpravě."), "decoded with U+FFFD (D-180): {:?}", bad.text);
    let fm = loaded(&notes, "Pages/Chyba hlavičky.md");
    assert_eq!((fm.state, fm.utf8), (EmbedLoadState::Ok, true), "invalid frontmatter still loads (the UI shows it read-only)");
    assert!(fm.text.as_deref().unwrap_or("").ends_with("Tělo s chybnou hlavičkou.\n"));
}
