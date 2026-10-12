//! MS2 AC tests: FR-NAV-01 quick switcher (docs/acceptance/search-navigation.md), FR-FMT-12 AC-4 (switcher part).
//! Written from the ACs and docs/contracts/ms2-core.md §2.2, §3 only (D-61). Latency (AC-9) is in ac_perf.rs.

mod common;

use std::path::Path;
use std::time::{Duration, SystemTime};

use common::*;
use tegg_core::{Core, CoreOptions, MatchTier, SwitcherItem, SwitcherKind};
use tegg_vault::AppDirs;

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

fn open_core(root: &Path, dirs: &AppDirs, watch: bool) -> Core {
    let core = ok!(Core::open(root, dirs, CoreOptions { watch, sync: None }), "Core::open");
    assert!(core.wait_idle(Duration::from_secs(60)), "indexing did not become idle within 60 s");
    core
}

fn objects(items: &[SwitcherItem]) -> Vec<String> {
    items.iter().filter(|i| i.kind == SwitcherKind::Object).filter_map(|i| i.path.clone()).collect()
}

fn find<'a>(items: &'a [SwitcherItem], path: &str) -> Option<&'a SwitcherItem> {
    items.iter().find(|i| i.path.as_deref() == Some(path))
}

fn t(secs: u64) -> SystemTime {
    SystemTime::UNIX_EPOCH + Duration::from_secs(1_790_000_000 + secs)
}

#[test]
fn fr_nav_01_ac1_title_match_ranks_first_and_alias_is_shown() {
    let sb = sandbox();
    let root = search_vault(&sb);
    let core = open_core(&root, &sb.dirs, false);
    let items = core.switcher("cteni", 20);
    assert_eq!(objects(&items).first().map(String::as_str), Some(CTENI), "{items:?}");
    let items = core.switcher("reading", 20);
    assert_eq!(objects(&items), vec![CTENI.to_string()], "{items:?}");
    assert_eq!(find(&items, CTENI).and_then(|i| i.matched_alias.clone()), Some("Reading list".to_string()));
}

#[test]
fn fr_nav_01_ac2_fuzzy_in_order_letters_and_diacritics() {
    let sb = sandbox();
    let root = search_vault(&sb);
    let core = open_core(&root, &sb.dirs, false);
    let items = core.switcher("ztom", 20);
    assert!(objects(&items).contains(&TOMAS.to_string()), "ztom: {items:?}");
    assert_eq!(find(&items, TOMAS).and_then(|i| i.tier), Some(MatchTier::InOrder));
    let items = core.switcher("tomasovi", 20);
    assert!(objects(&items).contains(&TOMAS.to_string()), "tomasovi: {items:?}");
}

#[test]
fn fr_nav_01_ac3_match_tiers_order_and_body_is_not_searched() {
    let sb = sandbox();
    let root = search_vault(&sb);
    let core = open_core(&root, &sb.dirs, false);
    let items = core.switcher("rozpo", 20);
    assert_eq!(objects(&items), vec![ROZPOCET.to_string(), PROJEKT.to_string()], "{items:?}");
    assert_eq!(find(&items, ROZPOCET).and_then(|i| i.tier), Some(MatchTier::Prefix));
    assert_eq!(find(&items, PROJEKT).and_then(|i| i.tier), Some(MatchTier::WordPrefix));
    // A Create item is always offered for a non-empty query, last when something matches (D-106).
    assert_eq!(items.last().map(|i| i.kind), Some(SwitcherKind::Create), "{items:?}");
}

fn recency_vault(sb: &Sandbox) -> std::path::PathBuf {
    let root = search_vault(sb);
    let same = "created: 2026-09-01T10:00:00+02:00\nmodified: 2026-09-01T10:00:00+02:00\n";
    write_raw(&root, "Pages/Výlet do Brna.md", format!("---\nid: 01JA0S0000000000000000S031\ntype: page\ntitle: Výlet do Brna\n{same}---\nBrno.\n").as_bytes());
    write_raw(&root, "Pages/Výlet do Plzně.md", format!("---\nid: 01JA0S0000000000000000S032\ntype: page\ntitle: Výlet do Plzně\n{same}---\nPlzeň.\n").as_bytes());
    root
}

#[test]
fn fr_nav_01_ac4_recency_orders_within_a_tier_and_is_machine_local() {
    let sb = sandbox();
    let root = recency_vault(&sb);
    let core = open_core(&root, &sb.dirs, false);
    let (brno, plzen) = ("Pages/Výlet do Brna.md", "Pages/Výlet do Plzně.md");
    let before = snapshot(&root);

    let r1 = core.read_note(brno, t(10));
    assert!(r1.is_ok(), "read_note: {:?}", r1.err());
    let r2 = core.read_note(plzen, t(20));
    assert!(r2.is_ok(), "read_note: {:?}", r2.err());
    let order = objects(&core.switcher("výlet do", 20));
    assert_eq!(order, vec![plzen.to_string(), brno.to_string()]);

    let r3 = core.read_note(brno, t(30));
    assert!(r3.is_ok(), "read_note: {:?}", r3.err());
    let order = objects(&core.switcher("výlet do", 20));
    assert_eq!(order, vec![brno.to_string(), plzen.to_string()]);

    // Opening notes writes nothing to the vault; recency survives a restart (it lives in Application Support).
    drop(core);
    assert_eq!(snapshot(&root), before);
    let core = open_core(&root, &sb.dirs, false);
    assert_eq!(objects(&core.switcher("výlet do", 20)), vec![brno.to_string(), plzen.to_string()]);
}

#[test]
fn fr_nav_01_ac4_empty_query_lists_by_recency() {
    let sb = sandbox();
    let root = recency_vault(&sb);
    let core = open_core(&root, &sb.dirs, false);
    for (i, p) in [OBYCEJNA, TOMAS, CTENI].iter().enumerate() {
        let r = core.read_note(p, t(100 + i as u64));
        assert!(r.is_ok(), "read_note {p}: {:?}", r.err());
    }
    let items = core.switcher("", 3);
    assert_eq!(objects(&items), vec![CTENI.to_string(), TOMAS.to_string(), OBYCEJNA.to_string()]);
    assert!(items.iter().all(|i| i.kind == SwitcherKind::Object), "no Create item for an empty query");
}

#[test]
fn fr_nav_01_ac5_items_carry_type_and_folder() {
    let sb = sandbox();
    let root = search_vault(&sb);
    let core = open_core(&root, &sb.dirs, false);
    let items = core.switcher("tomasovi", 20);
    let tomas = find(&items, TOMAS).map(|i| (i.r#type.clone(), i.folder.clone(), i.title.clone()));
    assert_eq!(tomas, Some(("task".into(), "Tasks".into(), "Zavolat Tomášovi".into())));
    let items = core.switcher("obycejna", 20);
    let oby = find(&items, OBYCEJNA).map(|i| (i.r#type.clone(), i.folder.clone(), i.title.clone()));
    assert_eq!(oby, Some(("page".into(), "Pages".into(), "Obyčejná poznámka".into())));
}

#[test]
fn fr_nav_01_ac6_templates_and_trash_never_appear() {
    let sb = sandbox();
    let root = search_vault(&sb);
    let core = open_core(&root, &sb.dirs, false);
    assert!(!objects(&core.switcher("rozpo", 20)).is_empty(), "positive control");
    for query in ["sablona", "Šablona stránky", "smazany", "Smazaný rozpočet", "rozpocet", ""] {
        let got = objects(&core.switcher(query, 100));
        assert!(!got.contains(&TEMPLATE.to_string()) && !got.contains(&TRASHED.to_string()), "{query:?}: {got:?}");
    }
}

#[test]
fn fr_nav_01_ac7_create_item_when_nothing_matches() {
    let sb = sandbox();
    let root = search_vault(&sb);
    // The test vault's default type is Page, so the AC's `Pages/` folder follows from FR-VLT-05.
    let yml = std::fs::read_to_string(root.join(".tegg/vault.yml")).unwrap_or_default();
    write_raw(&root, ".tegg/vault.yml", yml.replace("default-type: Quick Note", "default-type: Page").as_bytes());
    let core = open_core(&root, &sb.dirs, true);

    let nfd_query = "Nova\u{301} mys\u{30C}lenka";
    let items = core.switcher(nfd_query, 20);
    assert_eq!(items.len(), 1, "{items:?}");
    let item = items[0].clone();
    assert_eq!(
        (item.kind, item.path.clone(), item.title.as_str(), item.r#type.as_str(), item.folder.as_str()),
        (SwitcherKind::Create, None, "Nová myšlenka", "page", "Pages")
    );

    let before = snapshot(&root);
    let bytes = "---\nid: 01JA0S0000000000000000S040\ntype: page\ntitle: Nová myšlenka\ncreated: 2026-10-12T09:00:00+02:00\nmodified: 2026-10-12T09:00:00+02:00\n---\n";
    let created = core.create_note(&item.folder, &item.title, bytes.as_bytes());
    assert_eq!(created.as_ref().ok().map(String::as_str), Some("Pages/Nová myšlenka.md"), "{:?}", created.as_ref().err());
    let after = snapshot(&root);
    let changed: Vec<&String> = after.keys().filter(|k| before.get(*k) != after.get(*k)).collect();
    assert_eq!(changed, vec!["Pages/Nová myšlenka.md"], "exactly one file written");
    assert!(before.keys().all(|k| after.contains_key(k)), "nothing removed");
    assert_eq!(std::fs::read(root.join("Pages/Nová myšlenka.md")).unwrap_or_default(), bytes.as_bytes());

    let found = wait_until(Duration::from_secs(2), || objects(&core.switcher("Nová myšlenka", 20)) == vec!["Pages/Nová myšlenka.md".to_string()]);
    assert!(found.is_some(), "new object not returned by the switcher within 2 s");
}

#[test]
fn fr_nav_01_ac8_nfd_query_equals_nfc_query() {
    let sb = sandbox();
    let root = search_vault(&sb);
    let core = open_core(&root, &sb.dirs, false);
    for (nfc, nfd) in [("Čtení", NFD_CTENI.to_string()), ("rozpočet", "rozpoc\u{30C}et".to_string()), ("tomáš", "toma\u{301}s\u{30C}".to_string())] {
        let a = core.switcher(nfc, 20);
        assert!(!objects(&a).is_empty(), "positive control {nfc}");
        assert_eq!(objects(&core.switcher(&nfd, 20)), objects(&a), "{nfc}");
    }
}

#[test]
fn fr_nav_01_ac10_external_rename_keeps_identity_within_2_s() {
    let sb = sandbox();
    let root = search_vault(&sb);
    let core = open_core(&root, &sb.dirs, true);
    let id_before = core.object(CTENI).and_then(|o| o.id);
    assert_eq!(id_before.as_deref(), Some("01JA0S0000000000000000S001"));
    std::fs::rename(root.join(CTENI), root.join("Pages/Knihy.md")).unwrap_or(());
    let seen = wait_until(Duration::from_secs(2), || objects(&core.switcher("knihy", 20)).contains(&"Pages/Knihy.md".to_string()));
    assert!(seen.is_some(), "renamed object not found by `knihy` within 2 s");
    let items = core.switcher("knihy", 20);
    assert_eq!(find(&items, "Pages/Knihy.md").map(|i| i.folder.clone()), Some("Pages".to_string()));
    let items = core.switcher("cteni", 20);
    assert_eq!(objects(&items).first().map(String::as_str), Some("Pages/Knihy.md"), "{items:?}");
    assert!(!objects(&items).contains(&CTENI.to_string()), "old path still listed");
    assert_eq!(core.object("Pages/Knihy.md").and_then(|o| o.id), id_before);
}

#[test]
fn fr_fmt_12_ac4_switcher_matches_cteni_to_čtení() {
    let sb = sandbox();
    let root = search_vault(&sb);
    let core = open_core(&root, &sb.dirs, false);
    assert_eq!(objects(&core.switcher("cteni", 20)), vec![CTENI.to_string()]);
}
