//! §2 `testing`: the environment of the tests (the test clock, Europe/Prague, ids `01JB5V…nn`).
use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use crate::{ImportEnv, ReportStrings, SystemDisk};

pub fn env(dirs: &tegg_vault::AppDirs, transformer: Arc<dyn tegg_jobs::Transformer>) -> ImportEnv {
    let n = Arc::new(AtomicU32::new(0));
    ImportEnv {
        clock: Arc::new(|| chrono::DateTime::parse_from_rfc3339("2026-11-12T10:00:00+01:00").map(|t| t.with_timezone(&chrono::Utc)).unwrap_or_default()),
        zone: chrono_tz::Europe::Prague,
        ids: Arc::new(move || format!("01JB5V000000000000000000{:02}", n.fetch_add(1, Ordering::SeqCst) + 1)),
        transformer,
        dirs: tegg_vault::AppDirs { root: dirs.root.clone() },
        disk: Arc::new(SystemDisk),
        trash: Arc::new(FailingTrash),
        strings: ReportStrings::english(),
        points: None,
    }
}
/// Answers an error and moves nothing: a test that forgets to set a trash can never move a folder anywhere (§2).
struct FailingTrash;
impl tegg_vault::SystemTrash for FailingTrash {
    fn trash(&self, _: &Path) -> io::Result<()> {
        Err(io::Error::other("testing::env has no system Trash: set `env.trash`"))
    }
}
