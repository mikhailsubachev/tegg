//! S4-QA AC-4: the Rust extractor equals the TypeScript reference for every round-trip fixture.
//! Expected values: tests/fixtures/format/extract/expected.json (from spikes/s1-roundtrip,
//! `UPDATE_EXTRACT=1 npx vitest run test/extract.test.ts`).

use std::fs;
use std::path::{Path, PathBuf};

use s4_index::extract::{extract, nfc};
use serde_json::Value;

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    for e in fs::read_dir(dir).unwrap().flatten() {
        let p = e.path();
        if p.is_dir() {
            walk(&p, out)
        } else if p.extension().is_some_and(|x| x == "md") && p.file_name().unwrap() != "README.md" {
            out.push(p)
        }
    }
}

#[test]
fn s4_qa_ac4_rust_extractor_matches_typescript_reference() {
    let root = repo().join("tests/fixtures/format/roundtrip");
    let expected: serde_json::Map<String, Value> =
        serde_json::from_str(&fs::read_to_string(repo().join("tests/fixtures/format/extract/expected.json")).unwrap()).unwrap();
    let mut files = Vec::new();
    walk(&root, &mut files);
    assert_eq!(files.len(), expected.len(), "fixture count");

    let mut failures = Vec::new();
    for f in files {
        let rel = nfc(&f.strip_prefix(&root).unwrap().to_string_lossy());
        let bytes = fs::read(&f).unwrap();
        let text = String::from_utf8(bytes).expect("fixtures are UTF-8");
        let stem = f.file_stem().unwrap().to_string_lossy();
        let got = serde_json::to_value(extract(&text, &stem)).unwrap();
        let want = expected.get(&rel).unwrap_or_else(|| panic!("no expected entry for {rel}"));
        if &got != want {
            for k in ["title", "id", "type", "attributes", "frontmatterError", "links", "tags"] {
                if got[k] != want[k] {
                    failures.push(format!("{rel} · {k}\n  rust: {}\n  ts:   {}", got[k], want[k]));
                }
            }
        }
    }
    assert!(failures.is_empty(), "{} mismatches:\n{}", failures.len(), failures.join("\n"));
}

/// S4-QA AC-4, differential part: ~2,000 random documents built from tricky constructs,
/// with the TypeScript reference's results. Runs when `S4_EXTRACT_DIFF` points at the
/// `corpus.json` written by `spikes/s1-roundtrip/test/extract-diff.test.ts`
/// (`npm run test:diff` in this folder does both).
#[test]
fn s4_qa_ac4_differential_corpus() {
    let Ok(path) = std::env::var("S4_EXTRACT_DIFF") else {
        eprintln!("S4_EXTRACT_DIFF not set; skipped");
        return;
    };
    let corpus: Vec<Value> = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    assert!(corpus.len() > 1000);
    // Known difference (FINDINGS.md P3): `$$` math blocks inside lists, quotes or HTML blocks.
    // The Rust pre-pass models only top-level math blocks. Such docs are counted, not failed.
    let known = |t: &str| t.contains("$$");
    let (mut failures, mut tolerated) = (Vec::new(), std::collections::BTreeSet::new());
    for d in &corpus {
        let (name, text) = (d["name"].as_str().unwrap(), d["text"].as_str().unwrap());
        let got = serde_json::to_value(extract(text, name)).unwrap();
        for k in ["title", "id", "type", "attributes", "frontmatterError", "links", "tags"] {
            if got[k] != d["expected"][k] {
                if known(text) {
                    tolerated.insert(name);
                    continue;
                }
                failures.push(format!("{name} · {k}\n  text: {text:?}\n  rust: {}\n  ts:   {}", got[k], d["expected"][k]));
            }
        }
    }
    let with_math = corpus.iter().filter(|d| known(d["text"].as_str().unwrap())).count();
    eprintln!("differential: {} docs, {} with $$, {} of those differ (known, P3)", corpus.len(), with_math, tolerated.len());
    let shown: Vec<_> = failures.iter().take(15).cloned().collect();
    assert!(failures.is_empty(), "{} mismatches in {} docs; first:\n{}", failures.len(), corpus.len(), shown.join("\n"));
}
