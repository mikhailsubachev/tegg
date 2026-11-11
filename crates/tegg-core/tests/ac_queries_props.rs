//! Slice Q L2 property tests (docs/acceptance/queries.md FR-QRY-02 AC-8, FR-FMT-07 AC-29; docs/contracts/v1-queries.md
//! §1.2, §1.4, §1.6):
//! - the index-backed evaluator (`Core::query_run`) returns exactly the set and order of a brute-force evaluation of the
//!   generated files, for random vaults (Czech and NFD values, links, tags, dates with random offsets, trashed and
//!   template files) and random queries (0…2 types, 0…6 filters, one group per level, R139's operators, `this` hosts), in
//!   Europe/Prague, America/New_York and Pacific/Kiritimati;
//! - the query-file patcher (`queries_q::patch`) on random files (comments anywhere, unknown keys at both levels, flow
//!   and block styles, quoting, CRLF, NFD, no final newline) and a random edit keeps every line outside the edited key
//!   (and `modified:`), reads back as the intended definition, and a no-op commit writes nothing.
//! Seeded: a fixed seed plus `QA_SEED`; `QA_PROPERTY_SCALE` ≥ 100 runs 10 seeds × 1,000 runs (TS-L2). Each failure logs
//! its seed and case. Written from the ACs and the contract only (D-61); every check is an assertion in this file.

mod common;
mod queries_setup;

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use chrono::{DateTime, Datelike, Duration as Days, FixedOffset, NaiveDate, TimeZone, Weekday};
use common::sandbox;
use queries_setup::{copy_dir, env_at, f, nfd, plain};
use serde_json::{json, Value};
use tegg_core::queries_q::{self, FileState, FilterItem, Match, Op, Order, QueryDef, QueryEnv, QuerySource, RunState, Sort, View};
use tegg_core::{Core, CoreOptions};
use tegg_format::nfc;

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
    fn pick<'a, T>(&mut self, v: &'a [T]) -> &'a T {
        &v[self.below(v.len())]
    }
}

fn seeds() -> (Vec<u64>, usize) {
    let scale: u64 = std::env::var("QA_PROPERTY_SCALE").ok().and_then(|s| s.parse().ok()).unwrap_or(1);
    let random: u64 = std::env::var("QA_SEED").ok().and_then(|s| s.parse().ok()).unwrap_or(0x2026_1110);
    if scale >= 100 {
        ((0..10).map(|i| if i == 0 { 20261110 } else { random + i }).collect(), 1000)
    } else {
        (vec![20261110, random], 60)
    }
}

// ================================================================================================ FR-QRY-02 AC-8

const VEC_YML: &str = "# Tegg type definition (FR-TYP-01, FR-STO-06, D-90). Edit it in Tegg's type settings.\nversion: 1\nname: Věc\nplural: Věci\nsystem: false\nfolder: Věci\nicon: folder\ncolor: orange\nreview: false\npreview: [stav]\nattributes:\n  - key: stav\n    name: Stav\n    type: select\n    options:\n      - { label: Aktivní, color: green }\n      - { label: Pozastaveno, color: yellow }\n      - { label: Hotovo, color: gray }\n  - key: rozpočet\n    name: Rozpočet\n    type: number\n  - key: hotovo\n    name: Hotovo\n    type: checkbox\n  - key: termín\n    name: Termín\n    type: date\n  - key: poznámka\n    name: Poznámka\n    type: text\n";

const WORDS: &[&str] = &["Čajovna", "rozpočet", "Výjezd", "účetní", "Žluťoučký kůň", "plán", "Šablona", "zápis"];
const STAV: &[Option<&str>] = &[Some("Aktivní"), Some("aktivni"), Some("HOTOVO"), Some("Pozastaveno"), None, Some("")];
const TAGS: &[&str] = &["finance", "q4", "offsite", "účty"];
const OFFSETS: &[i32] = &[3600, -5 * 3600, 14 * 3600, 0, 2 * 3600];

#[derive(Clone, Debug)]
enum Num {
    Int(i64),
}

#[derive(Clone, Debug)]
struct Obj {
    path: String,
    title: String,
    vec: bool,
    where_: u8, // 0 live, 1 trash, 2 template
    stav: Option<String>,
    rozpocet: Option<Num>,
    hotovo: Option<bool>,
    termin: Option<NaiveDate>,
    poznamka: Option<String>,
    tags_fm: Vec<String>,
    tags_inline: Vec<String>,
    created: Option<DateTime<FixedOffset>>,
    links: Vec<usize>,
    nfd_text: bool,
}

fn fold(s: &str) -> String {
    // Lower case first: the helper's `nfd` table holds every lower-case Czech letter but not all upper-case ones (Ý, Ť,
    // Ů, Ň, Ď), so folding `ŽLUŤOUČKÝ KŮŇ` must not depend on it (D-109).
    nfd(&nfc(s).to_lowercase()).chars().filter(|c| !('\u{300}'..='\u{36F}').contains(c)).flat_map(|c| c.to_lowercase()).collect()
}
fn tag_key(s: &str) -> String {
    nfc(s.trim_start_matches('#')).to_lowercase()
}

fn gen_vault(rng: &mut Rng, max: usize) -> Vec<Obj> {
    let n = 1 + rng.below(max);
    let mut objs: Vec<Obj> = Vec::new();
    for i in 0..n {
        let vec = rng.chance(60);
        let where_ = if rng.chance(10) { 1 } else if rng.chance(8) { 2 } else { 0 };
        let word = rng.pick(WORDS).to_string();
        let title = format!("N{i:03} {word}");
        let folder = if vec { "Věci" } else { "Pages" };
        let path = match where_ {
            1 => format!(".trash/{folder}/{title}.md"),
            2 => format!("_templates/{}/{title}.md", if vec { "Věc" } else { "Page" }),
            _ => format!("{folder}/{title}.md"),
        };
        let day = NaiveDate::from_ymd_opt(2026, 11, 1).expect("date") + Days::days(rng.below(30) as i64);
        let created = if rng.chance(85) {
            let off = FixedOffset::east_opt(*rng.pick(OFFSETS)).expect("offset");
            let local = NaiveDate::from_ymd_opt(2026, 11, 8).expect("date").and_hms_opt(0, 0, 0).expect("time") + Days::minutes(rng.below(5 * 24 * 60) as i64);
            off.from_local_datetime(&local).single()
        } else {
            None
        };
        let tags_fm: Vec<String> = TAGS.iter().filter(|_| rng.chance(30)).map(|t| t.to_string()).collect();
        let tags_inline: Vec<String> = if rng.chance(20) { vec![if rng.chance(50) { "#Finance".into() } else { "#Q4".into() }] } else { vec![] };
        objs.push(Obj {
            path,
            title,
            vec,
            where_,
            stav: if vec { rng.pick(STAV).map(String::from) } else { None },
            rozpocet: if vec && rng.chance(75) { Some(Num::Int(rng.below(10_000) as i64)) } else { None }, // strings: FR-QRY-02 AC-5 (L4)
            hotovo: if vec && rng.chance(70) { Some(rng.chance(50)) } else { None },
            termin: if vec && rng.chance(75) { Some(day) } else { None },
            poznamka: if vec && rng.chance(70) { Some(format!("{} {}", rng.pick(WORDS), rng.pick(WORDS))) } else { None },
            tags_fm,
            tags_inline,
            created,
            links: Vec::new(),
            nfd_text: rng.chance(25),
        });
    }
    let live: Vec<usize> = (0..n).filter(|i| objs[*i].where_ == 0).collect();
    for (i, o) in objs.iter_mut().enumerate() {
        if !live.is_empty() {
            for _ in 0..rng.below(3) {
                let t = live[rng.below(live.len())];
                if t != i {
                    o.links.push(t); // no self-links
                }
            }
        }
    }
    objs
}

fn text_of(o: &Obj, all: &[Obj]) -> String {
    let t = |s: &str| if o.nfd_text { nfd(s) } else { s.to_string() };
    let mut fm = vec!["---".to_string()];
    if o.vec {
        fm.push("type: věc".into());
    } else if o.created.is_some() {
        fm.push("type: page".into());
    }
    fm.push(format!("title: {}", t(&o.title)));
    if let Some(s) = &o.stav {
        fm.push(if s.is_empty() { "stav: \"\"".into() } else { format!("stav: {}", t(s)) });
    }
    match &o.rozpocet {
        Some(Num::Int(n)) => fm.push(format!("rozpočet: {n}")),
        None => {}
    }
    if let Some(h) = o.hotovo {
        fm.push(format!("hotovo: {h}"));
    }
    if let Some(d) = o.termin {
        fm.push(format!("termín: {}", d.format("%Y-%m-%d")));
    }
    if let Some(p) = &o.poznamka {
        fm.push(format!("poznámka: {}", t(p)));
    }
    if !o.tags_fm.is_empty() {
        fm.push(format!("tags: [{}]", o.tags_fm.join(", ")));
    }
    if let Some(c) = o.created {
        fm.push(format!("created: {}", c.to_rfc3339()));
    }
    fm.push("---".into());
    let mut body = String::from("Text.\n");
    for l in &o.links {
        body.push_str(&format!("Odkaz na [[{}]].\n", t(&all[*l].title)));
    }
    for tg in &o.tags_inline {
        body.push_str(&format!("{tg}\n"));
    }
    fm.join("\n") + "\n" + &body
}

/// One generated filter: the item and whether its key is an attribute of the chosen types.
fn gen_filter(rng: &mut Rng, objs: &[Obj], types: &[&str], host: Option<usize>) -> FilterItem {
    let only_vec = types == ["věc"];
    let live: Vec<usize> = (0..objs.len()).filter(|i| objs[*i].where_ == 0).collect();
    let target = |rng: &mut Rng| -> Value {
        if host.is_some() && rng.chance(35) || live.is_empty() {
            json!("this")
        } else {
            let o = &objs[live[rng.below(live.len())]];
            json!(format!("[[{}]]", if rng.chance(20) { nfd(&o.title) } else { o.title.clone() }))
        }
    };
    let date = |rng: &mut Rng| format!("2026-11-{:02}", 1 + rng.below(30));
    let k = rng.below(if only_vec { 11 } else { 6 });
    match k {
        0 => f("links_to", Op::Is, target(rng)),
        1 => f("linked_from", Op::Is, target(rng)),
        2 => match rng.below(4) {
            0 => f("title", Op::Contains, json!(fold(rng.pick(WORDS)).to_uppercase())),
            1 => f("title", Op::Is, json!(objs[rng.below(objs.len())].title.to_lowercase())),
            2 => f("title", Op::IsNot, json!(objs[rng.below(objs.len())].title.clone())),
            _ => f("title", Op::IsEmpty, json!(true)),
        },
        3 => {
            let mut v: Vec<String> = Vec::new();
            for t in TAGS {
                if rng.chance(40) {
                    v.push(if rng.chance(30) { format!("#{t}") } else { t.to_string() });
                }
            }
            let v = if v.is_empty() { vec!["finance".to_string()] } else { v };
            f("tags", *rng.pick(&[Op::HasAnyOf, Op::HasAllOf, Op::HasNoneOf]), json!(v))
        }
        4 => match rng.below(4) {
            0 => f("created", Op::Is, json!(date(rng))),
            1 => f("created", Op::Before, json!(date(rng))),
            2 => f("created", Op::After, json!(date(rng))),
            _ => {
                let (a, b) = (date(rng), date(rng));
                f("created", Op::Between, json!([a.clone().min(b.clone()), a.max(b)]))
            }
        },
        5 => f("neznámý", Op::Is, json!("x")), // not an attribute: ignored as if absent
        6 => match rng.below(5) {
            0 => f("stav", Op::Is, json!(rng.pick(&["aktivní", "HOTOVO", "Pozastaveno"]).to_string())),
            1 => f("stav", Op::IsNot, json!("Aktivní")),
            2 => f("stav", Op::IsAnyOf, json!(["Hotovo", "pozastaveno"])),
            3 => f("stav", Op::IsEmpty, json!(true)),
            _ => f("stav", Op::IsNotEmpty, json!(true)),
        },
        7 => {
            let n = rng.below(10_000) as i64;
            match rng.below(5) {
                0 => f("rozpočet", Op::Eq, json!(n)),
                1 => f("rozpočet", Op::Ne, json!(n)),
                2 => f("rozpočet", Op::Lt, json!(n)),
                3 => f("rozpočet", Op::Gt, json!(n)),
                _ => f("rozpočet", Op::Between, json!([n / 2, n])),
            }
        }
        8 => f("hotovo", Op::Is, json!(rng.chance(50))),
        9 => match rng.below(8) {
            0 => f("termín", Op::Is, json!(date(rng))),
            1 => f("termín", Op::Before, json!(date(rng))),
            2 => f("termín", Op::After, json!(date(rng))),
            3 => f("termín", Op::Today, json!(true)),
            4 => f("termín", Op::ThisWeek, json!(true)),
            5 => f("termín", Op::WithinNextDays, json!(rng.below(15))),
            6 => f("termín", Op::Overdue, json!(true)),
            _ => f("termín", Op::IsEmpty, json!(true)),
        },
        _ => match rng.below(3) {
            0 => f("poznámka", Op::Contains, json!(nfd(&rng.pick(WORDS).to_uppercase()))),
            1 => f("poznámka", Op::Is, json!(format!("{} {}", rng.pick(WORDS), rng.pick(WORDS)))),
            _ => f("poznámka", Op::IsEmpty, json!(true)),
        },
    }
}

struct Ctx<'a> {
    objs: &'a [Obj],
    host: Option<usize>,
    env: &'a QueryEnv,
    links: BTreeMap<usize, BTreeSet<usize>>, // resolved body links of live objects
}

fn title_index(objs: &[Obj], v: &str) -> Option<usize> {
    let inner = v.strip_prefix("[[")?.strip_suffix("]]")?;
    objs.iter().position(|o| o.where_ == 0 && nfc(&o.title) == nfc(inner))
}
fn local_date(c: &DateTime<FixedOffset>, tz: &chrono_tz::Tz) -> NaiveDate {
    c.with_timezone(tz).date_naive()
}
fn week_of(today: NaiveDate, start: Weekday) -> (NaiveDate, NaiveDate) {
    let back = (today.weekday().num_days_from_monday() as i64 - start.num_days_from_monday() as i64).rem_euclid(7);
    let s = today - Days::days(back);
    (s, s + Days::days(6))
}
fn parse_date(v: &Value) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(v.as_str()?, "%Y-%m-%d").ok()
}
fn uses_this(i: &FilterItem) -> bool {
    match i {
        FilterItem::Filter { value, key, .. } => value == &json!("this") && key != "neznámý",
        FilterItem::Group { filters, .. } => filters.iter().any(uses_this),
        FilterItem::Raw { .. } => false,
    }
}

/// None: the item is absent (broken); Some(b): whether candidate `c` matches.
fn eval(ctx: &Ctx, i: &FilterItem, c: usize) -> Option<bool> {
    let o = &ctx.objs[c];
    match i {
        FilterItem::Group { r#match, filters, .. } => {
            let rs: Vec<bool> = filters.iter().filter_map(|x| eval(ctx, x, c)).collect();
            if rs.is_empty() {
                None
            } else {
                Some(if *r#match == Match::Any { rs.iter().any(|b| *b) } else { rs.iter().all(|b| *b) })
            }
        }
        FilterItem::Raw { .. } => None,
        FilterItem::Filter { key, op, value, .. } => {
            let target = |v: &Value| -> Option<usize> { if v == &json!("this") { ctx.host } else { title_index(ctx.objs, v.as_str().unwrap_or("")) } };
            Some(match key.as_str() {
                "neznámý" => return None,
                "links_to" => target(value).is_some_and(|t| ctx.links.get(&c).is_some_and(|s| s.contains(&t))),
                "linked_from" => target(value).is_some_and(|t| ctx.links.get(&t).is_some_and(|s| s.contains(&c))),
                "title" | "poznámka" | "stav" => {
                    let x = match key.as_str() {
                        "title" => Some(o.title.clone()),
                        "poznámka" => o.poznamka.clone(),
                        _ => o.stav.clone(),
                    };
                    // R139: Select (`stav`) has `is`, `is not`, `is any of`, `is empty` only; `is_not_empty` on it is a broken
                    // operator, ignored as if absent (D-1442).
                    if key == "stav" && *op == Op::IsNotEmpty {
                        return None;
                    }
                    let empty = x.as_deref().is_none_or(|s| s.trim().is_empty());
                    let fx = x.as_deref().map(fold).unwrap_or_default();
                    match op {
                        Op::Is => !empty && fx == fold(value.as_str().unwrap_or("")),
                        Op::IsNot => !empty && fx != fold(value.as_str().unwrap_or("")),
                        Op::Contains => !empty && fx.contains(&fold(value.as_str().unwrap_or(""))),
                        Op::IsEmpty => empty,
                        Op::IsNotEmpty => !empty,
                        Op::IsAnyOf => !empty && value.as_array().is_some_and(|a| a.iter().any(|v| fold(v.as_str().unwrap_or("")) == fx)),
                        _ => return None,
                    }
                }
                "tags" => {
                    let have: BTreeSet<String> = o.tags_fm.iter().chain(o.tags_inline.iter()).map(|t| tag_key(t)).collect();
                    let want: Vec<String> = value.as_array().map(|a| a.iter().map(|v| tag_key(v.as_str().unwrap_or(""))).collect()).unwrap_or_default();
                    match op {
                        Op::HasAnyOf => want.iter().any(|w| have.contains(w)),
                        Op::HasAllOf => want.iter().all(|w| have.contains(w)),
                        Op::HasNoneOf => !want.iter().any(|w| have.contains(w)),
                        _ => return None,
                    }
                }
                "rozpočet" => {
                    let Some(Num::Int(n)) = &o.rozpocet else { return Some(false) };
                    let n = *n;
                    match op {
                        Op::Eq => value.as_i64() == Some(n),
                        Op::Ne => value.as_i64().is_some_and(|v| v != n),
                        Op::Lt => value.as_i64().is_some_and(|v| n < v),
                        Op::Gt => value.as_i64().is_some_and(|v| n > v),
                        Op::Between => {
                            let a = value[0].as_i64().unwrap_or(i64::MAX);
                            let b = value[1].as_i64().unwrap_or(i64::MIN);
                            a <= n && n <= b
                        }
                        _ => return None,
                    }
                }
                "hotovo" => {
                    if value == &json!(true) {
                        o.hotovo == Some(true)
                    } else {
                        o.hotovo != Some(true)
                    }
                }
                "termín" | "created" => {
                    let d = if key == "created" { o.created.as_ref().map(|c| local_date(c, &ctx.env.tz)) } else { o.termin };
                    let today = ctx.env.today;
                    match op {
                        Op::IsEmpty => d.is_none(),
                        _ => {
                            let Some(d) = d else { return Some(false) };
                            match op {
                                Op::Is => parse_date(value) == Some(d),
                                Op::Before => parse_date(value).is_some_and(|v| d < v),
                                Op::After => parse_date(value).is_some_and(|v| d > v),
                                Op::Between => {
                                    let (a, b) = (parse_date(&value[0]), parse_date(&value[1]));
                                    a.zip(b).is_some_and(|(a, b)| a <= d && d <= b)
                                }
                                Op::Today => d == today,
                                Op::ThisWeek => {
                                    let (s, e) = week_of(today, ctx.env.week_start);
                                    s <= d && d <= e
                                }
                                Op::WithinNextDays => value.as_i64().is_some_and(|n| today <= d && d <= today + Days::days(n)),
                                Op::Overdue => d < today, // not a task: simply before today (D-1440)
                                _ => return None,
                            }
                        }
                    }
                }
                _ => return None,
            })
        }
    }
}

fn oracle(ctx: &Ctx, d: &QueryDef) -> (RunState, Vec<String>) {
    if ctx.host.is_none() && d.filters.iter().any(uses_this) {
        return (RunState::NeedsHost, vec![]);
    }
    let mut hits: Vec<usize> = Vec::new();
    for (c, o) in ctx.objs.iter().enumerate() {
        if o.where_ != 0 || Some(c) == ctx.host {
            continue;
        }
        let t = if o.vec { "věc" } else { "page" };
        if !d.types.is_empty() && !d.types.iter().any(|x| x == t) {
            continue;
        }
        let rs: Vec<bool> = d.filters.iter().filter_map(|i| eval(ctx, i, c)).collect();
        let ok = rs.is_empty() || if d.r#match == Match::Any { rs.iter().any(|b| *b) } else { rs.iter().all(|b| *b) };
        if ok {
            hits.push(c);
        }
    }
    // Sort: by kind, empties last in both orders, ties by title (ascending), then path.
    #[derive(PartialEq, PartialOrd)]
    enum K {
        N(i64),
        D(i64),
        T(String),
    }
    let key = |c: usize| -> Option<K> {
        let o = &ctx.objs[c];
        match d.sort.by.as_str() {
            "title" => Some(K::T(o.title.clone())),
            "created" => o.created.map(|x| K::D(x.timestamp())),
            "rozpočet" => o.rozpocet.as_ref().map(|Num::Int(n)| K::N(*n)),
            "termín" => o.termin.map(|x| K::D(x.num_days_from_ce() as i64)),
            _ => None,
        }
    };
    hits.sort_by(|a, b| {
        let (ka, kb) = (key(*a), key(*b));
        let primary = match (&ka, &kb) {
            (None, None) => std::cmp::Ordering::Equal,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (Some(_), None) => std::cmp::Ordering::Less,
            (Some(x), Some(y)) => {
                let o = x.partial_cmp(y).unwrap_or(std::cmp::Ordering::Equal);
                if d.sort.order == Order::Desc { o.reverse() } else { o }
            }
        };
        primary.then_with(|| ctx.objs[*a].title.cmp(&ctx.objs[*b].title)).then_with(|| nfc(&ctx.objs[*a].path).cmp(&nfc(&ctx.objs[*b].path)))
    });
    (RunState::Ok, hits.into_iter().map(|c| nfc(&ctx.objs[c].path)).collect())
}

fn write_vault(root: &Path, objs: &[Obj]) {
    let fx = common::repo_root().join("tests/fixtures/vaults/new-empty");
    copy_dir(&fx, root, &[]);
    std::fs::write(root.join(".tegg/types/věc.yml"), VEC_YML).expect("setup: věc.yml");
    for o in objs {
        let p = root.join(&o.path);
        std::fs::create_dir_all(p.parent().expect("parent")).expect("setup: dir");
        std::fs::write(&p, text_of(o, objs)).expect("setup: write");
    }
}

fn evaluator_seed(seed: u64, runs: usize) -> Vec<String> {
    let mut rng = Rng(seed | 1);
    let mut bad = Vec::new();
    let max = if runs >= 1000 { 200 } else { 40 };
    let queries_per_vault = 10;
    let mut done = 0usize;
    let mut v = 0usize;
    let mut nonempty = 0usize;
    while done < runs && bad.len() < 10 {
        let sb = sandbox();
        let root = sb.base.join(format!("Náhodný {v}"));
        v += 1;
        let objs = gen_vault(&mut rng, max);
        write_vault(&root, &objs);
        let core = match Core::open(&root, &sb.dirs, CoreOptions { watch: false, sync: None }) {
            Ok(c) => c,
            Err(e) => panic!("setup: Core::open: {e:?}"),
        };
        let _ = core.wait_idle(std::time::Duration::from_secs(60));
        let mut links = BTreeMap::new();
        for (i, o) in objs.iter().enumerate() {
            if o.where_ == 0 {
                links.insert(i, o.links.iter().copied().collect::<BTreeSet<usize>>());
            }
        }
        for q in 0..queries_per_vault {
            done += 1;
            let types: Vec<&str> = match rng.below(4) {
                0 => vec![],
                1 => vec!["věc"],
                2 => vec!["page"],
                _ => vec!["věc", "page"],
            };
            let live: Vec<usize> = (0..objs.len()).filter(|i| objs[*i].where_ == 0).collect();
            let host = if rng.chance(60) && !live.is_empty() { Some(live[rng.below(live.len())]) } else { None };
            let mut filters: Vec<FilterItem> = (0..rng.below(5)).map(|_| gen_filter(&mut rng, &objs, &types, host)).collect();
            if rng.chance(40) {
                let inner: Vec<FilterItem> = (0..1 + rng.below(3)).map(|_| gen_filter(&mut rng, &objs, &types, host)).collect();
                let m = if rng.chance(50) { Match::Any } else { Match::All };
                filters.insert(rng.below(filters.len() + 1), FilterItem::Group { r#match: m, filters: inner, src: None });
            }
            let sort_keys: Vec<&str> = if types == ["věc"] { vec!["title", "created", "rozpočet", "termín"] } else { vec!["title", "created"] };
            let d = QueryDef {
                title: format!("Náhodný dotaz {q}"),
                types: types.iter().map(|s| s.to_string()).collect(),
                r#match: if rng.chance(30) { Match::Any } else { Match::All },
                filters,
                sort: Sort { by: rng.pick(&sort_keys).to_string(), order: if rng.chance(50) { Order::Asc } else { Order::Desc } },
                limit: 50,
                view: View::List,
                columns: vec!["type".into(), "modified".into()],
            };
            let today = format!("2026-11-{:02}", 5 + rng.below(11));
            let ws = if rng.chance(50) { Weekday::Mon } else { Weekday::Sun };
            for zone in ["Europe/Prague", "America/New_York", "Pacific/Kiritimati"] {
                let e = env_at(&today, zone, ws, "cs");
                let ctx = Ctx { objs: &objs, host, env: &e, links: links.clone() };
                let want = oracle(&ctx, &d);
                let host_path = host.map(|h| objs[h].path.clone());
                let r = core.query_run(QuerySource::Def { def: d.clone(), name: None }, host_path.as_deref(), &e);
                let got: Vec<String> = r.rows.iter().map(|x| nfc(&x.path)).collect();
                if !want.1.is_empty() {
                    nonempty += 1;
                }
                if (r.state, got.clone()) != want {
                    bad.push(format!("seed {seed} vault {v} query {q} ({zone}, today {today}, week {ws:?}, host {host_path:?}): got {:?} {got:?}, want {:?} {:?} for {d:?}", r.state, want.0, want.1));
                    break;
                }
            }
            if bad.len() >= 10 {
                break;
            }
        }
    }
    if nonempty * 4 < done {
        bad.push(format!("seed {seed}: only {nonempty} of {done} runs had results (generator too narrow)"));
    }
    bad
}

#[test]
fn fr_qry_02_ac8_evaluator_equals_file_oracle() {
    let (seeds, runs) = seeds();
    println!("query evaluator property: seeds {seeds:?}, {runs} runs each");
    let bad: Vec<String> = seeds.iter().flat_map(|s| evaluator_seed(*s, runs)).take(10).collect();
    assert_eq!(bad, Vec::<String>::new(), "the evaluator equals the brute-force oracle (set and order) in three zones");
}

// ================================================================================================ FR-FMT-07 AC-29

/// One generated line with the top-level key it belongs to (`""` for header lines and comments above a key).
struct Line {
    text: String,
    owner: &'static str,
}

const NOW: &str = "2026-11-10T10:00:00+01:00";

fn gen_query_file(rng: &mut Rng) -> (Vec<Line>, QueryDef) {
    let mut lines: Vec<Line> = Vec::new();
    let push = |lines: &mut Vec<Line>, owner: &'static str, t: String| lines.push(Line { text: t, owner });
    let n = |rng: &mut Rng, s: &str| if rng.chance(25) { nfd(s) } else { s.to_string() };
    let title = format!("{} {}", rng.pick(WORDS), rng.below(100));
    push(&mut lines, "", format!("# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › {title}."));
    if rng.chance(30) {
        push(&mut lines, "", "# Napsáno ručně: komentáře musí přežít.".into());
    }
    if rng.chance(80) {
        push(&mut lines, "version", "version: 1".into());
    }
    let tq = match rng.below(3) {
        0 => format!("'{}'", n(rng, &title)),
        1 => format!("\"{}\"", n(rng, &title)),
        _ => n(rng, &title),
    };
    push(&mut lines, "title", format!("title: {tq}"));
    if rng.chance(40) {
        push(&mut lines, "x-barva", "x-barva: modrá".into());
    }
    let types = if rng.chance(50) { vec!["projekt".to_string()] } else { vec!["projekt".to_string(), "kniha".to_string()] };
    if rng.chance(50) {
        push(&mut lines, "types", format!("types: [{}]", types.join(", ")));
    } else {
        push(&mut lines, "types", "types:".into());
        for t in &types {
            push(&mut lines, "types", format!("  - {t}"));
        }
    }
    let m = if rng.chance(50) { Match::All } else { Match::Any };
    let trail = |rng: &mut Rng| if rng.chance(40) { "            # poznámka na konci".to_string() } else { String::new() };
    push(&mut lines, "match", format!("match: {}{}", if m == Match::Any { "any" } else { "all" }, trail(rng)));
    let mut filters = Vec::new();
    let k = rng.below(4);
    if k == 0 && rng.chance(50) {
        push(&mut lines, "filters", "filters: []".into());
    } else {
        push(&mut lines, "filters", "filters:".into());
        for i in 0..k {
            if rng.chance(30) {
                push(&mut lines, "filters-comment", "  # uvnitř filtrů".into());
            }
            let owner: &'static str = ["item0", "item1", "item2", "item3"][i];
            let (l, item) = match rng.below(4) {
                0 => {
                    let v = n(rng, "Aktivní");
                    (format!("  - stav: {v}"), f("stav", Op::Is, json!("Aktivní")))
                }
                1 => {
                    let x = rng.below(9000) as i64;
                    (format!("  - rozpočet: {{ gt: {x} }}"), f("rozpočet", Op::Gt, json!(x)))
                }
                2 => (format!("  - stav: {{ is_not: {} }}", n(rng, "Hotovo")), f("stav", Op::IsNot, json!("Hotovo"))),
                _ => ("  - tags: { has_any_of: [finance, q4] }".to_string(), f("tags", Op::HasAnyOf, json!(["finance", "q4"]))),
            };
            push(&mut lines, owner, l);
            if rng.chance(30) {
                push(&mut lines, owner, "    x-poznámka: ručně přidáno".into());
            }
            filters.push(item);
        }
    }
    let by = rng.pick(&["title", "modified", "created"]).to_string();
    let order = if rng.chance(50) { Order::Asc } else { Order::Desc };
    let os = if order == Order::Asc { "asc" } else { "desc" };
    if rng.chance(60) {
        push(&mut lines, "sort", format!("sort: {{ by: {by}, order: {os} }}"));
    } else {
        push(&mut lines, "sort", "sort:".into());
        push(&mut lines, "sort", format!("  by: {by}"));
        push(&mut lines, "sort", format!("  order: {os}"));
    }
    let limit = 1 + rng.below(1000) as u32;
    push(&mut lines, "limit", format!("limit: {limit}{}", trail(rng)));
    if rng.chance(40) {
        push(&mut lines, "", "# pohled".into());
    }
    let view = if rng.chance(50) { View::List } else { View::Table };
    push(&mut lines, "view", format!("view: {}{}", if view == View::Table { "table" } else { "list" }, trail(rng)));
    push(&mut lines, "columns", "columns: [stav, modified]".into());
    push(&mut lines, "created", "created: 2026-08-01T09:00:00+02:00".into());
    push(&mut lines, "modified", "modified: 2026-08-01T09:00:00+02:00".into());
    if rng.chance(30) {
        push(&mut lines, "", "# konec".into());
    }
    let d = QueryDef { title: nfc(&title), types, r#match: m, filters, sort: Sort { by, order }, limit, view, columns: vec!["stav".into(), "modified".into()] };
    (lines, d)
}

fn patch_seed(seed: u64, cases: usize) -> Vec<String> {
    let mut rng = Rng(seed | 1);
    let mut bad = Vec::new();
    for case in 0..cases {
        let (lines, want_def) = gen_query_file(&mut rng);
        let nl = if rng.chance(30) { "\r\n" } else { "\n" };
        let final_nl = rng.chance(80);
        let text = lines.iter().map(|l| l.text.as_str()).collect::<Vec<_>>().join(nl) + if final_nl { nl } else { "" };
        let file = queries_q::read(text.as_bytes());
        if file.state != FileState::Ok || plain(&file.def) != want_def {
            bad.push(format!("seed {seed} case {case}: reads as {:?} / {:?}, want {want_def:?} from {text:?}", file.state, plain(&file.def)));
            continue;
        }
        // A no-op commit writes nothing.
        if queries_q::patch(&text, &file, &file.def, NOW) != Ok(None) {
            bad.push(format!("seed {seed} case {case}: a no-op commit changed the bytes of {text:?}"));
            continue;
        }
        let mut d = file.def.clone();
        let items = d.filters.len();
        let edited: Vec<&'static str> = match rng.below(8) {
            0 => {
                d.view = if d.view == View::List { View::Table } else { View::List };
                vec!["view"]
            }
            1 => {
                d.limit = if d.limit == 7 { 8 } else { 7 };
                vec!["limit"]
            }
            2 => {
                d.sort = Sort { by: "title".into(), order: if d.sort.order == Order::Asc && d.sort.by == "title" { Order::Desc } else { Order::Asc } };
                vec!["sort"]
            }
            3 => {
                d.types = if d.types.len() == 1 { vec!["projekt".into(), "osoba".into()] } else { vec!["osoba".into()] };
                vec!["types"]
            }
            4 => {
                d.columns = vec!["modified".into(), "type".into()];
                vec!["columns"]
            }
            5 => {
                d.r#match = if d.r#match == Match::All { Match::Any } else { Match::All };
                vec!["match"]
            }
            6 => {
                d.filters.push(f("rozpočet", Op::Gt, json!(5000)));
                vec!["filters", "filters-comment"]
            }
            _ if items > 0 => {
                d.filters.pop();
                vec!["filters", "filters-comment", ["item0", "item1", "item2", "item3"][items - 1]]
            }
            _ => {
                d.filters.push(f("stav", Op::Is, json!("Hotovo")));
                vec!["filters", "filters-comment"]
            }
        };
        let out = match queries_q::patch(&text, &file, &d, NOW) {
            Ok(Some(t)) => t,
            other => {
                bad.push(format!("seed {seed} case {case}: {edited:?} gave {other:?} for {text:?}"));
                continue;
            }
        };
        let back = queries_q::read(out.as_bytes());
        if plain(&back.def) != plain(&d) {
            bad.push(format!("seed {seed} case {case}: {edited:?} reads back as {:?}, want {:?}\n{out:?}", plain(&back.def), plain(&d)));
            continue;
        }
        if back.modified.as_deref() != Some(NOW) {
            bad.push(format!("seed {seed} case {case}: modified isn't the commit time: {:?}", back.modified));
        }
        let mut after: Vec<&str> = out.split(nl).collect();
        for l in &lines {
            if edited.contains(&l.owner) || l.owner == "modified" {
                continue;
            }
            match after.iter().position(|a| *a == l.text) {
                Some(j) => {
                    after.remove(j);
                }
                None => bad.push(format!("seed {seed} case {case}: {edited:?} changed the line {:?}", l.text)),
            }
        }
        // A replaced one-line key keeps its trailing comment.
        // Full-line comments inside a replaced block are lost by design (D-1436), so only key lines are checked.
        for l in lines.iter().filter(|l| edited.contains(&l.owner) && l.text.contains(" # ") && !l.text.trim_start().starts_with('#')) {
            let tail = &l.text[l.text.find(" # ").map(|i| l.text[..i].trim_end().len()).unwrap_or(0)..];
            if !out.split(nl).any(|o| o.ends_with(tail) && o.starts_with(&l.text[..l.text.find(':').unwrap_or(0)])) {
                bad.push(format!("seed {seed} case {case}: the trailing comment of {:?} is lost", l.text));
            }
        }
        if out.ends_with(nl) != final_nl {
            bad.push(format!("seed {seed} case {case}: the final newline changed"));
        }
        if nl == "\r\n" && out.replace("\r\n", "").contains('\n') {
            bad.push(format!("seed {seed} case {case}: an LF in a CRLF file"));
        }
        if out.contains('\u{301}') && lines.iter().all(|l| !l.text.contains('\u{301}') || edited.contains(&l.owner)) {
            bad.push(format!("seed {seed} case {case}: Tegg wrote NFD"));
        }
        if bad.len() >= 10 {
            break;
        }
    }
    bad
}

#[test]
fn fr_fmt_07_ac29_query_file_minimal_patches_property() {
    let (seeds, _) = seeds();
    let scale: u64 = std::env::var("QA_PROPERTY_SCALE").ok().and_then(|s| s.parse().ok()).unwrap_or(1);
    let cases = if scale >= 100 { 1000 } else { 300 };
    println!("query patch property: seeds {seeds:?}");
    let bad: Vec<String> = seeds.iter().flat_map(|s| patch_seed(*s, cases)).take(10).collect();
    assert_eq!(bad, Vec::<String>::new(), "every line outside the edited key stays, the result reads as the intended query, no-ops write nothing");
}
