//! Regression test for slice G3's real-app run (L6): a change to `.tegg/graph.yml` by another program (sync, an
//! editor) never reached the app, so an open graph's presets didn't follow an external edit, an atomic replace or a
//! delete until the graph was reopened (FR-GRP-02 AC-19, AC-23; FR-SYN-03 AC-23). The watcher reported type files,
//! the pins file and query files only. The presets file's changes are reported as `VaultChanged` with its path
//! (v1-graph §16.1 Watcher, §16.9 point 3: presets are re-read on `vault:changed` of `.tegg/graph.yml`).

mod common;
mod graph_presets_setup;
mod graph_setup;

use std::path::PathBuf;
use std::sync::mpsc::Receiver;
use std::time::Duration;

use common::*;
use graph_presets_setup::*;
use tegg_core::{Core, CoreEvent, CoreOptions};

fn changed(rx: &Receiver<CoreEvent>, seen: &mut Vec<String>) {
    while let Ok(ev) = rx.try_recv() {
        if let CoreEvent::VaultChanged { paths } = ev {
            seen.extend(paths);
        }
    }
}

/// Opens the `valid.yml` vault with the real watcher, runs `external` and expects `.tegg/graph.yml` reported in 2 s.
fn reported_after(what: &str, external: impl FnOnce(&PathBuf)) {
    let sb = sandbox();
    let root = vault_fx(&sb, "valid.yml");
    let core = match Core::open(&root, &sb.dirs, CoreOptions { watch: true, sync: None }) {
        Ok(c) => c,
        Err(e) => panic!("setup: Core::open: {e:?}"),
    };
    assert!(core.wait_idle(Duration::from_secs(60)), "indexing did not become idle within 60 s");
    let rx = core.events();
    std::thread::sleep(Duration::from_millis(300));
    external(&root);
    let mut seen = Vec::new();
    let hit = wait_until(Duration::from_secs(2), || {
        changed(&rx, &mut seen);
        seen.iter().any(|p| p == YML)
    });
    assert!(hit.is_some(), "{what}: VaultChanged with {YML} within 2 s (got {seen:?})");
}

#[test]
fn bug_l6_fr_grp_02_ac23_an_external_graph_yml_edit_is_reported_within_2_s() {
    reported_after("in-place write", |root| {
        std::fs::write(root.join(YML), fx("expected/valid-after-update.yml")).expect("external write");
    });
}

#[test]
fn bug_l6_fr_syn_03_ac23_an_atomic_replace_of_graph_yml_is_reported_within_2_s() {
    reported_after("atomic replace", |root| replace_atomically(root, YML, &fx("expected/valid-after-update.yml")));
}

#[test]
fn bug_l6_fr_grp_02_ac19_an_external_delete_of_graph_yml_is_reported_within_2_s() {
    reported_after("delete", |root| std::fs::remove_file(root.join(YML)).expect("external delete"));
}
