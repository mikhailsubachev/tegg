//! AC tests for `tegg-format` (docs/contracts/ms1-core.md §2): FR-FMT-03, FR-FMT-08 (AC-4), FR-FMT-09,
//! FR-FMT-10, FR-FMT-11, FR-FMT-12, FR-TYP-10, FR-TYP-15, NFR-POR-02, NFR-REL-03, FR-STO-05 (FR-STO-01 AC-3).
//! Written from the ACs and the contract only (D-61). Results of the code under test are matched and
//! asserted, never unwrapped (CONTRACT §5.2).

use chrono::{FixedOffset, NaiveDate, TimeZone};
use std::collections::HashSet;
use tegg_format::*;

const NFD_CTENI: &str = "C\u{30C}teni\u{301}"; // "Čtení" decomposed
const NFC_CTENI: &str = "\u{10C}ten\u{ED}";

fn date(y: i32, m: u32, d: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(y, m, d).expect("valid test date")
}

fn link(target: &str, subpath: Option<&str>, alias: Option<&str>, embed: bool, in_frontmatter: bool) -> Link {
    Link {
        target: target.to_string(),
        subpath: subpath.map(str::to_string),
        alias: alias.map(str::to_string),
        embed,
        in_frontmatter,
        attribute: None,
        ..Default::default()
    }
}

/// Deterministic xorshift for generated inputs (seeded, no extra dev-dependency).
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

// ---------------------------------------------------------------- FR-FMT-08 AC-4

#[test]
fn fr_fmt_08_ac4_title_with_colon_and_slash_gives_spaced_file_stem() {
    assert_eq!(sanitize_file_stem("Q3: plan/budget"), "Q3 plan budget");
}

#[test]
fn fr_fmt_08_ac4_title_key_is_the_title_and_stem_is_the_fallback() {
    let with_title = "---\nid: 01J9ZK4M7Q2R8F3V6X1T0B5N9G\ntype: page\ntitle: \"Q3: plan/budget\"\n---\nText.\n";
    assert_eq!(extract(with_title.as_bytes(), "Q3 plan budget").title, "Q3: plan/budget");
    assert_eq!(extract("Jen tělo.\n".as_bytes(), "Poznámka o řece").title, "Poznámka o řece");
}

// ---------------------------------------------------------------- NFR-POR-02

#[test]
fn nfr_por_02_ac1_each_forbidden_character_becomes_a_space() {
    let forbidden = ['/', ':', '\\', '*', '?', '"', '<', '>', '|', '#', '^', '[', ']'];
    let got: Vec<(char, String)> = forbidden.iter().map(|c| (*c, sanitize_file_stem(&format!("Řeka{c}Vltava")))).collect();
    let want: Vec<(char, String)> = forbidden.iter().map(|c| (*c, "Řeka Vltava".to_string())).collect();
    assert_eq!(got, want);
}

#[test]
fn nfr_por_02_ac1_control_characters_become_spaces() {
    let got: Vec<String> = ['\u{0}', '\u{1}', '\t', '\n', '\r', '\u{1F}', '\u{7F}']
        .iter()
        .map(|c| sanitize_file_stem(&format!("Řeka{c}Vltava")))
        .collect();
    assert_eq!(got, vec!["Řeka Vltava"; 7]);
}

#[test]
fn nfr_por_02_ac1_spaces_collapse_and_edge_spaces_and_dots_are_trimmed() {
    assert_eq!(sanitize_file_stem("Řeka   a   most"), "Řeka a most");
    assert_eq!(sanitize_file_stem("Řeka : most"), "Řeka most");
    assert_eq!(sanitize_file_stem("Poznámka. . "), "Poznámka");
    assert_eq!(sanitize_file_stem("  ...Řeka...  "), "Řeka");
    assert_eq!(sanitize_file_stem("v. 2.0 plán"), "v. 2.0 plán");
}

#[test]
fn nfr_por_02_ac1_generated_titles_never_give_a_non_portable_name() {
    let alphabet: Vec<char> = "aáčďéěíňóřšťúůýžAČŘŽ09 .-_()/:\\*?\"<>|#^[]\t\u{7}\u{301}€😀".chars().collect();
    let forbidden: HashSet<char> = "/:\\*?\"<>|#^[]".chars().collect();
    let mut rng = Rng(0x7e66_2026_1011);
    let mut bad = Vec::new();
    for _ in 0..2000 {
        let len = rng.below(260);
        let title: String = (0..len).map(|_| alphabet[rng.below(alphabet.len())]).collect();
        let stem = sanitize_file_stem(&title);
        let ok = !stem.is_empty()
            && stem.len() <= 200
            && !stem.chars().any(|c| forbidden.contains(&c) || c.is_control())
            && !stem.ends_with(' ')
            && !stem.ends_with('.')
            && !stem.starts_with(' ')
            && !stem.contains("  ");
        if !ok {
            bad.push((title, stem));
        }
    }
    assert!(bad.is_empty(), "{} non-portable names, first: {:?}", bad.len(), bad.first());
}

#[test]
fn nfr_por_02_ac2_long_titles_are_cut_to_200_bytes_at_a_character_boundary() {
    assert_eq!(sanitize_file_stem(&"č".repeat(150)), "č".repeat(100));
    assert_eq!(sanitize_file_stem(&format!("a{}", "č".repeat(150))), format!("a{}", "č".repeat(99)));
    assert_eq!(sanitize_file_stem(&"€".repeat(70)), "€".repeat(66));
    assert_eq!(sanitize_file_stem(&"😀".repeat(60)), "😀".repeat(50));
    assert_eq!(sanitize_file_stem(&"a".repeat(200)), "a".repeat(200));
    assert_eq!(sanitize_file_stem(&"a".repeat(201)), "a".repeat(200));
}

#[test]
fn nfr_por_02_ac3_windows_reserved_names_get_an_underscore() {
    let names = ["CON", "con", "Prn", "AUX", "nul", "COM1", "com9", "LPT1", "lpt9", "CON "];
    let got: Vec<String> = names.iter().map(|n| sanitize_file_stem(n)).collect();
    assert_eq!(got, vec!["CON_", "con_", "Prn_", "AUX_", "nul_", "COM1_", "com9_", "LPT1_", "lpt9_", "CON_"]);
}

#[test]
fn nfr_por_02_ac3_names_that_only_contain_a_reserved_word_are_unchanged() {
    let names = ["CONSOLE", "Conference", "COM10", "Nultý", "AUX kabel"];
    let got: Vec<String> = names.iter().map(|n| sanitize_file_stem(n)).collect();
    assert_eq!(got, vec!["CONSOLE", "Conference", "COM10", "Nultý", "AUX kabel"]);
}

#[test]
fn nfr_por_02_ac3_title_without_valid_characters_is_untitled() {
    assert_eq!(sanitize_file_stem(""), "Untitled");
    assert_eq!(sanitize_file_stem("???"), "Untitled");
    assert_eq!(sanitize_file_stem(" . / . "), "Untitled");
}

// ---------------------------------------------------------------- FR-STO-05 (FR-STO-01 AC-3)

#[test]
fn fr_sto_01_ac3_second_attachment_with_the_same_name_gets_a_2_suffix() {
    let none = |_: &str| false;
    assert_eq!(unique_file_name("photo", "png", &none), "photo.png");
    let one = |n: &str| n == "photo.png";
    assert_eq!(unique_file_name("photo", "png", &one), "photo (2).png");
    let two = |n: &str| n == "photo.png" || n == "photo (2).png";
    assert_eq!(unique_file_name("photo", "png", &two), "photo (3).png");
}

#[test]
fn fr_sto_01_ac3_suffix_counts_up_past_taken_names_with_czech_stems() {
    let taken: HashSet<String> = ["Mapa řeky.png", "Mapa řeky (2).png", "Mapa řeky (3).png"].iter().map(|s| s.to_string()).collect();
    let is_taken = |n: &str| taken.contains(n);
    assert_eq!(unique_file_name("Mapa řeky", "png", &is_taken), "Mapa řeky (4).png");
}

// ---------------------------------------------------------------- FR-FMT-09

#[test]
fn fr_fmt_09_ac1_default_daily_note_file_name() {
    assert_eq!(daily_note_file_name(date(2026, 10, 9), "YYYY-MM-DD"), "2026-10-09.md");
}

#[test]
fn fr_fmt_09_ac2_custom_daily_note_format() {
    assert_eq!(daily_note_file_name(date(2026, 10, 9), "DD.MM.YYYY"), "09.10.2026.md");
    assert_eq!(daily_note_file_name(date(2026, 1, 2), "DD.MM.YYYY"), "02.01.2026.md");
}

// ---------------------------------------------------------------- FR-FMT-11

#[test]
fn fr_fmt_11_ac1_date_is_written_without_time_or_offset() {
    assert_eq!(format_date(date(2026, 10, 9)), "2026-10-09");
    assert_eq!(format_date(date(2026, 1, 2)), "2026-01-02");
}

#[test]
fn fr_fmt_11_ac2_date_only_value_does_not_shift_in_any_time_zone() {
    let saved = std::env::var("TZ").ok();
    let mut seen = Vec::new();
    let note = "---\ntype: task\ndue: 2026-10-09\n---\nÚkol.\n";
    for tz in ["America/Los_Angeles", "Europe/Prague", "Asia/Tokyo"] {
        std::env::set_var("TZ", tz);
        let parsed = parse_date("2026-10-09");
        let shown = parsed.map(format_date);
        let attr = extract(note.as_bytes(), "Úkol").attributes.and_then(|a| a.get("due").cloned());
        seen.push((tz, parsed, shown, attr));
    }
    match saved {
        Some(v) => std::env::set_var("TZ", v),
        None => std::env::remove_var("TZ"),
    }
    let want: Vec<_> = ["America/Los_Angeles", "Europe/Prague", "Asia/Tokyo"]
        .iter()
        .map(|tz| (*tz, Some(date(2026, 10, 9)), Some("2026-10-09".to_string()), Some(serde_json::json!("2026-10-09"))))
        .collect();
    assert_eq!(seen, want);
}

#[test]
fn fr_fmt_11_ac2_invalid_dates_are_not_parsed() {
    assert_eq!(parse_date("2026-10-09"), Some(date(2026, 10, 9)));
    assert_eq!(parse_date("2026-13-01"), None);
    assert_eq!(parse_date("řeka"), None);
}

#[test]
fn fr_fmt_11_ac3_date_time_is_iso_8601_with_offset() {
    let prague = FixedOffset::east_opt(2 * 3600).expect("offset");
    let la = FixedOffset::west_opt(7 * 3600).expect("offset");
    let tokyo = FixedOffset::east_opt(9 * 3600).expect("offset");
    let t1 = prague.with_ymd_and_hms(2026, 10, 9, 14, 30, 0).single().expect("time");
    let t2 = la.with_ymd_and_hms(2026, 10, 9, 5, 30, 15).single().expect("time");
    let t3 = tokyo.with_ymd_and_hms(2026, 10, 9, 21, 30, 0).single().expect("time");
    assert_eq!(
        [format_date_time(t1), format_date_time(t2), format_date_time(t3)],
        ["2026-10-09T14:30:00+02:00", "2026-10-09T05:30:15-07:00", "2026-10-09T21:30:00+09:00"]
    );
}

// ---------------------------------------------------------------- FR-FMT-12

#[test]
fn fr_fmt_12_ac1_nfd_name_matches_nfc_link_target() {
    assert_eq!(nfc(NFD_CTENI), NFC_CTENI);
    assert!(same_name(NFD_CTENI, NFC_CTENI));
    assert!(same_name(&format!("{NFD_CTENI}.md"), &format!("{NFC_CTENI}.md")));
}

#[test]
fn fr_fmt_12_ac2_sanitized_file_stems_are_nfc() {
    assert_eq!(sanitize_file_stem(NFD_CTENI), NFC_CTENI);
    assert_eq!(sanitize_file_stem(&format!("{NFD_CTENI}: kapitola 1")), format!("{NFC_CTENI} kapitola 1"));
}

#[test]
fn fr_fmt_12_ac3_names_differing_only_in_normalization_are_the_same_name() {
    assert!(same_name(NFC_CTENI, NFD_CTENI));
    assert!(!same_name(NFC_CTENI, "Cteni"));
    assert!(!same_name("Řeka", "Řeky"));
}

// ---------------------------------------------------------------- FR-TYP-15

#[test]
fn fr_typ_15_ac1_reserved_keys_are_exactly_the_brd_list() {
    let mut got: Vec<&str> = RESERVED_KEYS.to_vec();
    got.sort_unstable();
    let mut want = vec![
        "id", "type", "title", "description", "aliases", "tags", "created", "modified", "source", "review", "icon",
        "cover", "previous", "file", "import-id", "captured",
    ];
    want.sort_unstable();
    assert_eq!(got, want);
}

#[test]
fn fr_typ_15_ac1_is_reserved_key_rejects_reserved_and_allows_user_keys() {
    let reserved = ["source", "id", "file", "tags", "import-id", "captured"];
    let user = ["source-text", "zdroj", "autor", "identifier", "filename"];
    let got: Vec<(&str, bool)> = reserved.iter().chain(user.iter()).map(|k| (*k, is_reserved_key(k))).collect();
    let want: Vec<(&str, bool)> =
        reserved.iter().map(|k| (*k, true)).chain(user.iter().map(|k| (*k, false))).collect();
    assert_eq!(got, want);
}

// ---------------------------------------------------------------- FR-TYP-10

#[test]
fn fr_typ_10_ac1_file_without_type_key_is_untyped_and_titled_by_stem() {
    let ex = extract("---\nstitky: [řeka]\n---\nText.\n".as_bytes(), "Netypovaná poznámka");
    assert_eq!(ex.title, "Netypovaná poznámka");
    assert_eq!(ex.attributes, Some(serde_json::json!({ "stitky": ["řeka"] })));
    assert_eq!(ex.r#type, None);
    assert_eq!(ex.id, None);
    assert_eq!(ex.frontmatter_error, None);
}

#[test]
fn fr_typ_10_ac1_file_without_frontmatter_is_untyped() {
    let ex = extract("# Nadpis\n\nText bez hlavičky.\n".as_bytes(), "Bez hlavičky");
    assert_eq!((ex.title.as_str(), ex.r#type.clone(), ex.attributes.clone()), ("Bez hlavičky", None, None));
}

// ---------------------------------------------------------------- FR-FMT-02 AC-2

#[test]
fn fr_fmt_02_ac2_id_is_the_same_whatever_the_file_name() {
    let text = "---\nid: 01JA2B3C4D5E6F7G8H9J0KMNPQ\ntype: page\n---\nText.\n";
    let ids = [extract(text.as_bytes(), "Původní").id, extract(text.as_bytes(), "Přejmenovaná").id];
    assert_eq!(ids, [Some("01JA2B3C4D5E6F7G8H9J0KMNPQ".to_string()), Some("01JA2B3C4D5E6F7G8H9J0KMNPQ".to_string())]);
}

// ---------------------------------------------------------------- FR-FMT-03 / FR-FMT-04

#[test]
fn fr_fmt_03_ac1_every_link_and_embed_form_is_extracted() {
    let text = "Odkazy: [[Řeka]], [[Řeka|alias řeky]], [[Řeka#Prameny]], [[Řeka#^blok-1]].\n\n![[Řeka]]\n\n![[Řeka#^blok-1]]\n\n![[mapa.png|400]]\n\n![[průvodce.pdf#page=3]]\n";
    assert_eq!(
        extract(text.as_bytes(), "Odkazy").links,
        vec![
            link("Řeka", None, None, false, false),
            link("Řeka", None, Some("alias řeky"), false, false),
            link("Řeka", Some("Prameny"), None, false, false),
            link("Řeka", Some("^blok-1"), None, false, false),
            link("Řeka", None, None, true, false),
            link("Řeka", Some("^blok-1"), None, true, false),
            link("mapa.png", None, Some("400"), true, false),
            link("průvodce.pdf", Some("page=3"), None, true, false),
        ]
    );
}

#[test]
fn fr_fmt_03_ac2_quoted_relation_links_in_frontmatter_are_extracted() {
    let text = "---\nzdroj: \"[[Porada]]\"\nlide:\n  - \"[[Jana]]\"\n  - \"[[Tomáš]]\"\n---\nText.\n";
    assert_eq!(
        extract(text.as_bytes(), "Úkol").links,
        vec![
            Link { attribute: Some("zdroj".into()), ..link("Porada", None, None, false, true) },
            Link { attribute: Some("lide".into()), ..link("Jana", None, None, false, true) },
            Link { attribute: Some("lide".into()), ..link("Tomáš", None, None, false, true) },
        ]
    );
}

#[test]
fn fr_fmt_03_ac3_escaped_pipe_in_a_table_link_is_parsed_back() {
    let text = "| Kniha | Odkaz |\n| --- | --- |\n| Duna | [[Duna\\|kniha]] |\n";
    assert_eq!(extract(text.as_bytes(), "Tabulka").links, vec![link("Duna", None, Some("kniha"), false, false)]);
}

#[test]
fn fr_fmt_03_ac4_links_in_code_are_not_extracted() {
    let text = "Skutečný [[Cíl]].\n\nKód `[[Není odkaz]]` a `![[není vložení]]`.\n\n```\n[[Také není]]\n```\n\n    [[Odsazený kód]]\n";
    assert_eq!(extract(text.as_bytes(), "Kód").links, vec![link("Cíl", None, None, false, false)]);
}

// ---------------------------------------------------------------- FR-FMT-10

#[test]
fn fr_fmt_10_ac2_inline_and_frontmatter_tag_have_the_same_key() {
    let ex = extract("---\ntags: [reading]\n---\nČtu #reading večer.\n".as_bytes(), "Čtení");
    let keys: HashSet<String> = ex.tags.iter().cloned().collect();
    assert_eq!((ex.tags.len(), keys), (2, HashSet::from(["reading".to_string()])));
}

#[test]
fn fr_fmt_10_ac3_tag_keys_are_lower_case_nfc() {
    let text = format!("Inline #Čtení, #ČTENÍ a #{NFD_CTENI}.\n");
    assert_eq!(extract(text.as_bytes(), "Štítky").tags, vec!["čtení", "čtení", "čtení"]);
}

#[test]
fn fr_fmt_10_ac4_digits_headings_urls_code_and_math_are_not_tags() {
    let text = "# Nadpis není štítek\n\nNe: #1 a #123 a https://example.com/#kotva a `#kód` a $#x$, ano: #skutečný.\n\n```\n#uvnitř\n```\n";
    assert_eq!(extract(text.as_bytes(), "Štítky").tags, vec!["skutečný"]);
}

#[test]
fn fr_fmt_10_ac4_obsidian_tag_fixture_gives_exact_tag_keys() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/fixtures/format/roundtrip/obsidian/06 Tags inline and frontmatter.md");
    let bytes = std::fs::read(path).expect("fixture exists");
    assert_eq!(
        extract(&bytes, "06 Tags inline and frontmatter").tags,
        vec!["project", "čtení", "idea", "čtení", "multi-word_tag", "area/work", "start-of-line"]
    );
}

// ---------------------------------------------------------------- NFR-REL-03

fn assert_frontmatter_error(name: &str, text: &str, lines: &[usize]) {
    let ex = extract(text.as_bytes(), "Rozbitá poznámka");
    assert!(
        matches!(&ex.frontmatter_error, Some(e) if lines.contains(&e.line) && !e.message.is_empty()),
        "{name}: expected an error on line {lines:?}, got {:?}",
        ex.frontmatter_error
    );
    assert_eq!(ex.title, "Rozbitá poznámka", "{name}: indexed by file name");
    assert_eq!(ex.attributes, None, "{name}: no attributes from invalid YAML");
}

#[test]
fn nfr_rel_03_ac1_unclosed_quote_is_reported_with_its_line() {
    assert_frontmatter_error("unclosed quote", "---\ntitle: \"neuzavřené\ntags: [a, b\n---\nTělo zůstává čitelné.\n", &[2, 3]);
}

#[test]
fn nfr_rel_03_ac1_bad_indentation_is_reported_with_its_line() {
    assert_frontmatter_error("bad indentation", "---\nautor:\n  jmeno: Jana\n prijmeni: Nováková\n---\nTělo.\n", &[4]);
}

#[test]
fn nfr_rel_03_ac1_duplicate_key_is_reported_with_its_line() {
    assert_frontmatter_error("duplicate keys", "---\nstav: nový\nstav: hotový\n---\nTělo.\n", &[3]);
}

#[test]
fn nfr_rel_03_ac1_tab_indentation_is_reported_with_its_line() {
    assert_frontmatter_error("tab", "---\nseznam:\n\t- položka\n---\nTělo.\n", &[3]);
}

#[test]
fn nfr_rel_03_ac1_frontmatter_that_never_closes_is_reported_on_line_1() {
    assert_frontmatter_error("never closes", "---\ntitle: nikdy neuzavřeno\n\nText těla.\n", &[1]);
}

#[test]
fn nfr_rel_03_ac2_invalid_frontmatter_file_is_indexed_by_name_and_body() {
    let ex = extract("---\nstav: nový\nstav: hotový\n---\nTělo s odkazem [[Řeka]] a #štítkem.\n".as_bytes(), "Rozbitá");
    assert_eq!(ex.title, "Rozbitá");
    assert_eq!((ex.id.clone(), ex.r#type.clone(), ex.attributes.clone()), (None, None, None));
    assert!(ex.frontmatter_error.is_some(), "invalid YAML is reported");
}
