//! Slice I1, L4 / L0: the engine as a whole (docs/acceptance/import-capacities.md FR-IMP-03 AC-1, AC-2, AC-9, AC-10;
//! docs/contracts/v1-import.md §1, §2.1, §5, §7, §9.5). Scan, plan and write run with no window and no Tauri, through
//! `tegg_import::{scan, plan, start}` with the real `@tegg/doc` transformer; the network check samples
//! `lsof -i -a -p <pid>` for this process and the transformer's Node process (§2.1). Test clock
//! `2026-11-12T10:00:00+01:00`, Europe/Prague, ids `01JB5V…nn`. Written from the criteria, the contract and the
//! fixtures only (D-61); every check is an assertion in this file.

mod common;

use std::collections::BTreeSet;
use std::process::Command;
use std::sync::{Arc, Mutex};

use common::*;
use tegg_format::nfc;
use tegg_import::{ImportPoint, Mapping, ObjectOutcome, PointAction};

/// The network files of a process, as `lsof -i -a -p <pid>` lists them (no line when it has none).
fn sockets(pid: u32) -> Vec<String> {
    let out = Command::new("lsof").args(["-i", "-a", "-p", &pid.to_string()]).output().expect("setup: lsof");
    String::from_utf8_lossy(&out.stdout).lines().skip(1).map(str::to_string).collect()
}

#[test]
fn fr_imp_03_ac1_engine_is_platform_neutral_and_offline() {
    // L0: the crate's manifest and sources name no Tauri, desktop or network API, no Markdown parser and no direct
    // file access (contract §1.1).
    let krate = repo_root().join("crates/tegg-import");
    let manifest = std::fs::read_to_string(krate.join("Cargo.toml")).unwrap_or_default();
    assert!(manifest.contains("name = \"tegg-import\""), "crates/tegg-import/Cargo.toml exists and names the crate");
    for banned in ["tauri", "reqwest", "hyper", "ureq", "curl", "tokio", "notify", "pulldown-cmark", "objc", "cocoa", "core-foundation"] {
        assert!(!manifest.lines().any(|l| l.trim_start().starts_with(banned)), "the crate does not depend on {banned}");
    }
    let mut sources = Vec::new();
    for e in std::fs::read_dir(krate.join("src")).into_iter().flatten().flatten() {
        if e.path().extension().is_some_and(|x| x == "rs") {
            sources.push((e.file_name().to_string_lossy().into_owned(), std::fs::read_to_string(e.path()).unwrap_or_default()));
        }
    }
    assert!(!sources.is_empty(), "crates/tegg-import/src has Rust sources");
    for (name, text) in &sources {
        for banned in ["std::net", "std::fs", "File::create", "OpenOptions", "TcpStream", "UdpSocket", concat!("tau", "ri::")] {
            let hit = text.lines().find(|l| !l.trim_start().starts_with("//") && l.contains(banned));
            assert_eq!(hit, None, "src/{name} doesn't use {banned} (all file access goes through tegg-vault, no network)");
        }
    }

    // L4: scan, plan and write a space with Weblink URLs and a remote image, with no window; no socket in any phase.
    let sb = sandbox();
    let src = source(&sb, "c06-weblinks");
    append(&src, "PKM/Pages/Reading list.md", "\n![vzdálený obrázek](https://example.com/obrazek.png)\n");
    let t = ok!(transformer(), "the @tegg/doc transformer");
    let pids = [std::process::id(), t.pid()];
    let seen: Arc<Mutex<Vec<String>>> = Arc::default();
    let sample = {
        let seen = seen.clone();
        move |phase: &str| {
            for pid in pids {
                for l in sockets(pid) {
                    seen.lock().unwrap_or_else(|p| p.into_inner()).push(format!("{phase}: pid {pid}: {l}"));
                }
            }
        }
    };
    let mut env = ok!(env(&sb), "the test environment");
    let points = Points::default();
    let s2 = sample.clone();
    env.points = Some(hook(&points, move |_, p| {
        if matches!(p, ImportPoint::BeforeChecks | ImportPoint::Rendered | ImportPoint::Renamed { .. } | ImportPoint::AfterFinalRename) {
            s2(&format!("{p:?}"));
        }
        PointAction::Continue
    }));
    let scan = ok!(scan_of(&src, &env), "scan");
    sample("after scan");
    let target = new_target(&sb);
    let plan = ok!(plan_of(&scan, SPACE, &target, &Mapping::default(), &env), "plan with data only: a path, a space name, a mapping");
    sample("after plan");
    let report = ok!(run_plan(plan.clone(), &scan, &target, &env), "the write");
    sample("after the write");
    assert_eq!(report.phase, tegg_jobs::Phase::Done, "the import finished: {:?}", report.error);
    assert!(points.seen().iter().any(|p| matches!(p, ImportPoint::Renamed { .. })), "the run raised its file points (samples were taken while it wrote)");
    assert_eq!(*seen.lock().unwrap_or_else(|p| p.into_inner()), Vec::<String>::new(), "no socket in this process or the transformer's during scan, plan and write (NFR-SEC-01, D-43)");
    let rust = some!(read_text(&sb.new_vault(), "Pages/Rust book.md"), "the Weblink is written as a Page");
    assert!(rust.contains("\nurl: https://example.com/a-very-long-article-url-that-capacities-folds-into-multiple-lines-of-yaml\n"), "its URL is kept, unfetched");
}

#[test]
fn fr_imp_03_ac2_new_vault_opens_clean() {
    let sb = sandbox();
    let outside_before = snapshot(&sb.base);
    let run = ok!(import_fixture(&sb, "c02-typed-frontmatter"), "import c02 into a new vault");
    assert_eq!(run.root, sb.new_vault(), "the vault is at the chosen place under its final name");
    let empty = repo_root().join("tests/fixtures/vaults/new-empty/.tegg");
    for f in ["vault.yml", "types/page.yml", "types/task.yml", "types/daily-note.yml", "types/quick-note.yml", "types/tag.yml", "types/image.yml", "types/pdf.yml"] {
        assert_eq!(read_bytes(&run.root, &format!(".tegg/{f}")), read_bytes(&empty, f), ".tegg/{f} is byte-equal to new-empty's (no system type gained an attribute)");
    }
    let tegg: BTreeSet<String> = files(&run.root).into_iter().filter(|p| p.starts_with(".tegg/")).collect();
    assert_eq!(tegg.len(), 10, "vault.yml, seven system type files, book.yml and idea.yml, nothing else under .tegg/: {tegg:?}");
    assert!(tegg.contains(".tegg/types/book.yml") && tegg.contains(".tegg/types/idea.yml"), "the two new type files");
    assert!(!tegg.contains(".tegg-import") && !files(&run.root).contains(".tegg-import"), "the marker is gone from the finished vault");

    // The written objects, byte for byte (capacities-expected/c02-typed-frontmatter).
    let exp = expected_dir("c02-typed-frontmatter");
    let want: BTreeSet<String> = files(&exp).into_iter().filter(|p| p.ends_with(".md") && p != "README.md").collect();
    assert_eq!(want.len(), 7, "setup: the expected folder has six Books and the Idea");
    for p in &want {
        assert_eq!(read_text(&run.root, p), read_text(&exp, p), "{p} is byte-equal to the expected output");
    }
    let objects: BTreeSet<String> = files(&run.root).into_iter().filter(|p| !p.starts_with(".tegg/")).collect();
    let mut all = want.clone();
    all.insert(REPORT.to_string());
    assert_eq!(objects, all, "the vault holds the seven imported objects and the report Page, nothing else");

    // It opens as a Tegg vault, and the index lists exactly the plan's imported objects plus the report.
    let planned: BTreeSet<String> = run.plan.objects.iter().filter(|o| o.outcome == ObjectOutcome::Imported).filter_map(|o| o.path.clone()).collect();
    assert_eq!(planned, want, "the plan's imported objects are the expected seven (Broken frontmatter is unreadable)");
    let core = ok!(open_core(&run.root, &sb.dirs), "the written vault opens");
    let indexed: BTreeSet<String> = core.objects().into_iter().map(|o| nfc(&o.path)).collect();
    assert_eq!(indexed, all, "the index lists the imported objects and the report");
    for o in core.objects() {
        let p = nfc(&o.path);
        let want_type = if p.starts_with("Books/") { "book" } else if p.starts_with("Ideas/") { "idea" } else { "page" };
        assert_eq!((o.r#type.as_str(), o.type_single), (want_type, true), "{p}: its type is a defined type of the vault");
        assert!(o.id.as_deref().is_some_and(|i| i.starts_with("01JB5V0000000000000000")), "{p}: an id from the injected source");
    }
    drop(core);

    // Nothing outside the vault folder, and no temporary file or folder left.
    assert!(!sb.importing().exists(), "the temporary folder is gone");
    let after = snapshot(&sb.base);
    let outside: BTreeSet<String> = changed(&outside_before, &after).into_iter().filter(|p| !p.starts_with(&format!("Trezory/{VAULT_NAME}/")) && !p.starts_with("Application Support/")).collect();
    assert_eq!(outside, BTreeSet::new(), "nothing was written outside the vault folder");
    assert_eq!(temp_files(&sb.base), Vec::<String>::new(), "no .tegg-tmp file anywhere");
}

#[test]
fn fr_imp_03_ac9_deterministic() {
    let sb = sandbox();
    let env1 = ok!(env(&sb), "the test environment");
    let src = fixtures().join("c10-duplicate-titles");
    let scan = ok!(scan_of(&src, &env1), "scan c10");
    let target = new_target(&sb);
    let a = ok!(plan_of(&scan, SPACE, &target, &Mapping::default(), &env1), "plan");
    let b = ok!(plan_of(&scan, SPACE, &target, &Mapping::default(), &env1), "plan again");
    assert_eq!(a, b, "planning twice gives equal plans");
    let sources: Vec<&str> = a.objects.iter().map(|o| o.source.as_str()).collect();
    assert_eq!(sources, ["Meetings/Tomáš  Eva (1).md", "Meetings/Tomáš  Eva.md", "People/Tomáš.md", "Weblinks/Article (1).md", "Weblinks/Article (2).md", "Weblinks/Article.md"], "objects in source-path order, NFC paths compared by code point");

    // Two writes with the same injected clock and id source: byte-identical trees.
    let sb2 = sandbox();
    let one = ok!(import_fixture(&sb, "c10-duplicate-titles"), "first write");
    let two = ok!(import_fixture(&sb2, "c10-duplicate-titles"), "second write");
    let bytes = |root: &std::path::Path| snapshot(root).into_iter().map(|(k, v)| (k, v.bytes)).collect::<Vec<_>>();
    assert!(bytes(&one.root).len() >= 8, "six objects, the report and the type files were written");
    assert_eq!(bytes(&one.root), bytes(&two.root), "the two written vaults are byte-identical");
}

#[test]
fn fr_imp_03_ac10_written_files_round_trip() {
    const TAIL: [&str; 3] = ["import-id", "created", "modified"];
    for fixture in FIXTURES {
        let sb = sandbox();
        let run = ok!(import_fixture(&sb, fixture), format!("import {fixture}"));
        let core = ok!(open_core(&run.root, &sb.dirs), format!("{fixture}: the written vault opens"));
        let notes: Vec<String> = files(&run.root).into_iter().filter(|p| p.ends_with(".md") && !p.starts_with('.')).collect();
        assert!(notes.len() >= 2, "{fixture}: at least one object and the report were written");
        for p in &notes {
            let text = some!(read_text(&run.root, p), format!("{fixture}: {p}"));
            let at = format!("{fixture}: {p}");
            assert!(text.starts_with("---\nid: 01JB5V0000000000000000"), "{at}: frontmatter first, `id` first");
            assert!(!text.contains('\r') && text.ends_with('\n') && !text.contains('\u{feff}'), "{at}: LF, a final newline, no BOM");
            let keys = fm_keys(&text);
            assert_eq!(keys.iter().collect::<BTreeSet<_>>().len(), keys.len(), "{at}: no key twice: {keys:?}");
            assert_eq!(&keys[..3], ["id", "type", "title"], "{at}: R149's order starts id, type, title");
            let is_report = *p == REPORT;
            let tail: Vec<&str> = keys[keys.len().saturating_sub(if is_report { 2 } else { 3 })..].iter().map(String::as_str).collect();
            assert_eq!(tail, if is_report { &TAIL[1..] } else { &TAIL[..] }, "{at}: R149's order ends import-id, created, modified (the report has no import-id)");
            if let Some(i) = keys.iter().position(|k| k == "tags") {
                assert_eq!(i, keys.len() - 4, "{at}: tags sits right before import-id");
            }
            for (k, i) in [("description", 3usize), ("aliases", 4)] {
                if let Some(at_i) = keys.iter().position(|x| x == k) {
                    assert!(at_i <= i, "{at}: {k} follows title, before the attributes: {keys:?}");
                }
            }
            // Names: NFC, valid by FR-FMT-08, stem at most 200 UTF-8 bytes.
            assert_eq!(&nfc(p), p, "{at}: the path is NFC");
            let name = p.rsplit('/').next().unwrap_or("");
            let stem = name.strip_suffix(".md").unwrap_or(name);
            assert!(stem.len() <= 200 && !stem.is_empty(), "{at}: a stem of 1…200 UTF-8 bytes");
            assert!(!stem.contains(['\\', '/', ':', '*', '?', '"', '<', '>', '|', '#', '[', ']', '^']), "{at}: no forbidden character");
            assert!(!stem.starts_with(['.', ' ']) && !stem.ends_with(['.', ' ']), "{at}: no leading or trailing dot or space");
            // Link targets are NFC.
            for t in wikilink_targets(&text) {
                assert_eq!(nfc(&t), t, "{at}: the link target {t:?} is NFC");
            }
            // Tegg reads it as the object the plan named.
            let o = some!(core.object(p), format!("{at}: indexed"));
            assert!(o.type_single, "{at}: `type` is one type key");
            assert_eq!(fm_get(&text, "type"), Some(o.r#type.clone()), "{at}: `type` is the type key (D-96)");
        }
        // An unchanged save through Tegg changes no byte (FR-FMT-07; the byte-level round trip of @tegg/doc is in
        // packages/doc/test/import.property.ac.test.ts).
        let before = snapshot(&run.root);
        for p in &notes {
            let (bytes, v) = ok!(core.read_note(p, std::time::SystemTime::now()), format!("{fixture}: read {p}"));
            let _ = core.write_note(p, &bytes, Some(&v));
        }
        assert_eq!(touched(&before, &snapshot(&run.root)), BTreeSet::new(), "{fixture}: open and save without edits changes nothing");
    }
}
