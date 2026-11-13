//! Slice I1, L4: the owner's real-export run, on synthetic input only (docs/acceptance/import-capacities.md
//! FR-IMP-03 AC-11; docs/contracts/v1-import.md §13; D-62, D-1543). The run itself is started by the owner and never
//! by a test or a gate. What is tested here, through the library entry `tegg_import::real_export::run`: the output
//! is counts and indexes only (stdout **and** stderr of a child process are captured), also for a fixture with
//! broken YAML and for a hook that panics with a path in its message; the temporary vaults are deleted; and
//! `--keep <dir>` and the default temporary directory are refused inside a Git repository or a vault before
//! anything is read. Each case runs in a child process of this test binary (TMPDIR and the panic hook are
//! process-wide). Written from the criterion and the contract only (D-61); every check is an assertion in this file.

mod common;

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

use common::*;
use tegg_import::real_export::{self, Args};
use tegg_import::{ImportPoint, PointAction};

const SECRET: &str = "/Users/tajné/Soukromá poznámka PKM home.md";

/// `^[a-z0-9_.]+: [0-9]+(,[0-9]+)*$` (§13), checked here without the function under test.
fn counts_only(line: &str) -> bool {
    let Some((key, value)) = line.split_once(": ") else { return false };
    !key.is_empty()
        && key.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '.')
        && !value.is_empty()
        && value.split(',').all(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()))
}
/// The exports folder of the cases: `c01-spaces` zipped (three spaces), `c02` (one note with broken YAML) and a zip
/// that isn't a Capacities export.
fn exports(base: &Path) -> PathBuf {
    let dir = base.join("exporty");
    for f in ["c01-spaces", "c02-typed-frontmatter", "x01-not-capacities"] {
        write_zip(&dir.join(format!("{f}.zip")), &entries_of(&fixtures().join(f), ""));
    }
    dir
}
struct Out {
    code: Option<i32>,
    stdout: Vec<String>,
    stderr: Vec<String>,
    reached: bool,
}
/// Runs `case` in a child process of this binary and returns what `real_export::run` printed (the lines between the
/// markers) and its exit code.
fn child(test: &str, case: &str, base: &Path, tmpdir: Option<&Path>) -> Out {
    let mut cmd = Command::new(std::env::current_exe().expect("setup: test binary"));
    cmd.args(["--exact", test, "--nocapture", "--test-threads", "1"]).env("TEGG_REAL_EXPORT_CASE", case).env("TEGG_REAL_EXPORT_BASE", base);
    if let Some(t) = tmpdir {
        std::fs::create_dir_all(t).expect("setup: TMPDIR");
        cmd.env("TMPDIR", t);
    }
    let out = cmd.output().expect("setup: run the child");
    let between = |bytes: &[u8]| {
        let text = String::from_utf8_lossy(bytes).into_owned();
        // The marker may follow other text on its line (libtest prints the test's name first): the lines start after
        // the rest of the marker's line.
        let rest = text.find("<<BEGIN>>").map_or("", |i| &text[i + "<<BEGIN>>".len()..]);
        let lines: Vec<String> = rest.lines().skip(1).take_while(|l| *l != "<<END>>").map(str::to_string).collect();
        (lines, text.contains("<<END>>"))
    };
    let ((stdout, reached), (stderr, _)) = (between(&out.stdout), between(&out.stderr));
    Out { code: out.status.code(), stdout, stderr, reached }
}
/// The child side: runs the case and exits with `run`'s answer. Returns only when this process is not a child.
fn run_case_if_child() {
    let (Ok(case), Ok(base)) = (std::env::var("TEGG_REAL_EXPORT_CASE"), std::env::var("TEGG_REAL_EXPORT_BASE")) else { return };
    let base = PathBuf::from(base);
    let dirs = tegg_vault::AppDirs { root: base.join("Application Support/Tegg") };
    std::fs::create_dir_all(&dirs.root).expect("child: app support");
    // The quiet transformer of §13: its stderr goes to the null device.
    let script = tegg_jobs::testing::transform_cli(&repo_root());
    let t: Arc<dyn tegg_jobs::Transformer> = Arc::new(tegg_jobs::testing::NodeTransformer::start_quiet(&script).expect("child: transformer"));
    let mut env = tegg_import::testing::env(&dirs, t);
    let keep = match case.as_str() {
        "keep-in-repo" => Some(repo_root().join("tests/fixtures/import/ponechat/nová složka")),
        "keep-in-vault" => Some(base.join("Trezor/Pages/ponechat")),
        "keep-ok" => Some(base.join("ponechat")),
        _ => None,
    };
    if case == "panic" {
        env.points = Some(Arc::new(|p: &ImportPoint| if matches!(p, ImportPoint::Rendered) { panic!("{SECRET}") } else { PointAction::Continue }));
    }
    let args = Args { exports: base.join("exporty"), keep, repo: repo_root() };
    println!("<<BEGIN>>");
    eprintln!("<<BEGIN>>");
    let code = real_export::run(&args, &env, &mut std::io::stdout());
    let _ = std::io::stdout().flush();
    println!("<<END>>");
    eprintln!("<<END>>");
    std::process::exit(code);
}
fn assert_counts_only(out: &Out, what: &str) {
    assert!(out.reached, "{what}: the run returned (it printed to the end)");
    for l in out.stdout.iter().chain(&out.stderr) {
        assert!(counts_only(l), "{what}: every line of stdout and stderr is `key: number[,number…]`: {l:?}");
        assert!(real_export::is_counts_only(l), "{what}: and passes is_counts_only: {l:?}");
    }
    let all = out.stdout.join("\n") + &out.stderr.join("\n");
    for word in ["pkm", "work", "idc", "home", "book", "tajn", "users", "quarterly", "exporty", "c01", ".md", ".zip"] {
        assert!(!all.to_lowercase().contains(word), "{what}: no title, path or content can appear: found {word:?}");
    }
    assert_eq!(out.stderr, Vec::<String>::new(), "{what}: stderr stays empty");
}
fn has(out: &Out, line: &str) -> bool {
    out.stdout.iter().any(|l| l == line)
}
fn ends(out: &Out, suffix: &str) -> usize {
    out.stdout.iter().filter(|l| l.ends_with(suffix)).count()
}

#[test]
fn fr_imp_03_ac11_real_export_counts_only() {
    run_case_if_child();
    const TEST: &str = "fr_imp_03_ac11_real_export_counts_only";
    assert!(real_export::is_counts_only("export.0.spaces: 3") && real_export::is_counts_only("space.1.failing_object_indexes: 4,17,230"), "is_counts_only accepts count lines");
    for bad in ["PKM home: 1", "export.0.title: Book 1", "export.0.spaces: tři", "/Users/tajné: 1", "export.0.spaces:3", "export.0.spaces: 3 ", "", "panicked at src/lib.rs:1:1", "export.0.spaces: 3\nPKM home: 1"] {
        assert!(!real_export::is_counts_only(bad), "is_counts_only refuses {bad:?}");
    }

    // The run on synthetic exports: counts and indexes only, exit 0, the temporary vaults deleted.
    let sb = sandbox();
    exports(&sb.base);
    let tmp = sb.base.join("tmp");
    let out = child(TEST, "run", &sb.base, Some(&tmp));
    assert_counts_only(&out, "the run");
    assert_eq!(out.code, Some(0), "every check passed: exit 0; the output: {:?}", out.stdout);
    for (suffix, n) in [(".capacities: 1", 2), (".capacities: 0", 1), (".spaces: 3", 1), (".spaces: 1", 1)] {
        assert_eq!(ends(&out, suffix), n, "{n} line(s) ending {suffix:?}: {:?}", out.stdout);
    }
    assert_eq!(ends(&out, ".objects.total: 3"), 2, "PKM and Work of the first export have 3 objects each");
    assert_eq!(ends(&out, ".objects.total: 2"), 1, "IDC has 2");
    assert_eq!((ends(&out, ".objects.total: 8"), ends(&out, ".objects.imported: 7"), ends(&out, ".objects.reported: 1")), (1, 1, 1), "the export with broken YAML: 8 objects, 7 imported, 1 reported");
    assert_eq!((ends(&out, ".accounting_errors: 0"), ends(&out, ".roundtrip_failures: 0"), ends(&out, ".unresolved_written_links: 0")), (4, 4, 4), "per space: the accounting, the round trip and link resolution pass");
    assert_eq!(ends(&out, ".links.other_space: 2"), 1, "outcomes are counted per name, underscored");
    assert!(out.stdout.iter().any(|l| l.contains(".written_files: ")) && out.stdout.iter().any(|l| l.contains(".types_new: ")), "written files and new types are counted");
    let left: Vec<String> = snapshot(&tmp).into_keys().filter(|k| k.ends_with(".tegg/vault.yml") || k.ends_with(".md")).collect();
    assert_eq!(left, Vec::<String>::new(), "the temporary vaults are deleted at the end");
    assert!(!sb.base.join("ponechat").exists(), "nothing is kept without --keep");

    // A hook that panics with a path in its message: `panic: 1`, exit 1, and the message never reaches the terminal.
    let sb = sandbox();
    exports(&sb.base);
    let out = child(TEST, "panic", &sb.base, Some(&sb.base.join("tmp")));
    assert_counts_only(&out, "a panic");
    assert_eq!(out.code, Some(1), "a failed check: exit 1");
    assert!(has(&out, "panic: 1"), "the panic is one count line: {:?}", out.stdout);

    // --keep: refused inside the repository and inside a vault, before anything is read; kept elsewhere.
    for (case, reason) in [("keep-in-repo", "refused.inside_repository: 1"), ("keep-in-vault", "refused.inside_vault: 1")] {
        let sb = sandbox();
        exports(&sb.base);
        copy_dir(&repo_root().join("tests/fixtures/vaults/new-empty/.tegg"), &sb.base.join("Trezor/.tegg"), &[]);
        let before = snapshot(&sb.base);
        let out = child(TEST, case, &sb.base, Some(&sb.base.join("tmp")));
        assert_counts_only(&out, case);
        assert_eq!((out.code, out.stdout.clone()), (Some(2), strs(&["refused: 1", reason])), "{case}: refused with exit 2 and only the reason, never the path");
        let after: Vec<String> = changed(&before, &snapshot(&sb.base)).into_iter().filter(|k| !k.starts_with("tmp") && !k.starts_with("Application Support")).collect();
        assert_eq!(after, Vec::<String>::new(), "{case}: nothing was created");
        assert!(!repo_root().join("tests/fixtures/import/ponechat").exists(), "{case}: nothing was created in the repository");
    }
    let sb = sandbox();
    exports(&sb.base);
    let out = child(TEST, "keep-ok", &sb.base, Some(&sb.base.join("tmp")));
    assert_counts_only(&out, "--keep outside every repository and vault");
    assert_eq!(out.code, Some(0), "exit 0: {:?}", out.stdout);
    let kept: Vec<String> = snapshot(&sb.base.join("ponechat")).into_keys().filter(|k| k.ends_with("/.tegg/vault.yml")).collect();
    assert_eq!(kept, ["export-0-space-0/.tegg/vault.yml", "export-0-space-1/.tegg/vault.yml", "export-0-space-2/.tegg/vault.yml", "export-1-space-0/.tegg/vault.yml"], "the written vaults are kept under <dir>/export-<i>-space-<j>/");

    // The default temporary directory gets the same refusal: a TMPDIR inside a temporary Git repository.
    let sb = sandbox();
    exports(&sb.base);
    let repo = sb.base.join("cizí repozitář");
    std::fs::create_dir_all(repo.join(".git")).expect("setup: a .git folder");
    let out = child(TEST, "run", &sb.base, Some(&repo.join("tmp")));
    assert_counts_only(&out, "TMPDIR inside a Git repository");
    assert_eq!((out.code, out.stdout.clone()), (Some(2), strs(&["refused: 1", "refused.inside_repository: 1"])), "refused with exit 2 before anything is read");
    let written: Vec<String> = snapshot(&repo).into_keys().filter(|k| k.ends_with(".md") || k.ends_with(".yml")).collect();
    assert_eq!(written, Vec::<String>::new(), "no note reached the repository");
}
