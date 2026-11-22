//! Slice OC, the 4E delete-property job's part (L4): docs/acceptance/cards.md FR-TYP-11 AC-28: deleting the property
//! `kraj` from Výlet by type-moves.md FR-TYP-04 AC-7's job (a Výlet with values) removes every `kraj` entry from `card:`
//! in the same type-file change that removes the item and its keys from `preview`, `hidden` and `columns`; the job's
//! Undo restores `výlet.yml`'s exact bytes, the `card:` line included. BRD D-807, D-1240, D-1965. Interface
//! docs/contracts/v1-cards.md §2.3 (`RemoveAttribute` also removes `card` entries; the 4E job's type-file change uses the
//! same op). Written from the ACs and the contract only (D-61). On a temporary copy of the views fixture, new-empty's
//! `.tegg/` and the cards/ overlay, with the real `@tegg/doc` transformer (`npm run build --prefix packages/doc`).

#[macro_use]
mod common;
mod tags_setup;

use common::{changed, copy_dir, open_core, read_bytes, read_text, repo_root, sandbox, snapshot, write_raw};
use tags_setup::run_confirmed;
use tegg_jobs::{JobOp, Phase};

const VYLET: &str = ".tegg/types/výlet.yml";
const CARD: &str = "card: [tags, description, stav, náročnost, kraj, vybavení, délka, termín, odkaz, průvodce, neznámý-klíč, modified]\n";

#[test]
fn fr_typ_11_ac28_the_delete_property_job_removes_card_entries() {
    let sb = sandbox();
    let root = sb.base.join("Výlety a knihy");
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fx.join("views"), &root, &["README.md"]);
    copy_dir(&fx.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    copy_dir(&fx.join("cards"), &root, &["README.md", "expected-card-data.json"]);
    let orig = read_text(&root, VYLET).unwrap_or_default();
    assert!(orig.contains(CARD), "setup: výlet.yml holds line 12");
    let runtime = orig.replacen("preview: [stav, kraj]\n", "preview: [stav, kraj]\nhidden: [kraj]\ncolumns: [kraj, stav]\n", 1).replacen(CARD, "card: [tags, kraj, stav, kraj, modified]\n", 1);
    write_raw(&root, VYLET, runtime.as_bytes());
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    let (job, report) = ok!(run_confirmed(&core, JobOp::ValueRemove { r#type: "výlet".into(), key: "kraj".into() }), "value-remove výlet.kraj");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let item = "  - key: kraj\n    name: Kraj\n    type: text\n    icon: map-pin\n";
    let want = runtime
        .replacen("preview: [stav, kraj]\nhidden: [kraj]\ncolumns: [kraj, stav]\n", "preview: [stav]\nhidden: []\ncolumns: [stav]\n", 1)
        .replacen("card: [tags, kraj, stav, kraj, modified]\n", "card: [tags, stav, modified]\n", 1)
        .replacen(item, "", 1);
    assert_eq!(read_text(&root, VYLET), Some(want), "every kraj entry leaves card: in the same change that removes the item and its preview, hidden and columns keys");
    let files: Vec<String> = changed(&before, &snapshot(&root)).into_iter().filter(|p| !p.ends_with('/')).collect();
    assert_eq!(files, vec![VYLET.to_string(), "Výlety/Okolo Máchova jezera.md".to_string(), "Výlety/Pálava na kole.md".to_string(), "Výlety/Sněžka z Pece.md".to_string()], "výlet.yml and the three objects with a kraj value (`—` is a value for the job, D-814; it is empty only on a card, D-1974), in changed()'s sorted order");
    let (_, u) = ok!(common::run_job(&core, JobOp::Undo { job }), "Undo");
    assert_eq!(u.phase, Phase::Done, "{u:?}");
    assert_eq!(read_bytes(&root, VYLET), Some(runtime.into_bytes()), "Undo restores výlet.yml's exact bytes, the card line included");
}
