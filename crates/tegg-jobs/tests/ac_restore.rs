//! MS4 slice 4D-lite AC tests of backups and restore (L4): docs/acceptance/tags.md FR-HIS-04 AC-7 (the zips' manifest,
//! label and rotation, as `backups_list` reads them), AC-8 (restore gives every file its zipped bytes and reverses the
//! job's renames and trash moves; the pre-restore zip first; a failed pre-restore zip restores nothing), AC-9 (newer
//! work is never lost silently), AC-10 (restore is a job: cancel before writing, external changes skipped), on a
//! temporary copy of the tags fixture with the real `@tegg/doc` engine. Interface: docs/contracts/ms4-tags.md §5.1
//! (manifest), §5.3 (restore steps), ms4-jobs §6 (backups). The restore op is `JobOp::Restore { name }` (the contract
//! names only the IPC command `backup_restore(name)`; red-test point AP-671). Written from the ACs and the contracts
//! only (D-61).

#[macro_use]
mod common;
mod tags_setup;

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use common::{open_core, read_bytes, read_text, sandbox, snapshot};
use tags_setup::*;
use tegg_format::nfc;
use tegg_jobs::{JobKind, JobOp, JobPoint, Phase, SkipReason};

fn rename_op(from: &str, to: &str) -> JobOp {
    JobOp::TagRename { from: from.into(), to: to.into() }
}
fn restore_op(zip: &PathBuf) -> JobOp {
    JobOp::Restore { name: zip_name(zip) }
}
/// Bytes of every vault file except `.trash/` and directories.
fn vault_bytes(root: &std::path::Path) -> BTreeMap<String, Vec<u8>> {
    snapshot(root).into_iter().filter(|(k, _)| !k.ends_with('/')).map(|(k, e)| (k, e.bytes)).collect()
}

// ------------------------------------------------------------------------------------------------ FR-HIS-04 AC-7

#[test]
fn fr_his_04_ac7_each_zip_has_its_manifest_first() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (j1, r1) = ok!(run_confirmed(&core, rename_op("účty", "Výdaje")), "rename účty → Výdaje");
    std::thread::sleep(Duration::from_millis(1100)); // the zip names hold the UTC second
    let (j2, r2) = ok!(run_confirmed(&core, JobOp::TagDelete { tag: "finance".into(), keep_text: false }), "remove finance");
    assert_eq!((r1.phase, r2.phase), (Phase::Done, Phase::Done), "{r1:?} {r2:?}");
    let z = zips(&sb.dirs);
    assert_eq!(z.len(), 2, "two zips: {z:?}");
    let m1 = some!(manifest(&z[0]), "the first entry of the rename's zip is tegg-backup.json");
    let m2 = some!(manifest(&z[1]), "the first entry of the removal's zip is tegg-backup.json");
    assert_eq!((m1["version"].as_u64(), m1["kind"].as_str(), m1["job"].as_u64()), (Some(1), Some("tag-rename"), Some(j1)), "version, kind, job");
    assert_eq!(m1["label"], serde_json::json!({ "key": "backups.label.tagRename", "args": { "from": "Účty", "to": "Výdaje" } }), "label `Rename #Účty to #Výdaje` (AP-663)");
    assert_eq!(m1["vault"].as_str(), Some("Štítky"), "the vault name");
    assert!(m1["time"].as_str().is_some_and(|t| t.ends_with('Z') && t.starts_with("20")), "time, UTC: {}", m1["time"]);
    assert_eq!(m1["planned"]["renames"], serde_json::json!([[F_UCTY, "Tags/Výdaje.md"]]), "planned renames");
    let written = read_bytes(&root, "Tags/Výdaje.md").unwrap_or_default();
    assert_eq!(m1["done"]["renames"], serde_json::json!([[F_UCTY, "Tags/Výdaje.md", sha256_hex(&written)]]), "done: the rename with the hash of the bytes written");
    let done_written: BTreeSet<String> = m1["done"]["written"].as_array().map(|a| a.iter().filter_map(|x| x[0].as_str().map(str::to_string)).collect()).unwrap_or_default();
    assert!(done_written.contains(ROZPOCET) && done_written.contains(DEN), "done.written lists the rewritten files: {done_written:?}");
    assert_eq!((m2["kind"].as_str(), m2["job"].as_u64()), (Some("tag-delete"), Some(j2)), "the removal");
    assert_eq!(m2["label"], serde_json::json!({ "key": "backups.label.tagDelete", "args": { "tag": "finance", "count": 2 } }), "label `Remove #finance from 2 objects`");
}

#[test]
fn fr_his_04_ac7_the_eleventh_zip_removes_the_oldest() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (_, r) = ok!(run_confirmed(&core, rename_op("čtení", "četba")), "a first job");
    assert_eq!(r.phase, Phase::Done, "{r:?}");
    let dir = some!(zips(&sb.dirs).first().and_then(|p| p.parent().map(|d| d.to_path_buf())), "the vault's backup folder");
    for i in 1..=9 {
        std::fs::write(dir.join(format!("20200101-0000{i:02}-tag-rename.zip")), b"PK\x05\x06\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0").expect("setup: old zip");
    }
    assert_eq!(zips(&sb.dirs).len(), 10, "setup: 10 zips");
    let (_, r2) = ok!(run_confirmed(&core, rename_op("četba", "čtení")), "the 11th");
    assert_eq!(r2.phase, Phase::Done, "{r2:?}");
    let names: Vec<String> = zips(&sb.dirs).iter().map(|p| zip_name(p)).collect();
    assert_eq!(names.len(), 10, "ten kept: {names:?}");
    assert!(!names.contains(&"20200101-000001-tag-rename.zip".to_string()), "the oldest is removed from the disk");
}

// ------------------------------------------------------------------------------------------------ FR-HIS-04 AC-8

#[test]
fn fr_his_04_ac8_restore_the_rename() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let original = vault_bytes(&root);
    let (_, r) = ok!(run_confirmed(&core, rename_op("účty", "Výdaje")), "rename");
    assert_eq!(r.phase, Phase::Done, "{r:?}");
    let zip = some!(zips(&sb.dirs).into_iter().next(), "the rename's zip");
    let before_restore = vault_bytes(&root);
    let (_, rr) = ok!(run_confirmed(&core, restore_op(&zip)), "restore");
    assert_eq!((rr.phase, rr.kind), (Phase::Done, JobKind::Restore), "{rr:?}");
    let all = zips(&sb.dirs);
    let pre = all.iter().find(|z| zip_name(z).ends_with("-restore.zip"));
    let pre = some!(pre, "a zip of the current state first (`Before restoring …`)");
    let m = some!(manifest(pre), "its manifest");
    assert_eq!(m["label"]["key"].as_str(), Some("backups.label.restore"), "label key");
    assert_eq!(m["label"]["args"]["time"].as_str(), manifest(&zip).and_then(|x| x["time"].as_str().map(str::to_string)).as_deref(), "with the restored zip's time");
    let pre_md: BTreeMap<String, Vec<u8>> = zip_entries(pre).into_iter().filter(|(n, _)| n != "tegg-backup.json").collect();
    assert_eq!(pre_md.get("Tags/Výdaje.md"), before_restore.get("Tags/Výdaje.md"), "the pre-restore zip holds the state before the restore");
    assert_eq!(vault_bytes(&root), original, "every file has its pre-job bytes; Tags/Výdaje.md is renamed back to Tags/Účty.md (AP-664)");
    let rows = core.tag_rows();
    let u = rows.iter().find(|r| r.key == "účty");
    assert_eq!(u.map(|r| (r.count, r.color.clone())), Some((6, Some("blue".into()))), "the tag query equals R80 again (účty blue, 6)");
    assert!(rows.iter().all(|r| r.key != "výdaje"), "no výdaje");
}

#[test]
fn fr_his_04_ac8_failed_pre_restore_zip_restores_nothing() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (_, r) = ok!(run_confirmed(&core, rename_op("účty", "Výdaje")), "rename");
    assert_eq!(r.phase, Phase::Done, "{r:?}");
    let zip = some!(zips(&sb.dirs).into_iter().next(), "the zip");
    let before = vault_bytes(&root);
    read_only_backups(&sb.dirs);
    let res = run_confirmed(&core, restore_op(&zip));
    writable_again(&sb.dirs);
    let (_, rr) = ok!(res, "restore");
    assert_eq!(rr.phase, Phase::Failed, "BackupFailed: {rr:?}");
    assert_eq!(vault_bytes(&root), before, "nothing restored");
}

// ------------------------------------------------------------------------------------------------ FR-HIS-04 AC-9

#[test]
fn fr_his_04_ac9_restore_never_loses_newer_work() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (_, r) = ok!(run_confirmed(&core, rename_op("účty", "Výdaje")), "rename");
    assert_eq!(r.phase, Phase::Done, "{r:?}");
    let zip = some!(zips(&sb.dirs).into_iter().next(), "the zip");
    std::thread::sleep(Duration::from_millis(1100));
    let nova = "---\nid: 01JB4DNEW00000000000000009\ntype: page\ntitle: Nová\n---\nNová práce.\n";
    write_new(&root, "Pages/Nová.md", nova);
    let newer = format!("{}Novější řádek.\n", read_text(&root, ROZPOCET).unwrap_or_default());
    write_new(&root, ROZPOCET, &newer);
    core.notify_changed(&["Pages/Nová.md".into(), ROZPOCET.into()]);
    assert!(core.wait_idle(Duration::from_secs(10)), "setup: idle");
    let (_, rr) = ok!(run_confirmed(&core, restore_op(&zip)), "restore");
    assert_eq!(rr.phase, Phase::Done, "{rr:?}");
    assert_eq!(read_text(&root, "Pages/Nová.md"), Some(nova.to_string()), "a note created after the backup is untouched (AP-664)");
    assert_eq!(read_text(&root, ROZPOCET), Some(tx(ROZPOCET)), "a note changed after the backup gets the zipped bytes");
    let pre = some!(zips(&sb.dirs).into_iter().find(|z| zip_name(z).ends_with("-restore.zip")), "the pre-restore zip");
    let held = zip_entries(&pre).into_iter().find(|(n, _)| n == ROZPOCET).map(|(_, b)| sha256_hex(&b));
    assert_eq!(held, Some(sha256_hex(newer.as_bytes())), "its newer version is in the pre-restore zip (sha256 match)");
    std::thread::sleep(Duration::from_millis(1100));
    let (_, back) = ok!(run_confirmed(&core, restore_op(&pre)), "restore the pre-restore zip");
    assert_eq!(back.phase, Phase::Done, "{back:?}");
    assert_eq!(read_text(&root, ROZPOCET), Some(newer), "the newer version comes back");
}
fn write_new(root: &std::path::Path, rel: &str, text: &str) {
    let p = root.join(rel);
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).expect("setup: dir");
    }
    std::fs::write(p, text).expect("setup: write");
}

// ------------------------------------------------------------------------------------------------ FR-HIS-04 AC-10

#[test]
fn fr_his_04_ac10_restore_is_a_cancellable_job_that_skips_external_changes() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (_, r) = ok!(run_confirmed(&core, rename_op("účty", "Výdaje")), "rename");
    assert_eq!(r.phase, Phase::Done, "{r:?}");
    let zip = some!(zips(&sb.dirs).into_iter().next(), "the zip");
    // Cancel before writing (blocked at AfterPlanning).
    let (tx_, rx_) = std::sync::mpsc::channel::<()>();
    let gate = Arc::new(Mutex::new(Some(rx_)));
    let g = gate.clone();
    core.jobs().set_point_hook(Some(Arc::new(move |_, p: &JobPoint| {
        if matches!(p, JobPoint::AfterPlanning) {
            if let Some(rx) = g.lock().unwrap_or_else(|e| e.into_inner()).take() {
                let _ = rx.recv_timeout(Duration::from_secs(5));
            }
        }
    })));
    let before = vault_bytes(&root);
    let job = ok!(core.jobs().start(restore_op(&zip)), "backup_restore returns a job");
    std::thread::sleep(Duration::from_millis(200));
    ok!(core.jobs().cancel(job), "cancel before writing");
    let _ = tx_.send(());
    let rep = some!(core.jobs().wait(job, Duration::from_secs(5)), "report");
    assert_eq!(rep.phase, Phase::Cancelled, "cancelled");
    assert_eq!(vault_bytes(&root), before, "byte-identical");
    // An external change during writing is skipped and listed.
    let (r2, once) = (root.clone(), Arc::new(Mutex::new(false)));
    let external = format!("{}Cizí změna.\n", read_text(&root, ROZPOCET).unwrap_or_default());
    let e2 = external.clone();
    core.jobs().set_point_hook(Some(Arc::new(move |_, p: &JobPoint| {
        if let JobPoint::AfterRead { path } = p {
            let mut o = once.lock().unwrap_or_else(|x| x.into_inner());
            if nfc(path) == ROZPOCET && !*o {
                *o = true;
                std::fs::write(r2.join(ROZPOCET), &e2).expect("sync simulator: write");
            }
        }
    })));
    let (_, rr) = ok!(run_confirmed(&core, restore_op(&zip)), "restore");
    assert_eq!(rr.phase, Phase::Done, "{rr:?}");
    assert!(rr.skipped.iter().any(|s| nfc(&s.path) == ROZPOCET && s.reason == SkipReason::Changed), "Rozpočet skipped `changed`: {rr:?}");
    assert_eq!(read_text(&root, ROZPOCET), Some(external), "the external version stays");
    assert_eq!(read_text(&root, DEN), Some(tx(DEN)), "the other files are restored");
}
