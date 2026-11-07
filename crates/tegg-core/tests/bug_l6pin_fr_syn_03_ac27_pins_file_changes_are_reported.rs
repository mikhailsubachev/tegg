//! Regression test for slice PIN's real-app run (L6): a change to `.tegg/pinned.yml` by another program never reached
//! the app, so the section didn't follow an external edit, an atomic replace or a fix of an unreadable file within 2 s
//! (FR-SYN-03 AC-27, FR-HOM-02 AC-22). The watcher reported `.tegg/types/` changes only. The pins file's changes are
//! reported as `VaultChanged` with its path (v1-pinned §1.5, §2 Events).

mod common;
mod pinned_setup;

use std::sync::mpsc::Receiver;
use std::time::Duration;

use common::*;
use pinned_setup::*;
use tegg_core::{Core, CoreEvent, CoreOptions};

fn changed(rx: &Receiver<CoreEvent>, seen: &mut Vec<String>) {
    while let Ok(ev) = rx.try_recv() {
        if let CoreEvent::VaultChanged { paths } = ev {
            seen.extend(paths);
        }
    }
}

#[test]
fn bug_l6pin_fr_syn_03_ac27_an_external_pins_file_change_is_reported_within_2_s() {
    let sb = sandbox();
    let root = vault_fx(&sb, "valid.yml");
    let core = match Core::open(&root, &sb.dirs, CoreOptions { watch: true, sync: None }) {
        Ok(c) => c,
        Err(e) => panic!("setup: Core::open: {e:?}"),
    };
    assert!(core.wait_idle(Duration::from_secs(60)), "indexing did not become idle within 60 s");
    let rx = core.events();
    std::thread::sleep(Duration::from_millis(300));
    std::fs::write(root.join(".tegg/pinned.yml"), fxs("expected/valid-after-move.yml")).expect("external write");
    let mut seen = Vec::new();
    let hit = wait_until(Duration::from_secs(2), || {
        changed(&rx, &mut seen);
        seen.iter().any(|p| p == ".tegg/pinned.yml")
    });
    assert!(hit.is_some(), "VaultChanged with .tegg/pinned.yml within 2 s (got {seen:?})");
}
