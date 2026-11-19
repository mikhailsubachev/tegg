//! Slice Q2 L4 tests on Q2's core types (docs/acceptance/views.md R184, R185, R187, R193; docs/contracts/v1-views.md
//! §1.1…§1.6, §1.9): the board's `group` (lanes, cards, `raw`, exclusion, `lane_order`, unknown / none / tag / relation
//! lanes, NFC), the query-file writes of `Core::query_apply` and `query_create` with Q2's keys against
//! tests/fixtures/queries-files/expected/views/, the type file's `views:` through `Core::type_patch` with
//! `TypeOp::SetViews`, `Core::query_view_usages`, the base checks, the watcher, FR-QRY-08 AC-2's first write, the kill
//! harness (FR-SYN-02 AC-11) and NFR-POR-01 AC-6 (the written files parse with the `yaml` npm package). Compiles against
//! the compile-only stubs of D-1813 (f0cd8c3d) and uses only the contract's public interface. The test clock is
//! `2026-11-19T10:00:00+01:00`, Europe/Prague, `cs` (injected). Written from the ACs, the fixtures and the contract only
//! (D-61); every check is an assertion in this file.

mod common;
mod views_setup;

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime};

use common::{repo_root, sandbox, snapshot, wait_until, Entry};
use std::collections::BTreeMap;
use tegg_core::queries_q::{GroupKind, Grouping, LaneKind, Lanes, Order, QueryCreate, QueryDef, QueryResult, Sort, View};
use tegg_core::{Core, CoreError, CoreOptions, FileVersion, VaultError};
use tegg_schema::TypeOp;
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

const AUTOR: &str = ".tegg/types/autor.yml";

// ------------------------------------------------------------------------------------------------ helpers (asserting)

fn current(core: &Core, name: &str) -> (QueryDef, FileVersion) {
    let r = core.query(name);
    let d = some!(r.def.clone(), format!("query({name}).def"));
    let v = some!(r.version.clone(), format!("query({name}).version"));
    (d, v)
}
/// One commit: the current definition with `edit` applied, the current version as base, at the test clock.
fn commit(core: &Core, name: &str, edit: impl FnOnce(&mut QueryDef)) -> Result<(), CoreError> {
    let (mut d, v) = current(core, name);
    edit(&mut d);
    core.query_apply(name, &v, d, NOW).map(|_| ())
}
fn lv(levels: &[(&str, Order)]) -> Vec<Sort> {
    levels.iter().map(|(b, o)| Sort { by: b.to_string(), order: *o }).collect()
}
fn group(r: &QueryResult, what: &str) -> Grouping {
    some!(r.group.clone(), format!("{what}: QueryResult.group"))
}
/// The lanes as (id, card paths).
fn lanes(r: &QueryResult, what: &str) -> Vec<(String, Vec<String>)> {
    let g = group(r, what);
    g.lanes.iter().map(|l| (tegg_format::nfc(&l.id), l.cards.iter().map(|c| tegg_format::nfc(&r.rows[c.row].path)).collect())).collect()
}
fn lane_ids(r: &QueryResult, what: &str) -> Vec<String> {
    lanes(r, what).into_iter().map(|(i, _)| i).collect()
}
fn type_base(core: &Core, key: &str) -> FileVersion {
    let t = some!(core.type_get(key), format!("type_get({key})"));
    some!(t.version, format!("type_get({key}).version"))
}
fn set_views(core: &Core, key: &str, names: &[&str]) -> Result<(), CoreError> {
    let b = type_base(core, key);
    core.type_patch(key, Some(&b), &[TypeOp::SetViews(names.iter().map(|s| s.to_string()).collect())]).map(|_| ())
}
fn changed(a: &BTreeMap<String, Entry>, b: &BTreeMap<String, Entry>) -> Vec<String> {
    let mut keys: Vec<&String> = a.keys().chain(b.keys()).collect();
    keys.sort();
    keys.dedup();
    keys.into_iter().filter(|k| a.get(*k) != b.get(*k) && !k.ends_with('/')).map(|k| tegg_format::nfc(k)).collect()
}
fn ino(root: &Path, rel: &str) -> Option<u64> {
    stamp(root, rel).map(|s| s.2)
}
fn strs(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}
fn board_query(title: &str, filters: &[&str], extra: &[&str]) -> String {
    let f = if filters.is_empty() { "filters: []".to_string() } else { format!("filters:\n{}", filters.iter().map(|x| format!("  - {x}")).collect::<Vec<_>>().join("\n")) };
    format!(
        "# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › {title}.\nversion: 1\ntitle: {title}\ntypes: [book]\nmatch: all\n{f}\nsort: {{ by: title, order: asc }}\nlimit: 50\nview: board\n{}\ncolumns: [author]\ncreated: 2026-11-01T09:00:00+01:00\nmodified: 2026-11-01T09:00:00+01:00\n",
        extra.join("\n")
    )
}
fn podle_stavu(filters: &[&str]) -> String {
    board_query("Podle stavu", filters, &["group_by: status", "lanes: vertical"])
}
const ABANDONED: (&str, &str) = ("      - { label: Read, color: green }\n", "      - { label: Read, color: green }\n      - { label: Abandoned, color: red }\n");

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-10, AC-11, AC-15

#[test]
fn fr_qry_05_ac10_board_by_select() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let r = run(&core, ROZ, &env());
    let g = group(&r, "Rozečtené");
    assert_eq!((g.key.as_str(), matches!(g.kind, GroupKind::Select), g.name.as_str()), ("status", true, "Status"), "grouped by the Select status");
    assert_eq!(
        lanes(&r, "Rozečtené"),
        vec![
            ("option:Reading".to_string(), bs(&["Noční vlak", "Účetní ze Žižkova", "Světla přístavu"])),
            ("option:To read".to_string(), bs(&["Dům u řeky", "Kniha o horách"])),
            ("option:Read".to_string(), vec![]),
        ],
        "R193: lanes in lane_order, cards in the view's order"
    );
    let meta: Vec<(bool, bool, Option<String>, Option<String>, String)> =
        g.lanes.iter().map(|l| (l.excluded, l.drop_target, l.color.clone(), l.value.clone(), l.label.clone())).collect();
    assert_eq!(
        meta,
        vec![
            (false, true, Some("blue".into()), Some("Reading".into()), "Reading".into()),
            (false, true, Some("gray".into()), Some("To read".into()), "To read".into()),
            (true, true, Some("green".into()), Some("Read".into()), "Read".into()),
        ],
        "Read is excluded (is_any_of) and still a drop target; option colours"
    );
    assert!(g.lanes.iter().all(|l| matches!(l.kind, LaneKind::Option)), "option lanes");
    assert_eq!(g.lanes[0].cards.iter().map(|c| c.raw.clone()).collect::<Vec<_>>(), vec![strs(&["Reading"]); 3], "raw: the value that placed each card");
    assert_eq!(r.rows.len(), 5, "every result in rows (no paging)");
    let row = &r.rows[0];
    assert!(!row.excerpt.is_empty() && !row.read_only, "rows carry the excerpt and read_only (contract §1.1)");
    // A runtime lane_order: [To read] lists the others after it in option order.
    write(&root, &qpath(ROZ), swapped(&fixture(&qpath(ROZ)), "lane_order: [Reading, To read, Read]\n", "lane_order: [To read]\n").as_bytes());
    reread(&core, &[&qpath(ROZ)]);
    assert_eq!(lane_ids(&run(&core, ROZ, &env()), "lane_order [To read]"), strs(&["option:To read", "option:Reading", "option:Read"]), "To read, then Reading, Read");
    // `limit` isn't applied on a board.
    write(&root, &qpath(ROZ), swapped(&fixture(&qpath(ROZ)), "limit: 50\n", "limit: 2\n").as_bytes());
    reread(&core, &[&qpath(ROZ)]);
    let l = run(&core, ROZ, &env());
    assert_eq!(lanes(&l, "limit 2").iter().map(|(_, c)| c.len()).sum::<usize>(), 5, "limit: 2 still has all 5 cards");
}

#[test]
fn fr_qry_05_ac11_group_by_kinds() {
    let sb = sandbox();
    let root = vault(&sb);
    write(&root, &qpath("Podle štítku"), board_query("Podle štítku", &[], &["group_by: tags", "lanes: vertical"]).as_bytes());
    let core = open(&root, &sb.dirs, false);
    let z = run(&core, ZANR, &env());
    assert!(matches!(group(&z, ZANR).kind, GroupKind::MultiSelect), "Podle žánru: multi-select");
    assert_eq!(
        lanes(&z, ZANR),
        vec![
            ("option:Román".into(), bs(&["Čarovná mapa", "Dům u řeky", "Mapa bez severu", "Noční vlak", "Sto zimních dní", "Účetní ze Žižkova"])),
            ("option:Detektivka".into(), bs(&["Čtvrtá zima", "Tiché město", "Účetní ze Žižkova"])),
            ("option:Poezie".into(), bs(&["Písně z dálky", "Zahrada v dešti"])),
            ("option:Eseje".into(), bs(&["Kniha o čaji", "Sto zimních dní", "Světla přístavu"])),
            ("option:Cestopis".into(), bs(&["Cizí přístavy", "Čarovná mapa", "Kniha o horách", "Šest cest k moři", "Zápisník z Tater"])),
            ("none".into(), bs(&["Ostrov bez jména"])),
        ],
        "R193: six lanes, 20 cards for 17 books"
    );
    let none = &group(&z, ZANR).lanes[5];
    assert!(matches!(none.kind, LaneKind::None) && !none.drop_target && none.value.is_none(), "No Genres: not a drop target, no value");
    let a = run(&core, AUTOR_Q, &env());
    let ga = group(&a, AUTOR_Q);
    assert!(matches!(ga.kind, GroupKind::Relation { multiple: false }), "Podle autora: a single relation");
    let ids: Vec<String> = ["Eva Lindová", "Jana Brázdová", "Lucie Horká", "Marek Sova", "Tomáš Rybář"].iter().map(|n| tegg_format::nfc(&format!("relation:Autoři/{n}.md"))).chain(["none".to_string()]).collect();
    assert_eq!(lane_ids(&a, AUTOR_Q), ids, "relation lanes by title collation, then No Author");
    assert_eq!(ga.lanes[0].value.as_deref(), Some("[[Eva Lindová]]"), "a relation lane's value is the D-184 link text");
    assert_eq!(ga.lanes[0].target.as_deref().map(tegg_format::nfc), Some(tegg_format::nfc("Autoři/Eva Lindová.md")), "and its target");
    let t = run(&core, "Podle štítku", &env());
    let tl = lanes(&t, "Podle štítku");
    assert_eq!(tl.iter().map(|(i, c)| (i.clone(), c.len())).collect::<Vec<_>>(), vec![("tag:doporučené".into(), 2), ("tag:odloženo".into(), 1), ("tag:večerní".into(), 1), ("none".into(), 13)], "four tag lanes");
    let gt = group(&t, "Podle štítku");
    assert_eq!(gt.lanes[2].cards.first().map(|c| c.raw.clone()), Some(vec![]), "the inline #večerní: raw is empty");
    assert!(run(&core, DATUM, &env()).group.is_none(), "group_by: finished (a date): no group");
}

#[test]
fn fr_qry_05_ac15_no_value_unknown_and_excluded_lanes() {
    let sb = sandbox();
    let root = vault(&sb);
    write(&root, &qpath("Podle stavu"), podle_stavu(&[]).as_bytes());
    let core = open(&root, &sb.dirs, false);
    let r = run(&core, "Podle stavu", &env());
    let l = lanes(&r, "Podle stavu");
    assert_eq!(
        l.iter().map(|(i, c)| (i.clone(), c.len())).collect::<Vec<_>>(),
        vec![("option:To read".into(), 3), ("option:Reading".into(), 3), ("option:Read".into(), 9), ("unknown:Rozečteno".into(), 1), ("none".into(), 1)],
        "To read 3, Reading 3, Read 9, Rozečteno 1, No Status 1"
    );
    let g = group(&r, "Podle stavu");
    assert_eq!(g.lanes.iter().map(|x| x.drop_target).collect::<Vec<_>>(), vec![true, true, true, false, false], "unknown and none lanes aren't drop targets");
    let excluded = |filters: &[&str], m: &str| -> Vec<(String, bool)> {
        write(&root, &qpath("Podle stavu"), podle_stavu(filters).replace("match: all", &format!("match: {m}")).as_bytes());
        reread(&core, &[&qpath("Podle stavu")]);
        let r = run(&core, "Podle stavu", &env());
        match r.group {
            Some(g) => g.lanes.iter().map(|x| (tegg_format::nfc(&x.id), x.excluded)).collect(),
            None => vec![],
        }
    };
    assert_eq!(excluded(&["status: { is_not: Read }"], "all"), vec![("option:To read".into(), false), ("option:Reading".into(), false), ("option:Read".into(), true), ("unknown:Rozečteno".into(), false)], "is_not Read");
    assert_eq!(excluded(&["status: { is_any_of: [Reading] }"], "all"), vec![("option:To read".into(), true), ("option:Reading".into(), false), ("option:Read".into(), true)], "is_any_of [Reading]");
    assert!(excluded(&["rating: Good"], "all").iter().all(|(_, e)| !e), "a filter on another attribute: nothing excluded");
    assert!(excluded(&["status: { is_not: Read }"], "any").iter().all(|(_, e)| !e), "match: any: nothing excluded");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-09 AC-6, AC-7

#[test]
fn fr_qry_09_ac6_cards_follow_edits() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, true);
    assert_eq!(lanes(&run(&core, ROZ, &env()), "before").len(), 3, "precondition: three lanes");
    write(&root, &b("Noční vlak"), swapped(&fixture("Books/Noční vlak.md"), "status: Reading\n", "status: Read\n").as_bytes());
    std::fs::remove_file(root.join(b("Kniha o horách"))).expect("setup: delete");
    let want = vec![
        ("option:Reading".to_string(), bs(&["Účetní ze Žižkova", "Světla přístavu"])),
        ("option:To read".to_string(), bs(&["Dům u řeky"])),
        ("option:Read".to_string(), vec![]),
    ];
    let seen = wait_until(Duration::from_secs(2), || run(&core, ROZ, &env()).group.map(|_| lanes(&run(&core, ROZ, &env()), "live")) == Some(want.clone()));
    assert!(seen.is_some(), "the lanes follow within 2 s");
}

#[test]
fn fr_qry_09_ac7_lanes_follow_the_type_file() {
    let sb = sandbox();
    let root = vault(&sb);
    write(&root, &qpath("Podle stavu"), podle_stavu(&[]).as_bytes());
    let core = open(&root, &sb.dirs, true);
    let before_books = snapshot(&root.join("Books"));
    write(&root, BOOK, swapped(&fixture(BOOK), ABANDONED.0, ABANDONED.1).as_bytes());
    let ok_a = wait_until(Duration::from_secs(2), || run(&core, "Podle stavu", &env()).group.map(|g| g.lanes.iter().any(|l| l.id == "option:Abandoned")).unwrap_or(false));
    assert!(ok_a.is_some(), "Abandoned shows within 2 s");
    assert_eq!(lane_ids(&run(&core, "Podle stavu", &env()), "Abandoned")[..4], strs(&["option:To read", "option:Reading", "option:Read", "option:Abandoned"])[..], "after Read");
    write(&root, BOOK, swapped(&fixture(BOOK), "      - { label: Read, color: green }\n", "      - { label: Done reading, color: green }\n").as_bytes());
    let renamed = wait_until(Duration::from_secs(2), || run(&core, "Podle stavu", &env()).group.map(|g| g.lanes.iter().any(|l| l.id == "option:Done reading")).unwrap_or(false));
    assert!(renamed.is_some(), "Done reading shows");
    let l = lanes(&run(&core, "Podle stavu", &env()), "renamed option");
    assert_eq!(l.iter().map(|(i, c)| (i.clone(), c.len())).collect::<Vec<_>>()[2..4], [("option:Done reading".to_string(), 0), ("unknown:Read".to_string(), 9)], "an empty Done reading and a Read unknown lane with 9");
    assert_eq!(snapshot(&root.join("Books")), before_books, "no book is rewritten");
    // D-1825: put the `Read` option back first, so the external `lane_order` below has a `Read` lane to move.
    write(&root, BOOK, fixture(BOOK).as_bytes());
    let restored = wait_until(Duration::from_secs(2), || run(&core, ROZ, &env()).group.map(|g| g.lanes.iter().any(|l| l.id == "option:Read")).unwrap_or(false));
    assert!(restored.is_some(), "Read is an option again");
    write(&root, &qpath(ROZ), swapped(&fixture(&qpath(ROZ)), "lane_order: [Reading, To read, Read]\n", "lane_order: [Read, Reading, To read]\n").as_bytes());
    let reordered = wait_until(Duration::from_secs(2), || run(&core, ROZ, &env()).group.map(|g| g.lanes.first().map(|l| l.id.clone())) == Some(Some("option:Read".into())));
    assert!(reordered.is_some(), "an external lane_order reorders within 2 s");
}

// ------------------------------------------------------------------------------------------------ query-file writes

#[test]
fn fr_qry_05_ac17_lanes_switch_writes_once() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let before = snapshot(&root);
    ok!(commit(&core, ROZ, |d| d.lanes = Lanes::Vertical), "the checked radio");
    assert_eq!(snapshot(&root), before, "the checked radio writes nothing");
    ok!(commit(&core, ROZ, |d| d.lanes = Lanes::Horizontal), "Rozečtené horizontal");
    assert_eq!(disk_s(&root, &qpath(ROZ)), Some(expected("rozectene-lanes-horizontal.yml")), "line 15 and modified");
    ok!(commit(&core, AUTOR_Q, |d| d.lanes = Lanes::Horizontal), "Podle autora horizontal");
    assert_eq!(disk_s(&root, &qpath(AUTOR_Q)), Some(expected("podle-autora-lanes-horizontal.yml")), "inserted after group_by");
    ok!(commit(&core, ZANR, |d| d.lanes = Lanes::Vertical), "Podle žánru vertical");
    assert_eq!(disk_s(&root, &qpath(ZANR)), Some(expected("podle-zanru-lanes-vertical.yml")), "the comment and its spaces kept");
    assert_eq!(changed(&before, &snapshot(&root)), {
        let mut v = vec![qpath(AUTOR_Q), qpath(ROZ), qpath(ZANR)].into_iter().map(|p| tegg_format::nfc(&p)).collect::<Vec<_>>();
        v.sort();
        v
    }, "only those three files");
    assert_eq!(current(&core, ROZ).0.lanes, Lanes::Horizontal, "parses back to the intended lanes (D-1458)");
}

#[test]
fn fr_qry_05_ac19_lane_order_by_drag_and_reset() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    ok!(commit(&core, ROZ, |d| d.lane_order = Some(strs(&["To read", "Reading", "Read"]))), "drag To read first");
    assert_eq!(disk_s(&root, &qpath(ROZ)), Some(expected("rozectene-lane-order-to-read-first.yml")), "line 16 only");
    ok!(commit(&core, ROZ, |d| d.lane_order = None), "Reset lane order");
    assert_eq!(disk_s(&root, &qpath(ROZ)), Some(expected("rozectene-lane-order-reset.yml")), "the line is removed");
    assert_eq!(lane_ids(&run(&core, ROZ, &env()), "reset"), strs(&["option:To read", "option:Reading", "option:Read"]), "option order");
    ok!(commit(&core, ZANR, |d| d.lane_order = Some(strs(&["Cestopis", "Román", "Detektivka", "Poezie", "Eseje"]))), "Podle žánru drag");
    assert_eq!(disk_s(&root, &qpath(ZANR)), Some(expected("podle-zanru-lane-order-cestopis.yml")), "inserted after line 14");
    ok!(commit(&core, AUTOR_Q, |d| d.lane_order = Some(strs(&["[[Tomáš Rybář]]", "[[Eva Lindová]]", "[[Jana Brázdová]]", "[[Lucie Horká]]", "[[Marek Sova]]"]))), "Podle autora drag");
    assert_eq!(disk_s(&root, &qpath(AUTOR_Q)), Some(expected("podle-autora-lane-order-tomas.yml")), "relation link texts, D-230 quoting");
    assert_eq!(lane_ids(&run(&core, AUTOR_Q, &env()), "Tomáš first")[0], tegg_format::nfc("relation:Autoři/Tomáš Rybář.md"), "the lane moves first");
    write(&root, BOOK, swapped(&fixture(BOOK), ABANDONED.0, ABANDONED.1).as_bytes());
    reread(&core, &[BOOK]);
    assert_eq!(lane_ids(&run(&core, ROZ, &env()), "Abandoned"), strs(&["option:To read", "option:Reading", "option:Read", "option:Abandoned"]), "a new option shows after Read");
}

#[test]
fn fr_qry_01_ac9_sort_popover_writes_each_change_once() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let steps: Vec<(&str, Vec<Sort>, &str)> = vec![
        ("(a)", lv(&[("finished", Order::Desc), ("rating", Order::Desc), ("title", Order::Asc)]), "prectene-2026-sort-rating-desc.yml"),
        ("(b)", lv(&[("title", Order::Asc), ("finished", Order::Desc), ("rating", Order::Desc)]), "prectene-2026-sort-title-first.yml"),
        ("(c)", lv(&[("title", Order::Asc)]), "prectene-2026-sort-one-level.yml"),
        ("(d)", lv(&[("title", Order::Asc), ("created", Order::Asc)]), "prectene-2026-sort-add-created.yml"),
        ("(e)", lv(&[("modified", Order::Desc)]), "prectene-2026-sort-cleared.yml"),
    ];
    for (what, s, exp) in steps {
        let before = snapshot(&root);
        let want = s.clone();
        ok!(commit(&core, P26, |d| d.sort = s), format!("{what}: query_apply"));
        assert_eq!(disk_s(&root, &qpath(P26)), Some(expected(exp)), "{what}: the bytes");
        assert_eq!(changed(&before, &snapshot(&root)), vec![tegg_format::nfc(&qpath(P26))], "{what}: one file");
        assert_eq!(current(&core, P26).0.sort, want, "{what}: parses back to the intended levels (D-1458)");
    }
}

#[test]
fn fr_qry_01_ac10_sort_file_shapes() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    assert_eq!(current(&core, P26).0.sort, lv(&[("finished", Order::Desc), ("rating", Order::Asc), ("title", Order::Asc)]), "the fixture's list is read as three levels");
    ok!(commit(&core, VYB, |d| d.sort = lv(&[("title", Order::Asc), ("finished", Order::Asc)])), "(a) ⇧-click Finished");
    assert_eq!(disk_s(&root, &qpath(VYB)), Some(expected("vyborne-knihy-sort-two-levels.yml")), "(a) three lines in place of line 8");
    ok!(commit(&core, VYB, |d| d.sort = lv(&[("title", Order::Asc)])), "(b) remove the level");
    assert_eq!(disk_s(&root, &qpath(VYB)), Some(expected("vyborne-knihy-sort-back-to-one.yml")), "(b) one line again");
    ok!(commit(&core, ZANR, |d| d.sort = lv(&[("title", Order::Asc), ("created", Order::Asc)])), "(c) + Add sort");
    assert_eq!(disk_s(&root, &qpath(ZANR)), Some(expected("podle-zanru-sort-add-level.yml")), "(c) the comment stays on `sort:`");
    // A sort equal to the one on disk writes nothing.
    let before = snapshot(&root);
    ok!(commit(&core, P26, |d| d.sort = lv(&[("finished", Order::Desc), ("rating", Order::Asc), ("title", Order::Asc)])), "same sort");
    assert_eq!(snapshot(&root), before, "the same levels write nothing");
}

#[test]
fn fr_qry_01_ac11_header_click_and_shift_click() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    for (what, s, exp) in [
        ("(a)", lv(&[("rating", Order::Asc)]), "prectene-2026-click-rating.yml"),
        ("(b)", lv(&[("rating", Order::Desc)]), "prectene-2026-click-rating-desc.yml"),
        ("(c)", lv(&[("rating", Order::Desc), ("finished", Order::Asc)]), "prectene-2026-shift-finished.yml"),
        ("(d)", lv(&[("author", Order::Asc)]), "prectene-2026-click-author.yml"),
    ] {
        ok!(commit(&core, P26, |d| d.sort = s), what);
        assert_eq!(disk_s(&root, &qpath(P26)), Some(expected(exp)), "{what}: the bytes");
    }
    ok!(commit(&core, P26, |d| d.sort = lv(&[("rating", Order::Asc)])), "(a) again");
    let r = run(&core, P26, &env());
    assert_eq!(paths(&r), bs(&["Cizí přístavy", "Čarovná mapa", "Mapa bez severu", "Sto zimních dní", "Šest cest k moři", "Tiché město", "Kniha o čaji", "Zahrada v dešti"]), "(a) Excellent, Good, Bad; title inside");
}

#[test]
fn fr_qry_01_ac12_the_editor_for_a_view() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let (d, _) = current(&core, ROZ);
    assert_eq!((d.view, d.group_by.clone(), d.lanes, d.lane_order.clone()), (View::Board, Some("status".into()), Lanes::Vertical, Some(strs(&["Reading", "To read", "Read"]))), "Rozečtené reads its board keys");
    ok!(commit(&core, ROZ, |d| d.group_by = Some("genres".into())), "Group by Genres");
    assert_eq!(disk_s(&root, &qpath(ROZ)), Some(expected("rozectene-group-by-genres.yml")), "only group_by and modified");
    ok!(commit(&core, ROZ, |d| d.view = View::Table), "Table");
    assert_eq!(disk_s(&root, &qpath(ROZ)), Some(expected("rozectene-view-table.yml")), "only view and modified; the board keys stay");
    let (d2, _) = current(&core, ROZ);
    assert_eq!((d2.group_by, d2.lanes, d2.lane_order), (Some("genres".into()), Lanes::Vertical, Some(strs(&["Reading", "To read", "Read"]))), "and read back with view: table");
}

#[test]
fn fr_qry_07_ac3_a_view_tab_shows_its_query() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let book = stamp(&root, BOOK);
    assert_eq!(current(&core, P26).0.sort, lv(&[("finished", Order::Desc), ("rating", Order::Asc), ("title", Order::Asc)]), "the view's three sort levels are read (so the commit keeps them)");
    ok!(commit(&core, P26, |d| d.columns.push("genres".into())), "Columns › Genres");
    assert_eq!(disk_s(&root, &qpath(P26)), Some(expected("prectene-2026-columns-genres.yml")), "only columns and modified (the three-level sort kept)");
    assert_eq!(current(&core, P26).0.sort, lv(&[("finished", Order::Desc), ("rating", Order::Asc), ("title", Order::Asc)]), "and read back after the commit");
    assert_eq!(stamp(&root, BOOK), book, "book.yml untouched");
}

#[test]
fn fr_qry_07_ac18_columns_reorder_by_header_drag() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    assert_eq!(current(&core, P26).0.sort, lv(&[("finished", Order::Desc), ("rating", Order::Asc), ("title", Order::Asc)]), "the view's three sort levels are read (so the commit keeps them)");
    ok!(commit(&core, P26, |d| d.columns = strs(&["finished", "author", "rating"])), "header drag");
    assert_eq!(disk_s(&root, &qpath(P26)), Some(expected("prectene-2026-columns-reordered.yml")), "only columns and modified");
    assert_eq!(current(&core, P26).0.sort, lv(&[("finished", Order::Desc), ("rating", Order::Asc), ("title", Order::Asc)]), "and read back after the commit");
}

#[test]
fn fr_fmt_07_ac32_query_files_with_q2_keys_round_trip() {
    for (variant, conv) in [("lf", 0u8), ("crlf", 1), ("no-newline", 2)] {
        let sb = sandbox();
        let root = vault(&sb);
        let enc = |t: &str| match conv {
            1 => t.replace('\n', "\r\n"),
            2 => t.trim_end_matches('\n').to_string(),
            _ => t.to_string(),
        };
        write(&root, &qpath(ZANR), enc(&fixture(&qpath(ZANR))).as_bytes());
        let core = open(&root, &sb.dirs, false);
        ok!(commit(&core, ZANR, |d| d.lanes = Lanes::Vertical), format!("{variant}: Switch lanes"));
        let exp = match conv {
            1 => "podle-zanru-lanes-vertical-crlf.yml",
            2 => "podle-zanru-lanes-vertical-no-newline.yml",
            _ => "podle-zanru-lanes-vertical.yml",
        };
        assert_eq!(disk_s(&root, &qpath(ZANR)), Some(expected(exp)), "{variant}: only the lanes line and modified");
    }
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    ok!(commit(&core, ZANR, |d| d.lane_order = Some(strs(&["Cestopis", "Román", "Detektivka", "Poezie", "Eseje"]))), "a lane drag");
    ok!(commit(&core, ZANR, |d| d.lane_order = None), "Reset lane order");
    assert_eq!(disk_s(&root, &qpath(ZANR)), Some(expected("podle-zanru-lane-order-reset-after-drag.yml")), "the fixture again except modified (comments, x-barva kept)");
}

// ------------------------------------------------------------------------------------------------ New view, views:, usages

fn new_def(core: &Core, types: &[&str], view: View, group_by: Option<&str>, columns: &[&str]) -> QueryDef {
    let (mut d, _) = current(core, VYB);
    d.title = "New view".into();
    d.types = strs(types);
    d.filters = vec![];
    d.sort = lv(&[("modified", Order::Desc)]);
    d.limit = 50;
    d.view = view;
    d.group_by = group_by.map(str::to_string);
    d.lanes = Lanes::Vertical;
    d.lane_order = None;
    d.columns = strs(columns);
    d
}

#[test]
fn fr_qry_07_ac4_new_view_creates_a_query_and_a_tab() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let d = new_def(&core, &["autor"], View::Table, None, &["poznámka", "modified"]);
    ok!(core.query_create(QueryCreate { title: "New view".into(), def: Some(d), fence: None, free: true }, NOW), "(b) query_create");
    assert_eq!(disk_s(&root, &qpath("New view")), Some(expected("new-view-autor.yml")), "(b) New view.yml");
    ok!(set_views(&core, "autor", &["New view"]), "(b) type_patch views");
    assert_eq!(disk_s(&root, AUTOR), Some(expected("types/autor-views-new-view.yml")), "(b) autor.yml");
    std::fs::remove_file(root.join(qpath("New view"))).expect("setup: remove");
    reread(&core, &[&qpath("New view")]);
    let d = new_def(&core, &["book"], View::Board, Some("status"), &["author"]);
    ok!(core.query_create(QueryCreate { title: "New view".into(), def: Some(d.clone()), fence: None, free: true }, NOW), "(c) query_create board");
    assert_eq!(disk_s(&root, &qpath("New view")), Some(expected("new-view-board-book.yml")), "(c) group_by, lanes: vertical, columns [author]");
    ok!(set_views(&core, "book", &["Rozečtené", "Přečtené 2026", "Výborné knihy", "New view"]), "(c) type_patch");
    assert_eq!(disk_s(&root, BOOK), Some(expected("types/book-views-new-view.yml")), "(c) book.yml");
    ok!(core.query_create(QueryCreate { title: "New view".into(), def: Some(d), fence: None, free: true }, NOW), "a second New view");
    assert!(disk_s(&root, &qpath("New view (2)")).is_some(), "is `New view (2)`");
}

#[test]
fn fr_qry_07_ac5_show_a_saved_query() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let q = stamp(&root, &qpath(ZANR));
    ok!(set_views(&core, "book", &["Rozečtené", "Přečtené 2026", "Výborné knihy", "Podle žánru"]), "add Podle žánru");
    assert_eq!(disk_s(&root, BOOK), Some(expected("types/book-views-podle-zanru.yml")), "line 13 only");
    assert_eq!(stamp(&root, &qpath(ZANR)), q, "the query file is untouched");
}

#[test]
fn fr_qry_07_ac6_reorder_tabs_writes_views_once() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let before = snapshot(&root);
    let i0 = ino(&root, BOOK);
    ok!(set_views(&core, "book", &["Výborné knihy", "Rozečtené", "Přečtené 2026"]), "the drag");
    assert_eq!(disk_s(&root, BOOK), Some(expected("types/book-views-dragged.yml")), "line 13 only");
    assert_eq!(changed(&before, &snapshot(&root)), vec![BOOK.to_string()], "only book.yml");
    assert_ne!(ino(&root, BOOK), i0, "atomic (a new inode)");
    let s = snapshot(&root);
    ok!(set_views(&core, "book", &["Výborné knihy", "Rozečtené", "Přečtené 2026"]), "the same list");
    assert_eq!(snapshot(&root), s, "the same list writes nothing");
    let t = some!(core.type_get("book"), "type_get");
    assert_eq!(t.def.views, Some(strs(&["Výborné knihy", "Rozečtené", "Přečtené 2026"])), "TypeInfo reads the new views");
}

#[test]
fn fr_qry_07_ac9_duplicate_adds_a_tab_after_the_original() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    ok!(core.query_duplicate(VYB, NOW), "query_duplicate");
    ok!(set_views(&core, "book", &["Rozečtené", "Přečtené 2026", "Výborné knihy", "Výborné knihy (2)"]), "type_patch");
    assert_eq!(disk_s(&root, BOOK), Some(expected("types/book-views-duplicate.yml")), "the copy after the original");
}

#[test]
fn fr_qry_07_ac10_remove_keeps_the_query() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let q = stamp(&root, &qpath(P26));
    let cteni = stamp(&root, CTENI);
    ok!(set_views(&core, "book", &["Rozečtené", "Výborné knihy"]), "remove Přečtené 2026");
    assert_eq!(disk_s(&root, BOOK), Some(expected("types/book-views-removed.yml")), "line 13 only");
    assert_eq!((stamp(&root, &qpath(P26)), stamp(&root, CTENI)), (q, cteni), "the query file and Čtení untouched");
    ok!(set_views(&core, "book", &[]), "remove the rest");
    assert_eq!(disk_s(&root, BOOK), Some(expected("types/book-views-empty.yml")), "views: []");
}

#[test]
fn fr_qry_07_ac11_trashed_views_keep_their_tab() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let book = stamp(&root, BOOK);
    ok!(core.query_trash(VYB), "Move to trash");
    assert_eq!(disk_s(&root, &format!(".trash/{}", qpath(VYB))), Some(fixture(&qpath(VYB))), "the same bytes in .trash/.tegg/queries/");
    assert_eq!(stamp(&root, BOOK), book, "book.yml untouched");
    assert_eq!(core.query_view_usages(VYB).iter().map(|u| u.type_key.clone()).collect::<Vec<_>>(), strs(&["book"]), "the trashed query is still a view of Books");
    ok!(core.query_restore(VYB), "Restore");
    assert_eq!(stamp(&root, BOOK), book, "book.yml still untouched");
}

#[test]
fn fr_qry_07_ac12_odd_views_and_broken_views() {
    let sb = sandbox();
    let root = vault(&sb);
    write(&root, BOOK, swapped(&fixture(BOOK), "views: [Rozečtené, Přečtené 2026, Výborné knihy]\n", "views:\n  - Rozečtené\n  - Přečtené 2026\n  - Výborné knihy\n").as_bytes());
    let core = open(&root, &sb.dirs, false);
    assert_eq!(some!(core.type_get("book"), "type_get").def.views, Some(strs(&["Rozečtené", "Přečtené 2026", "Výborné knihy"])), "(c) the block list is read in order");
    ok!(set_views(&core, "book", &["Rozečtené", "Výborné knihy"]), "(c) a tab change");
    assert_eq!(disk_s(&root, BOOK), Some(expected("types/book-views-block-to-flow.yml")), "(c) one flow line in its place");
    write(&root, BOOK, swapped(&fixture(BOOK), "views: [Rozečtené, Přečtené 2026, Výborné knihy]\n", "views: Rozečtené\n").as_bytes());
    reread(&core, &[BOOK]);
    let before = snapshot(&root);
    let r = set_views(&core, "book", &["Rozečtené"]);
    assert!(r.is_err(), "(d) a scalar views: refuses the write");
    assert_eq!(snapshot(&root), before, "(d) nothing written");
    assert_eq!(some!(core.type_get("book"), "type_get").def.views, None, "(d) views None");
}

#[test]
fn fr_qry_07_ac14_which_type_pages_have_views() {
    let sb = sandbox();
    let root = vault(&sb);
    let page = root.join(".tegg/types/page.yml");
    let builtin = std::fs::read_to_string(repo_root().join("tests/fixtures/vaults/new-empty/.tegg/types/page.yml")).ok();
    let _ = std::fs::remove_file(&page);
    let core = open(&root, &sb.dirs, false);
    let r = core.type_patch("page", None, &[TypeOp::SetViews(strs(&["New view"]))]);
    assert!(r.is_ok(), "the first view on type/page creates page.yml (D-90): {r:?}");
    let text = disk_s(&root, ".tegg/types/page.yml").unwrap_or_default();
    let lines: Vec<&str> = text.split('\n').collect();
    let at = lines.iter().position(|l| l.starts_with("views: "));
    assert_eq!(at.map(|i| lines[i]), Some("views: [New view]"), "one views: line");
    if let Some(b) = builtin {
        let without: Vec<&str> = lines.iter().enumerate().filter(|(i, _)| Some(*i) != at).map(|(_, l)| *l).collect();
        assert_eq!(without.join("\n"), b, "equal to new-empty's page.yml plus that line");
    }
}

#[test]
fn fr_qry_07_ac15_views_follow_external_changes() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, true);
    write(&root, BOOK, swapped(&fixture(BOOK), "views: [Rozečtené, Přečtené 2026, Výborné knihy]\n", "views: [Výborné knihy, Rozečtené]\n").as_bytes());
    let v = wait_until(Duration::from_secs(2), || core.type_get("book").and_then(|t| t.def.views) == Some(strs(&["Výborné knihy", "Rozečtené"])));
    assert!(v.is_some(), "the views follow book.yml within 2 s");
    write(&root, &qpath(ROZ), swapped(&fixture(&qpath(ROZ)), "lanes: vertical\n", "lanes: horizontal\n").as_bytes());
    let l = wait_until(Duration::from_secs(2), || core.query(ROZ).def.map(|d| d.lanes) == Some(Lanes::Horizontal));
    assert!(l.is_some(), "lanes: horizontal within 2 s");
}

#[test]
fn fr_qry_06_ac24_used_on_names_the_type_page() {
    let sb = sandbox();
    let root = vault(&sb);
    write(&root, AUTOR, swapped(&fixture(AUTOR), "preview: [poznámka]\n", "preview: [poznámka]\nviews: [přečtené 2026]\n").as_bytes());
    let core = open(&root, &sb.dirs, false);
    let u: Vec<(String, String)> = core.query_view_usages(P26).into_iter().map(|u| (u.type_key, tegg_format::nfc(&u.path))).collect();
    assert_eq!(u, vec![("autor".to_string(), tegg_format::nfc(AUTOR)), ("book".to_string(), BOOK.to_string())], "every type file naming it (name key), type-key order");
    assert_eq!(core.query_usages(P26).len(), 1, "query_usages still lists only the note (Čtení), separately");
    assert_eq!(core.query_view_usages(ZANR), vec![], "a query that is no tab: none");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-08 AC-2

#[test]
fn fr_qry_08_ac2_new_object_from_a_lane() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let nova = "Books/Nová kniha.md";
    let text = "---\ntype: book\ntitle: Nová kniha\nstatus: Reading\ncreated: 2026-11-19T10:00:00+01:00\nmodified: 2026-11-19T10:00:00+01:00\n---\n";
    ok!(core.create_exact(nova, text.as_bytes()), "the draft's first write");
    let _ = core.wait_idle(Duration::from_secs(30));
    let l = lanes(&run(&core, ROZ, &env()), "after the create");
    assert_eq!(l[0], ("option:Reading".to_string(), vec![nova.to_string(), b("Noční vlak"), b("Účetní ze Žižkova"), b("Světla přístavu")]), "the card shows in Reading");
}

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-30

#[test]
fn fr_syn_03_ac30_view_writes_check_the_base() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    // book.yml: a stale base is refused with Conflict and writes nothing.
    let stale = type_base(&core, "book");
    let theirs = swapped(&fixture(BOOK), "color: purple\n", "color: red\n");
    std::thread::sleep(Duration::from_millis(20));
    write(&root, BOOK, theirs.as_bytes());
    let r = core.type_patch("book", Some(&stale), &[TypeOp::SetViews(strs(&["Výborné knihy", "Rozečtené", "Přečtené 2026"]))]);
    assert!(matches!(r, Err(CoreError::Vault(VaultError::Conflict { .. }))), "a tab drag on a changed book.yml: Conflict, got {r:?}");
    assert_eq!(disk_s(&root, BOOK), Some(theirs.clone()), "nothing written");
    // The same bytes with only a new mtime are no conflict (D-175).
    reread(&core, &[BOOK]);
    let base = type_base(&core, "book");
    std::thread::sleep(Duration::from_millis(20));
    write(&root, BOOK, theirs.as_bytes());
    let r = core.type_patch("book", Some(&base), &[TypeOp::SetViews(strs(&["Výborné knihy", "Rozečtené", "Přečtené 2026"]))]);
    assert!(r.is_ok(), "same bytes, new mtime: written ({r:?})");
    // Rozečtené.yml: Switch lanes with a stale base.
    let (mut d, v) = current(&core, ROZ);
    let q = swapped(&fixture(&qpath(ROZ)), "title: Rozečtené\n", "title: Rozečtené\n# změna\n");
    write(&root, &qpath(ROZ), q.as_bytes());
    d.lanes = Lanes::Horizontal;
    let r = core.query_apply(ROZ, &v, d, NOW);
    assert!(r.is_err(), "Switch lanes on a changed file is refused");
    assert_eq!(disk_s(&root, &qpath(ROZ)), Some(q), "nothing written");
}

// ------------------------------------------------------------------------------------------------ FR-FMT-07 AC-33, FR-FMT-12 AC-12

#[test]
fn fr_fmt_07_ac33_type_files_and_notes_round_trip() {
    for (variant, text, exp) in [
        ("crlf", fixture(BOOK).replace('\n', "\r\n"), "types/book-views-crlf-dragged.yml"),
        ("no-newline", fixture(BOOK).trim_end_matches('\n').to_string(), "types/book-views-no-newline-dragged.yml"),
    ] {
        let sb = sandbox();
        let root = vault(&sb);
        write(&root, BOOK, text.as_bytes());
        let core = open(&root, &sb.dirs, false);
        ok!(set_views(&core, "book", &["Výborné knihy", "Rozečtené", "Přečtené 2026"]), format!("{variant}: the drag"));
        assert_eq!(disk_s(&root, BOOK), Some(expected(exp)), "{variant}: only the views line");
    }
    // Čtení: read and written back unchanged is byte-identical.
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let (bytes, v) = ok!(core.read_note(CTENI, SystemTime::now()), "read Čtení");
    let i0 = ino(&root, CTENI);
    let _ = core.write_note(CTENI, &bytes, Some(&v));
    assert_eq!(disk_s(&root, CTENI), Some(fixture(CTENI)), "Čtení byte-identical");
    assert_eq!(ino(&root, CTENI), i0, "an unchanged save writes nothing (FR-SYN-06)");
    assert!(lanes(&run(&core, ROZ, &env()), "Čtení's board").len() == 3, "the board of its second block draws");
}

#[test]
fn fr_fmt_12_ac12_view_names_and_lanes_are_nfc() {
    let sb = sandbox();
    let root = vault(&sb);
    write(&root, BOOK, swapped(&fixture(BOOK), "      - { label: Read, color: green }\n", "      - { label: Read, color: green }\n      - { label: Čtu, color: teal }\n").as_bytes());
    write(&root, "Books/Nová NFD.md", format!("---\ntype: book\ntitle: Nová NFD\nstatus: {}\ngenres: [{}]\ncreated: 2026-11-19T09:00:00+01:00\nmodified: 2026-11-19T09:00:00+01:00\n---\nČtu. #{}\n", nfd("Čtu"), nfd("Román"), nfd("doporučené")).as_bytes());
    write(&root, &qpath("Podle stavu"), podle_stavu(&[]).as_bytes());
    write(&root, &qpath("Podle štítku"), board_query("Podle štítku", &[], &["group_by: tags", "lanes: vertical"]).as_bytes());
    let core = open(&root, &sb.dirs, false);
    let nova = "Books/Nová NFD.md".to_string();
    let in_lanes = |name: &str| -> Vec<String> { lanes(&run(&core, name, &env()), name).into_iter().filter(|(_, c)| c.contains(&nova)).map(|(i, _)| i).collect() };
    assert_eq!(in_lanes("Podle stavu"), strs(&["option:Čtu"]), "NFD status Čtu: the Čtu lane, no extra lane");
    assert_eq!(in_lanes(ZANR), strs(&["option:Román"]), "NFD Román: the Román lane");
    assert_eq!(in_lanes("Podle štítku"), strs(&["tag:doporučené"]), "NFD #doporučené: the doporučené lane");
    ok!(set_views(&core, "book", &[&nfd("Výborné knihy"), &nfd("Rozečtené"), "Přečtené 2026"]), "an NFD views write");
    assert!(disk_s(&root, BOOK).is_some_and(|t| t.contains("views: [Výborné knihy, Rozečtené, Přečtené 2026]\n")), "written NFC");
    ok!(commit(&core, ROZ, |d| d.lane_order = Some(vec![nfd("Čtu"), "Reading".into()])), "an NFD lane_order");
    assert!(disk_s(&root, &qpath(ROZ)).is_some_and(|t| t.contains("lane_order: [Čtu, Reading]\n")), "lane_order written NFC");
}

// ------------------------------------------------------------------------------------------------ NFR-POR-01 AC-6

#[test]
fn nfr_por_01_ac6_view_files_are_plain() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    ok!(commit(&core, ROZ, |d| d.lanes = Lanes::Horizontal), "Switch lanes");
    ok!(commit(&core, P26, |d| d.sort = lv(&[("rating", Order::Desc), ("finished", Order::Asc)])), "a two-level sort");
    ok!(commit(&core, AUTOR_Q, |d| d.lane_order = Some(strs(&["[[Tomáš Rybář]]", "[[Eva Lindová]]"]))), "a relation lane_order");
    ok!(set_views(&core, "book", &["Výborné knihy", "Rozečtené", "Přečtené 2026", "Čtu, až bude čas"]), "views");
    let kniha = b("Kniha o horách");
    let (_, v) = ok!(core.read_note(&kniha, SystemTime::now()), "read");
    ok!(core.write_note(&kniha, expected("books/kniha-o-horach-reading.md").as_bytes(), Some(&v)), "card move");
    // Parse each written file with the `yaml` npm package (YAML 1.2) and print its JSON.
    let script = r#"const fs=require('fs');const Y=require(process.argv[1]);const out={};for(const p of process.argv.slice(3)){let t=fs.readFileSync(p,'utf8');if(t.startsWith('---')){t=t.split('\n---')[0].slice(4)}out[p.split(process.argv[2]+'/')[1]]=Y.parse(t);}console.log(JSON.stringify(out));"#;
    let yaml = repo_root().join("app/node_modules/yaml");
    let files = [qpath(ROZ), qpath(P26), qpath(AUTOR_Q), BOOK.to_string(), kniha.clone()];
    let out = Command::new("node")
        .arg("-e").arg(script).arg(yaml.to_string_lossy().to_string()).arg(root.to_string_lossy().to_string())
        .args(files.iter().map(|f| root.join(f).to_string_lossy().to_string()))
        .stderr(Stdio::inherit()).output();
    let out = ok!(out, "node runs");
    let v: serde_json::Value = ok!(serde_json::from_slice(&out.stdout), "the yaml package parses every file");
    assert_eq!(v[qpath(ROZ)]["lanes"], "horizontal", "lanes as a plain scalar");
    assert_eq!(v[qpath(P26)]["sort"], serde_json::json!([{ "by": "rating", "order": "desc" }, { "by": "finished", "order": "asc" }]), "sort as a list of mappings");
    assert_eq!(v[qpath(AUTOR_Q)]["lane_order"], serde_json::json!(["[[Tomáš Rybář]]", "[[Eva Lindová]]"]), "lane_order as link strings");
    assert_eq!(v[BOOK]["views"], serde_json::json!(["Výborné knihy", "Rozečtené", "Přečtené 2026", "Čtu, až bude čas"]), "views as a list of strings");
    assert_eq!(v[&kniha]["status"], "Reading", "the card move: a plain Select text");
    assert!(!root.join(".obsidian").exists(), "nothing written inside .obsidian/");
}

// ------------------------------------------------------------------------------------------------ FR-SYN-02 AC-11

const KILL_TEST: &str = "fr_syn_02_ac11_view_writes_are_atomic";
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
    let a = expected("books/kniha-o-horach-reading.md");
    let z = fixture("Books/Kniha o horách.md");
    while start.elapsed() < Duration::from_secs(20) {
        i += 1;
        match kind {
            "lanes" => {
                let r = core.query(ROZ);
                let (Some(mut d), Some(v)) = (r.def, r.version) else { fail("query() has no definition".into()) };
                d.lanes = if i % 2 == 1 { Lanes::Horizontal } else { Lanes::Vertical };
                if let Err(e) = core.query_apply(ROZ, &v, d, NOW) {
                    fail(format!("{e:?}"))
                }
            }
            "views" => {
                let Some(v) = core.type_get("book").and_then(|t| t.version) else { fail("no type version".into()) };
                let names = if i % 2 == 1 { ["Výborné knihy", "Rozečtené", "Přečtené 2026"] } else { ["Rozečtené", "Přečtené 2026", "Výborné knihy"] };
                if let Err(e) = core.type_patch("book", Some(&v), &[TypeOp::SetViews(names.iter().map(|s| s.to_string()).collect())]) {
                    fail(format!("{e:?}"))
                }
            }
            _ => {
                let kniha = b("Kniha o horách");
                let Ok((_, v)) = core.read_note(&kniha, SystemTime::now()) else { fail("read".into()) };
                let t = if i % 2 == 1 { &a } else { &z };
                if let Err(e) = core.write_note(&kniha, t.as_bytes(), Some(&v)) {
                    fail(format!("{e:?}"))
                }
            }
        }
    }
    std::process::exit(0)
}

#[test]
fn fr_syn_02_ac11_view_writes_are_atomic() {
    if let Ok(dir) = std::env::var("TEGG_VIEWS_KILL_CHILD") {
        let dir = PathBuf::from(dir);
        let ready = PathBuf::from(std::env::var("TEGG_VIEWS_KILL_READY").expect("setup: ready path"));
        let kind = std::env::var("TEGG_VIEWS_KILL_KIND").expect("setup: kind");
        kill_child(&dir.join("vault"), &dir.join("app"), &ready, &kind);
    }
    let sb = sandbox();
    let work = sb.base.join("kill");
    let root = work.join("vault");
    copy_dir(&repo_root().join("tests/fixtures/vaults/views"), &root, &["README.md"]);
    copy_dir(&repo_root().join("tests/fixtures/vaults/new-empty/.tegg"), &root.join(".tegg"), &[]);
    std::fs::create_dir_all(work.join("app")).expect("setup: app dir");
    let kniha = b("Kniha o horách");
    let cases: Vec<(&str, String, Vec<String>)> = vec![
        ("lanes", qpath(ROZ), vec![fixture(&qpath(ROZ)), expected("rozectene-lanes-horizontal.yml"), swapped(&fixture(&qpath(ROZ)), "modified: 2026-11-15T21:00:00+01:00", &format!("modified: {NOW}"))]),
        ("views", BOOK.to_string(), vec![fixture(BOOK), expected("types/book-views-dragged.yml")]),
        ("card", kniha.clone(), vec![fixture("Books/Kniha o horách.md"), expected("books/kniha-o-horach-reading.md")]),
    ];
    let exe = std::env::current_exe().expect("setup: test binary");
    let mut seed: u64 = 0x5132_5649_4557_19;
    let mut bad: Vec<String> = Vec::new();
    for (kind, rel, allowed) in &cases {
        let mut wrote = 0usize;
        for cycle in 0..KILL_CYCLES {
            std::fs::write(root.join(rel), &allowed[0]).expect("setup: restore the file");
            let ready = work.join(format!("ready-{kind}-{cycle}"));
            let mut child = Command::new(&exe)
                .args(["--exact", KILL_TEST, "--nocapture", "--test-threads=1"])
                .env("TEGG_VIEWS_KILL_CHILD", &work)
                .env("TEGG_VIEWS_KILL_READY", &ready)
                .env("TEGG_VIEWS_KILL_KIND", kind)
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
            let leftovers: Vec<String> = ["Books", ".tegg/queries", ".tegg/types"].iter()
                .flat_map(|d| std::fs::read_dir(root.join(d)).map(|rd| rd.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect::<Vec<_>>()).unwrap_or_default())
                .filter(|n| n.contains("tegg-tmp"))
                .collect();
            for l in leftovers {
                for d in ["Books", ".tegg/queries", ".tegg/types"] {
                    let _ = std::fs::remove_file(root.join(d).join(&l));
                }
            }
            if bad.len() > 10 {
                break;
            }
        }
        if wrote == 0 {
            bad.push(format!("{kind}: the writer never committed"));
        }
    }
    // A leftover temp file is never listed as a query, type or object.
    write(&root, &format!("{}/.Rozečtené.yml.4242.tegg-tmp", Q), b"version: 1\ntitle: Polovina\n");
    write(&root, "Books/.Kniha.md.4242.tegg-tmp", b"---\ntype: book\ntitle: Polovina\n---\n");
    let core = open(&root, &sb.dirs, false);
    if core.query("Polovina").def.is_some() || run(&core, VYB, &env()).rows.iter().any(|r| r.path.contains("tegg-tmp")) {
        bad.push("a temp file is listed".into());
    }
    assert_eq!(bad, Vec::<String>::new(), "after every kill each file is its complete old or new bytes");
}
