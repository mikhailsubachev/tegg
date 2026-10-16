//! Regression for the PR #38 QA review: the instants of the D-319/D-335 winner rule are read alike in Rust and in
//! the fake core's `@tegg/doc` twin (shared corpus tests/fixtures/format/dates/winner-instants.json).
use tegg_format::daily::{instant, Instant};

#[test]
fn bug_38_fr_dly_01_winner_instants_match_the_shared_corpus() {
    let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/format/dates/winner-instants.json");
    let c: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(p).expect("corpus")).expect("json");
    let mut bad = Vec::new();
    for case in c["cases"].as_array().expect("cases") {
        let v = case["value"].as_str().unwrap_or_default();
        let got = instant(v);
        let ok = match case["kind"].as_str().unwrap_or_default() {
            "instant" => got == Some(Instant::At(case["utcNanos"].as_str().unwrap_or_default().parse().unwrap_or(0))),
            "local" => matches!(got, Some(Instant::Local(_))),
            _ => got.is_none(),
        };
        if !ok {
            bad.push(format!("{v:?}: {got:?}"));
        }
    }
    assert!(bad.is_empty(), "instant() differs from the corpus:\n{}", bad.join("\n"));
}
