//! Slice Q, L4: docs/acceptance/queries.md FR-QRY-06 AC-22 (D-1510): until the index has finished its first scan after
//! the vault opens, a query rename is refused with `IndexNotReady` and writes nothing (no file, note or pins change, no
//! job, no backup); after the first scan ends, the same rename runs as AC-6. Interface docs/contracts/v1-queries.md §1.8
//! (`JobOp::QueryRename`, refusals before the job) and §11 (`QueryError::IndexNotReady` while `index_ready` is false).
//! The first index build is held "running" with graph_setup's `GatedFs` (note reads wait for its gate). The refusal is
//! matched on its Debug text so a missing variant fails by assertion, not by compilation (TS-I1). Written from the AC
//! and the contract only (D-61).

mod common;
mod graph_setup;
mod queries_setup;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use std::sync::Arc;
use std::time::Duration;

use common::{repo_root, sandbox, snapshot, Entry};
use graph_setup::GatedFs;
use queries_setup::{expected, qpath, vault, OTEVRENE, P14, P7, SABLONA};
use tegg_core::{AppDirs, Core, CoreOptions};
use tegg_jobs::{JobOp, Phase};

const PINS: &str = ".tegg/pinned.yml";
const NEW_NAME: &str = "Otevřené úkoly porady";

fn pins_file(items: &[&str]) -> String {
    let mut s = String::from("# Tegg sidebar pins (FR-HOM-02). Pin, unpin and reorder them in the sidebar.\nversion: 1\npins:\n");
    for i in items {
        s.push_str(&format!("  - {i}\n"));
    }
    s
}
fn rename_op() -> JobOp {
    JobOp::QueryRename { name: OTEVRENE.into(), title: NEW_NAME.into() }
}
/// Every vault file whose bytes, mtime or inode changed (folders excluded), NFC.
fn files_changed(a: &BTreeMap<String, Entry>, b: &BTreeMap<String, Entry>) -> BTreeSet<String> {
    let keys: BTreeSet<&String> = a.keys().chain(b.keys()).collect();
    keys.into_iter().filter(|k| !k.ends_with('/') && a.get(*k) != b.get(*k)).map(|k| tegg_format::nfc(k)).collect()
}
/// Backup zips under Application Support (FR-HIS-04).
fn zips(dirs: &AppDirs) -> Vec<PathBuf> {
    fn walk(d: &Path, out: &mut Vec<PathBuf>) {
        let Ok(rd) = std::fs::read_dir(d) else { return };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(&p, out);
            } else if p.extension().is_some_and(|x| x == "zip") {
                out.push(p);
            }
        }
    }
    let mut out = Vec::new();
    walk(&dirs.root, &mut out);
    out.sort();
    out
}
fn read_text(root: &Path, rel: &str) -> Option<String> {
    std::fs::read(root.join(rel)).ok().map(|b| String::from_utf8_lossy(&b).into_owned())
}
fn fx(rel: &str) -> String {
    String::from_utf8(std::fs::read(repo_root().join("tests/fixtures/vaults/queries").join(rel)).expect("setup: fixture")).expect("setup: UTF-8")
}

#[test]
fn fr_qry_06_ac22_no_rename_while_the_index_loads() {
    let sb = sandbox();
    let root = vault(&sb);
    let pins = pins_file(&[&format!("query: {OTEVRENE}"), "type: projekt"]);
    common::write_raw(&root, PINS, pins.as_bytes());
    let fs = GatedFs::new(&root);
    let core = match Core::open_with(fs.clone(), &sb.dirs, CoreOptions { watch: false, sync: None }) {
        Ok(c) => c,
        Err(e) => panic!("setup: Core::open_with: {e:?}"),
    };
    match tegg_jobs::testing::NodeTransformer::from_repo(&repo_root()) {
        Ok(t) => core.jobs().set_transformer(Arc::new(t)),
        Err(e) => panic!("setup: NodeTransformer (npm run build --prefix packages/doc): {e}"),
    }
    let before = snapshot(&root);
    let zips_before = zips(&sb.dirs);

    // The first index build is held: the rename is asked now. It runs on its own thread, so a core that waits for the
    // index instead of refusing still lets the gate open (after 5 s) and the test end by assertion.
    let early = std::thread::scope(|s| {
        let (tx, rx) = channel();
        let core = &core;
        let h = s.spawn(move || {
            let r = core.jobs().start(rename_op());
            let _ = tx.send(());
            r
        });
        let answered_in_time = rx.recv_timeout(Duration::from_secs(5)).is_ok();
        fs.open();
        (h.join().map_err(|_| "the start thread panicked".to_string()), answered_in_time)
    });
    let (early, answered_in_time) = early;
    let early = match early {
        Ok(r) => r,
        Err(e) => panic!("setup: {e}"),
    };
    // Let whatever was started finish before looking at the vault.
    if let Ok(job) = &early {
        let _ = core.jobs().wait(*job, Duration::from_secs(60));
    }
    let idle = core.wait_idle(Duration::from_secs(120));

    let refused = match &early {
        Err(e) => format!("{e:?}"),
        Ok(job) => format!("started job {job:?}"),
    };
    assert!(
        refused.contains("IndexNotReady"),
        "refused before the job with IndexNotReady while the first scan runs: {refused} (answered within 5 s: {answered_in_time})"
    );
    assert_eq!(files_changed(&before, &snapshot(&root)), BTreeSet::new(), "every vault byte, mtime and inode unchanged");
    assert_eq!(zips(&sb.dirs), zips_before, "no backup");

    // The first scan ends: the same rename runs as AC-6.
    assert!(idle, "setup: the first index build finished");
    let job = match core.jobs().start(rename_op()) {
        Ok(j) => j,
        Err(e) => {
            assert!(false, "after the first scan the rename starts: {e:?}");
            unreachable!()
        }
    };
    let report = core.jobs().wait(job, Duration::from_secs(60));
    assert!(report.as_ref().is_some_and(|r| r.phase == Phase::Done), "the rename job ends done: {report:?}");
    assert_eq!(read_text(&root, &qpath(NEW_NAME)), Some(expected("expected/renamed-otevrene-ukoly-porady.yml")), "renamed, only the title: line");
    assert_eq!(read_text(&root, &qpath(OTEVRENE)), None, "the old file is gone");
    for n in [P7, P14, SABLONA] {
        let want = fx(n).replacen(&format!("saved: {OTEVRENE}\n"), &format!("saved: {NEW_NAME}\n"), 1);
        assert_eq!(read_text(&root, n), Some(want), "{n}: only its saved: line");
    }
    assert_eq!(read_text(&root, PINS), Some(pins_file(&[&format!("query: {NEW_NAME}"), "type: projekt"])), "the pin's query: line");
    assert_eq!(zips(&sb.dirs).len(), zips_before.len() + 1, "the job's backup (FR-HIS-04)");
}
