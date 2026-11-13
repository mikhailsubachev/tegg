//! Slice I1, L2 property: FR-IMP-03 AC-10 on generated exports (docs/acceptance/import-capacities.md; test layers
//! "L2"; docs/contracts/v1-import.md §6.5, §16.1). A generated export (`common::generated_export`: titles from a pool
//! with Czech diacritics, emoji, forbidden characters and duplicates; wikilinks, path links, unresolved and external
//! links, links in code, invisible characters) is imported into a new vault with the default mapping; then every
//! written file passes AC-10's checks, the accounting holds on the plan and on the vault (R147), the reader
//! (`import-scan`) and the independent counter agree on every note (§6.5), and every link the plan calls resolved
//! resolves in Tegg's index to the planned file (FR-IMP-10 AC-10).
//!
//! Seeds (TS-L2): at push a fixed seed plus one random seed per run (`QA_SEED` when set, else the clock), 300 notes
//! each. Nightly (`nightly_` prefix, run by the step `import-nightly`): 10 seeds × 1,000 notes. Every seed is printed
//! (`seed = N`). Written from the criteria and the contract only (D-61); every check is an assertion in this file.

mod common;

use std::collections::BTreeSet;

use common::*;
use tegg_format::nfc;
use tegg_import::{accounting, LinkOutcome, Mapping, ObjectOutcome};

const FIXED_SEED: u64 = 20261112;

fn random_seed() -> u64 {
    std::env::var("QA_SEED").ok().and_then(|s| s.parse().ok()).unwrap_or_else(|| std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64 % 1_000_000_007).unwrap_or(1))
}

/// One generated export of `notes` notes: import it and check everything. Problems are collected, not asserted here.
fn one_export(seed: u64, notes: usize) -> Result<Vec<String>, String> {
    let mut problems = Vec::new();
    let mut bad = |ok: bool, what: String| {
        if !ok && problems.len() < 20 {
            problems.push(format!("seed = {seed}: {what}"));
        }
    };
    let sb = sandbox();
    let src = generated_export(&sb, "export", notes, 3 * 4096, seed);
    let run = import_new(&sb, &src, SPACE, &Mapping::default(), &env(&sb)?).map_err(|e| format!("seed = {seed}: {e}"))?;
    let plan = &run.plan;

    // The accounting (R147) and the reader against the independent counter (§6.5).
    bad(plan.objects.iter().filter(|o| o.outcome == ObjectOutcome::Imported).count() >= notes, format!("{} of {notes} generated notes are imported", plan.objects.len()));
    let v = accounting::check_plan(&run.scan.source, plan);
    bad(v.is_empty(), format!("the accounting check on the plan: {v:?}"));
    let v = accounting::check_vault(&run.scan.source, plan, &run.root);
    bad(v.is_empty(), format!("the accounting check on the written vault: {v:?}"));
    for o in plan.objects.iter().filter(|o| o.source.ends_with(".md")) {
        let text = read_text(&src, &format!("PKM/{}", o.source)).unwrap_or_default();
        let (counter, reader) = (accounting::count_links(&text), plan.links.iter().filter(|l| l.note == o.source).count());
        bad(counter == reader, format!("{}: the counter finds {counter} links, the reader {reader}", o.source));
    }
    for (what, t) in [("objects", &plan.totals.objects), ("attachments", &plan.totals.attachments), ("links", &plan.totals.links)] {
        bad(t.imported + t.reported == t.total, format!("imported + reported = total for {what}: {t:?}"));
    }

    // AC-10 on every written file.
    let core = open_core(&run.root, &sb.dirs).map_err(|e| format!("seed = {seed}: {e}"))?;
    let mut names = BTreeSet::new();
    for p in files(&run.root).iter().filter(|p| p.ends_with(".md") && !p.starts_with('.')) {
        let text = read_text(&run.root, p).unwrap_or_default();
        let keys = fm_keys(&text);
        bad(text.starts_with("---\nid: ") && keys.len() >= 5 && keys[..3] == ["id", "type", "title"], format!("{p}: frontmatter with id, type, title first: {keys:?}"));
        let tail: Vec<&str> = keys.iter().rev().take(2).map(String::as_str).collect();
        bad(tail == ["modified", "created"], format!("{p}: R149's order ends created, modified: {keys:?}"));
        bad(*p == plan.report_path || keys.iter().rev().nth(2).map(String::as_str) == Some("import-id"), format!("{p}: import-id before created"));
        bad(keys.iter().collect::<BTreeSet<_>>().len() == keys.len(), format!("{p}: no key twice"));
        bad(!text.contains('\r') && text.ends_with('\n'), format!("{p}: LF and a final newline"));
        let outside_code: String = text.lines().filter(|l| !l.contains('`')).collect::<Vec<_>>().join("\n");
        bad(!outside_code.contains('\u{200b}') && !text.contains('\u{feff}'), format!("{p}: no U+200B outside code, no BOM"));
        let name = p.rsplit('/').next().unwrap_or("");
        let stem = name.strip_suffix(".md").unwrap_or(name);
        bad(nfc(p) == *p, format!("{p}: an NFC path"));
        bad(!stem.is_empty() && stem.len() <= 200 && !stem.contains(['\\', '/', ':', '*', '?', '"', '<', '>', '|', '#', '[', ']', '^']) && !stem.ends_with(['.', ' ']) && !stem.starts_with(['.', ' ']), format!("{p}: a valid name by FR-FMT-08"));
        bad(names.insert(p.to_lowercase()), format!("{p}: unique, compared case-insensitively"));
        bad(wikilink_targets(&text).iter().all(|t| nfc(t) == *t), format!("{p}: NFC link targets"));
        let indexed = core.object(p);
        bad(indexed.as_ref().is_some_and(|o| o.type_single && fm_get(&text, "type").as_deref() == Some(o.r#type.as_str())), format!("{p}: Tegg reads it with its type key"));
    }
    // FR-IMP-10 AC-10: resolved links resolve to the planned file.
    for l in plan.links.iter().filter(|l| l.outcome == LinkOutcome::Resolved) {
        let (Some(to), Some(from)) = (l.to.clone(), path_of(plan, &l.note)) else {
            bad(false, format!("{} link {}: a resolved link names its note and its file", l.note, l.n));
            continue;
        };
        let text = read_text(&run.root, &from).unwrap_or_default();
        let hit = wikilink_targets(&text).iter().any(|t| resolves(&core, &from, t).as_deref() == Some(to.as_str()));
        bad(hit || l.kept_as_markdown, format!("{from}: the link {:?} resolves in the index to {to}", l.written));
    }
    // An unchanged save changes nothing (FR-FMT-07).
    let before = snapshot(&run.root);
    for p in files(&run.root).iter().filter(|p| p.ends_with(".md") && !p.starts_with('.')).take(40) {
        if let Ok((bytes, v)) = core.read_note(p, std::time::SystemTime::now()) {
            let _ = core.write_note(p, &bytes, Some(&v));
        }
    }
    let t = touched(&before, &snapshot(&run.root));
    bad(t.is_empty(), format!("open and save without edits changes nothing: {t:?}"));
    Ok(problems)
}

#[test]
fn fr_imp_03_ac10_generated_export_round_trips() {
    for seed in [FIXED_SEED, random_seed()] {
        println!("FR-IMP-03 AC-10 seed = {seed}");
        let problems = ok!(one_export(seed, 300), format!("seed = {seed}: import a generated export of 300 notes"));
        assert_eq!(problems, Vec::<String>::new(), "a generated export of 300 notes passes AC-10's checks");
    }
}

#[test]
fn nightly_fr_imp_03_ac10_generated_exports_round_trip() {
    let first = random_seed();
    for i in 0..10u64 {
        let seed = if i == 0 { FIXED_SEED } else { first.wrapping_add(i) };
        println!("FR-IMP-03 AC-10 (nightly) seed = {seed}");
        let problems = ok!(one_export(seed, 1000), format!("seed = {seed}: import a generated export of 1,000 notes"));
        assert_eq!(problems, Vec::<String>::new(), "a generated export of 1,000 notes passes AC-10's checks");
    }
}
