//! Slice Q3, L2 property at `tegg-schema` (docs/acceptance/views.md FR-FMT-07 AC-37, the type-file part): random
//! `book.yml` files whose `views:` block list holds items with own `view`, `group_by`, `lanes`, `lane_order`, `widths`,
//! `sort`, `columns` in old and new words (`board`, `vertical`, `horizontal`), flow and block styles, trailing comments,
//! full-line comments inside an item and an unknown key last; LF and CRLF. A random Q3 op on one item
//! (`SetViewDisplay`, `SetViewGroup`, `SetViewLanes`, `SetViewLaneOrder`, `SetViewWidths`; docs/contracts/v1-views.md
//! §36.2): only the changed key's lines of that item change (CP-35, D-2200: the other keys keep their lines, old words
//! and trailing comments included; a missing key goes at R221's place; full-line comments inside the changed item go;
//! a replaced one-line key keeps its trailing comment), every other item and every byte outside `views` is kept, the
//! result parses to the intended values, and a no-op (an equal valid value, old words included; widths as maps) is no
//! write. Seeds: a fixed seed and one random seed (`QA_SEED` when set), printed; `QA_PROPERTY_SCALE` ≥ 100 runs 10 seeds ×
//! 1,000 cases. Written from the AC and the contract only (D-61). Nothing is written to disk.

use std::path::PathBuf;

use tegg_schema::*;

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}
fn base() -> String {
    std::fs::read_to_string(repo().join("tests/fixtures/vaults/views/.tegg/types/book.yml")).expect("setup: base book.yml")
}
const LINE13: &str = "views: [Rozečtené, Přečtené 2026, Výborné knihy]\n";
const NAMES: [(&str, &str, &str); 9] = [
    ("page", "Page", "Pages"),
    ("task", "Task", "Tasks"),
    ("quick-note", "Quick Note", "Quick Notes"),
    ("daily-note", "Daily Note", "Daily"),
    ("tag", "Tag", "Tags"),
    ("image", "Image", "Images"),
    ("pdf", "PDF", "PDFs"),
    ("book", "Book", "Books"),
    ("autor", "Autor", "Autoři"),
];
fn do_patch(text: &str, ops: Vec<TypeOp>) -> Result<Option<String>, SchemaError> {
    let others: Vec<TypeNames<'static>> = NAMES.iter().map(|(k, n, f)| TypeNames { key: k, name: n, folder: f, is_self: *k == "book" }).collect();
    patch("book", text, &ops, &PatchContext { others: &others })
}

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
    fn chance(&mut self, pct: u64) -> bool {
        self.next() % 100 < pct
    }
    fn pick<'a, T>(&mut self, v: &'a [T]) -> &'a T {
        &v[self.below(v.len())]
    }
}

const ORDER: [&str; 7] = ["view", "group_by", "lanes", "lane_order", "sort", "columns", "widths"];
const ITEM_NAMES: [&str; 5] = ["Rozečtené", "Přečtené 2026", "Výborné knihy", "Podle žánru", "Čtení na léto"];
const GROUP_KEYS: [&str; 3] = ["status", "genres", "author"];
const LANE_VALUES: [&str; 5] = ["Reading", "To read", "Read", "Román", "[[Lucie Horká]]"];
const WIDTH_KEYS: [&str; 4] = ["title", "author", "rating", "genres"];

#[derive(Clone, Debug, PartialEq)]
struct Own {
    view: Option<UsageView>,
    group: Option<UsageGroupBy>,
    lanes: Option<UsageLanes>,
    lane_order: Option<Vec<String>>,
    widths: Option<Vec<(String, u32)>>,
}
#[derive(Clone, Debug)]
struct Part {
    kind: &'static str,
    lines: Vec<String>,
}
#[derive(Clone, Debug)]
struct Item {
    name: String,
    parts: Vec<Part>,
    own: Own,
}

fn view_word(v: UsageView) -> &'static str {
    match v {
        UsageView::List => "list",
        UsageView::Table => "table",
        UsageView::Wall => "wall",
    }
}
fn group_line(g: &UsageGroupBy) -> String {
    match g {
        UsageGroupBy::None => "    group_by: none".into(),
        UsageGroupBy::Key(k) => format!("    group_by: {k}"),
        UsageGroupBy::Period(k) => format!("    group_by: {{ {k}: period }}"),
    }
}
fn flow_value(s: &str) -> String {
    if s.starts_with('[') { format!("\"{s}\"") } else { s.to_string() }
}
fn lane_line(l: &[String]) -> String {
    format!("    lane_order: [{}]", l.iter().map(|s| flow_value(s)).collect::<Vec<_>>().join(", "))
}
fn widths_line(w: &[(String, u32)]) -> String {
    format!("    widths: {{ {} }}", w.iter().map(|(k, v)| format!("{k}: {v}")).collect::<Vec<_>>().join(", "))
}
fn same_widths(a: &[(String, u32)], b: &[(String, u32)]) -> bool {
    let mut x: Vec<_> = a.to_vec();
    let mut y: Vec<_> = b.to_vec();
    x.sort();
    y.sort();
    x == y
}

fn gen_item(r: &mut Rng, name: &str) -> Item {
    let mut own = Own { view: None, group: None, lanes: None, lane_order: None, widths: None };
    let mut parts: Vec<Part> = Vec::new();
    if r.chance(50) {
        let (w, v) = *r.pick(&[("list", UsageView::List), ("table", UsageView::Table), ("wall", UsageView::Wall), ("board", UsageView::Wall)]);
        own.view = Some(v);
        parts.push(Part { kind: "view", lines: vec![format!("    view: {w}")] });
    }
    if r.chance(50) {
        let g = match r.below(4) {
            0 => UsageGroupBy::None,
            1 => UsageGroupBy::Period("finished".into()),
            _ => UsageGroupBy::Key(r.pick(&GROUP_KEYS).to_string()),
        };
        parts.push(Part { kind: "group_by", lines: vec![group_line(&g)] });
        own.group = Some(g);
    }
    if r.chance(50) {
        let (w, l) = *r.pick(&[("columns", UsageLanes::Columns), ("rows", UsageLanes::Rows), ("vertical", UsageLanes::Columns), ("horizontal", UsageLanes::Rows)]);
        own.lanes = Some(l);
        let comment = if r.chance(40) { "            # vertical nebo horizontal" } else { "" };
        parts.push(Part { kind: "lanes", lines: vec![format!("    lanes: {w}{comment}")] });
    }
    if r.chance(40) {
        let k = r.below(3);
        let l = distinct(r, &LANE_VALUES, k);
        let lines = if l.is_empty() || r.chance(50) { vec![lane_line(&l)] } else { std::iter::once("    lane_order:".to_string()).chain(l.iter().map(|v| format!("      - {}", flow_value(v)))).collect() };
        own.lane_order = Some(l);
        parts.push(Part { kind: "lane_order", lines });
    }
    if r.chance(30) {
        parts.push(Part { kind: "sort", lines: vec!["    sort: { by: title, order: asc }".into()] });
    }
    if r.chance(30) {
        parts.push(Part { kind: "columns", lines: vec!["    columns: [author, rating]".into()] });
    }
    if r.chance(40) {
        let k = 1 + r.below(2);
        let w: Vec<(String, u32)> = distinct(r, &WIDTH_KEYS, k).into_iter().map(|k| (k, 160 + 20 * r.below(10) as u32)).collect();
        let lines = if r.chance(50) { vec![widths_line(&w)] } else { std::iter::once("    widths:".to_string()).chain(w.iter().map(|(k, v)| format!("      {k}: {v}"))).collect() };
        own.widths = Some(w);
        parts.push(Part { kind: "widths", lines });
    }
    // Known keys in a random order, then maybe a full-line comment somewhere among them, then the unknown key last.
    for i in (1..parts.len()).rev() {
        let j = r.below(i + 1);
        parts.swap(i, j);
    }
    if r.chance(30) {
        let at = r.below(parts.len() + 1);
        parts.insert(at, Part { kind: "comment", lines: vec!["    # ruční poznámka".into()] });
    }
    parts.push(Part { kind: "unknown", lines: vec!["    x-barva: modrá".into()] });
    Item { name: name.to_string(), parts, own }
}
fn distinct(r: &mut Rng, from: &[&str], n: usize) -> Vec<String> {
    let mut pool: Vec<&str> = from.to_vec();
    (0..n).map(|_| pool.remove(r.below(pool.len())).to_string()).collect()
}
fn render(items: &[Item], nl: &str) -> String {
    let mut views = String::from("views:");
    for it in items {
        views.push_str("\n");
        views.push_str(&format!("  - name: {}", it.name));
        for p in &it.parts {
            for l in &p.lines {
                views.push_str("\n");
                views.push_str(l);
            }
        }
    }
    let text = base().replacen(LINE13, &format!("{views}\n"), 1);
    if nl == "\r\n" { text.replace('\n', "\r\n") } else { text }
}

enum Op {
    View(Option<UsageView>),
    Group(Option<UsageGroupBy>),
    Lanes(Option<UsageLanes>),
    LaneOrder(Option<Vec<String>>),
    Widths(Option<Vec<(String, u32)>>),
}
fn gen_op(r: &mut Rng) -> Op {
    let none = r.chance(20);
    match r.below(5) {
        0 => Op::View(if none { None } else { Some(*r.pick(&[UsageView::List, UsageView::Table, UsageView::Wall])) }),
        1 => Op::Group(if none { None } else if r.chance(25) { Some(UsageGroupBy::None) } else { Some(UsageGroupBy::Key(r.pick(&GROUP_KEYS).to_string())) }),
        2 => Op::Lanes(if none { None } else { Some(*r.pick(&[UsageLanes::Columns, UsageLanes::Rows])) }),
        3 => {
            let k = r.below(3);
            Op::LaneOrder(if none { None } else { Some(distinct(r, &LANE_VALUES, k)) })
        }
        _ => {
            let k = 1 + r.below(2);
            Op::Widths(if none { None } else { Some(distinct(r, &WIDTH_KEYS, k).into_iter().map(|k| (k, 160 + 20 * r.below(10) as u32)).collect()) })
        }
    }
}
fn type_op(name: &str, op: &Op) -> TypeOp {
    let name = name.to_string();
    match op {
        Op::View(v) => TypeOp::SetViewDisplay { name, view: *v },
        Op::Group(g) => TypeOp::SetViewGroup { name, group_by: g.clone() },
        Op::Lanes(l) => TypeOp::SetViewLanes { name, lanes: *l },
        Op::LaneOrder(l) => TypeOp::SetViewLaneOrder { name, lane_order: l.clone() },
        Op::Widths(w) => TypeOp::SetViewWidths { name, widths: w.clone() },
    }
}
/// R221 / CP-35 on the model: (the item after the op, whether anything changed).
fn apply_model(it: &Item, op: &Op) -> (Item, bool) {
    let mut out = it.clone();
    let mut changed = false;
    let mut set = |out: &mut Item, kind: &'static str, line: Option<String>, same: bool| {
        let at = out.parts.iter().position(|p| p.kind == kind);
        match (line, at) {
            (None, Some(i)) => {
                out.parts.remove(i);
                changed = true;
            }
            (None, None) => {}
            (Some(_), Some(_)) if same => {}
            (Some(l), Some(i)) => {
                let old = &out.parts[i].lines;
                let comment = if old.len() == 1 { old[0].find(" #").map(|h| old[0][old[0][..=h].trim_end().len()..].to_string()).unwrap_or_default() } else { String::new() };
                out.parts[i].lines = vec![format!("{l}{comment}")];
                changed = true;
            }
            (Some(l), None) => {
                let rank = ORDER.iter().position(|k| *k == kind).unwrap_or(0);
                let mut after: Option<usize> = None;
                for k in ORDER[..rank].iter().rev() {
                    if let Some(j) = out.parts.iter().position(|p| p.kind == *k) {
                        after = Some(j);
                        break;
                    }
                }
                out.parts.insert(after.map(|j| j + 1).unwrap_or(0), Part { kind, lines: vec![l] });
                changed = true;
            }
        }
    };
    match op {
        Op::View(v) => {
            let same = *v == it.own.view;
            set(&mut out, "view", v.map(|v| format!("    view: {}", view_word(v))), same);
            out.own.view = *v;
        }
        Op::Group(Some(g)) => {
            let same = Some(g) == it.own.group.as_ref();
            set(&mut out, "group_by", Some(group_line(g)), same);
            out.own.group = Some(g.clone());
        }
        Op::Group(None) => {
            for k in ["group_by", "lanes", "lane_order"] {
                set(&mut out, k, None, false);
            }
            out.own.group = None;
            out.own.lanes = None;
            out.own.lane_order = None;
        }
        Op::Lanes(l) => {
            let same = *l == it.own.lanes;
            set(&mut out, "lanes", l.map(|l| format!("    lanes: {}", if l == UsageLanes::Columns { "columns" } else { "rows" })), same);
            out.own.lanes = *l;
        }
        Op::LaneOrder(l) => {
            let same = l.as_ref() == it.own.lane_order.as_ref();
            set(&mut out, "lane_order", l.as_ref().map(|l| lane_line(l)), same);
            out.own.lane_order = l.clone();
        }
        Op::Widths(w) => {
            let same = matches!((w, &it.own.widths), (Some(a), Some(b)) if same_widths(a, b));
            set(&mut out, "widths", w.as_ref().map(|w| widths_line(w)), same);
            out.own.widths = w.clone();
        }
    }
    // A changed item loses its full-line comments (D-1840, D-2200).
    if changed {
        out.parts.retain(|p| p.kind != "comment");
    }
    (out, changed)
}

fn own_of(i: &ViewItem) -> Own {
    let v = |x: &UsageValue<UsageView>| if let UsageValue::Set(v) = x { Some(*v) } else { None };
    Own {
        view: v(&i.view),
        group: if let UsageValue::Set(g) = &i.group_by { Some(g.clone()) } else { None },
        lanes: if let UsageValue::Set(l) = &i.lanes { Some(*l) } else { None },
        lane_order: if let UsageValue::Set(l) = &i.lane_order { Some(l.clone()) } else { None },
        widths: if let UsageValue::Set(w) = &i.widths { Some(w.clone()) } else { None },
    }
}

#[test]
fn fr_fmt_07_ac37_display_keys_round_trip() {
    let scale: u64 = std::env::var("QA_PROPERTY_SCALE").ok().and_then(|s| s.parse().ok()).unwrap_or(1);
    let random: u64 = std::env::var("QA_SEED").ok().and_then(|s| s.parse().ok()).unwrap_or_else(|| std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(7) % (1 << 31));
    let seeds: Vec<u64> = if scale >= 100 { (0..10).map(|i| if i == 0 { 20261123 } else { random + i }).collect() } else { vec![20261123, random] };
    let runs = if scale >= 100 { 1000 } else { 150 };
    println!("display keys property: {}", seeds.iter().map(|s| format!("seed = {s}")).collect::<Vec<_>>().join(", "));
    let mut fails: Vec<String> = Vec::new();
    for &seed in &seeds {
        for run in 0..runs {
            if fails.len() >= 5 {
                break;
            }
            let mut r = Rng((seed.wrapping_mul(7919).wrapping_add(run)) | 1);
            let nl = if r.chance(30) { "\r\n" } else { "\n" };
            let n = 1 + r.below(4);
            let names = distinct(&mut r, &ITEM_NAMES, n);
            let items: Vec<Item> = names.iter().map(|nm| gen_item(&mut r, nm)).collect();
            let text = render(&items, nl);
            // The input parses to the generated values.
            let parsed = parse("book", &text).view_items.unwrap_or_default();
            let got_own: Vec<Own> = parsed.iter().map(own_of).collect();
            let want_own: Vec<Own> = items.iter().map(|i| i.own.clone()).collect();
            if got_own != want_own {
                fails.push(format!("seed {seed} run {run}: reads {got_own:?}, want {want_own:?}\n{text}"));
                continue;
            }
            let t = r.below(items.len());
            let op = gen_op(&mut r);
            let (after, changed) = apply_model(&items[t], &op);
            let mut want_items = items.clone();
            want_items[t] = after.clone();
            let want = if changed { Some(render(&want_items, nl)) } else { None };
            match do_patch(&text, vec![type_op(&items[t].name, &op)]) {
                Ok(got) if got == want => {
                    if let Some(g) = got {
                        let back: Vec<Own> = parse("book", &g).view_items.unwrap_or_default().iter().map(own_of).collect();
                        let w: Vec<Own> = want_items.iter().map(|i| i.own.clone()).collect();
                        if back != w {
                            fails.push(format!("seed {seed} run {run}: reads back {back:?}, want {w:?}"));
                        }
                    }
                }
                other => fails.push(format!("seed {seed} run {run}: item {} op {:?}\n--- input\n{text}\n--- want\n{want:?}\n--- got\n{other:?}", items[t].name, type_op(&items[t].name, &op))),
            }
        }
    }
    assert_eq!(fails, Vec::<String>::new(), "only the changed key's lines of one item change; a no-op writes nothing");
}
