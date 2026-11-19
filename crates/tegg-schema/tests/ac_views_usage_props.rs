//! Slice Q2.1 L2 at `tegg-schema` (docs/acceptance/views.md FR-FMT-07 AC-34, the type-file property; R196; docs/contracts/
//! v1-views.md §14.2): random type files with `views:` in flow and block style, plain and mapping items with own `sort` /
//! `columns`, unknown item keys, comments inside items, CRLF and NFD names, and a random usage change (`SetViewSort`,
//! `SetViewColumns`, `SetViews`): every line outside the `views` key is byte-identical; an unchanged item keeps its
//! lines; a changed item is re-emitted (name, sort, columns, then its unknown-key lines; its comments dropped); while
//! every item is plain the key is one flow line; the result reads back as the intended items; a no-op writes nothing.
//! Seeds as TS-L2: a fixed seed plus `QA_SEED` when set, printed; `QA_PROPERTY_SCALE` ≥ 100 runs 10 seeds × 1,000 cases.
//! Written from the AC and the contract only (D-61).

use std::path::PathBuf;

use tegg_schema::*;

const FIXED_SEED: u64 = 20261119;
const LINE13: &str = "views: [Rozečtené, Přečtené 2026, Výborné knihy]\n";
const POOL: [&str; 6] = ["Rozečtené", "Přečtené 2026", "Výborné knihy", "Podle žánru", "Čtu na léto", "Zápisky"];
const KEYS: [&str; 7] = ["title", "author", "rating", "finished", "genres", "modified", "status"];

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
        self.next() & 1 == 1
    }
}
fn base() -> String {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/vaults/views/.tegg/types/book.yml");
    std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("setup: {e}"))
}
fn nfd(s: &str) -> String {
    s.replace('é', "e\u{301}").replace('č', "c\u{30C}").replace('ř', "r\u{30C}").replace('ž', "z\u{30C}").replace('Č', "C\u{30C}").replace('ý', "y\u{301}").replace('í', "i\u{301}").replace('á', "a\u{301}")
}

#[derive(Clone, PartialEq, Debug)]
struct Item {
    name: String,
    nfd: bool,
    sort: Option<Vec<(String, bool)>>,
    columns: Option<Vec<String>>,
    unknown: bool,
    comment: bool,
    /// The item's lines as written (block style), without EOL; None for a new or re-emitted item.
    lines: Option<Vec<String>>,
}
impl Item {
    fn plain(&self) -> bool {
        self.sort.is_none() && self.columns.is_none() && !self.unknown
    }
    fn value(&self) -> (String, Option<Vec<(String, bool)>>, Option<Vec<String>>, bool) {
        (self.name.clone(), self.sort.clone(), self.columns.clone(), self.unknown)
    }
}
fn sort_lines(s: &[(String, bool)], indent: &str) -> Vec<String> {
    let lvl = |(b, a): &(String, bool)| format!("{{ by: {b}, order: {} }}", if *a { "asc" } else { "desc" });
    match s.len() {
        0 => vec![format!("{indent}sort: []")],
        1 => vec![format!("{indent}sort: {}", lvl(&s[0]))],
        _ => std::iter::once(format!("{indent}sort:")).chain(s.iter().map(|l| format!("{indent}  - {}", lvl(l)))).collect(),
    }
}
/// The canonical lines of an item (R196's write style).
fn emit(i: &Item) -> Vec<String> {
    if i.plain() {
        return vec![format!("  - {}", i.name)];
    }
    let mut out = vec![format!("  - name: {}", i.name)];
    if let Some(s) = &i.sort {
        out.extend(sort_lines(s, "    "));
    }
    if let Some(c) = &i.columns {
        out.push(format!("    columns: [{}]", c.join(", ")));
    }
    if i.unknown {
        out.push("    x-barva: modrá".into());
    }
    out
}
/// The generated input lines of an item: name first, then its parts in a random order, NFD name maybe.
fn written(r: &mut Rng, i: &Item) -> Vec<String> {
    let name = if i.nfd { nfd(&i.name) } else { i.name.clone() };
    if i.plain() && !i.comment {
        return vec![format!("  - {name}")];
    }
    let mut parts: Vec<Vec<String>> = Vec::new();
    if let Some(s) = &i.sort {
        parts.push(sort_lines(s, "    "));
    }
    if let Some(c) = &i.columns {
        parts.push(vec![format!("    columns: [{}]", c.join(", "))]);
    }
    if i.unknown {
        parts.push(vec!["    x-barva: modrá".into()]);
    }
    if i.comment {
        parts.push(vec!["    # poznámka k pohledu".into()]);
    }
    for k in (1..parts.len()).rev() {
        let j = r.int(k + 1);
        parts.swap(k, j);
    }
    std::iter::once(format!("  - name: {name}")).chain(parts.into_iter().flatten()).collect()
}
fn rand_sort(r: &mut Rng) -> Vec<(String, bool)> {
    let mut pool: Vec<&str> = KEYS.to_vec();
    (0..r.int(4)).map(|_| (pool.remove(r.int(pool.len())).to_string(), r.bool())).collect()
}
fn rand_cols(r: &mut Rng) -> Vec<String> {
    let mut pool: Vec<&str> = KEYS.to_vec();
    (0..1 + r.int(3)).map(|_| pool.remove(r.int(pool.len())).to_string()).collect()
}
fn render(items: &[Item], flow: bool) -> Vec<String> {
    if flow {
        return vec![format!("views: [{}]", items.iter().map(|i| i.name.clone()).collect::<Vec<_>>().join(", "))];
    }
    std::iter::once("views:".to_string()).chain(items.iter().flat_map(|i| i.lines.clone().unwrap_or_else(|| emit(i)))).collect()
}
/** The `views` key's region of a type file (for failure messages). */
fn region(t: &str) -> String {
    let a = t.find("views").unwrap_or(0);
    let b = t.find("attributes:").unwrap_or(t.len()).max(a);
    t[a..b].to_string()
}
fn to_usage(s: &[(String, bool)]) -> Vec<UsageSort> {
    s.iter().map(|(b, a)| UsageSort { by: b.clone(), order: if *a { UsageOrder::Asc } else { UsageOrder::Desc } }).collect()
}

#[test]
fn fr_fmt_07_ac34_usage_settings_round_trip() {
    let scale: u64 = std::env::var("QA_PROPERTY_SCALE").ok().and_then(|v| v.parse().ok()).unwrap_or(1);
    let random: u64 = std::env::var("QA_SEED").ok().and_then(|v| v.parse().ok()).unwrap_or_else(|| std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(7));
    let seeds: Vec<u64> = if scale >= 100 { (0..10).map(|i| if i == 0 { FIXED_SEED } else { random + i }).collect() } else { vec![FIXED_SEED, random] };
    let runs = if scale >= 100 { 1000 } else { 150 };
    println!("views items property: seeds = {seeds:?}");
    let base = base();
    assert!(base.contains(LINE13), "setup: the base book.yml has line 13");
    let others: Vec<TypeNames<'static>> = vec![TypeNames { key: "book", name: "Book", folder: "Books", is_self: true }];
    let mut fails: Vec<String> = Vec::new();
    for seed in seeds {
        for run in 0..runs {
            if fails.len() >= 5 {
                break;
            }
            let mut r = Rng(seed.wrapping_mul(7919).wrapping_add(run));
            let crlf = r.bool();
            // Items: distinct names, plain or with own values, unknown keys, comments; NFD only in mapping items.
            let mut pool: Vec<&str> = POOL.to_vec();
            let n = 1 + r.int(4);
            let mut items: Vec<Item> = (0..n)
                .map(|_| {
                    let name = pool.remove(r.int(pool.len())).to_string();
                    let mapping = r.int(3) == 0;
                    let sort = if mapping && r.bool() { Some(rand_sort(&mut r)) } else { None };
                    let columns = if mapping && (sort.is_none() || r.bool()) { Some(rand_cols(&mut r)) } else { None };
                    let unknown = mapping && r.int(3) == 0;
                    let comment = (sort.is_some() || columns.is_some() || unknown) && r.int(3) == 0;
                    Item { name, nfd: mapping && r.bool(), sort, columns, unknown, comment, lines: None }
                })
                .collect();
            let all_plain = items.iter().all(|i| i.plain() && !i.comment);
            let flow = all_plain && r.bool();
            for i in items.iter_mut() {
                if !flow {
                    let w = written(&mut r, i);
                    i.lines = Some(w);
                }
            }
            let input_views = render(&items, flow);
            let nl = if crlf { "\r\n" } else { "\n" };
            let text = base.replace(LINE13, &format!("{}\n", input_views.join("\n"))).replace('\n', nl);
            // A random change.
            let target = r.int(items.len());
            let tname = items[target].name.clone();
            let mut after = items.clone();
            let op = match r.int(3) {
                0 => {
                    let v = if r.int(3) == 0 { None } else { Some(rand_sort(&mut r)) };
                    after[target].sort = v.clone();
                    TypeOp::SetViewSort { name: tname.clone(), sort: v.map(|s| to_usage(&s)) }
                }
                1 => {
                    let v = if r.int(3) == 0 { None } else { Some(rand_cols(&mut r)) };
                    after[target].columns = v.clone();
                    TypeOp::SetViewColumns { name: tname.clone(), columns: v }
                }
                _ => {
                    let mut names: Vec<Item> = after.clone();
                    if names.len() > 1 && r.bool() {
                        names.remove(r.int(names.len()));
                    }
                    for k in (1..names.len()).rev() {
                        let j = r.int(k + 1);
                        names.swap(k, j);
                    }
                    if r.int(4) == 0 {
                        names.push(Item { name: "Nový pohled".into(), nfd: false, sort: None, columns: None, unknown: false, comment: false, lines: None });
                    }
                    after = names;
                    TypeOp::SetViews(after.iter().map(|i| i.name.clone()).collect())
                }
            };
            // Changed items lose their kept lines (re-emitted, comments dropped).
            let mut any_change = after.len() != items.len() || after.iter().zip(items.iter()).any(|(a, b)| a.name != b.name);
            for a in after.iter_mut() {
                match items.iter().find(|b| b.name == a.name) {
                    Some(b) if b.value() == a.value() => {}
                    _ => {
                        any_change = true;
                        a.lines = None;
                        a.comment = false;
                        a.nfd = false;
                    }
                }
            }
            let out_flow = after.iter().all(|i| i.plain());
            let want = if !any_change {
                None
            } else {
                let lines = if out_flow { render(&after, true) } else { render(&after, false) };
                Some(base.replace(LINE13, &format!("{}\n", lines.join("\n"))).replace('\n', nl))
            };
            let got = patch("book", &text, std::slice::from_ref(&op), &PatchContext { others: &others });
            if got.as_ref().ok() != Some(&want) {
                let got_v = got.as_ref().map(|o| o.as_deref().map(region));
                fails.push(format!("seed {seed} run {run}: {op:?}\n--- input\n{}\n--- want\n{:?}\n--- got\n{got_v:?}", region(&text), want.as_deref().map(region)));
                continue;
            }
            if let Some(t) = &want {
                let p = parse("book", t);
                let read: Option<Vec<(String, bool)>> = p.view_items.map(|v| v.iter().map(|i| (i.name.clone(), i.plain)).collect());
                let intended: Vec<(String, bool)> = after.iter().map(|i| (i.name.clone(), i.plain())).collect();
                if read != Some(intended.clone()) {
                    fails.push(format!("seed {seed} run {run}: reads back {read:?}, want {intended:?}"));
                }
            }
        }
    }
    assert_eq!(fails, Vec::<String>::new(), "views writes: only the views lines change, by R196's rules");
}
