//! Slice PIN, the jobs' pin patch (L4): docs/acceptance/pinned.md FR-LNK-03 AC-22 (Tegg's renames and type moves patch
//! the pin's `path:` line, add `id:` when the rename wrote one, inside the job, undoable; an unreadable or newer file is
//! skipped and the job still succeeds; an unpinned object leaves the file alone), FR-HOM-02 AC-21 (a tag rename rewrites
//! only that `tag:` value, the zip includes pinned.yml; a tag delete leaves the file alone), AC-22 (jobs leave an
//! unreadable file alone). Interface docs/contracts/v1-pinned.md §1.6 (`Host::patch_pins`, `PinPatch`), ms4-jobs §4…§8.
//! Real `Core` host and `NodeTransformer` (`npm run build --prefix packages/doc`), a temporary copy of the pinned fixture.
//! Written from the ACs and the contracts only (D-61).

#[macro_use]
mod common;
mod moves_setup;
mod tags_setup;

use std::path::{Path, PathBuf};

use common::{assert_setup, copy_dir, open_core, read_text, rename, repo_root, run_job, sandbox, snapshot, write_raw, Sandbox};
use tags_setup::{run_confirmed, zip_entries, zips};
use tegg_jobs::{JobOp, Phase};

const YML: &str = ".tegg/pinned.yml";
const ROZPOCET: &str = "Projekty/Rozpočet 2027.md";
const LISABON: &str = "Projekty/Výjezd Lisabon 2026.md";
const BEZ: &str = "Pages/Bez hlavičky.md";

fn fx(name: &str) -> String {
    std::fs::read_to_string(repo_root().join("tests/fixtures/pinned-files").join(name)).expect("setup: fixture")
}
fn pinned_vault(sb: &Sandbox, pins: Option<&str>) -> PathBuf {
    let root = sb.base.join("Pinned");
    let fxv = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fxv.join("pinned"), &root, &["README.md"]);
    copy_dir(&fxv.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    if let Some(t) = pins {
        write_raw(&root, YML, t.as_bytes());
    }
    root
}
fn pins(root: &Path) -> Option<String> {
    read_text(root, YML)
}

#[test]
fn fr_lnk_03_ac22_renames_patch_pins() {
    let sb = sandbox();
    let root = pinned_vault(&sb, Some(&fx("valid.yml")));
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (job, report) = ok!(rename(&core, ROZPOCET, "Rozpočet 2028"), "rename Rozpočet");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_eq!(pins(&root), Some(fx("expected/valid-after-rename.yml")), "only line 5 changes");
    assert!(report.written.iter().any(|p| p == YML), "pinned.yml is a written row of the job: {:?}", report.written);
    let (_, u) = ok!(run_job(&core, JobOp::Undo { job }), "Undo");
    assert_eq!(u.phase, Phase::Done, "{u:?}");
    assert_eq!(pins(&root), Some(fx("valid.yml")), "Undo restores the pins file's bytes");
    let before = pins(&root);
    let (_, r2) = ok!(rename(&core, "Pages/Výplň 01.md", "Výplň 01 nová"), "rename an unpinned note");
    assert_eq!(r2.phase, Phase::Done, "{r2:?}");
    assert_eq!(pins(&root), before, "a rename of an unpinned object leaves pinned.yml untouched");
    assert!(!r2.written.iter().any(|p| p == YML), "not written");
}

/// AP-1272 (D-1415): the `id` comes from the editor's first-edit save (D-174), before the rename; the rename itself
/// never adds one (4C unchanged). The path-only pin gains `- id:` from the renamed note.
#[test]
fn fr_lnk_03_ac22_idless_rename_adds_the_id() {
    const BEZ_ID: &str = "01JB5P000000000000000000BH";
    let sb = sandbox();
    let root = pinned_vault(&sb, Some(&fx("stale.yml")));
    let body = read_text(&root, BEZ).expect("setup: Bez hlavičky");
    assert_setup(!body.starts_with("---"), "Bez hlavičky has no frontmatter");
    // The editor's first-edit save: the note gets its `id` (AP-4, D-174).
    write_raw(&root, BEZ, format!("---\nid: {BEZ_ID}\n---\n{body}").as_bytes());
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (_, report) = ok!(rename(&core, BEZ, "Bez hlavičky 2"), "rename Bez hlavičky");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let note = read_text(&root, "Pages/Bez hlavičky 2.md").unwrap_or_default();
    let id = note.lines().find_map(|l| l.strip_prefix("id: ")).map(str::to_string);
    assert_eq!(id.as_deref(), Some(BEZ_ID), "the note keeps the id its first edit saved");
    assert_eq!(pins(&root), Some(fx("expected/stale-after-rename-bez-hlavicky.yml").replace("<ID>", BEZ_ID)), "`- id:` / `path:`");
}

#[test]
fn fr_lnk_03_ac22_type_move_patches_the_path() {
    let sb = sandbox();
    let root = pinned_vault(&sb, Some(&fx("valid.yml")));
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (_, report) = ok!(run_confirmed(&core, moves_setup::type_move(&[LISABON], "page", vec![], false)), "move Lisabon to Page");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let want = fx("valid.yml").replace("    path: Projekty/Výjezd Lisabon 2026.md\n", "    path: Pages/Výjezd Lisabon 2026.md\n");
    assert_eq!(pins(&root), Some(want), "its path: line follows the move");
}

#[test]
fn fr_lnk_03_ac22_unreadable_and_newer_files_are_skipped() {
    for name in ["invalid-yaml.yml", "newer-version.yml"] {
        let sb = sandbox();
        let root = pinned_vault(&sb, Some(&fx(name)));
        let core = ok!(open_core(&root, &sb.dirs, false), "open");
        let before = snapshot(&root).get(YML).cloned();
        let (_, report) = ok!(rename(&core, ROZPOCET, "Rozpočet 2028"), "rename");
        assert_eq!(report.phase, Phase::Done, "{name}: the job still succeeds: {report:?}");
        assert_eq!(snapshot(&root).get(YML).cloned(), before, "{name}: the file is left alone (bytes, mtime, inode)");
    }
}

#[test]
fn fr_hom_02_ac21_tag_and_type_pins_follow_their_keys() {
    let sb = sandbox();
    let start = format!("{}  - tag: účty\n", fx("valid.yml"));
    let root = pinned_vault(&sb, Some(&start));
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (_, report) = ok!(run_confirmed(&core, JobOp::TagRename { from: "účty".into(), to: "finance".into() }), "rename účty → finance");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_eq!(pins(&root), Some(fx("expected/valid-after-tag-rename.yml")), "only that item's value");
    let zip = zips(&sb.dirs).into_iter().last();
    assert!(zip.as_ref().is_some_and(|z| zip_entries(z).iter().any(|(n, b)| n == YML && b == start.as_bytes())), "the job's backup zip includes pinned.yml");
    let before = snapshot(&root).get(YML).cloned();
    let (_, d) = ok!(run_confirmed(&core, JobOp::TagDelete { tag: "offsite".into(), keep_text: true }), "delete offsite");
    assert_eq!(d.phase, Phase::Done, "{d:?}");
    assert_eq!(snapshot(&root).get(YML).cloned(), before, "a tag delete leaves the pins file untouched");
}

#[test]
fn fr_hom_02_ac22_unreadable_pins_file_is_never_rewritten() {
    let sb = sandbox();
    let start = fx("invalid-yaml.yml");
    let root = pinned_vault(&sb, Some(&start));
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root).get(YML).cloned();
    let (_, report) = ok!(run_confirmed(&core, JobOp::TagRename { from: "offsite".into(), to: "výjezd".into() }), "tag rename");
    assert_eq!(report.phase, Phase::Done, "the job still succeeds: {report:?}");
    assert_eq!(snapshot(&root).get(YML).cloned(), before, "the unreadable file keeps its bytes, mtime and inode");
    assert!(!report.written.iter().any(|p| p == YML), "not a written row");
}
