//! Slice Q2.1 L4 at `tegg-core` (docs/acceptance/views.md part two, R194…R200; docs/contracts/v1-views.md §13.2, §14,
//! §15, §17, §21): runs of a tab (`QuerySource::View`) and of a reference fence with their own `sort` / `columns`
//! (`QueryResult.usage`, R200 against tests/fixtures/queries-files/expected-views-usage.json, `cs` and `en-US`), broken own
//! values, `TypeInfo.view_items` / `views_source`, the trash of a view as the UI orders it (`type_patch` then
//! `query_trash`; Undo `query_restore` then `TypeOp::SetViewsSource`), queries trashed elsewhere, the watcher, the kill
//! harness, base checks and a template's copied fence. The L3 reader part of FR-FMT-06 AC-7 (`tegg_format::fence_usage`).
//! Fixture: tests/fixtures/vaults/views (base) and the overlay views-usage/; expected bytes
//! tests/fixtures/queries-files/expected/views-usage/. Test clock `2026-11-19T10:00:00+01:00`, Europe/Prague, `cs`
//! (injected). Written from the ACs, the fixtures and the contract only (D-61); every check is an assertion here.

mod common;
mod views_setup;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime};

use common::{repo_root, sandbox, snapshot, wait_until, Entry, Sandbox};
use serde_json::{json, Value};
use tegg_core::queries_q::{Lookup, QueryEnv, QueryResult, QuerySource, UsageRun};
use tegg_core::{Core, CoreError, CoreOptions, FileVersion, VaultError};
use tegg_schema::{TypeOp, UsageOrder, UsageSort};
use views_setup::*;

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

const CESTY: &str = "Pages/Knihy na cesty.md";
const AUTOR: &str = ".tegg/types/autor.yml";

// ------------------------------------------------------------------------------------------------ setup (no assertions)

/// The base, then the overlay (without its README), then new-empty/.tegg.
fn overlay_vault(sb: &Sandbox) -> PathBuf {
    let root = vault(sb);
    copy_dir(&repo_root().join("tests/fixtures/vaults/views-usage"), &root, &["README.md"]);
    root
}
fn overlay_file(rel: &str) -> String {
    String::from_utf8(std::fs::read(repo_root().join("tests/fixtures/vaults/views-usage").join(rel)).unwrap_or_else(|e| panic!("setup: {rel}: {e}"))).expect("setup: UTF-8")
}
fn exp(rel: &str) -> String {
    String::from_utf8(std::fs::read(repo_root().join("tests/fixtures/queries-files/expected/views-usage").join(rel)).unwrap_or_else(|e| panic!("setup: {rel}: {e}"))).expect("setup: UTF-8")
}
fn corpus() -> Value {
    let p = repo_root().join("tests/fixtures/queries-files/expected-views-usage.json");
    serde_json::from_slice(&std::fs::read(p).expect("setup: corpus")).expect("setup: JSON")
}
fn env_of(v: &Value) -> QueryEnv {
    if v["locale"] == "en-US" {
        env_us()
    } else {
        env()
    }
}
/// Lines `from..=to` (1-based) with their `\n`.
fn lines(text: &str, from: usize, to: usize) -> String {
    text.split_inclusive('\n').skip(from - 1).take(to + 1 - from).collect()
}
fn view(core: &Core, name: &str, e: &QueryEnv) -> QueryResult {
    core.query_run(QuerySource::View { type_key: "book".into(), name: name.into() }, None, e)
}
/// The n-th (1-based) fence of a vault note, run as a block of that note.
fn fence(core: &Core, root: &Path, note: &str, n: usize, e: &QueryEnv) -> QueryResult {
    let text = disk_s(root, note).unwrap_or_default();
    let body = tegg_format::query_fences(&text).get(n - 1).map(|f| f.body.clone()).unwrap_or_default();
    core.query_run(QuerySource::Fence(body), Some(note), e)
}
fn sorts(s: &[tegg_core::queries_q::Sort]) -> Value {
    Value::Array(s.iter().map(|l| json!({ "by": tegg_format::nfc(&l.by), "order": if format!("{:?}", l.order) == "Asc" { "asc" } else { "desc" } })).collect())
}
fn lower_first(s: &str) -> String {
    let mut c = s.chars();
    c.next().map(|f| f.to_lowercase().collect::<String>() + c.as_str()).unwrap_or_default()
}
/// A UsageRun as expected-views-usage.json writes it (UsageRunDto).
fn usage_json(u: &UsageRun) -> Value {
    json!({
        "kind": if format!("{:?}", u.kind) == "Tab" { "tab" } else { "block" },
        "own": { "sort": u.own.sort.as_ref().map(|s| sorts(s)), "columns": u.own.columns },
        "broken": u.broken.iter().map(|b| json!({ "reason": lower_first(&format!("{:?}", b.reason)), "at": b.at, "key": b.key, "type": b.r#type })).collect::<Vec<_>>(),
        "sort": sorts(&u.sort),
        "columns": u.columns,
    })
}
fn lanes_json(r: &QueryResult) -> Value {
    match &r.group {
        Some(g) => Value::Array(g.lanes.iter().map(|l| json!({ "id": tegg_format::nfc(&l.id), "paths": l.cards.iter().map(|c| tegg_format::nfc(&r.rows[c.row].path)).collect::<Vec<_>>() })).collect()),
        None => Value::Null,
    }
}
fn us(levels: &[(&str, bool)]) -> Vec<UsageSort> {
    levels.iter().map(|(b, a)| UsageSort { by: b.to_string(), order: if *a { UsageOrder::Asc } else { UsageOrder::Desc } }).collect()
}
fn type_base(core: &Core) -> FileVersion {
    let t = some!(core.type_get("book"), "type_get(book)");
    some!(t.version, "type_get(book).version")
}
fn changed(a: &BTreeMap<String, Entry>, b: &BTreeMap<String, Entry>) -> Vec<String> {
    let mut keys: Vec<&String> = a.keys().chain(b.keys()).collect();
    keys.sort();
    keys.dedup();
    keys.into_iter().filter(|k| a.get(*k) != b.get(*k) && !k.ends_with('/')).map(|k| tegg_format::nfc(k)).collect()
}
fn strs(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-25 (R200 tabs)

#[test]
fn fr_qry_07_ac25_views_items_read_and_kept() {
    let sb = sandbox();
    let root = overlay_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let before = snapshot(&root);
    let t = some!(core.type_get("book"), "type_get(book)");
    assert_eq!(t.view_items.as_ref().map(|i| i.iter().map(|x| (x.name.clone(), x.plain)).collect::<Vec<_>>()), Some(vec![(ROZ.to_string(), true), (P26.to_string(), false), (VYB.to_string(), true)]), "TypeInfo.view_items");
    assert_eq!(t.views_source, Some(lines(&overlay_file(".tegg/types/book.yml"), 13, 20)), "TypeInfo.views_source: lines 13…20 as written");
    assert_eq!(t.def.views, Some(strs(&[ROZ, P26, VYB])), "TypeFile.views: the names");
    let mut bad: Vec<String> = Vec::new();
    for r in corpus()["results"].as_array().cloned().unwrap_or_default() {
        if r["source"]["kind"] != "view" {
            continue;
        }
        let name = r["source"]["name"].as_str().unwrap_or_default();
        let got = view(&core, name, &env_of(&r["env"]));
        let got_v = json!({
            "paths": if r["lanes"].is_null() { json!(got.rows.iter().map(|x| tegg_format::nfc(&x.path)).collect::<Vec<_>>()) } else { Value::Null },
            "lanes": if r["lanes"].is_null() { Value::Null } else { lanes_json(&got) },
            "usage": got.usage.as_ref().map(usage_json),
        });
        let want = json!({ "paths": r.get("paths").cloned().unwrap_or(Value::Null), "lanes": r.get("lanes").cloned().unwrap_or(Value::Null), "usage": r["usage"] });
        if got_v != want {
            bad.push(format!("tab {name} ({}):\n  want {want}\n  got  {got_v}", r["env"]["locale"]));
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "R200: the overlay's tabs with their own values");
    // (b) `sort: sideways` in the item: the query's sort and a broken entry; nothing is written.
    let o = overlay_file(".tegg/types/book.yml");
    write(&root, BOOK, swapped(&o, &lines(&o, 16, 18), "    sort: sideways\n").as_bytes());
    reread(&core, &[BOOK]);
    let r = view(&core, P26, &env());
    let u = some!(r.usage.clone(), "(b) usage");
    assert_eq!(u.broken.iter().map(|b| b.key.clone()).collect::<Vec<_>>(), strs(&["sort"]), "(b) a broken `sort` entry");
    assert_eq!(paths(&r), bs(&["Mapa bez severu", "Sto zimních dní", "Cizí přístavy", "Čarovná mapa", "Šest cest k moři", "Kniha o čaji", "Tiché město", "Zahrada v dešti"]), "(b) the query's order (R193)");
    assert_eq!(u.columns, strs(&["author", "rating", "finished", "genres"]), "(b) its own columns still apply");
    // (a) A mapping without `name`: views unreadable, no tab items.
    write(&root, BOOK, swapped(&o, "  - name: Přečtené 2026\n    sort:\n      - { by: rating, order: asc }\n      - { by: title, order: asc }\n    columns: [author, rating, finished, genres]\n", "  - sort: { by: title }\n").as_bytes());
    reread(&core, &[BOOK]);
    let t = some!(core.type_get("book"), "type_get(book) (a)");
    assert!(t.views_unreadable && t.view_items.is_none(), "(a) views_unreadable, no items");
    let after = snapshot(&root);
    assert_eq!(changed(&before, &after), vec![BOOK.to_string()], "reading and running write nothing (only the test's own edits)");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-16 (R200 blocks)

#[test]
fn fr_qry_01_ac16_effective_and_broken_usage_values() {
    let sb = sandbox();
    let root = overlay_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let before = snapshot(&root);
    let mut bad: Vec<String> = Vec::new();
    for r in corpus()["results"].as_array().cloned().unwrap_or_default() {
        if r["source"]["kind"] != "fence" {
            continue;
        }
        let n = r["source"]["fence"].as_u64().unwrap_or(0) as usize;
        let got = fence(&core, &root, CESTY, n, &env_of(&r["env"]));
        let got_v = json!({
            "paths": if r["lanes"].is_null() { json!(got.rows.iter().map(|x| tegg_format::nfc(&x.path)).collect::<Vec<_>>()) } else { Value::Null },
            "lanes": if r["lanes"].is_null() { Value::Null } else { lanes_json(&got) },
            "usage": got.usage.as_ref().map(usage_json),
        });
        let want = json!({ "paths": r.get("paths").cloned().unwrap_or(Value::Null), "lanes": r.get("lanes").cloned().unwrap_or(Value::Null), "usage": r["usage"] });
        if got_v != want {
            bad.push(format!("Cesty block {n} ({}):\n  want {want}\n  got  {got_v}", r["env"]["locale"]));
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "R200: Cesty's blocks with their own and broken values");
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "opening and running write nothing (Výborné knihy.yml, Cesty)");
    // Runtime fences in a note: unknown own column keys kept, `sort: []`, a hand-written earlier fence.
    let note = |body: &str| format!("---\nid: 01JB5V00000000000000000031\ntype: page\ntitle: Ruční bloky\n---\n```query\n{body}\n```\n");
    let ruc = "Pages/Ruční bloky.md";
    write(&root, ruc, note("saved: Přečtené 2026\ncolumns: [neznámý, author]").as_bytes());
    reread(&core, &[ruc]);
    let r = fence(&core, &root, ruc, 1, &env());
    assert_eq!(r.usage.as_ref().map(|u| u.columns.clone()), Some(strs(&["neznámý", "author"])), "`columns: [neznámý, author]` kept (the UI shows Title and Author)");
    write(&root, ruc, note("saved: Přečtené 2026\nsort: []").as_bytes());
    reread(&core, &[ruc]);
    let r = fence(&core, &root, ruc, 1, &env());
    assert_eq!(paths(&r), bs(&["Cizí přístavy", "Čarovná mapa", "Kniha o čaji", "Mapa bez severu", "Sto zimních dní", "Šest cest k moři", "Tiché město", "Zahrada v dešti"]), "`sort: []`: title, then path");
    assert_eq!(r.usage.as_ref().map(|u| u.own.sort.clone()), Some(Some(vec![])), "zero own levels");
    write(&root, ruc, note("saved: Výborné knihy\nsort: { by: title, order: desc }").as_bytes());
    reread(&core, &[ruc]);
    assert_eq!(paths(&fence(&core, &root, ruc, 1, &env())), bs(&["Mapa bez severu", "Čarovná mapa", "Cizí přístavy"]), "an earlier hand-written sort: now applies (R195)");
    // A version 2 query: its own fence values still apply.
    let q = fixture(&qpath(VYB));
    write(&root, &qpath(VYB), swapped(&q, "version: 1\n", "version: 2\n").as_bytes());
    reread(&core, &[&qpath(VYB)]);
    let r = fence(&core, &root, ruc, 1, &env());
    assert_eq!(r.lookup, Some(Lookup::Newer), "setup: a newer query");
    assert_eq!(paths(&r), bs(&["Mapa bez severu", "Čarovná mapa", "Cizí přístavy"]), "a Newer query: the own sort still applies");
}

// ------------------------------------------------------------------------------------------------ FR-FMT-06 AC-7 (L3 Rust reader)

fn usage_value_sort(v: &tegg_format::usage::UsageValue<Vec<tegg_format::usage::UsageSort>>) -> Value {
    match v {
        tegg_format::usage::UsageValue::Absent => Value::Null,
        tegg_format::usage::UsageValue::Broken => json!("broken"),
        tegg_format::usage::UsageValue::Set(s) => Value::Array(s.iter().map(|l| json!({ "by": l.by, "order": if l.order == UsageOrder::Asc { "asc" } else { "desc" } })).collect()),
    }
}
fn usage_value_cols(v: &tegg_format::usage::UsageValue<Vec<String>>) -> Value {
    match v {
        tegg_format::usage::UsageValue::Absent => Value::Null,
        tegg_format::usage::UsageValue::Broken => json!("broken"),
        tegg_format::usage::UsageValue::Set(c) => json!(c),
    }
}

#[test]
fn fr_fmt_06_ac7_fence_usage_keys() {
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
        let got = json!({ "saved": f.saved.as_deref().map(tegg_format::nfc), "sort": usage_value_sort(&u.sort), "columns": usage_value_cols(&u.columns) });
        let want = json!({ "saved": tegg_format::nfc(e["saved"].as_str().unwrap_or_default()), "sort": e["sort"], "columns": e["columns"] });
        if got != want {
            bad.push(format!("{file} #{n}\n  want {want}\n  got  {got}"));
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "tegg_format::fence_usage gives expected-views-usage.json's fences");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-20

#[test]
fn fr_qry_07_ac20_trash_from_the_view_menu_removes_the_tab() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let before = snapshot(&root);
    let q0 = stamp(&root, &qpath(VYB));
    ok!(core.type_patch("book", Some(&type_base(&core)), &[TypeOp::SetViews(strs(&[ROZ, P26]))]), "(1) the views: write");
    assert_eq!(disk_s(&root, BOOK), Some(exp("types/book-trash-vyborne.yml")), "(1) line 13 only");
    ok!(core.query_trash(VYB), "(2) query_trash");
    let moved = stamp(&root, &format!(".trash/{}", qpath(VYB)));
    assert_eq!(moved.as_ref().map(|m| (&m.0, m.2)), q0.as_ref().map(|q| (&q.0, q.2)), "(2) same bytes and inode in .trash/.tegg/queries/");
    let mut want = vec![BOOK.to_string(), qpath(VYB), format!(".trash/{}", qpath(VYB))];
    want.sort();
    assert_eq!(changed(&before, &snapshot(&root)), want, "nothing else is written; Čtení untouched");
    assert_eq!(view(&core, VYB, &env()).lookup, Some(Lookup::Trashed), "a block of it shows the trashed state");
    // The overlay: trashing Přečtené 2026 replaces lines 13…20 by one flow line; Čtení and Cesty untouched.
    let sb2 = sandbox();
    let root2 = overlay_vault(&sb2);
    let core2 = open(&root2, &sb2.dirs, false);
    let b2 = snapshot(&root2);
    let src = some!(core2.type_get("book").and_then(|t| t.views_source), "views_source before the trash");
    assert_eq!(src, lines(&overlay_file(".tegg/types/book.yml"), 13, 20), "views_source: lines 13…20");
    ok!(core2.type_patch("book", Some(&type_base(&core2)), &[TypeOp::SetViews(strs(&[ROZ, VYB]))]), "overlay views: write");
    assert_eq!(disk_s(&root2, BOOK), Some(exp("types/book-overlay-without-prectene.yml")), "overlay: the item and its settings go");
    ok!(core2.query_trash(P26), "overlay query_trash");
    let c2 = changed(&b2, &snapshot(&root2));
    assert!(!c2.contains(&CTENI.to_string()) && !c2.contains(&CESTY.to_string()), "Čtení and Cesty not written: {c2:?}");
    // A version 2 book.yml or unreadable views: refused, nothing written.
    let sb3 = sandbox();
    let root3 = overlay_vault(&sb3);
    write(&root3, BOOK, swapped(&overlay_file(".tegg/types/book.yml"), "version: 1\n", "version: 2\n").as_bytes());
    let core3 = open(&root3, &sb3.dirs, false);
    let b3 = snapshot(&root3);
    let base3 = core3.type_get("book").and_then(|t| t.version);
    assert!(core3.type_patch("book", base3.as_ref(), &[TypeOp::SetViews(strs(&[ROZ, VYB]))]).is_err(), "a Newer book.yml: refused");
    assert_eq!(changed(&b3, &snapshot(&root3)), Vec::<String>::new(), "nothing written");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-21

#[test]
fn fr_qry_07_ac21_trash_undo_and_failures() {
    for (what, overlay) in [("base", false), ("overlay", true)] {
        let sb = sandbox();
        let root = if overlay { overlay_vault(&sb) } else { vault(&sb) };
        let core = open(&root, &sb.dirs, false);
        let orig = disk_s(&root, BOOK).unwrap_or_default();
        let name = if overlay { P26 } else { VYB };
        let keep: Vec<&str> = [ROZ, P26, VYB].into_iter().filter(|n| *n != name).collect();
        let before = some!(core.type_get("book").and_then(|t| t.views_source), format!("{what}: views_source"));
        let t1 = ok!(core.type_patch("book", Some(&type_base(&core)), &[TypeOp::SetViews(strs(&keep))]), format!("{what}: the views: write"));
        ok!(core.query_trash(name), format!("{what}: query_trash"));
        // (a) Undo: query_restore, then the previous views lines with t1's version as base.
        ok!(core.query_restore(name), format!("{what}: query_restore"));
        let v1 = some!(t1.version.clone(), format!("{what}: t1.version"));
        ok!(core.type_patch("book", Some(&v1), &[TypeOp::SetViewsSource(before.clone())]), format!("{what}: SetViewsSource"));
        assert_eq!(disk_s(&root, BOOK), Some(orig.clone()), "(a) {what}: book.yml byte-identical to before");
        assert_eq!(disk_s(&root, &qpath(name)), Some(fixture(&qpath(name))), "(a) {what}: the query file back with its bytes");
    }
    // (c) book.yml changed on disk without vault:changed: the views: write is refused before anything moves.
    let sb = sandbox();
    let root = overlay_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let base = type_base(&core);
    let changed_book = swapped(&overlay_file(".tegg/types/book.yml"), "description: Knihy, které", "description: Knížky, které");
    write(&root, BOOK, changed_book.as_bytes());
    let b = snapshot(&root);
    let r = core.type_patch("book", Some(&base), &[TypeOp::SetViews(strs(&[ROZ, VYB]))]);
    assert!(matches!(r, Err(CoreError::Vault(VaultError::Conflict { .. }))), "(c) Conflict, got {r:?}");
    assert_eq!(changed(&b, &snapshot(&root)), Vec::<String>::new(), "(c) no write, no move");
    // A SetViewsSource whose result can't be read is refused.
    let v = type_base(&core);
    let bad = core.type_patch("book", Some(&v), &[TypeOp::SetViewsSource("views: Rozečtené\n".into())]);
    assert!(bad.is_err(), "a views source that can't be read: refused");
    assert_eq!(disk_s(&root, BOOK), Some(changed_book), "and nothing written");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-22

#[test]
fn fr_qry_07_ac22_trashed_elsewhere_keeps_the_tab() {
    let sb = sandbox();
    let root = vault(&sb);
    let autor = swapped(&fixture(AUTOR), "preview: [poznámka]\n", "preview: [poznámka]\nviews: [Výborné knihy]\n");
    write(&root, AUTOR, autor.as_bytes());
    let core = open(&root, &sb.dirs, false);
    let book0 = stamp(&root, BOOK);
    ok!(core.query_trash(VYB), "Move to trash from the Queries page / query page");
    assert_eq!(stamp(&root, BOOK), book0, "book.yml byte-, mtime- and inode-identical");
    let t = some!(core.type_get("book"), "type_get(book)");
    assert_eq!(t.view_items.map(|i| i.into_iter().map(|x| x.name).collect::<Vec<_>>()), Some(strs(&[ROZ, P26, VYB])), "the tab stays listed");
    assert_eq!(view(&core, VYB, &env()).lookup, Some(Lookup::Trashed), "its run: the trashed state");
    ok!(core.query_restore(VYB), "restore");
    // From the Books tab: only book.yml is written; autor.yml keeps its (trashed) tab.
    let autor0 = stamp(&root, AUTOR);
    ok!(core.type_patch("book", Some(&type_base(&core)), &[TypeOp::SetViews(strs(&[ROZ, P26]))]), "views: write");
    ok!(core.query_trash(VYB), "query_trash");
    assert_eq!(stamp(&root, AUTOR), autor0, "autor.yml untouched");
    assert_eq!(core.type_get("autor").and_then(|t| t.view_items).map(|i| i.len()), Some(1), "the other type page keeps a tab");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-09 AC-8

#[test]
fn fr_qry_09_ac8_usage_settings_follow_external_changes() {
    let sb = sandbox();
    let root = overlay_vault(&sb);
    let core = open(&root, &sb.dirs, true);
    let title_asc = bs(&["Cizí přístavy", "Čarovná mapa", "Kniha o čaji", "Mapa bez severu", "Sto zimních dní", "Šest cest k moři", "Tiché město", "Zahrada v dešti"]);
    let title_desc: Vec<String> = title_asc.iter().rev().cloned().collect();
    // The item's sort changed by another program: the tab reorders within 2 s.
    let o = overlay_file(".tegg/types/book.yml");
    std::fs::write(root.join(BOOK), swapped(&o, &lines(&o, 16, 18), "    sort: { by: title, order: desc }\n")).expect("setup: external write");
    let t = wait_until(Duration::from_secs(2), || paths(&view(&core, P26, &env())) == title_desc);
    assert!(t.is_some(), "the tab follows its item within 2 s: {:?}", paths(&view(&core, P26, &env())));
    // The query file's sort: Čtení's block and Cesty's block 2 follow; block 1 (own sort) doesn't.
    let q = fixture(&qpath(P26));
    std::fs::write(root.join(qpath(P26)), swapped(&q, "sort:\n  - { by: finished, order: desc }\n  - { by: rating, order: asc }\n  - { by: title, order: asc }\n", "sort: { by: title, order: desc }\n")).expect("setup: external write");
    let t = wait_until(Duration::from_secs(2), || paths(&fence(&core, &root, CESTY, 2, &env())) == title_desc);
    assert!(t.is_some(), "Cesty's block 2 follows the query file");
    assert_eq!(paths(&fence(&core, &root, CTENI, 1, &env())), title_desc, "Čtení's block follows");
    assert_eq!(paths(&fence(&core, &root, CESTY, 1, &env())), title_asc, "block 1 keeps its own order");
    // Cesty's line 12 edited outside: block 1 runs its new body.
    let c = overlay_file(CESTY);
    std::fs::write(root.join(CESTY), swapped(&c, "saved: Přečtené 2026\nsort: { by: title, order: asc }\n", "saved: Přečtené 2026\nsort: { by: title, order: desc }\n")).expect("setup: external write");
    let t = wait_until(Duration::from_secs(2), || paths(&fence(&core, &root, CESTY, 1, &env())) == title_desc);
    assert!(t.is_some(), "block 1 follows its new line 12");
    assert_eq!(fence(&core, &root, CESTY, 1, &env()).usage.map(|u| u.own.sort.is_some()), Some(true), "as its own sort");
}

// ------------------------------------------------------------------------------------------------ FR-SYN-02 AC-12

const KILL_TEST: &str = "fr_syn_02_ac12_usage_writes_are_atomic";
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
    let a = exp("notes/knihy-na-cesty-b1-click-author.md");
    let z = overlay_file(CESTY);
    while start.elapsed() < Duration::from_secs(20) {
        i += 1;
        if kind == "tab" {
            let Some(v) = core.type_get("book").and_then(|t| t.version) else { fail("no type version".into()) };
            let sort = if i % 2 == 1 { us(&[("finished", true)]) } else { us(&[("rating", true), ("title", true)]) };
            if let Err(e) = core.type_patch("book", Some(&v), &[TypeOp::SetViewSort { name: P26.into(), sort: Some(sort) }]) {
                fail(format!("{e:?}"))
            }
        } else {
            let Ok((_, v)) = core.read_note(CESTY, SystemTime::now()) else { fail("read".into()) };
            let t = if i % 2 == 1 { &a } else { &z };
            if let Err(e) = core.write_note(CESTY, t.as_bytes(), Some(&v)) {
                fail(format!("{e:?}"))
            }
        }
    }
    std::process::exit(0)
}

#[test]
fn fr_syn_02_ac12_usage_writes_are_atomic() {
    if let Ok(dir) = std::env::var("TEGG_USAGE_KILL_CHILD") {
        let dir = PathBuf::from(dir);
        let ready = PathBuf::from(std::env::var("TEGG_USAGE_KILL_READY").expect("setup: ready path"));
        let kind = std::env::var("TEGG_USAGE_KILL_KIND").expect("setup: kind");
        kill_child(&dir.join("vault"), &dir.join("app"), &ready, &kind);
    }
    let sb = sandbox();
    let work = sb.base.join("kill");
    let root = work.join("vault");
    copy_dir(&repo_root().join("tests/fixtures/vaults/views"), &root, &["README.md"]);
    copy_dir(&repo_root().join("tests/fixtures/vaults/new-empty/.tegg"), &root.join(".tegg"), &[]);
    copy_dir(&repo_root().join("tests/fixtures/vaults/views-usage"), &root, &["README.md"]);
    std::fs::create_dir_all(work.join("app")).expect("setup: app dir");
    let cases: Vec<(&str, String, Vec<String>)> = vec![
        ("tab", BOOK.to_string(), vec![overlay_file(".tegg/types/book.yml"), exp("types/book-overlay-prectene-click-finished.yml")]),
        ("fence", CESTY.to_string(), vec![overlay_file(CESTY), exp("notes/knihy-na-cesty-b1-click-author.md")]),
    ];
    let exe = std::env::current_exe().expect("setup: test binary");
    let mut seed: u64 = 0x5132_1557_4147_19;
    let mut bad: Vec<String> = Vec::new();
    for (kind, rel, allowed) in &cases {
        let mut wrote = 0usize;
        let bad0 = bad.len();
        for cycle in 0..KILL_CYCLES {
            std::fs::write(root.join(rel), &allowed[0]).expect("setup: restore the file");
            let ready = work.join(format!("ready-{kind}-{cycle}"));
            let mut child = Command::new(&exe)
                .args(["--exact", KILL_TEST, "--nocapture", "--test-threads=1"])
                .env("TEGG_USAGE_KILL_CHILD", &work)
                .env("TEGG_USAGE_KILL_READY", &ready)
                .env("TEGG_USAGE_KILL_KIND", kind)
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
            std::thread::sleep(Duration::from_micros(200 + seed % 3000));
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
    write(&root, "Pages/.Knihy na cesty.md.4242.tegg-tmp", b"---\ntype: page\ntitle: Polovina\n---\n");
    let core = open(&root, &sb.dirs, false);
    if core.type_get("polovina").is_some() || run(&core, VYB, &env()).rows.iter().any(|r| r.path.contains("tegg-tmp")) || core.query_usages(P26).iter().any(|u| u.path.contains("tegg-tmp")) {
        bad.push("a temp file is listed".into());
    }
    assert_eq!(bad, Vec::<String>::new(), "after every kill each file is its complete old or new bytes");
}

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-31

#[test]
fn fr_syn_03_ac31_usage_writes_check_the_base() {
    let sb = sandbox();
    let root = overlay_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let base = type_base(&core);
    let o = overlay_file(".tegg/types/book.yml");
    let changed_book = swapped(&o, "description: Knihy, které", "description: Knížky, které");
    write(&root, BOOK, changed_book.as_bytes());
    for (what, op) in [
        ("a header click", TypeOp::SetViewSort { name: P26.into(), sort: Some(us(&[("finished", true)])) }),
        ("Use the query's sort", TypeOp::SetViewSort { name: P26.into(), sort: None }),
        ("a Columns change", TypeOp::SetViewColumns { name: P26.into(), columns: Some(strs(&["author"])) }),
        ("a header drag", TypeOp::SetViewColumns { name: P26.into(), columns: Some(strs(&["rating", "author", "finished", "genres"])) }),
        ("Use the query's columns", TypeOp::SetViewColumns { name: P26.into(), columns: None }),
    ] {
        let r = core.type_patch("book", Some(&base), &[op]);
        assert!(matches!(r, Err(CoreError::Vault(VaultError::Conflict { .. }))), "{what} on a changed book.yml: Conflict, got {r:?}");
        assert_eq!(disk_s(&root, BOOK), Some(changed_book.clone()), "{what}: nothing written");
    }
    // Same bytes with only a new mtime: no conflict (D-175).
    write(&root, BOOK, o.as_bytes());
    reread(&core, &[BOOK]);
    let b2 = type_base(&core);
    std::thread::sleep(Duration::from_millis(20));
    write(&root, BOOK, o.as_bytes());
    let r = core.type_patch("book", Some(&b2), &[TypeOp::SetViewSort { name: P26.into(), sort: Some(us(&[("finished", true)])) }]);
    assert!(r.is_ok(), "same bytes, new mtime: written, got {r:?}");
    assert_eq!(disk_s(&root, BOOK), Some(exp("types/book-overlay-prectene-click-finished.yml")), "the change is written");
    // A block write over a changed note is refused (the editor reloads).
    let (_, v) = ok!(core.read_note(CESTY, SystemTime::now()), "read Cesty");
    let outside = swapped(&overlay_file(CESTY), "Co si vzít do vlaku.", "Co si vzít do letadla.");
    write(&root, CESTY, outside.as_bytes());
    let r = core.write_note(CESTY, exp("notes/knihy-na-cesty-b1-click-author.md").as_bytes(), Some(&v));
    assert!(r.is_err(), "a fence write over an external change is refused");
    assert_eq!(disk_s(&root, CESTY), Some(outside), "the note keeps the outside change");
}

// ------------------------------------------------------------------------------------------------ FR-TPL-04 AC-3

#[test]
fn fr_tpl_04_ac3_template_usage_settings_are_copied() {
    let sb = sandbox();
    let root = vault(&sb);
    let tpl = exp("templates/seznam-knih.md");
    write(&root, "_templates/Page/Seznam knih.md", tpl.as_bytes());
    let core = open(&root, &sb.dirs, false);
    // The UI makes the note's bytes from the template; the core stores them as given.
    let text = format!("---\nid: 01JB5V00000000000000000032\ntype: page\ntitle: Seznam na léto\ncreated: {NOW}\nmodified: {NOW}\n---\n{}", exp("notes/seznam-knih-new.md"));
    let path = ok!(core.create_note("Pages", "Seznam na léto", text.as_bytes()), "create the Page");
    assert_eq!(disk_s(&root, &path).map(|t| t.ends_with(&tpl)), Some(true), "the template's fence copied byte for byte");
    let r = fence(&core, &root, &path, 1, &env());
    assert_eq!(paths(&r), bs(&["Cizí přístavy", "Čarovná mapa", "Kniha o čaji", "Mapa bez severu", "Sto zimních dní", "Šest cest k moři", "Tiché město", "Zahrada v dešti"]), "the new note's block orders by title (its own sort)");
    assert_eq!(r.usage.map(|u| u.kind), Some(tegg_core::queries_q::UsageKind::Block), "a block usage");
    let t = fence(&core, &root, "_templates/Page/Seznam knih.md", 1, &env());
    assert_eq!(t.usage.and_then(|u| u.own.sort).map(|s| sorts(&s)), Some(json!([{ "by": "title", "order": "asc" }])), "the template's block is a usage too");
    assert!(core.query_usages(P26).iter().any(|u| u.template && tegg_format::nfc(&u.path) == "_templates/Page/Seznam knih.md"), "the template counts in Used on");
}
