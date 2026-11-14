//! Slice REL L4 tests of `Index::related` and the `rel` table on a temporary copy of tests/fixtures/vaults/related
//! (+ new-empty/.tegg), indexed through `Index::upsert` (docs/acceptance/related.md R179…R182; docs/contracts/v1-related.md
//! §1.4–§1.10, §7): FR-LNK-15 AC-5, AC-6 (the fixture's languages), AC-10, AC-11, AC-12, AC-13 (the fixture), AC-14 (one
//! test per README row), AC-15, AC-16, AC-17, AC-20, AC-31 (the Image and PDF objects' lists), FR-SRC-04 AC-12 and
//! FR-FMT-12 AC-11 (one `rel` row). Expected values come from the fixture README ("Expected lists", "Expected
//! excerpts", the cluster tables). External changes are a file write plus `upsert` / `remove` (the watcher's path is
//! tested through the core, crates/tegg-core/tests/ac_related.rs). Equal titles are ordered by code point (CP-2: the
//! fixture's ties order the same in every collation). Written from the ACs and the contract only (D-61); every check is
//! an assertion in this file (tools/qa CONTRACT §5.2).

#[path = "support/related.rs"]
mod support;

use std::collections::{BTreeMap, BTreeSet};

use support::*;
use tegg_index::{Index, RelatedList, RelatedParams, RelatedReason, SearchQuery};

macro_rules! some {
    ($e:expr, $what:expr) => {
        match $e {
            Some(v) => v,
            None => {
                assert!(false, "{}: no answer (not indexed)", $what);
                unreachable!()
            }
        }
    };
}

fn list(idx: &Index, path: &str, shown: bool) -> RelatedList {
    some!(related(idx, path, shown), format!("index related({path}, {shown})"))
}
fn linked_of(l: &RelatedList) -> Vec<(String, bool)> {
    l.entries.iter().map(|e| (nfc(&e.path), e.linked)).collect()
}
fn h(n: u32) -> String {
    nfc(&hvezda(n))
}

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-5

const ZDROJE: &str = "Pages/Zdroje textu.md";
fn zdroje() -> String {
    "---\nid: 01JRE00000000000000000000A5\ntype: page\ntitle: Zdroje textu\naliases: [Textové zdroje]\ntags: [kytara]\npoznamka: harmonika buben\n\
description: klavír\ncreated: 2026-11-14T09:00:00+01:00\nmodified: 2026-11-14T09:00:00+01:00\n---\n## Housle\n\nSázím #rajče.\n\n```\nteleskop\n```\n\n\
Viz [[Kniha vzpomínek|kniha]] a https://example.com/kometa.\n"
        .to_string()
}

#[test]
fn fr_lnk_15_ac5_which_text_is_stemmed() {
    let v = related_vault();
    let mut idx = index(&v);
    put(&mut idx, &v, ZDROJE, zdroje().as_bytes());
    let t = some!(idx.rel_terms(&nfc(ZDROJE)), "rel_terms(Zdroje textu)");
    let title: BTreeSet<String> = t.title.iter().cloned().collect();
    assert_eq!(title, set(&["zdroj", "text"]), "the title column: the stems of the title and the alias");
    let body: BTreeSet<String> = t.body.iter().cloned().collect();
    for s in ["kytar", "housl", "rajk", "teleskop", "knih", "vzpomink", "komt"] {
        assert!(body.contains(s), "the body column holds {s}: {body:?}");
    }
    for s in ["harmonik", "bubn", "klavir"] {
        assert!(!body.contains(s) && !title.contains(s), "no property value is text ({s}): {body:?}");
    }
}

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-6 (fixture)

/// (Czech-only, English-only) stop-word counts of a file's title and body.
fn stop_counts(text: &str, title: &str) -> (usize, usize) {
    let cs: BTreeSet<&str> = tegg_index::stemming::stop_words(tegg_index::stemming::Lang::Cs).iter().copied().collect();
    let en: BTreeSet<&str> = tegg_index::stemming::stop_words(tegg_index::stemming::Lang::En).iter().copied().collect();
    let mut c = (0, 0);
    for w in folded_words(&format!("{title}\n{}", body_of(text))) {
        match (cs.contains(w.as_str()), en.contains(w.as_str())) {
            (true, false) => c.0 += 1,
            (false, true) => c.1 += 1,
            _ => {}
        }
    }
    c
}

#[test]
fn fr_lnk_15_ac6_language_per_note_and_english_stems_fixture() {
    let v = related_vault();
    let idx = index(&v);
    let english = set(&[HIKING, TRAIL, GEAR]);
    let mut bad = Vec::new();
    for p in objects() {
        let want = if english.contains(&p) { tegg_index::stemming::Lang::En } else { tegg_index::stemming::Lang::Cs };
        match idx.rel_terms(&p) {
            Some(t) if t.lang == want => {}
            other => bad.push(format!("{p}: {:?}, want {want:?}", other.map(|t| t.lang))),
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "Hiking, Trail and gear list are English; every other note is Czech");
    // D-1730 (CP-6): Souhvězdí and Kytara hold no stop word of either list, Hvězda 01 one Czech one (`z`); all Czech.
    for (p, title, want) in [(SOUHVEZDI, "Souhvězdí", (0, 0)), (KYTARA, "Kytara", (0, 0)), ("Pages/Hvězda 01.md", "Hvězda 01", (1, 0))] {
        assert_eq!(stop_counts(&fixture_text(p), title), want, "{p}: stop-word counts (Czech-only, English-only)");
        assert_eq!(idx.rel_terms(&nfc(p)).map(|t| t.lang), Some(tegg_index::stemming::Lang::Cs), "{p} is Czech");
    }
    let tura = some!(idx.rel_terms(&nfc(TURA)), "rel_terms(Túra)");
    let hiking = some!(idx.rel_terms(&nfc(HIKING)), "rel_terms(Hiking)");
    let a: BTreeSet<String> = tura.title.iter().chain(&tura.body).cloned().collect();
    let b: BTreeSet<String> = hiking.title.iter().chain(&hiking.body).cloned().collect();
    assert!(!a.is_empty() && !b.is_empty(), "Túra and Hiking have stems");
    assert_eq!(a.intersection(&b).cloned().collect::<Vec<_>>(), Vec::<String>::new(), "Túra shares no stem with Hiking");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-10

const EXCLUDED: [&str; 5] = [VCELARENI, UL, NAVOD, SABLONA, STARY];

#[test]
fn fr_lnk_15_ac10_candidates_by_type_and_folder() {
    let v = related_vault();
    let mut idx = index(&v);
    for shown in [false, true] {
        assert_eq!(paths(&list(&idx, VCELSTVO, shown)), owned(&[PROHLIDKA]), "Včelstvo's list is exactly [Prohlídka] (shown {shown})");
    }
    let mut bad = Vec::new();
    for p in objects() {
        for shown in [false, true] {
            let l = list(&idx, &p, shown);
            for e in &l.entries {
                let ep = nfc(&e.path);
                if ep == p {
                    bad.push(format!("{p} is in its own list"));
                }
                if EXCLUDED.iter().any(|x| nfc(x) == ep) {
                    bad.push(format!("{p} (shown {shown}) lists {ep}"));
                }
                if ["tag", "image", "pdf"].contains(&e.r#type.as_str()) {
                    bad.push(format!("{p} lists a {} object {ep}", e.r#type));
                }
            }
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "no Tag, Image, PDF, template or trashed object, and no object in its own list");
    let roz = paths(&list(&idx, ROZPOCET, false));
    assert!(roz.contains(&nfc(DEN)) && roz.contains(&nfc(UKOL)), "a Daily Note and a Task are candidates: {roz:?}");
    assert!(paths(&list(&idx, TERMINY_A, false)).contains(&nfc(SKOLENI)), "a Quick Note is a candidate");
    assert!(paths(&list(&idx, HIKING, false)).contains(&nfc(GEAR)), "a file without frontmatter is a candidate");
    // Runtime: Prohlídka becomes a Tag, then back; Starý úl is restored from the trash.
    let orig = fixture_text(PROHLIDKA);
    put(&mut idx, &v, PROHLIDKA, orig.replacen("type: page", "type: tag", 1).as_bytes());
    assert_eq!(paths(&list(&idx, VCELSTVO, false)), Vec::<String>::new(), "Prohlídka as a tag: Včelstvo's list is empty");
    put(&mut idx, &v, PROHLIDKA, orig.as_bytes());
    let stary = fixture_text(STARY);
    let _ = std::fs::remove_file(v.root.join(STARY));
    put(&mut idx, &v, STARY_RESTORED, stary.as_bytes());
    let got: BTreeSet<String> = paths(&list(&idx, VCELSTVO, false)).into_iter().collect();
    assert_eq!(got, set(&[PROHLIDKA, STARY_RESTORED]), "Starý úl restored to Pages/: Včelstvo's list is {{Prohlídka, Starý úl}}");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-11

fn check_linked_table(idx: &Index, what: &str) {
    let zahrada_h = list(idx, ZAHRADA, false);
    assert_eq!((paths(&zahrada_h), zahrada_h.reason), (Vec::<String>::new(), None), "{what}: Zahrada, linked hidden: no entries, reason null");
    let zs: BTreeMap<String, bool> = linked_of(&list(idx, ZAHRADA, true)).into_iter().collect();
    assert_eq!(zs, [(nfc(ZAHON), true), (nfc(SEMINKA), true)].into_iter().collect(), "{what}: Zahrada, linked shown: {{Záhon, Semínka}}, both linked");
    assert_eq!(paths(&list(idx, ZAHON, false)), owned(&[SEMINKA]), "{what}: Záhon, linked hidden: [Semínka]");
    let zh: BTreeMap<String, bool> = linked_of(&list(idx, ZAHON, true)).into_iter().collect();
    assert_eq!(zh, [(nfc(ZAHRADA), true), (nfc(SEMINKA), false)].into_iter().collect(), "{what}: Záhon, linked shown");
    assert_eq!(paths(&list(idx, SEMINKA, false)), owned(&[ZAHON]), "{what}: Semínka, linked hidden: [Záhon]");
    let sm: BTreeMap<String, bool> = linked_of(&list(idx, SEMINKA, true)).into_iter().collect();
    assert_eq!(sm, [(nfc(ZAHRADA), true), (nfc(ZAHON), false)].into_iter().collect(), "{what}: Semínka, linked shown");
    for p in [ZAHRADA, ZAHON, SEMINKA] {
        assert!(list(idx, p, false).entries.iter().all(|e| !e.linked), "{what}: {p}: no linked: true with linked hidden");
    }
}

#[test]
fn fr_lnk_15_ac11_linked_objects_hidden_by_default() {
    let v = related_vault();
    let mut idx = index(&v);
    check_linked_table(&idx, "the fixture");
    let orig = fixture_text(SEMINKA);
    let link = "Patří k [[Zahrada na jaře]].";
    assert!(orig.contains(link), "setup: Semínka's link paragraph");
    let property = orig.replacen("title: Semínka na jaro\n", "title: Semínka na jaro\nsouvisí: \"[[Zahrada na jaře]]\"\n", 1).replacen(&format!("\n{link}\n"), "", 1);
    let variants = [
        ("a property souvisí", property),
        ("a heading link", orig.replacen(link, "Patří k [[Zahrada na jaře#Jaro]].", 1)),
        ("an embed", orig.replacen(link, "Patří k ![[Zahrada na jaře]].", 1)),
        ("a Markdown link", orig.replacen(link, "Patří k [jaro](Zahrada%20na%20ja%C5%99e.md).", 1)),
    ];
    for (what, text) in variants {
        put(&mut idx, &v, SEMINKA, text.as_bytes());
        check_linked_table(&idx, what);
    }
    put(&mut idx, &v, SEMINKA, orig.replacen(link, "Patří k Zahrada na jaře.", 1).as_bytes());
    assert!(paths(&list(&idx, ZAHRADA, false)).contains(&nfc(SEMINKA)), "plain words instead of the link: Semínka is in Zahrada's list with linked hidden");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-12

#[test]
fn fr_lnk_15_ac12_cap_of_ten_applies_as_shown() {
    let v = related_vault();
    let idx = index(&v);
    let hidden = list(&idx, SOUHVEZDI, false);
    assert_eq!(paths(&hidden), (3..=12).map(h).collect::<Vec<_>>(), "linked hidden: exactly Hvězda 03 … 12, in title order");
    let s0 = hidden.entries.first().map(|e| e.score).unwrap_or(-1.0);
    assert!(hidden.entries.iter().all(|e| (e.score - s0).abs() <= 1e-9), "all ten score the same");
    let shown = list(&idx, SOUHVEZDI, true);
    let mut want: Vec<(String, bool)> = vec![(h(2), true), (h(1), true)];
    want.extend((3..=10).map(|n| (h(n), false)));
    assert_eq!(linked_of(&shown), want, "linked shown: Hvězda 02, 01, then 03 … 10; only 01 and 02 linked; 11 and 12 cut by the cap");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-13 (fixture)

#[test]
fn fr_lnk_15_ac13_floor_shared_stems_and_relative_score_fixture() {
    let v = related_vault();
    let idx = index(&v);
    let distinct = |p: &str| idx.rel_terms(&nfc(p)).map(|t| t.title.iter().chain(&t.body).cloned().collect::<BTreeSet<String>>().len());
    assert_eq!((distinct(BUBEN), distinct(KYTARA), distinct(MLEKO), distinct(PRAZDNA)), (Some(4), Some(5), Some(3), Some(1)), "distinct stems: Buben 4, Kytara 5, Mléko 3, Prázdná 1");
    for p in [BUBEN, MLEKO, PRAZDNA] {
        for shown in [false, true] {
            let l = list(&idx, p, shown);
            assert_eq!((paths(&l), l.reason), (Vec::<String>::new(), Some(RelatedReason::Short)), "{p} (shown {shown}): no entries, reason short");
        }
    }
    let k: BTreeSet<String> = paths(&list(&idx, KYTARA, false)).into_iter().collect();
    assert_eq!(k, set(&[KROUZEK, BUBEN]), "Kytara lists {{Kroužek, Buben}}: a short object is still a candidate");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-14

#[derive(Clone, Copy)]
enum Want {
    Ordered(&'static [&'static str]),
    Set(&'static [&'static str]),
    Empty(Option<RelatedReason>),
}
fn want_list(path: &str, hidden: Want, shown: Option<Want>) {
    let v = related_vault();
    let idx = index(&v);
    let shown = shown.unwrap_or(hidden);
    for (s, want) in [(false, hidden), (true, shown)] {
        let l = list(&idx, path, s);
        match want {
            Want::Ordered(x) => assert_eq!(paths(&l), owned(x), "{path} (linked shown {s}): the ordered list"),
            Want::Set(x) => {
                let got: BTreeSet<String> = paths(&l).into_iter().collect();
                assert_eq!((got, l.entries.len()), (set(x), x.len()), "{path} (linked shown {s}): the set");
            }
            Want::Empty(r) => assert_eq!((paths(&l), l.reason), (Vec::<String>::new(), r), "{path} (linked shown {s}): no entries"),
        }
    }
}
macro_rules! row {
    ($name:ident, $path:expr, $hidden:expr) => {
        #[test]
        fn $name() {
            want_list($path, $hidden, None);
        }
    };
    ($name:ident, $path:expr, $hidden:expr, $shown:expr) => {
        #[test]
        fn $name() {
            want_list($path, $hidden, Some($shown));
        }
    };
}
const H3_12: &[&str] = &[
    "Pages/Hvězda 03.md", "Pages/Hvězda 04.md", "Pages/Hvězda 05.md", "Pages/Hvězda 06.md", "Pages/Hvězda 07.md", "Pages/Hvězda 08.md", "Pages/Hvězda 09.md",
    "Pages/Hvězda 10.md", "Pages/Hvězda 11.md", "Pages/Hvězda 12.md",
];
const H_SHOWN: &[&str] = &[
    "Pages/Hvězda 02.md", "Pages/Hvězda 01.md", "Pages/Hvězda 03.md", "Pages/Hvězda 04.md", "Pages/Hvězda 05.md", "Pages/Hvězda 06.md", "Pages/Hvězda 07.md",
    "Pages/Hvězda 08.md", "Pages/Hvězda 09.md", "Pages/Hvězda 10.md",
];
row!(fr_lnk_15_ac14_expected_list_of_every_fixture_object_souhvezdi, SOUHVEZDI, Want::Ordered(H3_12), Want::Ordered(H_SHOWN));
row!(fr_lnk_15_ac14_expected_list_of_every_fixture_object_rozpocet, ROZPOCET, Want::Ordered(&[DEN, UKOL]));
row!(fr_lnk_15_ac14_expected_list_of_every_fixture_object_den, DEN, Want::Set(&[ROZPOCET, UKOL]));
row!(fr_lnk_15_ac14_expected_list_of_every_fixture_object_ukol, UKOL, Want::Set(&[ROZPOCET, DEN]));
row!(fr_lnk_15_ac14_expected_list_of_every_fixture_object_terminy_a, TERMINY_A, Want::Ordered(&[TERMINY_B, SKOLENI]));
row!(fr_lnk_15_ac14_expected_list_of_every_fixture_object_terminy_b, TERMINY_B, Want::Ordered(&[TERMINY_A, SKOLENI]));
row!(fr_lnk_15_ac14_expected_list_of_every_fixture_object_skoleni, SKOLENI, Want::Ordered(&[TERMINY_B, TERMINY_A]));
row!(fr_lnk_15_ac14_expected_list_of_every_fixture_object_kniha, KNIHA, Want::Ordered(&[POZNAMKY]));
row!(fr_lnk_15_ac14_expected_list_of_every_fixture_object_poznamky, POZNAMKY, Want::Ordered(&[KNIHA]));
row!(fr_lnk_15_ac14_expected_list_of_every_fixture_object_zahrada, ZAHRADA, Want::Empty(None), Want::Set(&[ZAHON, SEMINKA]));
row!(fr_lnk_15_ac14_expected_list_of_every_fixture_object_zahon, ZAHON, Want::Ordered(&[SEMINKA]), Want::Set(&[ZAHRADA, SEMINKA]));
row!(fr_lnk_15_ac14_expected_list_of_every_fixture_object_seminka, SEMINKA, Want::Ordered(&[ZAHON]), Want::Set(&[ZAHRADA, ZAHON]));
row!(fr_lnk_15_ac14_expected_list_of_every_fixture_object_vcelstvo, VCELSTVO, Want::Ordered(&[PROHLIDKA]));
row!(fr_lnk_15_ac14_expected_list_of_every_fixture_object_prohlidka, PROHLIDKA, Want::Ordered(&[VCELSTVO]));
row!(fr_lnk_15_ac14_expected_list_of_every_fixture_object_ul_u_lesa, UL, Want::Ordered(&[VCELSTVO]));
row!(fr_lnk_15_ac14_expected_list_of_every_fixture_object_navod, NAVOD, Want::Ordered(&[VCELSTVO]));
row!(fr_lnk_15_ac14_expected_list_of_every_fixture_object_hiking, HIKING, Want::Ordered(&[TRAIL, GEAR]));
row!(fr_lnk_15_ac14_expected_list_of_every_fixture_object_trail, TRAIL, Want::Set(&[HIKING, GEAR]));
row!(fr_lnk_15_ac14_expected_list_of_every_fixture_object_gear_list, GEAR, Want::Set(&[HIKING, TRAIL]));
row!(fr_lnk_15_ac14_expected_list_of_every_fixture_object_tura, TURA, Want::Empty(None));
row!(fr_lnk_15_ac14_expected_list_of_every_fixture_object_mleko, MLEKO, Want::Empty(Some(RelatedReason::Short)));
row!(fr_lnk_15_ac14_expected_list_of_every_fixture_object_buben, BUBEN, Want::Empty(Some(RelatedReason::Short)));
row!(fr_lnk_15_ac14_expected_list_of_every_fixture_object_kytara, KYTARA, Want::Set(&[KROUZEK, BUBEN]));
row!(fr_lnk_15_ac14_expected_list_of_every_fixture_object_krouzek, KROUZEK, Want::Set(&[KYTARA, BUBEN]));
row!(fr_lnk_15_ac14_expected_list_of_every_fixture_object_svatba, SVATBA, Want::Empty(None));
row!(fr_lnk_15_ac14_expected_list_of_every_fixture_object_prazdna, PRAZDNA, Want::Empty(Some(RelatedReason::Short)));

#[test]
fn fr_lnk_15_ac14_expected_list_of_every_fixture_object_linked_flags() {
    let v = related_vault();
    let idx = index(&v);
    // Only the README's (L) entries are linked with linked shown; hidden lists never carry `linked: true`.
    let mut want_linked: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    want_linked.insert(nfc(SOUHVEZDI), set(&["Pages/Hvězda 01.md", "Pages/Hvězda 02.md"]));
    want_linked.insert(nfc(ZAHRADA), set(&[ZAHON, SEMINKA]));
    want_linked.insert(nfc(ZAHON), set(&[ZAHRADA]));
    want_linked.insert(nfc(SEMINKA), set(&[ZAHRADA]));
    let mut bad = Vec::new();
    for p in objects().into_iter().filter(|p| !p.starts_with("Pages/Hvězda ") && *p != nfc(VCELARENI)) {
        let shown: BTreeSet<String> = list(&idx, &p, true).entries.iter().filter(|e| e.linked).map(|e| nfc(&e.path)).collect();
        if shown != want_linked.get(&p).cloned().unwrap_or_default() {
            bad.push(format!("{p}: linked {shown:?}"));
        }
        if list(&idx, &p, false).entries.iter().any(|e| e.linked) {
            bad.push(format!("{p}: linked: true with linked hidden"));
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "the (L) marks of the README");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-15

#[test]
fn fr_lnk_15_ac15_inflected_forms_without_diacritics_match() {
    let v = related_vault();
    let idx = index(&v);
    assert_eq!(paths(&list(&idx, KNIHA, false)), owned(&[POZNAMKY]), "Kniha → [Poznamky]");
    assert_eq!(paths(&list(&idx, POZNAMKY, false)), owned(&[KNIHA]), "Poznamky → [Kniha]");
    let stems_of = |p: &str| idx.rel_terms(&nfc(p)).map(|t| t.title.into_iter().chain(t.body).collect::<BTreeSet<String>>()).unwrap_or_default();
    let common: BTreeSet<String> = stems_of(KNIHA).intersection(&stems_of(POZNAMKY)).cloned().collect();
    assert_eq!(common, set(&["knih", "prah", "domk", "matk", "potok", "ruk", "zeln", "plot"]), "they share exactly the 8 stems");
    let words = |p: &str, title: &str| -> BTreeSet<String> {
        folded_words(&format!("{title}\n{}", body_of(&fixture_text(p)))).into_iter().filter(|w| !tegg_index::stemming::is_stop_word(w)).collect()
    };
    let wcommon: Vec<String> = words(KNIHA, "Kniha vzpomínek").intersection(&words(POZNAMKY, "Poznamky ke knize")).cloned().collect();
    assert_eq!(wcommon, vec!["plot".to_string()], "the files' folded non-stop words have exactly one word in common, plot");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-16

fn score_in(l: &RelatedList, path: &str) -> Option<f64> {
    l.entries.iter().find(|e| nfc(&e.path) == nfc(path)).map(|e| e.score)
}

#[test]
fn fr_lnk_15_ac16_unaccented_twin_is_equivalent() {
    let v = related_vault();
    let mut idx = index(&v);
    let p = RelatedParams::default();
    let a = some!(idx.related_signature(&nfc(TERMINY_A), &p), "related_signature(Termíny)");
    let b = some!(idx.related_signature(&nfc(TERMINY_B), &p), "related_signature(Terminy)");
    assert!(!a.is_empty(), "Termíny has a signature");
    assert_eq!(a.iter().map(|x| x.0.clone()).collect::<Vec<_>>(), b.iter().map(|x| x.0.clone()).collect::<Vec<_>>(), "the same signature stems");
    assert!(a.iter().zip(&b).all(|(x, y)| (x.1 - y.1).abs() <= 1e-9), "with the same weights");
    let check = |idx: &Index, what: &str| {
        assert_eq!(paths(&list(idx, TERMINY_A, false)), owned(&[TERMINY_B, SKOLENI]), "{what}: Termíny → [Terminy, Školení]");
        assert_eq!(paths(&list(idx, TERMINY_B, false)), owned(&[TERMINY_A, SKOLENI]), "{what}: Terminy → [Termíny, Školení]");
        let s = list(idx, SKOLENI, false);
        assert_eq!(paths(&s), owned(&[TERMINY_B, TERMINY_A]), "{what}: Školení → [Terminy, Termíny] (equal scores, by title)");
        let (x, y) = (score_in(&s, TERMINY_B).unwrap_or(-1.0), score_in(&s, TERMINY_A).unwrap_or(-2.0));
        assert!((x - y).abs() <= 1e-9, "{what}: in Školení's list the two score the same ({x}, {y})");
        let (la, lb) = (list(idx, TERMINY_A, true), list(idx, TERMINY_B, true));
        let (sa, sb) = (score_in(&la, SKOLENI).unwrap_or(-1.0), score_in(&lb, SKOLENI).unwrap_or(-2.0));
        assert!((sa - sb).abs() <= 1e-9, "{what}: Školení scores the same against Termíny as against Terminy");
        let (ta, tb) = (score_in(&la, TERMINY_B).unwrap_or(-1.0), score_in(&lb, TERMINY_A).unwrap_or(-2.0));
        assert!((ta - tb).abs() <= 1e-9, "{what}: each twin scores the same against the other");
        for o in objects() {
            let l = list(idx, &o, true);
            if let (Some(x), Some(y)) = (score_in(&l, TERMINY_A), score_in(&l, TERMINY_B)) {
                assert!((x - y).abs() <= 1e-9, "{what}: {o} scores Termíny and Terminy the same");
            }
        }
    };
    check(&idx, "the fixture");
    let text = fixture_text(TERMINY_A);
    put(&mut idx, &v, TERMINY_A, nfd(&text).as_bytes());
    check(&idx, "Termíny in NFD bytes");
    assert_eq!(idx.rel_rows(), 39, "still one rel row per object");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-17

#[test]
fn fr_lnk_15_ac17_tag_names_are_words_without_bonus() {
    let v = related_vault();
    let mut idx = index(&v);
    let orig = fixture_text(SVATBA);
    let with_tags = orig.replacen("title: Svatba Petra a Lucie\n", "title: Svatba Petra a Lucie\ntags: [kniha, praha, matka]\n", 1);
    put(&mut idx, &v, SVATBA, with_tags.as_bytes());
    let l = list(&idx, SVATBA, false);
    let got: BTreeSet<String> = paths(&l).into_iter().collect();
    assert_eq!(got, set(&[KNIHA, POZNAMKY]), "Svatba with tags [kniha, praha, matka] lists {{Kniha, Poznamky}}");
    assert!(l.entries.iter().all(|e| e.shared == 3), "3 shared stems each");
    let s_tags = score_in(&l, KNIHA).unwrap_or(-1.0);
    put(&mut idx, &v, SVATBA, format!("{orig}\nKniha, Praha, matka.\n").as_bytes());
    let s_par = score_in(&list(&idx, SVATBA, false), KNIHA).unwrap_or(-2.0);
    put(&mut idx, &v, SVATBA, format!("{orig}\n#kniha #praha #matka\n").as_bytes());
    let s_inline = score_in(&list(&idx, SVATBA, false), KNIHA).unwrap_or(-3.0);
    assert!((s_tags - s_par).abs() <= 1e-9, "tags score as the paragraph Kniha, Praha, matka. ({s_tags}, {s_par})");
    assert!((s_tags - s_inline).abs() <= 1e-9, "tags score as the inline #tags ({s_tags}, {s_inline})");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-20

/// README "Expected excerpts": (open object, linked shown, entry, excerpt).
const EXCERPTS: [(&str, bool, &str, &str); 13] = [
    (ROZPOCET, false, DEN, "Zítra: projít rozpocet s Janou a poslat naklady na offsite financim."),
    (ROZPOCET, false, UKOL, "Do pá 27. 11. musí návrh rozpočtu na offsite projít přes finance, Jana ho podepíše."),
    (TERMINY_A, false, TERMINY_B, "Dodavatel zasle prihlasky a termin schuzky s vedenim potvrdi ve ctvrtek."),
    (TERMINY_A, false, SKOLENI, "Školení pro vedení: dodavatel zašle přihlášky, termín schůzky ve čtvrtek."),
    (TERMINY_B, false, TERMINY_A, "Dodavatel zašle přihlášky a termín schůzky s vedením potvrdí ve čtvrtek."),
    (POZNAMKY, false, KNIHA, "Praha je daleko, ale ta kniha je blízko."),
    (KNIHA, false, POZNAMKY, "V Praze, v malem domku, matce rikala o knize."),
    (HIKING, false, TRAIL, "Notes from the trail: the boots held up, the lake was cold, and the mountain hut was full."),
    (HIKING, false, GEAR, "Pack the boots, a rain jacket, the map of the trail and water for the hike."),
    (ZAHRADA, true, SEMINKA, "Koupit semínka rajčat a paprik, na jaře do záhonu."),
    (ZAHRADA, true, ZAHON, "Rajčata potřebují slunce a kompost."),
    (SOUHVEZDI, true, "Pages/Hvězda 02.md", "Pozorování: teleskopem, kometou, meteory."),
    (VCELSTVO, false, PROHLIDKA, "Včelstva jsou silná, rámky plné plodu, dělnic přibývá a pylu je dost."),
];

fn excerpt_of(idx: &Index, open: &str, shown: bool, entry: &str) -> Option<String> {
    related(idx, open, shown).and_then(|l| l.entries.into_iter().find(|e| nfc(&e.path) == nfc(entry))).and_then(|e| e.excerpt)
}

#[test]
fn fr_lnk_15_ac20_excerpt_is_the_most_relevant_sentence_as_written_fixture() {
    let v = related_vault();
    let mut idx = index(&v);
    let mut bad = Vec::new();
    for (open, shown, entry, want) in EXCERPTS {
        let got = excerpt_of(&idx, open, shown, entry);
        if got.as_deref() != Some(want) {
            bad.push(format!("{open} → {entry}: {got:?}, want {want:?}"));
        }
        if !fixture_text(entry).contains(want) {
            bad.push(format!("setup: {entry} doesn't hold {want:?}"));
        }
        if let Some(g) = got {
            if g != nfc(&g) {
                bad.push(format!("{open} → {entry}: the excerpt is not NFC"));
            }
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "every expected excerpt, as written in the file");
    put(&mut idx, &v, TERMINY_A, nfd(&fixture_text(TERMINY_A)).as_bytes());
    assert_eq!(
        excerpt_of(&idx, TERMINY_B, false, TERMINY_A),
        Some(nfc("Dodavatel zašle přihlášky a termín schůzky s vedením potvrdí ve čtvrtek.")),
        "Termíny in NFD bytes: its excerpt in Terminy's list is NFC-equal to the one before"
    );
}

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-31 (L4)

#[test]
fn fr_lnk_15_ac31_routes_with_the_related_tab_image_and_pdf_lists() {
    let v = related_vault();
    let idx = index(&v);
    for p in [UL, NAVOD] {
        for shown in [false, true] {
            assert_eq!(paths(&list(&idx, p, shown)), owned(&[VCELSTVO]), "{p} (shown {shown}) → [Včelstvo]");
        }
    }
}

// ------------------------------------------------------------------------------------------------ FR-SRC-04 AC-12

#[test]
fn fr_src_04_ac12_search_matches_words_not_stems() {
    let v = related_vault();
    let idx = index(&v);
    assert_eq!(idx.rel_rows(), 39, "the rel table is built next to fts (D-1694): one row per object");
    let hits = |q: &str| -> BTreeSet<String> {
        match idx.search(&SearchQuery::text(q, chrono_tz::Europe::Prague)) {
            Ok(p) => p.results.into_iter().map(|r| nfc(&r.path)).collect(),
            Err(e) => {
                assert!(false, "search {q}: {e:?}");
                unreachable!()
            }
        }
    };
    assert_eq!(hits("rozpočtu"), set(&[UKOL]), "rozpočtu: exactly Úkol");
    assert_eq!(hits("knize"), set(&[POZNAMKY]), "knize: exactly Poznamky");
    assert_eq!(hits("dulezite"), set(&[TERMINY_A, TERMINY_B]), "dulezite: Termíny and Terminy (folding, not stemming)");
    assert_eq!(hits("rozpock"), BTreeSet::new(), "a stem is not a word of fts");
}

// ------------------------------------------------------------------------------------------------ FR-FMT-12 AC-11 (L4)

#[test]
fn fr_fmt_12_ac11_nfd_paths_and_bodies_in_related_one_rel_row() {
    let v = related_vault();
    let mut idx = index(&v);
    assert_eq!(idx.rel_rows(), 39, "the fixture has 39 rel rows");
    let bytes = fixture_text(KNIHA);
    drop_file(&mut idx, &v, KNIHA);
    put(&mut idx, &v, &nfd(KNIHA), bytes.as_bytes());
    assert_eq!(idx.rel_rows(), 39, "Kniha renamed to its NFD-named form: one rel row, not two");
    assert!(idx.rel_terms(&nfc(KNIHA)).is_some(), "its row is found by the NFC path");
    let l = list(&idx, POZNAMKY, false);
    let kn: Vec<(String, String)> = l.entries.iter().filter(|e| nfc(&e.path) == nfc(KNIHA)).map(|e| (e.path.clone(), e.title.clone())).collect();
    assert_eq!(kn, vec![(nfc(KNIHA), nfc("Kniha vzpomínek"))], "Poznamky's list shows Kniha vzpomínek once, NFC");
}
