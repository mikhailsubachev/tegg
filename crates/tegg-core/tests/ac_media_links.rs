//! MS6 slice 6A AC tests at the core (L4): media link resolution (docs/contracts/ms6-trash-media.md §3.2; docs/
//! acceptance/trash-media.md R77, FR-ATT-01 AC-12 "`![[záhon.png]]` resolves to a pair; a bare file with no object;
//! `![[missing.png]]`", FR-ATT-07 via R72/R77). A target whose last segment has an extension other than `.md` resolves
//! against the vault's files by Obsidian's rules (exact path case-insensitive and NFC, then the name in the source's
//! folder, then the unique name anywhere, else the shortest path); kind `Media`, `path` = the file, `object` = the live
//! Image/PDF object whose `file:` resolves to it (path order), `title` = the object's title or the file name, `type`
//! from the object or the extension class; templates and `.trash/` excluded. Written from the ACs and the contract only
//! (D-61).

mod common;
mod trash6a_setup;

use common::*;
use tegg_core::LinkKind;
use tegg_format::nfc;
use trash6a_setup::*;

type Got = (LinkKind, Option<String>, Option<String>, Option<String>, Option<String>);
fn resolve(core: &tegg_core::Core, from: &str, targets: &[&str]) -> Vec<Got> {
    core.resolve_links_with_fields(from, &strs(targets))
        .into_iter()
        .map(|(t, f)| (t.kind, t.path.map(|p| nfc(&p)), f.object.map(|p| nfc(&p)), t.title, t.r#type))
        .collect()
}
fn s(v: &str) -> Option<String> {
    Some(v.to_string())
}

#[test]
fn fr_att_01_ac12_a_pair_resolves_to_its_file_and_object() {
    let sb = sandbox();
    let root = tm_vault(&sb);
    let core = open(&root, &sb);
    let got = resolve(&core, PLAN, &["záhon.png", "Rozpočet.pdf", "ZÁHON.PNG", "_attachments/záhon.png", "za\u{301}hon.png"]);
    let pair = (LinkKind::Media, s(PNG), s(IMG), s("Záhon"), s("image"));
    assert_eq!(
        got,
        vec![pair.clone(), (LinkKind::Media, s(PDF), s(PDF_OBJ), s("Rozpočet"), s("pdf")), pair.clone(), pair.clone(), pair],
        "§3.2: the file with its object; case-insensitive; an exact path; NFC"
    );
}

#[test]
fn fr_att_01_ac12_a_bare_file_and_a_missing_file() {
    let sb = sandbox();
    let root = tm_vault(&sb);
    write_raw(&root, "_attachments/holý.png", &fixture(PNG));
    write_raw(&root, "_attachments/poznámky.txt", b"text\n");
    let core = open(&root, &sb);
    let got = resolve(&core, PLAN, &["holý.png", "missing.png", "poznámky.txt"]);
    assert_eq!(
        got,
        vec![
            (LinkKind::Media, s("_attachments/holý.png"), None, s("holý.png"), s("image")),
            (LinkKind::Unresolved, None, None, None, None),
            (LinkKind::Media, s("_attachments/poznámky.txt"), None, s("poznámky.txt"), None),
        ],
        "a bare file is media with no object; a missing file is unresolved; another type has no type"
    );
}

#[test]
fn fr_att_01_ac12_obsidian_rules_same_folder_then_shortest_path() {
    let sb = sandbox();
    let root = tm_vault(&sb);
    write_raw(&root, "Pages/foto.png", &fixture(PNG));
    write_raw(&root, "_attachments/foto.png", &fixture(PNG));
    write_raw(&root, "Archiv/2026/foto.png", &fixture(PNG));
    write_raw(&root, "_templates/Page/šablona.png", &fixture(PNG));
    let core = open(&root, &sb);
    assert_eq!(resolve(&core, PLAN, &["foto.png"])[0].1, s("Pages/foto.png"), "the name in the source's folder first");
    assert_eq!(resolve(&core, "Tasks/Koupit semínka.md", &["foto.png"])[0].1, s("Pages/foto.png"), "else the shortest path (Pages/ before _attachments/ by length, then path order)");
    assert_eq!(resolve(&core, PLAN, &["šablona.png"])[0].0, LinkKind::Unresolved, "templates are excluded");
}

#[test]
fn fr_att_01_ac12_several_objects_on_one_file_take_path_order() {
    let sb = sandbox();
    let root = tm_vault(&sb);
    write_raw(&root, "Images/Aaa záhon.md", "---\nid: 01JB6A0000000000000000F040\ntype: image\ntitle: Aaa záhon\nfile: \"[[záhon.png]]\"\nmedia-type: image/png\n---\n".as_bytes());
    let core = open(&root, &sb);
    assert_eq!(resolve(&core, PLAN, &["záhon.png"])[0].2, s("Images/Aaa záhon.md"), "the first object in path order");
}
