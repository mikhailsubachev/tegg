//! Slice MM, L4: FR-LNK-03 AC-21 (docs/acceptance/mindmap.md; D-682; rename.md, contract docs/contracts/ms4-jobs.md):
//! renaming Lisabon to `Lisabon 2027` with the `note-rename` job on a temporary copy of the mindmap fixture renames the
//! file, sets `title: Lisabon 2027` and changes exactly Výjezd's body line 9 and Uzly's line (plus `modified`, rename.md
//! AC-7); Stará mapa (`.trash/`) and every other file are untouched; undo restores every written file's bytes.
//! No extractor or job change is expected for mindmaps (the links inside the callout are ordinary list-item links).
//! Written from the AC and the contract only (D-61).

#[macro_use]
mod common;

use std::collections::BTreeSet;
use std::path::PathBuf;

use common::*;
use tegg_jobs::{JobOp, Phase};

const LISABON: &str = "Pages/Lisabon.md";
const LISABON_2027: &str = "Pages/Lisabon 2027.md";
const VYJEZD: &str = "Pages/Výjezd 2026.md";
const UZLY: &str = "Pages/Uzly.md";
const STARA: &str = ".trash/Pages/Stará mapa.md";

fn mindmap_vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Mapy");
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fx.join("mindmap"), &root, &["README.md"]);
    copy_dir(&fx.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    root
}
fn fx(rel: &str) -> String {
    String::from_utf8(std::fs::read(repo_root().join("tests/fixtures/vaults/mindmap").join(rel)).expect("setup: fixture")).expect("setup: UTF-8")
}
fn body_lines(t: &str) -> Vec<String> {
    let body = t.splitn(3, "\n---\n").nth(1).unwrap_or("");
    body.split('\n').map(|s| s.to_string()).collect()
}

#[test]
fn fr_lnk_03_ac21_rename_rewrites_links_inside_the_callout() {
    let sb = sandbox();
    let root = mindmap_vault(&sb);
    let before = snapshot(&root);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (job, report) = ok!(rename(&core, LISABON, "Lisabon 2027"), "rename Lisabon → Lisabon 2027");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_eq!(report.renamed, Some((LISABON.to_string(), LISABON_2027.to_string())), "the file is renamed");
    let l = read_text(&root, LISABON_2027).unwrap_or_default();
    assert!(l.contains("title: Lisabon 2027\n"), "title: Lisabon 2027");
    let v = read_text(&root, VYJEZD).unwrap_or_default();
    let v0 = fx(VYJEZD);
    let (bv, bv0) = (body_lines(&v), body_lines(&v0));
    let diff: Vec<usize> = (0..bv.len().max(bv0.len())).filter(|&i| bv.get(i) != bv0.get(i)).map(|i| i + 1).collect();
    assert_eq!(diff, vec![9], "Výjezd: only body line 9 changes");
    assert_eq!(bv.get(8).map(|s| s.as_str()), Some(">     - [[Lisabon 2027]]"), "Výjezd line 9");
    assert_eq!(no_modified(&v), no_modified(&v0.replace(">     - [[Lisabon]]\n", ">     - [[Lisabon 2027]]\n")), "Výjezd: nothing else but modified");
    let u = read_text(&root, UZLY).unwrap_or_default();
    assert_eq!(no_modified(&u), no_modified(&fx(UZLY).replace(">   - Odkaz na [[Lisabon]] a #cestování\n", ">   - Odkaz na [[Lisabon 2027]] a #cestování\n")), "Uzly: only that line (and modified)");
    let after = snapshot(&root);
    let want: BTreeSet<String> = [LISABON, LISABON_2027, VYJEZD, UZLY].iter().map(|s| s.to_string()).collect();
    assert_eq!(changed(&before, &after), want, "Stará mapa and every other file untouched");
    assert_eq!(read_text(&root, STARA), Some(fx(STARA)), "Stará mapa keeps [[Lisabon]] (D-102)");
    let (_, undo) = ok!(run_job(&core, JobOp::Undo { job }), "undo");
    assert_eq!(undo.phase, Phase::Done, "{undo:?}");
    for rel in [LISABON, VYJEZD, UZLY] {
        assert_eq!(read_bytes(&root, rel), Some(before[rel].bytes.clone()), "undo restores {rel}'s bytes");
    }
    assert!(!root.join(LISABON_2027).exists(), "undo removes the new name");
}
