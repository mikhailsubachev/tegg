//! MS2 AC tests on the reference vault (gen-vault `--seed 1`, small images; contract §4): progress and cancel
//! (FR-UX-07 AC-1…AC-3), rebuildable index (FR-STO-07 AC-2/AC-3), and the core-level parts of NFR-PERF-02,
//! -03, -04, -08 (FR-NAV-01 AC-9, FR-SRC-01 AC-11). Release builds assert the D-59 reference targets; debug
//! builds assert BRD target × 10 and print the measurement.

mod common;

use std::path::Path;
use std::sync::mpsc::Receiver;
use std::time::{Duration, Instant, SystemTime};

use common::*;
use tegg_core::{Core, CoreEvent, CoreOptions, ProgressState, SearchQuery};
use tegg_vault::AppDirs;

const PRAGUE: chrono_tz::Tz = chrono_tz::Europe::Prague;

macro_rules! ok {
    ($e:expr, $what:expr) => {
        match $e {
            Ok(v) => v,
            Err(e) => {
                assert!(false, "{} failed: {:?}", $what, e);
                unreachable!()
            }
        }
    };
}

fn open(root: &Path, dirs: &AppDirs, watch: bool) -> (Core, Receiver<CoreEvent>) {
    let core = ok!(Core::open(root, dirs, CoreOptions { watch, sync: None }), "Core::open");
    let rx = core.events();
    (core, rx)
}

fn open_idle(root: &Path, dirs: &AppDirs, watch: bool) -> Core {
    let (core, _rx) = open(root, dirs, watch);
    assert!(core.wait_idle(Duration::from_secs(600)), "indexing did not finish");
    core
}

fn report(metric: &str, value: Duration, limit: Duration) {
    println!("{metric}: {:.1} ms (limit {:.1} ms, {})", value.as_secs_f64() * 1e3, limit.as_secs_f64() * 1e3, if cfg!(debug_assertions) { "debug" } else { "release" });
}

fn progress(e: &CoreEvent) -> Option<(usize, usize, ProgressState)> {
    if let CoreEvent::IndexProgress { done, total, state } = e {
        Some((*done, *total, *state))
    } else {
        None
    }
}

// ---------------------------------------------------------------- FR-UX-07

#[test]
fn fr_ux_07_ac1_index_progress_events_are_monotonic_and_frequent() {
    let vault = reference_vault();
    let expected = indexable_notes(&vault).len();
    let sb = sandbox();
    let t0 = Instant::now();
    let (core, rx) = open(&vault, &sb.dirs, false);
    let mut seen: Vec<(Instant, usize, usize, ProgressState)> = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(600);
    while Instant::now() < deadline {
        match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(e) => {
                if let Some((d, t, s)) = progress(&e) {
                    seen.push((Instant::now(), d, t, s));
                    if s != ProgressState::Running {
                        break;
                    }
                }
            }
            Err(_) => break,
        }
    }
    assert!(seen.len() >= 2, "progress events: {}", seen.len());
    let last = seen[seen.len() - 1];
    assert_eq!((last.1, last.2, last.3), (expected, expected, ProgressState::Done));
    assert!(seen.windows(2).all(|w| w[1].1 >= w[0].1), "done never decreases");
    assert!(seen.iter().all(|e| e.2 == expected), "total is fixed once known");
    let mut gaps: Vec<Duration> = vec![seen[0].0 - t0];
    gaps.extend(seen.windows(2).map(|w| w[1].0 - w[0].0));
    let max_gap = gaps.iter().copied().max().unwrap_or_default();
    report("FR-UX-07 max gap between progress events", max_gap, Duration::from_millis(500));
    assert!(max_gap <= Duration::from_millis(500), "an event at least every 500 ms (D-110): max gap {max_gap:?}");
    drop(core);
}

#[test]
fn fr_ux_07_ac2_switcher_and_read_stay_responsive_during_indexing() {
    let vault = reference_vault();
    let notes = indexable_notes(&vault);
    let sb = sandbox();
    let (core, rx) = open(&vault, &sb.dirs, false);
    let limit = target(Duration::from_millis(100), 0.75);
    let mut lat = Vec::new();
    let mut partial_results = false;
    let mut running_seen = false;
    let mut i = 0;
    let start = Instant::now();
    let deadline = start + Duration::from_secs(600);
    'outer: while Instant::now() < deadline {
        if !running_seen && start.elapsed() > Duration::from_secs(10) {
            break; // no progress at all: fail on the assertions below
        }
        while let Ok(e) = rx.try_recv() {
            match progress(&e) {
                Some((_, _, ProgressState::Running)) => running_seen = true,
                Some(_) => break 'outer,
                None => {}
            }
        }
        let t = Instant::now();
        let items = core.switcher("", 20);
        lat.push(t.elapsed());
        if running_seen && !items.is_empty() {
            partial_results = true;
        }
        let t = Instant::now();
        let r = core.read_note(&notes[i % notes.len()], SystemTime::now());
        lat.push(t.elapsed());
        assert!(r.is_ok(), "read_note during indexing: {:?}", r.err());
        i += 1;
    }
    assert!(running_seen, "indexing reported Running progress");
    assert!(lat.len() >= 4, "samples taken while indexing: {}", lat.len());
    let p = p95(&mut lat);
    report("FR-UX-07 AC-2 p95 switcher/read during indexing", p, limit);
    assert!(p < limit, "p95 {p:?} ≥ {limit:?}");
    assert!(partial_results, "the switcher returns the files indexed so far");
}

#[test]
fn fr_ux_07_ac3_cancel_stops_indexing_within_1_s_and_resumes_on_next_open() {
    let vault = reference_vault();
    let expected = indexable_notes(&vault).len();
    let digest = tree_digest(&vault);
    let sb = sandbox();
    let (core, rx) = open(&vault, &sb.dirs, false);
    let first = rx.recv_timeout(Duration::from_secs(5)).ok().and_then(|e| progress(&e));
    assert!(matches!(first, Some((_, _, ProgressState::Running))), "first progress event: {first:?}");
    let t0 = Instant::now();
    core.cancel_indexing();
    let mut final_state = None;
    while let Ok(e) = rx.recv_timeout(Duration::from_secs(2)) {
        if let Some((d, t, s)) = progress(&e) {
            if s != ProgressState::Running {
                final_state = Some((d, t, s, t0.elapsed()));
                break;
            }
        }
    }
    let Some((done, total, state, took)) = final_state else {
        assert!(false, "no final progress event after cancel");
        return;
    };
    assert_eq!(state, ProgressState::Cancelled);
    assert!(done < total, "cancelled before the end: {done}/{total}");
    assert!(took <= Duration::from_secs(1), "stopped in {took:?}");
    drop(core);
    assert_eq!(tree_digest(&vault), digest, "vault byte-identical");

    let core = open_idle(&vault, &sb.dirs, false);
    assert_eq!(core.objects().len(), expected, "indexing resumed and completed on the next open");
}

// ---------------------------------------------------------------- FR-STO-07 / AR-01

fn state(core: &Core) -> (String, Vec<String>) {
    let queries = ["rozpočet", "\"žluťoučký kůň\"", "reka", "rozpcoet", "-"];
    let results = queries
        .iter()
        .map(|t| {
            let p = core.search(&SearchQuery::text(t, PRAGUE)).map(|p| (p.total, p.results.into_iter().map(|r| r.path).collect::<Vec<_>>()));
            format!("{t}: {p:?}")
        })
        .collect();
    (core.snapshot(), results)
}

#[test]
fn fr_sto_07_ac2_deleting_the_index_gives_the_same_state() {
    let vault = reference_vault();
    let expected = indexable_notes(&vault).len();
    let sb = sandbox();
    let core = open_idle(&vault, &sb.dirs, false);
    assert_eq!(core.objects().len(), expected, "positive control");
    let before = state(&core);
    assert!(!before.0.is_empty());
    let objects = core.objects();
    let local = core.vault().local_dir();
    drop(core);
    ok!(std::fs::remove_dir_all(&local), "delete index");
    let core = open_idle(&vault, &sb.dirs, false);
    assert_eq!(core.objects(), objects);
    let after = state(&core);
    assert!(after.0 == before.0, "snapshot differs after rebuild");
    assert_eq!(after.1, before.1);
}

#[test]
fn fr_sto_07_ac3_full_rebuild_runs_in_the_background() {
    let vault = reference_vault();
    let notes = indexable_notes(&vault);
    let sb = sandbox();
    let (core, rx) = open(&vault, &sb.dirs, false);
    // `open` returned: the rebuild still runs, and calls are answered meanwhile.
    let limit = target(Duration::from_millis(100), 0.75);
    let mut lat = Vec::new();
    let mut running_after_open = false;
    let start = Instant::now();
    let deadline = start + Duration::from_secs(600);
    'outer: while Instant::now() < deadline {
        if !running_after_open && start.elapsed() > Duration::from_secs(10) {
            break; // no progress at all: fail on the assertions below
        }
        while let Ok(e) = rx.try_recv() {
            match progress(&e) {
                Some((d, t, ProgressState::Running)) if d < t => running_after_open = true,
                Some((_, _, ProgressState::Running)) => {}
                Some(_) => break 'outer,
                None => {}
            }
        }
        let t = Instant::now();
        let _ = core.switcher("řeka", 20);
        let _ = core.read_note(&notes[lat.len() % notes.len()], SystemTime::now());
        lat.push(t.elapsed());
    }
    assert!(running_after_open, "Core::open returns before the rebuild is done");
    let p = p95(&mut lat);
    report("FR-STO-07 AC-3 p95 calls during rebuild", p, limit);
    assert!(p < limit);
}

// ---------------------------------------------------------------- NFR-PERF-02

#[test]
fn nfr_perf_02_ac1_full_index_of_the_reference_vault() {
    let vault = reference_vault();
    let expected = indexable_notes(&vault).len();
    let sb = sandbox();
    let limit = target(Duration::from_secs(30), 0.6);
    let t0 = Instant::now();
    let (core, _rx) = open(&vault, &sb.dirs, false);
    let idle = core.wait_idle(limit);
    let took = t0.elapsed();
    report("NFR-PERF-02 full index", took, limit);
    assert!(idle && took < limit, "full index took {took:?} (idle: {idle})");
    assert_eq!(core.objects().len(), expected);
}

#[test]
fn nfr_perf_02_ac2_reopen_with_100_offline_changes() {
    let sb = sandbox();
    let vault = reference_vault_copy(&sb);
    let notes = indexable_notes(&vault);
    let core = open_idle(&vault, &sb.dirs, false);
    assert_eq!(core.objects().len(), notes.len(), "positive control");
    drop(core);
    for p in notes.iter().step_by(notes.len() / 100).take(100) {
        let mut text = std::fs::read(vault.join(p)).unwrap_or_default();
        text.extend_from_slice("\nZměněno offline: vlaštovičník.\n".as_bytes());
        std::fs::write(vault.join(p), text).unwrap_or(());
    }
    let limit = target(Duration::from_secs(3), 0.75);
    let t0 = Instant::now();
    let (core, _rx) = open(&vault, &sb.dirs, false);
    let idle = core.wait_idle(limit);
    let took = t0.elapsed();
    report("NFR-PERF-02 AC-2 reopen with 100 changes", took, limit);
    assert!(idle && took < limit, "took {took:?} (idle: {idle})");
    let total = core.search(&SearchQuery::text("vlaštovičník", PRAGUE)).map(|p| p.total).unwrap_or(0);
    assert_eq!(total, 100);
}

// ---------------------------------------------------------------- NFR-PERF-03 / FR-NAV-01 AC-9

fn switcher_keystrokes_p95(core: &Core) -> Duration {
    let queries = ["c", "ct", "cteni", "rozpočet 2026", "zzzzzzzzzz"];
    let mut lat = Vec::new();
    for _ in 0..20 {
        for q in queries {
            let chars: Vec<char> = q.chars().collect();
            for n in 1..=chars.len() {
                let typed: String = chars[..n].iter().collect();
                let t = Instant::now();
                let _ = core.switcher(&typed, 50);
                lat.push(t.elapsed());
            }
        }
    }
    p95(&mut lat)
}

#[test]
fn nfr_perf_03_ac1_switcher_per_keystroke_at_the_core() {
    let vault = reference_vault();
    let sb = sandbox();
    let core = open_idle(&vault, &sb.dirs, false);
    assert!(!core.switcher("c", 50).is_empty(), "positive control");
    let limit = target(Duration::from_millis(100), 0.75);
    let p = switcher_keystrokes_p95(&core);
    report("NFR-PERF-03 switcher p95", p, limit);
    assert!(p < limit, "p95 {p:?}");
}

#[test]
fn fr_nav_01_ac9_switcher_keystrokes_under_target_on_the_reference_vault() {
    let vault = reference_vault();
    let sb = sandbox();
    let core = open_idle(&vault, &sb.dirs, false);
    let limit = target(Duration::from_millis(100), 0.75);
    assert!(core.switcher("cteni", 50).iter().any(|i| i.path.is_some()), "positive control");
    let p = switcher_keystrokes_p95(&core);
    report("FR-NAV-01 AC-9 switcher p95", p, limit);
    assert!(p < limit, "p95 {p:?}");
}

// ---------------------------------------------------------------- NFR-PERF-04 / FR-SRC-01 AC-11

fn search_p95(core: &Core) -> Duration {
    let first_type = core.objects().first().map(|o| o.r#type.clone()).unwrap_or_default();
    let mut typed = SearchQuery::text("řeka", PRAGUE);
    typed.types = vec![first_type];
    let queries = vec![
        SearchQuery::text("rozpočet", PRAGUE),
        SearchQuery::text("reka", PRAGUE),
        SearchQuery::text("\"žluťoučký kůň\"", PRAGUE),
        typed,
    ];
    let mut lat = Vec::new();
    for _ in 0..20 {
        for q in &queries {
            let t = Instant::now();
            let _ = core.search(q);
            lat.push(t.elapsed());
        }
    }
    p95(&mut lat)
}

fn assert_search_positive(core: &Core) {
    let p = ok!(core.search(&SearchQuery::text("rozpočet", PRAGUE)), "search");
    assert_eq!(p.results.len(), 50.min(p.total), "first page of 50");
    assert!(p.total > 50, "the reference vault has many hits: {}", p.total);
    assert!(p.results.iter().filter(|r| r.snippet.is_some()).count() >= 25, "results carry snippets");
}

#[test]
fn nfr_perf_04_ac1_search_with_snippets_at_the_core() {
    let vault = reference_vault();
    let sb = sandbox();
    let core = open_idle(&vault, &sb.dirs, false);
    assert_search_positive(&core);
    let limit = target(Duration::from_millis(200), 0.75);
    let p = search_p95(&core);
    report("NFR-PERF-04 search p95", p, limit);
    assert!(p < limit, "p95 {p:?}");
}

#[test]
fn fr_src_01_ac11_first_50_hits_with_snippets_within_target() {
    let vault = reference_vault();
    let sb = sandbox();
    let core = open_idle(&vault, &sb.dirs, false);
    assert_search_positive(&core);
    let limit = target(Duration::from_millis(200), 0.75);
    let p = search_p95(&core);
    report("FR-SRC-01 AC-11 search p95", p, limit);
    assert!(p < limit, "p95 {p:?}");
}

// ---------------------------------------------------------------- NFR-PERF-08

#[test]
fn nfr_perf_08_ac1_external_change_reflected_on_the_reference_vault() {
    let sb = sandbox();
    let vault = reference_vault_copy(&sb);
    let notes = indexable_notes(&vault);
    let core = open_idle(&vault, &sb.dirs, true);
    let limit = target(Duration::from_secs(2), 0.75);
    let words = ["ambroziový", "bazalkový", "cesmínový", "drnavcový", "estragonový"];
    let mut lat = Vec::new();
    for run in 0..20 {
        let p = &notes[(run * 211) % notes.len()];
        let word = format!("{}{}", words[run % words.len()], "x".repeat(run + 1));
        let mut text = std::fs::read(vault.join(p)).unwrap_or_default();
        text.extend_from_slice(format!("\n{word}\n").as_bytes());
        let t = Instant::now();
        std::fs::write(vault.join(p), text).unwrap_or(());
        let seen = wait_until(limit, || {
            core.search(&SearchQuery::text(&word, PRAGUE)).map(|r| r.results.iter().any(|x| &x.path == p)).unwrap_or(false)
        });
        assert!(seen.is_some(), "run {run}: change to {p} not reflected within {limit:?}");
        lat.push(t.elapsed());
    }
    let p = p95(&mut lat);
    report("NFR-PERF-08 external change p95", p, limit);
    assert!(p < limit);
}
