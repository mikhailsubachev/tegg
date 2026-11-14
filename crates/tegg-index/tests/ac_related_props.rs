//! Slice REL L2 property test of the text pipeline (docs/acceptance/related.md R179; docs/contracts/v1-related.md §1.4):
//! FR-LNK-15 AC-3 (diacritics, case and NFD never change the multiset of stems). Texts: random sequences of the golden
//! list's words (tests/fixtures/format/stem/cs.tsv) with Czech stop words between them, and paragraphs of a vault from
//! `gen-vault --seed 1` (a 200-note vault per push, the 5,000-note reference vault nightly). Written from the ACs and the
//! contract only (D-61); every check is an assertion in this file (tools/qa CONTRACT §5.2).
//!
//! Seeds (TS-L2): a fixed seed plus one random seed per run (`QA_SEED` when set, else the clock); with
//! `QA_PROPERTY_SCALE` ≥ 100 (nightly) 10 seeds × 1,000 texts. Every seed is printed (`seed = N`).

use tegg_index::fold;
use tegg_index::stemming::{language_of, stems};
use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;

const FIXED_SEED: u64 = 20_261_114;

struct Rng(u64);
impl Rng {
    fn new(seed: u64) -> Rng {
        Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n.max(1) as u64) as usize
    }
    fn chance(&mut self, pct: u64) -> bool {
        self.next() % 100 < pct
    }
}
fn scale() -> u64 {
    std::env::var("QA_PROPERTY_SCALE").ok().and_then(|s| s.parse().ok()).unwrap_or(1)
}
fn seeds() -> Vec<u64> {
    let r = std::env::var("QA_SEED").ok().and_then(|s| s.parse().ok()).unwrap_or_else(|| {
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(7)
    });
    if scale() >= 100 {
        (0..10).map(|i| if i == 0 { FIXED_SEED } else { r.wrapping_add(i) }).collect()
    } else {
        vec![FIXED_SEED, r]
    }
}
fn runs() -> usize {
    if scale() >= 100 {
        1000
    } else {
        60
    }
}

const STOP: [&str; 14] = ["a", "ale", "že", "který", "protože", "ještě", "jsou", "na", "ve", "pro", "by", "jak", "už", "se"];

fn golden_words() -> Vec<String> {
    let p = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/format/stem/cs.tsv");
    let text = std::fs::read_to_string(p).expect("setup: cs.tsv");
    text.lines().skip(1).filter_map(|l| l.split('\t').next()).filter(|w| !w.is_empty()).map(str::to_string).collect()
}

fn strip_all(s: &str) -> String {
    s.nfd().filter(|c| !is_combining_mark(*c)).nfc().collect()
}
fn strip_some(s: &str, r: &mut Rng) -> String {
    s.nfc().map(|c| if c.is_ascii() || !r.chance(50) { c.to_string() } else { strip_all(&c.to_string()) }).collect()
}
fn upper(s: &str) -> String {
    s.to_uppercase()
}
fn nfd(s: &str) -> String {
    s.nfd().collect()
}

fn multiset(text: &str) -> (tegg_index::stemming::Lang, Vec<String>) {
    let words: Vec<String> = fold(text).split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(str::to_string).collect();
    let lang = language_of(&words);
    let mut s = stems(text, lang);
    s.sort();
    (lang, s)
}

/// Checks one text; returns the first difference, if any.
fn check(text: &str, r: &mut Rng) -> Option<String> {
    let base = multiset(text);
    let variants = [("no diacritics", strip_all(text)), ("some diacritics removed", strip_some(text, r)), ("upper case", upper(text)), ("NFD", nfd(text))];
    for (what, t) in variants {
        let got = multiset(&t);
        if got != base {
            return Some(format!("{what}: {text:?} → {:?}, variant {t:?} → {:?}", base, got));
        }
    }
    None
}

fn generated_paragraphs() -> Vec<String> {
    let tmp = tempfile::tempdir().expect("setup: tempdir");
    let out = tmp.path().join("gen");
    let o = if scale() >= 100 {
        let mut o = gen_vault::Options::reference(1);
        o.full_images = false;
        o
    } else {
        gen_vault::Options { seed: 1, notes: 200, images: 20, tags: 20, full_images: false }
    };
    gen_vault::generate(&out, &o).expect("setup: gen-vault");
    let mut paras = Vec::new();
    fn walk(d: &std::path::Path, out: &mut Vec<String>) {
        for e in std::fs::read_dir(d).expect("setup: read_dir") {
            let e = e.expect("setup: entry");
            let p = e.path();
            if e.file_type().expect("setup: type").is_dir() {
                if !e.file_name().to_string_lossy().starts_with('.') {
                    walk(&p, out);
                }
            } else if p.extension().is_some_and(|x| x == "md") {
                let text = std::fs::read_to_string(&p).unwrap_or_default();
                let body = &text[tegg_format::body_start(&text)..];
                out.extend(body.split("\n\n").map(str::trim).filter(|s| s.chars().filter(|c| c.is_alphabetic()).count() >= 20).map(str::to_string));
            }
        }
    }
    walk(&out, &mut paras);
    paras
}

#[test]
fn fr_lnk_15_ac3_property_diacritics_never_change_stems() {
    let words = golden_words();
    assert!(words.len() >= 300, "the golden list has its words");
    let mut bad = Vec::new();
    let mut empty = 0usize;
    for seed in seeds() {
        println!("seed = {seed}");
        let mut r = Rng::new(seed);
        for _ in 0..runs() {
            let n = 3 + r.below(10);
            let mut parts = Vec::new();
            for i in 0..n {
                if i > 0 && r.chance(50) {
                    parts.push(STOP[r.below(STOP.len())].to_string());
                }
                parts.push(words[r.below(words.len())].clone());
            }
            let text = format!("{}.", parts.join(" "));
            if multiset(&text).1.is_empty() {
                empty += 1;
            }
            if let Some(d) = check(&text, &mut r) {
                bad.push(format!("seed {seed}: {d}"));
            }
            if bad.len() > 5 {
                break;
            }
        }
    }
    assert_eq!(empty, 0, "every random text of 3 or more golden words has stems (the property isn't vacuous)");
    let paras = generated_paragraphs();
    assert!(!paras.is_empty(), "the generated vault has paragraphs");
    let mut r = Rng::new(FIXED_SEED);
    let with_stems = paras.iter().filter(|p| !multiset(p).1.is_empty()).count();
    assert!(with_stems * 2 >= paras.len(), "most generated paragraphs have stems ({with_stems} of {})", paras.len());
    for p in &paras {
        if let Some(d) = check(p, &mut r) {
            bad.push(format!("generated: {d}"));
        }
        if bad.len() > 10 {
            break;
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "removing diacritics, upper case and NFD never change the multiset of stems");
}
