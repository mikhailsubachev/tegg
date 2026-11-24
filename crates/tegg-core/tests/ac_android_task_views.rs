//! Slice AND-2, L4 (Mac host, temporary copy): docs/acceptance/android-phone.md FR-SYN-06 AC-52 "No task-views
//! migration on Android" (AP-2044 → D-2408; T1), through docs/contracts/android-phone.md §3 (CP-5 → D-2433):
//! `Core::task_views_migrate` answers `TaskViewsMigration::Off` before reading anything when the core was opened with
//! `OpenExtras { bulk_jobs: false }` (the Android shell's extras); the desktop's default extras keep R202's behaviour.
//!
//! On a copy of the views-tasks base fixture (tests/fixtures/vaults/tasks + new-empty/.tegg; `task.yml` without
//! `views`, the migration's input): `open_ext` with `bulk_jobs: false` → `Off`, no `Schedule.yml` / `Kanban.yml`, and
//! every vault file keeps its bytes, mtime and inode. Positive control: `Core::open` (the desktop's extras) on another
//! copy → `Done` with both files. The device half is app/e2e-android/android_phone_sync.ac.test.ts.
//! Written from the ACs and the contract only (D-61).

mod common;
mod views_setup;
mod views_tasks_setup;

use std::time::Duration;

use common::{sandbox, snapshot};
use tegg_core::taskviews::TaskViewsMigration;
use tegg_core::{Core, CoreOptions, OpenExtras};
use views_tasks_setup::{base_vault, KANBAN, NOW, SCHEDULE, TASK_YML};

fn outcome(m: &TaskViewsMigration) -> &'static str {
    match m {
        TaskViewsMigration::NotNeeded => "NotNeeded",
        TaskViewsMigration::Skipped => "Skipped",
        TaskViewsMigration::Done { .. } => "Done",
        TaskViewsMigration::Stopped { .. } => "Stopped",
        TaskViewsMigration::Off => "Off",
    }
}

#[test]
fn fr_syn_06_ac52_no_task_views_migration_on_android() {
    let sb = sandbox();
    let root = base_vault(&sb);
    let task = std::fs::read(root.join(TASK_YML)).expect("setup: task.yml");
    assert!(!String::from_utf8_lossy(&task).contains("views:"), "setup: the base fixture's task.yml has no views key (R202's input)");
    let before = snapshot(&root);
    let core = match Core::open_ext(&root, &sb.dirs, CoreOptions { watch: false, sync: None }, OpenExtras { bulk_jobs: false }) {
        Ok(c) => c,
        Err(e) => panic!("setup: Core::open_ext: {e:?}"),
    };
    let _ = core.wait_idle(Duration::from_secs(30));
    let m = core.task_views_migrate(NOW);
    assert_eq!(outcome(&m), "Off", "opened with bulk_jobs: false, the migration answers Off ({m:?})");
    assert!(!root.join(SCHEDULE).exists(), "no Schedule.yml");
    assert!(!root.join(KANBAN).exists(), "no Kanban.yml");
    assert_eq!(std::fs::read(root.join(TASK_YML)).ok(), Some(task), "task.yml byte-equal");
    drop(core);
    assert_eq!(snapshot(&root), before, "every vault file keeps its bytes, mtime and inode; nothing created");

    // Positive control: the desktop's options migrate (R202).
    let sb2 = sandbox();
    let root2 = base_vault(&sb2);
    let desk = match Core::open(&root2, &sb2.dirs, CoreOptions { watch: false, sync: None }) {
        Ok(c) => c,
        Err(e) => panic!("setup: Core::open: {e:?}"),
    };
    let _ = desk.wait_idle(Duration::from_secs(30));
    let m2 = desk.task_views_migrate(NOW);
    assert_eq!(outcome(&m2), "Done", "the desktop's options migrate (positive control, R202): {m2:?}");
    assert!(root2.join(SCHEDULE).exists() && root2.join(KANBAN).exists(), "the desktop migration creates Schedule.yml and Kanban.yml");
}
