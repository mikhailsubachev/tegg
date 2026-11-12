//! §13: the owner's real-export run (FR-IMP-23, D-1543, FR-IMP-03 AC-11). For every zip of the exports folder that is
//! a Capacities export, for every space: plan with the default mapping, write a new vault in a scratch folder, check
//! the accounting (§6) and every written file, then delete the vault (or keep it with `--keep`).
//!
//! **Counts and indexes only reach the terminal (D-62).** Exports and spaces are numbered, never named; no error value,
//! reason, path or title is printed; a panic is one count line (the panic hook prints nothing); every line is checked
//! by [`is_counts_only`] before it is printed. The transformer's stderr is the caller's to silence
//! (`NodeTransformer::start_quiet`, `examples/real_export.rs`).

use std::collections::BTreeMap;
use std::io;
use std::panic::{self, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use tegg_core::{Core, CoreOptions};
use tegg_vault::{AppDirs, ExternalFolder, ExternalRead, LocalFs, VaultFs};

use crate::*;

pub struct Args {
    /// The folder holding the exports (`<repository>/test exports`).
    pub exports: PathBuf,
    /// `--keep <dir>`: the written vaults stay under `<dir>/export-<i>-space-<j>/`.
    pub keep: Option<PathBuf>,
    /// The repository root: a `--keep` folder or the temporary folder inside it is refused.
    pub repo: PathBuf,
}

/// `^[a-z0-9_.]+: [0-9]+(,[0-9]+)*$`, for every line of `s`; an empty text is not counts.
pub fn is_counts_only(s: &str) -> bool {
    static RE: OnceLock<Option<regex::Regex>> = OnceLock::new();
    let Some(re) = RE.get_or_init(|| regex::Regex::new(r"^[a-z0-9_.]+: [0-9]+(,[0-9]+)*$").ok()) else { return false };
    !s.is_empty() && s.split('\n').all(|l| re.is_match(l))
}

/// The marker that lets `tegg_vault::remove_dir_tree` delete the run's own scratch folders (§12.2).
const MARKER: &str = ".tegg-import";
/// How long one space's write may take before the run counts it as failed.
const WRITE_LIMIT: Duration = Duration::from_secs(3600);

/// Panics seen by the run's hook (any thread: the job's too).
static PANICS: AtomicUsize = AtomicUsize::new(0);

/// `camelCase` → `snake_case` (serde codes into count names).
fn snake(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        if c.is_ascii_uppercase() {
            if !out.is_empty() {
                out.push('_');
            }
            out.push(c.to_ascii_lowercase());
        } else if c == '-' {
            out.push('_');
        } else {
            out.push(c);
        }
    }
    out
}
fn error_code(e: &ImportError) -> String {
    serde_json::to_value(e).ok().and_then(|v| v.get("code").and_then(|c| c.as_str()).map(snake)).unwrap_or_else(|| "unknown".into())
}
fn outcome_code(o: &LinkOutcome) -> String {
    serde_json::to_value(o).ok().and_then(|v| v.get("kind").and_then(|c| c.as_str()).map(snake)).unwrap_or_else(|| "unknown".into())
}
fn violation_code(c: accounting::ViolationCode) -> String {
    snake(&format!("{c:?}"))
}

/// The lines of the run, each checked before it is printed.
struct Lines<'a> {
    out: &'a mut dyn io::Write,
}
impl Lines<'_> {
    fn put(&mut self, line: &str) {
        let line = if is_counts_only(line) { line } else { "format_violation: 1" };
        let _ = writeln!(self.out, "{line}");
    }
    fn all(&mut self, lines: &[String]) {
        lines.iter().for_each(|l| self.put(l));
        let _ = self.out.flush();
    }
}

/// A folder of the run's own, with the marker, so it can be removed whole at the end.
fn scratch(parent: &Path, name: &str) -> io::Result<PathBuf> {
    let dir = parent.join(name);
    tegg_vault::create_external_dir_new(&dir)?;
    LocalFs::new(&dir).create_new(MARKER, b"{\"version\":1,\"run\":\"real-export\"}\n")?;
    Ok(dir)
}

/// `refused.<reason>` for a place inside a Git repository or worktree, the repository itself, or a vault.
fn refusal(place: &Path, repo: &Path) -> Option<&'static str> {
    let git = tegg_vault::has_entry_at_or_above(place, ".git");
    let vault = tegg_vault::has_entry_at_or_above(place, ".tegg");
    match (git, vault) {
        (Ok(true), _) => Some("inside_repository"),
        _ if tegg_vault::is_inside(place, repo).unwrap_or(false) => Some("inside_repository"),
        (_, Ok(true)) => Some("inside_vault"),
        (Ok(false), Ok(false)) => None,
        _ => Some("unreadable_place"),
    }
}

/// Writes the report to `out`. 0: every check passed; 1: a check failed (or a run panicked); 2: refused.
pub fn run(args: &Args, env: &ImportEnv, out: &mut dyn io::Write) -> i32 {
    let mut lines = Lines { out };
    // Before anything is read: where the vaults would go.
    let place = args.keep.clone().unwrap_or_else(std::env::temp_dir);
    if let Some(reason) = refusal(&place, &args.repo) {
        lines.all(&["refused: 1".to_string(), format!("refused.{reason}: 1")]);
        return 2;
    }
    let previous = panic::take_hook();
    panic::set_hook(Box::new(|_| {
        PANICS.fetch_add(1, Ordering::SeqCst);
    }));
    let code = panic::catch_unwind(AssertUnwindSafe(|| run_all(args, env, &place, &mut lines))).unwrap_or_else(|_| {
        lines.put("panic: 1");
        1
    });
    panic::set_hook(previous);
    code
}

fn run_all(args: &Args, env: &ImportEnv, place: &Path, lines: &mut Lines<'_>) -> i32 {
    let stamp = format!("{}-{}", std::process::id(), (env.clock)().timestamp_millis());
    // The vaults' parent: `--keep`'s folder, or a scratch folder in the temporary directory, removed at the end.
    let (parent, temporary) = match &args.keep {
        Some(keep) => {
            if tegg_vault::stat_external(keep).ok().flatten().is_none() && tegg_vault::create_external_dir_new(keep).is_err() {
                lines.put("error.keep_folder: 1");
                return 1;
            }
            (keep.clone(), None)
        }
        None => match scratch(place, &format!("tegg-real-export-{stamp}")) {
            Ok(dir) => (dir.clone(), Some(dir)),
            Err(_) => {
                lines.put("error.temporary_folder: 1");
                return 1;
            }
        },
    };
    // The index of each written vault lives in a scratch folder of its own (never the owner's Application Support).
    let app = match scratch(&parent, &format!(".tegg-real-export-app-{stamp}")) {
        Ok(dir) => dir,
        Err(_) => {
            lines.put("error.temporary_folder: 1");
            return 1;
        }
    };
    let mut env = env.clone();
    env.dirs = AppDirs { root: app.clone() };

    let zips: Vec<String> = {
        let mut v: Vec<String> = ExternalFolder::new(&args.exports)
            .list()
            .unwrap_or_default()
            .into_iter()
            .map(|(rel, _, _)| rel)
            .filter(|rel| !rel.contains('/') && rel.to_ascii_lowercase().ends_with(".zip"))
            .collect();
        v.sort_by_key(|n| tegg_format::nfc(n));
        v
    };
    let mut code = 0;
    for (i, zip) in zips.iter().enumerate() {
        let before = PANICS.load(Ordering::SeqCst);
        let mut out: Vec<String> = Vec::new();
        let path = args.exports.join(zip);
        let result = panic::catch_unwind(AssertUnwindSafe(|| one_export(i, &path, &parent, &env, &mut out)));
        lines.all(&out);
        match result {
            Ok(ok) if PANICS.load(Ordering::SeqCst) == before => {
                if !ok {
                    code = 1;
                }
            }
            _ => {
                lines.put("panic: 1");
                code = 1;
            }
        }
    }
    let _ = tegg_vault::remove_dir_tree(&app);
    if let Some(dir) = temporary {
        let _ = tegg_vault::remove_dir_tree(&dir);
    }
    code
}

/// One export's lines; `false` when a check failed.
fn one_export(i: usize, path: &Path, parent: &Path, env: &ImportEnv, out: &mut Vec<String>) -> bool {
    let p = format!("export.{i}");
    let scan = match crate::scan(path, env, &Control::default()) {
        Ok(s) => s,
        Err(ImportError::NotCapacities) => {
            out.push(format!("{p}.capacities: 0"));
            return true;
        }
        Err(e) => {
            out.push(format!("{p}.capacities: 0"));
            out.push(format!("{p}.error.{}: 1", error_code(&e)));
            return false;
        }
    };
    out.push(format!("{p}.capacities: 1"));
    out.push(format!("{p}.spaces: {}", scan.info.spaces.len()));
    out.push(format!("{p}.unreadable: {}", scan.info.unreadable.len()));
    out.push(format!("{p}.files_outside_spaces: {}", scan.info.outside_spaces));
    let mut ok = true;
    let spaces: Vec<String> = scan.info.spaces.iter().map(|s| s.name.clone()).collect();
    for (j, space) in spaces.iter().enumerate() {
        let before = PANICS.load(Ordering::SeqCst);
        ok &= one_space(&format!("{p}.space.{j}"), &scan, space, parent, &format!("export-{i}-space-{j}"), env, out);
        if PANICS.load(Ordering::SeqCst) != before {
            // The run's own thread panicked: the export stops here and is counted once (§13).
            panic::resume_unwind(Box::new("a run panicked"));
        }
    }
    ok
}

/// One space: plan, write, check. `false` when a check failed.
fn one_space(p: &str, scan: &Scan, space: &str, parent: &Path, name: &str, env: &ImportEnv, out: &mut Vec<String>) -> bool {
    let target = Target::NewVault { parent: parent.to_path_buf(), name: name.to_string() };
    let plan = match crate::plan(scan, space, &target, &Mapping::default(), env, &Control::default()) {
        Ok(plan) => plan,
        Err(e) => {
            out.push(format!("{p}.error.{}: 1", error_code(&e)));
            return false;
        }
    };
    for (class, t) in [("objects", &plan.totals.objects), ("attachments", &plan.totals.attachments), ("links", &plan.totals.links)] {
        out.push(format!("{p}.{class}.total: {}", t.total));
        out.push(format!("{p}.{class}.imported: {}", t.imported));
        out.push(format!("{p}.{class}.reported: {}", t.reported));
    }
    let mut outcomes: BTreeMap<String, usize> = BTreeMap::new();
    plan.links.iter().for_each(|l| *outcomes.entry(outcome_code(&l.outcome)).or_default() += 1);
    for (k, n) in &outcomes {
        out.push(format!("{p}.links.{k}: {n}"));
    }
    out.push(format!("{p}.types: {}", plan.types.len()));
    out.push(format!("{p}.types_new: {}", plan.types.iter().filter(|t| t.new).count()));
    // §4.1: a stored cover that isn't a link into a `Media/` folder is dropped and reported with its count (CP-11).
    let unknown_covers: usize = plan
        .report
        .attributes
        .iter()
        .filter(|r| matches!(r.source_key.as_str(), "coverImage" | "previewImage"))
        .map(|r| if let AttrChange::Dropped { values } = r.change { values } else { 0 })
        .sum();
    out.push(format!("{p}.unknown_cover_values: {unknown_covers}"));

    // The write.
    let before = PANICS.load(Ordering::SeqCst);
    let report = match crate::start(plan.clone(), scan, &target, env) {
        Ok(run) => {
            let until = Instant::now() + WRITE_LIMIT;
            loop {
                if let Some(r) = run.wait(Duration::from_millis(200)) {
                    break Some(r);
                }
                if PANICS.load(Ordering::SeqCst) != before || Instant::now() > until {
                    break None;
                }
            }
        }
        Err(e) => {
            out.push(format!("{p}.error.{}: 1", error_code(&e)));
            None
        }
    };
    if PANICS.load(Ordering::SeqCst) != before {
        // The run's thread panicked: the caller counts it, nothing else is said about this space.
        return false;
    }
    let failed = report.as_ref().and_then(|r| r.error.clone());
    let Some(report) = report.filter(|r| r.phase == tegg_jobs::Phase::Done) else {
        if let Some(e) = &failed {
            out.push(format!("{p}.error.{}: 1", error_code(e)));
        }
        out.push(format!("{p}.accounting_errors: 0"));
        out.push(format!("{p}.written_files: 0"));
        out.push(format!("{p}.roundtrip_failures: 0"));
        out.push(format!("{p}.unresolved_written_links: 0"));
        return false;
    };
    let Some(root) = report.vault.clone() else { return false };
    let violations = accounting::check_vault(&scan.source, &plan, &root);
    out.push(format!("{p}.accounting_errors: {}", violations.len()));
    let mut codes: BTreeMap<String, usize> = BTreeMap::new();
    violations.iter().for_each(|v| *codes.entry(violation_code(v.code)).or_default() += 1);
    for (k, n) in &codes {
        out.push(format!("{p}.accounting.{k}: {n}"));
    }
    out.push(format!("{p}.written_files: {}", report.written.len()));
    let (roundtrip, unresolved, failing) = check_written(&plan, &root, env);
    out.push(format!("{p}.roundtrip_failures: {roundtrip}"));
    out.push(format!("{p}.unresolved_written_links: {unresolved}"));
    if !failing.is_empty() {
        out.push(format!("{p}.failing_object_indexes: {}", failing.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",")));
    }
    violations.is_empty() && roundtrip == 0 && unresolved == 0
}

/// FR-IMP-03 AC-10 on every written note (indexed as one object with an id and one type, LF, no BOM, NFC name of
/// 1…200 bytes, an unchanged save changes no byte) and FR-IMP-10 AC-10 (each `resolved` link, in the form the run
/// wrote, resolves to the planned file in an index of the written vault). Returns the failures and the failing objects'
/// indexes in the plan.
fn check_written(plan: &Plan, root: &Path, env: &ImportEnv) -> (usize, usize, Vec<usize>) {
    let index_of = |path: &str| plan.objects.iter().position(|o| o.path.as_deref() == Some(path));
    let mut failing: Vec<usize> = Vec::new();
    let Ok(core) = Core::open(root, &env.dirs, CoreOptions { watch: false, sync: None }) else {
        let all: Vec<usize> = (0..plan.objects.len()).filter(|i| plan.objects[*i].outcome == ObjectOutcome::Imported).collect();
        return (all.len() + 1, 0, all);
    };
    core.wait_idle(Duration::from_secs(600));
    let mut roundtrip = 0;
    let notes: Vec<String> = plan.objects.iter().filter(|o| o.outcome == ObjectOutcome::Imported).filter_map(|o| o.path.clone()).chain([plan.report_path.clone()]).collect();
    for path in &notes {
        let stem = path.rsplit('/').next().unwrap_or("").strip_suffix(".md").unwrap_or("");
        let ok = (|| {
            let (bytes, v) = core.read_note(path, std::time::SystemTime::now()).ok()?;
            let text = std::str::from_utf8(&bytes).ok()?;
            let o = core.object(path)?;
            let shape = text.starts_with("---\nid: ") && !text.contains('\r') && !text.contains('\u{feff}') && text.ends_with('\n');
            let name = tegg_format::nfc(path) == *path && !stem.is_empty() && stem.len() <= 200;
            let saved = core.write_note(path, &bytes, Some(&v)).is_ok() && core.read_note(path, std::time::SystemTime::now()).ok().is_some_and(|(after, _)| after == bytes);
            Some(shape && name && saved && o.type_single)
        })()
        .unwrap_or(false);
        if !ok {
            roundtrip += 1;
            failing.extend(index_of(path));
        }
    }
    let paths = render::plan_paths(plan, &[]);
    let mut unresolved = 0;
    for l in plan.links.iter().filter(|l| l.outcome == LinkOutcome::Resolved && l.place == LinkPlace::Body) {
        let (Some(from), Some(to)) = (plan.objects.iter().find(|o| o.source == l.note).and_then(|o| o.path.clone()), l.to.clone()) else { continue };
        let target = paths.d184(&from, &to, "");
        let got = core.resolve_links(&from, &[target]).first().and_then(|t| t.path.clone()).map(|p| tegg_format::nfc(&p));
        if got.as_deref() != Some(to.as_str()) {
            unresolved += 1;
            failing.extend(index_of(&from));
        }
    }
    failing.sort_unstable();
    failing.dedup();
    (roundtrip, unresolved, failing)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_only_is_one_count_line_per_line() {
        assert!(is_counts_only("export.0.spaces: 3"));
        assert!(is_counts_only("export.0.space.1.failing_object_indexes: 4,17,230"));
        assert!(is_counts_only("a: 1\nb: 2"));
        for bad in ["", "a: 1\n", "a: ", "A: 1", "a:1", "a: 1 ", "a: 1,", "a: -1", "a b: 1", "a: 1\nPKM: 2"] {
            assert!(!is_counts_only(bad), "{bad:?}");
        }
    }

    #[test]
    fn codes_are_snake_case() {
        assert_eq!(error_code(&ImportError::SourceChanged { entry: None }), "source_changed");
        assert_eq!(error_code(&ImportError::NotCapacities), "not_capacities");
        assert_eq!(outcome_code(&LinkOutcome::OtherSpace { space: "x".into() }), "other_space");
        assert_eq!(violation_code(accounting::ViolationCode::TotalMismatch), "total_mismatch");
    }
}
