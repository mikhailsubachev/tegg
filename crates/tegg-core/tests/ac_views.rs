//! Slice Q2 L4 tests through the query files and the existing core interface (docs/acceptance/views.md R185, R193;
//! docs/contracts/v1-views.md §1.2, §1.6, §1.9): the multi-level `sort` read from a file and evaluated (FR-QRY-01 AC-8,
//! AC-10), `group_by` broken cases (FR-QRY-05 AC-11), the card-move write through `note_write` and the board's order after
//! it (FR-QRY-05 AC-13), the watcher (FR-QRY-09 AC-6) and NFC names (FR-FMT-12 AC-12). They use `query_run` on saved
//! files, `read_note` / `write_note` and file bytes only, never a `QueryDef` value (its shape changes in the build, §1.1),
//! so they compile before and after the build. The checks that need Q2's new types (`QueryResult.group`, lanes,
//! `TypeOp::SetViews`, `query_view_usages`, `query_apply` with Q2 keys) are red-test point RT-1. The test clock is
//! `2026-11-19T10:00:00+01:00`, Europe/Prague, region `cs` (injected). Written from the ACs, the fixtures and the contract
//! only (D-61); every check is an assertion in this file.

mod common;
mod views_setup;

use std::time::{Duration, SystemTime};

use common::{sandbox, snapshot, wait_until};
use tegg_core::{CoreError, VaultError};
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

/// R193: Přečtené 2026 in `cs` and in `en-US`.
const P26_CS: [&str; 8] = ["Mapa bez severu", "Sto zimních dní", "Cizí přístavy", "Čarovná mapa", "Šest cest k moři", "Kniha o čaji", "Tiché město", "Zahrada v dešti"];
const P26_US: [&str; 8] = ["Mapa bez severu", "Sto zimních dní", "Čarovná mapa", "Cizí přístavy", "Šest cest k moři", "Kniha o čaji", "Tiché město", "Zahrada v dešti"];
/// Rozečtené's rows: status ascending (option order), then modified descending (R185 two levels).
const ROZ_ROWS: [&str; 5] = ["Dům u řeky", "Kniha o horách", "Noční vlak", "Účetní ze Žižkova", "Světla přístavu"];
/// A runtime Book query of the read books of 2026 with `sort` as written.
fn read_2026(title: &str, sort: &str) -> String {
    format!(
        "# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › {title}.\nversion: 1\ntitle: {title}\ntypes: [book]\nmatch: all\nfilters:\n  - status: Read\n  - finished: {{ between: [2026-01-01, 2026-12-31] }}\nsort:{sort}\nlimit: 50\nview: table\ncolumns: [finished]\ncreated: 2026-11-01T09:00:00+01:00\nmodified: 2026-11-01T09:00:00+01:00\n"
    )
}

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-8

#[test]
fn fr_qry_01_ac8_multi_level_order() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let r = run(&core, P26, &env());
    assert!(!broken_keys(&r).iter().any(|k| k == "sort"), "Přečtené 2026's three-level `sort` list is valid (D-1768): broken {:?}", broken_keys(&r));
    assert_eq!(paths(&r), bs(&P26_CS), "cs: the 2026-08-02 tie by rating then title (C before Č), the 06-19 tie by rating option order (R193)");
    assert_eq!(paths(&run(&core, P26, &env_us())), bs(&P26_US), "(C) en-US: Čarovná mapa before Cizí přístavy");
    assert_eq!(paths(&run(&core, VYB, &env())), bs(&["Cizí přístavy", "Čarovná mapa", "Mapa bez severu"]), "Výborné knihy (the single mapping)");
    // A missing `order` on the second item reads as `asc`.
    write(&root, &qpath("Bez pořadí"), read_2026("Bez pořadí", "\n  - { by: finished, order: desc }\n  - { by: title }").as_bytes());
    // An item that isn't a mapping makes the whole `sort` broken: default Modified ↓, the file not rewritten.
    let scalar = read_2026("Skalár", "\n  - { by: finished, order: desc }\n  - title");
    write(&root, &qpath("Skalár"), scalar.as_bytes());
    reread(&core, &[&qpath("Bez pořadí"), &qpath("Skalár")]);
    let m = run(&core, "Bez pořadí", &env());
    assert!(!broken_keys(&m).iter().any(|k| k == "sort"), "a missing `order` is `asc`, not broken: {:?}", broken_keys(&m));
    assert_eq!(
        paths(&m),
        bs(&["Mapa bez severu", "Sto zimních dní", "Cizí přístavy", "Čarovná mapa", "Kniha o čaji", "Šest cest k moři", "Tiché město", "Zahrada v dešti"]),
        "finished ↓, then title ↑ (cs)"
    );
    let s = run(&core, "Skalár", &env());
    assert!(broken_keys(&s).iter().any(|k| k == "sort"), "a scalar item: `sort` broken");
    assert_eq!(
        paths(&s),
        bs(&["Mapa bez severu", "Sto zimních dní", "Čarovná mapa", "Cizí přístavy", "Šest cest k moři", "Kniha o čaji", "Tiché město", "Zahrada v dešti"]),
        "the default Modified ↓"
    );
    assert_eq!(disk_s(&root, &qpath("Skalár")), Some(scalar), "the file isn't rewritten");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-10

#[test]
fn fr_qry_01_ac10_sort_file_shapes() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let before = snapshot(&root);
    let mut broken = Vec::new();
    for n in [ROZ, P26, VYB, ZANR, AUTOR_Q, DATUM, "Autoři", "Knihy a autoři", "Knihy odkazované odsud"] {
        let r = run(&core, n, &env());
        if broken_keys(&r).iter().any(|k| k == "sort") {
            broken.push(n);
        }
    }
    assert_eq!(broken, Vec::<&str>::new(), "every fixture query's `sort` reads (lists and single mappings, D-1768)");
    assert_eq!(snapshot(&root), before, "opening and running every fixture query writes nothing");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-11

#[test]
fn fr_qry_05_ac11_group_by_kinds() {
    let sb = sandbox();
    let root = vault(&sb);
    let autor_text = "# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › Podle poznámky.\nversion: 1\ntitle: Podle poznámky\ntypes: [autor]\nmatch: all\nfilters: []\nsort: { by: title, order: asc }\nlimit: 50\nview: board\ngroup_by: poznámka\ncolumns: [poznámka]\ncreated: 2026-11-01T09:00:00+01:00\nmodified: 2026-11-01T09:00:00+01:00\n";
    write(&root, &qpath("Podle poznámky"), autor_text.as_bytes());
    write(&root, &qpath("Neznámý klíč"), swapped(&fixture(&qpath(DATUM)), "group_by: finished\n", "group_by: neznámý\n").as_bytes());
    write(&root, &qpath("Tabulka se skupinou"), swapped(&fixture(&qpath(VYB)), "view: table\n", "view: table\ngroup_by: status\n").as_bytes());
    let core = open(&root, &sb.dirs, false);
    let before = snapshot(&root);
    let d = run(&core, DATUM, &env());
    assert!(broken_keys(&d).iter().any(|k| k == "group_by"), "group_by: finished (a date) is a broken part (D-1770): {:?}", broken_keys(&d));
    assert_eq!(
        paths(&d),
        bs(&["Cizí přístavy", "Čarovná mapa", "Čtvrtá zima", "Dům u řeky", "Kniha o čaji", "Kniha o horách", "Mapa bez severu", "Noční vlak", "Ostrov bez jména",
            "Písně z dálky", "Sto zimních dní", "Světla přístavu", "Šest cest k moři", "Tiché město", "Účetní ze Žižkova", "Zahrada v dešti", "Zápisník z Tater"]),
        "the 17 books by title (R193)"
    );
    assert!(broken_keys(&run(&core, "Podle poznámky", &env())).iter().any(|k| k == "group_by"), "group_by: poznámka (Text on Autor): broken");
    assert!(broken_keys(&run(&core, "Neznámý klíč", &env())).iter().any(|k| k == "group_by"), "group_by: neznámý: broken");
    let t = run(&core, "Tabulka se skupinou", &env());
    assert!(!broken_keys(&t).iter().any(|k| k == "group_by"), "group_by with view: table: kept and ignored, no notice");
    for n in [ZANR, AUTOR_Q, ROZ] {
        assert!(!broken_keys(&run(&core, n, &env())).iter().any(|k| k == "group_by" || k == "view" || k == "lanes" || k == "lane_order"), "{n}: its Q2 keys are valid");
    }
    assert_eq!(snapshot(&root), before, "no file is written");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-13

#[test]
fn fr_qry_05_ac13_card_drag_writes_once() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    assert_eq!(paths(&run(&core, ROZ, &env())), bs(&ROZ_ROWS), "Rozečtené's rows: status ↑ (option order), then modified ↓");
    let kniha = b("Kniha o horách");
    let before = snapshot(&root);
    let old = some_stamp(&root, &kniha);
    // The card move's bytes (@tegg/doc, D-82) go through the one write function with the version last read as base.
    let (_, base) = ok!(core.read_note(&kniha, SystemTime::now()), "read_note");
    ok!(core.write_note(&kniha, expected("books/kniha-o-horach-reading.md").as_bytes(), Some(&base)), "write_note with the read version");
    let _ = core.wait_idle(Duration::from_secs(30));
    let new = some_stamp(&root, &kniha);
    assert_eq!(String::from_utf8_lossy(&new.0), expected("books/kniha-o-horach-reading.md"), "the bytes");
    assert_ne!(new.2, old.2, "a temporary file renamed in Books/ (new inode, FR-SYN-02)");
    let changed: Vec<String> = snapshot(&root).into_iter().filter(|(k, v)| before.get(k) != Some(v)).map(|(k, _)| tegg_format::nfc(&k)).collect();
    assert_eq!(changed, vec![kniha.clone()], "every other vault file untouched");
    assert_eq!(
        paths(&run(&core, ROZ, &env())),
        bs(&["Dům u řeky", "Kniha o horách", "Noční vlak", "Účetní ze Žižkova", "Světla přístavu"]),
        "Kniha o horách is first among the Reading rows (status, then modified ↓)"
    );
    // A stale base is refused (FR-SYN-03 AC-30, the card part).
    let r = core.write_note(&kniha, fixture("Books/Kniha o horách.md").as_bytes(), Some(&base));
    assert!(matches!(r, Err(CoreError::Vault(VaultError::Conflict { .. }))), "a write with the old version gets Conflict: {r:?}");
}
fn some_stamp(root: &std::path::Path, rel: &str) -> (Vec<u8>, i128, u64) {
    match stamp(root, rel) {
        Some(s) => s,
        None => {
            assert!(false, "{rel} exists");
            unreachable!()
        }
    }
}

// ------------------------------------------------------------------------------------------------ FR-QRY-09 AC-6

#[test]
fn fr_qry_09_ac6_cards_follow_edits() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, true);
    assert_eq!(paths(&run(&core, ROZ, &env())), bs(&ROZ_ROWS), "precondition: Rozečtené's rows in its two-level order");
    write(&root, &b("Noční vlak"), swapped(&fixture("Books/Noční vlak.md"), "status: Reading\n", "status: Read\n").as_bytes());
    write(&root, "Books/Nová kniha.md", "---\nid: 01JB5V00000000000000000099\ntype: book\ntitle: Nová kniha\nstatus: To read\ncreated: 2026-11-19T09:00:00+01:00\nmodified: 2026-11-19T09:00:00+01:00\n---\nNová.\n".as_bytes());
    std::fs::remove_file(root.join(b("Kniha o horách"))).expect("setup: delete");
    let want = bs(&["Nová kniha", "Dům u řeky", "Účetní ze Žižkova", "Světla přístavu"]);
    let seen = wait_until(Duration::from_secs(2), || paths(&run(&core, ROZ, &env())) == want);
    assert!(seen.is_some(), "within 2 s: {:?}", paths(&run(&core, ROZ, &env())));
}

// ------------------------------------------------------------------------------------------------ FR-FMT-12 AC-12

#[test]
fn fr_fmt_12_ac12_view_names_and_lanes_are_nfc() {
    let sb = sandbox();
    let root = vault(&sb);
    // An NFD file name `Rozečtené.yml`.
    let text = fixture(&qpath(ROZ));
    std::fs::remove_file(root.join(qpath(ROZ))).expect("setup: remove");
    write(&root, &nfd(&qpath(ROZ)), text.as_bytes());
    // D-1823: a runtime option `Čtu` (after Read) and a book with an NFD `status: Čtu`; a board by status, no filters.
    write(&root, BOOK, swapped(&fixture(BOOK), "      - { label: Read, color: green }\n", "      - { label: Read, color: green }\n      - { label: Čtu, color: teal }\n").as_bytes());
    write(&root, "Books/Nová NFD.md", format!("---\ntype: book\ntitle: Nová NFD\nstatus: {}\ncreated: 2026-11-19T09:00:00+01:00\nmodified: 2026-11-19T09:00:00+01:00\n---\nText.\n", nfd("Čtu")).as_bytes());
    let stav = "# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › Podle stavu.\nversion: 1\ntitle: Podle stavu\ntypes: [book]\nmatch: all\nfilters: []\nsort:\n  - { by: status, order: asc }\n  - { by: title, order: asc }\nlimit: 50\nview: board\ngroup_by: status\nlanes: vertical\ncolumns: [author]\ncreated: 2026-11-01T09:00:00+01:00\nmodified: 2026-11-01T09:00:00+01:00\n";
    write(&root, &qpath("Podle stavu"), stav.as_bytes());
    let core = open(&root, &sb.dirs, false);
    assert_eq!(paths(&run(&core, ROZ, &env())), bs(&ROZ_ROWS), "the NFD file name resolves as Rozečtené (and its two-level order)");
    let r = run(&core, "Podle stavu", &env());
    let mut want = bs(&["Dům u řeky", "Kniha o horách", "Ostrov bez jména", "Noční vlak", "Světla přístavu", "Účetní ze Žižkova"]);
    want.extend(bs(&["Cizí přístavy", "Čarovná mapa", "Čtvrtá zima", "Kniha o čaji", "Mapa bez severu", "Sto zimních dní", "Šest cest k moři", "Tiché město", "Zahrada v dešti"]));
    want.push("Books/Nová NFD.md".to_string());
    want.extend(bs(&["Zápisník z Tater", "Písně z dálky"]));
    assert_eq!(paths(&r), want, "status ↑: To read, Reading, Read, then the NFD `Čtu` as the option Čtu (not an unknown value), then Rozečteno, then empty");
}
