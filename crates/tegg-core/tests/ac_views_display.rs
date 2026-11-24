//! Slice Q3 L4 at `tegg-core` (docs/acceptance/views.md part five, R220…R228; docs/contracts/v1-views.md §34, §36, §39,
//! §43): runs of tabs (`QuerySource::View`), reference fences and saved queries with own and effective `view`,
//! `group_by`, `lanes`, `lane_order`, `widths` (`QueryResult.usage`, `group` in every display, R228 against
//! tests/fixtures/queries-files/expected-views-display.json `results`, `cs` and `en-US`), broken own values, old words read
//! as new ones (`board` → Wall, `vertical` / `horizontal` → Columns / Rows) and never rewritten, the query file's writes
//! from `query/<name>` (`query_apply`: new words for the changed key, `group_none` removing `group_by`), `New view` ›
//! Wall (`query_create`), type-file writes through `Core::type_patch`, Tasks as walls (`task.yml` items), the watcher,
//! base checks, the kill harness, the `yaml` / `micromark` node check, the L3 reader `tegg_format::fence_usage`.
//! Fixtures: tests/fixtures/vaults/views (base), the overlay views-display/, tasks + views-tasks/; expected bytes
//! tests/fixtures/queries-files/expected/views-display/ (and expected/views/, expected/views-tasks/ where §43.4 reuses
//! them). Test clock `2026-11-19T10:00:00+01:00`, Europe/Prague, `cs` (Tasks: part three's clock), injected. Written from
//! the ACs and the contract only (D-61); every check is an assertion here.

mod common;
mod views_setup;
mod views_tasks_setup;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime};

use common::{repo_root, sandbox, snapshot, wait_until, Entry, Sandbox};
use serde_json::{json, Value};
use tegg_core::queries_q::{self, Lanes, QueryCreate, QueryDef, QueryEnv, QueryResult, QuerySource, View};
use tegg_core::{Core, CoreError, CoreOptions, FileVersion, VaultError};
use tegg_schema::{TypeOp, UsageGroupBy, UsageLanes, UsageView};
use views_setup::*;
use views_tasks_setup as vts;

macro_rules! ok {
    ($e:expr, $what:expr) => {
        match $e {
            Ok(v) => v,
            Err(e) => {
                assert!(false, "{} answered {:?}", $what, e);
                unreachable!()
            }
        }
    };
}
macro_rules! some {
    ($e:expr, $what:expr) => {
        match $e {
            Some(v) => v,
            None => {
                assert!(false, "{}: got None", $what);
                unreachable!()
            }
        }
    };
}

const ZOB: &str = "Pages/Zobrazení knih.md";
const ZED: &str = "Celá zeď";

// ------------------------------------------------------------------------------------------------ setup (no assertions)

/// The base, then the overlay views-display/ (without its README).
fn overlay_vault(sb: &Sandbox) -> PathBuf {
    let root = vault(sb);
    copy_dir(&repo_root().join("tests/fixtures/vaults/views-display"), &root, &["README.md"]);
    root
}
fn overlay_file(rel: &str) -> String {
    String::from_utf8(std::fs::read(repo_root().join("tests/fixtures/vaults/views-display").join(rel)).unwrap_or_else(|e| panic!("setup: {rel}: {e}"))).expect("setup: UTF-8")
}
/// tests/fixtures/queries-files/expected/views-display/<rel>.
fn exp(rel: &str) -> String {
    String::from_utf8(std::fs::read(repo_root().join("tests/fixtures/queries-files/expected/views-display").join(rel)).unwrap_or_else(|e| panic!("setup: {rel}: {e}"))).expect("setup: UTF-8")
}
fn corpus() -> Value {
    let p = repo_root().join("tests/fixtures/queries-files/expected-views-display.json");
    serde_json::from_slice(&std::fs::read(p).expect("setup: corpus")).expect("setup: JSON")
}
fn env_of(v: &Value) -> QueryEnv {
    if v["locale"] == "en-US" {
        env_us()
    } else {
        env()
    }
}
fn view(core: &Core, name: &str, e: &QueryEnv) -> QueryResult {
    core.query_run(QuerySource::View { type_key: "book".into(), name: name.into() }, None, e)
}
fn task_view(core: &Core, name: &str, e: &QueryEnv) -> QueryResult {
    core.query_run(QuerySource::View { type_key: "task".into(), name: name.into() }, None, e)
}
/// The n-th (1-based) fence of a vault note, run as a block of that note.
fn fence(core: &Core, root: &Path, note: &str, n: usize, e: &QueryEnv) -> QueryResult {
    let text = disk_s(root, note).unwrap_or_default();
    let body = tegg_format::query_fences(&text).get(n - 1).map(|f| f.body.clone()).unwrap_or_default();
    core.query_run(QuerySource::Fence(body), Some(note), e)
}
fn strs(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}
fn changed(a: &BTreeMap<String, Entry>, b: &BTreeMap<String, Entry>) -> Vec<String> {
    let mut keys: Vec<&String> = a.keys().chain(b.keys()).collect();
    keys.sort();
    keys.dedup();
    keys.into_iter().filter(|k| a.get(*k) != b.get(*k) && !k.ends_with('/')).map(|k| tegg_format::nfc(k)).collect()
}
fn view_word(v: View) -> &'static str {
    match v {
        View::List => "list",
        View::Table => "table",
        View::Wall => "wall",
    }
}
fn lanes_word(l: Lanes) -> &'static str {
    match l {
        Lanes::Columns => "columns",
        Lanes::Rows => "rows",
    }
}
/// The lanes that hold a card, as (id, paths).
fn full_lanes(r: &QueryResult) -> Option<Vec<(String, Vec<String>)>> {
    r.group.as_ref().map(|g| {
        g.lanes.iter().filter(|l| !l.cards.is_empty()).map(|l| (tegg_format::nfc(&l.id), l.cards.iter().map(|c| tegg_format::nfc(&r.rows[c.row].path)).collect())).collect()
    })
}
fn lanes_json(r: &QueryResult) -> Value {
    match full_lanes(r) {
        Some(ls) => Value::Array(ls.into_iter().map(|(id, p)| json!({ "id": id, "paths": p })).collect()),
        None => Value::Null,
    }
}
/// The keys of the broken entries a run reports (the usage's for a tab or block, the result's otherwise), sorted.
fn broken_set(r: &QueryResult) -> Vec<String> {
    let mut k: Vec<String> = match &r.usage {
        Some(u) => u.broken.iter().map(|b| b.key.clone()).chain(r.broken.iter().filter(|b| b.at.is_none()).map(|b| b.key.clone())).collect(),
        None => r.broken.iter().map(|b| b.key.clone()).collect(),
    };
    k.sort();
    k.dedup();
    k
}
/// The effective display of a run: the usage's for a tab or block, the query file's for `query/<name>`.
fn display_of(r: &QueryResult) -> Option<View> {
    match &r.usage {
        Some(u) => Some(u.view),
        None => r.def.as_ref().map(|d| d.view),
    }
}
fn current(core: &Core, name: &str) -> (QueryDef, FileVersion) {
    let r = core.query(name);
    let d = some!(r.def.clone(), format!("query({name}).def"));
    let v = some!(r.version.clone(), format!("query({name}).version"));
    (d, v)
}
/// One commit from `query/<name>`: the current definition with `edit` applied.
fn commit(core: &Core, name: &str, edit: impl FnOnce(&mut QueryDef)) -> Result<(), CoreError> {
    let (mut d, v) = current(core, name);
    edit(&mut d);
    core.query_apply(name, &v, d, NOW).map(|_| ())
}
fn type_base(core: &Core, key: &str) -> FileVersion {
    let t = some!(core.type_get(key), format!("type_get({key})"));
    some!(t.version, format!("type_get({key}).version"))
}
fn patch(core: &Core, key: &str, op: TypeOp) -> Result<(), CoreError> {
    let v = type_base(core, key);
    core.type_patch(key, Some(&v), &[op]).map(|_| ())
}
fn display(name: &str, v: Option<UsageView>) -> TypeOp {
    TypeOp::SetViewDisplay { name: name.into(), view: v }
}
fn group(name: &str, g: Option<UsageGroupBy>) -> TypeOp {
    TypeOp::SetViewGroup { name: name.into(), group_by: g }
}
fn book_text(id: &str, title: &str, extra: &str) -> String {
    format!("---\nid: {id}\ntype: book\ntitle: {title}\nauthor: \"[[Eva Lindová]]\"\nstatus: Read\n{extra}created: 2026-11-18T09:00:00+01:00\nmodified: 2026-11-18T09:00:00+01:00\n---\n")
}

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-35 (R228 runs)

#[test]
fn fr_qry_05_ac35_own_and_effective_values() {
    let sb = sandbox();
    let root = overlay_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let before = snapshot(&root);
    let mut bad: Vec<String> = Vec::new();
    let all = corpus()["results"].as_array().cloned().unwrap_or_default();
    assert!(all.len() > 15, "setup: the corpus lists R228's results");
    for r in all {
        let e = env_of(&r["env"]);
        let src = &r["source"];
        let got = match src["kind"].as_str() {
            Some("view") => view(&core, src["name"].as_str().unwrap_or_default(), &e),
            Some("fence") => fence(&core, &root, ZOB, src["fence"].as_u64().unwrap_or(0) as usize, &e),
            _ => run(&core, src["name"].as_str().unwrap_or_default(), &e),
        };
        let mut g = json!({
            "display": display_of(&got).map(view_word),
            "group": got.group.as_ref().map(|gr| json!({ "key": tegg_format::nfc(&gr.key), "lanes": lanes_json(&got) })),
            "paths": if r["paths"].is_null() { Value::Null } else { json!(paths(&got)) },
            "broken": broken_set(&got),
        });
        let mut want_broken: Vec<String> = r["broken"].as_array().cloned().unwrap_or_default().iter().filter_map(|x| x.as_str().map(str::to_string)).collect();
        want_broken.sort();
        let mut w = json!({
            "display": r["display"],
            "group": if r["group"].is_null() { Value::Null } else { json!({ "key": r["group"]["key"], "lanes": r["group"]["lanes"] }) },
            "paths": r["paths"],
            "broken": want_broken,
        });
        if let Some(l) = r.get("lanes").and_then(|l| l.as_str()) {
            w["lanes"] = json!(l);
            g["lanes"] = json!(got.usage.as_ref().map(|u| lanes_word(u.lanes)).or(got.def.as_ref().map(|d| lanes_word(d.lanes))));
        }
        if g != w {
            bad.push(format!("{src} ({}):\n  want {w}\n  got  {g}", r["env"]["locale"]));
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "R228: the overlay's tabs, Zobrazení's blocks and the query pages");
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "opening and running write nothing");
    // (7) On query/Rozečtené, Group › Genres changes the default: block 2 regroups by genres, tab Rozečtené stays ungrouped.
    ok!(commit(&core, ROZ, |d| d.group_by = Some("genres".into())), "(7) Genres on query/Rozečtené");
    reread(&core, &[&qpath(ROZ)]);
    let b2 = fence(&core, &root, ZOB, 2, &env());
    assert_eq!(b2.group.as_ref().map(|g| g.key.clone()), Some("genres".to_string()), "(7) block 2 grouped by genres");
    assert_eq!(b2.usage.as_ref().map(|u| u.view), Some(View::Table), "(7) block 2 stays a Table (own view)");
    let tab = view(&core, ROZ, &env());
    assert_eq!((tab.group.is_some(), tab.usage.as_ref().map(|u| u.group_by.clone())), (false, Some(None)), "(7) tab Rozečtené (own none) stays ungrouped");
    let c1 = fence(&core, &root, CTENI, 2, &env());
    assert_eq!(c1.group.as_ref().map(|g| g.key.clone()), Some("genres".to_string()), "(7) Čtení's block follows the default");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-33 (c), query page

#[test]
fn fr_qry_05_ac33_display_and_grouping_in_a_block_and_on_the_query_page() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let book0 = stamp(&root, BOOK);
    ok!(commit(&core, P26, |d| d.view = View::Wall), "(c) Wall on query/Přečtené 2026");
    assert_eq!(disk_s(&root, &qpath(P26)), Some(exp("queries/prectene-2026-view-wall.yml")), "(c) line 14 → view: wall, and modified:");
    reread(&core, &[&qpath(P26)]);
    let tab = view(&core, P26, &env());
    assert_eq!(tab.usage.as_ref().map(|u| u.view), Some(View::Wall), "(c) the tab (no own view) draws a wall");
    assert!(tab.rows.iter().all(|r| r.card.is_some()), "(c) a wall run fills every row's card");
    assert_eq!(fence(&core, &root, CTENI, 1, &env()).usage.map(|u| u.view), Some(View::Wall), "(c) Čtení's block follows");
    assert_eq!(stamp(&root, BOOK), book0, "(c) book.yml untouched");
    // (a), (d) A block's own values: Čtení with `view: wall` and `lanes: rows` own lines.
    write(&root, CTENI, exp("notes/cteni-2026-rozectene-lane-order.md").as_bytes());
    reread(&core, &[CTENI]);
    let b = fence(&core, &root, CTENI, 2, &env());
    let u = some!(b.usage.clone(), "(d) usage");
    assert_eq!((u.lanes, u.lane_order.clone()), (Lanes::Rows, Some(strs(&["To read", "Reading", "Read"]))), "(d) the block's own lanes and lane order");
    assert_eq!(full_lanes(&b).map(|l| l.into_iter().map(|x| x.0).collect::<Vec<_>>()), Some(strs(&["option:To read", "option:Reading"])), "(d) its own lane order");
    assert_eq!(view(&core, ROZ, &env()).usage.map(|u| u.lanes), Some(Lanes::Columns), "(d) the tab keeps columns");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-36

#[test]
fn fr_qry_05_ac36_broken_values() {
    let sb = sandbox();
    let root = overlay_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    // (a) Zobrazení block 5: the query's Table; broken view, group_by, lanes, widths; nothing written.
    let before = snapshot(&root);
    let b5 = fence(&core, &root, ZOB, 5, &env());
    assert_eq!(broken_set(&b5), strs(&["group_by", "lanes", "view", "widths"]), "(a) one broken entry per own broken key");
    assert_eq!((b5.usage.as_ref().map(|u| u.view), b5.group.is_some()), (Some(View::Table), false), "(a) the query's Table, not grouped");
    assert_eq!(b5.usage.as_ref().map(|u| u.widths.clone()), Some(vec![]), "(a) R130's defaults (no widths)");
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "(a) nothing written");
    // (b), (c) Runtime item values on Výborné knihy.
    let o = overlay_file(".tegg/types/book.yml");
    let item = lines_of(&o, 18, 21);
    for (what, own, broken, ok_view) in [
        ("view: Wall", "  - name: Výborné knihy\n    view: Wall\n", Some("view"), View::Table),
        ("lane_order: Reading", "  - name: Výborné knihy\n    group_by: author\n    lane_order: Reading\n", Some("lane_order"), View::Table),
        ("group_by: { due: month }", "  - name: Výborné knihy\n    group_by: { due: month }\n", Some("group_by"), View::Table),
        ("two-key mapping", "  - name: Výborné knihy\n    group_by: { finished: period, created: period }\n", Some("group_by"), View::Table),
        ("widths: { title: 90 }", "  - name: Výborné knihy\n    widths: { title: 90 }\n", None, View::Table),
        ("widths: { neznámý: 200 }", "  - name: Výborné knihy\n    widths: { neznámý: 200 }\n", None, View::Table),
    ] {
        let text = swapped(&o, &item, own);
        write(&root, BOOK, text.as_bytes());
        reread(&core, &[BOOK]);
        let r = view(&core, VYB, &env());
        let u = some!(r.usage.clone(), format!("{what}: usage"));
        assert_eq!(u.broken.iter().map(|b| b.key.clone()).collect::<Vec<_>>(), broken.map(|b| vec![b.to_string()]).unwrap_or_default(), "{what}: broken entries");
        assert_eq!(u.view, ok_view, "{what}: the effective view");
        assert_eq!(disk_s(&root, BOOK), Some(text), "{what}: the file isn't rewritten");
        if what.starts_with("widths: { title") {
            assert_eq!(u.widths, vec![("title".to_string(), 90)], "(c) drawn clamped by the UI, read as written");
        }
        if what.starts_with("widths: { nez") {
            assert_eq!(u.widths, vec![("neznámý".to_string(), 200)], "(c) an unknown column key kept");
        }
    }
    // (d) A broken group_by in a query file on a wall: the ungrouped wall with the notice.
    let d = run(&core, DATUM, &env());
    assert_eq!((d.def.as_ref().map(|x| x.view), d.group.is_some()), (Some(View::Wall), false), "(d) Seskupeno podle data: an ungrouped wall");
    assert_eq!(broken_set(&d), strs(&["group_by"]), "(d) the group_by notice");
    assert_eq!(d.rows.len(), 17, "(d) 17 books");
    assert!(d.rows.iter().all(|r| r.card.is_some()), "(d) wall runs carry cards");
    // (d) A runtime copy of Schedule.yml with `group_by: { due: month }`.
    let sb2 = sandbox();
    let troot = vts::overlay_vault(&sb2);
    let sched = vts::fx(vts::SCHEDULE);
    write(&troot, ".tegg/queries/Měsíce.yml", swapped(&swapped(&sched, "group_by: { due: period }", "group_by: { due: month }"), "title: Schedule", "title: Měsíce").as_bytes());
    let tcore = open(&troot, &sb2.dirs, false);
    let m = tcore.query_run(QuerySource::Saved("Měsíce".into()), None, &vts::env());
    assert_eq!((m.group.is_some(), broken_set(&m)), (false, strs(&["group_by"])), "(d) month: an ungrouped wall with the notice");
    assert_eq!(m.rows.len(), 17, "(d) the 17 non-Cancelled tasks");
}
fn lines_of(text: &str, from: usize, to: usize) -> String {
    text.split_inclusive('\n').skip(from - 1).take(to + 1 - from).collect()
}

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-39 (group on Table runs)

#[test]
fn fr_qry_05_ac39_grouped_table() {
    let sb = sandbox();
    let root = overlay_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let r = view(&core, VYB, &env());
    assert_eq!(r.usage.as_ref().map(|u| u.view), Some(View::Table), "a Table");
    assert_eq!(
        full_lanes(&r),
        Some(vec![(format!("relation:{}", tegg_format::nfc("Autoři/Lucie Horká.md")), bs(&["Čarovná mapa"])), (format!("relation:{}", tegg_format::nfc("Autoři/Eva Lindová.md")), bs(&["Cizí přístavy", "Mapa bez severu"]))]),
        "grouped by Author, own lane_order first"
    );
    // Block 2: grouped by the query's status as a Table; `Read` has no rows.
    let b2 = fence(&core, &root, ZOB, 2, &env());
    assert_eq!(b2.usage.as_ref().map(|u| u.view), Some(View::Table), "block 2: a Table");
    assert_eq!(full_lanes(&b2).map(|l| l.into_iter().map(|x| x.0).collect::<Vec<_>>()), Some(strs(&["option:To read", "option:Reading"])), "block 2: To read, Reading");
    assert!(b2.rows.iter().all(|r| r.card.is_none()), "a Table run reads no card data");
    // Base: Přečtené 2026 grouped by Genres as a Table (multi-value rows in each group).
    let sb2 = sandbox();
    let root2 = vault(&sb2);
    let core2 = open(&root2, &sb2.dirs, false);
    ok!(patch(&core2, "book", group(P26, Some(UsageGroupBy::Key("genres".into())))), "Group › Genres on the tab");
    let g = view(&core2, P26, &env());
    assert_eq!(
        full_lanes(&g),
        Some(vec![
            ("option:Román".to_string(), bs(&["Mapa bez severu", "Sto zimních dní", "Čarovná mapa"])),
            ("option:Detektivka".to_string(), bs(&["Tiché město"])),
            ("option:Poezie".to_string(), bs(&["Zahrada v dešti"])),
            ("option:Eseje".to_string(), bs(&["Sto zimních dní", "Kniha o čaji"])),
            ("option:Cestopis".to_string(), bs(&["Cizí přístavy", "Čarovná mapa", "Šest cest k moři"])),
        ]),
        "R228: 10 rows for 8 books, no No Genres group"
    );
}

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-41 (period groups)

#[test]
fn fr_qry_05_ac41_period_groups_are_flat() {
    let sb = sandbox();
    let root = overlay_vault(&sb);
    write(&root, "Books/Nová kniha.md", book_text("01JB5V00000000000000000041", "Nová kniha", "finished: 2026-11-21\n").as_bytes());
    write(&root, "Books/Pozdní kniha.md", book_text("01JB5V00000000000000000042", "Pozdní kniha", "finished: 2026-12-05\n").as_bytes());
    let core = open(&root, &sb.dirs, false);
    let r = fence(&core, &root, ZOB, 3, &env());
    assert_eq!(r.usage.as_ref().map(|u| (u.view, u.group_period)), Some((View::List, true)), "block 3: a List grouped by a period");
    let ids: Vec<(String, usize)> = full_lanes(&r).unwrap_or_default().into_iter().map(|(id, p)| (id, p.len())).collect();
    assert_eq!(ids, vec![("period:today".into(), 9), ("period:week".into(), 1), ("period:later".into(), 1), ("none".into(), 8)], "Today & earlier 9, This week 1, Later 1, No Finished 8");
    assert!(broken_set(&r).is_empty(), "no notice (the query's broken group_by is replaced)");
    // Sunday 2026-11-22: no This week; Nová kniha is in Today & earlier.
    let sunday = QueryEnv { today: chrono::NaiveDate::from_ymd_opt(2026, 11, 22).expect("date"), ..env() };
    let s = fence(&core, &root, ZOB, 3, &sunday);
    let ids: Vec<(String, usize)> = full_lanes(&s).unwrap_or_default().into_iter().map(|(id, p)| (id, p.len())).collect();
    assert_eq!(ids, vec![("period:today".into(), 10), ("period:later".into(), 1), ("none".into(), 8)], "Sunday: no This week group");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-42 (query file)

#[test]
fn fr_qry_05_ac42_group_order_and_folds() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    // On query/Rozečtené shown as a Table, a group-header drag writes FR-QRY-05 AC-19's bytes.
    ok!(commit(&core, ROZ, |d| d.lane_order = Some(strs(&["To read", "Reading", "Read"]))), "the drag on the query page");
    assert_eq!(disk_s(&root, &qpath(ROZ)), Some(expected("rozectene-lane-order-to-read-first.yml")), "the query file's lane_order");
    // Zobrazení's block 2 on the overlay: its own lane_order orders the Table's groups.
    let sb2 = sandbox();
    let root2 = overlay_vault(&sb2);
    let core2 = open(&root2, &sb2.dirs, false);
    write(&root2, ZOB, exp("notes/zobrazeni-b2-lane-order-reading.md").as_bytes());
    reread(&core2, &[ZOB]);
    let b2 = fence(&core2, &root2, ZOB, 2, &env());
    assert_eq!(b2.usage.as_ref().map(|u| (u.view, u.lane_order.clone())), Some((View::Table, Some(strs(&["Reading", "To read", "Read"])))), "block 2: own Table and lane order");
    assert_eq!(full_lanes(&b2).map(|l| l.into_iter().map(|x| x.0).collect::<Vec<_>>()), Some(strs(&["option:Reading", "option:To read"])), "Reading above To read");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-46

#[test]
fn fr_qry_05_ac46_old_words_keep_reading() {
    // (a) Reads: the corpus `reads` through queries_q::read.
    let mut bad: Vec<String> = Vec::new();
    for r in corpus()["reads"].as_array().cloned().unwrap_or_default() {
        let text = match r["file"].as_str() {
            Some(f) => String::from_utf8(std::fs::read(repo_root().join(f)).expect("setup: read")).expect("setup: UTF-8"),
            None => r["text"].as_str().unwrap_or_default().to_string(),
        };
        let f = queries_q::read(text.as_bytes());
        let mut broken: Vec<String> = f.broken.iter().filter(|b| b.at.is_none()).map(|b| b.key.clone()).collect();
        broken.sort();
        let got = json!({
            "view": view_word(f.def.view), "groupBy": f.def.group_by, "groupPeriod": f.def.group_period, "groupNone": f.def.group_none,
            "lanes": lanes_word(f.def.lanes), "laneOrder": f.def.lane_order, "limit": f.def.limit, "columns": f.def.columns, "broken": broken,
        });
        let mut want = r["def"].clone();
        want["broken"] = r["broken"].clone();
        if got != want {
            bad.push(format!("{}:\n  want {want}\n  got  {got}", r["name"]));
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "(a) expected-views-display.json `reads` (AR-07 AC-12 too)");
    // (a) Celá zeď: a valid ungrouped wall, no group_by entry, no group.
    let sb = sandbox();
    let root = overlay_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let z = run(&core, ZED, &env());
    assert_eq!((z.group.is_some(), broken_set(&z)), (false, Vec::<String>::new()), "(a) Celá zeď: no broken entry, no group");
    // (b) No rewrites: opening and running every query, tab and block of the overlay and a relaunch.
    let before = snapshot(&root);
    for n in [ROZ, P26, VYB, ZANR, AUTOR_Q, DATUM, ZED] {
        let _ = run(&core, n, &env());
        let _ = view(&core, n, &env());
    }
    for n in 1..=6 {
        let _ = fence(&core, &root, ZOB, n, &env());
    }
    drop(core);
    let core = open(&root, &sb.dirs, false);
    let _ = view(&core, AUTOR_Q, &env());
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "(b) nothing written");
    // (c) A changed key gets the new word; the others keep theirs.
    ok!(commit(&core, ROZ, |d| d.lanes = Lanes::Rows), "(c) Rows on query/Rozečtené");
    assert_eq!(disk_s(&root, &qpath(ROZ)), Some(exp("queries/rozectene-lanes-rows.yml")), "(c) line 15 → lanes: rows");
    ok!(commit(&core, ZANR, |d| d.lanes = Lanes::Columns), "(c) Columns on query/Podle žánru");
    assert_eq!(disk_s(&root, &qpath(ZANR)), Some(exp("queries/podle-zanru-lanes-columns.yml")), "(c) line 14 with its trailing comment");
    ok!(patch(&core, "book", TypeOp::SetViewLanes { name: AUTOR_Q.into(), lanes: Some(UsageLanes::Columns) }), "(c) Columns on the Podle autora item");
    assert_eq!(disk_s(&root, BOOK), Some(exp("types/book-overlay-podle-autora-lanes-columns.yml")), "(c) line 27 only; `view: board` kept");
    // A commit that keeps view and lanes keeps the old words (a filter change on query/Podle autora).
    let q0 = disk_s(&root, &qpath(AUTOR_Q)).unwrap_or_default();
    ok!(commit(&core, AUTOR_Q, |d| d.limit = 40), "(b) a limit change");
    let q1 = disk_s(&root, &qpath(AUTOR_Q)).unwrap_or_default();
    assert!(q1.contains("view: board\n") && q0.contains("view: board\n"), "(b) `view: board` keeps its bytes on another key's change");
    // (c) Table then Wall on query/Rozečtené (after Genres, FR-QRY-06 AC-26).
    let sb3 = sandbox();
    let root3 = vault(&sb3);
    let core3 = open(&root3, &sb3.dirs, false);
    ok!(commit(&core3, ROZ, |d| d.group_by = Some("genres".into())), "Genres");
    ok!(commit(&core3, ROZ, |d| d.view = View::Table), "Table");
    assert_eq!(disk_s(&root3, &qpath(ROZ)), Some(expected("rozectene-view-table.yml")), "(c) view: table");
    ok!(commit(&core3, ROZ, |d| d.view = View::Wall), "Wall");
    assert_eq!(disk_s(&root3, &qpath(ROZ)), Some(exp("queries/rozectene-view-wall.yml")), "(c) view: wall");
    // (d) R202's default task views keep `view: board` (D-2195).
    assert_eq!(tegg_core::taskviews::default_task_view_text("Schedule"), Some(vts::exp("queries/schedule-default.yml")), "(d) Schedule's R202 bytes");
    assert_eq!(tegg_core::taskviews::default_task_view_text("Kanban"), Some(vts::exp("queries/kanban-default.yml")), "(d) Kanban's R202 bytes");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-32 (create bytes)

#[test]
fn fr_qry_07_ac32_new_view_offers_table_list_wall() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    for (types, file) in [(["autor"], "queries/new-view-wall-autor.yml"), (["book"], "queries/new-view-wall-book.yml")] {
        let (mut d, _) = current(&core, VYB);
        d.title = "New view".into();
        d.types = strs(&types);
        d.filters = vec![];
        d.sort = vec![queries_q::Sort { by: "modified".into(), order: queries_q::Order::Desc }];
        d.limit = 50;
        d.view = View::Wall;
        d.group_by = None;
        d.group_period = false;
        d.group_none = false;
        d.lanes = Lanes::Columns;
        d.lane_order = None;
        d.columns = vec![];
        d.done_lane = None;
        ok!(core.query_create(QueryCreate { title: "New view".into(), def: Some(d), fence: None, free: true }, NOW), format!("{file}: query_create"));
        assert_eq!(disk_s(&root, &qpath("New view")), Some(exp(file)), "{file}: view: wall, no group_by, lanes or columns");
        std::fs::remove_file(root.join(qpath("New view"))).expect("setup: remove");
        reread(&core, &[&qpath("New view")]);
    }
    // The new tab draws an ungrouped wall.
    write(&root, &qpath("New view"), exp("queries/new-view-wall-book.yml").as_bytes());
    write(&root, BOOK, swapped(&fixture(BOOK), "views: [Rozečtené, Přečtené 2026, Výborné knihy]\n", "views: [Rozečtené, Přečtené 2026, Výborné knihy, New view]\n").as_bytes());
    reread(&core, &[&qpath("New view"), BOOK]);
    let r = view(&core, "New view", &env());
    assert_eq!((r.usage.as_ref().map(|u| u.view), r.group.is_some(), broken_set(&r)), (Some(View::Wall), false, Vec::<String>::new()), "an ungrouped wall, no notice");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-22

#[test]
fn fr_qry_01_ac22_sort_inside_groups() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    ok!(patch(&core, "book", group(P26, Some(UsageGroupBy::Key("genres".into())))), "Group › Genres on Přečtené 2026");
    let r = view(&core, P26, &env());
    assert_eq!(full_lanes(&r).and_then(|l| l.into_iter().next()), Some(("option:Román".to_string(), bs(&["Mapa bez severu", "Sto zimních dní", "Čarovná mapa"]))), "the tab's sort inside Román");
    ok!(patch(&core, "book", TypeOp::SetViewSort { name: P26.into(), sort: Some(vec![tegg_schema::UsageSort { by: "title".into(), order: tegg_schema::UsageOrder::Asc }]) }), "a click on Title");
    let t = view(&core, P26, &env());
    let ls = full_lanes(&t).unwrap_or_default();
    assert_eq!(ls.first().cloned(), Some(("option:Román".to_string(), bs(&["Čarovná mapa", "Mapa bez severu", "Sto zimních dní"]))), "Román by title");
    assert_eq!(ls.iter().map(|l| l.0.clone()).collect::<Vec<_>>(), strs(&["option:Román", "option:Detektivka", "option:Poezie", "option:Eseje", "option:Cestopis"]), "the groups keep their order");
    // (C) en-US: Cestopis's ties by title collation.
    let us = view(&core, P26, &env_us());
    assert_eq!(full_lanes(&us).and_then(|l| l.into_iter().find(|x| x.0 == "option:Cestopis")).map(|x| x.1), Some(bs(&["Čarovná mapa", "Cizí přístavy", "Šest cest k moři"])), "(C) en-US Cestopis");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-06 AC-26

#[test]
fn fr_qry_06_ac26_query_page_sets_display_and_grouping_defaults() {
    let sb = sandbox();
    let root = overlay_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    ok!(commit(&core, ROZ, |d| d.group_by = Some("genres".into())), "Genres");
    assert_eq!(disk_s(&root, &qpath(ROZ)), Some(expected("rozectene-group-by-genres.yml")), "Genres: rozectene-group-by-genres.yml");
    ok!(commit(&core, ROZ, |d| d.view = View::Table), "Table");
    assert_eq!(disk_s(&root, &qpath(ROZ)), Some(expected("rozectene-view-table.yml")), "Table: rozectene-view-table.yml");
    ok!(commit(&core, ZED, |d| d.group_by = Some("status".into())), "Status on query/Celá zeď");
    assert_eq!(disk_s(&root, &qpath(ZED)), Some(exp("queries/cela-zed-group-status.yml")), "group_by: status after line 10");
    reread(&core, &[&qpath(ZED)]);
    let z = run(&core, ZED, &env());
    assert_eq!((z.group.is_some(), z.def.as_ref().map(|d| d.lanes)), (true, Some(Lanes::Rows)), "the wall draws rows (line 11 `lanes: horizontal`)");
    // `None` removes the group_by line (D-2191); lanes and lane_order stay.
    let sb2 = sandbox();
    let root2 = vault(&sb2);
    let core2 = open(&root2, &sb2.dirs, false);
    ok!(commit(&core2, ROZ, |d| {
        d.group_by = None;
        d.group_none = true;
    }), "None on query/Rozečtené");
    assert_eq!(disk_s(&root2, &qpath(ROZ)), Some(exp("queries/rozectene-group-none.yml")), "line 14 removed");
    reread(&core2, &[&qpath(ROZ)]);
    let r = run(&core2, ROZ, &env());
    assert_eq!((r.group.is_some(), broken_set(&r)), (false, Vec::<String>::new()), "not grouped, no notice");
    // A query file holding `group_by: none` reads as not grouped, with no notice.
    let f = queries_q::read(swapped(&fixture(&qpath(ROZ)), "group_by: status\n", "group_by: none\n").as_bytes());
    assert_eq!((f.def.group_by.clone(), f.def.group_none, f.broken.len()), (None, true, 0), "`group_by: none` in a query file");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-09 AC-9 (watcher)

#[test]
fn fr_qry_09_ac9_display_and_grouping_follow_external_changes() {
    let sb = sandbox();
    let root = overlay_vault(&sb);
    let core = open(&root, &sb.dirs, true);
    assert_eq!(view(&core, P26, &env()).usage.map(|u| u.view), Some(View::Wall), "setup: the tab's own wall");
    let o = overlay_file(".tegg/types/book.yml");
    std::fs::write(root.join(BOOK), swapped(&o, "  - name: Přečtené 2026\n    view: wall\n", "  - name: Přečtené 2026\n    view: table\n")).expect("setup: external write");
    let t = wait_until(Duration::from_secs(2), || view(&core, P26, &env()).usage.map(|u| u.view) == Some(View::Table));
    assert!(t.is_some(), "line 17 `view: table`: the tab redraws as a Table within 2 s");
    let before = snapshot(&root);
    let q = fixture(&qpath(ROZ));
    std::fs::write(root.join(qpath(ROZ)), swapped(&q, "group_by: status\n", "group_by: genres\n")).expect("setup: external write");
    let t = wait_until(Duration::from_secs(2), || fence(&core, &root, ZOB, 2, &env()).group.map(|g| g.key) == Some("genres".into()));
    assert!(t.is_some(), "Zobrazení block 2 regroups by genres within 2 s");
    assert_eq!(run(&core, ROZ, &env()).group.map(|g| g.key), Some("genres".to_string()), "query/Rozečtené regroups");
    assert_eq!(fence(&core, &root, CTENI, 2, &env()).group.map(|g| g.key), Some("genres".to_string()), "Čtení's block regroups");
    assert!(view(&core, ROZ, &env()).group.is_none(), "tab Rozečtené (own none) stays ungrouped");
    let c = changed(&before, &snapshot(&root));
    assert_eq!(c, vec![qpath(ROZ)], "only the outside write");
}

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-30, FR-TSK-05 AC-23

fn tasks_overlay() -> (Sandbox, PathBuf, Core) {
    let sb = sandbox();
    let root = vts::overlay_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    (sb, root, core)
}

#[test]
fn fr_tsk_04_ac30_schedule_is_a_wall_grouped_by_due_period() {
    let (_sb, root, core) = tasks_overlay();
    let sched0 = stamp(&root, vts::SCHEDULE);
    let tasks0: Vec<_> = (1..=19).map(|n| stamp(&root, &vts::t(n))).collect();
    let r = task_view(&core, "Schedule", &vts::env());
    assert_eq!(r.usage.as_ref().map(|u| (u.view, u.lanes)), Some((View::Wall, Lanes::Rows)), "(1) Wall, rows (from `lanes: horizontal`)");
    ok!(patch(&core, "task", display("Schedule", Some(UsageView::Table))), "(2) Table");
    assert_eq!(disk_s(&root, vts::TASK_YML), Some(exp("types/task-schedule-view-table.yml")), "(2) line 11 → the block list");
    assert_eq!(stamp(&root, vts::SCHEDULE), sched0, "(2) Schedule.yml untouched");
    assert_eq!((1..=19).map(|n| stamp(&root, &vts::t(n))).collect::<Vec<_>>(), tasks0, "(2) every task file untouched");
    let t = task_view(&core, "Schedule", &vts::env());
    assert_eq!(t.usage.as_ref().map(|u| u.view), Some(View::Table), "(3) a Table");
    let got: Vec<(String, Vec<String>)> = full_lanes(&t).unwrap_or_default();
    assert_eq!(
        got,
        vec![
            ("period:today".to_string(), vts::ts(&[1, 2, 3, 14])),
            ("period:week".to_string(), vts::ts(&[4, 19, 15, 5])),
            ("period:later".to_string(), vts::ts(&[6, 7])),
            ("none".to_string(), vts::ts(&[8, 9, 17, 16, 18])),
            ("done".to_string(), vts::ts(&[10, 12])),
        ],
        "(3) R228's groups (the done lane applies when grouped, D-2188)"
    );
    ok!(patch(&core, "task", display("Schedule", None)), "(5) Use the query's display");
    assert_eq!(disk_s(&root, vts::TASK_YML), Some(vts::fx(vts::TASK_YML)), "(5) line 11 back byte for byte");
}

#[test]
fn fr_tsk_05_ac23_kanban_is_a_wall_lane_order_on_the_tab() {
    let (_sb, root, core) = tasks_overlay();
    let kanban0 = stamp(&root, vts::KANBAN);
    let order = strs(&["Waiting", "To do", "In progress", "Done", "Rozpracováno"]);
    ok!(patch(&core, "task", TypeOp::SetViewLaneOrder { name: "Kanban".into(), lane_order: Some(order.clone()) }), "(2) Waiting before To do");
    assert_eq!(disk_s(&root, vts::TASK_YML), Some(exp("types/task-kanban-lane-order-waiting.yml")), "(2) the Kanban item");
    assert_eq!(stamp(&root, vts::KANBAN), kanban0, "(2) Kanban.yml byte-, mtime- and inode-identical");
    let r = task_view(&core, "Kanban", &vts::env());
    assert_eq!(full_lanes(&r).and_then(|l| l.into_iter().next()).map(|x| x.0), Some("option:Waiting".to_string()), "(2) Waiting first");
    // (5) List draws R228's groups.
    let t0 = vts::fx(vts::TASK_YML);
    write(&root, vts::TASK_YML, swapped(&t0, "views: [Schedule, Kanban, Čeká na ostatní]\n", "views:\n  - Schedule\n  - name: Kanban\n    view: list\n  - Čeká na ostatní\n").as_bytes());
    reread(&core, &[vts::TASK_YML]);
    let l = task_view(&core, "Kanban", &vts::env());
    assert_eq!(l.usage.as_ref().map(|u| u.view), Some(View::List), "(5) a List");
    assert_eq!(
        full_lanes(&l),
        Some(vec![
            ("option:To do".to_string(), vts::ts(&[1, 3, 19, 5, 6, 7, 8, 17, 16, 18])),
            ("option:In progress".to_string(), vts::ts(&[2, 9])),
            ("option:Waiting".to_string(), vts::ts(&[4])),
            ("option:Done".to_string(), vts::ts(&[10, 12])),
            ("unknown:Rozpracováno".to_string(), vts::ts(&[15])),
            ("none".to_string(), vts::ts(&[14])),
        ]),
        "(5) R228's Kanban as a List"
    );
    // (6) A task.yml changed on disk refuses the drag.
    let v = type_base(&core, "task");
    write(&root, vts::TASK_YML, format!("{t0}# změněno jinde\n").as_bytes());
    let res = core.type_patch("task", Some(&v), &[TypeOp::SetViewLaneOrder { name: "Kanban".into(), lane_order: Some(order) }]);
    assert!(matches!(res, Err(CoreError::Vault(VaultError::Conflict { .. }))), "(6) Conflict, got {res:?}");
}

// ------------------------------------------------------------------------------------------------ AR-07 AC-12 (query files)

#[test]
fn ar_07_ac12_display_keys_are_version_1() {
    for (what, text) in [
        ("view: wall", swapped(&fixture(&qpath(ROZ)), "view: board\n", "view: wall\n")),
        ("lanes: rows", swapped(&fixture(&qpath(ROZ)), "lanes: vertical\n", "lanes: rows\n")),
        ("group_by: none", swapped(&fixture(&qpath(ROZ)), "group_by: status\n", "group_by: none\n")),
    ] {
        let f = queries_q::read(text.as_bytes());
        assert_eq!(f.state, queries_q::FileState::Ok, "{what}: version 1 is Ok, never Newer");
        assert!(f.broken.is_empty(), "{what}: no broken entry, got {:?}", f.broken);
    }
    let f = queries_q::read(overlay_file(".tegg/queries/Celá zeď.yml").as_bytes());
    assert_eq!((f.state, f.def.view, f.def.group_by.clone(), f.def.lanes, f.broken.len()), (queries_q::FileState::Ok, View::Wall, None, Lanes::Rows, 0), "Celá zeď: a valid wall, rows");
    let sb = sandbox();
    let root = overlay_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let t = some!(core.type_get("book"), "type_get(book)");
    let items = some!(t.view_items, "view_items");
    assert_eq!(items.iter().filter(|i| !i.plain).count(), 5, "five items with own keys");
    assert_eq!(items.iter().find(|i| i.name == AUTOR_Q).map(|i| i.view.clone()), Some(tegg_schema::UsageValue::Set(UsageView::Wall)), "`board` read as Wall in an item");
}

// ------------------------------------------------------------------------------------------------ FR-SYN-02 AC-15

const KILL_TEST: &str = "fr_syn_02_ac15_display_writes_are_atomic";
const KILL_CYCLES: usize = 200;

fn kill_child(root: &Path, app: &Path, ready: &Path, kind: &str) -> ! {
    let dirs = tegg_core::AppDirs { root: app.to_path_buf() };
    let Ok(core) = Core::open(root, &dirs, CoreOptions { watch: false, sync: None }) else { std::process::exit(3) };
    let _ = core.wait_idle(Duration::from_secs(30));
    std::fs::write(ready, b"ready").ok();
    let start = Instant::now();
    let mut i = 0usize;
    let fail = |e: String| -> ! {
        std::fs::write(ready.with_extension("failed"), e).ok();
        std::process::exit(3)
    };
    let a = exp("notes/zobrazeni-b2-view-list.md");
    let z = overlay_file(ZOB);
    while start.elapsed() < Duration::from_secs(20) {
        i += 1;
        if kind == "fence" {
            let Ok((_, v)) = core.read_note(ZOB, SystemTime::now()) else { fail("read".into()) };
            let t = if i % 2 == 1 { &a } else { &z };
            if let Err(e) = core.write_note(ZOB, t.as_bytes(), Some(&v)) {
                fail(format!("{e:?}"))
            }
        } else {
            let Some(v) = core.type_get("book").and_then(|t| t.version) else { fail("no type version".into()) };
            let op = if kind == "display" {
                TypeOp::SetViewDisplay { name: P26.into(), view: Some(if i % 2 == 1 { UsageView::Table } else { UsageView::Wall }) }
            } else {
                TypeOp::SetViewWidths { name: P26.into(), widths: Some(vec![("title".into(), if i % 2 == 1 { 300 } else { 200 })]) }
            };
            if let Err(e) = core.type_patch("book", Some(&v), &[op]) {
                fail(format!("{e:?}"))
            }
        }
    }
    std::process::exit(0)
}

#[test]
fn fr_syn_02_ac15_display_writes_are_atomic() {
    if let Ok(dir) = std::env::var("TEGG_DISPLAY_KILL_CHILD") {
        let dir = PathBuf::from(dir);
        let ready = PathBuf::from(std::env::var("TEGG_DISPLAY_KILL_READY").expect("setup: ready path"));
        let kind = std::env::var("TEGG_DISPLAY_KILL_KIND").expect("setup: kind");
        kill_child(&dir.join("vault"), &dir.join("app"), &ready, &kind);
    }
    let sb = sandbox();
    let work = sb.base.join("kill");
    let root = work.join("vault");
    copy_dir(&repo_root().join("tests/fixtures/vaults/views"), &root, &["README.md"]);
    copy_dir(&repo_root().join("tests/fixtures/vaults/new-empty/.tegg"), &root.join(".tegg"), &[]);
    copy_dir(&repo_root().join("tests/fixtures/vaults/views-display"), &root, &["README.md"]);
    std::fs::create_dir_all(work.join("app")).expect("setup: app dir");
    let o = overlay_file(".tegg/types/book.yml");
    let p26_table = swapped(&o, "  - name: Přečtené 2026\n    view: wall\n", "  - name: Přečtené 2026\n    view: table\n");
    let w300 = swapped(&o, "  - name: Přečtené 2026\n    view: wall\n", "  - name: Přečtené 2026\n    view: wall\n    widths: { title: 300 }\n");
    let w200 = swapped(&o, "  - name: Přečtené 2026\n    view: wall\n", "  - name: Přečtené 2026\n    view: wall\n    widths: { title: 200 }\n");
    let cases: Vec<(&str, String, Vec<String>)> = vec![
        ("display", BOOK.to_string(), vec![o.clone(), p26_table]),
        ("fence", ZOB.to_string(), vec![overlay_file(ZOB), exp("notes/zobrazeni-b2-view-list.md")]),
        ("widths", BOOK.to_string(), vec![w200, w300]),
    ];
    let exe = std::env::current_exe().expect("setup: test binary");
    let mut seed: u64 = 0x5133_2203_2185_19;
    let mut bad: Vec<String> = Vec::new();
    for (kind, rel, allowed) in &cases {
        let mut wrote = 0usize;
        let bad0 = bad.len();
        for cycle in 0..KILL_CYCLES {
            std::fs::write(root.join(rel), &allowed[0]).expect("setup: restore the file");
            let ready = work.join(format!("ready-{kind}-{cycle}"));
            let mut child = Command::new(&exe)
                .args(["--exact", KILL_TEST, "--nocapture", "--test-threads=1"])
                .env("TEGG_DISPLAY_KILL_CHILD", &work)
                .env("TEGG_DISPLAY_KILL_READY", &ready)
                .env("TEGG_DISPLAY_KILL_KIND", kind)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .expect("setup: spawn the writer");
            let deadline = Instant::now() + Duration::from_secs(20);
            while !ready.exists() && Instant::now() < deadline && child.try_wait().ok().flatten().is_none() {
                std::thread::sleep(Duration::from_micros(300));
            }
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            std::thread::sleep(Duration::from_micros(200 + seed % 7800));
            let _ = child.kill();
            let _ = child.wait();
            if ready.with_extension("failed").exists() {
                bad.push(format!("{kind} cycle {cycle}: the writer failed: {}", std::fs::read_to_string(ready.with_extension("failed")).unwrap_or_default()));
            }
            let now = String::from_utf8(std::fs::read(root.join(rel)).unwrap_or_default()).unwrap_or_default();
            if now != allowed[0] {
                wrote += 1;
            }
            if !allowed.contains(&now) {
                bad.push(format!("{kind} cycle {cycle}: torn or unexpected file ({} bytes)", now.len()));
            }
            for d in ["Pages", ".tegg/types"] {
                for e in std::fs::read_dir(root.join(d)).map(|rd| rd.flatten().collect::<Vec<_>>()).unwrap_or_default() {
                    if e.file_name().to_string_lossy().contains("tegg-tmp") {
                        let _ = std::fs::remove_file(e.path());
                    }
                }
            }
            if bad.len() > bad0 + 10 {
                break;
            }
        }
        if wrote == 0 {
            bad.push(format!("{kind}: the writer never committed"));
        }
    }
    write(&root, ".tegg/types/.book.yml.4242.tegg-tmp", b"version: 1\nname: Polovina\nplural: Poloviny\n");
    write(&root, ".tegg/queries/.Celá zeď.yml.4242.tegg-tmp", b"version: 1\ntitle: Polovina\n");
    write(&root, "Pages/.Zobrazení knih.md.4242.tegg-tmp", b"---\ntype: page\ntitle: Polovina\n---\n");
    let core = open(&root, &sb.dirs, false);
    if core.type_get("polovina").is_some() || run(&core, ZED, &env()).rows.iter().any(|r| r.path.contains("tegg-tmp")) || core.query("Polovina").lookup == queries_q::Lookup::Ok {
        bad.push("a temp file is listed as a type, query or object".into());
    }
    assert_eq!(bad, Vec::<String>::new(), "after every kill each file is its complete old or new bytes");
}

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-36

#[test]
fn fr_syn_03_ac36_display_writes_check_the_base() {
    let sb = sandbox();
    let root = overlay_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let base = type_base(&core, "book");
    let o = overlay_file(".tegg/types/book.yml");
    let changed_book = swapped(&o, "description: Knihy, které", "description: Knížky, které");
    write(&root, BOOK, changed_book.as_bytes());
    for (what, op) in [
        ("the display switch", display(P26, Some(UsageView::Table))),
        ("a Group choice", group(VYB, Some(UsageGroupBy::Key("status".into())))),
        ("Lanes", TypeOp::SetViewLanes { name: AUTOR_Q.into(), lanes: Some(UsageLanes::Columns) }),
        ("a group-header drag", TypeOp::SetViewLaneOrder { name: VYB.into(), lane_order: Some(strs(&["[[Eva Lindová]]", "[[Lucie Horká]]"])) }),
        ("a resize end", TypeOp::SetViewWidths { name: VYB.into(), widths: Some(vec![("title".into(), 300)]) }),
        ("Use the query's display", display(P26, None)),
        ("Use the query's grouping", group(ROZ, None)),
    ] {
        let r = core.type_patch("book", Some(&base), &[op]);
        assert!(matches!(r, Err(CoreError::Vault(VaultError::Conflict { .. }))), "{what} on a changed book.yml: Conflict, got {r:?}");
        assert_eq!(disk_s(&root, BOOK), Some(changed_book.clone()), "{what}: nothing written");
    }
    // The same bytes with only a new mtime: no conflict (D-175).
    write(&root, BOOK, o.as_bytes());
    reread(&core, &[BOOK]);
    let b2 = type_base(&core, "book");
    std::thread::sleep(Duration::from_millis(20));
    write(&root, BOOK, o.as_bytes());
    let r = core.type_patch("book", Some(&b2), &[TypeOp::SetViewLanes { name: AUTOR_Q.into(), lanes: Some(UsageLanes::Columns) }]);
    assert!(r.is_ok(), "same bytes, new mtime: written, got {r:?}");
    assert_eq!(disk_s(&root, BOOK), Some(exp("types/book-overlay-podle-autora-lanes-columns.yml")), "the change is written");
    // The query page: a changed query file refuses the commit.
    let (d, v) = current(&core, ROZ);
    write(&root, &qpath(ROZ), format!("{}# jinde\n", fixture(&qpath(ROZ))).as_bytes());
    let mut d2 = d.clone();
    d2.lanes = Lanes::Rows;
    let r = core.query_apply(ROZ, &v, d2, NOW);
    assert!(r.is_err(), "query/<name>: a changed query file refuses the write");
}

// ------------------------------------------------------------------------------------------------ NFR-POR-01 AC-8

#[test]
fn nfr_por_01_ac8_display_keys_are_plain() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    ok!(commit(&core, ROZ, |d| d.lanes = Lanes::Rows), "Rows on query/Rozečtené");
    ok!(commit(&core, P26, |d| d.view = View::Wall), "Wall on query/Přečtené 2026");
    ok!(patch(&core, "book", group(VYB, Some(UsageGroupBy::Key("author".into())))), "Group › Author on Výborné knihy");
    ok!(patch(&core, "book", TypeOp::SetViewLaneOrder { name: VYB.into(), lane_order: Some(strs(&["[[Lucie Horká]]"])) }), "a relation lane_order");
    ok!(patch(&core, "book", TypeOp::SetViewWidths { name: VYB.into(), widths: Some(vec![("title".into(), 260)]) }), "widths");
    let (_, v) = ok!(core.read_note(CTENI, SystemTime::now()), "read Čtení");
    ok!(core.write_note(CTENI, exp("notes/cteni-2026-rozectene-lane-order.md").as_bytes(), Some(&v)), "a fence write");
    // Parse each written file with the `yaml` npm package (YAML 1.2); count the `query` code blocks with micromark.
    let script = r#"const fs=require('fs');const Y=require(process.argv[1]);const M=require(process.argv[2]).micromark;const out={};for(const p of process.argv.slice(4)){let t=fs.readFileSync(p,'utf8');const k=p.split(process.argv[3]+'/')[1];if(t.startsWith('---')){out[k]={blocks:(M(t).match(/<pre><code class="language-query">/g)||[]).length,fm:Y.parse(t.split('\n---')[0].slice(4))}}else{out[k]=Y.parse(t)}}console.log(JSON.stringify(out));"#;
    let yaml = repo_root().join("app/node_modules/yaml");
    let micromark = repo_root().join("packages/doc/node_modules/micromark");
    let files = [qpath(ROZ), qpath(P26), BOOK.to_string(), CTENI.to_string()];
    let out = Command::new("node")
        .arg("-e")
        .arg(script)
        .arg(yaml.to_string_lossy().to_string())
        .arg(micromark.to_string_lossy().to_string())
        .arg(root.to_string_lossy().to_string())
        .args(files.iter().map(|f| root.join(f).to_string_lossy().to_string()))
        .stderr(Stdio::inherit())
        .output();
    let out = ok!(out, "node runs");
    let v: Value = ok!(serde_json::from_slice(&out.stdout), "the yaml package parses every file");
    assert_eq!(v[qpath(ROZ)]["lanes"], "rows", "lanes: rows as a plain scalar");
    assert_eq!(v[qpath(P26)]["view"], "wall", "view: wall as a plain scalar");
    assert_eq!(
        v[BOOK]["views"],
        json!(["Rozečtené", "Přečtené 2026", { "name": "Výborné knihy", "group_by": "author", "lane_order": ["[[Lucie Horká]]"], "widths": { "title": 260 } }]),
        "the views items as Tegg shows them"
    );
    assert_eq!(v[CTENI]["blocks"], 3, "Čtení: three query code blocks (the new lines stay inside)");
    assert!(!root.join(".obsidian").exists(), "nothing written inside .obsidian/");
}

// ------------------------------------------------------------------------------------------------ FR-FMT-07 AC-37 (core)

#[test]
fn fr_fmt_07_ac37_display_keys_round_trip() {
    // Opening, running and drawing the overlay and views-tasks write nothing.
    let sb = sandbox();
    let root = overlay_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let before = snapshot(&root);
    for n in [ROZ, P26, VYB, ZANR, AUTOR_Q, ZED] {
        let _ = view(&core, n, &env());
    }
    for n in 1..=6 {
        let _ = fence(&core, &root, ZOB, n, &env());
    }
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "the overlay: nothing written");
    let (_sb2, troot, tcore) = tasks_overlay();
    let tb = snapshot(&troot);
    for n in ["Schedule", "Kanban", vts::CEKA] {
        let _ = task_view(&tcore, n, &vts::env());
    }
    assert_eq!(changed(&tb, &snapshot(&troot)), Vec::<String>::new(), "views-tasks: nothing written");
    // The query-file writer's Switch lanes on Schedule.yml writes `lanes: columns` (LF, CRLF, no final newline).
    let sched = vts::fx(vts::SCHEDULE);
    for (what, text, file) in [
        ("LF", sched.clone(), "queries/schedule-lanes-columns.yml"),
        ("CRLF", sched.replace('\n', "\r\n"), "queries/schedule-lanes-columns-crlf.yml"),
        ("no final newline", sched.strip_suffix('\n').unwrap_or(&sched).to_string(), "queries/schedule-lanes-columns-no-newline.yml"),
    ] {
        write(&troot, vts::SCHEDULE, text.as_bytes());
        reread(&tcore, &[vts::SCHEDULE]);
        let r = tcore.query("Schedule");
        let mut d = some!(r.def.clone(), format!("{what}: def"));
        let v = some!(r.version.clone(), format!("{what}: version"));
        assert_eq!(d.lanes, Lanes::Rows, "{what}: `lanes: horizontal` reads as Rows");
        d.lanes = Lanes::Columns;
        ok!(tcore.query_apply("Schedule", &v, d, vts::NOW), format!("{what}: Switch lanes"));
        assert_eq!(disk_s(&troot, vts::SCHEDULE), Some(exp(file)), "{what}: lanes: columns");
    }
}

// ------------------------------------------------------------------------------------------------ FR-FMT-06 AC-8 (L3 Rust reader)

fn uv<T>(v: &tegg_format::usage::UsageValue<T>, f: impl Fn(&T) -> Value) -> Value {
    match v {
        tegg_format::usage::UsageValue::Absent => Value::Null,
        tegg_format::usage::UsageValue::Broken => json!("broken"),
        tegg_format::usage::UsageValue::Set(x) => f(x),
    }
}

#[test]
fn fr_fmt_06_ac8_fence_display_and_grouping_keys() {
    use tegg_format::usage::{UsageGroupBy as G, UsageLanes as L, UsageView as V};
    let mut bad: Vec<String> = Vec::new();
    let all = corpus()["fences"].as_array().cloned().unwrap_or_default();
    assert!(all.len() > 30, "setup: the corpus lists the fences");
    for e in all {
        let file = e["file"].as_str().unwrap_or_default();
        let n = e["fence"].as_u64().unwrap_or(0) as usize;
        let text = String::from_utf8(std::fs::read(repo_root().join(file)).expect("setup: fence file")).expect("setup: UTF-8");
        let Some(f) = tegg_format::query_fences(&text).into_iter().nth(n - 1) else {
            bad.push(format!("{file} #{n}: no fence"));
            continue;
        };
        let u = tegg_format::query_fence::fence_usage(&f.body);
        let got = json!({
            "view": uv(&u.view, |v| json!(match v { V::List => "list", V::Table => "table", V::Wall => "wall" })),
            "group": uv(&u.group_by, |g| match g { G::None => json!({ "none": true }), G::Key(k) => json!({ "none": false, "key": k, "period": false }), G::Period(k) => json!({ "none": false, "key": k, "period": true }) }),
            "lanes": uv(&u.lanes, |l| json!(match l { L::Columns => "columns", L::Rows => "rows" })),
            "laneOrder": uv(&u.lane_order, |l| json!(l)),
            "widths": uv(&u.widths, |w| Value::Array(w.iter().map(|(k, v)| json!([k, v])).collect())),
        });
        let want = json!({ "view": e["view"], "group": e["group"], "lanes": e["lanes"], "laneOrder": e["laneOrder"], "widths": e["widths"] });
        if got != want {
            bad.push(format!("{file} #{n}\n  want {want}\n  got  {got}"));
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "tegg_format::fence_usage gives expected-views-display.json's fences");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-03 AC-26 / CP-36 (4E moves reach type files)

#[test]
fn fr_lnk_03_ac26_renames_reach_usage_lane_order() {
    // The core reads an item's relation lane_order as written; the job's bytes are tegg-jobs' test.
    let sb = sandbox();
    let root = overlay_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let r = view(&core, VYB, &env());
    assert_eq!(r.usage.as_ref().and_then(|u| u.own.lane_order.clone()), Some(strs(&["[[Lucie Horká]]"])), "the item's own lane_order");
    // A renamed relation target that the lane_order no longer names: the group falls back to its default place.
    write(&root, BOOK, exp("types/book-overlay-lucie-renamed.yml").as_bytes());
    reread(&core, &[BOOK]);
    let r = view(&core, VYB, &env());
    assert_eq!(r.usage.as_ref().and_then(|u| u.own.lane_order.clone()), Some(strs(&["[[Lucie Horká-Nová]]"])), "the patched value is read");
}
