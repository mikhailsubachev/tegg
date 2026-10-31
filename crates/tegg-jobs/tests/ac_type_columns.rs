//! Configurable type-page columns, the 4E delete-property job's part (L4): docs/acceptance/type-columns.md FR-TYP-09
//! AC-26 (a): deleting a property removes its key from `columns` in the same type-file change that removes the item
//! (with a value: type-moves.md FR-TYP-04 AC-7's `value-remove` job on Kniha `poznámka`; without values: AC-6's `isbn`
//! path), every occurrence of the key (repeats and NFD spellings) goes, and the job's Undo (FR-TYP-04 AC-8) restores
//! `kniha.yml`'s exact bytes, the `columns` line included. BRD D-1240, D-807. Interface: docs/contracts/type-columns.md
//! §1 (`RemoveAttribute` also removes `columns` entries; the 4E job's type-file change uses the same op) and
//! docs/contracts/ms4-jobs.md §14.9. Written from the ACs and the contracts only (D-61). On a temporary copy of the
//! type-moves fixture with the real `@tegg/doc` transformer (`npm run build --prefix packages/doc`); `kniha.yml` gets a
//! runtime `columns` line (the fixture stays as it is).

#[macro_use]
mod common;
mod moves_setup;
mod tags_setup;

use std::collections::BTreeSet;

use common::{changed, open_core, read_bytes, read_text, sandbox, set, snapshot, write_raw};
use moves_setup::*;
use tags_setup::run_confirmed;
use tegg_jobs::{JobOp, Phase};

const POZNAMKA_ITEM: &str = "  - key: poznámka\n    name: Poznámka\n    type: text\n";
const ISBN_ITEM: &str = "  - key: isbn\n    name: ISBN\n    type: text\n";
const PREVIEW_K: &str = "preview: [autor, stav]\n";

fn remove(key: &str) -> JobOp {
    JobOp::ValueRemove { r#type: "kniha".into(), key: key.into() }
}
/// kniha.yml with `line` right after its preview line (the runtime variant of AC-26 (a)).
fn kniha_with(line: &str) -> String {
    fx_swap(KNIHA_YML, &[(PREVIEW_K, &format!("{PREVIEW_K}{line}"))])
}
fn without(text: &str, part: &str) -> String {
    assert_eq!(text.matches(part).count(), 1, "setup: {part:?} must occur once");
    text.replacen(part, "", 1)
}

#[test]
fn fr_typ_09_ac26_the_delete_property_job_removes_the_key_from_columns_in_the_same_change() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let runtime = kniha_with("columns: [autor, poznámka, modified, pozna\u{301}mka]\n");
    write_raw(&root, KNIHA_YML, runtime.as_bytes());
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    let (job, report) = ok!(run_confirmed(&core, remove("poznámka")), "value-remove kniha.poznámka");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let want = without(&kniha_with("columns: [autor, modified]\n"), POZNAMKA_ITEM);
    assert_eq!(read_text(&root, KNIHA_YML), Some(want), "kniha.yml ends with `columns: [autor, modified]`: every poznámka entry (also the NFD one) goes with the item");
    let files: BTreeSet<String> = changed(&before, &snapshot(&root)).into_iter().filter(|p| !p.ends_with('/')).collect();
    assert_eq!(files, set(&[DUNA, KNIHA_YML]), "still only Duna and kniha.yml are written");
    let (_, u) = ok!(common::run_job(&core, JobOp::Undo { job }), "Undo");
    assert_eq!(u.phase, Phase::Done, "{u:?}");
    assert_eq!(read_bytes(&root, KNIHA_YML), Some(runtime.into_bytes()), "Undo (FR-TYP-04 AC-8) restores kniha.yml's exact bytes, the columns line included");
}

#[test]
fn fr_typ_09_ac26_the_no_value_path_removes_every_columns_entry_in_its_single_write() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    write_raw(&root, KNIHA_YML, kniha_with("columns: [isbn, autor, isbn, modified]\n").as_bytes());
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    let (_, report) = ok!(run_confirmed(&core, remove("isbn")), "value-remove kniha.isbn (no values)");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let want = without(&kniha_with("columns: [autor, modified]\n"), ISBN_ITEM);
    assert_eq!(read_text(&root, KNIHA_YML), Some(want), "the single write of kniha.yml removes the item and both isbn entries");
    let files: BTreeSet<String> = changed(&before, &snapshot(&root)).into_iter().filter(|p| !p.ends_with('/')).collect();
    assert_eq!(files, set(&[KNIHA_YML]), "only kniha.yml is written");
}
