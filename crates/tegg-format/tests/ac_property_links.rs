//! MS3 3D follow-up AC tests for the Rust extractor (L1 side of the TS/Rust pair): FR-LNK-02 AC-1, AC-3 (links in
//! text property values, D-249, D-257). docs/acceptance/types.md; interface docs/contracts/ms3-shell.md §15.4
//! (`tegg_format::extract::Link` gains `attribute: Option<String>`). Written from the ACs and the contract only (D-61).
//!
//! The expected records here are the same as in packages/doc/test/property_links.ac.test.ts, so the TS and Rust
//! outputs are compared through one shared expectation (S4 differential rule). `attribute` is read through the
//! record's `Debug` text, so this file compiles before the field exists and fails on an assertion (TS-I1).

use tegg_format::*;

fn fixture(rel: &str) -> String {
    let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/vaults/types").join(rel);
    std::fs::read_to_string(p).expect("setup: types fixture")
}
fn swap(text: &str, from: &str, to: &str) -> String {
    assert!(text.contains(from), "fixture no longer contains {from:?}");
    text.replacen(from, to, 1)
}
fn porada(misto: &str) -> String {
    swap(&fixture("Schůzky/2026-10-07 Porada.md"), "místo:\n", &format!("místo: {misto}\n"))
}
fn obycejna() -> String {
    swap(
        &fixture("Pages/Obyčejná stránka.md"),
        "místo: Praha\n",
        "místo: Praha\ndescription: \"Viz [[Rozpočet 2027]]\"\nsource: \"[[Rozpočet 2027]]\"\n",
    )
}
fn rozpocet() -> String {
    swap(&fixture("Projekty/Rozpočet 2027.md"), "  Druhý řádek s háčky: ěščřžýáíé.\n", "  Druhý řádek s [[Jana Nováková]].\n")
}

/// `(target, in_frontmatter)` of every link whose record names attribute `key`.
fn from_attr(x: &Extracted, key: &str) -> Vec<(String, bool)> {
    let want = format!("attribute: Some({key:?})");
    x.links.iter().filter(|l| format!("{l:?}").contains(&want)).map(|l| (l.target.clone(), l.in_frontmatter)).collect()
}

#[test]
fn fr_lnk_02_ac1_rust_extractor_reports_whole_value_link_with_attribute() {
    let x = extract(porada("\"[[Jana Nováková]]\"").as_bytes(), "2026-10-07 Porada");
    assert_eq!(from_attr(&x, "místo"), vec![("Jana Nováková".to_string(), true)], "one link from místo, in frontmatter");
}

#[test]
fn fr_lnk_02_ac1_rust_extractor_reports_exactly_one_link_in_mixed_text() {
    let x = extract(porada("\"u [[Jana Nováková]] doma\"").as_bytes(), "2026-10-07 Porada");
    assert_eq!(from_attr(&x, "místo"), vec![("Jana Nováková".to_string(), true)], "exactly one link from the mixed value");
}

#[test]
fn fr_lnk_02_ac1_rust_extractor_reports_description_and_source_links() {
    let x = extract(obycejna().as_bytes(), "Obyčejná stránka");
    assert_eq!(from_attr(&x, "description"), vec![("Rozpočet 2027".to_string(), true)], "description");
    assert_eq!(from_attr(&x, "source"), vec![("Rozpočet 2027".to_string(), true)], "source");
}

#[test]
fn fr_lnk_02_ac1_rust_extractor_reports_a_link_in_a_long_text_block() {
    let x = extract(rozpocet().as_bytes(), "Rozpočet 2027");
    assert_eq!(from_attr(&x, "poznámka"), vec![("Jana Nováková".to_string(), true)], "the link inside poznámka's |- block");
}

#[test]
fn fr_lnk_02_ac1_rust_extractor_body_links_have_no_attribute_and_inline_code_is_not_a_link() {
    let text = format!("{}Viz [[Petr Dvořák]].\n", porada("\"`[[Ne]]`\""));
    let x = extract(text.as_bytes(), "2026-10-07 Porada");
    assert!(!x.links.iter().any(|l| l.target == "Ne"), "inline code in a quoted value is not a link: {:?}", x.links);
    let body: Vec<String> = x.links.iter().filter(|l| !l.in_frontmatter).map(|l| format!("{l:?}")).collect();
    assert_eq!(body.len(), 1, "one body link: {body:?}");
    assert!(body[0].contains("attribute: None"), "body links carry attribute None: {}", body[0]);
    // The relation values keep their records, now with their key.
    let u: Vec<String> = from_attr(&x, "účastníci").into_iter().map(|(t, _)| t).collect();
    assert_eq!(u, vec!["Jana Nováková".to_string(), "Petr Dvořák".to_string()], "relation records name účastníci");
}

#[test]
fn fr_lnk_02_ac3_an_unclosed_link_stays_text_and_is_not_counted() {
    let x = extract(porada("\"[[Jana Nováková\"").as_bytes(), "2026-10-07 Porada");
    assert_eq!(from_attr(&x, "místo"), Vec::<(String, bool)>::new(), "[[ without ]] is not a link");
    // Red guard: the closed form in the same position is a link with its attribute key (AC-1).
    let y = extract(porada("\"[[Jana Nováková]]\"").as_bytes(), "2026-10-07 Porada");
    assert_eq!(from_attr(&y, "místo").len(), 1, "the closed form is counted");
}
