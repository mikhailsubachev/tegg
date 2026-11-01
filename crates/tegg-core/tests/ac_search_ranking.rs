//! MS3 3D follow-up AC tests at the core (L4): FR-SRC-01 AC-12…AC-16 (file names in search, ranking tiers, D-246,
//! D-253, D-254). docs/acceptance/search-navigation.md; interface docs/contracts/ms3-shell.md §15.1 (additive to
//! ms2-core §2.1). Written from the ACs and the contract only (D-61). AC-17 is superseded by D-1341 (v0.109): its
//! typo order is FR-SRC-01 AC-24, tested in ac_search_title.rs.
//!
//! Fixture: tests/fixtures/vaults/search-ranking + new-empty/.tegg, copied to a temporary directory.
//!
//! The new `SearchResult` fields of §15.1 (`tier`, `file_name`, `MatchField::FileName`) are read through the
//! result's `Debug` text, so this file compiles before they exist and fails on an assertion instead (TS-I1).

mod common;

use std::path::{Path, PathBuf};
use std::time::Duration;

use common::*;
use tegg_core::{Core, CoreOptions, SearchPage, SearchQuery, SearchResult};

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

const LIPNO: &str = "Pages/Lipno víkend.md";
const UCET: &str = "Pages/Účet chaty.md";
const PRESNA: &str = "Pages/Přesná fráze.md";
const OBE: &str = "Pages/Obě slova.md";
const JEDNO: &str = "Pages/Jedno slovo.md";
const DRUHE: &str = "Pages/Druhé slovo.md";
const TRASHED: &str = ".trash/Pages/Lipno účet chaty.md";
const TEMPLATE: &str = "_templates/Page/Lipno šablona.md";

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).expect("setup: create dir");
    for e in std::fs::read_dir(from).expect("setup: read_dir") {
        let e = e.expect("setup: entry");
        if e.file_type().expect("setup: type").is_dir() {
            copy_dir(&e.path(), &to.join(e.file_name()));
        } else {
            std::fs::copy(e.path(), to.join(e.file_name())).expect("setup: copy");
        }
    }
}

/// `tests/fixtures/vaults/search-ranking/` plus `new-empty/.tegg/` in `<sandbox>/Trezor`.
fn ranking_vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Trezor");
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fx.join("search-ranking"), &root);
    copy_dir(&fx.join("new-empty/.tegg"), &root.join(".tegg"));
    root
}

fn open(root: &Path, dirs: &tegg_vault::AppDirs, watch: bool) -> Core {
    let core = ok!(Core::open(root, dirs, CoreOptions { watch, sync: None }), "Core::open");
    assert!(core.wait_idle(Duration::from_secs(60)), "indexing did not become idle within 60 s");
    core
}

fn q(text: &str) -> SearchQuery {
    SearchQuery::text(text, chrono_tz::Europe::Prague)
}

fn page(core: &Core, text: &str) -> SearchPage {
    ok!(core.search(&q(text)), format!("search {text:?}"))
}

fn order(core: &Core, text: &str) -> Vec<String> {
    page(core, text).results.iter().map(|r| tegg_format::nfc(&r.path)).collect()
}

fn sorted(core: &Core, text: &str) -> Vec<String> {
    let mut v = order(core, text);
    v.sort();
    v
}

fn strs(items: &[&str]) -> Vec<String> {
    let mut v: Vec<String> = items.iter().map(|s| s.to_string()).collect();
    v.sort();
    v
}

/// The value of a `Debug` field `name: Value` of the result (first token), or `<missing>` (§15.1 fields).
fn dbg_field(r: &SearchResult, name: &str) -> String {
    let d = format!("{r:?}");
    let key = format!("{name}: ");
    match d.find(&key) {
        Some(i) => d[i + key.len()..].chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect(),
        None => "<missing>".to_string(),
    }
}
fn tier(r: &SearchResult) -> String {
    dbg_field(r, "tier")
}
/// The `Debug` text of `file_name` (`None` or `Some(Snippet { … })`), or `<missing>`.
fn file_name_dbg(r: &SearchResult) -> String {
    let d = format!("{r:?}");
    match d.find("file_name: ") {
        Some(i) => {
            let rest = &d[i + "file_name: ".len()..];
            if rest.starts_with("None") {
                "None".to_string()
            } else {
                // Up to the matching closing parenthesis of `Some(`.
                let mut depth = 0i32;
                let mut out = String::new();
                for c in rest.chars() {
                    out.push(c);
                    if c == '(' {
                        depth += 1;
                    } else if c == ')' {
                        depth -= 1;
                        if depth == 0 {
                            break;
                        }
                    }
                }
                out
            }
        }
        None => "<missing>".to_string(),
    }
}

fn tiers(core: &Core, text: &str) -> Vec<(String, String)> {
    page(core, text).results.iter().map(|r| (tegg_format::nfc(&r.path), tier(r))).collect()
}

fn find<'a>(p: &'a SearchPage, path: &str) -> Option<&'a SearchResult> {
    p.results.iter().find(|r| tegg_format::nfc(&r.path) == path)
}

// ---------------------------------------------------------------- AC-12

#[test]
fn fr_src_01_ac12_file_names_are_searched() {
    let sb = sandbox();
    let root = ranking_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    for text in ["lipno", "LIPNO", "lípno", "vikend"] {
        assert_eq!(sorted(&core, text), strs(&[LIPNO]), "{text:?} returns exactly Lipno víkend (title Dům u vody)");
    }
    for text in ["lipno", "šablona", "smazaný"] {
        let got = order(&core, text);
        assert!(!got.iter().any(|p| p == TRASHED || p == TEMPLATE), "{text:?}: trash and templates never returned: {got:?}");
    }
    for text in ["md", "Pages"] {
        assert_eq!(order(&core, text), Vec::<String>::new(), "{text:?}: only the stem is matched (AP-186)");
    }
}

// ---------------------------------------------------------------- AC-13

#[test]
fn fr_src_01_ac13_nfd_rename_external_rename_no_writes_and_rebuild() {
    let sb = sandbox();
    let root = ranking_vault(&sb);
    let core = open(&root, &sb.dirs, true);
    assert_eq!(sorted(&core, "lipno"), strs(&[LIPNO]), "red guard: file names are searched (AC-12)");
    let nfd_name = "Pages/Li\u{301}pno vi\u{301}kend.md";
    ok!(std::fs::rename(root.join(LIPNO), root.join(nfd_name)), "rename to NFD");
    let seen = wait_until(Duration::from_secs(2), || sorted(&core, "lípno") == strs(&["Pages/Lípno víkend.md"]));
    assert!(seen.is_some(), "NFC query lípno returns the NFD-named file within 2 s: {:?}", order(&core, "lípno"));

    ok!(std::fs::rename(root.join(nfd_name), root.join("Pages/Chata.md")), "external rename to Chata.md");
    let moved = wait_until(Duration::from_secs(2), || {
        !order(&core, "lipno").iter().any(|p| p.ends_with("pno víkend.md")) && order(&core, "chata").contains(&"Pages/Chata.md".to_string())
    });
    assert!(moved.is_some(), "after the rename lipno: {:?}, chata: {:?}", order(&core, "lipno"), order(&core, "chata"));
    assert_eq!(order(&core, "lipno"), Vec::<String>::new(), "lipno no longer returns it");
    assert_eq!(ok!(core.object("Pages/Chata.md").ok_or("no object"), "object").id.as_deref(), Some("01JB0R00000000000000000R06"), "same id");

    // Searching writes nothing (FR-SRC-01 AC-10).
    let before = snapshot(&root);
    for text in ["lipno", "chata", "účet chaty", "\"účet chaty\"", "účet chatty", "účet chaty -opravy", "md"] {
        let _ = core.search(&q(text));
    }
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(snapshot(&root), before, "searching writes nothing");

    // Rebuild: delete the index and reopen; AC-12 gives the same results (AR-01).
    ok!(std::fs::rename(root.join("Pages/Chata.md"), root.join(LIPNO)), "rename back");
    assert!(wait_until(Duration::from_secs(2), || sorted(&core, "lipno") == strs(&[LIPNO])).is_some(), "renamed back");
    let ac12 = |c: &Core| ["lipno", "LIPNO", "lípno", "vikend", "md", "Pages"].iter().map(|t| (t.to_string(), order(c, t))).collect::<Vec<_>>();
    let before = ac12(&core);
    let local = core.vault().local_dir();
    drop(core);
    ok!(std::fs::remove_dir_all(&local), "delete index dir");
    let core = open(&root, &sb.dirs, false);
    assert_eq!(ac12(&core), before, "identical after a rebuild");
}

// ---------------------------------------------------------------- AC-14 (offsets, L4)

#[test]
fn fr_src_01_ac14_file_name_snippet_and_offsets() {
    let sb = sandbox();
    let root = ranking_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let p = page(&core, "lipno");
    let r = match find(&p, LIPNO) {
        Some(r) => r,
        None => {
            assert!(false, "lipno returns Lipno víkend: {:?}", order(&core, "lipno"));
            unreachable!()
        }
    };
    assert_eq!(r.title, "Dům u vody");
    assert_eq!(format!("{:?}", r.matched_in), "FileName", "matched_in FileName (§15.1)");
    assert!(
        file_name_dbg(r).starts_with("Some(Snippet { text: \"Lipno víkend\", highlights: [(0, 5)], line: 0"),
        "file_name: the stem with `Lipno` highlighted by offsets, got {}",
        file_name_dbg(r)
    );
    let s = match &r.snippet {
        Some(s) => s,
        None => {
            assert!(false, "a FileName hit still has the body snippet");
            unreachable!()
        }
    };
    assert!(s.text.starts_with("Vzít s sebou deky."), "snippet is the start of the body: {:?}", s.text);
    assert_eq!(s.highlights, Vec::<(usize, usize)>::new(), "no highlight in the snippet");
    // A result whose title also matches has no file-name line.
    let p = page(&core, "účet");
    match find(&p, UCET) {
        Some(r) => {
            assert_eq!(format!("{:?}", r.matched_in), "Title");
            assert_eq!(file_name_dbg(r), "None", "title match: no file_name");
        }
        None => assert!(false, "účet returns Účet chaty"),
    }
}

// ---------------------------------------------------------------- AC-15

fn ac15_check(core: &Core, text: &str) {
    let got = tiers(core, text);
    let paths: Vec<&str> = got.iter().map(|(p, _)| p.as_str()).collect();
    assert_eq!(paths.len(), 5, "{text:?}: five results, got {paths:?}");
    assert_eq!(&paths[..3], &[UCET, PRESNA, OBE], "{text:?}: tier 1 title, tier 1 body, tier 2");
    let mut last: Vec<&str> = paths[3..].to_vec();
    last.sort();
    assert_eq!(last, vec![DRUHE, JEDNO], "{text:?}: tier 3 (any order)");
    let t: Vec<&str> = got.iter().map(|(_, t)| t.as_str()).collect();
    assert_eq!(t, vec!["Phrase", "Phrase", "AllWords", "AnyWord", "AnyWord"], "{text:?}: tiers");
}

#[test]
fn fr_src_01_ac15_ranking_tiers() {
    let sb = sandbox();
    let root = ranking_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    ac15_check(&core, "účet chaty");
}

#[test]
fn fr_src_01_ac15_folded_nfd_and_upper_case_queries_give_the_same_order() {
    let sb = sandbox();
    let root = ranking_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let base = order(&core, "účet chaty");
    for text in ["ucet chaty", "U\u{301}c\u{30C}et chaty", "ÚČET CHATY"] {
        ac15_check(&core, text);
        assert_eq!(order(&core, text), base, "{text:?}: same order as účet chaty");
    }
}

// ---------------------------------------------------------------- AC-16

#[test]
fn fr_src_01_ac16_quoted_phrase_is_strict() {
    let sb = sandbox();
    let root = ranking_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let got = tiers(&core, "\"účet chaty\"");
    assert_eq!(got, vec![(UCET.to_string(), "Phrase".to_string()), (PRESNA.to_string(), "Phrase".to_string())], "exactly the phrase, title first");
}

#[test]
fn fr_src_01_ac16_exclusion_keeps_the_tiers() {
    let sb = sandbox();
    let root = ranking_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let got = tiers(&core, "účet chaty -opravy");
    let paths: Vec<&str> = got.iter().map(|(p, _)| p.as_str()).collect();
    assert_eq!(paths, vec![UCET, PRESNA, OBE, JEDNO], "the AC-15 order without Druhé slovo");
    let t: Vec<&str> = got.iter().map(|(_, t)| t.as_str()).collect();
    assert_eq!(t, vec!["Phrase", "Phrase", "AllWords", "AnyWord"]);
}

#[test]
fn fr_src_01_ac16_single_word_has_one_tier_and_d107_order() {
    let sb = sandbox();
    let root = ranking_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let p = page(&core, "účet");
    let paths: Vec<String> = p.results.iter().map(|r| tegg_format::nfc(&r.path)).collect();
    let mut set = paths.clone();
    set.sort();
    assert_eq!(set, strs(&[UCET, PRESNA, OBE, JEDNO]), "single word: the notes containing it");
    assert_eq!(paths[0], UCET, "title match first (D-107)");
    for r in &p.results {
        assert_eq!(tier(r), "Phrase", "{}: a single-word query is one tier", r.path);
    }
    let fields: Vec<String> = p.results.iter().map(|r| format!("{:?}", r.matched_in)).collect();
    let rank = |f: &str| match f {
        "Title" | "FileName" => 0,
        "Alias" => 1,
        "Attribute" => 2,
        _ => 3,
    };
    assert!(fields.windows(2).all(|w| rank(&w[0]) <= rank(&w[1])), "title, then attribute, then body: {fields:?}");
}
