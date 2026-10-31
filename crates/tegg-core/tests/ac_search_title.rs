//! Search without `Go to` (preview v0.109 feedback; D-1340…D-1343), L4 (core `index.search` on a temporary vault):
//! docs/acceptance/search-navigation.md § "Search without `Go to`" FR-SRC-01 AC-23…AC-25 (title first, D-1341) and
//! FR-SRC-04 AC-8…AC-11 (the last word as a prefix, D-1342). Interface docs/contracts/v1-search.md §9.1 (no new API:
//! `Core::search` and the `SearchResult` fields of §1). Written from the ACs and the contract only (D-61).
//!
//! Vaults: `search-ranking/` + `new-empty/.tegg/` plus the `search-title/` runtime notes of the AC table (FR-SRC-01
//! AC-23); `search-ranking/` alone (AC-24, AC-25); `search/` + `new-empty/.tegg/` (FR-SRC-04); `search/` +
//! `search-page/` + `new-empty/.tegg/` (AC-25's filter part, D-1222). TZ Europe/Prague as a query parameter.
//!
//! The AC-25 tests check orders the MS3 build already gives; each also holds a red guard on the same vault (a D-1342
//! prefix query), so it is red before the build for an assertion (TS-I1), as `fr_src_01_ac13_*` did.
//!
//! FR-SRC-04 AC-11 is a latency AC: it runs at G2 nightly, not in the push gate (D-343, D-1228; `qa.config.json` skips
//! `fr_src_04_ac11_` in `core-rust-test` and runs it in `core-perf-search-ac`).

mod common;
mod search_page_setup;

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use common::*;
use search_page_setup::{page_vault, utf16, BOUDA, CHATA, POZDNI};
use tegg_core::{Core, CoreOptions, MatchField, SearchPage, SearchQuery, SearchResult};

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

// search-ranking/ (FR-SRC-01 AC-12…AC-17).
const UCET: &str = "Pages/Účet chaty.md";
const PRESNA: &str = "Pages/Přesná fráze.md";
const OBE: &str = "Pages/Obě slova.md";
const JEDNO: &str = "Pages/Jedno slovo.md";
const DRUHE: &str = "Pages/Druhé slovo.md";
const LIPNO: &str = "Pages/Lipno víkend.md";
const PREKLEP: &str = "Pages/Překlep.md";

// search-title/ runtime notes (FR-SRC-01 AC-23's table).
const ROVNO: &str = "Pages/Rovno.md";
const FRAZE: &str = "Pages/Fráze.md";
const SLOVA: &str = "Pages/Slova.md";
const ALIAS: &str = "Pages/Alias.md";
const TELO: &str = "Pages/Tělo.md";
const REKA: &str = "Pages/Řeka.md";
const DENIK: &str = "Pages/Summer Ångström log.md";

// FR-SRC-04 AC-10's runtime notes on search/.
const SUL: &str = "Pages/Sůl.md";
const SULOVA: &str = "Pages/Sůlová lázeň.md";

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

/// A runtime note: `type: page`, an `id`, `modified: 2026-10-01T09:00:00+02:00` (AC-23's table), the title, the aliases
/// and the body as given.
fn note(id: &str, title: &str, aliases: &[&str], body: &str) -> String {
    let mut s = format!("---\nid: {id}\ntype: page\ntitle: {title}\n");
    if !aliases.is_empty() {
        s.push_str("aliases:\n");
        for a in aliases {
            s.push_str(&format!("  - {a}\n"));
        }
    }
    s.push_str("created: 2026-10-01T09:00:00+02:00\nmodified: 2026-10-01T09:00:00+02:00\n---\n");
    s.push_str(body);
    s.push('\n');
    s
}

/// `search-ranking/` + `new-empty/.tegg/` + the seven `search-title/` notes of FR-SRC-01 AC-23.
fn title_vault(sb: &Sandbox) -> PathBuf {
    let root = ranking_vault(sb);
    let notes: [(&str, &str, &str, &[&str], &str); 7] = [
        (ROVNO, "01JB0T00000000000000000T01", "Summer Ångström", &[], "Plain text."),
        (FRAZE, "01JB0T00000000000000000T02", "Summer Ångström old by", &[], "Nothing here."),
        (SLOVA, "01JB0T00000000000000000T03", "Ångström notes for summer", &[], "Other words."),
        (ALIAS, "01JB0T00000000000000000T04", "Výlet", &["Summer Ångström trip"], "Plain text."),
        (TELO, "01JB0T00000000000000000T05", "Goal Ångström budget", &[], "Zürich summer Ångström. Summer Ångström again, summer Ångström."),
        (REKA, "01JB0T00000000000000000T06", "River summer quarter", &[], "Later ångström appears."),
        (DENIK, "01JB0T00000000000000000T07", "Deník", &[], "Plain text."),
    ];
    for (path, id, title, aliases, body) in notes {
        write_raw(&root, path, note(id, title, aliases, body).as_bytes());
    }
    root
}

fn open(root: &Path, dirs: &tegg_vault::AppDirs) -> Core {
    let core = ok!(Core::open(root, dirs, CoreOptions { watch: false, sync: None }), "Core::open");
    assert!(core.wait_idle(Duration::from_secs(600)), "indexing did not become idle");
    core
}

fn q(text: &str) -> SearchQuery {
    SearchQuery::text(text, chrono_tz::Europe::Prague)
}
fn typed(text: &str, ty: &str) -> SearchQuery {
    let mut x = q(text);
    x.types = vec![ty.to_string()];
    x
}
fn tagged(tags: &[&str]) -> SearchQuery {
    let mut x = q("");
    x.tags = tags.iter().map(|s| s.to_string()).collect();
    x
}
fn page_of(core: &Core, query: &SearchQuery) -> SearchPage {
    ok!(core.search(query), format!("search {:?} types {:?} tags {:?}", query.text, query.types, query.tags))
}
fn page(core: &Core, text: &str) -> SearchPage {
    page_of(core, &q(text))
}
fn order_of(core: &Core, query: &SearchQuery) -> Vec<String> {
    page_of(core, query).results.iter().map(|r| tegg_format::nfc(&r.path)).collect()
}
fn order(core: &Core, text: &str) -> Vec<String> {
    order_of(core, &q(text))
}
fn set_of(v: &[String]) -> BTreeSet<String> {
    v.iter().cloned().collect()
}
fn set(items: &[&str]) -> BTreeSet<String> {
    items.iter().map(|s| s.to_string()).collect()
}
fn find<'a>(p: &'a SearchPage, path: &str) -> Option<&'a SearchResult> {
    p.results.iter().find(|r| tegg_format::nfc(&r.path) == path)
}

// ---------------------------------------------------------------- FR-SRC-01 AC-23

/// `summer angstrom`: Rovno; {Fráze, Deník}; Slova; Alias; Tělo; Řeka.
fn ac23_forward(got: &[String], what: &str) {
    assert_eq!(got.len(), 7, "{what}: the seven search-title notes, got {got:?}");
    assert_eq!(got[0], ROVNO, "{what}: the title equal to the query first (group 1, step a): {got:?}");
    assert_eq!(set_of(&got[1..3]), set(&[FRAZE, DENIK]), "{what}: then the phrase in the title or the file name (step b): {got:?}");
    assert_eq!(got[3], SLOVA, "{what}: then all words in the title, not as a phrase (step c): {got:?}");
    assert_eq!(got[4], ALIAS, "{what}: then the alias with every word (group 2): {got:?}");
    assert_eq!(got[5], TELO, "{what}: then the body phrase with one word in the title, below every group-1 and group-2 note: {got:?}");
    assert_eq!(got[6], REKA, "{what}: then both words, not as a phrase: {got:?}");
}

/// `ANGSTROM SUMMER`: {Rovno, Fráze, Deník, Slova}; Alias; Tělo; Řeka.
fn ac23_reversed(got: &[String], what: &str) {
    assert_eq!(got.len(), 7, "{what}: the seven search-title notes, got {got:?}");
    assert_eq!(set_of(&got[..4]), set(&[ROVNO, FRAZE, DENIK, SLOVA]), "{what}: one step of every title or file name holding both words: {got:?}");
    assert_eq!(&got[4..], &[ALIAS.to_string(), TELO.to_string(), REKA.to_string()], "{what}: then Alias, Tělo, Řeka: {got:?}");
}

#[test]
fn fr_src_01_ac23_title_then_alias_then_the_rest() {
    let sb = sandbox();
    let root = title_vault(&sb);
    let core = open(&root, &sb.dirs);
    ac23_forward(&order(&core, "summer angstrom"), "summer angstrom");
    let p = page(&core, "summer angstrom");
    let field = |path: &str| find(&p, path).map(|r| format!("{:?}", r.matched_in)).unwrap_or_else(|| "<not returned>".into());
    assert_eq!(field(ROVNO), format!("{:?}", MatchField::Title), "a group-1 result matched in the title (v1-search §9.1)");
    assert_eq!(field(DENIK), format!("{:?}", MatchField::FileName), "Deník holds the words in its file name only");
    assert_eq!(field(ALIAS), format!("{:?}", MatchField::Alias), "a group-2 result matched in an alias");
}

#[test]
fn fr_src_01_ac23_reversed_words_form_one_step() {
    let sb = sandbox();
    let root = title_vault(&sb);
    let core = open(&root, &sb.dirs);
    ac23_reversed(&order(&core, "ANGSTROM SUMMER"), "ANGSTROM SUMMER");
}

#[test]
fn fr_src_01_ac23_nfd_query_gives_the_same_order() {
    let sb = sandbox();
    let root = title_vault(&sb);
    let core = open(&root, &sb.dirs);
    let nfc = order(&core, "summer angstrom");
    ac23_forward(&nfc, "summer angstrom");
    let nfd = "summer A\u{30A}ngstro\u{308}m";
    assert_ne!(nfd, "summer Ångström", "setup: the query is NFD");
    assert_eq!(order(&core, nfd), order(&core, "summer Ångström"), "the NFD query gives the NFC query's order");
    ac23_forward(&order(&core, nfd), "NFD summer Ångström");
    ac23_reversed(&order(&core, "A\u{30A}NGSTRO\u{308}M SUMMER"), "NFD ÅNGSTRÖM SUMMER");
}

// ---------------------------------------------------------------- FR-SRC-01 AC-24

#[test]
fn fr_src_01_ac24_typo_matches_inside_the_groups() {
    // Without Překlep: AC-15's order (a typo-matched word counts as matched).
    let sb = sandbox();
    let root = ranking_vault(&sb);
    let core = open(&root, &sb.dirs);
    let got = order(&core, "účet chatty");
    assert_eq!(got.len(), 5, "without Překlep: the AC-15 set, got {got:?}");
    assert_eq!(&got[..3], &[UCET.to_string(), PRESNA.to_string(), OBE.to_string()], "without Překlep: AC-15's order");
    assert_eq!(set_of(&got[3..]), set(&[JEDNO, DRUHE]), "without Překlep: then the two one-word notes");
    drop(core);

    // With Překlep (body `Účet chatty.`).
    let sb = sandbox();
    let root = ranking_vault(&sb);
    write_raw(
        &root,
        PREKLEP,
        "---\nid: 01JB0R00000000000000000R08\ntype: page\ntitle: Překlep\ncreated: 2026-10-01T09:00:00+02:00\nmodified: 2026-10-01T09:00:00+02:00\n---\nÚčet chatty.\n".as_bytes(),
    );
    let core = open(&root, &sb.dirs);
    let p = page(&core, "účet chatty");
    let got: Vec<String> = p.results.iter().map(|r| tegg_format::nfc(&r.path)).collect();
    assert_eq!(got.len(), 6, "six results, got {got:?}");
    assert_eq!(
        &got[..4],
        &[UCET.to_string(), PREKLEP.to_string(), PRESNA.to_string(), OBE.to_string()],
        "Účet chaty (title holds both words, `chaty` by a typo: group 1), then Překlep (exact body phrase), Přesná fráze (body phrase, typo), Obě slova"
    );
    assert_eq!(set_of(&got[4..]), set(&[JEDNO, DRUHE]), "then Jedno slovo and Druhé slovo");
    assert_eq!(find(&p, UCET).map(|r| r.typo), Some(true), "Účet chaty is a typo match (D-101)");
    assert_eq!(find(&p, PREKLEP).map(|r| r.typo), Some(false), "Překlep matches exactly");
}

// ---------------------------------------------------------------- FR-SRC-01 AC-25

#[test]
fn fr_src_01_ac25_ac15_and_ac16_orders_still_hold() {
    let sb = sandbox();
    let root = ranking_vault(&sb);
    let core = open(&root, &sb.dirs);
    // Red guard (D-1342) on the same vault: `lipn` finds Lipno víkend through the prefix of its file name.
    assert_eq!(order(&core, "lipn"), vec![LIPNO.to_string()], "red guard: the last word matches as a prefix (FR-SRC-04 AC-8)");
    for text in ["účet chaty", "ucet chaty", "U\u{301}c\u{30C}et chaty", "ÚČET CHATY"] {
        let got = order(&core, text);
        assert_eq!(got.len(), 5, "{text:?}: five results, got {got:?}");
        assert_eq!(&got[..3], &[UCET.to_string(), PRESNA.to_string(), OBE.to_string()], "{text:?}: AC-15's order");
        assert_eq!(set_of(&got[3..]), set(&[JEDNO, DRUHE]), "{text:?}: tier 3");
    }
    assert_eq!(order(&core, "\"účet chaty\""), vec![UCET.to_string(), PRESNA.to_string()], "AC-16: the quoted phrase, title first");
    assert_eq!(
        order(&core, "účet chaty -opravy"),
        vec![UCET.to_string(), PRESNA.to_string(), OBE.to_string(), JEDNO.to_string()],
        "AC-16: the AC-15 order without Druhé slovo"
    );
    let single = order(&core, "účet");
    assert_eq!(set_of(&single), set(&[UCET, PRESNA, OBE, JEDNO]), "AC-16: `účet` returns the notes containing it");
    assert_eq!(single[0], UCET, "AC-16: the title match first (D-107)");
}

#[test]
fn fr_src_01_ac25_type_filter_and_filter_only_orders_hold() {
    let sb = sandbox();
    let root = page_vault(&sb);
    assert!(root.is_some(), "setup: copy search/ + search-page/ + new-empty/.tegg/");
    let root = root.unwrap_or_default();
    let core = open(&root, &sb.dirs);
    // Red guard (D-1342) on the same vault: `rozpo` with `Type: Page` finds the pages holding `rozpočet`.
    assert_eq!(
        set_of(&order_of(&core, &typed("rozpo", "page"))),
        set(&[ROZPOCET, PROJEKT, OBYCEJNA]),
        "red guard: `rozpo` matches `rozpočet` as a prefix (FR-SRC-04 AC-8)"
    );
    // FR-SRC-02 AC-14: `rozpočet` with Type: Page keeps the order `rozpočet` alone gives.
    let alone: Vec<String> = order(&core, "rozpočet").into_iter().filter(|p| [ROZPOCET, PROJEKT, OBYCEJNA].contains(&p.as_str())).collect();
    assert_eq!(alone.len(), 3, "setup: `rozpočet` alone returns the three pages: {alone:?}");
    assert_eq!(order_of(&core, &typed("rozpočet", "page")), alone, "rozpočet + Type: Page: the order of `rozpočet` alone");
    // FR-SRC-02 AC-15 (D-1205): filter-only order unchanged.
    assert_eq!(order_of(&core, &tagged(&["hory"])), vec![CHATA, POZDNI, BOUDA], "#hory: newest modified first");
    assert_eq!(
        order_of(&core, &typed("", "page")),
        vec![CHATA, BOUDA, CTENI, ROZPOCET, PROJEKT, OBYCEJNA],
        "Type: Page without text: newest modified first, none last"
    );
}

// ---------------------------------------------------------------- FR-SRC-04 AC-8

const AC1_SET: [&str; 5] = [ROZPOCET, PROJEKT, TOMAS, NAPAD, OBYCEJNA];

#[test]
fn fr_src_04_ac8_prefix_of_the_last_word() {
    let sb = sandbox();
    let root = search_vault(&sb);
    let core = open(&root, &sb.dirs);
    let got = order(&core, "rozpo");
    assert_eq!(set_of(&got), set(&AC1_SET), "rozpo returns the FR-SRC-01 AC-1 set: {got:?}");
    assert_eq!(set_of(&got[..2.min(got.len())]), set(&[ROZPOCET, PROJEKT]), "Rozpočet and Projekt (title words starting rozpo) first: {got:?}");
    for text in ["cten", "CTEN", "čten", "c\u{30C}ten"] {
        assert_eq!(order(&core, text), vec![CTENI.to_string()], "{text:?} returns {{Čtení}}");
    }
}

#[test]
fn fr_src_04_ac8_two_words_with_a_prefix_last() {
    let sb = sandbox();
    let root = search_vault(&sb);
    let core = open(&root, &sb.dirs);
    let got = order(&core, "rozpočet pro");
    assert_eq!(got.len(), 5, "rozpočet pro: five results, got {got:?}");
    assert_eq!(got[0], PROJEKT, "Projekt first: its title holds both words (`pro` as the prefix of Projekt): {got:?}");
    assert_eq!(set_of(&got[1..3]), set(&[ROZPOCET, TOMAS]), "then the body phrase `rozpočet projektu`: {got:?}");
    assert_eq!(set_of(&got[3..]), set(&[NAPAD, OBYCEJNA]), "then `rozpočet` only: {got:?}");
}

// ---------------------------------------------------------------- FR-SRC-04 AC-9

#[test]
fn fr_src_04_ac9_when_the_prefix_rule_does_not_apply() {
    let sb = sandbox();
    let root = search_vault(&sb);
    let core = open(&root, &sb.dirs);
    // Red guard: the rule itself (AC-8).
    assert_eq!(set_of(&order(&core, "rozpo")), set(&AC1_SET), "red guard: `rozpo` matches as a prefix");
    assert_eq!(order(&core, "rozpo "), Vec::<String>::new(), "a trailing space: no word `rozpo`, no result");
    assert_eq!(order(&core, "r"), Vec::<String>::new(), "a one-letter last word isn't a prefix");
    assert_eq!(order(&core, "\"rozpo\""), Vec::<String>::new(), "a quoted word is never a prefix");
    assert_eq!(
        set_of(&order(&core, "rozpo výlet")),
        set(&[ROZPOCET, TOMAS, NAPAD]),
        "only the last word: `výlet` (and Tomáš's `výletu` as a prefix); `rozpo` matches nothing"
    );
    assert_eq!(set_of(&order(&core, "rozpočet -kr")), set(&AC1_SET), "an excluded word is whole-word: `-kr` excludes nothing");
    assert_eq!(order(&core, "kus"), Vec::<String>::new(), "kus: no word starts with kus (FR-SRC-04 AC-5)");
}

// ---------------------------------------------------------------- FR-SRC-04 AC-10

#[test]
fn fr_src_04_ac10_exact_before_prefix_no_typo_flag_and_prefix_highlight() {
    let sb = sandbox();
    let root = search_vault(&sb);
    write_raw(&root, SUL, note("01JA0S0000000000000000S0S1", "Sůl", &[], "Kuchyně.").as_bytes());
    write_raw(&root, SULOVA, note("01JA0S0000000000000000S0S2", "Sůlová lázeň", &[], "Koupel.").as_bytes());
    let core = open(&root, &sb.dirs);
    let p = page(&core, "sůl");
    let got: Vec<String> = p.results.iter().map(|r| tegg_format::nfc(&r.path)).collect();
    assert_eq!(got, vec![SUL.to_string(), SULOVA.to_string()], "sůl: the exact word before the prefix-only match");
    assert_eq!(find(&p, SULOVA).map(|r| r.typo), Some(false), "a prefix-only match is not a typo");
    assert_eq!(find(&p, SUL).map(|r| r.typo), Some(false), "an exact match is not a typo");
    let p = page(&core, "cten");
    match find(&p, CTENI) {
        Some(r) => {
            assert_eq!(r.title, "Čtení knih");
            assert_eq!(utf16(&r.title, &r.title_highlights), Some(vec![(0, 4)]), "the title highlight covers the matched prefix `Čten` only");
            assert!(!r.typo, "cten: no typo flag");
        }
        None => assert!(false, "cten returns Čtení: {:?}", got_paths(&p)),
    }
}

fn got_paths(p: &SearchPage) -> Vec<String> {
    p.results.iter().map(|r| r.path.clone()).collect()
}

// ---------------------------------------------------------------- FR-SRC-04 AC-11 (latency, G2 nightly, D-343)

fn fields_ok(r: &SearchResult) -> bool {
    // FR-SRC-01 AC-18…AC-20's fields are typed fields of SearchResult (v1-search §1); a `modified` that is set parses.
    r.modified.as_deref().map_or(true, |m| chrono::DateTime::parse_from_rfc3339(m).is_ok())
        && r.tags.iter().all(|t| t == &tegg_format::nfc(t))
        && r.alias.is_some() == (r.matched_in == MatchField::Alias)
        && r.attribute.is_some() == (r.matched_in == MatchField::Attribute)
}

#[test]
fn fr_src_04_ac11_keystroke_queries_within_target() {
    let vault = reference_vault();
    let sb = sandbox();
    let core = open(&vault, &sb.dirs);
    let limit = target(Duration::from_millis(200), 0.75);
    let mut bad: Vec<String> = Vec::new();
    for text in ["s", "su", "sum", "summ", "summe", "summer", "summer a", "summer an"] {
        let p = page(&core, text);
        if p.results.len() != 50 {
            bad.push(format!("{text:?}: first page of {} results, want 50 (total {})", p.results.len(), p.total));
        }
        if let Some(r) = p.results.iter().find(|r| !fields_ok(r)) {
            bad.push(format!("{text:?}: {} lacks a field of FR-SRC-01 AC-18…AC-20", r.path));
        }
        let mut lat = Vec::with_capacity(20);
        for _ in 0..20 {
            let t = Instant::now();
            let r = core.search(&q(text));
            lat.push(t.elapsed());
            assert!(r.is_ok(), "{text:?}: search failed: {:?}", r.err());
        }
        let got = p95(&mut lat);
        println!("FR-SRC-04 AC-11 {text:?} p95: {:.1} ms (limit {:.1} ms)", got.as_secs_f64() * 1e3, limit.as_secs_f64() * 1e3);
        if got >= limit {
            bad.push(format!("{text:?}: p95 {got:?} ≥ {limit:?} (NFR-PERF-04)"));
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "every keystroke query returns its first page within the NFR-PERF-04 core target");
}
