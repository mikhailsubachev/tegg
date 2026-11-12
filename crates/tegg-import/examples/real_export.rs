//! The owner's real-export run (docs/contracts/v1-import.md §13; FR-IMP-23, D-1543, FR-IMP-03 AC-11). Owner only
//! (D-62): `TEGG_REAL_EXPORTS=1 cargo run --release -p tegg-import --example real_export -- [--keep <dir>]` from the
//! repository root. Without `TEGG_REAL_EXPORTS=1` it prints `skipped: 1` and exits 0. Not a test and not a gate step:
//! `cargo test` only compiles it. It prints counts and indexes only (`tegg_import::real_export`).

use std::path::PathBuf;
use std::sync::Arc;

fn main() {
    if std::env::var("TEGG_REAL_EXPORTS").as_deref() != Ok("1") {
        println!("skipped: 1");
        return;
    }
    let mut keep: Option<PathBuf> = None;
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match (a.as_str(), args.next()) {
            ("--keep", Some(dir)) => keep = Some(PathBuf::from(dir)),
            // Never echo an argument: it may be a path.
            _ => {
                println!("usage_error: 1");
                std::process::exit(2);
            }
        }
    }
    let Ok(repo) = std::env::current_dir() else {
        println!("error.repository: 1");
        std::process::exit(2);
    };
    // The one transformer of the run, its stderr sent to the null device (§13).
    let script = tegg_jobs::testing::transform_cli(&repo);
    let transformer: Arc<dyn tegg_jobs::Transformer> = match tegg_jobs::testing::NodeTransformer::start_quiet(&script) {
        Ok(t) => Arc::new(t),
        Err(_) => {
            println!("error.transformer: 1");
            std::process::exit(1);
        }
    };
    // `run` keeps every index in a scratch folder of its own; this root is never written.
    let dirs = tegg_vault::AppDirs { root: std::env::temp_dir() };
    let mut env = tegg_import::testing::env(&dirs, transformer);
    env.clock = Arc::new(chrono::Utc::now);
    let args = tegg_import::real_export::Args { exports: repo.join("test exports"), keep, repo };
    let code = tegg_import::real_export::run(&args, &env, &mut std::io::stdout());
    std::process::exit(code);
}
