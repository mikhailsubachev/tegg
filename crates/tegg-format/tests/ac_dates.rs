//! MS4 slice 4B AC tests for the Rust date, daily file name and daily template engines (L1, Rust side of the TS/Rust
//! pair): FR-DLY-08 AC-5 (only valid calendar dates are dates, D-332), FR-FMT-09 AC-3…AC-5 (daily file names from
//! `daily-format`, D-336), FR-DLY-06 AC-1…AC-3, AC-5 (template expansion, D-270, D-325). docs/acceptance/daily-notes.md;
//! interface docs/contracts/ms4-daily.md §1, §5, §6.1. Written from the ACs and the contract only (D-61).
//!
//! The expectations are the shared corpora in tests/fixtures/format/dates/, also read by
//! packages/doc/test/dates.ac.test.ts, so the two engines can't drift.

use chrono::NaiveDate;
use serde_json::Value;
use tegg_format::daily::{expand_template, file_stem};
use tegg_format::date::parse_date;

fn corpus(name: &str) -> Value {
    let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/format/dates").join(name);
    let text = std::fs::read_to_string(&p).expect("setup: dates corpus");
    serde_json::from_str(&text).expect("setup: corpus is JSON")
}
fn s(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_string()
}
fn day(v: &str) -> NaiveDate {
    NaiveDate::parse_from_str(v, "%Y-%m-%d").expect("setup: corpus date")
}
fn keys(v: &Value) -> Vec<(String, String)> {
    v.as_array().map(|a| a.iter().map(|k| (s(&k[0]), s(&k[1]))).collect()).unwrap_or_default()
}

#[test]
fn fr_dly_08_ac5_rust_parse_date_matches_the_shared_corpus() {
    let c = corpus("cases.json");
    let cases = c["cases"].as_array().cloned().unwrap_or_default();
    assert!(cases.len() > 20, "setup: the corpus has cases");
    let mut bad = Vec::new();
    for case in &cases {
        let want = case["date"].as_str().map(day);
        let got = parse_date(&s(&case["input"]));
        if got != want {
            bad.push(format!("{}: {:?} → want {:?}, got {:?}", s(&case["name"]), s(&case["input"]), want, got));
        }
    }
    assert!(bad.is_empty(), "parse_date differs from the corpus in {} case(s):\n{}", bad.len(), bad.join("\n"));
}

#[test]
fn fr_fmt_09_ac4_rust_file_stem_of_valid_formats() {
    let c = corpus("daily-format.json");
    let mut bad = Vec::new();
    let mut n = 0;
    for case in c["cases"].as_array().cloned().unwrap_or_default() {
        let Some(want) = case["stem"].as_str() else { continue };
        n += 1;
        let got = file_stem(&s(&case["format"]), day(&s(&case["date"])));
        if got.as_deref() != Ok(want) {
            bad.push(format!("{:?} on {}: want {want:?}, got {got:?}", s(&case["format"]), s(&case["date"])));
        }
    }
    assert!(n >= 10, "setup: valid formats in the corpus");
    assert!(bad.is_empty(), "file_stem differs from the corpus in {} case(s):\n{}", bad.len(), bad.join("\n"));
}

#[test]
fn fr_fmt_09_ac3_rust_default_format_gives_the_iso_stem() {
    for (d, want) in [("2026-10-14", "2026-10-14"), ("2026-03-05", "2026-03-05"), ("2028-02-29", "2028-02-29")] {
        assert_eq!(file_stem("YYYY-MM-DD", day(d)), Ok(want.to_string()), "YYYY-MM-DD on {d}");
    }
}

#[test]
fn fr_fmt_09_ac5_rust_bad_formats_are_refused_and_the_fallback_works() {
    let c = corpus("daily-format.json");
    let mut bad = Vec::new();
    let mut n = 0;
    for case in c["cases"].as_array().cloned().unwrap_or_default() {
        if !case["stem"].is_null() {
            continue;
        }
        n += 1;
        let got = file_stem(&s(&case["format"]), day(&s(&case["date"])));
        if got.is_ok() {
            bad.push(format!("{:?}: want BadFormat, got {got:?}", s(&case["format"])));
        }
    }
    assert!(n >= 10, "setup: bad formats in the corpus");
    assert!(bad.is_empty(), "file_stem accepts bad formats:\n{}", bad.join("\n"));
    // D-336: the name then falls back to YYYY-MM-DD, which must itself be a valid format.
    assert_eq!(file_stem("YYYY-MM-DD", day("2026-10-14")), Ok("2026-10-14".to_string()), "the fallback format YYYY-MM-DD");
}

#[test]
fn fr_dly_06_ac1_rust_expand_template_body_matches_the_shared_corpus() {
    let c = corpus("template-cases.json");
    let mut bad = Vec::new();
    for case in c["cases"].as_array().cloned().unwrap_or_default() {
        let x = expand_template(&s(&case["template"]), day(&s(&case["date"])));
        if x.body != s(&case["body"]) {
            bad.push(format!("{}:\n  want {:?}\n  got  {:?}", s(&case["name"]), s(&case["body"]), x.body));
        }
    }
    assert!(bad.is_empty(), "expand_template().body differs in {} case(s):\n{}", bad.len(), bad.join("\n"));
}

#[test]
fn fr_dly_06_ac1_rust_variables_are_relative_to_the_notes_date() {
    let c = corpus("template-cases.json");
    let tpl = s(&c["cases"][0]["template"]);
    let x = expand_template(&tpl, day("2026-03-01"));
    assert!(x.body.contains("[[2026-02-28]]") && x.body.contains("[[2026-03-02]]"), "1 Mar: yesterday 28 Feb, tomorrow 2 Mar: {:?}", x.body);
    let y = expand_template(&tpl, day("2026-12-31"));
    assert!(y.body.contains("[[2027-01-01]]"), "31 Dec: tomorrow 1 Jan 2027: {:?}", y.body);
    assert!(y.body.contains("{{time}}"), "{{time}} stays literal (FR-TPL v1.0)");
}

#[test]
fn fr_dly_06_ac3_rust_template_keys_in_order_without_reserved_keys() {
    let c = corpus("template-cases.json");
    let mut bad = Vec::new();
    for case in c["cases"].as_array().cloned().unwrap_or_default() {
        let x = expand_template(&s(&case["template"]), day(&s(&case["date"])));
        let want = keys(&case["keys"]);
        if x.keys != want {
            bad.push(format!("{}: want {want:?}, got {:?}", s(&case["name"]), x.keys));
        }
    }
    assert!(bad.is_empty(), "expand_template().keys differs in {} case(s):\n{}", bad.len(), bad.join("\n"));
}

#[test]
fn fr_dly_06_ac5_rust_invalid_template_frontmatter_is_body_only() {
    let c = corpus("template-cases.json");
    let mut checked = 0;
    for case in c["cases"].as_array().cloned().unwrap_or_default() {
        let Some(want) = case["invalid"].as_bool() else { continue };
        checked += 1;
        let x = expand_template(&s(&case["template"]), day(&s(&case["date"])));
        assert_eq!(x.invalid, want, "{}: invalid", s(&case["name"]));
        if want {
            assert!(x.keys.is_empty(), "{}: no keys from invalid frontmatter", s(&case["name"]));
            assert_eq!(x.body, s(&case["body"]), "{}: the text after the fence, expanded", s(&case["name"]));
        }
    }
    assert!(checked >= 5, "setup: cases with `invalid`");
}
