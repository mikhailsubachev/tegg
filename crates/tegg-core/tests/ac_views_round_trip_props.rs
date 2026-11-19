//! Slice Q2 L2 (docs/acceptance/views.md FR-FMT-07 AC-32, the property part; docs/contracts/v1-views.md §1.2, §1.4):
//! random query files of Book with every Q2 key (`view`, `group_by`, `lanes`, `lane_order`, `sort` as one mapping or a
//! list, `columns`) in flow and block styles, comment lines and trailing comments, an unknown `x-` key, LF or CRLF, NFD
//! values, and one random Q2 change through `Core::query_apply`: every line outside the changed key's line(s) and
//! `modified:` is byte-identical; the file parses back to the intended definition (D-1458); a no-op change writes
//! nothing. Seeds as TS-L2: a fixed seed plus `QA_SEED` when set, printed; `QA_PROPERTY_SCALE` ≥ 100 runs 10 × 1,000.
//! Compiles against the compile-only stubs of D-1813 and uses only the contract's interface. Written from the AC and the
//! contract only (D-61).

mod common;
mod views_setup;

use common::sandbox;
use tegg_core::queries_q::{Lanes, Order, QueryDef, Sort, View};
use views_setup::*;

const FIXED_SEED: u64 = 20261119;
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0.max(1);
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
    fn int(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
    fn bool(&mut self) -> bool {
        self.int(2) == 1
    }
}
const SORT_KEYS: [&str; 5] = ["title", "modified", "status", "rating", "finished"];
const STATUS: [&str; 3] = ["To read", "Reading", "Read"];
const GENRES: [&str; 5] = ["Román", "Detektivka", "Poezie", "Eseje", "Cestopis"];

#[derive(Clone, Copy, Debug)]
enum Change {
    Lanes,
    LaneOrder,
    ResetLaneOrder,
    Sort,
    GroupBy,
    View,
    Noop,
}
struct Case {
    name: String,
    text: String,
    nl: &'static str,
}
fn levels_text(levels: &[(&str, bool)], block: bool, comment: &str, nl: &str) -> String {
    let o = |d: bool| if d { "desc" } else { "asc" };
    if levels.len() == 1 && !block {
        format!("sort: {{ by: {}, order: {} }}{comment}{nl}", levels[0].0, o(levels[0].1))
    } else {
        let mut s = format!("sort:{comment}{nl}");
        for (k, d) in levels {
            s.push_str(&format!("  - {{ by: {k}, order: {} }}{nl}", o(*d)));
        }
        s
    }
}
fn gen(r: &mut Rng, seed: u64, i: usize) -> Case {
    let nl = if r.int(4) == 0 { "\r\n" } else { "\n" };
    let name = format!("Náhodný {seed} {i}");
    let spell = |s: &str, nfd_on: bool| if nfd_on { nfd(s) } else { s.to_string() };
    let mut lines: Vec<String> = vec![format!("# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › {name}.{nl}")];
    if r.bool() {
        lines.push(format!("# ručně: žluťoučký kůň{nl}"));
    }
    lines.push(format!("version: 1{nl}title: {name}{nl}"));
    if r.bool() {
        lines.push(format!("x-poznámka: {}{nl}", spell("zelená čárka", r.bool())));
    }
    lines.push(format!("types: [book]{nl}match: all{nl}filters: []{nl}"));
    let n = 1 + r.int(3);
    let levels: Vec<(&str, bool)> = (0..n).map(|k| (SORT_KEYS[(k + r.int(5)) % 5], r.bool())).collect();
    let mut seen = Vec::new();
    let levels: Vec<(&str, bool)> = levels.into_iter().filter(|(k, _)| if seen.contains(k) { false } else { seen.push(*k); true }).collect();
    let sc = if r.bool() { "   # jedna úroveň" } else { "" };
    lines.push(levels_text(&levels, levels.len() > 1, sc, nl));
    lines.push(format!("limit: 50{nl}"));
    if r.bool() {
        lines.push(format!("# tabule{nl}"));
    }
    lines.push(format!("view: board{nl}"));
    let by_status = r.bool();
    lines.push(format!("group_by: {}{nl}", if by_status { "status" } else { "genres" }));
    match r.int(3) {
        0 => {}
        1 => lines.push(format!("lanes: horizontal{nl}")),
        _ => lines.push(format!("lanes: vertical            # vertical nebo horizontal{nl}")),
    }
    let vals: Vec<&str> = if by_status { STATUS.to_vec() } else { GENRES.to_vec() };
    match r.int(3) {
        0 => {}
        1 => lines.push(format!("lane_order: [{}]{nl}", vals.iter().rev().map(|v| spell(v, false)).collect::<Vec<_>>().join(", "))),
        _ => {
            lines.push(format!("lane_order:{nl}"));
            for v in vals.iter().rev() {
                lines.push(format!("  - {v}{nl}"));
            }
        }
    }
    lines.push(format!("columns: [author, rating]{nl}created: 2026-11-01T09:00:00+01:00{nl}modified: 2026-11-01T09:00:00+01:00{nl}"));
    Case { name, text: lines.concat(), nl }
}
/// The file's lines without those of `key` (its line and indented continuation lines) and without `modified:`.
fn outside(text: &str, key: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut in_key = false;
    for l in text.split_inclusive('\n') {
        if l.starts_with(&format!("{key}:")) {
            in_key = true;
            continue;
        }
        if in_key && l.starts_with("  ") {
            continue;
        }
        in_key = false;
        if l.starts_with("modified:") {
            continue;
        }
        out.push(l.to_string());
    }
    out
}

#[test]
fn fr_fmt_07_ac32_query_files_with_q2_keys_round_trip() {
    let scale: u64 = std::env::var("QA_PROPERTY_SCALE").ok().and_then(|s| s.parse().ok()).unwrap_or(1);
    let random: u64 = std::env::var("QA_SEED").ok().and_then(|s| s.parse().ok()).unwrap_or(FIXED_SEED + 1);
    let seeds: Vec<u64> = if scale >= 100 { (0..10).map(|i| if i == 0 { FIXED_SEED } else { random + i }).collect() } else { vec![FIXED_SEED, random] };
    let runs = if scale >= 100 { 1000 } else { 40 };
    println!("Q2 query-file patch property: {}", seeds.iter().map(|s| format!("seed = {s}")).collect::<Vec<_>>().join(", "));
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let mut failures: Vec<String> = Vec::new();
    for seed in seeds {
        let mut r = Rng(seed);
        for i in 0..runs {
            let c = gen(&mut r, seed, i);
            let rel = qpath(&c.name);
            write(&root, &rel, c.text.as_bytes());
            reread(&core, &[&rel]);
            let q = core.query(&c.name);
            let (Some(d0), Some(v)) = (q.def.clone(), q.version.clone()) else {
                failures.push(format!("seed {seed} case {i}: not read:\n{}", c.text));
                continue;
            };
            let change = [Change::Lanes, Change::LaneOrder, Change::ResetLaneOrder, Change::Sort, Change::GroupBy, Change::View, Change::Noop][r.int(7)];
            let mut d: QueryDef = d0.clone();
            let key = match change {
                Change::Lanes => {
                    d.lanes = if d.lanes == Lanes::Vertical { Lanes::Horizontal } else { Lanes::Vertical };
                    "lanes"
                }
                Change::LaneOrder => {
                    let vals: Vec<&str> = if d.group_by.as_deref() == Some("status") { STATUS.to_vec() } else { GENRES.to_vec() };
                    let k = r.int(vals.len());
                    let mut o: Vec<String> = vals.iter().map(|s| s.to_string()).collect();
                    o.rotate_left(k.max(1));
                    d.lane_order = Some(o.into_iter().map(|s| if r.bool() { nfd(&s) } else { s }).collect());
                    "lane_order"
                }
                Change::ResetLaneOrder => {
                    d.lane_order = None;
                    "lane_order"
                }
                Change::Sort => {
                    let n = 1 + r.int(3);
                    let mut s: Vec<Sort> = Vec::new();
                    for _ in 0..n {
                        let by = SORT_KEYS[r.int(5)].to_string();
                        if !s.iter().any(|x| x.by == by) {
                            s.push(Sort { by, order: if r.bool() { Order::Desc } else { Order::Asc } });
                        }
                    }
                    d.sort = s;
                    "sort"
                }
                Change::GroupBy => {
                    d.group_by = Some(if d.group_by.as_deref() == Some("status") { "genres".into() } else { "status".into() });
                    "group_by"
                }
                Change::View => {
                    d.view = if d.view == View::Board { View::Table } else { View::Board };
                    "view"
                }
                Change::Noop => "",
            };
            let res = core.query_apply(&c.name, &v, d.clone(), NOW);
            let after = disk_s(&root, &rel).unwrap_or_default();
            let where_ = format!("seed {seed} case {i} {change:?}:\n{}", c.text);
            if let Err(e) = res {
                failures.push(format!("{where_}\nquery_apply answered {e:?}"));
                continue;
            }
            let wrote = after != c.text;
            let same = d == d0 || matches!(change, Change::Noop) || (matches!(change, Change::ResetLaneOrder) && d0.lane_order.is_none());
            if same {
                if wrote {
                    failures.push(format!("{where_}\na no-op change wrote:\n{after}"));
                }
                continue;
            }
            if !wrote {
                failures.push(format!("{where_}\nthe change wrote nothing"));
                continue;
            }
            if outside(&after, key) != outside(&c.text, key) {
                failures.push(format!("{where_}\nlines outside `{key}` changed:\n{after}"));
            }
            if c.nl == "\r\n" && after.replace("\r\n", "").contains('\n') {
                failures.push(format!("{where_}\nCRLF not kept:\n{after}"));
            }
            let back = core.query(&c.name).def;
            let mut want = d.clone();
            if let Some(o) = want.lane_order.as_mut() {
                for x in o.iter_mut() {
                    *x = tegg_format::nfc(x);
                }
            }
            if back.as_ref().map(|b| (&b.sort, b.view, &b.group_by, b.lanes, &b.lane_order)) != Some((&want.sort, want.view, &want.group_by, want.lanes, &want.lane_order)) {
                failures.push(format!("{where_}\nparses back to {back:?}, intended {want:?}"));
            }
            if failures.len() >= 3 {
                break;
            }
        }
    }
    assert!(failures.is_empty(), "every Q2 change keeps every other byte and parses back:\n{}", failures.join("\n---\n"));
}
