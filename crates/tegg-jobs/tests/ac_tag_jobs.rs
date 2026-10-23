//! MS4 slice 4D-lite AC tests of the tag jobs (L4): `tag-rename` and `tag-delete` end to end on a temporary copy of
//! the tags fixture on APFS, with the real `@tegg/doc` engine as transformer (`NodeTransformer`, D-82).
//! docs/acceptance/tags.md FR-TAG-01 AC-4 (rename part), FR-TAG-04 AC-4…AC-7, AC-8 (progress), AC-9, FR-TAG-08 AC-2,
//! AC-4, FR-TAG-10 AC-1, FR-SYN-06 AC-32 (jobs), and links.md FR-TAG-04 AC-2, AC-3 (tag part) through AC-4.
//! Interface: docs/contracts/ms4-tags.md §4 (`JobOp::TagRename`, `JobOp::TagDelete`, the planners, `JobError::
//! InvalidName`, `TagExists`, `PlanWarning`), ms4-jobs §4…§6 (start, confirm, cancel, report, backups). The sync
//! simulator cases are in ac_sync_tags.rs. Written from the ACs and the contracts only (D-61).
//!
//! Every API result goes through `ok!`/`some!` or an `assert!` here, so the 4D-lite stubs fail on assertions.

#[macro_use]
mod common;
mod tags_setup;

use std::collections::BTreeSet;
use std::sync::mpsc::RecvTimeoutError;
use std::time::{Duration, Instant};

use common::{changed, no_modified, open_core, open_core_with, read_bytes, read_text, sandbox, snapshot, RecordingFs};
use tags_setup::*;
use tegg_core::CoreEvent;
use tegg_jobs::{JobError, JobKind, JobOp, Phase, PlanWarning};

fn rename_op(from: &str, to: &str) -> JobOp {
    JobOp::TagRename { from: from.into(), to: to.into() }
}
fn delete_op(tag: &str) -> JobOp {
    JobOp::TagDelete { tag: tag.into(), keep_text: false }
}
fn files_only(s: BTreeSet<String>) -> BTreeSet<String> {
    s.into_iter().filter(|p| !p.ends_with('/')).collect()
}
fn modified_of(t: &str) -> Option<String> {
    t.lines().find(|l| l.starts_with("modified:")).map(str::to_string)
}

/// The R80 rename `účty` → `Výdaje`: every file's expected bytes (`None` for Tags/Výdaje.md, checked separately).
fn after_vydaje() -> Vec<(&'static str, String)> {
    vec![
        (ROZPOCET, tx_swap(ROZPOCET, &[("tags: [účty, finance]", "tags: [Výdaje, finance]")])),
        (NAJEM, tx_swap(NAJEM, &[("  - Účty\n", "  - Výdaje\n")])),
        (BANKA, tx_swap(BANKA, &[("tags: [účty]\r\n", "tags: [Výdaje]\r\n")])),
        (FAKTURA, tx_swap(FAKTURA, &[(&format!("Poslat #{} dnes.", nfd("účty")), "Poslat #Výdaje dnes.")])),
        (DEN, tx_swap(DEN, &[("\n#ÚČTY\n", "\n#Výdaje\n")])),
        (DVAKRAT, tx_swap(DVAKRAT, &[("tags: [účty]", "tags: [Výdaje]"), ("#Účty a znovu #účty.", "#Výdaje a znovu #Výdaje.")])),
        (SABLONA, tx_swap(SABLONA, &[("tags: [účty]", "tags: [Výdaje]"), ("\n#účty\n", "\n#Výdaje\n")])),
        (ODKAZ, tx_swap(ODKAZ, &[("[[Účty]]", "[[Výdaje]]")])),
    ]
}

// ------------------------------------------------------------------------------------------------ FR-TAG-04 AC-4

#[test]
fn fr_tag_04_ac4_rename_every_occurrence_exact_bytes() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    let (_, report) = ok!(run_confirmed(&core, rename_op("účty", "Výdaje")), "tag-rename účty → Výdaje");
    assert_eq!(report.phase, Phase::Done, "done: {report:?}");
    assert_eq!(report.kind, JobKind::TagRename, "kind tag-rename");
    let mut bad = Vec::new();
    for (p, want) in after_vydaje() {
        if read_text(&root, p).as_deref() != Some(want.as_str()) {
            bad.push(format!("{p}: {:?}", read_text(&root, p)));
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "only the tag bytes change (flow / block list, CRLF, no final newline, NFD written NFC; D-713 no modified change)");
    assert!(!root.join(F_UCTY).exists(), "Tags/Účty.md is gone");
    let v = read_text(&root, "Tags/Výdaje.md").unwrap_or_default();
    assert_eq!(no_modified(&v), no_modified(&tx(F_UCTY).replace("title: Účty", "title: Výdaje")), "Tags/Výdaje.md: title Výdaje, color: blue kept, same id");
    assert_ne!(modified_of(&v), modified_of(&tx(F_UCTY)), "the Tag file's own modified changes (D-713)");
    let mut want: BTreeSet<String> = after_vydaje().into_iter().map(|(p, _)| p.to_string()).collect();
    want.insert(F_UCTY.into());
    want.insert("Tags/Výdaje.md".into());
    assert_eq!(files_only(changed(&before, &snapshot(&root))), want, "untouched: Kód, Koš, Web, Lomítko, Kniha, the 20 Výplň files, every other file");
    assert_eq!(report.renamed, Some((F_UCTY.to_string(), "Tags/Výdaje.md".to_string())), "renamed in the report");
}

#[test]
fn fr_tag_04_ac4_the_losing_tag_file_is_left_alone() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    let job = ok!(core.jobs().start(rename_op("dvojí", "dvoje")), "start tag-rename dvojí → dvoje");
    let deadline = Instant::now() + Duration::from_secs(30);
    let mut plan = None;
    while plan.is_none() && Instant::now() < deadline {
        plan = core.jobs().plan(job).filter(|p| p.kind == JobKind::TagRename);
        std::thread::sleep(Duration::from_millis(10));
    }
    let plan = some!(plan, "the plan");
    assert_eq!(plan.warnings, vec![PlanWarning::DuplicateTagFile { path: F_DVOJI2.into() }], "the loser is a warning (D-718)");
    ok!(confirm_when_asked(&core, job), "confirm");
    let report = some!(core.jobs().wait(job, Duration::from_secs(60)), "report");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_eq!(read_bytes(&root, F_DVOJI2), Some(tx(F_DVOJI2).into_bytes()), "F-Dvojí2 untouched");
    let ch = files_only(changed(&before, &snapshot(&root)));
    assert_eq!(ch, [WEB.to_string(), F_DVOJI.into(), "Tags/dvoje.md".into()].into(), "Web, and the winner renamed");
}

// ------------------------------------------------------------------------------------------------ FR-TAG-01 AC-4

#[test]
fn fr_tag_01_ac4_rename_keeps_description_and_extra_keys() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (_, report) = ok!(run_confirmed(&core, rename_op("neznámá", "prastará")), "tag-rename neznámá → prastará");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let t = some!(read_text(&root, "Tags/prastará.md"), "Tags/prastará.md");
    assert_eq!(no_modified(&t), no_modified(&tx(F_NEZNAMA).replace("title: neznámá", "title: prastará")), "only title:, the file name and modified change; description, x-extra, magenta kept");
    assert_eq!(read_text(&root, KNIHA), Some(tx_swap(KNIHA, &[("[čtení, neznámá]", "[čtení, prastará]")])), "Kniha's entry");
}

// ------------------------------------------------------------------------------------------------ FR-TAG-04 AC-5

#[test]
fn fr_tag_04_ac5_spelling_only_and_case_only_renames() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (_, report) = ok!(run_confirmed(&core, rename_op("účty", "Účty")), "tag-rename účty → Účty (same key)");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_eq!(read_text(&root, ROZPOCET), Some(tx_swap(ROZPOCET, &[("[účty, finance]", "[Účty, finance]")])), "Rozpočet");
    assert_eq!(read_text(&root, FAKTURA), Some(tx_swap(FAKTURA, &[(&format!("#{}", nfd("účty")), "#Účty")])), "Faktura");
    assert_eq!(read_text(&root, DEN), Some(tx_swap(DEN, &[("#ÚČTY", "#Účty")])), "Den: #ÚČTY → #Účty");
    assert_eq!(read_text(&root, DVAKRAT), Some(tx_swap(DVAKRAT, &[("tags: [účty]", "tags: [Účty]"), ("#Účty a znovu #účty.", "#Účty a znovu #Účty.")])), "Dvakrát: both inline and the entry");
    assert_eq!(read_text(&root, BANKA), Some(tx_swap(BANKA, &[("[účty]", "[Účty]")])), "Banka");
    assert!(report.unchanged.contains(&NAJEM.to_string()), "Nájem (already Účty) is counted unchanged: {report:?}");
    assert_eq!(read_text(&root, NAJEM), Some(tx(NAJEM)), "Nájem untouched");
    assert!(root.join(F_UCTY).exists(), "F-účty keeps its path");
    let (_, r2) = ok!(run_confirmed(&core, rename_op("účty", "ÚČTY")), "tag-rename to ÚČTY");
    assert_eq!(r2.phase, Phase::Done, "{r2:?}");
    let names: Vec<String> = std::fs::read_dir(root.join("Tags")).map(|d| d.flatten().map(|e| tegg_format::nfc(&e.file_name().to_string_lossy())).collect()).unwrap_or_default();
    assert!(names.contains(&"ÚČTY.md".to_string()) && !names.contains(&"Účty.md".to_string()), "a case-only rename: the listing shows ÚČTY.md: {names:?}");
    let before = snapshot(&root);
    let zips_before = zips(&sb.dirs).len();
    match core.jobs().start(rename_op("účty", "ÚČTY")) {
        Err(_) => {}
        Ok(job) => {
            let _ = confirm_when_asked(&core, job);
            let r = core.jobs().wait(job, Duration::from_secs(30));
            assert!(r.as_ref().is_some_and(|r| r.written.is_empty()), "the same spelling writes nothing: {r:?}");
        }
    }
    assert_eq!(snapshot(&root), before, "a rename to the same spelling writes nothing");
    assert_eq!(zips(&sb.dirs).len(), zips_before, "and makes no zip (no job)");
}

// ------------------------------------------------------------------------------------------------ FR-TAG-04 AC-6

#[test]
fn fr_tag_04_ac6_refused_onto_an_existing_key_or_an_invalid_name() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    for to in ["finance", "FINANCE", "prázdný", "a/b", &nfd("čtení")] {
        let r = core.jobs().start(rename_op("účty", to));
        assert!(matches!(r, Err(JobError::TagExists { .. })), "{to:?}: TagExists (D-699), got {r:?}");
    }
    match core.jobs().start(rename_op("účty", "finance")) {
        Err(JobError::TagExists { name }) => assert_eq!(name, "finance", "the existing tag's name"),
        other => assert!(false, "TagExists {{ name: finance }}, got {other:?}"),
    }
    for (to, error, ch) in [("", "empty", None), ("#", "empty", None), ("moje štítky", "space", None), ("2026", "digits", None), ("C++", "char", Some("+")), ("a:b", "char", Some(":"))] {
        match core.jobs().start(rename_op("účty", to)) {
            Err(JobError::InvalidName { error: e, char: c }) => assert_eq!((e.as_str(), c.as_deref()), (error, ch), "{to:?}"),
            other => assert!(false, "{to:?}: InvalidName {{ {error} }}, got {other:?}"),
        }
    }
    assert!(matches!(core.jobs().start(rename_op("neexistuje", "x")), Err(JobError::NotFound)), "an unknown tag: NotFound");
    assert_eq!(snapshot(&root), before, "nothing written");
    assert_eq!(zips(&sb.dirs), Vec::<std::path::PathBuf>::new(), "no zip");
}

// ------------------------------------------------------------------------------------------------ FR-TAG-04 AC-7

#[test]
fn fr_tag_04_ac7_zip_before_the_first_write_with_every_md_and_tegg_file() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let fs = FirstWriteFs::new(&root, &sb.dirs);
    let core = ok!(open_core_with(fs.clone(), &sb.dirs), "open");
    let want: BTreeSet<String> = snapshot(&root).into_keys().filter(|k| !k.ends_with('/') && (k.ends_with(".md") || k.starts_with(".tegg/"))).collect();
    let (_, report) = ok!(run_confirmed(&core, rename_op("účty", "Výdaje")), "tag-rename");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_eq!(fs.zip_before_first_write(), Some(true), "a zip exists before the first vault write");
    let z = zips(&sb.dirs);
    assert_eq!(z.len(), 1, "one zip: {z:?}");
    let name = zip_name(&z[0]);
    assert!(name.ends_with("-tag-rename.zip") && name.len() == "20261022-080000-tag-rename.zip".len(), "<UTC yyyymmdd-hhmmss>-tag-rename.zip: {name}");
    let names: BTreeSet<String> = zip_entries(&z[0]).into_iter().map(|(n, _)| n).filter(|n| n != "tegg-backup.json" && !n.ends_with('/')).collect();
    assert_eq!(names, want, "every .md and .tegg/ file, NFC names (the pre-job vault)");
    let bytes: Vec<(String, Vec<u8>)> = zip_entries(&z[0]).into_iter().filter(|(n, _)| n == ROZPOCET).collect();
    assert_eq!(bytes.first().map(|(_, b)| b.clone()), Some(tx(ROZPOCET).into_bytes()), "the pre-job bytes");
}

#[test]
fn fr_tag_04_ac7_backup_failed_writes_nothing() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    read_only_backups(&sb.dirs);
    let r = run_confirmed(&core, rename_op("účty", "Výdaje"));
    writable_again(&sb.dirs);
    let (_, report) = ok!(r, "tag-rename");
    assert_eq!(report.phase, Phase::Failed, "the job ends failed: {report:?}");
    assert!(report.error.as_deref().unwrap_or_default().contains("BackupFailed"), "BackupFailed: {:?}", report.error);
    assert_eq!(snapshot(&root), before, "the vault is byte-identical");
}

fn wait_phase(rx: &std::sync::mpsc::Receiver<CoreEvent>, job: u64, phase: Phase, timeout: Duration) -> bool {
    let end = Instant::now() + timeout;
    while Instant::now() < end {
        match rx.recv_timeout(Duration::from_millis(20)) {
            Ok(CoreEvent::JobProgress(p)) if p.job == job && p.phase == phase => return true,
            Ok(_) | Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return false,
        }
    }
    false
}

#[test]
fn fr_tag_04_ac7_cancel_in_confirm_planning_or_backup_writes_nothing() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    // The dialog's Cancel: the job waits in `confirm`, then is cancelled.
    let rx = core.events();
    let job = ok!(core.jobs().start(rename_op("účty", "Výdaje")), "start");
    assert!(wait_phase(&rx, job, Phase::Confirm, Duration::from_secs(30)), "the job waits in confirm");
    ok!(core.jobs().cancel(job), "cancel in confirm");
    let r = some!(core.jobs().wait(job, Duration::from_secs(1)), "stops within 1 s");
    assert_eq!(r.phase, Phase::Cancelled, "cancelled");
    assert_eq!(zips(&sb.dirs), Vec::<std::path::PathBuf>::new(), "no zip");
    // Cancel while planning (blocked at AfterPlanning).
    let (tx_, rx_) = std::sync::mpsc::channel::<()>();
    let gate = std::sync::Arc::new(std::sync::Mutex::new(Some(rx_)));
    core.jobs().set_point_hook(Some(std::sync::Arc::new(move |_, p: &tegg_jobs::JobPoint| {
        if matches!(p, tegg_jobs::JobPoint::AfterPlanning) {
            if let Some(r) = gate.lock().unwrap_or_else(|e| e.into_inner()).take() {
                let _ = r.recv_timeout(Duration::from_secs(5));
            }
        }
    })));
    let job2 = ok!(core.jobs().start(rename_op("účty", "Výdaje")), "start again");
    std::thread::sleep(Duration::from_millis(200));
    let t0 = Instant::now();
    ok!(core.jobs().cancel(job2), "cancel in planning");
    let _ = tx_.send(());
    let r2 = some!(core.jobs().wait(job2, Duration::from_secs(1)), "stops within 1 s");
    assert!(t0.elapsed() < Duration::from_secs(1), "within 1 s");
    assert_eq!(r2.phase, Phase::Cancelled, "cancelled");
    assert_eq!(snapshot(&root), before, "the vault is byte-identical");
}

// ------------------------------------------------------------------------------------------------ FR-TAG-04 AC-8 (progress)

#[test]
fn fr_tag_04_ac8_job_progress_of_a_tag_rename() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let rx = core.events();
    let (job, report) = ok!(run_confirmed(&core, rename_op("účty", "Výdaje")), "tag-rename");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let mut events = Vec::new();
    while let Ok(e) = rx.recv_timeout(Duration::from_millis(100)) {
        if let CoreEvent::JobProgress(p) = e {
            if p.job == job {
                events.push(p);
            }
        }
    }
    assert!(!events.is_empty(), "job:progress events");
    assert!(events.iter().all(|p| p.kind == JobKind::TagRename), "kind tag-rename");
    let writing: Vec<_> = events.iter().filter(|p| p.phase == Phase::Writing).collect();
    assert!(writing.windows(2).all(|w| w[1].done >= w[0].done && w[1].total == w[0].total), "done never decreases, total fixed from writing");
    let last = some!(events.last(), "a final event");
    assert_eq!(last.phase, Phase::Done, "the final event");
    assert_eq!(last.counts.map(|c| c.written), Some(report.written.len()), "with counts");
    assert!(events.iter().any(|p| p.phase == Phase::Confirm) && events.iter().any(|p| p.phase == Phase::Backup), "confirm and backup phases");
}

// ------------------------------------------------------------------------------------------------ FR-TAG-04 AC-9

#[test]
fn fr_tag_04_ac9_after_the_rename() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (_, report) = ok!(run_confirmed(&core, rename_op("účty", "Výdaje")), "tag-rename");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let rows = core.tag_rows();
    let v = rows.iter().find(|r| r.key == "výdaje");
    assert_eq!(v.map(|r| (r.name.clone(), r.count, r.color.clone())), Some(("Výdaje".into(), 6, Some("blue".into()))), "Výdaje 6, blue");
    assert!(rows.iter().all(|r| r.key != "účty"), "no účty");
    assert_eq!(core.tag_objects("výdaje").len(), 6, "the six objects carry #Výdaje (Search's filter runs on the same keys)");
    assert_eq!(read_text(&root, ODKAZ), Some(tx_swap(ODKAZ, &[("[[Účty]]", "[[Výdaje]]")])), "links to the Tag file follow it (D-714, ms4-tags §4.1)");
}

// ------------------------------------------------------------------------------------------------ FR-TAG-08 AC-2, AC-4

#[test]
fn fr_tag_08_ac2_remove_from_all_objects_exact_bytes() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let fs = FirstWriteFs::new(&root, &sb.dirs);
    let core = ok!(open_core_with(fs.clone(), &sb.dirs), "open");
    let before = snapshot(&root);
    let (_, report) = ok!(run_confirmed(&core, delete_op("účty")), "tag-delete účty");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_eq!(report.kind, JobKind::TagDelete, "kind tag-delete");
    assert_eq!(fs.zip_before_first_write(), Some(true), "the zip first");
    assert!(zips(&sb.dirs).iter().any(|z| zip_name(z).ends_with("-tag-delete.zip")), "<UTC>-tag-delete.zip");
    let want = vec![
        (ROZPOCET, tx_swap(ROZPOCET, &[("tags: [účty, finance]", "tags: [finance]")])),
        (NAJEM, tx_swap(NAJEM, &[("tags:\n  - Účty\n", "")])),
        (BANKA, tx_swap(BANKA, &[("tags: [účty]\r\n", "")])),
        (FAKTURA, tx_swap(FAKTURA, &[(&format!("Poslat #{} dnes.", nfd("účty")), "Poslat dnes.")])),
        (DEN, tx_swap(DEN, &[("Ranní zápis.\n#ÚČTY\nOdpolední zápis.", "Ranní zápis.\nOdpolední zápis.")])),
        (DVAKRAT, tx_swap(DVAKRAT, &[("tags: [účty]\n", ""), ("#Účty a znovu #účty.\n", "a znovu.\n")])),
        (SABLONA, tx_swap(SABLONA, &[("tags: [účty]\n", ""), ("---\n#účty\n", "---\n")])),
    ];
    let mut bad = Vec::new();
    for (p, w) in &want {
        if read_text(&root, p).as_deref() != Some(w.as_str()) {
            bad.push(format!("{p}: {:?}", read_text(&root, p)));
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "only these bytes change (D-715, D-716)");
    let after = snapshot(&root);
    assert_eq!(after.get(&format!(".trash/{F_UCTY}")).map(|e| (&e.bytes, e.mtime_ns)), before.get(F_UCTY).map(|e| (&e.bytes, e.mtime_ns)), "F-účty moved to .trash/Tags/Účty.md, bytes and mtime unchanged");
    let mut ch: BTreeSet<String> = want.iter().map(|(p, _)| p.to_string()).collect();
    ch.insert(F_UCTY.into());
    ch.insert(format!(".trash/{F_UCTY}"));
    assert_eq!(files_only(changed(&before, &after)), ch, "Kód, Koš, Výplň and every other file untouched");
    assert!(core.tag_rows().iter().all(|r| r.key != "účty") && core.tags().iter().all(|t| t.key != "účty"), "účty is not a tag any more");
    assert_eq!(core.tag_rows().len(), 9, "the other nine tags stay");
}

#[test]
fn fr_tag_08_ac4_virtual_tag_rewrites_only_its_objects() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    let (_, report) = ok!(run_confirmed(&core, delete_op("finance")), "tag-delete finance");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_eq!(read_text(&root, ROZPOCET), Some(tx_swap(ROZPOCET, &[("tags: [účty, finance]", "tags: [účty]")])), "Rozpočet");
    assert_eq!(read_text(&root, WEB), Some(tx_swap(WEB, &[("tags: [finance, dvojí]", "tags: [dvojí]")])), "Web");
    assert_eq!(files_only(changed(&before, &snapshot(&root))), [ROZPOCET.to_string(), WEB.to_string()].into(), "nothing else (no Tag file to move)");
}

// ------------------------------------------------------------------------------------------------ FR-TAG-10 AC-1

#[test]
fn fr_tag_10_ac1_rename_a_slash_tag() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    let (_, report) = ok!(run_confirmed(&core, rename_op("a/b", "a/c")), "tag-rename a/b → a/c");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_eq!(read_text(&root, LOMITKO), Some(tx_swap(LOMITKO, &[("#a/b", "#a/c")])), "Lomítko #a/c");
    let t = some!(read_text(&root, "Tags/a c.md"), "Tags/a b.md → Tags/a c.md");
    assert!(t.contains("\ntitle: a/c\n"), "title: a/c");
    assert!(!root.join(F_AB).exists(), "Tags/a b.md is gone");
    let ch = files_only(changed(&before, &snapshot(&root)));
    assert!(ch.is_subset(&[F_AB.to_string(), "Tags/a c.md".into(), LOMITKO.into(), ODKAZ.into()].into()), "only a/b's files (and the link to its Tag file): {ch:?}");
    assert_eq!(read_text(&root, DVAKRAT), Some(tx(DVAKRAT)), "#účty/archiv is never touched");
}

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-32 (jobs)

#[test]
fn fr_syn_06_ac32_tag_jobs_write_each_file_once() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let fs = RecordingFs::new(&root);
    let core = ok!(open_core_with(fs.clone(), &sb.dirs), "open");
    let (_, report) = ok!(run_confirmed(&core, rename_op("účty", "Výdaje")), "tag-rename");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let mut per_path: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
    for (op, path, _) in fs.ops() {
        if (op == "replace" || op == "create_new" || op.starts_with("rename_from:")) && !path.contains("tegg-tmp") {
            *per_path.entry(path).or_default() += 1;
        }
    }
    let mut want: BTreeSet<String> = after_vydaje().into_iter().map(|(p, _)| p.to_string()).collect();
    want.insert("Tags/Výdaje.md".into());
    assert_eq!(per_path.keys().cloned().collect::<BTreeSet<_>>(), want, "exactly the files with an occurrence, the Tag file and the link to it");
    assert!(per_path.values().all(|n| *n == 1), "each written once: {per_path:?}");
    let (_, r2) = ok!(run_confirmed(&core, delete_op("finance")), "tag-delete finance");
    assert_eq!((r2.written.len(), r2.unchanged.len()), (2, 0), "Remove from: exactly its 2 files: {r2:?}");
}
