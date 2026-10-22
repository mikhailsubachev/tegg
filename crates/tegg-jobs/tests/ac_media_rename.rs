//! MS6 slice 6A AC test with the 4C job engine (L4, D-631): FR-ATT-01 AC-4's last sentence (docs/acceptance/
//! trash-media.md; FR-ATT-08): renaming an Image object later (a title edit, the 4C rename job) renames its `.md` and
//! rewrites the links to the object, but never touches the image file: `_attachments/záhon.png` keeps its name, bytes,
//! mtime and inode, the object's `file:` line and every `![[záhon.png]]` embed stay as they are, and the renamed object
//! still pairs with its file (ms6-trash-media §1.3 and §10 item 1: pairs are found through `file:`, not by name).
//! Interface docs/contracts/ms4-jobs.md (`JobOp::NoteRename`), ms6-trash-media.md §1.3 (`Core::pair_of`). Written from
//! the ACs and the contracts only (D-61).
//!
//! Fixture: tests/fixtures/vaults/trash-media + new-empty/.tegg in a temporary directory, plus a page that links the
//! object by name and by path and embeds its file.

#[macro_use]
mod common;

use common::*;
use tegg_format::nfc;
use tegg_jobs::Phase;

const IMG: &str = "Images/Záhon.md";
const NEW: &str = "Images/Záhon u plotu.md";
const PNG: &str = "_attachments/záhon.png";
const PLAN: &str = "Pages/Plán zahrady.md";
const GALERIE: &str = "Pages/Galerie.md";

fn tm_vault(sb: &Sandbox) -> std::path::PathBuf {
    let root = sb.base.join("Zahrada");
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fx.join("trash-media"), &root, &["README.md", "make-media.mjs"]);
    copy_dir(&fx.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    write_raw(
        &root,
        GALERIE,
        "---\nid: 01JB6A0000000000000000F050\ntype: page\ntitle: Galerie\n---\nObjekt [[Záhon]] a cestou [[Images/Záhon|obrázek]].\n\n![[záhon.png]]\n".as_bytes(),
    );
    root
}

#[test]
fn fr_att_01_ac4_renaming_an_image_object_never_touches_its_file() {
    let sb = sandbox();
    let root = tm_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    let img_before = some!(read_text(&root, IMG), "Images/Záhon.md");
    let (_, report) = ok!(rename(&core, IMG, "Záhon u plotu"), "rename Záhon → Záhon u plotu");
    assert_eq!(report.phase, Phase::Done, "the job ends done: {report:?}");
    assert_eq!(report.renamed, Some((IMG.to_string(), NEW.to_string())), "the object's .md is renamed");
    let after = snapshot(&root);
    assert_eq!(before.get(PNG), after.get(PNG), "the image file keeps its name, bytes, mtime and inode (FR-ATT-08)");
    let new = some!(read_text(&root, NEW), "Images/Záhon u plotu.md");
    assert!(new.contains("title: Záhon u plotu\n"), "the new title");
    assert!(new.contains("file: \"[[záhon.png]]\"\n"), "file: unchanged");
    assert_eq!(
        no_modified(&new).replace("title: Záhon u plotu", "title: Záhon"),
        no_modified(&img_before),
        "only title and modified change in the object"
    );
    assert_eq!(
        read_text(&root, GALERIE),
        Some("---\nid: 01JB6A0000000000000000F050\ntype: page\ntitle: Galerie\n---\nObjekt [[Záhon u plotu]] a cestou [[Images/Záhon u plotu|obrázek]].\n\n![[záhon.png]]\n".to_string()),
        "links to the object are rewritten; the embed of the file is not"
    );
    assert_eq!(before.get(PLAN), after.get(PLAN), "Plán (it embeds the file only) is untouched");
    let changed_now = changed(&before, &after);
    assert_eq!(changed_now, set(&[IMG, NEW, GALERIE]), "nothing else written");
    assert_eq!(core.pair_of(NEW).map(|p| nfc(&p)), Some(PNG.to_string()), "the renamed object still pairs with its file (§1.3: through file:)");
}
