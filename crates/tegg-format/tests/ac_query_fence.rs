//! Slice Q L4 / L3 / L2 tests of the ```` ```query ```` fence scanner `tegg_format::query_fences` (docs/acceptance/
//! queries.md R140, FR-FMT-06 AC-4, AC-5, FR-FMT-07 AC-30; docs/contracts/v1-queries.md §1.3): the fixture notes against
//! `tests/fixtures/queries-files/expected.json` `fences` (shared with `@tegg/doc` `queryFences`, L3), the fence forms
//! (```` ``` ```` and `~~~`, info `query` exactly and its meta, lists, quotes, callouts, frontmatter skipped) and a
//! seeded property over random documents (a fixed seed plus `QA_SEED`; `QA_PROPERTY_SCALE` ≥ 100 runs 10 seeds × 1,000
//! cases, TS-L2). Written from the ACs, the fixtures and the contract only (D-61).

use std::path::PathBuf;

use serde_json::{json, Value};
use tegg_format::{nfc, query_fences, QueryFence};

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}
fn expected_json() -> Value {
    serde_json::from_slice(&std::fs::read(repo().join("tests/fixtures/queries-files/expected.json")).expect("setup: expected.json")).expect("setup: JSON")
}
fn fixture(rel: &str) -> String {
    String::from_utf8(std::fs::read(repo().join("tests/fixtures/vaults/queries").join(rel)).expect("setup: fixture")).expect("setup: UTF-8")
}
/// The NFD spelling of the Czech letters used here.
fn nfd(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        let (base, mark) = match c {
            'á' => ('a', '\u{301}'), 'é' => ('e', '\u{301}'), 'í' => ('i', '\u{301}'), 'ú' => ('u', '\u{301}'), 'ý' => ('y', '\u{301}'),
            'č' => ('c', '\u{30C}'), 'ě' => ('e', '\u{30C}'), 'ř' => ('r', '\u{30C}'), 'š' => ('s', '\u{30C}'), 'ž' => ('z', '\u{30C}'),
            'ů' => ('u', '\u{30A}'), 'Ú' => ('U', '\u{301}'), 'Č' => ('C', '\u{30C}'),
            other => {
                out.push(other);
                continue;
            }
        };
        out.push(base);
        out.push(mark);
    }
    out
}
fn brief(f: &QueryFence) -> (String, Option<String>, bool) {
    (f.body.replace("\r\n", "\n"), f.saved.clone(), f.nested)
}

// ------------------------------------------------------------------------------------------------ L3

#[test]
fn fr_fmt_06_ac4_fences_match_expected_json() {
    let ex = expected_json();
    let fences = ex["fences"].as_object().cloned().unwrap_or_default();
    assert_eq!(fences.len(), 6, "setup: six notes");
    let mut bad = Vec::new();
    for (rel, want) in fences {
        let text = fixture(&rel);
        let got: Vec<Value> = query_fences(&text).iter().map(|f| json!({ "range": [f.range.start, f.range.end], "saved": f.saved, "nested": f.nested })).collect();
        let want: Vec<Value> = want.as_array().cloned().unwrap_or_default().iter().map(|w| json!({ "range": w["range"], "saved": w["saved"], "nested": w["nested"] })).collect();
        if got != want {
            bad.push(format!("{rel}:\n  got  {got:?}\n  want {want:?}"));
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "query_fences agrees with expected.json `fences` (range, saved, nested)");
}

// ------------------------------------------------------------------------------------------------ L4: forms

#[test]
fn fr_fmt_06_ac4_fence_forms_and_containers() {
    let fx = fixture("Pages/Přehled dotazů.md");
    let all = query_fences(&fx);
    assert_eq!(all.len(), 9, "Přehled: nine fences");
    assert_eq!(&fx[all[0].range.clone()], "```query\nsaved: Projekty v běhu\n```\n", "the range is the whole fence with its EOL");
    assert_eq!(all[5].body, "title: Ruční dotaz\ntypes: [kniha]\nfilters:\n  - přečteno: true\n# napsáno ručně\nview: list\n", "the inline body as written");
    assert_eq!((all[5].saved.clone(), all[6].saved.clone()), (None, None), "inline and invalid fences have no saved name");
    assert!(all.iter().all(|f| f.info == "query" && !f.nested), "top-level, info `query`");

    let doc = "---\nid: 01JB5QTEST\nnote: |\n  ```query\n  saved: Ve frontmatteru\n  ```\n---\n\
Úvod.\n\n\
~~~query\nsaved: Tildy\n~~~\n\n\
```query  úzký pohled\nsaved: S meta\n```\n\n\
````query\nsaved: Čtyři\n````\n\n\
```Query\nsaved: Velké Q\n```\n\n\
```queryx\nsaved: Delší slovo\n```\n\n\
````js\nconst a = 1;\n```query\nsaved: Uvnitř jiného bloku\n```\n````\n\n\
- položka\n\n  ```query\n  saved: V seznamu\n  ```\n\n\
> ```query\n> saved: V citaci\n> ```\n\n\
> [!note] Poznámka\n> ```query\n> saved: V callout\n> ```\n\n\
```query\nsaved:   Mezery okolo   \n```\n\n\
```query\nsaved: [ne, řetězec]\n```\n\n\
```query\n```\n";
    let got: Vec<(String, Option<String>, bool)> = query_fences(doc).iter().map(brief).collect();
    let want: Vec<(String, Option<String>, bool)> = vec![
        ("saved: Tildy\n".into(), Some("Tildy".into()), false),
        ("saved: S meta\n".into(), Some("S meta".into()), false),
        ("saved: Čtyři\n".into(), Some("Čtyři".into()), false),
        ("saved: V seznamu\n".into(), Some("V seznamu".into()), true),
        ("saved: V citaci\n".into(), Some("V citaci".into()), true),
        ("saved: V callout\n".into(), Some("V callout".into()), true),
        ("saved:   Mezery okolo   \n".into(), Some("Mezery okolo".into()), false),
        ("saved: [ne, řetězec]\n".into(), None, false),
        ("".into(), None, false),
    ];
    assert_eq!(got, want, "~~~ and ```` fences, meta allowed, `Query` and `queryx` aren't query fences, frontmatter and other code blocks skipped, containers stripped");
    let infos: Vec<String> = query_fences(doc).iter().map(|f| f.info.clone()).collect();
    assert_eq!(infos.get(1).map(String::as_str), Some("query  úzký pohled"), "the whole info string as written");
    // NFD names are read as NFC; CRLF documents work the same.
    let d2 = format!("```query\nsaved: {}\n```\n", nfd("Otevřené úkoly z této schůzky"));
    assert_eq!(query_fences(&d2).first().and_then(|f| f.saved.clone()), Some("Otevřené úkoly z této schůzky".to_string()), "saved is NFC");
    let crlf = "Úvod.\r\n\r\n```query\r\nsaved: Projekty v běhu\r\n```\r\n";
    let c = query_fences(crlf);
    assert_eq!(c.iter().map(|f| (f.range.start, f.range.end, f.saved.clone())).collect::<Vec<_>>(), vec![("Úvod.\r\n\r\n".len(), crlf.len(), Some("Projekty v běhu".to_string()))], "CRLF: the range includes the CRLF");
}

#[test]
fn fr_fmt_06_ac5_reference_fence_keeps_other_lines() {
    let doc = "Text.\n\n```query\nsaved: Projekty v běhu\n# moje poznámka\nx-pohled: úzký\n```\n";
    let f = query_fences(doc);
    assert_eq!(f.iter().map(brief).collect::<Vec<_>>(), vec![("saved: Projekty v běhu\n# moje poznámka\nx-pohled: úzký\n".to_string(), Some("Projekty v běhu".to_string()), false)], "a reference with other lines");
    assert_eq!(f.first().map(|x| &doc[x.range.clone()]), Some("```query\nsaved: Projekty v běhu\n# moje poznámka\nx-pohled: úzký\n```\n"), "its range");
}

// ------------------------------------------------------------------------------------------------ L2: random documents

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n.max(1) as u64) as usize
    }
    fn chance(&mut self, pct: u64) -> bool {
        self.next() % 100 < pct
    }
}

const NAMES: &[&str] = &["Projekty v běhu", "Otevřené úkoly z této schůzky", "Úkoly po termínu", "Čtení", "Žádosti 2026", "A B plán"];

/// One expected fence: (body with LF, saved, nested, top-level opener line).
type Want = (String, Option<String>, bool, bool);

fn query_body(rng: &mut Rng) -> (Vec<String>, Option<String>) {
    match rng.below(4) {
        0 | 1 => {
            let name = NAMES[rng.below(NAMES.len())];
            let shown = if rng.chance(25) { nfd(name) } else { name.to_string() };
            let mut l = vec![format!("saved: {shown}")];
            if rng.chance(30) {
                l.push("# moje poznámka".into());
            }
            if rng.chance(20) {
                l.push("x-pohled: úzký".into());
            }
            (l, Some(name.to_string()))
        }
        2 => (vec!["title: Ruční dotaz".into(), "types: [kniha]".into(), "filters:".into(), "  - přečteno: true".into()], None),
        _ => (vec!["title: [rozbitý".into()], None),
    }
}

fn gen_doc(rng: &mut Rng) -> (Vec<String>, Vec<Want>) {
    let mut blocks: Vec<String> = Vec::new();
    let mut want: Vec<Want> = Vec::new();
    if rng.chance(50) {
        blocks.push("---\nid: 01JB5QPROP\ntitle: Náhodná\n---".into());
    }
    let n = 1 + rng.below(8);
    for i in 0..n {
        match rng.below(9) {
            0 => blocks.push(format!("Odstavec {i} s [[Výjezd Lisabon 2026]] a #štítek.")),
            1 => blocks.push(format!("## Nadpis {i}")),
            2 => blocks.push("````js\nconst a = 1;\n```query\nsaved: Uvnitř\n```\n````".into()),
            3 => blocks.push("```Query\nsaved: Velké Q\n```".into()),
            4 | 5 => {
                let (body, saved) = query_body(rng);
                let (open, close) = match rng.below(3) {
                    0 => ("~~~", "~~~"),
                    1 => ("````", "````"),
                    _ => ("```", "```"),
                };
                let info = if rng.chance(20) { "query meta" } else { "query" };
                blocks.push(format!("{open}{info}\n{}\n{close}", body.join("\n")));
                want.push((body.join("\n") + "\n", saved, false, true));
            }
            6 => {
                let (body, saved) = query_body(rng);
                let inner: Vec<String> = body.iter().map(|l| format!("  {l}")).collect();
                blocks.push(format!("- položka {i}\n\n  ```query\n{}\n  ```", inner.join("\n")));
                want.push((body.join("\n") + "\n", saved, true, false));
            }
            7 => {
                let (body, saved) = query_body(rng);
                let inner: Vec<String> = body.iter().map(|l| format!("> {l}")).collect();
                blocks.push(format!("> ```query\n{}\n> ```", inner.join("\n")));
                want.push((body.join("\n") + "\n", saved, true, false));
            }
            _ => {
                let (body, saved) = query_body(rng);
                let inner: Vec<String> = body.iter().map(|l| format!("> {l}")).collect();
                blocks.push(format!("> [!note] Poznámka\n> ```query\n{}\n> ```", inner.join("\n")));
                want.push((body.join("\n") + "\n", saved, true, false));
            }
        }
    }
    (blocks, want)
}

fn run_seed(seed: u64, cases: usize) -> Vec<String> {
    let mut rng = Rng(seed | 1);
    let mut bad = Vec::new();
    let mut fences = 0usize;
    for case in 0..cases {
        let (blocks, want) = gen_doc(&mut rng);
        let nl = if rng.chance(30) { "\r\n" } else { "\n" };
        let final_nl = rng.chance(80);
        let text = blocks.join("\n\n").replace('\n', nl) + if final_nl { nl } else { "" };
        let got = query_fences(&text);
        fences += want.len();
        let g: Vec<(String, Option<String>, bool)> = got.iter().map(brief).collect();
        let w: Vec<(String, Option<String>, bool)> = want.iter().map(|(b, s, n, _)| (b.clone(), s.clone(), *n)).collect();
        if g != w {
            bad.push(format!("seed {seed} case {case}: got {g:?}, want {w:?} in {text:?}"));
            continue;
        }
        for (f, (_, _, _, top)) in got.iter().zip(want.iter()) {
            let slice = text.get(f.range.clone()).unwrap_or("");
            let first = slice.split(nl).next().unwrap_or("");
            let opener_ok = if *top { first.trim_start_matches(['`', '~']).starts_with("query") && !first.starts_with(' ') } else { first.contains("query") };
            let end_ok = f.range.end == text.len() || (f.range.end < text.len() && text.as_bytes()[..f.range.end].ends_with(nl.as_bytes()));
            if !opener_ok || !end_ok || f.range.start > f.range.end {
                bad.push(format!("seed {seed} case {case}: range {:?} is not the whole fence: {slice:?}", f.range));
            }
            if f.saved.as_ref().is_some_and(|s| *s != nfc(s)) {
                bad.push(format!("seed {seed} case {case}: saved isn't NFC"));
            }
        }
    }
    if fences < cases {
        bad.push(format!("seed {seed}: only {fences} fences in {cases} documents"));
    }
    bad
}

#[test]
fn fr_fmt_07_ac30_query_fences_property() {
    let scale: u64 = std::env::var("QA_PROPERTY_SCALE").ok().and_then(|s| s.parse().ok()).unwrap_or(1);
    let random: u64 = std::env::var("QA_SEED").ok().and_then(|s| s.parse().ok()).unwrap_or(0x2026_1110);
    let seeds: Vec<u64> = if scale >= 100 { (0..10).map(|i| if i == 0 { 20261110 } else { random + i }).collect() } else { vec![20261110, random] };
    let cases = if scale >= 100 { 1000 } else { 300 };
    println!("query fence property: seeds {seeds:?}");
    let bad: Vec<String> = seeds.iter().flat_map(|s| run_seed(*s, cases)).take(10).collect();
    assert_eq!(bad, Vec::<String>::new(), "every query fence is found once, in order, with its body, name and container, and nothing else is");
}
