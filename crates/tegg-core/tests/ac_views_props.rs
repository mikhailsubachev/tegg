//! Slice Q2 L2 (docs/acceptance/views.md FR-QRY-01 AC-8, the oracle part; docs/contracts/v1-views.md §1.2, §1.6): random
//! `sort` lists of 1…4 levels over every kind of Book's sort keys (title, created, modified, a Select with unknown values,
//! a second Select, a date), written as query files (one level as R138's single mapping, more as a block list), and
//! random books with empty values and ties: `Core::query_run` on the saved file equals a brute-force order (level by
//! level; empty values last at every level in both orders; `desc` reverses only the non-empty comparison; Select by
//! option order, then unknown values by collation after the options; ties after the last level by title, then path).
//! Titles and unknown values are ASCII without `ch`, so the `cs` collation equals the byte order here. Seeds as TS-L2: a
//! fixed seed plus `QA_SEED` when set, printed; `QA_PROPERTY_SCALE` ≥ 100 runs 10 seeds × 1,000 cases. The test drives
//! the core through query files only (no `QueryDef` value), so it compiles before and after the build. Written from the
//! AC and the contract only (D-61).

mod common;
mod views_setup;

use std::cmp::Ordering;

use common::{repo_root, sandbox};
use views_setup::*;

const FIXED_SEED: u64 = 20261119;
const STATUS: [&str; 3] = ["To read", "Reading", "Read"];
const RATING: [&str; 3] = ["Excellent", "Good", "Bad"];
const KEYS: [&str; 6] = ["title", "created", "modified", "status", "rating", "finished"];

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
}
#[derive(Clone)]
struct Book {
    title: String,
    created: String,
    modified: String,
    status: Option<String>,
    rating: Option<String>,
    finished: Option<String>,
}
fn path(b: &Book) -> String {
    format!("Books/{}.md", b.title)
}
fn books(r: &mut Rng) -> Vec<Book> {
    let statuses = ["To read", "Reading", "Read", "Xa", "Xb"];
    (0..30)
        .map(|i| Book {
            title: format!("Kniha {:02}", (i * 7) % 30),
            created: format!("2026-0{}-0{}T09:00:00+01:00", 1 + r.int(3), 1 + r.int(3)),
            modified: format!("2026-1{}-0{}T09:00:00+01:00", r.int(2), 1 + r.int(4)),
            status: if r.int(6) == 0 { None } else { Some(statuses[r.int(5)].to_string()) },
            rating: if r.int(4) == 0 { None } else { Some(RATING[r.int(3)].to_string()) },
            finished: if r.int(3) == 0 { None } else { Some(format!("2026-0{}-1{}", 1 + r.int(4), r.int(3))) },
        })
        .collect()
}
fn note(b: &Book) -> String {
    let mut s = format!("---\ntype: book\ntitle: {}\n", b.title);
    if let Some(v) = &b.status {
        s.push_str(&format!("status: {v}\n"));
    }
    if let Some(v) = &b.rating {
        s.push_str(&format!("rating: {v}\n"));
    }
    if let Some(v) = &b.finished {
        s.push_str(&format!("finished: {v}\n"));
    }
    s.push_str(&format!("created: {}\nmodified: {}\n---\nText.\n", b.created, b.modified));
    s
}
fn select_rank(v: &str, options: &[&str]) -> (usize, String) {
    match options.iter().position(|o| *o == v) {
        Some(i) => (i, String::new()),
        None => (options.len(), v.to_string()),
    }
}
/// One level's comparison: empty last in both orders, `desc` reverses only the non-empty comparison.
fn level(a: &Book, b: &Book, key: &str, desc: bool) -> Ordering {
    let val = |x: &Book| -> Option<String> {
        match key {
            "title" => Some(x.title.clone()),
            "created" => Some(x.created.clone()),
            "modified" => Some(x.modified.clone()),
            "status" => x.status.clone(),
            "rating" => x.rating.clone(),
            "finished" => x.finished.clone(),
            _ => None,
        }
    };
    match (val(a), val(b)) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
        (Some(x), Some(y)) => {
            let o = match key {
                "status" => select_rank(&x, &STATUS).cmp(&select_rank(&y, &STATUS)),
                "rating" => select_rank(&x, &RATING).cmp(&select_rank(&y, &RATING)),
                _ => x.cmp(&y),
            };
            if desc {
                o.reverse()
            } else {
                o
            }
        }
    }
}
fn oracle(books: &[Book], levels: &[(String, bool)]) -> Vec<String> {
    let mut seen = std::collections::BTreeSet::new();
    let lv: Vec<(String, bool)> = levels.iter().filter(|(k, _)| seen.insert(k.clone())).cloned().collect();
    let mut v = books.to_vec();
    v.sort_by(|a, b| {
        for (k, d) in &lv {
            let o = level(a, b, k, *d);
            if o != Ordering::Equal {
                return o;
            }
        }
        a.title.cmp(&b.title).then_with(|| path(a).cmp(&path(b)))
    });
    v.iter().map(path).collect()
}
fn sort_text(levels: &[(String, bool)]) -> String {
    let o = |d: bool| if d { "desc" } else { "asc" };
    if levels.len() == 1 {
        format!(" {{ by: {}, order: {} }}", levels[0].0, o(levels[0].1))
    } else {
        levels.iter().map(|(k, d)| format!("\n  - {{ by: {k}, order: {} }}", o(*d))).collect()
    }
}

#[test]
fn fr_qry_01_ac8_multi_level_order() {
    let scale: u64 = std::env::var("QA_PROPERTY_SCALE").ok().and_then(|s| s.parse().ok()).unwrap_or(1);
    let random: u64 = std::env::var("QA_SEED").ok().and_then(|s| s.parse().ok()).unwrap_or(FIXED_SEED + 1);
    let seeds: Vec<u64> = if scale >= 100 { (0..10).map(|i| if i == 0 { FIXED_SEED } else { random + i }).collect() } else { vec![FIXED_SEED, random] };
    let runs = if scale >= 100 { 1000 } else { 40 };
    println!("multi-level sort oracle: {}", seeds.iter().map(|s| format!("seed = {s}")).collect::<Vec<_>>().join(", "));
    let sb = sandbox();
    let root = sb.base.join("Náhodná knihovna");
    let fxv = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fxv.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    write(&root, BOOK, fixture(BOOK).as_bytes());
    let mut failures = Vec::new();
    for seed in seeds {
        let mut r = Rng(seed);
        let bs = books(&mut r);
        let books_dir = root.join("Books");
        let _ = std::fs::remove_dir_all(&books_dir);
        for b in &bs {
            write(&root, &path(b), note(b).as_bytes());
        }
        let core = open(&root, &sb.dirs, false);
        for i in 0..runs {
            let n = 1 + r.int(4);
            let levels: Vec<(String, bool)> = (0..n).map(|_| (KEYS[r.int(KEYS.len())].to_string(), r.int(2) == 1)).collect();
            let name = format!("Náhodné {seed} {i}");
            let text = format!(
                "# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › {name}.\nversion: 1\ntitle: {name}\ntypes: [book]\nmatch: all\nfilters: []\nsort:{}\nlimit: 1000\nview: table\ncolumns: [status]\ncreated: 2026-11-01T09:00:00+01:00\nmodified: 2026-11-01T09:00:00+01:00\n",
                sort_text(&levels)
            );
            write(&root, &qpath(&name), text.as_bytes());
            reread(&core, &[&qpath(&name)]);
            let got = paths(&run(&core, &name, &env()));
            let want = oracle(&bs, &levels);
            if got != want && failures.len() < 3 {
                failures.push(format!("seed {seed}, case {i}, sort {levels:?}:\n  got  {got:?}\n  want {want:?}"));
            }
        }
    }
    assert!(failures.is_empty(), "the evaluator equals the brute-force order for random 1…4-level sorts:\n{}", failures.join("\n"));
}
