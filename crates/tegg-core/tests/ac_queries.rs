//! Slice Q L4 / L3 tests of saved queries and the query block (docs/acceptance/queries.md R138…R146; docs/contracts/
//! v1-queries.md §1): the query-file parser, patcher and writer in `tegg_core::queries_q`, the evaluator over the index
//! (`Core::query_run`), lookups, usages, trash and restore, pins of queries, the watcher's events, NFC, the kill harness
//! and FR-STO-06 AC-3. The L3 conformance file `tests/fixtures/queries-files/expected.json` (contract §6.2) is read here
//! and by `app/test/queries_twin.ac.test.ts`. The test clock is `2026-11-10T10:00:00+01:00`, Europe/Prague, region `cs`
//! (always injected, D-1449). Written from the ACs, the fixtures and the contract only (D-61); every check is an
//! assertion in this file.

mod common;
mod queries_setup;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc::Receiver;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

use common::{fresh_dirs, repo_root, sandbox, snapshot, wait_until, CountingFs, Entry};
use queries_setup::*;
use serde_json::{json, Value};
use tegg_core::pinned::{PinOp, PinRequest, PinState};
use tegg_core::queries_q::{
    self, BrokenReason, FenceRead, FileState, FilterItem, Form, Lookup, Match, Op, Order, QueryCreate, QueryDef, QueryError, QueryRead,
    QueryResult, QuerySource, RunState, View,
};
use tegg_core::{Core, CoreError, CoreEvent, CoreOptions, FileVersion, SystemTrash, TrashKind, VaultError, VaultFs};
use tegg_format::nfc;
use tegg_vault::LocalFs;

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

const NOW2: &str = "2026-11-10T10:05:00+01:00";

// ------------------------------------------------------------------------------------------------ helpers (asserting)

fn run(core: &Core, name: &str, host: Option<&str>) -> QueryResult {
    core.query_run(QuerySource::Saved(name.into()), host, &env())
}
fn run_env(core: &Core, name: &str, host: Option<&str>, e: &queries_q::QueryEnv) -> QueryResult {
    core.query_run(QuerySource::Saved(name.into()), host, e)
}
fn run_def(core: &Core, d: QueryDef, host: Option<&str>) -> QueryResult {
    core.query_run(QuerySource::Def { def: d, name: None }, host, &env())
}
fn run_def_env(core: &Core, d: QueryDef, host: Option<&str>, e: &queries_q::QueryEnv) -> QueryResult {
    core.query_run(QuerySource::Def { def: d, name: None }, host, e)
}
fn run_fence(core: &Core, body: &str, host: Option<&str>) -> QueryResult {
    core.query_run(QuerySource::Fence(body.into()), host, &env())
}
/// The query as read now: its definition and version (asserted present).
fn current(core: &Core, name: &str) -> (QueryDef, FileVersion) {
    let r = core.query(name);
    let d = some!(r.def.clone(), format!("query({name}).def"));
    let v = some!(r.version.clone(), format!("query({name}).version"));
    (d, v)
}
/// A commit of the editor: the current definition with `edit` applied, the current version as base.
fn commit(core: &Core, name: &str, now: &str, edit: impl FnOnce(&mut QueryDef)) -> Result<QueryRead, CoreError> {
    let (mut d, v) = current(core, name);
    edit(&mut d);
    core.query_apply(name, &v, d, now)
}
fn is_q(r: &Result<QueryRead, CoreError>, want: QueryError) -> bool {
    matches!(r, Err(CoreError::Query(e)) if *e == want)
}
fn changed(a: &BTreeMap<String, Entry>, b: &BTreeMap<String, Entry>) -> BTreeSet<String> {
    let keys: BTreeSet<&String> = a.keys().chain(b.keys()).collect();
    keys.into_iter().filter(|k| a.get(*k) != b.get(*k)).map(|k| nfc(k)).collect()
}
fn files_changed(a: &BTreeMap<String, Entry>, b: &BTreeMap<String, Entry>) -> BTreeSet<String> {
    changed(a, b).into_iter().filter(|k| !k.ends_with('/')).collect()
}
fn reason(b: &queries_q::Broken) -> BrokenReason {
    b.reason
}
fn note_write(core: &Core, path: &str, text: &str) {
    let (_, v) = ok!(core.read_note(path, SystemTime::now()), format!("read {path}"));
    ok!(core.write_note(path, text.as_bytes(), Some(&v)), format!("write {path}"));
    let _ = core.wait_idle(Duration::from_secs(30));
}
fn drain(rx: &Receiver<CoreEvent>, ms: u64) -> Vec<CoreEvent> {
    let mut out = Vec::new();
    let end = Instant::now() + Duration::from_millis(ms);
    while let Ok(e) = rx.recv_timeout(end.saturating_duration_since(Instant::now()).max(Duration::from_millis(1))) {
        out.push(e);
        if Instant::now() > end {
            break;
        }
    }
    out
}
fn tmp_files(root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    fn walk(root: &Path, dir: &Path, out: &mut Vec<String>) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(root, &p, out);
            } else if e.file_name().to_string_lossy().ends_with(".tegg-tmp") {
                out.push(p.strip_prefix(root).map(|r| r.to_string_lossy().into_owned()).unwrap_or_default());
            }
        }
    }
    walk(root, root, &mut out);
    out
}
fn names(core: &Core) -> Vec<String> {
    core.queries().iter().map(|q| nfc(&q.name)).collect()
}

/// A Trash view sink: moves the file out of the vault (the system trash stand-in).
struct Sink(PathBuf);
impl SystemTrash for Sink {
    fn trash(&self, abs: &Path) -> std::io::Result<()> {
        std::fs::create_dir_all(&self.0)?;
        let name = abs.file_name().map(|n| n.to_os_string()).unwrap_or_default();
        std::fs::rename(abs, self.0.join(name))
    }
}

// ================================================================================================ L3: expected.json

#[test]
fn fr_qry_06_ac1_query_files_read_as_expected_json() {
    let ex = expected_json();
    let reads = ex["reads"].as_object().cloned().unwrap_or_default();
    assert_eq!(reads.len(), 12, "setup: expected.json lists the eleven query files and the trashed one");
    let mut bad = Vec::new();
    for (rel, want) in reads {
        let f = queries_q::read(&fixture(&rel));
        let (state, line) = match &f.state {
            FileState::Ok => ("ok", None),
            FileState::Newer { .. } => ("newer", None),
            FileState::Unreadable { line, .. } => ("unreadable", *line),
        };
        let got = json!({
            "state": state,
            "line": line,
            "def": if state == "unreadable" { Value::Null } else { def_dto(&f.def) },
            "broken": f.broken.iter().map(broken_dto).collect::<Vec<_>>(),
            "usesThis": f.uses_this,
        });
        if got != want {
            bad.push(format!("{rel}:\n  got  {got}\n  want {want}"));
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "queries_q::read agrees with expected.json `reads` (R138, R139)");
}

#[test]
fn fr_qry_06_ac1_queries_entry_and_list() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    let list = core.queries();
    let got: BTreeSet<String> = list.iter().map(|q| nfc(&q.name)).collect();
    let want = set(&[OTEVRENE, UKOLY, VSE, PROJEKTY, KNIHY, ZRUSENE, PO_TERMINU, VYTVORENO, KOMENTARE, NECITELNY, NOVEJSI]);
    assert_eq!(got, want, "the eleven files of .tegg/queries/ are listed; Starý dotaz (trash) isn't");
    assert_eq!(list.len(), 11, "count 11, no duplicates");
    for q in &list {
        assert_eq!(nfc(&q.path), qpath(&nfc(&q.name)), "{}: its path", q.name);
        let want_lookup = match nfc(&q.name).as_str() {
            NECITELNY => Lookup::Unreadable,
            NOVEJSI => Lookup::Newer,
            _ => Lookup::Ok,
        };
        assert_eq!(q.lookup, want_lookup, "{}: state", q.name);
    }
    let bad = some!(list.iter().find(|q| nfc(&q.name) == NECITELNY), "Nečitelný listed");
    assert_eq!(bad.line, Some(5), "`Can't be read (line 5)`");
    let p = some!(list.iter().find(|q| nfc(&q.name) == PROJEKTY), "Projekty v běhu listed");
    assert_eq!(p.title, PROJEKTY, "title");
    assert_eq!(p.created.as_deref(), Some("2026-09-30T09:00:00+02:00"), "created as written");
    assert_eq!(p.modified.as_deref(), Some("2026-10-15T09:00:00+02:00"), "modified as written");
    assert!(!p.uses_this && list.iter().find(|q| nfc(&q.name) == OTEVRENE).is_some_and(|q| q.uses_this), "usesThis");
    // The page's default order, Created ↓, then the unreadable file last (R143).
    let mut readable: Vec<_> = list.iter().filter(|q| q.lookup != Lookup::Unreadable).collect();
    readable.sort_by(|a, b| b.created.cmp(&a.created));
    let order: Vec<String> = readable.iter().map(|q| nfc(&q.name)).collect();
    assert_eq!(order, strs(&[VYTVORENO, OTEVRENE, UKOLY, VSE, PROJEKTY, KNIHY, ZRUSENE, PO_TERMINU, KOMENTARE, NOVEJSI]), "Created ↓");
}

#[test]
fn fr_fmt_06_ac4_fence_forms_match_expected_json() {
    let ex = expected_json();
    let fences = ex["fences"].as_object().cloned().unwrap_or_default();
    assert_eq!(fences.len(), 6, "setup: six notes with fences");
    let mut bad = Vec::new();
    for (rel, want) in fences {
        let text = fixture_s(&rel);
        let found = tegg_format::query_fences(&text);
        let got: Vec<Value> = found
            .iter()
            .map(|f| {
                let (form, line) = match queries_q::read_fence(&f.body) {
                    FenceRead::Empty => ("empty", None),
                    FenceRead::Reference { .. } => ("reference", None),
                    FenceRead::Inline(_) => ("inline", None),
                    FenceRead::Unreadable { line } => ("unreadable", Some(line)),
                };
                json!({ "range": [f.range.start, f.range.end], "saved": f.saved, "nested": f.nested, "form": form, "line": line })
            })
            .collect();
        if Value::Array(got.clone()) != want {
            bad.push(format!("{rel}:\n  got  {}\n  want {want}", Value::Array(got)));
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "query_fences + read_fence agree with expected.json `fences` (R140)");
}

/// R146 (T2): every expected row, and no result is ever in `.trash/`, in `_templates/` or the host (FR-QRY-02 AC-7).
#[test]
fn fr_qry_02_ac7_no_trash_templates_or_host() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    let ex = expected_json();
    let rows = ex["results"].as_array().cloned().unwrap_or_default();
    assert!(rows.len() >= 15, "setup: R146 rows in expected.json");
    let mut bad = Vec::new();
    for row in &rows {
        let q = row["query"].as_str().unwrap_or("");
        let host = row["host"].as_str();
        let e = env_of(&row["env"]);
        let r = run_env(&core, q, host, &e);
        let got_paths: Vec<Value> = paths(&r).into_iter().map(Value::from).collect();
        let state = match r.state {
            RunState::Ok => "ok",
            RunState::NoType => "noType",
            RunState::NeedsHost => "needsHost",
            RunState::NeedsContext => "needsContext",
        };
        let got = json!({ "paths": got_paths, "state": state, "broken": r.broken.iter().map(broken_dto).collect::<Vec<_>>() });
        let want = json!({ "paths": row["paths"], "state": row["state"], "broken": row["broken"] });
        if got != want || r.lookup != Some(Lookup::Ok) && q != NOVEJSI {
            bad.push(format!("{q} on {host:?} ({}): got {got} lookup {:?}, want {want}", row["env"], r.lookup));
        }
        for p in paths(&r) {
            if p.starts_with(".trash/") || p.starts_with("_templates/") || Some(p.as_str()) == host {
                bad.push(format!("{q} on {host:?}: {p} is a result"));
            }
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "R146 on the fixture");
    // Runtime: a link in the template and a self-link in Lisabon change nothing.
    let sab = fixture_s(SABLONA) + "\nViz [[Výjezd Lisabon 2026]].\n";
    write(&root, SABLONA, sab.as_bytes());
    note_write(&core, LISABON, &(fixture_s(LISABON) + "\nSám sebe: [[Výjezd Lisabon 2026]].\n"));
    reread(&core, &[SABLONA]);
    assert_eq!(paths(&run(&core, VSE, Some(LISABON))), strs(&[DOTAZ, T2, P7, BEZ]), "neither the template nor the host is a result");
    // Moving T1 to the trash removes it; restoring brings it back.
    let (_, v) = ok!(core.read_note(T1, SystemTime::now()), "read T1");
    let trashed = ok!(core.trash_note(T1, &v), "trash T1");
    let _ = core.wait_idle(Duration::from_secs(30));
    assert_eq!(paths(&run(&core, OTEVRENE, Some(P7))), strs(&[T2, T3]), "T1 in the trash is no result");
    ok!(core.trash_restore(&trashed), "restore T1");
    let _ = core.wait_idle(Duration::from_secs(30));
    assert_eq!(paths(&run(&core, OTEVRENE, Some(P7))), strs(&[T1, T2, T3]), "restored, T1 is back");
}

// ================================================================================================ FR-QRY-01

#[test]
fn fr_qry_01_ac1_show_types() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    let tasks = run_def(&core, def(&["task"], vec![]), None);
    assert_eq!(path_set(&tasks), set(&ALL_TASKS), "Task: the seven tasks outside the trash");
    let mixed = run_def(&core, def(&["task", "projekt"], vec![]), None);
    assert_eq!(mixed.rows.len(), 12, "Task + Projekt: 7 + 5");
    let all = run_def(&core, def(&[], vec![]), None);
    let want = set(&[P7, P14, T1, T2, T3, T4, T5, T6, T7, LISABON, ROZPOCET, CAJOVNA, CESTA, MALY, JANA, MLOCI, KRAKATIT, DOTAZ, DEN, PREHLED, BEZ]);
    assert_eq!(path_set(&all), want, "none = all types: 21 objects outside .trash/ and _templates/ (no host)");
    let bez = some!(all.rows.iter().find(|r| nfc(&r.path) == BEZ), "Bez hlavičky");
    assert_eq!(bez.r#type, "page", "no frontmatter counts as Page (D-103)");
    // The commit writes the types.
    ok!(core.query_create(QueryCreate { title: "Úkoly na víkend".into(), def: None, fence: None, free: false }, NOW), "create");
    ok!(commit(&core, "Úkoly na víkend", NOW2, |d| d.types = strs(&["task", "projekt"])), "commit [task, projekt]");
    let base = expected("expected/created.yml");
    let after = swapped(&base, &[("types: []", "types: [task, projekt]"), ("modified: 2026-11-10T10:00:00+01:00", &format!("modified: {NOW2}"))]);
    assert_eq!(disk_s(&root, &qpath("Úkoly na víkend")), Some(after.clone()), "`types: [task, projekt]`");
    ok!(commit(&core, "Úkoly na víkend", "2026-11-10T10:06:00+01:00", |d| d.types = vec![]), "commit []");
    let after2 = swapped(&after, &[("types: [task, projekt]", "types: []"), (&format!("modified: {NOW2}"), "modified: 2026-11-10T10:06:00+01:00")]);
    assert_eq!(disk_s(&root, &qpath("Úkoly na víkend")), Some(after2), "`types: []`");
}

#[test]
fn fr_qry_01_ac3_and_or_two_levels() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    let (base_def, _) = current(&core, UKOLY);
    let mut d = base_def.clone();
    d.filters.push(f("status", Op::IsNot, json!("Done")));
    assert_eq!(path_set(&run_def(&core, d.clone(), Some(P7))), set(&[T1, T2, T3, T4]), "links to this AND status is not Done: 4");
    d.filters.push(group(Match::Any, vec![f("due", Op::WithinNextDays, json!(14)), f("priority", Op::Is, json!("High"))]));
    assert_eq!(paths(&run_def(&core, d.clone(), Some(P7))), strs(&[T1, T2, T3]), "with the any-group: R146's Porada 7 row");
    d.r#match = Match::Any;
    assert_eq!(path_set(&run_def(&core, d.clone(), Some(P7))), set(&ALL_TASKS), "or: all seven tasks");
    let before = snapshot(&root);
    let (_, v) = current(&core, UKOLY);
    ok!(core.query_apply(UKOLY, &v, d, NOW), "commit");
    let want = swapped(
        &qfixture(UKOLY),
        &[
            ("match: all", "match: any"),
            ("  - links_to: this\n", "  - links_to: this\n  - status: { is_not: Done }\n  - group:\n      match: any\n      filters:\n        - due: { within_next_days: 14 }\n        - priority: High\n"),
            ("modified: 2026-10-07T12:00:00+02:00", &format!("modified: {NOW}")),
        ],
    );
    assert_eq!(disk_s(&root, &qpath(UKOLY)), Some(want), "`match: any` and the group in R138's shape");
    assert_eq!(files_changed(&before, &snapshot(&root)), set(&[&qpath(UKOLY)]), "one file written");
}

#[test]
fn fr_qry_01_ac4_sort_and_limit() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    let (d, _) = current(&core, UKOLY);
    let by = |b: &str, o: Order, e: &queries_q::QueryEnv| paths(&run_def_env(&core, sorted(d.clone(), b, o), Some(P7), e));
    assert_eq!(by("due", Order::Asc, &env()), strs(&[T5, T1, T2, T3, T4]), "due ↑, empty last");
    assert_eq!(by("due", Order::Desc, &env()), strs(&[T3, T2, T1, T5, T4]), "due ↓, empty still last");
    assert_eq!(by("priority", Order::Asc, &env()), strs(&[T1, T3, T5, T2, T4]), "priority ↑: option order, ties by title (D-477)");
    assert_eq!(by("title", Order::Asc, &env()), strs(&[T1, T3, T5, T2, T4]), "title ↑ with cs");
    assert_eq!(by("title", Order::Asc, &env_us()), strs(&[T1, T3, T5, T2, T4]), "title ↑ with en-US (C)");
    let before = stamp(&root, &qpath(UKOLY));
    for bad in [0u32, 1001] {
        let r = commit(&core, UKOLY, NOW, |d| d.limit = bad);
        assert!(is_q(&r, QueryError::Limit), "limit {bad} refused with Limit: {r:?}");
    }
    assert_eq!(stamp(&root, &qpath(UKOLY)), before, "nothing written");
    ok!(commit(&core, UKOLY, NOW, |d| d.limit = 1000), "limit 1000 is allowed");
    assert!(disk_s(&root, &qpath(UKOLY)).is_some_and(|t| t.contains("\nlimit: 1000\n")), "`limit: 1000`");
}

#[test]
fn fr_qry_01_ac5_editor_commits_once() {
    let sb = sandbox();
    let root = vault(&sb);
    let fs = CountingFs::new(LocalFs::new(&root));
    let core = ok!(Core::open_with(fs.clone() as Arc<dyn VaultFs>, &sb.dirs, CoreOptions { watch: false, sync: None }), "Core::open_with");
    let _ = core.wait_idle(Duration::from_secs(60));
    let original = disk(&root, &qpath(PROJEKTY));
    // Live results (Def runs) write nothing.
    let (d, v) = current(&core, PROJEKTY);
    let w0 = fs.write_count();
    let mut live = d.clone();
    live.view = View::List;
    let _ = run_def(&core, live.clone(), Some(PREHLED));
    assert_eq!(fs.write_count(), w0, "a live run writes nothing");
    // A commit with no change writes nothing.
    let same = ok!(core.query_apply(PROJEKTY, &v, d.clone(), NOW), "no-op commit");
    assert_eq!(fs.write_count(), w0, "zero writes for an unchanged definition");
    assert_eq!(same.version.as_ref(), Some(&v), "same version");
    // A commit with a change writes once.
    let r = ok!(core.query_apply(PROJEKTY, &v, live, NOW), "commit view: list");
    assert_eq!(fs.write_count() - w0, 1, "one write");
    // Undo: the previous bytes in one write.
    let after = some!(r.version.clone(), "version after the commit");
    let text = String::from_utf8(original.clone().unwrap_or_default()).unwrap_or_default();
    let w1 = fs.write_count();
    ok!(core.query_revert(PROJEKTY, &after, &text), "revert");
    assert_eq!(fs.write_count() - w1, 1, "undo is one write");
    assert_eq!(disk(&root, &qpath(PROJEKTY)), original, "undo restores the bytes");
}

#[test]
fn fr_qry_01_ac7_no_group_by_yet() {
    let sb = sandbox();
    let root = vault(&sb);
    let start = swapped(&qfixture(ZRUSENE), &[("match: all\n", "match: all\ngroup_by: status\n")]);
    write(&root, &qpath(ZRUSENE), start.as_bytes());
    let core = open(&root, &sb.dirs);
    let r = core.query(ZRUSENE);
    assert_eq!(r.lookup, Lookup::Ok, "group_by is an unknown key: still readable");
    assert_eq!(r.broken, vec![], "and not a broken part");
    ok!(commit(&core, ZRUSENE, NOW, |d| d.view = View::Table), "commit Table");
    let want = swapped(&start, &[("view: list", "view: table"), ("modified: 2026-10-09T09:00:00+02:00", &format!("modified: {NOW}"))]);
    assert_eq!(disk_s(&root, &qpath(ZRUSENE)), Some(want), "group_by kept byte for byte");
}

// ================================================================================================ FR-QRY-02

fn both(core: &Core, types: &[&str], key: &str, op: Op, v: Value, nfd_v: Value) -> (BTreeSet<String>, BTreeSet<String>) {
    (path_set(&run_def(core, def(types, vec![f(key, op, v)]), None)), path_set(&run_def(core, def(types, vec![f(&nfd(key), op, nfd_v)]), None)))
}

#[test]
fn fr_qry_02_ac2_text_and_select_fold_case_and_diacritics() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    let cases: Vec<(&[&str], &str, Op, Value, Vec<&str>)> = vec![
        (&["osoba"], "firma", Op::Is, json!("účetní S.R.O."), vec![JANA]),
        (&["osoba"], "firma", Op::Contains, json!("ucetni"), vec![JANA]),
        (&[], "title", Op::Contains, json!("mlok"), vec![MLOCI]),
        (&["projekt"], "stav", Op::Is, json!("aktivní"), vec![CESTA, CAJOVNA, LISABON, MALY]),
        (&["projekt"], "stav", Op::IsAnyOf, json!(["Hotovo", "Pozastaveno"]), vec![ROZPOCET]),
        (&["projekt"], "stav", Op::IsEmpty, json!(true), vec![]),
        (&["projekt"], "stav", Op::IsNot, json!("Aktivní"), vec![ROZPOCET]),
    ];
    for (types, key, op, v, want) in cases {
        let nv = match &v {
            Value::String(s) => Value::String(nfd(s)),
            Value::Array(a) => Value::Array(a.iter().map(|x| Value::String(nfd(x.as_str().unwrap_or("")))).collect()),
            o => o.clone(),
        };
        let (a, b) = both(&core, types, key, op, v.clone(), nv);
        assert_eq!(a, set(&want), "{key} {op:?} {v}");
        assert_eq!(b, set(&want), "{key} {op:?} {v} typed in NFD");
    }
}

#[test]
fn fr_qry_02_ac3_dates_use_the_local_day() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    let before = snapshot(&root);
    let due = |op: Op, v: Value, e: &queries_q::QueryEnv| path_set(&run_def_env(&core, def(&["task"], vec![f("due", op, v)]), None, e));
    assert_eq!(due(Op::Today, json!(true), &env()), set(&[]), "due today: none");
    assert_eq!(due(Op::Is, json!("2026-11-12"), &env()), set(&[T1]), "due is 2026-11-12");
    assert_eq!(due(Op::Before, json!("2026-11-12"), &env()), set(&[T5, T7, T6]), "before");
    assert_eq!(due(Op::After, json!("2026-11-14"), &env()), set(&[T3]), "after");
    assert_eq!(due(Op::Between, json!(["2026-11-11", "2026-11-14"]), &env()), set(&[T6, T1, T2]), "between, inclusive");
    assert_eq!(due(Op::ThisWeek, json!(true), &env()), set(&[T7, T6, T1, T2]), "this week (cs: Mon 9 – Sun 15)");
    assert_eq!(due(Op::WithinNextDays, json!(14), &env()), set(&[T6, T1, T2]), "within next 14 days (10–24 Nov)");
    assert_eq!(due(Op::Overdue, json!(true), &env()), set(&[T7]), "overdue (T5 is Done)");
    assert_eq!(due(Op::IsEmpty, json!(true), &env()), set(&[T4]), "is empty");
    assert_eq!(due(Op::ThisWeek, json!(true), &env_us()), set(&[T7, T6, T1, T2]), "this week (en-US: Sun 8 – Sat 14) (C)");
    let sunday_cs = env_at("2026-11-15", "Europe/Prague", chrono::Weekday::Mon, "cs");
    let sunday_us = env_at("2026-11-15", "Europe/Prague", chrono::Weekday::Sun, "en-US");
    assert_eq!(due(Op::ThisWeek, json!(true), &sunday_cs), set(&[T7, T6, T1, T2]), "Sunday 15 Nov, cs: still the week of 9–15");
    assert_eq!(due(Op::ThisWeek, json!(true), &sunday_us), set(&[]), "Sunday 15 Nov, en-US: the week of 15–21 holds none");
    let created = |e: &queries_q::QueryEnv| path_set(&run_def_env(&core, def(&[], vec![f("created", Op::Is, json!("2026-11-10"))]), None, e));
    assert_eq!(created(&env()), set(&[T7, KRAKATIT, DOTAZ, DEN]), "created is 2026-11-10 in Europe/Prague");
    assert_eq!(created(&env_zone("America/New_York")), set(&[DOTAZ, DEN]), "in America/New_York (Z)");
    assert_eq!(created(&env_zone("Pacific/Kiritimati")), set(&[T7, KRAKATIT, DOTAZ, DEN]), "in Pacific/Kiritimati (Z)");
    let r = run_def(&core, def(&["task"], vec![f("due", Op::Overdue, json!(true))]), None);
    assert!(r.uses_relative, "a relative date operator sets usesRelative");
    assert_eq!(files_changed(&before, &snapshot(&root)), BTreeSet::new(), "the files never change");
}

#[test]
fn fr_qry_02_ac4_tags_any_all_none() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    let tags = |types: &[&str], op: Op, v: Value| path_set(&run_def(&core, def(types, vec![f("tags", op, v)]), None));
    assert_eq!(tags(&[], Op::HasAnyOf, json!(["finance"])), set(&[T1, T7, ROZPOCET, DOTAZ]), "has any of [finance]");
    assert_eq!(tags(&[], Op::HasAllOf, json!(["finance", "q4"])), set(&[T1, ROZPOCET]), "has all of [finance, q4]");
    assert_eq!(tags(&["task"], Op::HasNoneOf, json!(["offsite", "finance"])), set(&[T4, T5, T6]), "has none of, among Tasks");
    assert_eq!(tags(&[], Op::HasAnyOf, json!(["#q4"])), set(&[T1, LISABON, ROZPOCET]), "a value with # is a tag key (R79)");
    note_write(&core, T4, &(fixture_s(T4) + "#Finance\n"));
    assert_eq!(tags(&[], Op::HasAnyOf, json!(["finance"])), set(&[T1, T4, T7, ROZPOCET, DOTAZ]), "an inline #Finance counts, case folded");
}

#[test]
fn fr_qry_02_ac5_numbers_and_checkboxes() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    let num = |op: Op, v: Value| path_set(&run_def(&core, def(&["projekt"], vec![f("rozpočet", op, v)]), None));
    assert_eq!(num(Op::Gt, json!(5000)), set(&[LISABON, CAJOVNA]), "> 5000");
    assert_eq!(num(Op::Eq, json!(5000)), set(&[ROZPOCET]), "= 5000");
    assert_eq!(num(Op::Ne, json!(5000)), set(&[LISABON, CAJOVNA, CESTA]), "≠ 5000: Malý has no value and never matches");
    assert_eq!(num(Op::Between, json!([3000, 8000])), set(&[ROZPOCET, CAJOVNA, CESTA]), "between [3000, 8000]");
    let chk = |v: bool| path_set(&run_def(&core, def(&["kniha"], vec![f("přečteno", Op::Is, json!(v))]), None));
    assert_eq!(chk(true), set(&[KRAKATIT]), "is checked");
    assert_eq!(chk(false), set(&[MLOCI]), "is not checked");
    let cesta = swapped(&fixture_s(CESTA), &[("rozpočet: 3000", "rozpočet: \"lots\"")]);
    note_write(&core, CESTA, &cesta);
    let before = stamp(&root, CESTA);
    assert_eq!(num(Op::Ne, json!(5000)), set(&[LISABON, CAJOVNA]), "a string is no number: ≠ drops Cesta");
    assert_eq!(num(Op::Lt, json!(1_000_000)), set(&[LISABON, ROZPOCET, CAJOVNA]), "< drops Cesta");
    assert_eq!(num(Op::Between, json!([0, 1_000_000])), set(&[LISABON, ROZPOCET, CAJOVNA]), "between drops Cesta");
    assert_eq!(stamp(&root, CESTA), before, "the file isn't rewritten");
}

#[test]
fn fr_qry_02_ac6_links_to_and_linked_from() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    let q = |types: &[&str], key: &str, op: Op, v: &str, host: Option<&str>| path_set(&run_def(&core, def(types, vec![f(key, op, json!(v))]), host));
    assert_eq!(q(&[], "links_to", Op::Is, "[[Výjezd Lisabon 2026]]", None), set(&[P7, T2, DOTAZ, BEZ]), "links to Lisabon: its Backlinks");
    let bl: BTreeSet<String> = core.backlinks(LISABON).into_iter().map(|p| nfc(&p)).collect();
    assert_eq!(q(&[], "links_to", Op::Is, "[[Výjezd Lisabon 2026]]", None), bl, "the Backlinks panel's list (FR-LNK-01)");
    assert_eq!(q(&[], "linked_from", Op::Is, "[[2026-10-07 Týdenní porada]]", None), set(&[JANA, LISABON, P14]), "linked from Porada 7");
    assert_eq!(q(&["projekt"], "vlastník", Op::LinksTo, "[[Jana Nováková]]", None), set(&[LISABON]), "vlastník links to Jana");
    assert_eq!(q(&["task"], "source", Op::LinksTo, "this", Some(P7)), set(&[T1, T3, T4, T5]), "source links to this (not T2)");
    assert_eq!(q(&[], "links_to", Op::Is, "[[01JB5Q00000000000000000011]]", None), set(&[P7, T2, DOTAZ, BEZ]), "resolved by id (FR-LNK-14)");
    assert_eq!(q(&[], "links_to", Op::Is, "[[Neexistuje]]", None), set(&[]), "an unresolved value matches nothing");
    let r = run_def(&core, def(&[], vec![f("links_to", Op::Is, json!("[[Výjezd Lisabon 2026]]"))]), None);
    assert_eq!(r.targets.iter().map(|t| nfc(t)).collect::<Vec<_>>(), strs(&[LISABON]), "targets: the resolved value");
    // A runtime duplicate title: the path form keeps naming the file in Projekty/.
    write(&root, "Pages/Výjezd Lisabon 2026.md", "---\ntitle: Výjezd Lisabon 2026\n---\nDvojník.\n".as_bytes());
    reread(&core, &["Pages/Výjezd Lisabon 2026.md"]);
    let bl2: BTreeSet<String> = core.backlinks(LISABON).into_iter().map(|p| nfc(&p)).collect();
    assert_eq!(q(&[], "links_to", Op::Is, "[[Projekty/Výjezd Lisabon 2026]]", None), bl2, "path form: Lisabon's Backlinks");
}

// ================================================================================================ FR-QRY-03

#[test]
fn fr_qry_03_ac2_source_is_this_note() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    let d = def(&["task"], vec![f("source", Op::LinksTo, json!("this"))]);
    assert_eq!(path_set(&run_def(&core, d.clone(), Some(P7))), set(&[T1, T3, T4, T5]), "on Porada 7");
    assert_eq!(path_set(&run_def(&core, d.clone(), Some(P14))), set(&[T6]), "on Porada 14");
    assert_eq!(path_set(&run_def(&core, d.clone(), Some(LISABON))), set(&[]), "on Lisabon");
    let r = run_def(&core, d, None);
    assert_eq!((r.state, r.rows.len()), (RunState::NeedsHost, 0), "no host: needsHost, no rows (R143)");
}

#[test]
fn fr_qry_03_ac3_daily_note_date_context() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    let body = format!("saved: {VYTVORENO}\n");
    assert_eq!(paths(&run_fence(&core, &body, Some(DEN))), strs(&[T7, KRAKATIT, DOTAZ]), "Den: R146 (Den itself excluded)");
    let day9 = "Daily/2026-11-09.md";
    write(&root, day9, format!("---\ntype: daily-note\ntitle: 2026-11-09\ndate: 2026-11-09\n---\n```query\n{body}```\n").as_bytes());
    reread(&core, &[day9]);
    assert_eq!(paths(&run_fence(&core, &body, Some(day9))), Vec::<String>::new(), "9 Nov in Prague: none");
    let ny = core.query_run(QuerySource::Fence(body.clone()), Some(day9), &env_zone("America/New_York"));
    assert_eq!(path_set(&ny), set(&[KRAKATIT, T7]), "9 Nov in America/New_York: Krakatit and T7 (Z)");
    let r = run_fence(&core, &body, Some(LISABON));
    assert_eq!((r.state, r.rows.len()), (RunState::NeedsContext, 0), "a date `this` on a non-daily host: needs context");
}

// ================================================================================================ FR-QRY-05

#[test]
fn fr_qry_05_ac3_columns_menu_per_query() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    let task_yml = stamp(&root, ".tegg/types/task.yml");
    ok!(commit(&core, UKOLY, NOW, |d| d.columns.push("tags".into())), "check Tags");
    let one = swapped(&qfixture(UKOLY), &[("columns: [status, priority, due, modified]", "columns: [status, priority, due, modified, tags]"), ("modified: 2026-10-07T12:00:00+02:00", &format!("modified: {NOW}"))]);
    assert_eq!(disk_s(&root, &qpath(UKOLY)), Some(one.clone()), "Tags appended");
    ok!(commit(&core, UKOLY, NOW2, |d| d.columns.retain(|c| c != "modified")), "uncheck Modified");
    let two = swapped(&one, &[("columns: [status, priority, due, modified, tags]", "columns: [status, priority, due, tags]"), (&format!("modified: {NOW}"), &format!("modified: {NOW2}"))]);
    assert_eq!(disk_s(&root, &qpath(UKOLY)), Some(two), "Modified removed");
    assert_eq!(stamp(&root, ".tegg/types/task.yml"), task_yml, "the type file is untouched");
}

#[test]
fn fr_qry_05_ac5_mixed_view_drops_type_columns() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    let before = snapshot(&root);
    ok!(commit(&core, UKOLY, NOW, |d| {
        d.types = strs(&["task", "schůzka"]);
        d.columns = strs(&["modified", "type"]);
    }), "add Schůzka");
    let one = swapped(&qfixture(UKOLY), &[("types: [task]", "types: [task, schůzka]"), ("columns: [status, priority, due, modified]", "columns: [modified, type]"), ("modified: 2026-10-07T12:00:00+02:00", &format!("modified: {NOW}"))]);
    assert_eq!(disk_s(&root, &qpath(UKOLY)), Some(one.clone()), "`columns: [modified, type]` in one write");
    assert_eq!(files_changed(&before, &snapshot(&root)), set(&[&qpath(UKOLY)]), "only the query file");
    ok!(commit(&core, UKOLY, NOW2, |d| d.types = strs(&["task"])), "remove Schůzka");
    assert!(disk_s(&root, &qpath(UKOLY)).is_some_and(|t| t.contains("\ncolumns: [modified, type]\n") && t.contains("\ntypes: [task]\n")), "the columns don't come back");
    // Unknown column keys written by hand stay in the file.
    let hand = swapped(&qfixture(UKOLY), &[("columns: [status, priority, due, modified]", "columns: [status, neznámý]")]);
    write(&root, &qpath(UKOLY), hand.as_bytes());
    ok!(commit(&core, UKOLY, NOW, |d| d.view = View::List), "commit List");
    let want = swapped(&hand, &[("view: table", "view: list"), ("modified: 2026-10-07T12:00:00+02:00", &format!("modified: {NOW}"))]);
    assert_eq!(disk_s(&root, &qpath(UKOLY)), Some(want), "`columns: [status, neznámý]` kept");
}

#[test]
fn fr_qry_05_ac6_header_click_sorts() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    let fence = format!("```query\nsaved: {UKOLY}\n```\n");
    note_write(&core, P14, &(fixture_s(P14) + "\n" + &fence));
    let before = snapshot(&root);
    ok!(commit(&core, UKOLY, NOW, |d| d.sort.order = Order::Desc), "header click: due ↓");
    let want = swapped(&qfixture(UKOLY), &[("sort: { by: due, order: asc }", "sort: { by: due, order: desc }"), ("modified: 2026-10-07T12:00:00+02:00", &format!("modified: {NOW}"))]);
    assert_eq!(disk_s(&root, &qpath(UKOLY)), Some(want), "`sort:` written once");
    assert_eq!(files_changed(&before, &snapshot(&root)), set(&[&qpath(UKOLY)]), "no note written");
    assert_eq!(paths(&run(&core, UKOLY, Some(P7))), strs(&[T3, T2, T1, T5, T4]), "Porada 7's table follows");
    let second = run_fence(&core, &format!("saved: {UKOLY}\n"), Some(P14));
    assert_eq!(second.def.map(|d| d.sort.order), Some(Order::Desc), "the second fence in Porada 14 follows");
}

#[test]
fn fr_qry_05_ac8_read_only_cells_two_views() {
    let sb = sandbox();
    let root = vault(&sb);
    let start = swapped(&qfixture(ZRUSENE), &[("view: list", "view: board")]);
    write(&root, &qpath(ZRUSENE), start.as_bytes());
    let core = open(&root, &sb.dirs);
    let r = core.query(ZRUSENE);
    assert_eq!(r.def.as_ref().map(|d| d.view), Some(View::List), "shown as List");
    let b: Vec<(BrokenReason, Option<Vec<usize>>, String)> = r.broken.iter().map(|b| (reason(b), b.at.clone(), b.key.clone())).collect();
    assert_eq!(b, vec![(BrokenReason::BadValue, None, "view".to_string())], "a broken part: view");
    let run_r = run(&core, ZRUSENE, Some(PREHLED));
    assert!(run_r.broken.iter().any(|b| b.reason == BrokenReason::BadValue && b.key == "view"), "the block names it");
    ok!(commit(&core, ZRUSENE, NOW, |d| d.limit = 20), "commit limit 20");
    let want = swapped(&start, &[("limit: 50", "limit: 20"), ("modified: 2026-10-09T09:00:00+02:00", &format!("modified: {NOW}"))]);
    assert_eq!(disk_s(&root, &qpath(ZRUSENE)), Some(want), "`view: board` kept in the file");
}

// ================================================================================================ FR-QRY-06

#[test]
fn fr_qry_06_ac3_new_query_creates_one_file() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    let before = snapshot(&root);
    let r = ok!(core.query_create(QueryCreate { title: "Úkoly na víkend".into(), def: None, fence: None, free: false }, NOW), "create");
    assert_eq!(nfc(&r.name), "Úkoly na víkend", "its name");
    assert_eq!(disk_s(&root, &qpath("Úkoly na víkend")), Some(expected("expected/created.yml")), "created.yml byte for byte");
    assert_eq!(files_changed(&before, &snapshot(&root)), set(&[&qpath("Úkoly na víkend")]), "one file");
    for taken in ["projekty v běhu".to_string(), nfd(PROJEKTY), format!("  {PROJEKTY} ")] {
        let snap = snapshot(&root);
        let r = core.query_create(QueryCreate { title: taken.clone(), def: None, fence: None, free: false }, NOW);
        assert!(is_q(&r, QueryError::NameTaken), "{taken:?}: NameTaken ({r:?})");
        assert_eq!(files_changed(&snap, &snapshot(&root)), BTreeSet::new(), "{taken:?}: nothing created");
    }
    ok!(core.query_create(QueryCreate { title: "A/B: plán?".into(), def: None, fence: None, free: false }, NOW), "create A/B: plán?");
    assert_eq!(disk_s(&root, &qpath("A B plán")), Some(expected("expected/created-a-b-plan.yml")), "`A B plán.yml`, title quoted (D-52, D-230)");
    for blank in ["", "   ", "\t"] {
        let r = core.query_create(QueryCreate { title: blank.into(), def: None, fence: None, free: false }, NOW);
        assert!(is_q(&r, QueryError::EmptyName), "{blank:?}: EmptyName ({r:?})");
    }
}

#[test]
fn fr_qry_06_ac5_edits_apply_to_every_usage() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    assert_eq!(core.query_usages(OTEVRENE).len(), 3, "used on three notes");
    let before = snapshot(&root);
    ok!(commit(&core, OTEVRENE, NOW, |d| d.filters.retain(|i| !matches!(i, FilterItem::Group { .. }))), "remove the group");
    let want = swapped(
        &qfixture(OTEVRENE),
        &[("  - group:\n      match: any\n      filters:\n        - due: { within_next_days: 14 }\n        - priority: High\n", ""), ("modified: 2026-11-02T14:30:00+01:00", &format!("modified: {NOW}"))],
    );
    assert_eq!(disk_s(&root, &qpath(OTEVRENE)), Some(want), "the file, once");
    assert_eq!(files_changed(&before, &snapshot(&root)), set(&[&qpath(OTEVRENE)]), "no note written");
    assert_eq!(paths(&run(&core, OTEVRENE, Some(P7))), strs(&[T1, T2, T3, T4]), "Porada 7");
    assert_eq!(paths(&run(&core, OTEVRENE, Some(P14))), strs(&[T6]), "Porada 14");
}

#[test]
fn fr_qry_06_ac7_trash_keeps_blocks() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    let bytes = disk(&root, &qpath(PROJEKTY));
    let prehled = stamp(&root, PREHLED);
    let body = format!("saved: {PROJEKTY}\n");
    let to = ok!(core.query_trash(PROJEKTY), "trash");
    assert_eq!(nfc(&to), trashed_qpath(PROJEKTY), "moved to .trash/.tegg/queries/");
    assert_eq!(disk(&root, &trashed_qpath(PROJEKTY)), bytes, "same bytes");
    assert_eq!(disk(&root, &qpath(PROJEKTY)), None, "gone from .tegg/queries/");
    assert_eq!(core.queries().len(), 10, "count 10");
    let r = run_fence(&core, &body, Some(PREHLED));
    assert_eq!((r.form, r.lookup, r.rows.len()), (Form::Reference, Some(Lookup::Trashed), 0), "the block: in the trash");
    let t = core.trash_list();
    let row = some!(t.iter().find(|e| e.kind == TrashKind::Query), "a Query row in the Trash view");
    assert_eq!(
        (nfc(&row.path), nfc(&row.original), row.folder.as_str(), row.title.as_str(), row.type_key.clone(), row.count),
        (trashed_qpath(PROJEKTY), qpath(PROJEKTY), ".tegg/queries", PROJEKTY, None, 1),
        "the Trash row (§1.10)"
    );
    ok!(core.query_restore(PROJEKTY), "Restore in the block");
    assert_eq!(disk(&root, &qpath(PROJEKTY)), bytes, "back with the same bytes");
    assert_eq!(run_fence(&core, &body, Some(PREHLED)).rows.len(), 4, "results again");
    ok!(core.query_trash(PROJEKTY), "trash again");
    ok!(core.trash_restore(&trashed_qpath(PROJEKTY)), "Restore in the Trash view");
    assert_eq!(disk(&root, &qpath(PROJEKTY)), bytes, "back again");
    ok!(core.query_trash(PROJEKTY), "trash a third time");
    let removal = core.trash_delete(&[trashed_qpath(PROJEKTY)], &Sink(sb.base.join("system-trash")));
    assert_eq!(removal.failed, vec![], "deleted for good");
    let r = run_fence(&core, &body, Some(PREHLED));
    assert_eq!(r.lookup, Some(Lookup::Missing), "then not found");
    assert_eq!(stamp(&root, PREHLED), prehled, "Přehled is never written");
}

#[test]
fn fr_qry_06_ac8_duplicate_query() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    let r = ok!(core.query_duplicate(PROJEKTY, NOW), "duplicate");
    assert_eq!(nfc(&r.name), "Projekty v běhu (2)", "name");
    assert_eq!(disk_s(&root, &qpath("Projekty v běhu (2)")), Some(expected("expected/duplicate-projekty-v-behu-2.yml")), "bytes");
    assert_eq!(disk_s(&root, &qpath(PROJEKTY)), Some(qfixture(PROJEKTY)), "the original is untouched");
    assert_eq!(core.query_usages("Projekty v běhu (2)"), vec![], "Used on: empty");
}

#[test]
fn fr_qry_06_ac10_new_query_from_the_note() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    let d = def(&["task"], vec![]);
    let a = ok!(core.query_create(QueryCreate { title: "Untitled query".into(), def: Some(d.clone()), fence: None, free: true }, NOW), "first draft");
    assert_eq!(nfc(&a.name), "Untitled query", "free name");
    let b = ok!(core.query_create(QueryCreate { title: "Untitled query".into(), def: Some(d), fence: None, free: true }, NOW), "second draft");
    assert_eq!(nfc(&b.name), "Untitled query (2)", "taken: ` (2)` (D-1477, D-1495)");
    assert!(disk_s(&root, &qpath("Untitled query (2)")).is_some_and(|t| t.contains("\ntitle: Untitled query (2)\n") && t.contains("\ntypes: [task]\n")), "the title takes the suffix too");
}

#[test]
fn fr_qry_06_ac11_empty_and_broken_states() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    let knihy = stamp(&root, &qpath(KNIHY));
    let z = run(&core, ZRUSENE, Some(PREHLED));
    assert_eq!((z.state, z.rows.len(), z.lookup), (RunState::Ok, 0, Some(Lookup::Ok)), "Zrušené úkoly: no objects match");
    let k = run(&core, KNIHY, Some(PREHLED));
    assert_eq!(paths(&k), strs(&[KRAKATIT]), "the rest of the query runs");
    let b: Vec<(BrokenReason, Option<Vec<usize>>, String, Option<String>)> = k.broken.iter().map(|b| (b.reason, b.at.clone(), b.key.clone(), b.r#type.clone())).collect();
    assert_eq!(b, vec![(BrokenReason::NotAttribute, Some(vec![0]), "hodnocení".to_string(), Some("kniha".to_string()))], "the broken filter");
    let kniha = swapped(&fixture_s(".tegg/types/kniha.yml"), &[("    type: checkbox\n", "    type: checkbox\n  - key: hodnocení\n    name: Hodnocení\n    type: number\n")]);
    external(&core, &root, ".tegg/types/kniha.yml", kniha.as_bytes());
    let k2 = run(&core, KNIHY, Some(PREHLED));
    assert_eq!((k2.rows.len(), k2.broken.len()), (0, 0), "hodnocení counts now: Mloci fails přečteno, no objects match");
    assert_eq!(stamp(&root, &qpath(KNIHY)), knihy, "the query file is never rewritten");
    let d = def(&["kniha", "neexistuje"], vec![]);
    let r = run_def(&core, d, Some(PREHLED));
    assert_eq!((r.state, r.rows.len()), (RunState::NoType, 0), "a missing type: no results, never all types");
    assert!(r.broken.iter().any(|b| b.reason == BrokenReason::NoType && b.key == "neexistuje"), "`The type neexistuje doesn't exist.`");
}

#[test]
fn fr_qry_06_ac12_missing_trashed_unreadable() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    let necitelny = stamp(&root, &qpath(NECITELNY));
    let prehled = stamp(&root, PREHLED);
    let m = run_fence(&core, "saved: Neexistující dotaz\n", Some(PREHLED));
    assert_eq!((m.form, m.lookup, m.name.as_deref(), m.def.is_some()), (Form::Reference, Some(Lookup::Missing), Some("Neexistující dotaz"), false), "not found");
    let t = run_fence(&core, &format!("saved: {STARY}\n"), Some(PREHLED));
    assert_eq!(t.lookup, Some(Lookup::Trashed), "Starý dotaz: in the trash");
    assert_eq!(core.query(STARY).trashed_path.map(|p| nfc(&p)), Some(trashed_qpath(STARY)), "its trashed file");
    let u = run_fence(&core, &format!("saved: {NECITELNY}\n"), Some(PREHLED));
    assert_eq!((u.lookup, u.line, u.rows.len()), (Some(Lookup::Unreadable), Some(5), 0), "Nečitelný: line 5");
    let n = run(&core, NOVEJSI, None);
    assert_eq!((n.lookup, paths(&n)), (Some(Lookup::Newer), strs(&[JANA])), "Novější verze runs read-only");
    // Create it: the default query, no note write; the block then shows every object but the host (D-1492).
    ok!(core.query_create(QueryCreate { title: "Neexistující dotaz".into(), def: None, fence: None, free: false }, NOW), "Create it");
    let c = run_fence(&core, "saved: Neexistující dotaz\n", Some(PREHLED));
    assert_eq!((c.lookup, c.rows.len()), (Some(Lookup::Ok), 20), "the default's results: 21 objects minus the host");
    assert_eq!(stamp(&root, PREHLED), prehled, "no note write");
    assert_eq!(stamp(&root, &qpath(NECITELNY)), necitelny, "Nečitelný keeps its bytes");
}

#[test]
fn fr_qry_06_ac14_inline_fences_are_read_only() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    let prehled = stamp(&root, PREHLED);
    let body = "title: Ruční dotaz\ntypes: [kniha]\nfilters:\n  - přečteno: true\n# napsáno ručně\nview: list\n";
    let r = run_fence(&core, body, Some(PREHLED));
    assert_eq!((r.form, paths(&r)), (Form::Inline, strs(&[KRAKATIT])), "inline: Krakatit");
    let bad = run_fence(&core, "title: [rozbitý\n", Some(PREHLED));
    assert_eq!((bad.form, bad.line, bad.rows.len()), (Form::Unreadable, Some(1), 0), "invalid YAML: unreadable, line 1 of the fence");
    let s = ok!(core.query_create(QueryCreate { title: "Ruční dotaz".into(), def: None, fence: Some(body.into()), free: false }, NOW), "Save as query…");
    assert_eq!(nfc(&s.name), "Ruční dotaz", "name");
    assert_eq!(disk_s(&root, &qpath("Ruční dotaz")), Some(expected("expected/saved-rucni-dotaz.yml")), "the fence's keys, its comment after them");
    assert_eq!(stamp(&root, PREHLED), prehled, "the core never writes the note");
    assert_eq!(paths(&run_fence(&core, "saved: Ruční dotaz\n", Some(PREHLED))), strs(&[KRAKATIT]), "the reference shows the same result");
}

#[test]
fn fr_qry_06_ac16_usages_by_name() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    let u: Vec<(String, bool)> = core.query_usages(OTEVRENE).into_iter().map(|u| (nfc(&u.path), u.template)).collect();
    assert_eq!(u, vec![(P7.to_string(), false), (P14.to_string(), false), (SABLONA.to_string(), true)], "Porada 7, Porada 14, Šablona (template)");
    let usages = core.query_usages(OTEVRENE);
    assert_eq!(usages.first().map(|x| (x.title.clone(), x.r#type.clone())), Some(("2026-10-07 Týdenní porada".to_string(), Some("schůzka".to_string()))), "title and type");
    let fence = |name: &str| format!("Text.\n\n```query\nsaved: {name}\n```\n");
    write(&root, ".trash/Pages/V koši.md", fence(OTEVRENE).as_bytes());
    write(&root, "Pages/Jiný případ.md", fence("otevřené ÚKOLY z této schůzky").as_bytes());
    write(&root, "Pages/Rozložený.md", fence(&nfd(OTEVRENE)).as_bytes());
    reread(&core, &[".trash/Pages/V koši.md", "Pages/Jiný případ.md", "Pages/Rozložený.md"]);
    let got: Vec<String> = core.query_usages(OTEVRENE).into_iter().map(|u| nfc(&u.path)).collect();
    assert_eq!(got, strs(&["Pages/Jiný případ.md", "Pages/Rozložený.md", P7, P14, SABLONA]), "other case and NFD are usages; .trash/ isn't");
    let r = run_fence(&core, "saved: otevřené ÚKOLY z této schůzky\n", Some("Pages/Jiný případ.md"));
    assert_eq!((r.lookup, r.name.as_deref().map(nfc)), (Some(Lookup::Ok), Some(OTEVRENE.to_string())), "the block resolves");
    note_write(&core, P14, &fixture_s(P14).replace(&format!("```query\nsaved: {OTEVRENE}\n```\n"), ""));
    let got: Vec<String> = core.query_usages(OTEVRENE).into_iter().map(|u| nfc(&u.path)).collect();
    assert!(!got.contains(&P14.to_string()) && got.contains(&P7.to_string()), "deleting the block removes Porada 14: {got:?}");
}

#[test]
fn fr_qry_06_ac17_query_files_changed_outside() {
    let sb = sandbox();
    let root = vault(&sb);
    write(&root, &qpath("Projekty v běhu 2"), qfixture(PROJEKTY).as_bytes());
    write(&root, &qpath("Projekty v běhu (conflicted copy 2026-11-10)"), qfixture(PROJEKTY).as_bytes());
    let core = open_with(&root, &sb.dirs, true);
    let rx = core.events();
    let n = names(&core);
    assert!(n.contains(&"Projekty v běhu 2".to_string()) && n.contains(&"Projekty v běhu (conflicted copy 2026-11-10)".to_string()), "conflict copies are their own queries: {n:?}");
    let copy = stamp(&root, &qpath("Projekty v běhu 2"));
    let osoby = "version: 1\ntitle: Osoby\ntypes: [osoba]\n";
    write(&root, &qpath("Osoby"), osoby.as_bytes());
    let seen = wait_until(Duration::from_secs(2), || names(&core).contains(&"Osoby".to_string()));
    assert!(seen.is_some(), "a created file is listed within 2 s");
    let evs = drain(&rx, 1500);
    assert!(evs.iter().any(|e| matches!(e, CoreEvent::VaultChanged { paths } if paths.iter().any(|p| nfc(p) == qpath("Osoby")))), "vault:changed carries the query path");
    assert_eq!(paths(&run(&core, "Osoby", None)), strs(&[JANA]), "its results");
    write(&root, &qpath("Osoby"), osoby.replace("[osoba]", "[kniha]").as_bytes());
    let upd = wait_until(Duration::from_secs(2), || path_set(&run(&core, "Osoby", None)) == set(&[KRAKATIT, MLOCI]));
    assert!(upd.is_some(), "an edit shows within 2 s");
    std::fs::remove_file(root.join(qpath("Osoby"))).expect("setup: delete");
    let gone = wait_until(Duration::from_secs(2), || run(&core, "Osoby", None).lookup == Some(Lookup::Missing) && !names(&core).contains(&"Osoby".to_string()));
    assert!(gone.is_some(), "a deleted file: not found, no row");
    assert_eq!(stamp(&root, &qpath("Projekty v běhu 2")), copy, "nothing renames, merges or deletes the copy");
}

#[test]
fn fr_qry_06_ac18_deleting_a_block_keeps_the_query() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    assert_eq!(core.query_usages(VSE).len(), 1, "used on Lisabon");
    let q = stamp(&root, &qpath(VSE));
    let original = fixture_s(LISABON);
    note_write(&core, LISABON, &original.replace(&format!("\n```query\nsaved: {VSE}\n```\n"), "\n"));
    assert_eq!(stamp(&root, &qpath(VSE)), q, "the query file is untouched");
    assert!(names(&core).contains(&VSE.to_string()), "still listed");
    assert_eq!(core.query_usages(VSE), vec![], "Used on: empty");
    note_write(&core, LISABON, &original);
    assert_eq!(core.query_usages(VSE).len(), 1, "Undo brings the usage back");
}

// ================================================================================================ FR-QRY-08, FR-QRY-09

#[test]
fn fr_qry_08_ac1_new_object_from_the_block() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    let nova = "Tasks/Nový úkol z porady.md";
    let text = "---\ntype: task\ntitle: Nový úkol z porady\nstatus: To do\ndue: 2026-11-12\nsource: \"[[2026-10-07 Týdenní porada]]\"\ncreated: 2026-11-10T10:00:00+01:00\nmodified: 2026-11-10T10:00:00+01:00\n---\n";
    ok!(core.create_exact(nova, text.as_bytes()), "the draft's first write");
    let _ = core.wait_idle(Duration::from_secs(30));
    assert_eq!(path_set(&run(&core, OTEVRENE, Some(P7))), set(&[T1, T2, T3, nova]), "the block lists the new task");
}

#[test]
fn fr_qry_09_ac1_tegg_edits_update_results() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    let rx = core.events();
    note_write(&core, T4, &swapped(&fixture_s(T4), &[("priority: Low\n", "priority: Low\ndue: 2026-11-20\n")]));
    assert_eq!(paths(&run(&core, OTEVRENE, Some(P7))), strs(&[T1, T2, T4, T3]), "T4 due 20 Nov joins");
    let evs = drain(&rx, 500);
    let stale = evs.iter().find_map(|e| if let CoreEvent::QueryStale { types, paths } = e { Some((types.clone(), paths.clone())) } else { None });
    assert_eq!(stale.map(|(t, p)| (t, p.into_iter().map(|x| nfc(&x)).collect::<Vec<_>>())), Some((strs(&["task"]), strs(&[T4]))), "query:stale with the type and path");
    note_write(&core, T2, &swapped(&fixture_s(T2), &[("status: In progress", "status: Done")]));
    assert_eq!(paths(&run(&core, OTEVRENE, Some(P7))), strs(&[T1, T4, T3]), "T2 Done leaves");
    note_write(&core, T6, &(fixture_s(T6) + "Viz [[2026-10-07 Týdenní porada]].\n"));
    assert_eq!(paths(&run(&core, OTEVRENE, Some(P7))), strs(&[T6, T1, T4, T3]), "T6 links Porada 7 now");
}

#[test]
fn fr_qry_09_ac2_external_edits_update_results() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open_with(&root, &sb.dirs, true);
    let want = |w: &[&str]| {
        let w = set(w);
        wait_until(Duration::from_secs(2), || path_set(&run(&core, OTEVRENE, Some(P7))) == w)
    };
    write(&root, T4, swapped(&fixture_s(T4), &[("priority: Low\n", "priority: Low\ndue: 2026-11-20\n")]).as_bytes());
    assert!(want(&[T1, T2, T3, T4]).is_some(), "T4's new due shows within 2 s");
    let nova = "Tasks/Externí úkol.md";
    write(&root, nova, "---\ntype: task\ntitle: Externí úkol\nstatus: To do\npriority: High\nsource: \"[[2026-10-07 Týdenní porada]]\"\n---\n".as_bytes());
    assert!(want(&[T1, T2, T3, T4, nova]).is_some(), "a new task shows within 2 s");
    std::fs::remove_file(root.join(T1)).expect("setup: delete T1");
    assert!(want(&[T2, T3, T4, nova]).is_some(), "a deleted task leaves within 2 s");
}

#[test]
fn fr_qry_09_ac3_type_jobs_patch_queries() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    let before = (stamp(&root, &qpath(PROJEKTY)), stamp(&root, &qpath(KOMENTARE)));
    assert_eq!(run(&core, PROJEKTY, None).rows.len(), 4, "four projects before");
    // A helper edits projekt.yml outside Tegg: `stav` is gone; the filter is a broken part, nothing is rewritten.
    let projekt = fixture_s(".tegg/types/projekt.yml");
    let start = some!(projekt.find("  - key: stav\n"), "setup: stav in projekt.yml");
    let end = some!(projekt.find("  - key: rozpočet\n"), "setup: rozpočet in projekt.yml");
    let without = format!("{}{}", &projekt[..start], &projekt[end..]);
    external(&core, &root, ".tegg/types/projekt.yml", without.as_bytes());
    let r = run(&core, PROJEKTY, None);
    assert!(r.broken.iter().any(|b| b.reason == BrokenReason::NotAttribute && b.key == "stav"), "the stav filter is broken: {:?}", r.broken);
    assert_eq!(r.rows.len(), 5, "ignored as if absent: every project");
    assert_eq!((stamp(&root, &qpath(PROJEKTY)), stamp(&root, &qpath(KOMENTARE))), before, "query files untouched");
}

// ================================================================================================ FR-TPL-04, FR-STO-06

#[test]
fn fr_tpl_04_ac2_templates_are_usages_not_results() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    let u = core.query_usages(OTEVRENE);
    let t = some!(u.iter().find(|x| nfc(&x.path) == SABLONA), "Šablona is a usage");
    assert!(t.template, "marked Template");
    let all = run_def(&core, def(&[], vec![]), None);
    assert!(!all.rows.is_empty() && !paths(&all).iter().any(|p| p.starts_with("_templates/")), "never a result");
    let r = run(&core, OTEVRENE, Some(SABLONA));
    assert_eq!((r.lookup, r.state, r.rows.len()), (Some(Lookup::Ok), RunState::Ok, 0), "opened as a file: no results");
}

#[test]
fn fr_sto_06_ac3_queries_are_vault_files() {
    let sb = sandbox();
    let root = vault(&sb);
    let probe = |core: &Core| (names(core).into_iter().collect::<BTreeSet<_>>(), paths(&run(core, OTEVRENE, Some(P7))), paths(&run(core, PROJEKTY, None)));
    let first = {
        let core = open(&root, &sb.dirs);
        probe(&core)
    };
    assert_eq!(first.0.len(), 11, "eleven queries");
    assert_eq!((first.1.clone(), first.2.clone()), (strs(&[T1, T2, T3]), strs(&[CESTA, CAJOVNA, MALY, LISABON])), "R146 rows");
    let other = fresh_dirs(&sb, "Druhý Mac");
    let second = {
        let core = open(&root, &other);
        probe(&core)
    };
    assert_eq!(second, first, "a second, empty Application Support gives the same");
    std::fs::remove_dir_all(&other.root).expect("setup: drop the index");
    std::fs::create_dir_all(&other.root).expect("setup: app dir");
    let third = {
        let core = open(&root, &other);
        probe(&core)
    };
    assert_eq!(third, first, "a rebuilt index gives the same");
    // No query definition is stored in the index: its files never hold a definition-only text.
    let mut hits = Vec::new();
    for dir in [&sb.dirs.root, &other.root] {
        for p in walk_files(dir) {
            let b = std::fs::read(&p).unwrap_or_default();
            for needle in ["within_next_days", "is_not: Done", "x-barva"] {
                if b.windows(needle.len()).any(|w| w == needle.as_bytes()) {
                    hits.push(format!("{} holds {needle:?}", p.display()));
                }
            }
        }
    }
    assert_eq!(hits, Vec::<String>::new(), "the index holds no query definition (AR-01)");
    // AR-03 (L0): the parser, evaluator and patcher are in the platform-neutral core.
    for rel in ["crates/tegg-core/src/queries_q.rs", "crates/tegg-format/src/query_fence.rs"] {
        let src = std::fs::read_to_string(repo_root().join(rel)).unwrap_or_default();
        assert!(!src.is_empty(), "{rel} exists");
        for bad in ["tauri", "objc", "cocoa", "AppKit", "core_foundation", "fsevent"] {
            assert!(!src.contains(bad), "{rel} uses no desktop API ({bad})");
        }
    }
}
fn walk_files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                out.extend(walk_files(&p));
            } else {
                out.push(p);
            }
        }
    }
    out
}

// ================================================================================================ FR-SYN-02 AC-10

#[test]
fn fr_syn_02_ac10_query_file_atomic_writes() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    let ino = std::fs::metadata(root.join(qpath(PROJEKTY))).map(|m| std::os::unix::fs::MetadataExt::ino(&m)).ok();
    ok!(commit(&core, PROJEKTY, NOW, |d| d.view = View::List), "commit");
    let ino2 = std::fs::metadata(root.join(qpath(PROJEKTY))).map(|m| std::os::unix::fs::MetadataExt::ino(&m)).ok();
    assert!(ino.is_some() && ino != ino2, "a new inode: temp file renamed over the target, never written in place");
    assert_eq!(tmp_files(&root), Vec::<String>::new(), "no temp file stays");
    write(&root, &format!("{Q}/.Projekty v běhu.yml.4242.tegg-tmp"), b"version: 1\ntitle: Polovina\n");
    write(&root, &format!("{Q}/.skryty.yml"), "version: 1\ntitle: Skrytý\n".as_bytes());
    let n = names(&core);
    assert!(n.len() == 11 && !n.iter().any(|x| x.contains("tegg-tmp") || x.contains("Polovina") || x.contains("skryty")), "temp and dot files are never queries: {n:?}");
}

const KILL_TEST: &str = "fr_syn_02_ac10_query_file_atomic_writes_survive_sigkill";
const KILL_CYCLES: usize = 200;

fn kill_child(root: &Path, app: &Path, ready: &Path) -> ! {
    let dirs = tegg_core::AppDirs { root: app.to_path_buf() };
    let Ok(core) = Core::open(root, &dirs, CoreOptions { watch: false, sync: None }) else { std::process::exit(3) };
    let _ = core.wait_idle(Duration::from_secs(30));
    std::fs::write(ready, b"ready").ok();
    let start = Instant::now();
    let mut i = 0usize;
    while start.elapsed() < Duration::from_secs(20) {
        i += 1;
        let r = core.query(PROJEKTY);
        let (Some(mut d), Some(v)) = (r.def, r.version) else {
            std::fs::write(ready.with_extension("failed"), "query() has no definition").ok();
            std::process::exit(3)
        };
        d.view = if i % 2 == 1 { View::List } else { View::Table };
        if let Err(e) = core.query_apply(PROJEKTY, &v, d, NOW) {
            std::fs::write(ready.with_extension("failed"), format!("{e:?}")).ok();
            std::process::exit(3)
        }
    }
    std::process::exit(0)
}

#[test]
fn fr_syn_02_ac10_query_file_atomic_writes_survive_sigkill() {
    if let Ok(dir) = std::env::var("TEGG_QUERIES_KILL_CHILD") {
        let dir = PathBuf::from(dir);
        let ready = PathBuf::from(std::env::var("TEGG_QUERIES_KILL_READY").expect("setup: ready path"));
        kill_child(&dir.join("vault"), &dir.join("app"), &ready);
    }
    let sb = sandbox();
    let work = sb.base.join("kill");
    let root = work.join("vault");
    copy_dir(&repo_root().join("tests/fixtures/vaults/queries"), &root, &["README.md"]);
    copy_dir(&repo_root().join("tests/fixtures/vaults/new-empty/.tegg"), &root.join(".tegg"), &[]);
    std::fs::create_dir_all(work.join("app")).expect("setup: app dir");
    let a0 = qfixture(PROJEKTY);
    let a1 = swapped(&a0, &[("view: table", "view: list"), ("modified: 2026-10-15T09:00:00+02:00", &format!("modified: {NOW}"))]);
    let a2 = swapped(&a0, &[("modified: 2026-10-15T09:00:00+02:00", &format!("modified: {NOW}"))]);
    let exe = std::env::current_exe().expect("setup: test binary");
    let mut seed: u64 = 0x5155_4552_2611_10;
    let mut bad: Vec<String> = Vec::new();
    let mut wrote = 0usize;
    for cycle in 0..KILL_CYCLES {
        std::fs::write(root.join(qpath(PROJEKTY)), &a0).expect("setup: restore the file");
        let ready = work.join(format!("ready-{cycle}"));
        let mut child = Command::new(&exe)
            .args(["--exact", KILL_TEST, "--nocapture", "--test-threads=1"])
            .env("TEGG_QUERIES_KILL_CHILD", &work)
            .env("TEGG_QUERIES_KILL_READY", &ready)
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
            bad.push(format!("cycle {cycle}: the writer failed: {}", std::fs::read_to_string(ready.with_extension("failed")).unwrap_or_default()));
        }
        let now = String::from_utf8(std::fs::read(root.join(qpath(PROJEKTY))).unwrap_or_default()).unwrap_or_default();
        if now != a0 {
            wrote += 1;
        }
        if now != a0 && now != a1 && now != a2 {
            bad.push(format!("cycle {cycle}: torn file ({} bytes)", now.len()));
        }
        let listed: Vec<String> = std::fs::read_dir(root.join(Q))
            .map(|rd| rd.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.ends_with(".yml") && !n.starts_with('.')).collect())
            .unwrap_or_default();
        if listed.len() != 11 {
            bad.push(format!("cycle {cycle}: {} query files", listed.len()));
        }
        if bad.len() > 10 {
            break;
        }
    }
    assert!(wrote > 0, "the writer committed at least once");
    assert_eq!(bad, Vec::<String>::new(), "after every kill the file is the complete old or new bytes");
}

// ================================================================================================ FR-SYN-03

#[test]
fn fr_syn_03_ac28_query_writes_check_the_base() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    // Changed on disk without vault:changed: Conflict, nothing written.
    let (mut d, v) = current(&core, PROJEKTY);
    d.view = View::List;
    let theirs = qfixture(PROJEKTY).replace("limit: 50", "limit: 40");
    write(&root, &qpath(PROJEKTY), theirs.as_bytes());
    let r = core.query_apply(PROJEKTY, &v, d.clone(), NOW);
    assert!(matches!(r, Err(CoreError::Vault(VaultError::Conflict { .. }))), "Conflict: {r:?}");
    assert_eq!(disk_s(&root, &qpath(PROJEKTY)), Some(theirs.clone()), "their bytes stay");
    // Same bytes, only a new mtime: no conflict (D-175).
    let (d2, v2) = current(&core, PROJEKTY);
    std::thread::sleep(Duration::from_millis(20));
    write(&root, &qpath(PROJEKTY), theirs.as_bytes());
    let mut d3 = d2.clone();
    d3.view = View::List;
    ok!(core.query_apply(PROJEKTY, &v2, d3, NOW), "an mtime-only change is no conflict");
    // Deleted meanwhile: Gone, nothing created.
    let (d4, v4) = current(&core, UKOLY);
    std::fs::remove_file(root.join(qpath(UKOLY))).expect("setup: delete");
    let mut d5 = d4.clone();
    d5.limit = 10;
    let r = core.query_apply(UKOLY, &v4, d5, NOW);
    assert!(matches!(r, Err(CoreError::Vault(VaultError::Gone))), "Gone: {r:?}");
    assert_eq!(disk(&root, &qpath(UKOLY)), None, "nothing created");
    // New query refuses when another program created the name first (RENAME_EXCL).
    let other = b"version: 1\ntitle: Jejich\n";
    write(&root, &qpath("Jejich"), other);
    let r = core.query_create(QueryCreate { title: "Jejich".into(), def: None, fence: None, free: false }, NOW);
    assert!(is_q(&r, QueryError::NameTaken), "NameTaken: {r:?}");
    assert_eq!(disk(&root, &qpath("Jejich")), Some(other.to_vec()), "their file is never replaced");
    let _ = d;
}

#[test]
fn fr_syn_03_ac29_unreadable_query_files_are_kept() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    let before = (stamp(&root, &qpath(NECITELNY)), stamp(&root, &qpath(NOVEJSI)));
    let n = core.query(NOVEJSI);
    assert_eq!(n.lookup, Lookup::Newer, "Novější verze: read-only");
    let nv = some!(n.version.clone(), "its version");
    let nd = some!(n.def.clone(), "its definition runs");
    let mut changed_def = nd.clone();
    changed_def.view = View::Table;
    let r = core.query_apply(NOVEJSI, &nv, changed_def, NOW);
    assert!(is_q(&r, QueryError::NewerVersion), "commit refused: {r:?}");
    let r = core.query_duplicate(NOVEJSI, NOW);
    assert!(is_q(&r, QueryError::NewerVersion), "duplicate refused: {r:?}");
    let r = core.query_revert(NOVEJSI, &nv, "version: 1\n");
    assert!(is_q(&r, QueryError::NewerVersion), "revert refused: {r:?}");
    let u = core.query(NECITELNY);
    assert_eq!((u.lookup, u.line, u.def.is_none()), (Lookup::Unreadable, Some(5), true), "Nečitelný: unreadable, line 5");
    assert_eq!(u.text.as_deref(), Some(qfixture(NECITELNY).as_str()), "its text, for the page");
    let uv = some!(u.version.clone(), "its version");
    let r = core.query_apply(NECITELNY, &uv, def(&["task"], vec![]), NOW);
    assert!(is_q(&r, QueryError::Unreadable), "commit refused: {r:?}");
    let r = core.query_duplicate(NECITELNY, NOW);
    assert!(is_q(&r, QueryError::Unreadable), "duplicate refused: {r:?}");
    assert_eq!((stamp(&root, &qpath(NECITELNY)), stamp(&root, &qpath(NOVEJSI))), before, "bytes, mtime and inode kept");
    // Pure functions refuse too.
    let text = qfixture(NOVEJSI);
    let file = queries_q::read(text.as_bytes());
    assert_eq!(queries_q::patch(&text, &file, &def(&["osoba"], vec![]), NOW), Err(QueryError::NewerVersion), "patch refuses a newer file");
    // Another program fixes Nečitelný: it recovers.
    external(&core, &root, &qpath(NECITELNY), qfixture(NECITELNY).replace("match: all: any", "match: all").as_bytes());
    assert_eq!(core.query(NECITELNY).lookup, Lookup::Ok, "readable again");
    // Trash works on any file.
    let to = ok!(core.query_trash(NOVEJSI), "trash a newer file");
    assert_eq!(disk(&root, &to), before.1.map(|s| s.0), "moved with its bytes");
}

// ================================================================================================ FR-FMT-07

#[test]
fn fr_fmt_07_ac29_query_file_minimal_patches() {
    for (variant, prep) in [("", Box::new(|t: &str| t.to_string()) as Box<dyn Fn(&str) -> String>), ("-crlf", Box::new(|t: &str| crlf(t))), ("-no-newline", Box::new(|t: &str| t.trim_end_matches('\n').to_string()))] {
        for (what, edit) in [
            ("view", Box::new(|d: &mut QueryDef| d.view = View::Table) as Box<dyn Fn(&mut QueryDef)>),
            ("filter", Box::new(|d: &mut QueryDef| d.filters.push(f("rozpočet", Op::Gt, json!(5000))))),
        ] {
            let sb = sandbox();
            let root = vault(&sb);
            write(&root, &qpath(KOMENTARE), prep(&qfixture(KOMENTARE)).as_bytes());
            let core = open(&root, &sb.dirs);
            ok!(commit(&core, KOMENTARE, NOW, |d| edit(d)), format!("{what}{variant}"));
            assert_eq!(disk_s(&root, &qpath(KOMENTARE)), Some(expected(&format!("expected/komentare-after-{what}{variant}.yml"))), "{what}{variant}: expected bytes");
        }
    }
    // A no-op commit writes nothing; the pure patch agrees.
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    let before = stamp(&root, &qpath(KOMENTARE));
    ok!(commit(&core, KOMENTARE, NOW, |_| {}), "no-op commit");
    assert_eq!(stamp(&root, &qpath(KOMENTARE)), before, "no write");
    let text = qfixture(KOMENTARE);
    let file = queries_q::read(text.as_bytes());
    assert_eq!(queries_q::patch(&text, &file, &file.def, NOW), Ok(None), "equal definition: None");
    let mut d = file.def.clone();
    d.view = View::Table;
    assert_eq!(queries_q::patch(&text, &file, &d, NOW), Ok(Some(expected("expected/komentare-after-view.yml"))), "pure patch: the same bytes");
    assert_eq!(queries_q::create_text(&def(&[], vec![]), NOW, None).lines().count(), 12, "create_text writes every key");
}

#[test]
fn fr_fmt_07_ac30_notes_with_query_blocks_round_trip() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    let before = snapshot(&root);
    let notes = [(P7, 2usize), (P14, 1), (LISABON, 1), (DEN, 1), (PREHLED, 9), (SABLONA, 1)];
    for (n, count) in notes {
        let text = fixture_s(n);
        let found = tegg_format::query_fences(&text);
        assert_eq!(found.len(), count, "{n}: its fences");
        for fe in &found {
            let _ = run_fence(&core, &fe.body, Some(n));
            assert_eq!(&text[fe.range.clone()].lines().next(), &Some("```query"), "{n}: the range starts at the fence");
        }
        if !n.starts_with("_templates/") {
            let (bytes, v) = ok!(core.read_note(n, SystemTime::now()), format!("open {n}"));
            let out = ok!(core.write_note(n, &bytes, Some(&v)), format!("save {n}"));
            assert_eq!(out, tegg_core::WriteOutcome::Unchanged, "{n}: saving without an edit writes nothing");
        }
    }
    assert_eq!(files_changed(&before, &snapshot(&root)), BTreeSet::new(), "opening, running and saving changes no byte");
}

// ================================================================================================ FR-FMT-12, NFR-POR-01, FR-FMT-06

#[test]
fn fr_fmt_12_ac9_query_names_are_nfc() {
    let sb = sandbox();
    let root = vault(&sb);
    std::fs::rename(root.join(qpath(PROJEKTY)), root.join(nfd(&qpath(PROJEKTY)))).expect("setup: NFD file name");
    let core = open(&root, &sb.dirs);
    let n = names(&core);
    assert_eq!(n.iter().filter(|x| x.as_str() == PROJEKTY).count(), 1, "listed once as NFC: {n:?}");
    assert!(core.queries().iter().all(|q| q.name == nfc(&q.name)), "names are NFC");
    for body in [format!("saved: {PROJEKTY}\n"), format!("saved: {}\n", nfd(PROJEKTY))] {
        for e in [env(), env_us()] {
            let r = core.query_run(QuerySource::Fence(body.clone()), Some(PREHLED), &e);
            assert_eq!((r.lookup, r.rows.len()), (Some(Lookup::Ok), 4), "{body:?} resolves in {}", e.locale);
        }
    }
    assert_eq!(queries_q::name_key(&nfd("Projekty V BĚHU")), queries_q::name_key(PROJEKTY), "name_key: NFC, case-insensitive");
    ok!(core.query_create(QueryCreate { title: nfd("Čtení knih"), def: None, fence: None, free: false }, NOW), "create with an NFD title");
    let raw: Vec<Vec<u8>> = std::fs::read_dir(root.join(Q)).map(|rd| rd.flatten().map(|e| e.file_name().to_string_lossy().as_bytes().to_vec()).collect()).unwrap_or_default();
    assert!(raw.iter().any(|b| b == "Čtení knih.yml".as_bytes()), "written as an NFC file name");
    assert!(disk_s(&root, &qpath("Čtení knih")).is_some_and(|t| t.contains("\ntitle: Čtení knih\n")), "title written NFC");
}

fn node_doc(script: &str, arg: &Path) -> Option<Value> {
    let out = Command::new("node").current_dir(repo_root().join("packages/doc")).args(["--input-type=module", "-e", script]).arg(arg).output().ok()?;
    serde_json::from_slice::<Value>(&out.stdout).ok()
}

#[test]
fn nfr_por_01_ac5_queries_are_plain_files() {
    let sb = sandbox();
    let root = vault(&sb);
    write(&root, ".obsidian/app.json", b"{}\n");
    let core = open(&root, &sb.dirs);
    let obsidian = stamp(&root, ".obsidian/app.json");
    ok!(core.query_create(QueryCreate { title: "A/B: plán?".into(), def: None, fence: None, free: false }, NOW), "create");
    ok!(commit(&core, "A B plán", NOW2, |d| {
        d.types = strs(&["task"]);
        d.filters = vec![f("links_to", Op::Is, json!("[[Výjezd Lisabon 2026]]")), group(Match::Any, vec![f("due", Op::Between, json!(["2026-11-01", "2026-11-30"])), f("status", Op::IsAnyOf, json!(["To do", "Done"]))])];
    }), "commit");
    ok!(core.query_duplicate(PROJEKTY, NOW), "duplicate");
    let script = "import YAML from 'yaml'; import { readFileSync } from 'node:fs'; \
        const d = YAML.parse(readFileSync(process.argv[1], 'utf8')); console.log(JSON.stringify(d));";
    for name in ["A B plán", "Projekty v běhu (2)"] {
        let parsed = node_doc(script, &root.join(qpath(name)));
        let ours = core.query(name);
        let d = some!(ours.def.clone(), format!("{name}: def"));
        let p = some!(parsed, format!("{name}: the `yaml` package parses it (YAML 1.2)"));
        assert_eq!(p["title"].as_str(), Some(d.title.as_str()), "{name}: title");
        assert_eq!(p["types"], json!(d.types), "{name}: types");
        assert_eq!(p["version"], json!(1), "{name}: version");
        if name == "A B plán" {
            assert_eq!(p["filters"][0]["links_to"], json!("[[Výjezd Lisabon 2026]]"), "the link value");
            assert_eq!(p["filters"][1]["group"]["match"], json!("any"), "the group");
        }
    }
    assert_eq!(stamp(&root, ".obsidian/app.json"), obsidian, "nothing inside .obsidian/");
}

#[test]
fn fr_fmt_06_ac4_fence_is_yaml_and_code() {
    let sb = sandbox();
    let script = "import YAML from 'yaml'; import { fromMarkdown } from 'mdast-util-from-markdown'; import { readFileSync } from 'node:fs'; \
        let t = readFileSync(process.argv[1], 'utf8'); if (t.startsWith('---\\n')) { const e = t.indexOf('\\n---\\n', 4); t = t.slice(e + 5); } \
        const out = []; const walk = (n) => { if (n.type === 'code') out.push({ lang: n.lang, meta: n.meta, yaml: (() => { try { return YAML.parse(n.value); } catch { return 'ERR'; } })() }); (n.children || []).forEach(walk); }; \
        walk(fromMarkdown(t)); console.log(JSON.stringify(out));";
    for n in [P7, P14, LISABON, DEN, PREHLED, SABLONA] {
        let text = fixture_s(n);
        let ours = tegg_format::query_fences(&text);
        let theirs = some!(node_doc(script, &repo_root().join("tests/fixtures/vaults/queries").join(n)), format!("{n}: micromark reads it"));
        let codes = theirs.as_array().cloned().unwrap_or_default();
        assert_eq!(codes.len(), ours.len(), "{n}: every query fence is one code block, and Tegg finds each");
        for (c, f) in codes.iter().zip(ours.iter()) {
            assert_eq!(c["lang"], json!("query"), "{n}: info `query`");
            if let Some(s) = &f.saved {
                assert_eq!(c["yaml"]["saved"].as_str().map(nfc), Some(s.clone()), "{n}: the YAML of a reference fence");
            }
        }
    }
    let _ = sb;
}

#[test]
fn fr_fmt_06_ac5_reference_fence_keeps_other_lines() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    let body = format!("saved: {PROJEKTY}\n# moje poznámka\nx-pohled: úzký\n");
    assert_eq!(queries_q::read_fence(&body), FenceRead::Reference { name: PROJEKTY.into() }, "a reference with other lines");
    let r = run_fence(&core, &body, Some(PREHLED));
    assert_eq!((r.form, r.rows.len()), (Form::Reference, 4), "works as the reference");
    let note = "Pages/Poznámka s dotazem.md";
    let text = format!("Úvod.\n\n```query\n{body}```\n");
    write(&root, note, text.as_bytes());
    reread(&core, &[note]);
    let found = tegg_format::query_fences(&text);
    assert_eq!(found.iter().map(|f| f.body.clone()).collect::<Vec<_>>(), vec![body.clone()], "the body as written");
    assert_eq!(core.query_usages(PROJEKTY).iter().map(|u| nfc(&u.path)).collect::<Vec<_>>(), strs(&[note, PREHLED]), "a usage");
    // Inserting another block above and saving keeps the fence's lines.
    let edited = format!("Nový odstavec.\n\n{text}");
    note_write(&core, note, &edited);
    assert!(disk_s(&root, note).is_some_and(|t| t.contains(&format!("```query\n{body}```\n"))), "the other lines stay byte for byte");
}

// ================================================================================================ FR-HOM-02 (pins of queries)

fn pin_query(name: &str) -> PinOp {
    PinOp::Pin { target: PinRequest::Query { name: name.into() }, at: None }
}

#[test]
fn fr_hom_02_ac28_pin_a_query() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    let before = snapshot(&root);
    let p = ok!(core.pins_apply(None, pin_query(PROJEKTY)), "pin Projekty v běhu");
    assert_eq!(disk_s(&root, ".tegg/pinned.yml"), Some(pins_file(&["query: Projekty v běhu"])), "one item, one write");
    assert_eq!(files_changed(&before, &snapshot(&root)), set(&[".tegg/pinned.yml"]), "only the pins file");
    let row = some!(p.rows.first(), "a row");
    assert_eq!((row.state, row.title.as_deref(), row.path.as_deref().map(nfc)), (PinState::Ok, Some(PROJEKTY), Some(qpath(PROJEKTY))), "the row");
    let again = ok!(core.pins_apply(p.version.clone(), pin_query("projekty V BĚHU")), "pin again by another case");
    assert_eq!(again.rows.len(), 1, "already listed: no second item");
    let r = core.pins_apply(again.version.clone(), pin_query("Neexistující dotaz"));
    assert!(matches!(r, Err(CoreError::Pin(tegg_core::pinned::PinError::NotPinnable))), "no live query of that name: NotPinnable ({r:?})");
}

#[test]
fn fr_hom_02_ac29_query_pins_resolve_by_name() {
    let sb = sandbox();
    let root = vault(&sb);
    let text = pins_file(&["query: Otevřené úkoly tento týden", "query: projekty V BĚHU", &format!("query: {}", nfd(PROJEKTY))]);
    write(&root, ".tegg/pinned.yml", text.as_bytes());
    let core = open(&root, &sb.dirs);
    let pins = stamp(&root, ".tegg/pinned.yml");
    let p = core.pins();
    let states: Vec<PinState> = p.rows.iter().map(|r| r.state).collect();
    assert_eq!(states, vec![PinState::Missing, PinState::Ok, PinState::Ok], "Not found; other case and NFD resolve");
    let titles: Vec<Option<String>> = p.rows.iter().skip(1).map(|r| r.title.clone()).collect();
    assert_eq!(titles, vec![Some(PROJEKTY.to_string()); 2], "both read Projekty v běhu");
    external(&core, &root, &qpath("Otevřené úkoly tento týden"), "version: 1\ntitle: Otevřené úkoly tento týden\ntypes: [task]\n".as_bytes());
    assert_eq!(core.pins().rows.first().map(|r| r.state), Some(PinState::Ok), "a normal row once the file exists");
    assert_eq!(stamp(&root, ".tegg/pinned.yml"), pins, "no pins write");
}

#[test]
fn fr_hom_02_ac30_query_pins_follow_trash() {
    let sb = sandbox();
    let root = vault(&sb);
    write(&root, ".tegg/pinned.yml", pins_file(&["query: Projekty v běhu"]).as_bytes());
    let core = open(&root, &sb.dirs);
    let pins = stamp(&root, ".tegg/pinned.yml");
    assert_eq!(core.pins().rows.first().map(|r| r.state), Some(PinState::Ok), "a live query");
    ok!(core.query_trash(PROJEKTY), "trash");
    let row = core.pins().rows.first().cloned();
    assert_eq!(row.as_ref().map(|r| (r.state, r.path.as_deref().map(nfc))), Some((PinState::Trashed, Some(trashed_qpath(PROJEKTY)))), "In the trash");
    ok!(core.query_restore(PROJEKTY), "restore");
    assert_eq!(core.pins().rows.first().map(|r| r.state), Some(PinState::Ok), "normal again");
    ok!(core.query_trash(PROJEKTY), "trash again");
    let _ = core.trash_delete(&[trashed_qpath(PROJEKTY)], &Sink(sb.base.join("system-trash")));
    assert_eq!(core.pins().rows.first().map(|r| r.state), Some(PinState::Missing), "deleted for good: Not found");
    assert_eq!(stamp(&root, ".tegg/pinned.yml"), pins, "nothing removes or rewrites the pin (D-1374, D-1435)");
}

// ================================================================================================ FR-EDT-02 AC-24 (bytes)

/// L4 for the bytes: running the blocks writes nothing, and a paragraph edit next to a block leaves every fence's bytes.
#[test]
fn fr_edt_02_ac24_query_block_is_one_atom() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs);
    let before = snapshot(&root);
    for n in [P7, LISABON, PREHLED, DEN] {
        let text = fixture_s(n);
        let fences = tegg_format::query_fences(&text);
        assert!(!fences.is_empty(), "{n}: its blocks");
        for fe in &fences {
            let _ = run_fence(&core, &fe.body, Some(n));
        }
    }
    assert_eq!(files_changed(&before, &snapshot(&root)), BTreeSet::new(), "showing and running blocks writes nothing");
    let old = fixture_s(P7);
    let edited = swapped(&old, &[("Další porada:", "Příští porada:")]);
    note_write(&core, P7, &edited);
    let a: Vec<String> = tegg_format::query_fences(&old).iter().map(|f| old[f.range.clone()].to_string()).collect();
    let b: Vec<String> = tegg_format::query_fences(&edited).iter().map(|f| edited[f.range.clone()].to_string()).collect();
    assert_eq!((a.len(), b), (2, a.clone()), "the two fences keep their exact bytes next to the edited paragraph");
    assert_eq!(disk_s(&root, P7), Some(edited), "only that paragraph changed");
}
