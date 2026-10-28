//! ms4-jobs §14.7 (D-805, D-811, D-819, D-832): the tidy job's scheduler. With the watcher on, the core starts a
//! `folder-move` tidy job once at vault open (index idle and the transformer ready), then whenever the vault has been
//! quiet for 30 s after a watcher event; a run that skipped a stray starts a new quiet period after itself.

use std::sync::Weak;
use std::time::{Duration, Instant};

use tegg_jobs::{JobOp, JobsRef};

use crate::{lock, Shared};

/// The quiet period: 30 s, or `TEGG_TEST_QUIET_MS` (tests).
fn quiet() -> Duration {
    std::env::var("TEGG_TEST_QUIET_MS").ok().and_then(|v| v.parse().ok()).map(Duration::from_millis).unwrap_or(Duration::from_secs(30))
}

pub(crate) fn spawn(shared: Weak<Shared>, jobs: JobsRef) {
    // D-835: real-app tests start the app with `TEGG_TEST_TIDY=0` unless they test the tidy job.
    if std::env::var("TEGG_TEST_TIDY").as_deref() == Ok("0") {
        return;
    }
    let _ = std::thread::Builder::new().name("tegg-tidy".into()).spawn(move || run(shared, jobs));
}

fn run(shared: Weak<Shared>, jobs: JobsRef) {
    let quiet = quiet();
    let tick = (quiet / 10).clamp(Duration::from_millis(20), Duration::from_millis(500));
    let mut opened = false;
    // The instant after which a tidy run is due once the vault is quiet, or None when nothing is pending.
    let mut due: Option<Instant> = None;
    let mut seen: Option<Instant> = None;
    loop {
        std::thread::sleep(tick);
        let Some(s) = shared.upgrade() else { return };
        if !jobs.alive() {
            return;
        }
        let last = *lock(&s.last_event);
        let idle = *lock(&s.pending) == 0;
        drop(s);
        if last != seen {
            seen = last;
            due = last.map(|t| t + quiet);
        }
        let now = Instant::now();
        let start = if !opened {
            idle && jobs.ready()
        } else {
            due.is_some_and(|d| now >= d) && idle && !jobs.busy()
        };
        if !start {
            continue;
        }
        opened = true;
        due = None;
        let Ok(job) = jobs.start(JobOp::FolderMove { r#type: None, to_folder: None }) else { continue };
        let report = jobs.wait(job, Duration::from_secs(600));
        // D-832: a skipped stray is tried again after another quiet period, even with no new event.
        if report.is_some_and(|r| !r.skipped.is_empty()) {
            due = Some(Instant::now() + quiet);
        }
        // The run's own moves come back as watcher events: they don't make a new run due.
        if let Some(s) = shared.upgrade() {
            seen = *lock(&s.last_event);
        }
    }
}

