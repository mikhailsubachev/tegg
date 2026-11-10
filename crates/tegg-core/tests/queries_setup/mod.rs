//! Setup for the slice Q L4 / L2 tests (docs/acceptance/queries.md; docs/contracts/v1-queries.md §1): the queries
//! fixture in a temporary directory (tests/fixtures/vaults/queries + new-empty/.tegg), the test clock (R138's
//! `2026-11-10T10:00:00+01:00`, Europe/Prague, region `cs`), definition builders, the expected bytes of
//! tests/fixtures/queries-files/ and file probes. No AC assertions here: a panic in this module is a setup failure, never
//! a red test (tools/qa CONTRACT §5.2).
#![allow(dead_code)]

use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::{NaiveDate, Weekday};
use serde_json::{json, Value};

use crate::common::{repo_root, Sandbox};
use tegg_core::queries_q::{FilterItem, Match, Op, Order, QueryDef, QueryEnv, QueryResult, Sort, View};
use tegg_core::{Core, CoreOptions};

pub const NOW: &str = "2026-11-10T10:00:00+01:00";
pub const Q: &str = ".tegg/queries";

// Objects (queries.md fixture table).
pub const P7: &str = "Schůzky/2026-10-07 Týdenní porada.md";
pub const P14: &str = "Schůzky/2026-10-14 Týdenní porada.md";
pub const T1: &str = "Tasks/Poslat návrh rozpočtu Janě.md";
pub const T2: &str = "Tasks/Zarezervovat místo v Lisabonu.md";
pub const T3: &str = "Tasks/Připravit program výjezdu.md";
pub const T4: &str = "Tasks/Zeptat se Jany na limit cest.md";
pub const T5: &str = "Tasks/Uzavřít zápis z porady.md";
pub const T6: &str = "Tasks/Úkol z druhé porady.md";
pub const T7: &str = "Tasks/Zaplatit zálohu.md";
pub const SMAZANY: &str = ".trash/Tasks/Smazaný úkol.md";
pub const LISABON: &str = "Projekty/Výjezd Lisabon 2026.md";
pub const ROZPOCET: &str = "Projekty/Rozpočet Q4.md";
pub const CAJOVNA: &str = "Projekty/Čajovna na nábřeží.md";
pub const CESTA: &str = "Projekty/Cesta do Brna.md";
pub const MALY: &str = "Projekty/Malý projekt.md";
pub const JANA: &str = "Osoby/Jana Nováková.md";
pub const MLOCI: &str = "Knihy/Válka s mloky.md";
pub const KRAKATIT: &str = "Knihy/Krakatit.md";
pub const DOTAZ: &str = "Quick Notes/Dotaz na rozpočet.md";
pub const DEN: &str = "Daily/2026-11-10.md";
pub const PREHLED: &str = "Pages/Přehled dotazů.md";
pub const BEZ: &str = "Pages/Bez hlavičky.md";
pub const SABLONA: &str = "_templates/Schůzka/Schůzka.md";

// Query names (file stems).
pub const OTEVRENE: &str = "Otevřené úkoly z této schůzky";
pub const UKOLY: &str = "Úkoly z této schůzky";
pub const VSE: &str = "Vše, co sem odkazuje";
pub const PROJEKTY: &str = "Projekty v běhu";
pub const KNIHY: &str = "Knihy s hodnocením";
pub const ZRUSENE: &str = "Zrušené úkoly";
pub const PO_TERMINU: &str = "Úkoly po termínu";
pub const VYTVORENO: &str = "Vytvořeno v tento den";
pub const KOMENTARE: &str = "Komentáře a neznámé klíče";
pub const NECITELNY: &str = "Nečitelný";
pub const NOVEJSI: &str = "Novější verze";
pub const STARY: &str = "Starý dotaz";

pub const ALL_TASKS: [&str; 7] = [T1, T2, T3, T4, T5, T6, T7];

pub fn qpath(name: &str) -> String {
    format!("{Q}/{name}.yml")
}
pub fn trashed_qpath(name: &str) -> String {
    format!(".trash/{Q}/{name}.yml")
}

// ------------------------------------------------------------------------------------------------ files

pub fn copy_dir(from: &Path, to: &Path, skip: &[&str]) {
    std::fs::create_dir_all(to).expect("setup: create dir");
    for e in std::fs::read_dir(from).expect("setup: read_dir") {
        let e = e.expect("setup: entry");
        if skip.iter().any(|s| e.file_name() == std::ffi::OsStr::new(s)) {
            continue;
        }
        if e.file_type().expect("setup: type").is_dir() {
            copy_dir(&e.path(), &to.join(e.file_name()), &[]);
        } else {
            std::fs::copy(e.path(), to.join(e.file_name())).expect("setup: copy");
        }
    }
}
/// The queries fixture in `<sandbox>/<name>` (without its README) with new-empty's `.tegg/` copied in.
pub fn vault_named(sb: &Sandbox, name: &str) -> PathBuf {
    let root = sb.base.join(name);
    let fxv = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fxv.join("queries"), &root, &["README.md"]);
    copy_dir(&fxv.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    root
}
pub fn vault(sb: &Sandbox) -> PathBuf {
    vault_named(sb, "Dotazy")
}
pub fn open(root: &Path, dirs: &tegg_core::AppDirs) -> Core {
    open_with(root, dirs, false)
}
pub fn open_with(root: &Path, dirs: &tegg_core::AppDirs, watch: bool) -> Core {
    let core = match Core::open(root, dirs, CoreOptions { watch, sync: None }) {
        Ok(c) => c,
        Err(e) => panic!("setup: Core::open: {e:?}"),
    };
    let _ = core.wait_idle(Duration::from_secs(60));
    core
}
/// A fixture file's bytes (vault-relative).
pub fn fixture(rel: &str) -> Vec<u8> {
    std::fs::read(repo_root().join("tests/fixtures/vaults/queries").join(rel)).unwrap_or_else(|e| panic!("setup: fixture {rel}: {e}"))
}
pub fn fixture_s(rel: &str) -> String {
    String::from_utf8(fixture(rel)).expect("setup: fixture is UTF-8")
}
/// A query file of the fixture by name.
pub fn qfixture(name: &str) -> String {
    fixture_s(&qpath(name))
}
/// tests/fixtures/queries-files/<rel>.
pub fn expected(rel: &str) -> String {
    let p = repo_root().join("tests/fixtures/queries-files").join(rel);
    String::from_utf8(std::fs::read(&p).unwrap_or_else(|e| panic!("setup: {rel}: {e}"))).expect("setup: UTF-8")
}
pub fn expected_json() -> Value {
    serde_json::from_str(&expected("expected.json")).expect("setup: expected.json parses")
}
pub fn write(root: &Path, rel: &str, bytes: &[u8]) {
    let p = root.join(rel);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).expect("setup: create parent");
    }
    std::fs::write(&p, bytes).expect("setup: write");
}
pub fn disk(root: &Path, rel: &str) -> Option<Vec<u8>> {
    std::fs::read(root.join(rel)).ok()
}
pub fn disk_s(root: &Path, rel: &str) -> Option<String> {
    disk(root, rel).map(|b| String::from_utf8_lossy(&b).into_owned())
}
/// Bytes, mtime (ns) and inode: "untouched" (queries.md shared definitions).
pub fn stamp(root: &Path, rel: &str) -> Option<(Vec<u8>, i128, u64)> {
    let p = root.join(rel);
    let md = std::fs::metadata(&p).ok()?;
    let bytes = std::fs::read(&p).ok()?;
    Some((bytes, md.mtime() as i128 * 1_000_000_000 + md.mtime_nsec() as i128, md.ino()))
}
pub fn reread(core: &Core, paths: &[&str]) {
    core.notify_changed(&paths.iter().map(|p| p.to_string()).collect::<Vec<_>>());
    let _ = core.wait_idle(Duration::from_secs(30));
}
/// Writes `bytes` outside Tegg and tells the core (as the watcher would).
pub fn external(core: &Core, root: &Path, rel: &str, bytes: &[u8]) {
    write(root, rel, bytes);
    reread(core, &[rel]);
}
pub fn crlf(text: &str) -> String {
    text.replace('\n', "\r\n")
}
/// The fixture text of `rel` with each pair swapped once (each `from` must be in the text).
pub fn swapped(text: &str, pairs: &[(&str, &str)]) -> String {
    let mut t = text.to_string();
    for (a, b) in pairs {
        if !t.contains(a) {
            panic!("setup: {a:?} not in the text");
        }
        t = t.replacen(a, b, 1);
    }
    t
}
/// The NFD spelling of the fixtures' Czech letters (the test crate has no Unicode tables).
pub fn nfd(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        let (base, mark) = match c {
            'á' => ('a', '\u{301}'), 'é' => ('e', '\u{301}'), 'í' => ('i', '\u{301}'), 'ó' => ('o', '\u{301}'), 'ú' => ('u', '\u{301}'),
            'ý' => ('y', '\u{301}'), 'č' => ('c', '\u{30C}'), 'ď' => ('d', '\u{30C}'), 'ě' => ('e', '\u{30C}'), 'ň' => ('n', '\u{30C}'),
            'ř' => ('r', '\u{30C}'), 'š' => ('s', '\u{30C}'), 'ť' => ('t', '\u{30C}'), 'ž' => ('z', '\u{30C}'), 'ů' => ('u', '\u{30A}'),
            'Č' => ('C', '\u{30C}'), 'Š' => ('S', '\u{30C}'), 'Ž' => ('Z', '\u{30C}'), 'Ř' => ('R', '\u{30C}'), 'Ú' => ('U', '\u{301}'),
            'É' => ('E', '\u{301}'), 'Á' => ('A', '\u{301}'), 'Í' => ('I', '\u{301}'), 'Ě' => ('E', '\u{30C}'),
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

// ------------------------------------------------------------------------------------------------ the test clock

pub fn env_at(today: &str, zone: &str, week_start: Weekday, locale: &str) -> QueryEnv {
    QueryEnv {
        today: NaiveDate::parse_from_str(today, "%Y-%m-%d").expect("setup: date"),
        tz: zone.parse().expect("setup: zone"),
        week_start,
        locale: locale.to_string(),
    }
}
/// The test clock: Tuesday 2026-11-10, Europe/Prague, `cs` (week Monday–Sunday).
pub fn env() -> QueryEnv {
    env_at("2026-11-10", "Europe/Prague", Weekday::Mon, "cs")
}
/// `(C)`: region `en-US` (week Sunday–Saturday).
pub fn env_us() -> QueryEnv {
    env_at("2026-11-10", "Europe/Prague", Weekday::Sun, "en-US")
}
/// `(Z)`: the machine zone at the same instant (2026-11-10T09:00Z is still 10 Nov in both zones).
pub fn env_zone(zone: &str) -> QueryEnv {
    env_at("2026-11-10", zone, Weekday::Mon, "cs")
}
/// expected.json's `env` (QueryEnvDto: today, zone, weekStart ISO 1…7, locale).
pub fn env_of(v: &Value) -> QueryEnv {
    let ws = match v["weekStart"].as_u64().unwrap_or(1) {
        1 => Weekday::Mon,
        2 => Weekday::Tue,
        3 => Weekday::Wed,
        4 => Weekday::Thu,
        5 => Weekday::Fri,
        6 => Weekday::Sat,
        _ => Weekday::Sun,
    };
    env_at(v["today"].as_str().unwrap_or(""), v["zone"].as_str().unwrap_or(""), ws, v["locale"].as_str().unwrap_or(""))
}

// ------------------------------------------------------------------------------------------------ definitions

pub fn f(key: &str, op: Op, value: Value) -> FilterItem {
    FilterItem::Filter { key: key.to_string(), op, value, src: None }
}
pub fn group(m: Match, filters: Vec<FilterItem>) -> FilterItem {
    FilterItem::Group { r#match: m, filters, src: None }
}
pub fn def(types: &[&str], filters: Vec<FilterItem>) -> QueryDef {
    QueryDef {
        title: "Dotaz".into(),
        types: types.iter().map(|s| s.to_string()).collect(),
        r#match: Match::All,
        filters,
        sort: Sort { by: "modified".into(), order: Order::Desc },
        limit: 50,
        view: View::List,
        columns: vec!["type".into(), "modified".into()],
    }
}
pub fn sorted(mut d: QueryDef, by: &str, order: Order) -> QueryDef {
    d.sort = Sort { by: by.into(), order };
    d
}
/// The definition with every `src` dropped (what the file says, not where it came from).
pub fn plain(d: &QueryDef) -> QueryDef {
    fn strip(items: &[FilterItem]) -> Vec<FilterItem> {
        items
            .iter()
            .map(|i| match i {
                FilterItem::Filter { key, op, value, .. } => FilterItem::Filter { key: key.clone(), op: *op, value: value.clone(), src: None },
                FilterItem::Group { r#match, filters, .. } => FilterItem::Group { r#match: *r#match, filters: strip(filters), src: None },
                FilterItem::Raw { src } => FilterItem::Raw { src: src.clone() },
            })
            .collect()
    }
    let mut d = d.clone();
    d.filters = strip(&d.filters);
    d
}
pub fn paths(r: &QueryResult) -> Vec<String> {
    r.rows.iter().map(|x| tegg_format::nfc(&x.path)).collect()
}
pub fn set(v: &[&str]) -> std::collections::BTreeSet<String> {
    v.iter().map(|s| s.to_string()).collect()
}
pub fn path_set(r: &QueryResult) -> std::collections::BTreeSet<String> {
    paths(r).into_iter().collect()
}
pub fn strs(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

// ------------------------------------------------------------------------------------------------ DTO shapes (expected.json)

pub fn op_name(op: Op) -> &'static str {
    match op {
        Op::Is => "is",
        Op::IsNot => "is_not",
        Op::Contains => "contains",
        Op::IsEmpty => "is_empty",
        Op::IsNotEmpty => "is_not_empty",
        Op::IsAnyOf => "is_any_of",
        Op::HasAnyOf => "has_any_of",
        Op::HasAllOf => "has_all_of",
        Op::HasNoneOf => "has_none_of",
        Op::Before => "before",
        Op::After => "after",
        Op::Between => "between",
        Op::Today => "today",
        Op::ThisWeek => "this_week",
        Op::WithinNextDays => "within_next_days",
        Op::Overdue => "overdue",
        Op::Eq => "eq",
        Op::Ne => "ne",
        Op::Lt => "lt",
        Op::Gt => "gt",
        Op::LinksTo => "links_to",
    }
}
pub fn item_dto(i: &FilterItem) -> Value {
    match i {
        FilterItem::Filter { key, op, value, src } => json!({ "kind": "filter", "key": key, "op": op_name(*op), "value": value, "src": src }),
        FilterItem::Group { r#match, filters, src } => json!({
            "kind": "group",
            "match": if *r#match == Match::Any { "any" } else { "all" },
            "filters": filters.iter().map(item_dto).collect::<Vec<_>>(),
            "src": src,
        }),
        FilterItem::Raw { src } => json!({ "kind": "raw", "src": src }),
    }
}
pub fn def_dto(d: &QueryDef) -> Value {
    json!({
        "title": d.title,
        "types": d.types,
        "match": if d.r#match == Match::Any { "any" } else { "all" },
        "filters": d.filters.iter().map(item_dto).collect::<Vec<_>>(),
        "sort": { "by": d.sort.by, "order": if d.sort.order == Order::Desc { "desc" } else { "asc" } },
        "limit": d.limit,
        "view": if d.view == View::Table { "table" } else { "list" },
        "columns": d.columns,
    })
}
pub fn broken_dto(b: &tegg_core::queries_q::Broken) -> Value {
    use tegg_core::queries_q::BrokenReason as R;
    let reason = match b.reason {
        R::BadValue => "badValue",
        R::Shape => "shape",
        R::Operator => "operator",
        R::NestedGroup => "nestedGroup",
        R::NotAttribute => "notAttribute",
        R::OperatorKind => "operatorKind",
        R::Value => "value",
        R::NoType => "noType",
    };
    json!({ "reason": reason, "at": b.at, "key": b.key, "type": b.r#type })
}

/// The pins file header Tegg writes (v1-pinned §1), with `items` as its `pins:` list.
pub fn pins_file(items: &[&str]) -> String {
    let mut s = String::from("# Tegg sidebar pins (FR-HOM-02). Pin, unpin and reorder them in the sidebar.\nversion: 1\npins:\n");
    for i in items {
        s.push_str(&format!("  - {i}\n"));
    }
    s
}
