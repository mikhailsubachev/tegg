//! Slice OC L4 benchmark (docs/acceptance/cards.md NFR-PERF-07 AC-6, the core part; docs/contracts/v1-cards.md §3.3,
//! §12): on the generated reference vault (`tools/gen-vault --seed 1 --small-images`), copied, plus NFR-PERF-07 AC-3's
//! runtime type `karta` (500 objects in 6 lanes of `fáze`) whose `karta.yml` gets
//! `card: [tags, body, fáze, a1, a2, a3, a4, a5, modified]` (five Text attributes, every value set, a 300-character body):
//! `query_run` of the board with the nine card values and the excerpt returns in ≤ 100 ms p95 of 20 runs. The card data
//! (nine keys, the excerpt) is always asserted; times are asserted in release builds (`common::target`: ×10 in debug
//! builds). Skipped at push by `--skip nfr_perf_`; run nightly by `core-perf-ac`; report-only until the v1.0 release gate
//! (D-1800, D-1996). Written from the AC and the contract only (D-61); synthetic data only (D-62).

mod common;

use std::time::{Duration, Instant};

use chrono::{NaiveDate, Weekday};
use common::{p95, reference_vault_copy, sandbox, target};
use tegg_core::queries_q::{QueryEnv, QuerySource};
use tegg_core::{Core, CoreOptions};

const OPTS: [&str; 5] = ["Nápad", "Rozpracováno", "Čeká", "Hotovo", "Zrušeno"];

#[test]
fn nfr_perf_07_ac6_boards_with_card_values() {
    let sb = sandbox();
    let root = reference_vault_copy(&sb);
    std::fs::create_dir_all(root.join(".tegg/types")).expect("setup: types");
    std::fs::create_dir_all(root.join(".tegg/queries")).expect("setup: queries");
    std::fs::create_dir_all(root.join("Karty")).expect("setup: Karty");
    let mut t = String::from("# Tegg type definition (FR-TYP-01, FR-STO-06, D-90). Edit it in Tegg's type settings.\nversion: 1\nname: Karta\nplural: Karty\nsystem: false\nfolder: Karty\nicon: file\ncolor: gray\nreview: false\npreview: [fáze]\ncard: [tags, body, fáze, a1, a2, a3, a4, a5, modified]\nviews: [Karty]\nattributes:\n  - key: fáze\n    name: Fáze\n    type: select\n    options:\n");
    for o in OPTS {
        t.push_str(&format!("      - {{ label: {o}, color: gray }}\n"));
    }
    for i in 1..=5 {
        t.push_str(&format!("  - key: a{i}\n    name: Údaj {i}\n    type: text\n"));
    }
    std::fs::write(root.join(".tegg/types/karta.yml"), t).expect("setup: karta.yml");
    std::fs::write(root.join(".tegg/queries/Karty.yml"), "# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › Karty.\nversion: 1\ntitle: Karty\ntypes: [karta]\nmatch: all\nfilters: []\nsort: { by: title, order: asc }\nlimit: 50\nview: board\ngroup_by: fáze\nlanes: vertical\ncolumns: [tags]\ncreated: 2026-11-01T09:00:00+01:00\nmodified: 2026-11-01T09:00:00+01:00\n").expect("setup: Karty.yml");
    let body: String = "Žluťoučký kůň úpěl ďábelské ódy, ".repeat(10).chars().take(300).collect();
    for i in 0..500 {
        let o = if i < 400 { Some(OPTS[i / 100]) } else if i < 450 { Some(OPTS[4]) } else { None };
        let n = format!("{i:03}");
        let mut f = format!("---\nid: 01JBKARTA0000000000000{:0>4}\ntype: karta\ntitle: Karta {n}\n", n);
        if let Some(o) = o {
            f.push_str(&format!("fáze: {o}\n"));
        }
        for a in 1..=5 {
            f.push_str(&format!("a{a}: Hodnota {a} karty {n}\n"));
        }
        f.push_str(&format!("tags: [štítek{}]\ncreated: 2026-11-01T09:00:00+01:00\nmodified: 2026-11-01T09:00:00+01:00\n---\n{body}\n", i % 7));
        std::fs::write(root.join(format!("Karty/Karta {n}.md")), f).expect("setup: karta");
    }
    let core = match Core::open(&root, &sb.dirs, CoreOptions { watch: false, sync: None }) {
        Ok(c) => c,
        Err(e) => panic!("setup: open: {e:?}"),
    };
    let _ = core.wait_idle(Duration::from_secs(600));
    let env = QueryEnv { today: NaiveDate::from_ymd_opt(2026, 11, 19).expect("date"), tz: "Europe/Prague".parse().expect("zone"), week_start: Weekday::Sun, locale: "en-US".into() };
    let mut samples = Vec::new();
    let mut with_card = 0usize;
    let mut rows = 0usize;
    for _ in 0..20 {
        let t0 = Instant::now();
        let r = core.query_run(QuerySource::Saved("Karty".into()), None, &env);
        samples.push(t0.elapsed());
        rows = r.rows.len();
        with_card = r.rows.iter().filter(|x| x.card.as_ref().is_some_and(|c| c.keys.len() == 9 && c.values.len() == 8 && c.excerpt.as_deref().is_some_and(|e| !e.is_empty()))).count();
    }
    assert!(rows > 0, "the board has rows");
    assert_eq!(with_card, rows, "every row carries the nine card values and the excerpt (contract §3.3)");
    let p = p95(&mut samples);
    println!("NFR-PERF-07 AC-6: query_run Karty, 500 cards with nine card values, p95 = {p:?} (target 100 ms; report-only until v1.0, D-1996)");
    if std::env::var("TEGG_PERF_REF").as_deref() == Ok("1") && std::env::var("VERIFY_GATE").as_deref() == Ok("release") {
        assert!(p <= target(Duration::from_millis(100), 1.0), "p95 {p:?}");
    }
}
