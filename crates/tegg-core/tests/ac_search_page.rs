//! Search page redesign, L4 (core `index.search` on a temporary vault): docs/acceptance/search-navigation.md
//! § "Search page redesign" FR-SRC-01 AC-18…AC-22, FR-SRC-02 AC-14, AC-15, FR-SRC-03 AC-12 (paging), AC-20 (core
//! calls). Interface docs/contracts/v1-search.md §1 (D-1200…D-1222). Written from the ACs and the contract only (D-61).
//! Vault: `search/` + `search-page/` + `new-empty/.tegg/` (D-1222), TZ a query parameter (Europe/Prague unless
//! stated). The new result fields are read through `search_page_setup` (see there why).
//!
//! Highlight units: the core's snippets carry byte ranges (ms2-core §2.1, `fr_src_03_ac2_*`), and so does
//! `title_highlights` (v1-search §1); the AC's numbers are UTF-16 code units (the IPC unit, v1-search §2), so the
//! tests convert the core's ranges with `utf16()` and compare with the AC's numbers.
//!
//! FR-SRC-01 AC-22 is a latency AC: it runs at G2 nightly, not in the push gate (D-343; `qa.config.json` skips
//! `fr_src_01_ac22_` in `core-rust-test` and runs it in `core-perf-search-ac`).

mod common;
mod search_page_setup;

use std::collections::BTreeSet;
use std::path::Path;
use std::time::{Duration, Instant};

use chrono_tz::Tz;
use common::*;
use search_page_setup::*;
use tegg_core::{Core, MatchField, SearchPage, SearchQuery, SearchResult};

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

fn vault(sb: &Sandbox) -> std::path::PathBuf {
    let root = page_vault(sb);
    assert!(root.is_some(), "setup: copy search/ + search-page/ + new-empty/.tegg/");
    root.unwrap_or_default()
}

fn core_at(root: &Path, sb: &Sandbox, watch: bool) -> Core {
    ok!(open_core(root, &sb.dirs, watch), "open the core")
}

fn fixture() -> (Sandbox, std::path::PathBuf, Core) {
    let sb = sandbox();
    let root = vault(&sb);
    let core = core_at(&root, &sb, false);
    (sb, root, core)
}

fn q(text: &str) -> SearchQuery {
    SearchQuery::text(text, PRAGUE)
}
fn tagged(tags: &[&str]) -> SearchQuery {
    let mut x = q("");
    x.tags = tags.iter().map(|s| s.to_string()).collect();
    x
}
fn typed(text: &str, ty: &str) -> SearchQuery {
    let mut x = q(text);
    x.types = vec![ty.to_string()];
    x
}

fn page(core: &Core, query: &SearchQuery) -> SearchPage {
    ok!(core.search(query), format!("search {:?} types {:?} tags {:?}", query.text, query.types, query.tags))
}
fn order(core: &Core, query: &SearchQuery) -> Vec<String> {
    page(core, query).results.iter().map(|r| r.path.clone()).collect()
}
fn set(items: &[&str]) -> BTreeSet<String> {
    items.iter().map(|s| s.to_string()).collect()
}
fn result<'a>(p: &'a SearchPage, path: &str) -> &'a SearchResult {
    let r = p.results.iter().find(|r| r.path == path);
    assert!(r.is_some(), "{path} is a result: {:?}", p.results.iter().map(|r| &r.path).collect::<Vec<_>>());
    r.unwrap_or_else(|| unreachable!())
}
fn tag_set(r: &SearchResult) -> Result<BTreeSet<String>, String> {
    let list = tags(r)?;
    let s: BTreeSet<String> = list.iter().cloned().collect();
    if s.len() != list.len() {
        return Err(format!("tags not de-duplicated: {list:?}"));
    }
    Ok(s)
}
/// The red guard of the tests whose sets the core already returns: every result carries the v1-search §1 fields.
fn guard(p: &SearchPage, what: &str) {
    assert!(!p.results.is_empty(), "{what}: positive control, some results");
    for r in &p.results {
        assert_eq!(fields_present(r), Ok(()), "{what}: {} carries the v1-search §1 fields", r.path);
    }
}
fn th16(r: &SearchResult) -> Result<Option<Vec<(usize, usize)>>, String> {
    Ok(utf16(&r.title, &title_highlights(r)?))
}

// ---------------------------------------------------------------- FR-SRC-01 AC-18

#[test]
fn fr_src_01_ac18_modified_and_tags_in_every_result() {
    let (_sb, _root, core) = fixture();
    let p = page(&core, &q("mlyn"));
    assert_eq!(p.results.iter().map(|r| r.path.as_str()).collect::<Vec<_>>(), vec![CHATA], "mlyn → Chata");
    let chata = result(&p, CHATA);
    assert_eq!(modified(chata), Ok(Some("2026-10-12T08:15:00+02:00".to_string())), "Chata: modified as written");
    assert_eq!(tag_set(chata), Ok(set(&["hory", "účty", "zima"])), "Chata: frontmatter and inline tag keys");

    let p = page(&core, &q("rozpočet"));
    assert_eq!(tag_set(result(&p, ROZPOCET)), Ok(set(&["finance"])), "Rozpočet");
    assert_eq!(tag_set(result(&p, NAPAD)), Ok(set(&["cestování"])), "Nápad");
    assert_eq!(tag_set(result(&p, TOMAS)), Ok(BTreeSet::new()), "Tomáš: no tags");
    assert_eq!(tag_set(result(&p, OBYCEJNA)), Ok(BTreeSet::new()), "Obyčejná: no tags");
    assert_eq!(modified(result(&p, ROZPOCET)), Ok(Some("2026-09-20T12:00:00+02:00".to_string())), "Rozpočet: modified");
    assert_eq!(modified(result(&p, OBYCEJNA)), Ok(None), "Obyčejná: no frontmatter, no modified (never a file-system date, D-103)");
}

#[test]
fn fr_src_01_ac18_an_invalid_modified_is_none() {
    let sb = sandbox();
    let root = vault(&sb);
    assert!(put(&root, "Pages/Špatné datum.md", "---\ntype: page\ntitle: Špatné datum\nmodified: včera\n---\njeřabina\n".as_bytes()), "setup");
    let core = core_at(&root, &sb, false);
    let p = page(&core, &q("jeřabina"));
    assert_eq!(p.results.iter().map(|r| r.path.as_str()).collect::<Vec<_>>(), vec!["Pages/Špatné datum.md"]);
    assert_eq!(modified(&p.results[0]), Ok(None), "modified: včera isn't a date-time → none");
}

#[test]
fn fr_src_01_ac18_an_nfd_inline_tag_is_still_the_nfc_key() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = core_at(&root, &sb, true);
    let text = std::fs::read_to_string(root.join(CHATA)).unwrap_or_default();
    assert!(text.contains("#účty") && text.contains("modified: 2026-10-12T08:15:00+02:00"), "setup: Chata as in the fixture");
    // The tag in NFD bytes; `modified` moves by a minute so the test can see the re-index.
    let nfd = text.replace("#účty", "#u\u{301}c\u{30C}ty").replace("modified: 2026-10-12T08:15:00+02:00", "modified: 2026-10-12T08:16:00+02:00");
    assert!(put(&root, CHATA, nfd.as_bytes()), "setup: rewrite Chata");
    let seen = wait_until(Duration::from_secs(2), || {
        core.search(&q("mlyn")).ok().and_then(|p| p.results.first().map(|r| modified(r) == Ok(Some("2026-10-12T08:16:00+02:00".into())))).unwrap_or(false)
    });
    assert!(seen.is_some(), "the external edit of Chata is indexed within 2 s (modified 08:16)");
    let p = page(&core, &q("mlyn"));
    assert_eq!(tag_set(result(&p, CHATA)), Ok(set(&["hory", "účty", "zima"])), "the NFD inline tag's key is NFC `účty`");
}

// ---------------------------------------------------------------- FR-SRC-01 AC-19

#[test]
fn fr_src_01_ac19_title_highlights() {
    let sb = sandbox();
    let root = vault(&sb);
    assert!(put(&root, "Pages/Borovice u cesty.md", "---\ntype: page\ntitle: Dům v lese\n---\nBez dalšího slova.\n".as_bytes()), "setup");
    let core = core_at(&root, &sb, false);
    for text in ["rozpočet", "rozpocet", "ROZPOČET", "rozpoc\u{30C}et"] {
        let p = page(&core, &q(text));
        assert_eq!(th16(result(&p, ROZPOCET)), Ok(Some(vec![(0, 8)])), "{text}: Rozpočet 2026 [0, 8)");
        assert_eq!(th16(result(&p, PROJEKT)), Ok(Some(vec![(10, 18)])), "{text}: Projekt a rozpočet [10, 18)");
        for body_only in [TOMAS, NAPAD] {
            assert_eq!(title_highlights(result(&p, body_only)), Ok(vec![]), "{text}: {body_only} matched in its body has no title ranges");
        }
    }
    let p = page(&core, &q("rozpcoet"));
    let r = result(&p, ROZPOCET);
    assert!(r.typo, "rozpcoet matches Rozpočet as a typo (D-101)");
    assert_eq!(th16(r), Ok(Some(vec![(0, 8)])), "rozpcoet: the typo-matched word is highlighted in the title (D-1210)");
    let p = page(&core, &q("borovice"));
    let r = result(&p, "Pages/Borovice u cesty.md");
    assert_eq!(r.matched_in, MatchField::FileName, "setup: a file-name match");
    assert_eq!(title_highlights(r), Ok(vec![]), "a file-name match has no title ranges");
}

#[test]
fn fr_src_01_ac19_alias_highlight() {
    let (_sb, _root, core) = fixture();
    let p = page(&core, &q("reading"));
    let r = result(&p, CTENI);
    assert_eq!(r.matched_in, MatchField::Alias, "matched in an alias");
    let a = alias(r);
    assert!(matches!(a, Ok(Some(_))), "Čtení carries the matched alias: {a:?}");
    let a = a.ok().flatten().unwrap_or_else(|| unreachable!());
    assert_eq!(a.text, "Reading list", "the alias as written");
    assert_eq!(utf16(&a.text, &a.highlights), Some(vec![(0, 7)]), "`Reading` highlighted [0, 7)");
    assert_eq!(attribute(r), Ok(None), "no attribute for an alias match");
}

#[test]
fn fr_src_01_ac19_attribute_highlight() {
    let (_sb, _root, core) = fixture();
    let p = page(&core, &q("High"));
    let r = result(&p, TOMAS);
    assert_eq!(r.matched_in, MatchField::Attribute);
    let a = attribute(r);
    assert!(matches!(a, Ok(Some(_))), "Tomáš carries the attribute hit: {a:?}");
    let (key, v) = a.ok().flatten().unwrap_or_else(|| unreachable!());
    assert_eq!((key.as_str(), v.text.as_str()), ("priority", "High"));
    assert_eq!(utf16(&v.text, &v.highlights), Some(vec![(0, 4)]), "High [0, 4)");
    assert_eq!(alias(r), Ok(None), "no alias for an attribute match");

    let p = page(&core, &q("mlyn"));
    let r = result(&p, CHATA);
    assert_eq!(r.matched_in, MatchField::Attribute);
    let a = attribute(r);
    assert!(matches!(a, Ok(Some(_))), "Chata carries the attribute hit: {a:?}");
    let (key, v) = a.ok().flatten().unwrap_or_else(|| unreachable!());
    assert_eq!((key.as_str(), v.text.as_str()), ("místo", "Špindlerův Mlýn"), "the key as written (not folded), the value as written");
    assert_eq!(utf16(&v.text, &v.highlights), Some(vec![(11, 15)]), "folded match highlighted on `Mlýn` [11, 15)");
}

#[test]
fn fr_src_01_ac19_attribute_list_item_long_value_first_key_and_reserved_keys() {
    let sb = sandbox();
    let root = vault(&sb);
    let long = format!("{}jalovec na konci dlouhé hodnoty a ještě něco za ním, aby byla delší než sto šedesát znaků.", "Dlouhý úvod bez hledaného slova, ".repeat(5));
    assert!(long.chars().count() > 160, "setup: the long value has more than 160 characters");
    let note = format!(
        "---\nid: 01JA0S0000000000000000S090\ntype: page\ntitle: Atributy\npřísady:\n  - mouka\n  - kmín\n  - sůl\npoznámka: {long}\nprvní: smrk\ndruhý: smrk\n---\nTělo bez shody.\n"
    );
    assert!(put(&root, "Pages/Atributy.md", note.as_bytes()), "setup");
    let core = core_at(&root, &sb, false);

    let hit = |text: &str| -> Option<(String, tegg_core::Snippet)> {
        let p = page(&core, &q(text));
        let r = result(&p, "Pages/Atributy.md");
        assert_eq!(r.matched_in, MatchField::Attribute, "{text}: an attribute match");
        let a = attribute(r);
        assert!(matches!(a, Ok(Some(_))), "{text}: the attribute hit: {a:?}");
        a.ok().flatten()
    };
    let (k, v) = hit("kmín").unwrap_or_else(|| unreachable!());
    assert_eq!((k.as_str(), v.text.as_str()), ("přísady", "kmín"), "a list: only the matched item");
    assert_eq!(pieces(&v.text, &v.highlights), Some(vec!["kmín".to_string()]));

    let (k, v) = hit("jalovec").unwrap_or_else(|| unreachable!());
    assert_eq!(k, "poznámka");
    assert!(v.text.chars().count() <= 160, "a long value is cut to ≤ 160 characters: {} ({})", v.text, v.text.chars().count());
    assert!(long.contains(v.text.trim_matches('…').trim()), "the window is a piece of the value as written: {:?}", v.text);
    assert_eq!(pieces(&v.text, &v.highlights), Some(vec!["jalovec".to_string()]), "around the first match");

    let (k, v) = hit("smrk").unwrap_or_else(|| unreachable!());
    assert_eq!((k.as_str(), v.text.as_str()), ("první", "smrk"), "several keys match: the first in frontmatter order");

    // Reserved keys are never an attribute match (FR-SRC-01 AC-6).
    for text in ["01JA0S0000000000000000S090", "01JA0S0000000000000000S006", "2026-10-12T08:15:00+02:00"] {
        let p = page(&core, &q(text));
        for r in &p.results {
            assert_ne!(r.matched_in, MatchField::Attribute, "{text}: {} is not an attribute match", r.path);
            assert_eq!(attribute(r), Ok(None), "{text}: {} has no attribute hit", r.path);
        }
    }
}

// ---------------------------------------------------------------- FR-SRC-01 AC-20

#[test]
fn fr_src_01_ac20_the_body_lead_when_the_body_has_no_match() {
    let sb = sandbox();
    let root = vault(&sb);
    assert!(put(&root, "Pages/Jen hlavička.md", "---\ntype: page\ntitle: Jen hlavička borůvka\n---\n".as_bytes()), "setup");
    let core = core_at(&root, &sb, false);
    let lead = |text: &str, path: &str, starts: &str| {
        let p = page(&core, &q(text));
        let r = result(&p, path);
        let s = r.snippet.clone();
        assert!(s.is_some(), "{text}: {path} has the body's lead as its snippet (D-1207)");
        let s = s.unwrap_or_else(|| unreachable!());
        assert!(s.text.starts_with(starts), "{text}: {path}'s snippet starts {starts:?}: {:?}", s.text);
        assert_eq!(s.highlights, vec![], "{text}: the lead has no highlight");
        assert!(s.text.chars().count() <= 160, "{text}: ≤ 160 characters");
        for bad in ["---", "id:", "type:", "title:", "## ", "- "] {
            assert!(!s.text.contains(bad), "{text}: no frontmatter or block markers in {:?}", s.text);
        }
        s.text
    };
    let high = lead("High", TOMAS, "Probrat rozpočet projektu a termín výletu.");
    lead("mlyn", CHATA, "Seznam věcí na chatu: lyže, čaj, deky.");
    let title = lead("Tomášovi", TOMAS, "Probrat rozpočet projektu a termín výletu.");
    assert_eq!(high, title, "the same lead for a title and an attribute match");

    let p = page(&core, &tagged(&["hory"]));
    let r = result(&p, POZDNI);
    assert_eq!(r.snippet.as_ref().map(|s| (s.text.starts_with("Zapsáno v noci, čas je v UTC."), s.highlights.len())), Some((true, 0)), "filter only: the lead");

    let p = page(&core, &q("borůvka"));
    assert_eq!(result(&p, "Pages/Jen hlavička.md").snippet, None, "an empty body has no snippet");
    guard(&p, "borůvka");
}

// ---------------------------------------------------------------- FR-SRC-01 AC-21

#[test]
fn fr_src_01_ac21_new_fields_follow_an_external_edit() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = core_at(&root, &sb, true);
    let text = std::fs::read_to_string(root.join(BOUDA)).unwrap_or_default();
    assert!(text.contains("tags:\n  - hory\n") && text.contains("modified: 2026-10-06T00:30:00+02:00"), "setup: Bouda as in the fixture");
    let edited = text.replace("tags:\n  - hory\n", "tags:\n  - hory\n  - zima\n").replace("modified: 2026-10-06T00:30:00+02:00", "modified: 2026-10-13T07:00:00+02:00");
    let before = snapshot(&root);
    assert!(put(&root, BOUDA, edited.as_bytes()), "setup: the external edit");
    let after_edit = snapshot(&root);
    let t0 = Instant::now();
    let seen = wait_until(Duration::from_secs(2), || core.search(&tagged(&["zima"])).map(|p| p.results.len() == 2).unwrap_or(false));
    assert!(seen.is_some(), "#zima returns two objects within 2 s ({:?})", t0.elapsed());
    let p = page(&core, &tagged(&["zima"]));
    assert_eq!(p.results.iter().map(|r| r.path.as_str()).collect::<Vec<_>>(), vec![BOUDA, CHATA], "Bouda (modified 10-13) first");
    let b = result(&p, BOUDA);
    assert_eq!(tag_set(b), Ok(set(&["hory", "zima"])), "Bouda's new tags");
    assert_eq!(modified(b), Ok(Some("2026-10-13T07:00:00+02:00".to_string())), "Bouda's new modified");
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(snapshot(&root), after_edit, "searching writes nothing to the vault (FR-SRC-01 AC-10)");
    assert_ne!(before, after_edit, "setup: the edit changed Bouda");
}

fn ac18_to_ac20_and_ac15(core: &Core) -> Vec<String> {
    let mut qs: Vec<SearchQuery> = ["mlyn", "rozpočet", "reading", "High", "Tomášovi", "rozpcoet", "jeřabina"].iter().map(|t| q(t)).collect();
    qs.push(tagged(&["hory"]));
    qs.push(typed("", "page"));
    let mut ny = tagged(&["hory"]);
    ny.tz = NEW_YORK;
    qs.push(ny);
    qs.iter().map(|x| format!("{:?}|{:?}|{:?}", x.text, x.tags, page(core, x))).collect()
}

#[test]
fn fr_src_01_ac21_identical_after_index_rebuild_and_no_vault_writes() {
    let sb = sandbox();
    let root = vault(&sb);
    assert!(put(&root, "Pages/Špatné datum.md", "---\ntype: page\ntitle: Špatné datum\nmodified: včera\n---\njeřabina\n".as_bytes()), "setup");
    let core = core_at(&root, &sb, false);
    let p = page(&core, &q("mlyn"));
    guard(&p, "mlyn");
    let vault_before = snapshot(&root);
    let before = ac18_to_ac20_and_ac15(&core);
    let local = core.vault().local_dir();
    drop(core);
    assert!(local.exists(), "the index lives in the machine-local dir {local:?}");
    ok!(std::fs::remove_dir_all(&local), "delete the index dir");
    let core = core_at(&root, &sb, false);
    let after = ac18_to_ac20_and_ac15(&core);
    for (b, a) in before.iter().zip(after.iter()) {
        assert_eq!(a, b, "identical after the rebuild (AR-01)");
    }
    assert_eq!(snapshot(&root), vault_before, "neither searching nor the rebuild writes to the vault");
}

// ---------------------------------------------------------------- FR-SRC-01 AC-22 (latency, G2 nightly, D-343)

fn p95_of(core: &Core, query: &SearchQuery, runs: usize) -> Duration {
    let mut lat = Vec::with_capacity(runs);
    for _ in 0..runs {
        let t = Instant::now();
        let p = core.search(query);
        lat.push(t.elapsed());
        assert!(p.is_ok(), "search failed: {:?}", p.err());
    }
    p95(&mut lat)
}

fn ac22(core: &Core, query: SearchQuery, what: &str) {
    let p = page(core, &query);
    assert_eq!(p.results.len(), 50, "{what}: the first page of 50 (total {})", p.total);
    for r in &p.results {
        assert_eq!(fields_present(r), Ok(()), "{what}: {} carries every field of AC-18…AC-20", r.path);
    }
    assert!(p.results.iter().any(|r| r.snippet.is_some()), "{what}: snippets or leads");
    let limit = target(Duration::from_millis(200), 0.75);
    let got = p95_of(core, &query, 20);
    println!("FR-SRC-01 AC-22 {what} p95: {:.1} ms (limit {:.1} ms)", got.as_secs_f64() * 1e3, limit.as_secs_f64() * 1e3);
    assert!(got < limit, "{what}: p95 {got:?} ≥ {limit:?} (NFR-PERF-04)");
}

#[test]
fn fr_src_01_ac22_first_page_with_every_field_within_target_text_query() {
    let vault = reference_vault();
    let sb = sandbox();
    let core = ok!(open_core(&vault, &sb.dirs, false), "open the reference vault");
    ac22(&core, q("rozpočet"), "text query `rozpočet`");
}

#[test]
fn fr_src_01_ac22_first_page_with_every_field_within_target_filter_only() {
    let vault = reference_vault();
    let sb = sandbox();
    let core = ok!(open_core(&vault, &sb.dirs, false), "open the reference vault");
    let p = page(&core, &typed("", "page"));
    // Ordered as FR-SRC-02 AC-15: modified instants never increase down the page.
    let inst: Vec<Option<chrono::DateTime<chrono::FixedOffset>>> =
        p.results.iter().map(|r| modified(r).ok().flatten().and_then(|m| chrono::DateTime::parse_from_rfc3339(&m).ok())).collect();
    assert!(inst.iter().any(|x| x.is_some()), "Type: Page results carry modified");
    assert!(inst.windows(2).all(|w| match (w[0], w[1]) {
        (Some(a), Some(b)) => a >= b,
        (None, Some(_)) => false,
        _ => true,
    }), "newest modified first, none last");
    ac22(&core, typed("", "page"), "filter only `Type: Page`");
}

// ---------------------------------------------------------------- FR-SRC-02 AC-14, AC-15

#[test]
fn fr_src_02_ac14_type_filter_sets() {
    let (_sb, _root, core) = fixture();
    let got = |x: SearchQuery| order(&core, &x).into_iter().collect::<BTreeSet<String>>();
    assert_eq!(got(typed("", "page")), set(&[CHATA, BOUDA, CTENI, ROZPOCET, PROJEKT, OBYCEJNA]), "Type: Page, no text");
    assert_eq!(got(typed("", "task")), set(&[TOMAS]), "Type: Task");
    let mut qn = typed("", "quick-note");
    qn.tags = vec!["hory".into()];
    assert_eq!(order(&core, &qn), vec![POZDNI], "Type: Quick Note + #hory");
    let mut tk = typed("", "task");
    tk.tags = vec!["hory".into()];
    assert_eq!(order(&core, &tk), Vec::<String>::new(), "Type: Task + #hory → nothing (AND)");
    let alone: Vec<String> = order(&core, &q("rozpočet")).into_iter().filter(|p| [ROZPOCET, PROJEKT, OBYCEJNA].contains(&p.as_str())).collect();
    assert_eq!(order(&core, &typed("rozpočet", "page")), alone, "rozpočet + Type: Page: the order of `rozpočet` alone (D-253)");
    guard(&page(&core, &typed("", "page")), "Type: Page");
}

#[test]
fn fr_src_02_ac15_filter_only_newest_modified_first() {
    let (_sb, _root, core) = fixture();
    assert_eq!(order(&core, &tagged(&["hory"])), vec![CHATA, POZDNI, BOUDA], "#hory: compared as instants (Pozdní's 23:00Z after Bouda's 00:30+02:00)");
    let mut ny = tagged(&["hory"]);
    ny.tz = NEW_YORK;
    assert_eq!(order(&core, &ny), vec![CHATA, POZDNI, BOUDA], "the same order with TZ=America/New_York");
    assert_eq!(order(&core, &typed("", "page")), vec![CHATA, BOUDA, CTENI, ROZPOCET, PROJEKT, OBYCEJNA], "Type: Page: Obyčejná (no modified) last");
}

#[test]
fn fr_src_02_ac15_equal_instants_tie_by_path_and_missing_or_invalid_last() {
    let sb = sandbox();
    let root = vault(&sb);
    let note = |m: Option<&str>| match m {
        Some(m) => format!("---\ntype: page\ntags: [stejné]\nmodified: {m}\n---\nText.\n"),
        None => "---\ntype: page\ntags: [stejné]\n---\nText.\n".to_string(),
    };
    for (p, m) in [
        ("Pages/Stejně d.md", None),
        ("Pages/Stejně c.md", Some("včera")),
        ("Pages/Stejně b.md", Some("2026-10-06T01:00:00+02:00")),
        ("Pages/Stejně a.md", Some("2026-10-05T23:00:00Z")),
        ("Pages/Stejně e.md", Some("2026-10-05T23:30:00-01:00")),
    ] {
        assert!(put(&root, p, note(m).as_bytes()), "setup {p}");
    }
    let core = core_at(&root, &sb, false);
    assert_eq!(
        order(&core, &tagged(&["stejné"])),
        vec!["Pages/Stejně e.md", "Pages/Stejně a.md", "Pages/Stejně b.md", "Pages/Stejně c.md", "Pages/Stejně d.md"],
        "newest instant first (e = 00:30Z), equal instants (a, b) by path, invalid and missing modified last by path"
    );
}

// ---------------------------------------------------------------- FR-SRC-03 AC-12 (paging), AC-20 (core calls)

#[test]
fn fr_src_03_ac12_offset_pages_slice_one_ordered_list() {
    let sb = sandbox();
    let root = vault(&sb);
    assert!(write_hromada(&root), "setup: Hromada 01…60");
    let core = core_at(&root, &sb, false);
    for (what, base) in [("ostružiník", q("ostružiník")), ("#hromada", tagged(&["hromada"]))] {
        let mut one = base.clone();
        one.limit = 100;
        let all = page(&core, &one);
        assert_eq!((all.results.len(), all.total), (60, 60), "{what}: 60 results");
        let mut first = base.clone();
        first.limit = 50;
        let mut second = base.clone();
        second.offset = 50;
        second.limit = 50;
        let (a, b) = (page(&core, &first), page(&core, &second));
        assert_eq!((a.results.len(), a.total, b.results.len(), b.total), (50, 60, 10, 60), "{what}: 50 + 10, total 60 each");
        let paged: Vec<String> = a.results.iter().chain(b.results.iter()).map(|r| r.path.clone()).collect();
        let whole: Vec<String> = all.results.iter().map(|r| r.path.clone()).collect();
        assert_eq!(paged, whole, "{what}: offset 0/50 + 50/50 = offset 0/100");
    }
    let mut all = tagged(&["hromada"]);
    all.limit = 100;
    let want: Vec<String> = (1..=60).rev().map(hromada).collect();
    assert_eq!(order(&core, &all), want, "#hromada in FR-SRC-02 AC-15 order (Hromada 60 first)");
}

#[test]
fn fr_src_03_ac20_core_search_calls_write_nothing() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = core_at(&root, &sb, true);
    std::thread::sleep(Duration::from_millis(300));
    let vault_before = snapshot(&root);
    // SQLite's `-shm` is shared memory that every reader updates (read marks); it isn't a stored write (AP-1127).
    let support = || {
        let mut m = snapshot(&sb.dirs.root);
        m.retain(|k, _| !k.ends_with("-shm"));
        m
    };
    let support_before = support();
    let mut calls = vec![q("rozpočet"), q("mlyn"), q("borůvkový koláč"), tagged(&["hory"]), tagged(&["hory", "zima"]), typed("", "page"), typed("rozpočet", "task")];
    let mut both = typed("rozpočet", "task");
    both.tags = vec!["finance".into()];
    calls.push(both);
    let mut next = q("rozpočet");
    next.offset = 50;
    calls.push(next);
    for c in &calls {
        let _ = core.search(c);
    }
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(snapshot(&root), vault_before, "the vault is byte-identical (content, mtime, inode)");
    assert_eq!(support(), support_before, "nothing written under Application Support");
    guard(&page(&core, &tagged(&["hory"])), "#hory");
}
