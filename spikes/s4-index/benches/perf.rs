//! Criterion benchmarks for the nightly trend (S4-QA AC-2, test-strategy §9): NFR-PERF-02, -03,
//! -04, -07, -08 on the reference vault. Pass/fail against targets is `src/bin/perf.rs` (p95);
//! criterion tracks regressions between runs.
//!
//! Vault: `$S4_BENCH_VAULT`, or generated once (seed 1, 1 KB images: the index never reads image
//! bytes, so Markdown is identical to the reference vault) into `target/bench-vault`.

use std::fs;
use std::path::PathBuf;
use std::sync::mpsc::channel;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use criterion::{criterion_group, criterion_main, Criterion};
use s4_index::index::{walk_notes, Index};
use s4_index::watch::watch;

fn vault() -> PathBuf {
    if let Ok(v) = std::env::var("S4_BENCH_VAULT") {
        return PathBuf::from(v);
    }
    let v = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/bench-vault");
    if !v.join(".tegg/vault.yml").exists() {
        let _ = fs::remove_dir_all(&v);
        let mut o = gen_vault::Options::reference(1);
        o.full_images = false;
        gen_vault::generate(&v, &o).unwrap();
    }
    v
}

fn benches(c: &mut Criterion) {
    let vault = vault();
    let dir = tempfile::tempdir().unwrap();

    let mut g = c.benchmark_group("index");
    g.sample_size(10).measurement_time(Duration::from_secs(20));
    g.bench_function("nfr_perf_02_full_index", |b| {
        let mut i = 0;
        b.iter(|| {
            i += 1;
            let mut ix = Index::open(&vault, &dir.path().join(format!("full-{i}.db"))).unwrap();
            ix.rebuild().unwrap()
        })
    });
    g.finish();

    let mut ix = Index::open(&vault, &dir.path().join("main.db")).unwrap();
    ix.rebuild().unwrap();

    c.bench_function("nfr_perf_03_switcher_keystroke_zlutoucky", |b| {
        let prefixes: Vec<String> = (1..=9).map(|k| "zlutoucky".chars().take(k).collect()).collect();
        let mut k = 0;
        b.iter(|| {
            k = (k + 1) % prefixes.len();
            ix.switcher.query(&prefixes[k], 50).len()
        })
    });
    c.bench_function("nfr_perf_04_search_word", |b| b.iter(|| ix.search("rozpočet", None).unwrap().len()));
    c.bench_function("nfr_perf_04_search_phrase", |b| b.iter(|| ix.search("\"feedback loop\"", None).unwrap().len()));
    c.bench_function("nfr_perf_04_search_type_filter", |b| b.iter(|| ix.search("plán", Some("Project")).unwrap().len()));
    c.bench_function("nfr_perf_07_query_view_1000", |b| b.iter(|| ix.query_view(&["Page", "Task", "Idea"], 1000).unwrap().len()));

    // NFR-PERF-08: one external atomic replace → index reflects it.
    let files = walk_notes(&vault);
    let ix = Arc::new(Mutex::new(ix));
    let (tx, rx) = channel();
    let _w = watch(ix.clone(), tx).unwrap();
    std::thread::sleep(Duration::from_millis(500));
    let mut g = c.benchmark_group("watch");
    g.sample_size(10).measurement_time(Duration::from_secs(30));
    g.bench_function("nfr_perf_08_external_change", |b| {
        let mut n = 0usize;
        b.iter_custom(|iters| {
            let mut total = Duration::ZERO;
            for _ in 0..iters {
                n += 1;
                let f = &files[(n * 131) % files.len()];
                let original = fs::read(f).unwrap();
                let marker = format!("benchmarker{n}x");
                let tmp = f.with_file_name(".bench.tmp");
                fs::write(&tmp, [&original[..], format!("\n{marker}\n").as_bytes()].concat()).unwrap();
                let t = Instant::now();
                fs::rename(&tmp, f).unwrap();
                while ix.lock().unwrap().search(&marker, None).unwrap().is_empty() {
                    rx.recv_timeout(Duration::from_secs(10)).expect("index update");
                }
                total += t.elapsed();
                fs::write(f, &original).unwrap();
                while rx.recv_timeout(Duration::from_millis(200)).is_ok() {}
            }
            total
        })
    });
    g.finish();
}

criterion_group!(perf, benches);
criterion_main!(perf);
