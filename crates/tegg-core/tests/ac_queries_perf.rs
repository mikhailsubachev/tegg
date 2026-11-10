//! Slice Q L4 benchmarks (docs/acceptance/queries.md NFR-PERF-05 AC-5, NFR-PERF-07 AC-2; docs/contracts/v1-queries.md
//! §1.5, §1.6, §6.1) on the generated 5,000-note vault (`tools/gen-vault --seed 1 --small-images`), copied, with runtime
//! notes added:
//! - a 2,000-word note with five reference blocks (List and Table, 10…200 results each): opening it (read + the fences)
//!   and running every block, p95 within 112 ms (75 % of 150 ms, D-59), each block's `query_run` within 225 ms p95;
//! - a query with ≥ 1,000 results: one `query_run`, p95 ≤ 100 ms.
//! Times are printed and asserted in release builds (`common::target`: ×10 in debug builds), the results always. Skipped
//! at push by `--skip nfr_perf_` (contract §6.1). Written from the ACs and the contract only (D-61).

mod common;
mod queries_setup;

use std::time::{Duration, Instant, SystemTime};

use common::{indexable_notes, p95, reference_vault_copy, sandbox, target};
use queries_setup::{def, env, f};
use serde_json::json;
use tegg_core::queries_q::{Op, QuerySource, View};
use tegg_core::{Core, CoreOptions};

fn open(root: &std::path::Path, dirs: &tegg_core::AppDirs) -> Core {
    let core = match Core::open(root, dirs, CoreOptions { watch: false, sync: None }) {
        Ok(c) => c,
        Err(e) => panic!("setup: open: {e:?}"),
    };
    let _ = core.wait_idle(Duration::from_secs(600));
    core
}

/// Runtime notes for the blocks: `n` tasks tagged `perf-<tag>` (so a block has exactly `n` results).
fn add_tagged(root: &std::path::Path, tag: &str, n: usize) {
    std::fs::create_dir_all(root.join("Tasks")).expect("setup: Tasks");
    for i in 0..n {
        let text = format!("---\ntype: task\ntitle: Výkon {tag} {i:03}\nstatus: To do\ndue: 2026-11-{:02}\ntags: [perf-{tag}]\n---\nÚkol pro měření.\n", 1 + i % 28);
        std::fs::write(root.join(format!("Tasks/Výkon {tag} {i:03}.md")), text).expect("setup: task");
    }
}
fn query_file(name: &str, tag: &str, view: &str) -> String {
    format!("version: 1\ntitle: {name}\ntypes: [task]\nmatch: all\nfilters:\n  - tags: {{ has_any_of: [perf-{tag}] }}\nsort: {{ by: due, order: asc }}\nlimit: 50\nview: {view}\ncolumns: [status, due, modified]\n")
}

#[test]
fn nfr_perf_05_ac5_note_with_query_blocks() {
    let sb = sandbox();
    let root = reference_vault_copy(&sb);
    std::fs::create_dir_all(root.join(".tegg/queries")).expect("setup: queries dir");
    let blocks = [("Výkon a", "a", 10, "list"), ("Výkon b", "b", 50, "table"), ("Výkon c", "c", 100, "list"), ("Výkon d", "d", 150, "table"), ("Výkon e", "e", 200, "table")];
    for (name, tag, n, view) in blocks {
        add_tagged(&root, tag, n);
        std::fs::write(root.join(format!(".tegg/queries/{name}.yml")), query_file(name, tag, view)).expect("setup: query file");
    }
    let words: Vec<&str> = "účetní rozpočet výjezd plán šablona zápis čajovna žluťoučký kůň úpěl ďábelské ódy".split(' ').collect();
    let mut body = String::from("---\ntype: page\ntitle: Dlouhá stránka s dotazy\n---\n");
    for p in 0..5 {
        let para: Vec<&str> = (0..400).map(|i| words[(i * 7 + p) % words.len()]).collect();
        body.push_str(&para.join(" "));
        body.push_str(&format!("\n\n```query\nsaved: {}\n```\n\n", blocks[p].0));
    }
    let note = "Pages/Dlouhá stránka s dotazy.md";
    std::fs::write(root.join(note), &body).expect("setup: the note");
    let core = open(&root, &sb.dirs);
    let mut open_samples = Vec::new();
    let mut block_samples = Vec::new();
    let mut counts = Vec::new();
    for _ in 0..20 {
        let t0 = Instant::now();
        let (bytes, _) = match core.read_note(note, SystemTime::now()) {
            Ok(r) => r,
            Err(e) => panic!("setup: read the note: {e:?}"),
        };
        let text = String::from_utf8(bytes).unwrap_or_default();
        let fences = tegg_format::query_fences(&text);
        counts = Vec::new();
        for fe in &fences {
            let t1 = Instant::now();
            let r = core.query_run(QuerySource::Fence(fe.body.clone()), Some(note), &env());
            block_samples.push(t1.elapsed());
            counts.push(r.rows.len());
        }
        open_samples.push(t0.elapsed());
    }
    assert_eq!(counts, vec![10, 50, 100, 150, 200], "five blocks with 10…200 results each");
    let (po, pb) = (p95(&mut open_samples), p95(&mut block_samples));
    println!("NFR-PERF-05 AC-5: note + five blocks p95 = {po:?} (target 112 ms), one block p95 = {pb:?} (target 225 ms)");
    assert!(po <= target(Duration::from_millis(150), 0.75), "note with blocks p95 {po:?}");
    assert!(pb <= target(Duration::from_millis(300), 0.75), "one block p95 {pb:?}");
}

#[test]
fn nfr_perf_07_ac2_query_view_1000_results() {
    let sb = sandbox();
    let root = reference_vault_copy(&sb);
    assert!(indexable_notes(&root).len() >= 1000, "setup: the reference vault has notes");
    let core = open(&root, &sb.dirs);
    let mut d = def(&[], vec![f("title", Op::IsNotEmpty, json!(true))]);
    d.view = View::Table;
    d.columns = vec!["type".into(), "tags".into(), "modified".into()];
    let first = core.query_run(QuerySource::Def { def: d.clone(), name: None }, None, &env());
    assert!(first.rows.len() >= 1000, "at least 1,000 results ({})", first.rows.len());
    let mut samples: Vec<Duration> = (0..20)
        .map(|_| {
            let t = Instant::now();
            let _ = core.query_run(QuerySource::Def { def: d.clone(), name: None }, None, &env());
            t.elapsed()
        })
        .collect();
    let p = p95(&mut samples);
    println!("NFR-PERF-07 AC-2: query_run with {} results p95 = {p:?} (target 100 ms)", first.rows.len());
    assert!(p <= target(Duration::from_millis(100), 1.0), "query_run p95 {p:?} ≤ 100 ms");
}
