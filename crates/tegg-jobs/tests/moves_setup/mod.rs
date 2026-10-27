//! Setup for the slice 4E-1 L4 job tests (docs/acceptance/type-moves.md; docs/contracts/ms4-jobs.md §14): the
//! type-moves fixture in a temporary directory (with Nápad renamed to its NFD name, as the fixture README says), the
//! fixture paths, the default mappings of R101, expected-byte helpers and event probes. No AC assertions here: a panic
//! in this file is a setup failure, never a red test (tools/qa CONTRACT §5.2); results go back to the test files for
//! them to assert on.
#![allow(dead_code)]

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc::Receiver;
use std::time::{Duration, Instant};

use crate::common::{copy_dir, repo_root, Sandbox};
use tegg_core::{Core, CoreEvent};
use tegg_jobs::{JobId, JobKind, JobOp, JobProgress, MapTarget, PropertyMap};

pub const DUNA: &str = "Knihy/Duna.md";
pub const BABICKA: &str = "Knihy/Babička.md";
pub const STARY: &str = "Knihy/2025/Starý zápis.md";
pub const BEZ: &str = "Knihy/Bez autora.md";
pub const JINDE: &str = "Pages/Kniha jinde.md";
pub const SESIT_K: &str = "Knihy/Sešit.md";
pub const DOCX: &str = "Knihy/seznam.docx";
pub const CLANEK: &str = "Pages/Článek.md";
pub const PLAN: &str = "Quick Notes/Plán.md";
pub const PLAN_CESTY_Q: &str = "Quick Notes/Plán cesty.md";
pub const PLAN_CESTY_P: &str = "Pages/Plán cesty.md";
pub const SESIT_Q: &str = "Quick Notes/Sešit.md";
pub const NA_SESIT: &str = "Quick Notes/Odkaz na sešit.md";
pub const ODKAZY: &str = "Pages/Odkazy.md";
pub const PORADA: &str = "Schůzky/Porada.md";
pub const RETRO: &str = "Schůzky/Retro.md";
pub const SCH_JINDE: &str = "Pages/Schůzka jinde.md";
pub const JANA: &str = "Osoby/Jana.md";
pub const VOLNA: &str = "Volné/Volná poznámka.md";
pub const RECEPT: &str = "Volné/Recept.md";
pub const NAPAD: &str = "Quick Notes/Nápad.md";
pub const T_KNIHA: &str = "_templates/Kniha/Kniha.md";
pub const T_RECENZE: &str = "_templates/Kniha/Recenze.md";
pub const T_SCHUZKA: &str = "_templates/Schůzka/Schůzka.md";
pub const KNIHA_YML: &str = ".tegg/types/kniha.yml";

pub const PLAN_ID: &str = "01JB4E0000000000000000E008";
pub const JINDE_ID: &str = "01JB4E0000000000000000E005";
pub const SCH_JINDE_ID: &str = "01JB4E0000000000000000E016";

/// The six Knihy outside `Četba` (FR-STO-01 AC-8) and where the folder save puts them.
pub const SIX: [(&str, &str); 6] = [
    (DUNA, "Četba/Duna.md"),
    (BABICKA, "Četba/Babička.md"),
    (BEZ, "Četba/Bez autora.md"),
    (SESIT_K, "Četba/Sešit.md"),
    (STARY, "Četba/Starý zápis.md"),
    (JINDE, "Četba/Kniha jinde.md"),
];

pub fn vypln() -> Vec<String> {
    (1..=10).map(|i| format!("Pages/Výplň {i:02}.md")).collect()
}

/// tests/fixtures/vaults/type-moves (without README.md) plus new-empty/.tegg in `<sandbox>/Přesuny`; Nápad gets its
/// NFD file name (the fixture README: Git can't keep it).
pub fn moves_vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Přesuny");
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fx.join("type-moves"), &root, &["README.md"]);
    copy_dir(&fx.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    let bytes = std::fs::read(root.join(NAPAD)).expect("setup: Nápad");
    std::fs::remove_file(root.join(NAPAD)).expect("setup: remove the NFC name");
    std::fs::write(root.join(nfd(NAPAD)), bytes).expect("setup: write the NFD name");
    root
}
pub fn nfd(s: &str) -> String {
    s.chars().flat_map(|c| match c {
        'á' => vec!['a', '\u{301}'],
        c => vec![c],
    }).collect()
}
/// The fixture bytes of a vault path (read-only).
pub fn fx_bytes(rel: &str) -> Vec<u8> {
    std::fs::read(repo_root().join("tests/fixtures/vaults/type-moves").join(rel)).expect("setup: fixture file")
}
pub fn fx(rel: &str) -> String {
    String::from_utf8(fx_bytes(rel)).expect("setup: UTF-8 fixture")
}
/// The fixture text of `rel` with each pair replaced once (each `from` must be in the text).
pub fn fx_swap(rel: &str, pairs: &[(&str, &str)]) -> String {
    let mut t = fx(rel);
    for (a, b) in pairs {
        if !t.contains(a) {
            panic!("setup: {a:?} not in {rel}");
        }
        t = t.replacen(a, b, 1);
    }
    t
}
/// `modified:` blanked (a type change touches it; the L4 clock is the machine's).
pub fn masked(t: &str) -> String {
    t.split_inclusive('\n')
        .map(|l| if l.starts_with("modified:") { if l.ends_with("\r\n") { "modified: <x>\r\n" } else { "modified: <x>\n" } } else { l })
        .collect()
}
pub fn modified_of(t: &str) -> Option<String> {
    t.lines().find(|l| l.starts_with("modified:")).map(|l| l.trim_end().to_string())
}
pub fn is_iso_with_offset(v: &str) -> bool {
    let b = v.as_bytes();
    b.len() == 25 && b[4] == b'-' && b[7] == b'-' && b[10] == b'T' && b[13] == b':' && b[16] == b':' && (b[19] == b'+' || b[19] == b'-') && b[22] == b':'
}

// ------------------------------------------------------------------------------------------------ ops

pub fn content(from: &str) -> PropertyMap {
    PropertyMap { from: from.into(), to: MapTarget::Content }
}
pub fn to_prop(from: &str, to: &str) -> PropertyMap {
    PropertyMap { from: from.into(), to: MapTarget::Property(to.into()) }
}
/// FR-STO-04 AC-6: Kniha → Schůzka with Vydáno → Datum and the rest at R101's defaults.
pub fn duna_mapping() -> Vec<PropertyMap> {
    vec![content("autor"), to_prop("vydáno", "datum"), to_prop("stav", "stav"), content("hodnocení"), content("související"), content("poznámka"), content("isbn")]
}
/// Kniha → Osoba: no Kniha property has a target (R101 "No target").
pub fn kniha_to_osoba() -> Vec<PropertyMap> {
    ["autor", "vydáno", "stav", "hodnocení", "související", "poznámka", "isbn"].iter().map(|k| content(k)).collect()
}
pub fn type_move(paths: &[&str], to: &str, mapping: Vec<PropertyMap>, review: bool) -> JobOp {
    JobOp::TypeMove { paths: paths.iter().map(|p| p.to_string()).collect(), to_type: to.into(), mapping, review }
}
pub fn tidy() -> JobOp {
    JobOp::FolderMove { r#type: None, to_folder: None }
}
pub fn folder_save(r#type: &str, folder: &str) -> JobOp {
    JobOp::FolderMove { r#type: Some(r#type.into()), to_folder: Some(folder.into()) }
}

// ------------------------------------------------------------------------------------------------ expected bytes

/// Plán after › Kniha (FR-STO-04 AC-4, AC-8): `type: kniha`, its own links kept on their targets (`modified` masked).
pub fn plan_moved() -> String {
    masked(&fx_swap(PLAN, &[
        ("type: quick-note", "type: kniha"),
        ("Viz [[Plán cesty]].", "Viz [[Quick Notes/Plán cesty|Plán cesty]]."),
        ("[Rozpis](<Plán cesty.md>)", "[Rozpis](<../Quick Notes/Plán cesty.md>)"),
    ]))
}
/// Odkazy after Plán › Kniha (FR-STO-04 AC-7): only the path forms change; the code span stays.
pub fn odkazy_after_plan() -> String {
    fx_swap(ODKAZY, &[
        ("viz: \"[[Quick Notes/Plán]]\"", "viz: \"[[Knihy/Plán]]\""),
        ("\n[[Quick Notes/Plán]]\n", "\n[[Knihy/Plán]]\n"),
        ("[text](../Quick%20Notes/Plán.md)", "[text](../Knihy/Plán.md)"),
    ])
}
/// Duna after › Schůzka (FR-STO-04 AC-6, board A2), `modified` masked.
pub fn duna_as_schuzka() -> String {
    let t = fx(DUNA);
    let close = t[4..].find("\n---\n").map(|i| i + 4).expect("setup: Duna's frontmatter");
    let body = &t[close + 5..];
    format!(
        "---\nid: 01JB4E0000000000000000E001\ntype: schůzka\ntitle: Duna\ndatum: 1965-08-01\nstav: Dočtená\nnálada: dobrá\ntags: [čtení]\ncreated: 2026-09-01T09:00:00+02:00\nmodified: <x>\n---\n**Autor:** Frank Herbert\n**Hodnocení:** 5\n**Související:** [[Babička]]\n**Poznámka:** Půjčená od Petra\n\n{body}"
    )
}

// ------------------------------------------------------------------------------------------------ files and events

pub fn files_only(s: BTreeSet<String>) -> BTreeSet<String> {
    s.into_iter().filter(|p| !p.ends_with('/')).collect()
}
/// The names in `dir` as raw bytes (to tell NFC from NFD).
pub fn raw_names(dir: &Path) -> Vec<Vec<u8>> {
    use std::os::unix::ffi::OsStrExt;
    std::fs::read_dir(dir).map(|rd| rd.flatten().map(|e| e.file_name().as_bytes().to_vec()).collect()).unwrap_or_default()
}
/// Every zip under `<Application Support>/backups/`, sorted.
pub fn zip_names(dirs: &tegg_vault::AppDirs) -> Vec<String> {
    crate::tags_setup::zips(dirs).iter().map(|p| crate::tags_setup::zip_name(p)).collect()
}
/// `tidy-exempt.json` under `<Application Support>/jobs/<vault-key>/` (ms4-jobs §14.6), parsed; None when absent.
pub fn tidy_exempt(dirs: &tegg_vault::AppDirs) -> Option<serde_json::Value> {
    let jobs = dirs.root.join("jobs");
    for e in std::fs::read_dir(&jobs).into_iter().flatten().flatten() {
        let p = e.path().join("tidy-exempt.json");
        if let Ok(b) = std::fs::read(&p) {
            return serde_json::from_slice(&b).ok();
        }
    }
    None
}
/// Collects `job:progress` events of `kind` until a final one arrives (≤ `ms`); returns them in order.
pub fn progress_until_final(rx: &Receiver<CoreEvent>, kind: JobKind, ms: u64) -> Vec<JobProgress> {
    let end = Instant::now() + Duration::from_millis(ms);
    let mut out = Vec::new();
    while Instant::now() < end {
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(CoreEvent::JobProgress(p)) if p.kind == kind => {
                let fin = p.phase.is_final();
                out.push(p);
                if fin {
                    break;
                }
            }
            _ => {}
        }
    }
    out
}
/// The first job of `kind` seen in `rx` (≤ `ms`).
pub fn first_job_of(rx: &Receiver<CoreEvent>, kind: JobKind, ms: u64) -> Option<JobId> {
    let end = Instant::now() + Duration::from_millis(ms);
    while Instant::now() < end {
        if let Ok(CoreEvent::JobProgress(p)) = rx.recv_timeout(Duration::from_millis(50)) {
            if p.kind == kind {
                return Some(p.job);
            }
        }
    }
    None
}
/// Sets the injected quiet period (ms4-jobs §14.7 `TEGG_TEST_QUIET_MS`) for this test binary; every test of a binary
/// uses the same value, so tests running in parallel threads agree.
pub fn inject_quiet(ms: u64) {
    std::env::set_var("TEGG_TEST_QUIET_MS", ms.to_string());
}
pub fn core_paths(core: &Core) -> BTreeSet<String> {
    core.objects().into_iter().map(|o| tegg_format::nfc(&o.path)).collect()
}
