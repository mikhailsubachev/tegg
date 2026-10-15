//! MS4 slice 4A AC tests for the Rust extractor and excerpt window (L1, Rust side of the TS/Rust pair): FR-LNK-01
//! AC-4 (excerpt building, D-277). docs/acceptance/backlinks.md; interface docs/contracts/ms4-links.md §2.1, §2.2.
//! Written from the ACs and the contract only (D-61).
//!
//! The expectations come from the shared corpus tests/fixtures/format/excerpt/cases.json, which
//! packages/doc/test/excerpt.ac.test.ts reads too, so Rust and TypeScript can't drift (the D-241 pattern).
//! `Link::at`, `Link::block` and `Extracted::blocks` don't exist before 4A is built, so they are read through the
//! records' `Debug` text (derive(Debug) of the contract types), and this file compiles red (TS-I1).

use serde_json::Value;
use tegg_format::excerpt::{window, At, BlockKind, BlockText, Excerpt, LinkTargetInfo, Mark, RSeg, Segment, TargetKind};
use tegg_format::*;

fn repo(rel: &str) -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").join(rel)
}
fn corpus() -> Value {
    let text = std::fs::read_to_string(repo("tests/fixtures/format/excerpt/cases.json")).expect("setup: excerpt corpus");
    serde_json::from_str(&text).expect("setup: corpus is JSON")
}
fn s(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_string()
}
fn marks(v: &Value) -> Vec<Mark> {
    v["marks"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|m| match m.as_str().unwrap_or_default() {
                    "strong" => Mark::Strong,
                    "em" => Mark::Em,
                    "code" => Mark::Code,
                    "strike" => Mark::Strike,
                    _ => Mark::Highlight,
                })
                .collect()
        })
        .unwrap_or_default()
}
fn kind(v: &Value) -> BlockKind {
    match v.as_str().unwrap_or_default() {
        "paragraph" => BlockKind::Paragraph,
        "heading" => BlockKind::Heading,
        "listItem" => BlockKind::ListItem,
        "tableRow" => BlockKind::TableRow,
        "quote" => BlockKind::Quote,
        _ => BlockKind::Callout,
    }
}
fn blocks(v: &Value) -> Vec<BlockText> {
    v.as_array()
        .map(|a| {
            a.iter()
                .map(|b| BlockText {
                    kind: kind(&b["kind"]),
                    segments: b["segments"]
                        .as_array()
                        .map(|segs| {
                            segs.iter()
                                .map(|g| match g.get("link") {
                                    Some(i) => Segment::Link { link: i.as_u64().unwrap_or(u64::MAX) as u32, marks: marks(g) },
                                    None => Segment::Text { text: s(&g["text"]), marks: marks(g) },
                                })
                                .collect()
                        })
                        .unwrap_or_default(),
                })
                .collect()
        })
        .unwrap_or_default()
}
fn target(v: &Value) -> LinkTargetInfo {
    let opt = |k: &str| v[k].as_str().map(|x| x.to_string());
    LinkTargetInfo {
        target: s(&v["target"]),
        kind: match v["kind"].as_str().unwrap_or_default() {
            "note" => TargetKind::Note,
            "daily" => TargetKind::Daily,
            "date-missing" => TargetKind::DateMissing,
            _ => TargetKind::Unresolved,
        },
        path: opt("path"),
        title: opt("title"),
        r#type: opt("type"),
    }
}
fn rsegs(v: &Value) -> Vec<RSeg> {
    v.as_array()
        .map(|a| {
            a.iter()
                .map(|g| match g["kind"].as_str() {
                    Some("link") => RSeg::Link { text: s(&g["text"]), target: target(&g["target"]), here: g["here"].as_bool().unwrap_or(false), marks: marks(g) },
                    _ => RSeg::Text { text: s(&g["text"]), marks: marks(g) },
                })
                .collect()
        })
        .unwrap_or_default()
}
fn at(v: &Value) -> At {
    At { line: v["line"].as_u64().unwrap_or(0) as u32, byte: v["byte"].as_u64().unwrap_or(0) as u32 }
}

/// `blocks: [...]` exactly as `#[derive(Debug)]` prints the contract's `Extracted::blocks` field.
fn blocks_debug(b: &[BlockText]) -> String {
    format!("blocks: {b:?}")
}

#[test]
fn fr_lnk_01_ac4_rust_blocks_match_the_shared_corpus() {
    let c = corpus();
    let cases = c["cases"].as_array().cloned().unwrap_or_default();
    assert!(!cases.is_empty(), "setup: the corpus has cases");
    let mut bad = Vec::new();
    for case in &cases {
        let x = extract(s(&case["markdown"]).as_bytes(), &s(&case["stem"]));
        let want = blocks_debug(&blocks(&case["blocks"]));
        let got = format!("{x:?}");
        if !got.contains(&want) {
            bad.push(format!("{}:\n  want {want}\n  got  {got}", s(&case["name"])));
        }
    }
    assert!(bad.is_empty(), "Extracted::blocks differs from the corpus in {} case(s):\n{}", bad.len(), bad.join("\n"));
}

#[test]
fn fr_lnk_01_ac4_rust_link_positions_match_the_shared_corpus() {
    let c = corpus();
    let mut bad = Vec::new();
    for case in c["cases"].as_array().cloned().unwrap_or_default() {
        let name = s(&case["name"]);
        let x = extract(s(&case["markdown"]).as_bytes(), &s(&case["stem"]));
        let want = case["links"].as_array().cloned().unwrap_or_default();
        if x.links.len() != want.len() {
            bad.push(format!("{name}: {} link records, want {}: {:?}", x.links.len(), want.len(), x.links));
            continue;
        }
        for (i, (l, w)) in x.links.iter().zip(&want).enumerate() {
            let d = format!("{l:?}");
            let want_at = format!("at: {:?}", at(&w["at"]));
            let want_block = format!("block: {:?}", w["block"].as_u64().map(|b| b as u32));
            if !d.contains(&want_at) || !d.contains(&want_block) {
                bad.push(format!("{name} link {i}: want {want_at}, {want_block}; got {d}"));
            }
            if let Some(t) = w["target"].as_str() {
                if nfc(&l.target) != nfc(t) {
                    bad.push(format!("{name} link {i}: target {:?}, want {t:?}", l.target));
                }
            }
            if let Some(e) = w["embed"].as_bool() {
                if l.embed != e {
                    bad.push(format!("{name} link {i}: embed {}, want {e}", l.embed));
                }
            }
        }
    }
    assert!(bad.is_empty(), "link positions differ from the corpus:\n{}", bad.join("\n"));
}

#[test]
fn fr_lnk_01_ac4_rust_excerpt_window_matches_the_shared_corpus() {
    let c = corpus();
    let windows = c["windows"].as_array().cloned().unwrap_or_default();
    assert!(!windows.is_empty(), "setup: the corpus has windows");
    let mut bad = Vec::new();
    for w in &windows {
        let here: Vec<usize> = w["here"].as_array().map(|a| a.iter().map(|i| i.as_u64().unwrap_or(0) as usize).collect()).unwrap_or_default();
        let got = window(&rsegs(&w["rendered"]), &here, w["max"].as_u64().unwrap_or(160) as usize, w["before"].as_u64().unwrap_or(60) as usize);
        let want = Excerpt {
            segments: rsegs(&w["expected"]["segments"]),
            cut_start: w["expected"]["cutStart"].as_bool().unwrap_or(false),
            cut_end: w["expected"]["cutEnd"].as_bool().unwrap_or(false),
        };
        if got != want {
            bad.push(format!("{}:\n  want {want:?}\n  got  {got:?}", s(&w["name"])));
        }
    }
    assert!(bad.is_empty(), "excerpt windows differ from the corpus:\n{}", bad.join("\n"));
}

#[test]
fn fr_lnk_01_ac4_rust_long_paragraph_window_limits() {
    // The fixture's 320-character paragraph (backlinks README): at most 160 characters, at most 60 before the chip,
    // both ends cut at whitespace in the source.
    let text = std::fs::read_to_string(repo("tests/fixtures/vaults/backlinks/Pages/Odkazy v textu.md")).expect("setup: fixture");
    let par = text.lines().find(|l| l.chars().count() == 320).unwrap_or_default().to_string();
    assert_eq!(par.chars().count(), 320, "setup: the 320-character paragraph");
    let (pre, post) = par.split_once("[[Cíl]]").unwrap_or_default();
    let cil = LinkTargetInfo { target: "Cíl".into(), kind: TargetKind::Note, path: Some("Pages/Cíl.md".into()), title: Some("Cíl".into()), r#type: Some("page".into()) };
    let rendered = vec![
        RSeg::Text { text: pre.to_string(), marks: vec![] },
        RSeg::Link { text: "Cíl".into(), target: cil.clone(), here: true, marks: vec![] },
        RSeg::Text { text: post.to_string(), marks: vec![] },
    ];
    let e = window(&rendered, &[1], 160, 60);
    let texts: Vec<String> = e.segments.iter().map(|g| match g { RSeg::Text { text, .. } | RSeg::Link { text, .. } => text.clone() }).collect();
    let all: String = texts.concat();
    assert!(e.cut_start && e.cut_end, "cut on both sides: {e:?}");
    assert!(all.chars().count() <= 160 && all.chars().count() > 100, "at most 160 characters (and not trivially short): {}", all.chars().count());
    let chip = e.segments.iter().position(|g| matches!(g, RSeg::Link { here: true, .. }));
    assert_eq!(chip, Some(1), "the chip is kept whole and marked here: {e:?}");
    let before: usize = texts[..1].iter().map(|t| t.chars().count()).sum();
    assert!(before <= 60, "at most 60 characters before the chip: {before}");
    assert!(pre.ends_with(&texts[0]) && pre[..pre.len() - texts[0].len()].ends_with(' '), "the start is cut at whitespace in the source: {:?}", texts[0]);
    let last = texts.last().cloned().unwrap_or_default();
    assert!(post.starts_with(&last) && post[last.len()..].starts_with(' '), "the end is cut at whitespace in the source: {last:?}");
}
