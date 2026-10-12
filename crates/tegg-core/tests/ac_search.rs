//! MS2 AC tests: FR-SRC-01…04 full-text search, filters, results, operators (docs/acceptance/search-navigation.md),
//! FR-FMT-12 AC-4 (search part). Written from the ACs and docs/contracts/ms2-core.md only (D-61).
//! Fixture: tests/fixtures/vaults/search + new-empty/.tegg, copied to a temp dir. TZ is a query parameter.

mod common;

use std::collections::BTreeSet;
use std::time::Duration;

use chrono::NaiveDate;
use chrono_tz::Tz;
use common::*;
use tegg_core::{AttrFilter, Core, CoreOptions, DateRange, MatchField, SearchPage, SearchQuery};

const PRAGUE: Tz = chrono_tz::Europe::Prague;
const NEW_YORK: Tz = chrono_tz::America::New_York;

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

fn open_core(root: &std::path::Path, dirs: &tegg_vault::AppDirs, watch: bool) -> Core {
    let core = ok!(Core::open(root, dirs, CoreOptions { watch, sync: None }), "Core::open");
    assert!(core.wait_idle(Duration::from_secs(60)), "indexing did not become idle within 60 s");
    core
}

fn fixture() -> (Sandbox, std::path::PathBuf, Core) {
    let sb = sandbox();
    let root = search_vault(&sb);
    let core = open_core(&root, &sb.dirs, false);
    (sb, root, core)
}

fn q(text: &str) -> SearchQuery {
    SearchQuery::text(text, PRAGUE)
}

fn page(core: &Core, query: &SearchQuery) -> SearchPage {
    ok!(core.search(query), format!("search {:?}", query.text))
}

fn paths(core: &Core, query: &SearchQuery) -> BTreeSet<String> {
    let p = page(core, query);
    let list: Vec<String> = p.results.iter().map(|r| r.path.clone()).collect();
    let set: BTreeSet<String> = list.iter().cloned().collect();
    assert_eq!(set.len(), list.len(), "one result per object (D-107): {list:?}");
    set
}

fn set(items: &[&str]) -> BTreeSet<String> {
    items.iter().map(|s| s.to_string()).collect()
}

fn ac1_set() -> BTreeSet<String> {
    set(&[ROZPOCET, PROJEKT, TOMAS, NAPAD, OBYCEJNA])
}

fn day(y: i32, m: u32, d: u32) -> NaiveDate {
    match NaiveDate::from_ymd_opt(y, m, d) {
        Some(x) => x,
        None => {
            assert!(false, "bad date");
            unreachable!()
        }
    }
}

fn one_day(d: NaiveDate) -> Option<DateRange> {
    Some(DateRange { from: d, to: d })
}

// ---------------------------------------------------------------- FR-SRC-01

#[test]
fn fr_src_01_ac1_title_and_body_matches_and_untyped_file() {
    let (_sb, _root, core) = fixture();
    assert_eq!(paths(&core, &q("rozpočet")), ac1_set());
}

#[test]
fn fr_src_01_ac2_title_only_match() {
    let (_sb, _root, core) = fixture();
    assert_eq!(paths(&core, &q("Tomášovi")), set(&[TOMAS]));
}

#[test]
fn fr_src_01_ac3_attribute_value_match() {
    let (_sb, _root, core) = fixture();
    let p = page(&core, &q("High"));
    assert_eq!(p.results.iter().map(|r| r.path.as_str()).collect::<Vec<_>>(), vec![TOMAS]);
    assert_eq!(p.results[0].matched_in, MatchField::Attribute);
}

#[test]
fn fr_src_01_ac4_alias_match() {
    let (_sb, _root, core) = fixture();
    let p = page(&core, &q("Reading"));
    assert_eq!(p.results.iter().map(|r| r.path.as_str()).collect::<Vec<_>>(), vec![CTENI]);
    assert_eq!(p.results[0].matched_in, MatchField::Alias);
}

#[test]
fn fr_src_01_ac5_templates_and_trash_are_never_returned() {
    let (_sb, _root, core) = fixture();
    assert_eq!(paths(&core, &q("meruňkách")), set(&[CTENI]));
    for text in ["rozpočet", "výlet", "meruňky", "Šablona", "Smazaný", "smazaná poznámka", "rozpocet", "page"] {
        let got = paths(&core, &q(text));
        assert!(!got.contains(TEMPLATE) && !got.contains(TRASHED), "{text}: {got:?}");
    }
    // A filter-only query must not return them either.
    let mut types = q("");
    types.types = vec!["page".into()];
    let got = paths(&core, &types);
    assert_eq!(got, set(&[CTENI, ROZPOCET, PROJEKT, OBYCEJNA]));
}

#[test]
fn fr_src_01_ac6_frontmatter_keys_are_not_searchable() {
    let (_sb, _root, core) = fixture();
    assert_eq!(paths(&core, &q("rozpočet")), ac1_set(), "positive control");
    for text in ["modified", "aliases", "created", "tags", "title"] {
        assert_eq!(paths(&core, &q(text)), BTreeSet::new(), "{text}");
    }
}

#[test]
fn fr_src_01_ac7_nfd_query_and_nfd_file_are_found() {
    let sb = sandbox();
    let root = search_vault(&sb);
    // Rewrite the Nápad file in NFD (content and file name stay; only the bytes are decomposed).
    let text = std::fs::read_to_string(root.join(NAPAD)).unwrap_or_default();
    let nfd: String = text.replace("Krkonoš", "Krkonos\u{30C}").replace("Výlet", "Vy\u{301}let");
    write_raw(&root, NAPAD, nfd.as_bytes());
    let core = open_core(&root, &sb.dirs, false);
    let nfd_query = "rozpoc\u{30C}et";
    assert_eq!(paths(&core, &q(nfd_query)), ac1_set());
    assert_eq!(paths(&core, &q("Krkonoš")), set(&[NAPAD]));
}

fn ac1_to_ac7_results(core: &Core) -> Vec<(String, Vec<String>)> {
    let queries = ["rozpočet", "Tomášovi", "High", "Reading", "meruňkách", "modified", "aliases", "rozpoc\u{30C}et"];
    queries
        .iter()
        .map(|t| {
            let p = page(core, &q(t));
            (t.to_string(), p.results.iter().map(|r| format!("{}|{:?}|{}", r.path, r.matched_in, r.title)).collect())
        })
        .collect()
}

#[test]
fn fr_src_01_ac8_results_identical_after_index_rebuild() {
    let sb = sandbox();
    let root = search_vault(&sb);
    let core = open_core(&root, &sb.dirs, false);
    assert_eq!(paths(&core, &q("rozpočet")), ac1_set(), "positive control before rebuild");
    let before = ac1_to_ac7_results(&core);
    let local = core.vault().local_dir();
    drop(core);
    assert!(local.exists(), "the index lives in the machine-local dir {local:?}");
    ok!(std::fs::remove_dir_all(&local), "delete index dir");
    let core = open_core(&root, &sb.dirs, false);
    assert_eq!(ac1_to_ac7_results(&core), before);
}

#[test]
fn fr_src_01_ac9_external_edit_and_delete_reflected_within_2_s() {
    let sb = sandbox();
    let root = search_vault(&sb);
    let core = open_core(&root, &sb.dirs, true);
    assert!(!paths(&core, &q("rozpočet")).contains(CTENI), "setup");
    let mut text = std::fs::read_to_string(root.join(CTENI)).unwrap_or_default();
    text.push_str("\nPřidaný rozpočet na knihy.\n");
    std::fs::write(root.join(CTENI), text.as_bytes()).unwrap_or(());
    let seen = wait_until(Duration::from_secs(2), || paths(&core, &q("rozpočet")).contains(CTENI));
    assert!(seen.is_some(), "external edit not reflected within 2 s");

    std::fs::remove_file(root.join(ROZPOCET)).unwrap_or(());
    let gone = wait_until(Duration::from_secs(2), || !paths(&core, &q("rozpočet")).contains(ROZPOCET));
    assert!(gone.is_some(), "external delete not reflected within 2 s");
}

#[test]
fn fr_src_01_ac10_searching_writes_nothing_to_the_vault() {
    let sb = sandbox();
    let root = search_vault(&sb);
    let core = open_core(&root, &sb.dirs, true);
    let before = snapshot(&root);
    let mut filtered = q("rozpočet");
    filtered.types = vec!["task".into()];
    assert_eq!(paths(&core, &q("rozpočet")), ac1_set(), "positive control");
    for query in [q("rozpočet"), q("\"rozpočet projektu\""), q("rozpcoet"), q("-"), filtered] {
        let _ = core.search(&query);
    }
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(snapshot(&root), before);
}

// ---------------------------------------------------------------- FR-SRC-02

#[test]
fn fr_src_02_ac1_type_filter() {
    let (_sb, _root, core) = fixture();
    let mut t = q("rozpočet");
    t.types = vec!["task".into()];
    assert_eq!(paths(&core, &t), set(&[TOMAS]));
    t.types = vec!["page".into()];
    assert_eq!(paths(&core, &t), set(&[ROZPOCET, PROJEKT, OBYCEJNA]));
}

#[test]
fn fr_src_02_ac2_tag_filter_with_and_without_text() {
    let (_sb, _root, core) = fixture();
    let mut t = q("rozpočet");
    t.tags = vec!["finance".into()];
    assert_eq!(paths(&core, &t), set(&[ROZPOCET]));
    let mut only = q("");
    only.tags = vec!["knihy".into()];
    assert_eq!(paths(&core, &only), set(&[CTENI]));
}

#[test]
fn fr_src_02_ac2_empty_text_and_no_filters_is_an_empty_page() {
    let (_sb, _root, core) = fixture();
    let mut only = q("");
    only.tags = vec!["knihy".into()];
    assert_eq!(paths(&core, &only), set(&[CTENI]), "positive control");
    let p = page(&core, &q(""));
    assert_eq!((p.results.len(), p.total), (0, 0));
}

#[test]
fn fr_src_02_ac3_created_date_in_prague() {
    let (_sb, _root, core) = fixture();
    let mut t = q("rozpočet");
    t.created = one_day(day(2026, 10, 6));
    assert_eq!(paths(&core, &t), set(&[NAPAD]));
    t.created = one_day(day(2026, 10, 5));
    assert_eq!(paths(&core, &t), BTreeSet::new());
    t.created = Some(DateRange { from: day(2026, 8, 1), to: day(2026, 10, 31) });
    assert_eq!(paths(&core, &t), set(&[ROZPOCET, TOMAS, NAPAD]));
}

#[test]
fn fr_src_02_ac4_created_date_in_new_york() {
    let (_sb, _root, core) = fixture();
    let mut t = SearchQuery::text("rozpočet", NEW_YORK);
    t.created = one_day(day(2026, 10, 6));
    assert_eq!(paths(&core, &t), BTreeSet::new());
    t.created = one_day(day(2026, 10, 5));
    assert_eq!(paths(&core, &t), set(&[NAPAD]));
}

#[test]
fn fr_src_02_ac5_modified_date_range_with_empty_text() {
    let (_sb, _root, core) = fixture();
    let mut t = q("");
    t.modified = Some(DateRange { from: day(2026, 9, 1), to: day(2026, 9, 30) });
    assert_eq!(paths(&core, &t), set(&[ROZPOCET]));
    // D-103: an untyped file has no modified date; a wide range still doesn't return it.
    t.modified = Some(DateRange { from: day(1970, 1, 1), to: day(2100, 12, 31) });
    assert_eq!(paths(&core, &t), set(&[CTENI, ROZPOCET, PROJEKT, TOMAS, NAPAD]));
}

#[test]
fn fr_src_02_ac6_attribute_equality() {
    let (_sb, _root, core) = fixture();
    let mut t = q("");
    t.attributes = vec![AttrFilter::Equals { key: "priority".into(), value: "High".into() }];
    assert_eq!(paths(&core, &t), set(&[TOMAS]));
    t.attributes = vec![AttrFilter::Equals { key: "priority".into(), value: "high".into() }];
    assert_eq!(paths(&core, &t), set(&[TOMAS]), "D-109: case-insensitive equality");
    t.attributes = vec![AttrFilter::Equals { key: "priority".into(), value: "Low".into() }];
    assert_eq!(paths(&core, &t), BTreeSet::new());
}

#[test]
fn fr_src_02_ac6_attribute_date_range() {
    let (_sb, _root, core) = fixture();
    let mut t = q("");
    t.attributes = vec![AttrFilter::Range { key: "due".into(), from: Some("2026-10-01".into()), to: Some("2026-10-31".into()) }];
    assert_eq!(paths(&core, &t), set(&[TOMAS]));
    t.attributes = vec![AttrFilter::Range { key: "due".into(), from: Some("2026-10-16".into()), to: None }];
    assert_eq!(paths(&core, &t), BTreeSet::new());
}

#[test]
fn fr_src_02_ac7_review_filter() {
    let (_sb, _root, core) = fixture();
    let mut t = q("");
    t.review = Some("unreviewed".into());
    assert_eq!(paths(&core, &t), set(&[NAPAD]));
    let mut t2 = q("rozpočet");
    t2.review = Some("unreviewed".into());
    assert_eq!(paths(&core, &t2), set(&[NAPAD]));
}

#[test]
fn fr_src_02_ac8_filters_combine_with_and() {
    let (_sb, _root, core) = fixture();
    let mut t = q("rozpočet");
    t.types = vec!["quick-note".into()];
    t.tags = vec!["cestování".into()];
    assert_eq!(paths(&core, &t), set(&[NAPAD]));
    t.tags.push("finance".into());
    assert_eq!(paths(&core, &t), BTreeSet::new());
}

#[test]
fn fr_src_02_ac9_tag_filter_is_nfc_and_case_insensitive() {
    let (_sb, _root, core) = fixture();
    for tag in ["cestování", "Cestování", "CESTOVÁNÍ", "cestova\u{301}ni\u{301}"] {
        let mut t = q("");
        t.tags = vec![tag.into()];
        assert_eq!(paths(&core, &t), set(&[NAPAD]), "tag {tag:?}");
    }
}

// ---------------------------------------------------------------- FR-SRC-03

#[test]
fn fr_src_03_ac1_result_carries_type_and_title() {
    let (_sb, _root, core) = fixture();
    let p = page(&core, &q("rozpočet"));
    let tomas = p.results.iter().find(|r| r.path == TOMAS);
    assert!(tomas.is_some(), "Tomáš missing: {:?}", p.results);
    let tomas = tomas.cloned().unwrap_or_else(|| unreachable!());
    assert_eq!((tomas.r#type.as_str(), tomas.title.as_str()), ("task", "Zavolat Tomášovi"));
    assert!(tomas.snippet.is_some(), "Tomáš matched in the body has a snippet");
    let oby = p.results.iter().find(|r| r.path == OBYCEJNA).map(|r| (r.r#type.clone(), r.title.clone()));
    assert_eq!(oby, Some(("page".to_string(), "Obyčejná poznámka".to_string())));
    let napad = p.results.iter().find(|r| r.path == NAPAD).map(|r| r.r#type.clone());
    assert_eq!(napad, Some("quick-note".to_string()));
}

#[test]
fn fr_src_03_ac2_snippet_has_offsets_and_no_frontmatter_or_markers() {
    let sb = sandbox();
    let root = search_vault(&sb);
    write_raw(
        &root,
        "Pages/Seznam výdajů.md",
        "---\nid: 01JA0S0000000000000000S020\ntype: page\ntitle: Seznam výdajů\n---\n## Rozpočet na cestu\n\n- první položka: rozpočet na vlak\n- druhá položka\n".as_bytes(),
    );
    let core = open_core(&root, &sb.dirs, false);
    let p = page(&core, &q("rozpočet"));
    assert!(p.results.len() >= 5, "positive control: {:?}", p.results);
    let mut with_snippet = 0;
    for r in &p.results {
        let Some(s) = &r.snippet else { continue };
        with_snippet += 1;
        assert!(s.text.chars().count() <= 160, "{}: snippet longer than 160 chars", r.path);
        for bad in ["---", "id:", "type:", "title:", "## ", "- ", "<b>", "<mark>"] {
            assert!(!s.text.contains(bad), "{}: snippet contains {bad:?}: {:?}", r.path, s.text);
        }
        assert!(!s.highlights.is_empty(), "{}: no highlights", r.path);
        for &(a, b) in &s.highlights {
            let piece = s.text.get(a..b).map(tegg_index::fold);
            assert_eq!(piece.as_deref(), Some("rozpocet"), "{}: highlight {a}..{b} in {:?}", r.path, s.text);
        }
    }
    assert!(with_snippet >= 4, "body matches carry snippets: {:?}", p.results);
}

#[test]
fn fr_src_03_ac2_results_come_in_pages_of_50() {
    let sb = sandbox();
    let root = search_vault(&sb);
    for i in 0..120 {
        write_raw(&root, &format!("Pages/Hromada {i:03}.md"), format!("Poznámka číslo {i}: ostružiník.\n").as_bytes());
    }
    let core = open_core(&root, &sb.dirs, false);
    let first = page(&core, &q("ostružiník"));
    assert_eq!((first.results.len(), first.total), (50, 120));
    let mut last = q("ostružiník");
    last.offset = 100;
    let tail = page(&core, &last);
    assert_eq!((tail.results.len(), tail.total), (20, 120));
}

#[test]
fn fr_src_03_ac3_diacritic_insensitive_match_is_highlighted_on_original_text() {
    let (_sb, _root, core) = fixture();
    let p = page(&core, &q("zlutoucky"));
    assert_eq!(p.results.iter().map(|r| r.path.as_str()).collect::<Vec<_>>(), vec![CTENI]);
    let s = p.results[0].snippet.clone();
    assert!(s.is_some(), "snippet missing");
    let s = s.unwrap_or_else(|| unreachable!());
    let pieces: Vec<&str> = s.highlights.iter().filter_map(|&(a, b)| s.text.get(a..b)).collect();
    assert_eq!(pieces, vec!["žluťoučký"]);
}

#[test]
fn fr_src_03_ac4_result_points_to_first_body_match_line_and_byte() {
    let (_sb, root, core) = fixture();
    let p = page(&core, &q("meruňkách"));
    assert_eq!(p.results.iter().map(|r| r.path.as_str()).collect::<Vec<_>>(), vec![CTENI]);
    let file = std::fs::read_to_string(root.join(CTENI)).unwrap_or_default();
    let line24 = file.lines().nth(23).unwrap_or_default();
    let byte = line24.find("meruňkách");
    assert!(byte.is_some(), "fixture line 24 contains the word");
    let s = p.results[0].snippet.clone().map(|s| (s.line, s.byte_in_line));
    assert_eq!(s, Some((24, byte.unwrap_or_default())));
}

// ---------------------------------------------------------------- FR-SRC-04

#[test]
fn fr_src_04_ac1_phrase() {
    let (_sb, _root, core) = fixture();
    assert_eq!(paths(&core, &q("\"rozpočet projektu\"")), set(&[ROZPOCET, TOMAS]));
    assert_eq!(paths(&core, &q("„rozpočet projektu“")), set(&[ROZPOCET, TOMAS]), "D-108 Czech quotes");
}

#[test]
fn fr_src_04_ac2_exclusion_is_diacritic_insensitive() {
    let (_sb, _root, core) = fixture();
    let want = set(&[ROZPOCET, PROJEKT, TOMAS, OBYCEJNA]);
    assert_eq!(paths(&core, &q("rozpočet -krkonoš")), want);
    assert_eq!(paths(&core, &q("rozpočet -krkonos")), want);
}

#[test]
fn fr_src_04_ac3_phrase_and_exclusion_together() {
    let (_sb, _root, core) = fixture();
    assert_eq!(paths(&core, &q("\"rozpočet projektu\" -tomášovi")), set(&[ROZPOCET]));
}

#[test]
fn fr_src_04_ac4_diacritics_and_case_are_folded() {
    let (_sb, _root, core) = fixture();
    assert_eq!(paths(&core, &q("rozpocet")), ac1_set());
    assert_eq!(paths(&core, &q("CTENI")), set(&[CTENI]));
}

#[test]
fn fr_src_04_ac4_folding_applies_to_the_text_too() {
    let sb = sandbox();
    let root = search_vault(&sb);
    write_raw(&root, "Pages/Bez háčků.md", b"cteni bez hacku\n");
    let core = open_core(&root, &sb.dirs, false);
    assert_eq!(paths(&core, &q("čtení")), set(&[CTENI, "Pages/Bez háčků.md"]));
}

#[test]
fn fr_src_04_ac5_one_edit_typos_on_long_words() {
    let (_sb, _root, core) = fixture();
    for text in ["rozpcoet", "rozpočt"] {
        let p = page(&core, &q(text));
        let got: BTreeSet<String> = p.results.iter().map(|r| r.path.clone()).collect();
        assert_eq!(got, ac1_set(), "{text}");
        let flags: Vec<bool> = p.results.iter().map(|r| r.typo).collect();
        assert!(flags.windows(2).all(|w| !(w[0] && !w[1])), "{text}: a typo match ranks before an exact one: {:?}", p.results);
        assert!(flags.iter().any(|t| *t), "{text}: the misspelled titles match only as typos: {:?}", p.results);
    }
    assert_eq!(paths(&core, &q("kus")), BTreeSet::new(), "words of ≤ 4 letters are not typo-matched");
}

#[test]
fn fr_src_04_ac5_typo_matches_rank_after_exact_matches() {
    let sb = sandbox();
    let root = search_vault(&sb);
    write_raw(&root, "Pages/Překlep.md", "Tady je slovo rozpcoet napsané přesně takhle.\n".as_bytes());
    let core = open_core(&root, &sb.dirs, false);
    let p = page(&core, &q("rozpcoet"));
    let order: Vec<(String, bool)> = p.results.iter().map(|r| (r.path.clone(), r.typo)).collect();
    assert_eq!(order.first(), Some(&("Pages/Překlep.md".to_string(), false)), "{order:?}");
    assert_eq!(order.len(), 6, "{order:?}");
    assert!(order[1..].iter().all(|(_, typo)| *typo), "{order:?}");
}

#[test]
fn fr_src_04_ac6_dash_inside_a_word_or_alone_is_literal() {
    let sb = sandbox();
    let root = search_vault(&sb);
    write_raw(&root, "Pages/Termíny.md", "Uzávěrka je 2026-10 a pak 10 dní volna.\n".as_bytes());
    let core = open_core(&root, &sb.dirs, false);
    assert!(paths(&core, &q("2026-10")).contains("Pages/Termíny.md"));
    let lone = core.search(&q("-"));
    assert!(lone.is_ok(), "lone '-' must not error: {:?}", lone.err());
    let lone2 = core.search(&q("rozpočet -"));
    assert!(lone2.is_ok(), "trailing '-' must not error");
    assert_eq!(paths(&core, &q("rozpočet -")), ac1_set());
}

#[test]
fn fr_src_04_ac7_unclosed_quote_is_a_phrase_to_the_end() {
    let (_sb, _root, core) = fixture();
    assert_eq!(paths(&core, &q("\"rozpočet projektu")), set(&[ROZPOCET, TOMAS]));
    assert_eq!(paths(&core, &q("„rozpočet projektu")), set(&[ROZPOCET, TOMAS]));
}

// ---------------------------------------------------------------- FR-FMT-12 AC-4 (search part)

#[test]
fn fr_fmt_12_ac4_search_matches_cteni_to_čtení() {
    let (_sb, _root, core) = fixture();
    let got = paths(&core, &q("cteni"));
    assert_eq!(got, set(&[CTENI]));
}
