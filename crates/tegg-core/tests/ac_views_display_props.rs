//! Slice Q3, L2 oracle at `tegg-core` (docs/acceptance/views.md FR-QRY-01 AC-22, the oracle part; queries.md FR-QRY-02
//! AC-8's oracle extended): random reference fences on the base views fixture with an own `view` (`table`, `list`,
//! `wall`), an own `group_by` (Select, multi-select, relation, `tags`, a date period) and an own `sort` (one or two
//! levels). For every grouping the core's run (docs/contracts/v1-views.md §34.4: grouping in every display) gives:
//! `group` for every display, with the grouping asked for; for every group with rows, the rows of a grouped Table and
//! List equal the cards of that lane on the wall, in the same order; and each lane's order is the ungrouped run's order
//! restricted to that lane (the effective sort, then title, then path). Seeds: a fixed seed and one random seed
//! (`QA_SEED` when set), printed; `QA_PROPERTY_SCALE` ≥ 100 runs 10 seeds × 200 cases. Written from the AC and the
//! contract only (D-61).

mod common;
mod views_setup;

use common::sandbox;
use tegg_core::queries_q::{QueryResult, QuerySource, View};
use views_setup::*;

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
    fn pick<'a, T>(&mut self, v: &'a [T]) -> &'a T {
        &v[self.below(v.len())]
    }
}

const QUERIES: [&str; 5] = ["Rozečtené", "Přečtené 2026", "Výborné knihy", "Podle žánru", "Podle autora"];
const GROUPS: [(&str, &str); 6] = [("status", "status"), ("genres", "genres"), ("author", "author"), ("rating", "rating"), ("tags", "tags"), ("{ finished: period }", "finished")];
const SORT_KEYS: [&str; 5] = ["title", "finished", "rating", "modified", "status"];

/// Lanes with cards: (id, paths).
fn lanes(r: &QueryResult) -> Vec<(String, Vec<String>)> {
    r.group.as_ref().map(|g| g.lanes.iter().filter(|l| !l.cards.is_empty()).map(|l| (tegg_format::nfc(&l.id), l.cards.iter().map(|c| tegg_format::nfc(&r.rows[c.row].path)).collect())).collect()).unwrap_or_default()
}

#[test]
fn fr_qry_01_ac22_sort_inside_groups() {
    let scale: u64 = std::env::var("QA_PROPERTY_SCALE").ok().and_then(|s| s.parse().ok()).unwrap_or(1);
    let random: u64 = std::env::var("QA_SEED").ok().and_then(|s| s.parse().ok()).unwrap_or_else(|| std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(7) % (1 << 31));
    let seeds: Vec<u64> = if scale >= 100 { (0..10).map(|i| if i == 0 { 20261123 } else { random + i }).collect() } else { vec![20261123, random] };
    let cases = if scale >= 100 { 200 } else { 25 };
    println!("grouped displays oracle: {}", seeds.iter().map(|s| format!("seed = {s}")).collect::<Vec<_>>().join(", "));
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let note = "Pages/Orákulum.md";
    let mut bad: Vec<String> = Vec::new();
    for &seed in &seeds {
        let mut r = Rng(seed | 1);
        for case in 0..cases {
            if bad.len() >= 5 {
                break;
            }
            let q = *r.pick(&QUERIES);
            let (g, key) = *r.pick(&GROUPS);
            let s1 = *r.pick(&SORT_KEYS);
            let o1 = if r.below(2) == 0 { "asc" } else { "desc" };
            let sort = if r.below(2) == 0 { format!("sort: {{ by: {s1}, order: {o1} }}") } else { format!("sort:\n  - {{ by: {s1}, order: {o1} }}\n  - {{ by: {}, order: asc }}", r.pick(&SORT_KEYS)) };
            let e = if r.below(2) == 0 { env() } else { env_us() };
            let body = |view: &str, grouped: bool| format!("saved: {q}\nview: {view}\ngroup_by: {}\n{sort}", if grouped { g } else { "none" });
            let text = format!(
                "---\nid: 01JB5V00000000000000000050\ntype: page\ntitle: Orákulum\n---\n```query\n{}\n```\n\n```query\n{}\n```\n\n```query\n{}\n```\n\n```query\n{}\n```\n",
                body("table", true),
                body("list", true),
                body("wall", true),
                body("table", false)
            );
            write(&root, note, text.as_bytes());
            reread(&core, &[note]);
            let fences = tegg_format::query_fences(&text);
            let run_n = |n: usize| core.query_run(QuerySource::Fence(fences[n].body.clone()), Some(note), &e);
            let (table, list, wall, flat) = (run_n(0), run_n(1), run_n(2), run_n(3));
            let what = format!("seed {seed} case {case}: {q}, group_by {g}, {}", sort.replace('\n', " "));
            for (d, res, want) in [("table", &table, View::Table), ("list", &list, View::List), ("wall", &wall, View::Wall)] {
                if res.group.as_ref().map(|x| x.key.clone()) != Some(key.to_string()) || res.usage.as_ref().map(|u| u.view) != Some(want) {
                    bad.push(format!("{what}: the {d} isn't grouped by {key} as a {d}"));
                }
            }
            if flat.group.is_some() {
                bad.push(format!("{what}: `group_by: none` still grouped"));
            }
            let (lt, ll, lw) = (lanes(&table), lanes(&list), lanes(&wall));
            if lt != lw || ll != lw {
                bad.push(format!("{what}: Table / List groups differ from the wall's lanes\n  table {lt:?}\n  list  {ll:?}\n  wall  {lw:?}"));
            }
            let order: Vec<String> = flat.rows.iter().map(|x| tegg_format::nfc(&x.path)).collect();
            for (id, cards) in &lw {
                let pos: Vec<usize> = cards.iter().filter_map(|c| order.iter().position(|o| o == c)).collect();
                if pos.len() != cards.len() || pos.windows(2).any(|w| w[0] > w[1]) {
                    bad.push(format!("{what}: lane {id} isn't in the ungrouped order: {cards:?}"));
                }
            }
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "grouped Tables and Lists equal the wall's lanes, each in the effective sort");
}
