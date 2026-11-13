//! Slice I1, L4: progress and cancel (docs/acceptance/import-capacities.md FR-IMP-07 AC-3, FR-UX-07 AC-13, AC-16 (the
//! job part); docs/contracts/v1-import.md §9.1, §10; D-110, D-1554). The 120 MB export is generated at test time
//! (`common::generated_export`, fixed seed). Two tests run nightly only (their `nfr_perf_` prefix keeps them out of
//! the push step, D-343): the latency sentence of FR-UX-07 AC-13 and D-1541's report-only timings. Tests wait for
//! states (points, flags, final reports), never for a fixed time. Written from the criteria and the contract only
//! (D-61); every check is an assertion in this file.

mod common;

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use common::*;
use tegg_import::{Control, ImportError, ImportPhase, ImportPoint, ImportProgress, Mapping, PointAction, Target};
use tegg_jobs::Phase;

const MB: u64 = 1_000_000;
const SEED: u64 = 20261112;

type Events = Arc<Mutex<Vec<(Instant, ImportProgress)>>>;
fn sink(events: &Events) -> Arc<dyn Fn(&ImportProgress) + Send + Sync> {
    let e = events.clone();
    Arc::new(move |p: &ImportProgress| e.lock().unwrap_or_else(|x| x.into_inner()).push((Instant::now(), p.clone())))
}
fn taken(events: &Events) -> Vec<(Instant, ImportProgress)> {
    events.lock().unwrap_or_else(|x| x.into_inner()).clone()
}
/// The rules of §10.2 on a list of events between `from` and `to`: phases in order, `done` never decreasing and
/// `total` fixed once known within a phase, and no gap above 500 ms.
fn check_events(events: &[(Instant, ImportProgress)], from: Instant, to: Instant, what: &str) {
    assert!(!events.is_empty(), "{what}: progress events were emitted");
    let rank = |p: &ImportPhase| match p {
        ImportPhase::Reading => 0,
        ImportPhase::Planning => 1,
        ImportPhase::Backup => 2,
        ImportPhase::Writing => 3,
        ImportPhase::Done | ImportPhase::Cancelled | ImportPhase::Failed => 4,
    };
    let mut last = from;
    let mut prev: Option<&ImportProgress> = None;
    for (at, e) in events {
        assert!(at.duration_since(last) <= Duration::from_millis(500), "{what}: at least one event per 500 ms (a gap of {:?} before {e:?})", at.duration_since(last));
        last = *at;
        assert!(e.done <= e.total || e.total == 0, "{what}: done ≤ total: {e:?}");
        if let Some(p) = prev {
            assert!(rank(&e.phase) >= rank(&p.phase), "{what}: phases never go back: {:?} after {:?}", e.phase, p.phase);
            if e.phase == p.phase {
                assert!(e.done >= p.done, "{what}: `done` never decreases within a phase: {} after {}", e.done, p.done);
                assert!(p.total == 0 || e.total == p.total, "{what}: `total` is fixed once known: {} after {}", e.total, p.total);
            }
        }
        prev = Some(e);
    }
    assert!(to.duration_since(last) <= Duration::from_millis(500), "{what}: the last event came within 500 ms of the end");
}
/// The generated 120 MB export (300 notes and media files), as a folder.
fn big_export(sb: &Sandbox) -> PathBuf {
    generated_export(sb, "velký export", 300, 120 * MB, SEED)
}
fn second_vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Druhý trezor");
    copy_dir(&repo_root().join("tests/fixtures/vaults/new-empty/.tegg"), &root.join(".tegg"), &[]);
    copy_dir(&fixtures().join("target-existing-vault"), &root, &[]);
    root
}

#[test]
fn fr_imp_07_ac3_a_large_zip_reports_progress_and_can_be_cancelled() {
    let sb = sandbox();
    let dir = big_export(&sb);
    let mut entries = entries_of(&dir, "");
    entries.iter_mut().for_each(|e| e.deflate = false);
    let total_files = entries.len() as u64;
    let zip = sb.base.join("zipy").join("velký export.zip");
    write_zip(&zip, &entries);
    drop(entries);
    assert_setup(std::fs::metadata(&zip).map(|m| m.len()).unwrap_or(0) > 100 * MB, "the zip is over 100 MB");
    let env = ok!(env(&sb), "env");
    let root = existing_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs), "open the existing vault");
    let before = (snapshot(&root), snapshot(&sb.place()));

    // Reading: files processed / total.
    let events: Events = Arc::default();
    let t0 = Instant::now();
    let scan = ok!(tegg_import::scan(&zip, &env, &Control { cancel: Default::default(), progress: Some(sink(&events)) }), "scan the 120 MB zip");
    let got = taken(&events);
    check_events(&got, t0, Instant::now(), "reading");
    assert!(got.iter().all(|(_, e)| e.phase == ImportPhase::Reading), "scan emits `reading` events");
    assert_eq!(got.last().map(|(_, e)| (e.done, e.total)), Some((total_files, total_files)), "the last event has done == total == the number of files");
    assert_eq!(scan.info.files as u64, total_files, "the scan read every file");
    // Planning: notes processed / total.
    let events: Events = Arc::default();
    let t0 = Instant::now();
    let plan = ok!(tegg_import::plan(&scan, SPACE, &Target::Existing(&core), &Mapping::default(), &env, &Control { cancel: Default::default(), progress: Some(sink(&events)) }), "plan it");
    let got = taken(&events);
    check_events(&got, t0, Instant::now(), "planning");
    assert!(got.iter().all(|(_, e)| e.phase == ImportPhase::Planning), "plan emits `planning` events");
    assert_eq!(got.last().map(|(_, e)| (e.done, e.total)), Some((300, 300)), "done == total == the number of notes");
    assert_eq!(plan.objects.iter().filter(|o| o.kind == tegg_import::ObjectKind::Note).count(), 300, "the plan has the 300 notes");

    // Cancel while reading and while planning: within 1 s, a final `cancelled` event, nothing written.
    for phase in ["reading", "planning"] {
        let events: Events = Arc::default();
        let cancel = tegg_import::CancelToken::new();
        let (c, e, at) = (cancel.clone(), events.clone(), Arc::new(Mutex::new(None::<Instant>)));
        let a = at.clone();
        let progress: Arc<dyn Fn(&ImportProgress) + Send + Sync> = Arc::new(move |p: &ImportProgress| {
            e.lock().unwrap_or_else(|x| x.into_inner()).push((Instant::now(), p.clone()));
            // Cancel on the phase's first progress event (D-1567): a fast scan or plan can finish within one
            // 100 ms progress interval, so a later event may already be the last step.
            if !c.is_cancelled() {
                c.cancel();
                *a.lock().unwrap_or_else(|x| x.into_inner()) = Some(Instant::now());
            }
        });
        let ctl = Control { cancel, progress: Some(progress) };
        let err = if phase == "reading" { tegg_import::scan(&zip, &env, &ctl).err() } else { tegg_import::plan(&scan, SPACE, &Target::Existing(&core), &Mapping::default(), &env, &ctl).err() };
        let ended = Instant::now();
        assert_eq!(err, Some(ImportError::Cancelled), "{phase}: the call ends with Cancelled");
        let cancelled_at = some!(*at.lock().unwrap_or_else(|x| x.into_inner()), format!("{phase}: the cancel was sent during the call"));
        assert!(ended.duration_since(cancelled_at) <= Duration::from_secs(1), "{phase}: it stops within 1 s: {:?}", ended.duration_since(cancelled_at));
        assert_eq!(taken(&events).last().map(|(_, e)| e.phase.clone()), Some(ImportPhase::Cancelled), "{phase}: the final event is `cancelled`");
        assert_eq!((snapshot(&root), snapshot(&sb.place())), before, "{phase}: cancelling before the write phase leaves the vault and the place untouched");
    }
    assert_eq!(import_backups(&sb.dirs), Vec::<PathBuf>::new(), "no backup was made");
}

#[test]
fn fr_ux_07_ac13_import_progress_and_cancel() {
    let sb = sandbox();
    let dir = big_export(&sb);
    let root = existing_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs), "open the existing vault");
    let before = snapshot(&root);
    let plain = ok!(env(&sb), "env");
    let scan = ok!(scan_of(&dir, &plain), "scan the generated export");
    let target = Target::Existing(&core);
    let plan = ok!(plan_of(&scan, SPACE, &target, &Mapping::default(), &plain), "plan it");

    // Cancel in `planning` (at `Rendered`, still cancellable): within 1 s, final `cancelled`, nothing written.
    let mut env = plain.clone();
    let (reached, go) = (Arc::new(AtomicBool::new(false)), Arc::new(AtomicBool::new(false)));
    let (r, g) = (reached.clone(), go.clone());
    env.points = Some(Arc::new(move |p: &ImportPoint| {
        if matches!(p, ImportPoint::Rendered) {
            r.store(true, Ordering::SeqCst);
            wait_until(Duration::from_secs(60), || g.load(Ordering::SeqCst));
        }
        PointAction::Continue
    }));
    let events: Events = Arc::default();
    let run = ok!(tegg_import::start(plan.clone(), &scan, &target, &env), "start");
    run.on_progress(sink(&events));
    assert!(wait_until(Duration::from_secs(120), || reached.load(Ordering::SeqCst)), "the run rendered every object");
    let cancelled = run.cancel();
    let t = Instant::now();
    go.store(true, Ordering::SeqCst);
    assert_eq!(cancelled, Ok(()), "cancel is accepted in `planning`");
    let report = some!(run.wait(Duration::from_secs(60)), "the final report");
    assert!(t.elapsed() <= Duration::from_secs(1), "it stops within 1 s: {:?}", t.elapsed());
    assert_eq!((report.phase, report.written.len()), (Phase::Cancelled, 0), "the job ends cancelled, with nothing written");
    assert_eq!(taken(&events).last().map(|(_, e)| e.phase.clone()), Some(ImportPhase::Cancelled), "a final `cancelled` event");
    assert_eq!(snapshot(&root), before, "the vault is untouched");
    assert_eq!(import_backups(&sb.dirs), Vec::<PathBuf>::new(), "and no backup was made");

    // Cancel in `queued`: a second import waits behind the first, is cancelled there and never reaches `planning`.
    let mut first_env = plain.clone();
    let (held, release) = (Arc::new(AtomicBool::new(false)), Arc::new(AtomicBool::new(false)));
    let (h, rl) = (held.clone(), release.clone());
    first_env.points = Some(Arc::new(move |p: &ImportPoint| {
        if matches!(p, ImportPoint::BeforeChecks) {
            h.store(true, Ordering::SeqCst);
            wait_until(Duration::from_secs(120), || rl.load(Ordering::SeqCst));
        }
        PointAction::Continue
    }));
    let small = ok!(scan_of(&fixtures().join("c01-spaces"), &plain), "scan c01");
    let small_plan = ok!(plan_of(&small, SPACE, &target, &Mapping::default(), &plain), "plan c01");
    let first = ok!(tegg_import::start(small_plan.clone(), &small, &target, &first_env), "start the first import");
    assert!(wait_until(Duration::from_secs(60), || held.load(Ordering::SeqCst)), "the first import left the queue");
    let mut second_env = plain.clone();
    let left_queue = Arc::new(AtomicBool::new(false));
    let l = left_queue.clone();
    second_env.points = Some(Arc::new(move |_p: &ImportPoint| {
        l.store(true, Ordering::SeqCst);
        PointAction::Continue
    }));
    let second_events: Events = Arc::default();
    let second = ok!(tegg_import::start(small_plan.clone(), &small, &target, &second_env), "start the second import: it waits in `queued`");
    second.on_progress(sink(&second_events));
    assert_eq!(second.report().map(|r| r.phase), None, "the second import has not ended while the first holds the queue");
    let t = Instant::now();
    assert_eq!(second.cancel(), Ok(()), "cancel is accepted in `queued` (D-1554)");
    let report = some!(second.wait(Duration::from_secs(5)), "the cancelled job's report");
    assert!(t.elapsed() <= Duration::from_secs(1), "it stops within 1 s");
    assert_eq!(report.phase, Phase::Cancelled, "it ends cancelled");
    release.store(true, Ordering::SeqCst);
    assert_eq!(first.wait(Duration::from_secs(120)).map(|r| r.phase), Some(Phase::Done), "the first import finishes");
    assert!(!left_queue.load(Ordering::SeqCst), "the cancelled job never reached `planning`: none of its points was raised");
    assert!(taken(&second_events).iter().all(|(_, e)| e.phase == ImportPhase::Cancelled), "a waiting job emits no `planning` event (§5.1), only the final `cancelled`");
    assert_eq!(added(&before, &snapshot(&root)).len(), 4, "only the first import wrote: three objects and its report");

    // The whole import: events through backup and writing to `done`; cancel during `writing` is NotCancellable.
    let mut env = plain.clone();
    let (reg, registered) = (Arc::new(AtomicBool::new(false)), Arc::new(AtomicBool::new(false)));
    let writing_cancel: Arc<Mutex<Option<Result<(), ImportError>>>> = Arc::default();
    let handle: Arc<Mutex<Option<Arc<tegg_import::ImportRun>>>> = Arc::default();
    let (rg, rd, wc, hd) = (reg.clone(), registered.clone(), writing_cancel.clone(), handle.clone());
    env.points = Some(Arc::new(move |p: &ImportPoint| {
        match p {
            ImportPoint::BeforeChecks => {
                rg.store(true, Ordering::SeqCst);
                wait_until(Duration::from_secs(60), || rd.load(Ordering::SeqCst));
            }
            ImportPoint::Renamed { kind: tegg_import::FileKind::Attachment, .. } => {
                let mut slot = wc.lock().unwrap_or_else(|x| x.into_inner());
                if slot.is_none() {
                    *slot = hd.lock().unwrap_or_else(|x| x.into_inner()).as_ref().map(|r| r.cancel());
                }
            }
            _ => {}
        }
        PointAction::Continue
    }));
    let scan2 = ok!(scan_of(&dir, &plain), "scan again");
    let plan2 = ok!(plan_of(&scan2, SPACE, &target, &Mapping::default(), &plain), "plan again (the vault changed)");
    let events: Events = Arc::default();
    let run = Arc::new(ok!(tegg_import::start(plan2.clone(), &scan2, &target, &env), "start the big import"));
    assert!(wait_until(Duration::from_secs(120), || reg.load(Ordering::SeqCst)), "the job left the queue");
    run.on_progress(sink(&events));
    *handle.lock().unwrap_or_else(|x| x.into_inner()) = Some(run.clone());
    let t0 = Instant::now();
    registered.store(true, Ordering::SeqCst);
    let report = some!(run.wait(Duration::from_secs(600)), "the final report");
    let end = Instant::now();
    assert_eq!(report.phase, Phase::Done, "the import finishes: {:?}", report.error);
    assert_eq!(*writing_cancel.lock().unwrap_or_else(|x| x.into_inner()), Some(Err(ImportError::NotCancellable)), "cancel during `writing` returns NotCancellable, and the import finishes");
    let got = taken(&events);
    check_events(&got, t0, end, "the job");
    let mut phases: Vec<ImportPhase> = got.iter().map(|(_, e)| e.phase.clone()).collect();
    phases.dedup();
    assert_eq!(phases, [ImportPhase::Planning, ImportPhase::Backup, ImportPhase::Writing, ImportPhase::Done], "the job's phases, in order (the vault is not empty, so there is a backup)");
    let (_, last) = some!(got.last().cloned(), "a last event");
    assert_eq!((last.phase.clone(), last.done == last.total, last.counts.clone(), last.job), (ImportPhase::Done, true, Some(plan2.totals.clone()), Some(run.job())), "the last event is `done` with done == total and the counts");
    let writing: Vec<&ImportProgress> = got.iter().map(|(_, e)| e).filter(|e| e.phase == ImportPhase::Writing).collect();
    let files_to_create = report.written.len() as u64;
    assert!(writing.iter().all(|e| e.total == files_to_create && e.step.is_some()), "writing: total is the number of files to create ({files_to_create}), each event names its step");
    assert_eq!(writing.last().map(|e| e.done), Some(files_to_create), "writing ends with done == total");
    let steps: Vec<String> = { let mut s: Vec<String> = writing.iter().map(|e| format!("{:?}", e.step)).collect(); s.dedup(); s };
    assert_eq!(steps, ["Some(Types)", "Some(Attachments)", "Some(Objects)", "Some(Report)"].iter().filter(|s| steps.contains(&s.to_string())).map(|s| s.to_string()).collect::<Vec<_>>(), "the steps come in R149's order: {steps:?}");
    assert!(steps.contains(&"Some(Attachments)".to_string()) && steps.contains(&"Some(Objects)".to_string()) && steps.contains(&"Some(Report)".to_string()), "attachments, objects and the report are steps of this run");
    assert_eq!(touched(&before, &snapshot(&root)), BTreeSet::new(), "the owner's files are untouched");
}

#[test]
fn fr_ux_07_ac16_switching_vaults_during_an_import() {
    let src = fixtures().join("c05-media-objects");
    // Without the switch: the reference.
    let ref_sb = sandbox();
    let ref_root = existing_vault(&ref_sb);
    let ref_core = ok!(open_core(&ref_root, &ref_sb.dirs), "open the reference vault");
    let reference = ok!(import_into(&ref_core, &ref_root, &src, SPACE, &Mapping::default(), &ok!(env(&ref_sb), "env")), "the import without a switch");
    let ref_files: Vec<(String, Vec<u8>)> = snapshot(&ref_root).into_iter().map(|(k, v)| (k, v.bytes)).collect();

    // With the switch: the import is in its write phase when another vault is opened and used.
    let sb = sandbox();
    let root = existing_vault(&sb);
    let other_root = second_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs), "open the target vault");
    let mut env = ok!(env(&sb), "env");
    let (writing, release) = (Arc::new(AtomicBool::new(false)), Arc::new(AtomicBool::new(false)));
    let (w, rl) = (writing.clone(), release.clone());
    env.points = Some(Arc::new(move |p: &ImportPoint| {
        if matches!(p, ImportPoint::Renamed { kind: tegg_import::FileKind::Attachment, .. }) && !w.swap(true, Ordering::SeqCst) {
            wait_until(Duration::from_secs(120), || rl.load(Ordering::SeqCst));
        }
        PointAction::Continue
    }));
    let plain = ok!(common::env(&sb), "env");
    let scan = ok!(scan_of(&src, &plain), "scan");
    let target = Target::Existing(&core);
    let plan = ok!(plan_of(&scan, SPACE, &target, &Mapping::default(), &plain), "plan");
    let run = ok!(tegg_import::start(plan, &scan, &target, &env), "start the import into the open vault");
    assert!(wait_until(Duration::from_secs(120), || writing.load(Ordering::SeqCst)), "the import is in its write phase");
    // The user opens another vault: not blocked, and its jobs don't wait for the import.
    let other_before = snapshot(&other_root);
    let t = Instant::now();
    let other = ok!(open_core(&other_root, &sb.dirs), "open another vault while the import writes");
    let renamed = other.jobs().start(tegg_jobs::JobOp::NoteRename { path: "Pages/Týden.md".into(), title: "Týden jinak".into() });
    let job = ok!(renamed, "start a job in the newly opened vault");
    let done = other.jobs().wait(job, Duration::from_secs(30));
    assert!(done.is_some(), "the other vault's job finishes while the import is still writing: none of its jobs waits for the import");
    assert!(t.elapsed() < Duration::from_secs(30) && run.report().is_none(), "the import is still running meanwhile");
    let other_after = snapshot(&other_root);
    assert!(other_after.contains_key("Pages/Týden jinak.md"), "the other vault's own job did its work");
    let by_import: Vec<String> = added(&other_before, &other_after).into_iter().filter(|p| p != "Pages/Týden jinak.md").collect();
    assert_eq!(by_import, Vec::<String>::new(), "nothing of the import is written in the newly opened vault");
    // The import goes on against its own target and finishes with the same written files as without the switch.
    release.store(true, Ordering::SeqCst);
    let report = some!(run.wait(Duration::from_secs(120)), "the import's final report");
    assert_eq!(report.phase, Phase::Done, "the import finishes: {:?}", report.error);
    assert_eq!(report.written, reference.report.written, "the same written files as without the switch");
    assert_eq!(snapshot(&root).into_iter().map(|(k, v)| (k, v.bytes)).collect::<Vec<_>>(), ref_files, "byte for byte");
    assert_eq!(snapshot(&other_root), other_after, "and still nothing in the other vault");
}

// ------------------------------------------------------------------------------------------------ nightly

fn p95(samples: &mut [Duration]) -> Duration {
    samples.sort();
    samples[((samples.len() as f64 * 0.95).ceil() as usize).clamp(1, samples.len()) - 1]
}

#[test]
fn nfr_perf_fr_ux_07_ac13_open_vault_stays_responsive() {
    let sb = sandbox();
    let dir = big_export(&sb);
    let root = existing_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs), "open the existing vault");
    let env = ok!(env(&sb), "env");
    let scan = ok!(scan_of(&dir, &env), "scan the generated export");
    let target = Target::Existing(&core);
    let plan = ok!(plan_of(&scan, SPACE, &target, &Mapping::default(), &env), "plan it");
    let run = ok!(tegg_import::start(plan, &scan, &target, &env), "start the import into the open vault");
    let (mut switcher, mut read) = (Vec::new(), Vec::new());
    while run.report().is_none() {
        let t = Instant::now();
        let hits = core.switcher("PKM", 10);
        switcher.push(t.elapsed());
        let t = Instant::now();
        let note = core.read_note("Pages/PKM home.md", std::time::SystemTime::now());
        read.push(t.elapsed());
        assert!(!hits.is_empty() && note.is_ok(), "the open vault answers while the import runs");
    }
    assert_eq!(run.report().map(|r| r.phase), Some(Phase::Done), "the import finished");
    assert!(switcher.len() >= 20, "enough samples were taken while it ran: {}", switcher.len());
    let (s, r) = (p95(&mut switcher), p95(&mut read));
    assert!(s < Duration::from_millis(100), "index.switcher answers in < 100 ms (p95) while an import runs: {s:?}");
    assert!(r < Duration::from_millis(100), "note.read answers in < 100 ms (p95) while an import runs: {r:?}");
}

#[test]
fn nfr_perf_d1541_import_120mb_timings_report_only() {
    let sb = sandbox();
    let dir = big_export(&sb);
    let env = ok!(env(&sb), "env");
    let target = new_target(&sb);
    let t = Instant::now();
    let scan = ok!(scan_of(&dir, &env), "scan the generated export");
    let plan = ok!(plan_of(&scan, SPACE, &target, &Mapping::default(), &env), "plan it (default mapping, new vault)");
    let scan_plan = t.elapsed();
    let t = Instant::now();
    let report = ok!(run_plan(plan, &scan, &target, &env), "write it");
    let write = t.elapsed();
    // Report-only (D-1541): no pass or fail on a time. The one assertion is that the import finished.
    assert_eq!(report.phase, Phase::Done, "the import of the 120 MB export finished: {:?}", report.error);
    let rows = serde_json::json!([
        { "id": "D-1541.scan_plan", "what": "scan + plan of the generated 120 MB export (default mapping, new vault)", "n": 1, "ms": scan_plan.as_millis() as u64, "target_ms": null, "pass": null },
        { "id": "D-1541.write", "what": "write of the generated 120 MB export into a new vault", "n": 1, "ms": write.as_millis() as u64, "target_ms": null, "pass": null },
    ]);
    let out = std::env::var_os("VERIFY_RESULTS").map(PathBuf::from).unwrap_or_else(|| sb.base.clone());
    let path: &Path = &out.join("import-perf.json");
    std::fs::write(path, format!("{}\n", serde_json::to_string_pretty(&rows).expect("setup: JSON"))).expect("setup: write import-perf.json");
    println!("import-perf.json: scan + plan {scan_plan:?}, write {write:?}");
}
