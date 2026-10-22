//! MS6 slice 6A AC tests at the core (L4): links to trashed objects (docs/acceptance/trash-media.md R74, FR-HIS-01
//! AC-11 `link_resolve`'s `trashed` state: from Odkazy, `[[Stará poznámka]]` and `![[Smazaný obrázek.png]]` resolve
//! only in `.trash/`; after a restore they are normal, after trashing Úkol `[[Koupit semínka]]` is trashed; no file is
//! written; AC-12 `embed_load` state `trashed`; AC-13 not broken, backlinks after the restore, a trashed note's links are
//! never backlinks). Interface docs/contracts/ms6-trash-media.md §2 (`LinkKind::Trashed`, D-291 rules over `.trash/` with
//! its prefix removed; broken links exclude trashed targets), §1.5 (a trashed note resolves as from its original path).
//! Written from the ACs and the contract only (D-61).

mod common;
mod trash6a_setup;

use std::time::Duration;

use common::*;
use tegg_core::{EmbedLoadState, LinkKind};
use tegg_format::nfc;
use trash6a_setup::*;

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

fn resolve(core: &tegg_core::Core, from: &str, targets: &[&str]) -> Vec<(LinkKind, Option<String>, Option<String>, Option<String>)> {
    core.resolve_links(from, &strs(targets)).into_iter().map(|t| (t.kind, t.path.map(|p| nfc(&p)), t.title, t.r#type)).collect()
}

// ------------------------------------------------------------------------------------------------ AC-11

#[test]
fn fr_his_01_ac11_link_resolve_gives_trashed_for_targets_only_in_the_trash() {
    let sb = sandbox();
    let root = tm_vault(&sb);
    let core = open(&root, &sb);
    let before = snap(&root);
    let got = resolve(&core, ODKAZY, &["Stará poznámka", "Koupit semínka", "Smazaný obrázek.png", "osiřelý.jpg", "Neexistuje"]);
    assert_eq!(
        got,
        vec![
            (LinkKind::Trashed, Some(T1.to_string()), Some("Stará poznámka".to_string()), Some("quick-note".to_string())),
            (LinkKind::Note, Some(UKOL.to_string()), Some("Koupit semínka".to_string()), Some("task".to_string())),
            (LinkKind::Trashed, Some(T3.to_string()), Some("Smazaný obrázek".to_string()), Some("image".to_string())),
            (LinkKind::Trashed, Some(T4.to_string()), Some("osiřelý.jpg".to_string()), Some("image".to_string())),
            (LinkKind::Unresolved, None, None, None),
        ],
        "R74: a trashed object, a live note, a trashed pair (the object), a trashed bare file, nothing"
    );
    let by_id = resolve(&core, ODKAZY, &["01JB6A0000000000000000F006"]);
    assert_eq!(by_id[0].0, LinkKind::Trashed, "ids resolve in the trash too (D-291 rules)");
    assert_eq!(changed(&before, &snap(&root)), Vec::<String>::new(), "no file is written (AP-531)");
}

#[test]
fn fr_his_01_ac11_restore_and_trash_change_the_state() {
    let sb = sandbox();
    let root = tm_vault(&sb);
    let core = open(&root, &sb);
    ok!(core.trash_restore(T1), "trash_restore");
    let normal = wait_until(Duration::from_secs(2), || resolve(&core, ODKAZY, &["Stará poznámka"])[0].0 == LinkKind::Note);
    assert!(normal.is_some(), "a normal link within 2 s of the restore");
    let base = version(&core, UKOL);
    ok!(core.trash_object(UKOL, &base), "trash_object");
    let trashed = wait_until(Duration::from_secs(2), || resolve(&core, ODKAZY, &["Koupit semínka"])[0].0 == LinkKind::Trashed);
    assert!(trashed.is_some(), "[[Koupit semínka]] is trashed within 2 s");
    assert_eq!(resolve(&core, ODKAZY, &["Koupit semínka"])[0].1.as_deref(), Some(".trash/Tasks/Koupit semínka.md"), "the trashed path");
}

#[test]
fn fr_his_01_ac11_a_trashed_note_resolves_as_from_its_original_path() {
    let sb = sandbox();
    let root = tm_vault(&sb);
    write_raw(&root, ".trash/Pages/Starý odkaz.md", "---\nid: 01JB6A0000000000000000F031\ntype: page\ntitle: Starý odkaz\n---\n[[Dvojče]] a [[Zahrada]].\n".as_bytes());
    write_raw(&root, "Pages/Dvojče.md", "---\nid: 01JB6A0000000000000000F032\ntype: page\ntitle: Dvojče\n---\n".as_bytes());
    write_raw(&root, "Ab/Dvojče.md", "---\nid: 01JB6A0000000000000000F033\ntype: page\ntitle: Dvojče\n---\n".as_bytes());
    let core = open(&root, &sb);
    let got = resolve(&core, ".trash/Pages/Starý odkaz.md", &["Dvojče", "Zahrada"]);
    assert_eq!(got.iter().map(|g| (g.0, g.1.clone())).collect::<Vec<_>>(), vec![(LinkKind::Note, Some("Pages/Dvojče.md".to_string())), (LinkKind::Note, Some(ZAHRADA.to_string()))], "as from its original folder Pages/ (same folder first, not the shorter Ab/), §1.5");
    assert!(!core.backlinks(ZAHRADA).iter().any(|p| nfc(p).starts_with(".trash/")), "its links are never backlinks (D-278)");
    assert_eq!(core.trash_list().iter().filter(|r| nfc(&r.path) == ".trash/Pages/Starý odkaz.md").count(), 1, "listed in the trash");
}

// ------------------------------------------------------------------------------------------------ AC-12

#[test]
fn fr_his_01_ac12_embed_load_reports_trashed() {
    let sb = sandbox();
    let root = tm_vault(&sb);
    let core = open(&root, &sb);
    let got: Vec<(String, EmbedLoadState)> = core.embed_load(&strs(&[T1, T3, ".trash/Pages/Nic.md"])).into_iter().map(|n| (nfc(&n.path), n.state)).collect();
    assert_eq!(got, vec![(T1.to_string(), EmbedLoadState::Trashed), (T3.to_string(), EmbedLoadState::Trashed), (".trash/Pages/Nic.md".to_string(), EmbedLoadState::Missing)], "state trashed for an existing path under .trash/");
}

// ------------------------------------------------------------------------------------------------ AC-13

#[test]
fn fr_his_01_ac13_not_broken_and_backlinks_after_restore() {
    let sb = sandbox();
    let root = tm_vault(&sb);
    let core = open(&root, &sb);
    let broken = core.broken_links();
    assert!(!broken.groups.iter().any(|g| g.key == "stará poznámka"), "the Broken links page doesn't list Stará poznámka: {:?}", broken.groups.iter().map(|g| &g.key).collect::<Vec<_>>());
    assert!(!broken.groups.iter().any(|g| g.key.contains("smazaný obrázek")), "nor the trashed pair");
    ok!(core.trash_restore(T1), "trash_restore");
    let back = wait_until(Duration::from_secs(2), || core.backlinks("Quick Notes/Stará poznámka.md").iter().any(|p| nfc(p) == ODKAZY));
    assert!(back.is_some(), "the restored note's backlinks list Odkazy");
}
