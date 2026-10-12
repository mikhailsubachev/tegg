//! `core-perf --vault <dir> [--runs N] [--out results.json]`: p95 of the core-level NFR-PERF metrics
//! (-02 full index, -02 AC-2 reopen with 100 offline changes, -03 switcher, -04 search, -08 external change)
//! on a copy of `<dir>`, against the D-59 reference targets. Run by `./verify nightly` (trend, test-strategy §9).
//! Never point it at a real vault: it changes files in its own temporary copy only.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};

use serde_json::json;
use tegg_core::{Core, CoreOptions, SearchQuery};
use tegg_vault::AppDirs;

const PRAGUE: chrono_tz::Tz = chrono_tz::Europe::Prague;

fn copy_tree(from: &Path, to: &Path) {
    fs::create_dir_all(to).expect("create dir");
    for e in fs::read_dir(from).expect("read_dir") {
        let e = e.expect("entry");
        if e.file_name() == "_attachments" {
            continue;
        }
        let (src, dst) = (e.path(), to.join(e.file_name()));
        if e.file_type().expect("type").is_dir() {
            copy_tree(&src, &dst);
        } else {
            fs::copy(&src, &dst).expect("copy");
        }
    }
}

fn notes(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    fn walk(root: &Path, dir: &Path, out: &mut Vec<PathBuf>) {
        for e in fs::read_dir(dir).expect("read_dir") {
            let e = e.expect("entry");
            let name = e.file_name().to_string_lossy().to_string();
            if e.file_type().expect("type").is_dir() {
                if !name.starts_with('.') && !(dir == root && name == "_templates") {
                    walk(root, &e.path(), out);
                }
            } else if name.ends_with(".md") && !name.starts_with('.') {
                out.push(e.path());
            }
        }
    }
    walk(root, root, &mut out);
    out.sort();
    out
}

fn p95(mut v: Vec<Duration>) -> f64 {
    v.sort();
    let i = ((v.len() as f64) * 0.95).ceil() as usize;
    v[i.saturating_sub(1).min(v.len() - 1)].as_secs_f64() * 1e3
}

fn open(vault: &Path, app: &Path, watch: bool) -> Core {
    let dirs = AppDirs { root: app.to_path_buf() };
    Core::open(vault, &dirs, CoreOptions { watch, sync: None }).expect("open vault")
}

fn main() {
    let mut args = std::env::args().skip(1);
    let (mut vault, mut runs, mut out) = (None, 20usize, None);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--vault" => vault = args.next().map(PathBuf::from),
            "--runs" => runs = args.next().and_then(|n| n.parse().ok()).unwrap_or(20),
            "--out" => out = args.next().map(PathBuf::from),
            other => panic!("unknown argument {other}"),
        }
    }
    let src = vault.expect("--vault <dir>");
    let tmp = tempfile::tempdir().expect("tempdir");
    let root = tmp.path().canonicalize().expect("tmp").join("vault");
    copy_tree(&src, &root);
    let files = notes(&root);
    let mut rows = Vec::new();
    let mut row = |id: &str, what: &str, samples: Vec<Duration>, target_ms: f64, factor: f64| {
        let p = p95(samples.clone());
        println!("{id} {what}: p95 {p:.1} ms (reference target {:.1} ms)", target_ms * factor);
        rows.push(json!({ "id": id, "what": what, "n": samples.len(), "p95_ms": p, "target_ms": target_ms, "factor": factor,
            "pass": p < target_ms * factor }));
    };

    // NFR-PERF-02: full index from nothing (fresh Application Support each run).
    let mut full = Vec::new();
    for i in 0..runs.min(5) {
        let app = tmp.path().join(format!("app-full-{i}"));
        let t = Instant::now();
        let core = open(&root, &app, false);
        assert!(core.wait_idle(Duration::from_secs(600)), "index finished");
        full.push(t.elapsed());
    }
    row("NFR-PERF-02", "full index", full, 30_000.0, 0.6);

    let app = tmp.path().join("app");
    let core = open(&root, &app, false);
    assert!(core.wait_idle(Duration::from_secs(600)));

    // NFR-PERF-03: every keystroke of a few queries.
    let mut sw = Vec::new();
    for _ in 0..runs {
        for q in ["c", "ct", "cteni", "rozpočet 2026", "zzzzzzzzzz"] {
            let chars: Vec<char> = q.chars().collect();
            for n in 1..=chars.len() {
                let typed: String = chars[..n].iter().collect();
                let t = Instant::now();
                let _ = core.switcher(&typed, 50);
                sw.push(t.elapsed());
            }
        }
    }
    row("NFR-PERF-03", "switcher keystroke", sw, 100.0, 0.75);

    // NFR-PERF-04: first 50 results with snippets: words, a phrase, a typo, a type filter.
    let first_type = core.objects().first().map(|o| o.r#type.clone()).unwrap_or_default();
    let mut typed = SearchQuery::text("řeka", PRAGUE);
    typed.types = vec![first_type];
    let queries = [SearchQuery::text("rozpočet", PRAGUE), SearchQuery::text("\"žluťoučký kůň\"", PRAGUE), SearchQuery::text("rozpcoet", PRAGUE), typed];
    let mut se = Vec::new();
    for _ in 0..runs {
        for q in &queries {
            let t = Instant::now();
            let _ = core.search(q);
            se.push(t.elapsed());
        }
    }
    row("NFR-PERF-04", "search, first 50 with snippets", se, 200.0, 0.75);
    drop(core);

    // NFR-PERF-02 AC-2: reopen after 100 files changed while closed.
    let mut reopen = Vec::new();
    for run in 0..runs.min(5) {
        for p in files.iter().step_by((files.len() / 100).max(1)).take(100) {
            let mut text = fs::read(p).expect("read");
            text.extend_from_slice(format!("\nOffline {run}.\n").as_bytes());
            fs::write(p, text).expect("write");
        }
        let t = Instant::now();
        let core = open(&root, &app, false);
        assert!(core.wait_idle(Duration::from_secs(600)));
        reopen.push(t.elapsed());
    }
    row("NFR-PERF-02/AC-2", "reopen with 100 offline changes", reopen, 3_000.0, 0.75);

    // NFR-PERF-08: external change → searchable.
    let core = open(&root, &app, true);
    assert!(core.wait_idle(Duration::from_secs(600)));
    let mut ext = Vec::new();
    for run in 0..runs {
        let p = &files[(run * 211) % files.len()];
        let rel = p.strip_prefix(&root).expect("rel").to_string_lossy().to_string();
        let word = format!("perfzmena{}", "x".repeat(run + 1));
        let mut text = fs::read(p).expect("read");
        text.extend_from_slice(format!("\n{word}\n").as_bytes());
        let t = Instant::now();
        fs::write(p, text).expect("write");
        loop {
            let hit = core.search(&SearchQuery::text(&word, PRAGUE)).map(|r| r.results.iter().any(|x| x.path == rel)).unwrap_or(false);
            if hit || t.elapsed() > Duration::from_secs(10) {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        ext.push(t.elapsed());
    }
    row("NFR-PERF-08", "external change searchable", ext, 2_000.0, 0.75);
    let _ = core.read_note(&files[0].strip_prefix(&root).expect("rel").to_string_lossy(), SystemTime::now());
    drop(core);

    let all_pass = rows.iter().all(|r| r["pass"] == true);
    if let Some(out) = out {
        if let Some(dir) = out.parent() {
            fs::create_dir_all(dir).expect("out dir");
        }
        fs::write(&out, serde_json::to_string_pretty(&json!({ "notes": files.len(), "runs": runs, "metrics": rows })).expect("json")).expect("write out");
    }
    if !all_pass {
        std::process::exit(1);
    }
}
