//! MS4 slice 4D-lite AC tests at the core (L4): tags in the index on a temporary copy of the tags fixture on APFS
//! (docs/acceptance/tags.md R79, R80). FR-TAG-01 AC-1, AC-3 (no write), AC-4 (index part); FR-TAG-02 AC-1…AC-4;
//! FR-TAG-03 AC-1 (write), AC-2, AC-4…AC-6; FR-TAG-05 AC-1…AC-5 (the core side of the colour writes); FR-TAG-06 AC-2
//! (query), AC-9; FR-TAG-07 AC-4 (ordering), AC-5; FR-TAG-08 AC-3 (the trash move); FR-TAG-10 AC-1; FR-SRC-02 AC-11;
//! FR-EDT-15 AC-6; FR-FMT-07 AC-23; FR-SYN-06 AC-32 (core actions). Interface: docs/contracts/ms4-tags.md §1
//! (`Core::tag_rows`, `tag_objects`, `tag_usage`), ms3-shell §13 (`write_note`, `create_exact`), ms6-trash-media §1.4.
//! The UI's bytes (R86 Tag files, a colour change) are written here as `@tegg/doc` would write them (the L1 tests in
//! packages/doc/test/tags.ac.test.ts check those bytes). Written from the ACs and the contract only (D-61).

mod common;
mod tags4d_setup;

use std::collections::BTreeSet;
use std::time::{Duration, SystemTime};

use common::{fresh_dirs, sandbox, snapshot, wait_until, CountingFs};
use tags4d_setup::*;
use tegg_core::{Core, CoreOptions, SearchQuery, TagRow};
use tegg_vault::LocalFs;

fn tz() -> chrono_tz::Tz {
    chrono_tz::Europe::Prague
}
fn search_tags(core: &Core, text: &str, tags: &[&str]) -> Vec<String> {
    let q = SearchQuery { tags: tags.iter().map(|t| t.to_string()).collect(), ..SearchQuery::text(text, tz()) };
    let mut v: Vec<String> = match core.search(&q) {
        Ok(p) => p.results.into_iter().map(|r| tegg_format::nfc(&r.path)).collect(),
        Err(e) => {
            assert!(false, "search failed: {e:?}");
            unreachable!()
        }
    };
    v.sort();
    v
}
fn sorted(v: &[&str]) -> Vec<String> {
    let mut v: Vec<String> = v.iter().map(|s| s.to_string()).collect();
    v.sort();
    v
}
fn obj_paths(core: &Core, key: &str) -> Vec<String> {
    core.tag_objects(key).into_iter().map(|r| r.path).collect()
}
/// R86 bytes, as `@tegg/doc` `tagFile` writes them.
fn tag_file(title: &str, color: Option<&str>) -> String {
    let c = color.map(|c| format!("color: {c}\n")).unwrap_or_default();
    format!("---\nid: 01JB4DNEW00000000000000001\ntype: tag\ntitle: {title}\n{c}created: {NOW}\nmodified: {NOW}\n---\n")
}
fn last_used_order(rows: &[TagRow]) -> Vec<(String, usize)> {
    let mut v: Vec<&TagRow> = rows.iter().filter(|r| r.count >= 1).collect();
    v.sort_by(|a, b| b.last_used_ns.cmp(&a.last_used_ns).then_with(|| a.name.cmp(&b.name)));
    v.into_iter().take(5).map(|r| (r.name.clone(), r.count)).collect()
}

// ------------------------------------------------------------------------------------------------ FR-TAG-01

#[test]
fn fr_tag_01_ac1_fixture_tags_are_r80() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let rows = core.tag_rows();
    assert_eq!(summary(&rows), r80(), "exactly R80's ten rows (key, display name, Tag file, colour, count, Last used)");
    for k in ["starý", "a", "b", "a b", "účty#", "účty$"] {
        assert!(row(&rows, k).is_none(), "{k}: no tag (trash, code, math, links, URLs; D-64)");
    }
    let ucty = row(&rows, "účty");
    assert_eq!(ucty.map(|r| r.losers.clone()), Some(vec![]), "účty: one Tag file");
    assert_eq!(row(&rows, "neznámá").and_then(|r| r.color_raw.clone()), Some("magenta".into()), "the raw colour is kept for the popover (D-723)");
    let ns = ucty.and_then(|r| r.last_used_ns);
    let want = chrono::DateTime::parse_from_rfc3339(&at("2026-10-22T08:00")).map(|d| d.timestamp_nanos_opt().unwrap_or(0) as i128).ok();
    assert_eq!(ns, want, "last_used_ns is the instant of last_used");
}

#[test]
fn fr_tag_01_ac1_counts_are_per_object_and_spellings_are_one_key() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    assert_eq!(
        obj_paths(&core, "účty"),
        vec![DEN.to_string(), DVAKRAT.into(), ROZPOCET.into(), FAKTURA.into(), NAJEM.into(), BANKA.into()],
        "the six objects in path order: Dvakrát once, Nájem (Done) counts, Faktura's NFD tag and Den's ÚČTY are účty; no template, no trash"
    );
    assert_eq!(obj_paths(&core, "ÚČTY"), obj_paths(&core, "účty"), "the key folds case");
    assert_eq!(obj_paths(&core, &"účty".chars().flat_map(|c| match c { 'ú' => vec!['u', '\u{301}'], 'č' => vec!['c', '\u{30C}'], c => vec![c] }).collect::<String>()), obj_paths(&core, "účty"), "and NFC");
    let u = core.tag_usage("účty");
    assert_eq!((u.notes, u.templates, u.file.clone()), (6, 1, Some(F_UCTY.to_string())), "tag_usage: 6 notes, 1 template (D-714), the Tag file");
}

#[test]
fn fr_tag_01_ac3_extra_tag_attribute_writes_nothing() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let tag_yml = read(&root, ".tegg/types/tag.yml").unwrap_or_default();
    write(&root, ".tegg/types/tag.yml", &format!("{tag_yml}  - key: x-poznámka\n    name: Poznámka\n    type: text\n"));
    write(&root, F_AB, &swap(&fixture(F_AB), "title: a/b\n", "title: a/b\nx-poznámka: a\n"));
    let before = snapshot(&root);
    let core = open(&root, &sb.dirs, false);
    let _ = (core.tag_rows(), core.tag_objects("a/b"), core.tag_usage("a/b"), core.type_get("tag"), core.list_type("tag"));
    drop(core);
    assert_eq!(snapshot(&root), before, "indexing and reading the Tag type write nothing; tag.yml byte-identical");
    let core = open(&root, &fresh_dirs(&sb, "Again"), false);
    assert_eq!(row(&core.tag_rows(), "a/b").and_then(|r| r.file.as_ref().map(|f| f.path.clone())), Some(F_AB.to_string()), "F-ab is still a/b's Tag file");
}

#[test]
fn fr_tag_01_ac4_indexing_never_rewrites_tag_files() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let before = snapshot(&root);
    let core = open(&root, &sb.dirs, true);
    let rows = core.tag_rows();
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(snapshot(&root), before, "indexing writes nothing (FR-FMT-07)");
    assert_eq!(row(&rows, "neznámá").map(|r| (r.color.clone(), r.color_raw.clone())), Some((None, Some("magenta".into()))), "magenta is read, shown neutral, never rewritten");
}

// ------------------------------------------------------------------------------------------------ FR-TAG-02

#[test]
fn fr_tag_02_ac1_which_file_belongs_to_which_tag() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = open(&root, &sb.dirs, true);
    let rows = core.tag_rows();
    let file = |rows: &[TagRow], k: &str| row(rows, k).and_then(|r| r.file.as_ref().map(|f| f.path.clone()));
    assert_eq!(file(&rows, "účty"), Some(F_UCTY.into()), "title key");
    assert_eq!(file(&rows, "a/b"), Some(F_AB.into()), "F-ab belongs to a/b");
    assert!(row(&rows, "a b").is_none(), "not to `a b`");
    assert_eq!(file(&rows, "prázdný"), Some(F_PRAZDNY.into()), "no title: the stem (D-694)");
    let d = row(&rows, "dvojí");
    assert_eq!(d.map(|r| (r.file.as_ref().map(|f| f.path.clone()), r.color.clone(), r.losers.clone())), Some((Some(F_DVOJI.into()), Some("red".into()), vec![F_DVOJI2.into()])), "the older created wins: red");
    assert!(rows.iter().all(|r| r.file.as_ref().map(|f| f.path.as_str()) != Some(F_KOS)), "F-koš in .trash/ is no Tag file (D-102)");
    let dup = core.duplicate_titles();
    let g = dup.iter().find(|g| g.objects.iter().any(|o| o.path == F_DVOJI));
    assert_eq!(g.map(|g| g.objects.iter().map(|o| o.path.clone()).collect::<BTreeSet<_>>()), Some([F_DVOJI.to_string(), F_DVOJI2.to_string()].into()), "both on Duplicate titles");
    // A runtime change of F-Dvojí2's created makes it the winner within 2 s.
    write(&root, F_DVOJI2, &swap(&fixture(F_DVOJI2), "created: 2026-06-01", "created: 2026-04-01"));
    let green = wait_until(Duration::from_secs(2), || row(&core.tag_rows(), "dvojí").and_then(|r| r.color.clone()) == Some("green".into()));
    assert!(green.is_some(), "an older created on F-Dvojí2: green within 2 s");
    // Both created removed: path order (NFC bytes, `D` < `d`).
    write(&root, F_DVOJI2, &fixture(F_DVOJI2).replace("created: 2026-06-01T09:00:00+02:00\n", ""));
    write(&root, F_DVOJI, &fixture(F_DVOJI).replace("created: 2026-05-01T09:00:00+02:00\n", ""));
    let by_path = wait_until(Duration::from_secs(2), || file(&core.tag_rows(), "dvojí") == Some(F_DVOJI2.into()));
    assert!(by_path.is_some(), "without created, Tags/Dvojí (2).md sorts first and wins (green)");
}

#[test]
fn fr_tag_02_ac2_index_rebuild_gives_the_same_tags() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let rows = format!("{:?}", core.tag_rows());
    let objs = format!("{:?}", core.tag_objects("účty"));
    let five = last_used_order(&core.tag_rows());
    assert_eq!(core.tag_rows().len(), 10, "the tag query answers (R80)");
    drop(core);
    let core = open(&root, &fresh_dirs(&sb, "Rebuilt"), false);
    assert_eq!(format!("{:?}", core.tag_rows()), rows, "rows, files, colours, counts and Last used identical after a rebuild (AR-01)");
    assert_eq!(format!("{:?}", core.tag_objects("účty")), objs, "tag page rows identical");
    assert_eq!(last_used_order(&core.tag_rows()), five, "the sidebar's five identical");
}

#[test]
fn fr_tag_02_ac3_follows_the_files_live() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = open(&root, &sb.dirs, true);
    let before_writes = snapshot(&root);
    let fin = |c: &Core| row(&c.tag_rows(), "finance").map(|r| (r.count, r.last_used.clone(), r.name.clone(), r.color.clone(), r.file.as_ref().map(|f| f.path.clone())));
    // Výplň 01 gains finance: 3, Last used unchanged (its modified is older).
    write(&root, &vypln(1), &swap(&fixture(&vypln(1)), "title: Výplň 01\n", "title: Výplň 01\ntags: [finance]\n"));
    assert!(wait_until(Duration::from_secs(2), || fin(&core).map(|f| f.0) == Some(3)).is_some(), "finance → 3 within 2 s");
    assert_eq!(fin(&core).map(|f| f.1), Some(Some(at("2026-10-21T09:00"))), "Last used unchanged");
    // F-ab deleted: a/b stays, virtual, None.
    std::fs::remove_file(root.join(F_AB)).expect("setup: delete F-ab");
    assert!(wait_until(Duration::from_secs(2), || row(&core.tag_rows(), "a/b").map(|r| r.file.is_none() && r.count == 1) == Some(true)).is_some(), "a/b stays, virtual");
    // Tags/finance.md appears: finance gets the file, display name Finance, orange.
    write(&root, "Tags/finance.md", "---\ntype: tag\ntitle: Finance\ncolor: orange\n---\n");
    assert!(
        wait_until(Duration::from_secs(2), || fin(&core).map(|f| (f.2, f.3, f.4)) == Some(("Finance".into(), Some("orange".into()), Some("Tags/finance.md".into())))).is_some(),
        "finance: Tag file, display name Finance, orange"
    );
    // F-účty's title becomes Výdaje: výdaje (count 0) owns it; účty is virtual with its most frequent spelling.
    write(&root, F_UCTY, &swap(&fixture(F_UCTY), "title: Účty", "title: Výdaje"));
    assert!(
        wait_until(Duration::from_secs(2), || {
            let rows = core.tag_rows();
            row(&rows, "výdaje").map(|r| (r.count, r.file.is_some())) == Some((0, true)) && row(&rows, "účty").map(|r| (r.name.clone(), r.file.is_none())) == Some(("účty".into(), true))
        })
        .is_some(),
        "F-účty now belongs to výdaje (count 0); účty is virtual, display name účty"
    );
    // #účty written into Kód's code span only: no change.
    let ucty_before = row(&core.tag_rows(), "účty").map(|r| r.count);
    write(&root, KOD, &swap(&fixture(KOD), "Kód `#účty` v textu.", "Kód `#účty #účty` v textu."));
    std::thread::sleep(Duration::from_millis(800));
    assert_eq!(row(&core.tag_rows(), "účty").map(|r| r.count), ucty_before, "a code span is no occurrence");
    let mine: Vec<String> = common::snapshot(&root).into_iter().filter(|(k, e)| before_writes.get(k).is_some_and(|b| b != e)).map(|(k, _)| k).collect();
    let mut mine = mine;
    mine.sort();
    let mut theirs = vec![vypln(1), F_UCTY.to_string(), KOD.to_string()];
    theirs.sort();
    assert_eq!(mine, theirs, "Tegg writes nothing: only the external edits changed");
}

#[test]
fn fr_tag_02_ac4_applying_a_tag_writes_tags_and_no_tag_file() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let (_, base) = core.read_note(&vypln(2), SystemTime::now()).expect("setup: read Výplň 02");
    let text = swap(&fixture(&vypln(2)), "title: Výplň 02\n", "title: Výplň 02\ntags: [finance]\n");
    assert!(core.write_note(&vypln(2), text.as_bytes(), Some(&base)).is_ok(), "the attribute panel's write");
    assert!(obj_paths(&core, "finance").contains(&vypln(2)), "tag/finance lists Výplň 02");
    assert!(!root.join("Tags/finance.md").exists(), "no Tag file is created");
}

// ------------------------------------------------------------------------------------------------ FR-TAG-03

#[test]
fn fr_tag_03_ac1_new_tag_is_one_create_exclusive_file() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let before = snapshot(&root);
    let bytes = tag_file("Účetnictví", None);
    assert!(core.create_exact("Tags/Účetnictví.md", bytes.as_bytes()).is_ok(), "create_exact Tags/Účetnictví.md");
    let after = snapshot(&root);
    let changed: Vec<&String> = after.keys().filter(|k| before.get(*k) != after.get(*k)).collect();
    assert_eq!(changed, vec![&"Tags/Účetnictví.md".to_string()], "exactly one file written");
    assert!(core.create_exact("Tags/Účetnictví.md", bytes.as_bytes()).is_err(), "a second create is refused (create-exclusive, FR-SYN-02)");
    let r = row(&core.tag_rows(), "účetnictví").map(|r| (r.name.clone(), r.count, r.file.as_ref().map(|f| f.path.clone())));
    assert_eq!(r, Some(("Účetnictví".into(), 0, Some("Tags/Účetnictví.md".into()))), "the new tag: display name Účetnictví, count 0, its file");
    assert_eq!(core.tag_objects("účetnictví"), vec![], "0 objects");
}

#[test]
fn fr_tag_03_ac2_existing_keys_are_found_by_every_spelling() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let before = snapshot(&root);
    let core = open(&root, &sb.dirs, false);
    let rows = core.tag_rows();
    for (typed, key) in [("účty", "účty"), ("ÚČTY", "účty"), ("#Účty", "účty"), ("u\u{301}c\u{30C}ty", "účty"), ("finance", "finance"), ("PRÁZDNÝ", "prázdný")] {
        let k = tegg_format::tag_name(typed).map(|n| n.key);
        assert_eq!(k.as_deref(), Ok(key), "{typed:?} → key {key}");
        assert!(row(&rows, key).is_some(), "{typed:?}: an existing tag opens tag/{key}");
    }
    drop(core);
    assert_eq!(snapshot(&root), before, "nothing written");
}

#[test]
fn fr_tag_03_ac4_free_stems_vault_wide() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let stem = core.free_stem("Tags", &tegg_format::sanitize_file_stem("Rozpočet"));
    assert_eq!(stem, "Rozpočet (2)", "Pages/Rozpočet.md takes the stem vault-wide");
    assert!(core.create_exact(&format!("Tags/{stem}.md"), tag_file("Rozpočet", None).as_bytes()).is_ok(), "write Tags/Rozpočet (2).md");
    assert_eq!(core.resolve_link("Rozpočet").as_deref(), Some(ROZPOCET), "[[Rozpočet]] still resolves to the page");
    assert_eq!(row(&core.tag_rows(), "rozpočet").and_then(|r| r.file.as_ref().map(|f| f.path.clone())), Some("Tags/Rozpočet (2).md".into()), "the tag rozpočet has its Tag file");
    let ab = core.free_stem("Tags", &tegg_format::sanitize_file_stem("a//b"));
    assert_eq!(ab, "a b (2)", "a//b: stem `a b` is taken by F-ab");
    let long: String = "č".repeat(130);
    let s = core.free_stem("Tags", &tegg_format::sanitize_file_stem(&long));
    assert!(s.len() <= 200 && s.chars().all(|c| c == 'č'), "≤ 200 UTF-8 bytes, cut at a character boundary: {} bytes", s.len());
    write(&root, "Tags/Účetnictví.md", "---\ntype: tag\ntitle: Účetnictví\n---\n");
    assert!(core.create_exact("Tags/Účetnictví.md", tag_file("Účetnictví", None).as_bytes()).is_err(), "a file that appeared meanwhile is never overwritten");
}

#[test]
fn fr_tag_03_ac5_count_zero_tags_are_tags() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    assert!(core.create_exact("Tags/Účetnictví.md", tag_file("Účetnictví", None).as_bytes()).is_ok(), "New tag");
    let rows = core.tag_rows();
    assert_eq!(rows.len(), 11, "11 tags");
    assert_eq!(row(&rows, "účetnictví").map(|r| (r.count, r.last_used.clone())), Some((0, None)), "count 0, empty Last used");
    assert!(core.tags().iter().any(|t| t.key == "účetnictví" && t.spelling == "Účetnictví" && t.count == 0), "autocomplete (Core::tags) offers it (FR-EDT-15 AC-6)");
    let task = "---\nid: 01JB4DNEW00000000000000002\ntype: task\ntitle: Zaplatit\nstatus: To do\ntags: [Účetnictví]\ncreated: 2026-10-22T10:00:00+02:00\nmodified: 2026-10-22T10:00:00+02:00\n---\n";
    assert!(core.create_note("Tasks", "Zaplatit", task.as_bytes()).is_ok(), "the quick-add task");
    assert_eq!(row(&core.tag_rows(), "účetnictví").map(|r| r.count), Some(1), "count 1");
}

#[test]
fn fr_tag_03_ac6_no_other_path_writes_a_tag_file() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let before = tag_files_on_disk(&root);
    let note = "---\nid: 01JB4DNEW00000000000000003\ntype: page\ntitle: Nová\ntags: [nový-štítek]\ncreated: 2026-10-22T10:00:00+02:00\nmodified: 2026-10-22T10:00:00+02:00\n---\nText #nový\n";
    assert!(core.create_note("Pages", "Nová", note.as_bytes()).is_ok(), "an editor / quick-add create with new tags");
    let cap = "---\nid: 01JB4DNEW00000000000000004\ntype: quick-note\ntitle: Zachyceno\ntags: [zachycený]\nreview: unreviewed\ncreated: 2026-10-22T10:00:00+02:00\nmodified: 2026-10-22T10:00:00+02:00\n---\n";
    let _ = core.capture_create("quick-note", "Zachyceno", cap.as_bytes());
    assert_eq!(tag_files_on_disk(&root), before, "no Tags/*.md written (FR-TAG-03 note)");
    let rows = core.tag_rows();
    for k in ["nový-štítek", "nový"] {
        assert_eq!(row(&rows, k).map(|r| (r.count, r.file.is_none())), Some((1, true)), "{k}: a virtual tag");
    }
}

// ------------------------------------------------------------------------------------------------ FR-TAG-05

fn ucty_base(core: &Core) -> Option<tegg_core::FileVersion> {
    row(&core.tag_rows(), "účty").and_then(|r| r.file.as_ref().map(|f| f.version.clone()))
}

#[test]
fn fr_tag_05_ac1_colour_write_with_the_rows_version_as_base() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let base = ucty_base(&core);
    assert!(base.is_some(), "TagRow.file.version is the base of the colour write");
    let before = snapshot(&root);
    let green = swap(&swap(&fixture(F_UCTY), "color: blue", "color: green"), "modified: 2026-09-01T09:00:00+02:00", &format!("modified: {NOW}"));
    assert!(core.write_note(F_UCTY, green.as_bytes(), base.as_ref()).is_ok(), "one write");
    let after = snapshot(&root);
    assert_eq!(after.keys().filter(|k| before.get(*k) != after.get(*k)).cloned().collect::<Vec<_>>(), vec![F_UCTY.to_string()], "only F-účty");
    assert_eq!(row(&core.tag_rows(), "účty").and_then(|r| r.color.clone()), Some("green".into()), "účty is green");
}

#[test]
fn fr_tag_05_ac2_none_keeps_the_file() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let none = swap(&fixture(F_UCTY).replace("color: blue\n", ""), "modified: 2026-09-01T09:00:00+02:00", &format!("modified: {NOW}"));
    let base = ucty_base(&core);
    assert!(base.is_some(), "the Tag file's version");
    assert!(core.write_note(F_UCTY, none.as_bytes(), base.as_ref()).is_ok(), "write");
    let rows = core.tag_rows();
    let r = row(&rows, "účty");
    assert_eq!(r.map(|r| (r.color.clone(), r.file.as_ref().map(|f| f.path.clone()), r.name.clone())), Some((None, Some(F_UCTY.into()), "Účty".into())), "neutral, the file stays");
}

#[test]
fn fr_tag_05_ac3_colour_for_a_virtual_tag_creates_its_file() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let name = row(&core.tag_rows(), "finance").map(|r| r.name.clone());
    assert_eq!(name.as_deref(), Some("finance"), "the display name's spelling is the title");
    let before = snapshot(&root);
    assert!(core.create_exact("Tags/finance.md", tag_file("finance", Some("orange")).as_bytes()).is_ok(), "create");
    let after = snapshot(&root);
    assert_eq!(after.keys().filter(|k| before.get(*k) != after.get(*k)).cloned().collect::<Vec<_>>(), vec!["Tags/finance.md".to_string()], "exactly one file, no object file");
    let rows = core.tag_rows();
    let r = row(&rows, "finance");
    assert_eq!(r.map(|r| (r.count, r.color.clone(), r.file.is_some())), Some((2, Some("orange".into()), true)), "not virtual any more, count 2, orange");
}

#[test]
fn fr_tag_05_ac4_unknown_values_are_neutral_and_purple_replaces_them() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let r = row(&core.tag_rows(), "neznámá").map(|r| (r.color.clone(), r.color_raw.clone(), r.file.as_ref().map(|f| f.version.clone())));
    let Some((color, raw, Some(base))) = r else {
        assert!(false, "neznámá with its Tag file: {r:?}");
        return;
    };
    assert_eq!((color, raw), (None, Some("magenta".to_string())), "neutral, raw magenta");
    let purple = swap(&swap(&fixture(F_NEZNAMA), "color: magenta", "color: purple"), "modified: 2026-09-01T09:00:00+02:00", &format!("modified: {NOW}"));
    assert!(core.write_note(F_NEZNAMA, purple.as_bytes(), Some(&base)).is_ok(), "one write");
    assert_eq!(row(&core.tag_rows(), "neznámá").and_then(|r| r.color.clone()), Some("purple".into()), "purple");
    assert!(read(&root, F_NEZNAMA).unwrap_or_default().contains("description: Stará poznámka.\nx-extra: 1\n"), "description and x-extra kept (FR-TAG-01 AC-4)");
}

#[test]
fn fr_tag_05_ac5_external_change_wins() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let base = ucty_base(&core);
    assert!(base.is_some(), "the version the UI read");
    let theirs = swap(&fixture(F_UCTY), "color: blue", "color: red");
    write(&root, F_UCTY, &theirs);
    let green = swap(&fixture(F_UCTY), "color: blue", "color: green");
    assert!(core.write_note(F_UCTY, green.as_bytes(), base.as_ref()).is_err(), "Conflict: the colour write is refused");
    assert_eq!(read(&root, F_UCTY), Some(theirs), "the external version stays (NFR-REL-02)");
}

// ------------------------------------------------------------------------------------------------ FR-TAG-06

#[test]
fn fr_tag_06_ac2_tag_page_query_rows() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let rows = core.tag_objects("účty");
    let got: Vec<(String, String, String, Vec<String>, Option<String>, Option<String>, Option<String>, Option<String>)> =
        rows.iter().map(|r| (r.path.clone(), r.title.clone(), r.r#type.clone(), r.tags.clone(), r.review.clone(), r.status.clone(), r.due.clone(), r.modified.clone())).collect();
    let s = |v: &str| Some(v.to_string());
    assert_eq!(
        got,
        vec![
            (DEN.into(), "2026-10-20".into(), "daily-note".into(), vec![], None, None, None, s(&at("2026-10-20T21:00"))),
            (DVAKRAT.into(), "Dvakrát".into(), "page".into(), vec!["účty/archiv".into()], None, None, None, s(&at("2026-10-15T12:00"))),
            (ROZPOCET.into(), "Rozpočet".into(), "page".into(), vec!["finance".into()], None, None, None, s(&at("2026-10-21T09:00"))),
            (FAKTURA.into(), "Faktura".into(), "quick-note".into(), vec![], s("unreviewed"), None, None, s(&at("2026-10-22T08:00"))),
            (NAJEM.into(), "Zaplatit nájem".into(), "task".into(), vec![], None, s("Done"), None, s(&at("2026-10-20T18:00"))),
            (BANKA.into(), "Zavolat bance".into(), "task".into(), vec![], None, s("To do"), s("2026-10-21"), s(&at("2026-10-12T08:00"))),
        ],
        "§1.3 rows in path order with the D-601 fields"
    );
    assert_eq!(rows.iter().find(|r| r.path == NAJEM).and_then(|r| r.completed.clone()), s("2026-10-20T18:00:00+02:00"), "completed");
}

#[test]
fn fr_tag_06_ac9_live_rows_and_unknown_keys() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = open(&root, &sb.dirs, true);
    assert_eq!(core.tag_objects("neexistuje"), vec![], "an unknown key gives no rows (D-720)");
    write(&root, &vypln(5), &format!("{}#účty\n", fixture(&vypln(5))));
    assert!(wait_until(Duration::from_secs(2), || obj_paths(&core, "účty").contains(&vypln(5))).is_some(), "an object gaining #účty appears within 2 s");
    write(&root, FAKTURA, &fixture(FAKTURA).replace(&"Poslat #účty dnes.".chars().flat_map(|c| match c { 'ú' => vec!['u', '\u{301}'], 'č' => vec!['c', '\u{30C}'], c => vec![c] }).collect::<String>(), "Poslat dnes."));
    assert!(wait_until(Duration::from_secs(2), || !obj_paths(&core, "účty").contains(&FAKTURA.to_string())).is_some(), "an object losing it leaves within 2 s");
    assert_eq!(obj_paths(&core, "účty").len(), 6, "Výplň 05 in, Faktura out");
}

// ------------------------------------------------------------------------------------------------ FR-TAG-07

#[test]
fn fr_tag_07_ac4_sidebar_ordering_by_last_used() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = open(&root, &sb.dirs, true);
    let five = |c: &Core| last_used_order(&c.tag_rows());
    let s = |n: &str, c: usize| (n.to_string(), c);
    assert_eq!(five(&core), vec![s("Účty", 6), s("finance", 2), s("dvojí", 1), s("a/b", 1), s("účty/archiv", 1)], "R83's five; prázdný and cizí never");
    write(&root, &vypln(3), &swap(&swap(&fixture(&vypln(3)), "title: Výplň 03\n", "title: Výplň 03\ntags: [čtení]\n"), "modified: 2026-09-01T09:00:00+02:00", "modified: 2026-10-22T09:00:00+02:00"));
    assert!(wait_until(Duration::from_secs(2), || five(&core).first() == Some(&s("čtení", 3))).is_some(), "#čtení 3 first within 2 s");
}

#[test]
fn fr_tag_07_ac5_counts_and_last_used_rules() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let get = |c: &Core, k: &str| row(&c.tag_rows(), k).map(|r| (r.count, r.last_used.clone()));
    assert_eq!(get(&core, "účty").map(|x| x.0), Some(6), "setup: účty 6");
    let (_, base) = core.read_note(ROZPOCET, SystemTime::now()).expect("setup: read Rozpočet");
    let moved = core.trash_object(ROZPOCET, &base);
    assert!(moved.is_ok(), "Rozpočet to the trash");
    assert_eq!(get(&core, "účty").map(|x| x.0), Some(5), "účty 5");
    assert_eq!(get(&core, "finance"), Some((1, Some(at("2026-10-19T12:00")))), "finance 1, Last used Web's");
    assert!(core.trash_restore(&format!(".trash/{ROZPOCET}")).is_ok(), "restore");
    assert_eq!((get(&core, "účty").map(|x| x.0), get(&core, "finance").map(|x| x.0)), (Some(6), Some(2)), "both back");
    let (_, b) = core.read_note(BANKA, SystemTime::now()).expect("setup: read Banka");
    let done = fixture(BANKA).replace("status: To do", "status: Done");
    assert!(core.write_note(BANKA, done.as_bytes(), Some(&b)).is_ok(), "Banka Done");
    assert_eq!(get(&core, "účty").map(|x| x.0), Some(6), "Done keeps účty 6 (D-701)");
    let no_mod = fixture(&vypln(4)).replace("modified: 2026-09-01T09:00:00+02:00\n", "").replace("title: Výplň 04\n", "title: Výplň 04\ntags: [finance]\n");
    let (_, b4) = core.read_note(&vypln(4), SystemTime::now()).expect("setup: read Výplň 04");
    assert!(core.write_note(&vypln(4), no_mod.as_bytes(), Some(&b4)).is_ok(), "Výplň 04 with finance and no modified");
    assert_eq!(get(&core, "finance"), Some((3, Some(at("2026-10-21T09:00")))), "it counts and doesn't change Last used (D-721)");
}

// ------------------------------------------------------------------------------------------------ FR-TAG-08 AC-3

#[test]
fn fr_tag_08_ac3_delete_only_the_tag_is_one_trash_move() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let base = ucty_base(&core);
    assert!(base.is_some(), "F-účty's version from the tag row");
    let before = snapshot(&root);
    let Some(base) = base else { return };
    let moved = core.trash_object(F_UCTY, &base);
    assert!(moved.is_ok(), "object_trash of the Tag file");
    let after = snapshot(&root);
    let changed: BTreeSet<String> = after.keys().chain(before.keys()).filter(|k| before.get(*k) != after.get(*k) && !k.ends_with('/')).cloned().collect();
    assert_eq!(changed, [F_UCTY.to_string(), format!(".trash/{F_UCTY}")].into(), "one rename, nothing else");
    assert_eq!(after.get(&format!(".trash/{F_UCTY}")).map(|e| (e.bytes_hash, e.mtime_ns, e.ino)), before.get(F_UCTY).map(|e| (e.bytes_hash, e.mtime_ns, e.ino)), "bytes, mtime and inode unchanged");
    let r = row(&core.tag_rows(), "účty").map(|r| (r.count, r.name.clone(), r.color.clone(), r.file.is_none()));
    assert_eq!(r, Some((6, "účty".into(), None, true)), "účty stays with 6, virtual: display name účty, colour None");
    assert!(core.trash_restore(&format!(".trash/{F_UCTY}")).is_ok(), "Trash › Restore");
    assert_eq!(row(&core.tag_rows(), "účty").and_then(|r| r.color.clone()), Some("blue".into()), "blue again");
}

// ------------------------------------------------------------------------------------------------ FR-TAG-10, FR-SRC-02, FR-EDT-15

#[test]
fn fr_tag_10_ac1_slash_tag_is_one_tag() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let rows = core.tag_rows();
    assert_eq!(row(&rows, "a/b").map(|r| (r.count, r.file.as_ref().map(|f| f.path.clone()))), Some((1, Some(F_AB.into()))), "a/b with its file Tags/a b.md");
    assert!(row(&rows, "a").is_none() && row(&rows, "b").is_none(), "no a, no b");
    assert_eq!(obj_paths(&core, "a/b"), vec![LOMITKO.to_string()], "Lomítko");
}

#[test]
fn fr_src_02_ac11_all_selected_tags_must_match() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let mut six = obj_paths(&core, "účty");
    six.sort();
    assert_eq!(six.len(), 6, "R80's six objects of účty");
    assert_eq!(search_tags(&core, "", &["účty"]), six, "#Účty: the six (templates and .trash/ never)");
    assert_eq!(search_tags(&core, "", &["účty", "finance"]), sorted(&[ROZPOCET]), "#Účty + #finance: Rozpočet");
    assert_eq!(search_tags(&core, "", &["účty", "čtení"]), Vec::<String>::new(), "+ #čtení: nothing");
    assert_eq!(search_tags(&core, "plán", &["účty"]), sorted(&[ROZPOCET]), "plán + #Účty: Rozpočet");
}

#[test]
fn fr_edt_15_ac6_count_zero_tags_are_offered() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = open(&root, &sb.dirs, true);
    let tags = core.tags();
    assert!(tags.iter().any(|t| t.key == "prázdný" && t.spelling == "prázdný" && t.count == 0), "Core::tags offers prázdný with count 0 (§1.2)");
    assert!(tags.iter().any(|t| t.key == "účty" && t.spelling == "Účty"), "the display name, not the most frequent spelling (D-711)");
    write(&root, &vypln(6), &format!("{}#prázdný\n", fixture(&vypln(6))));
    assert!(wait_until(Duration::from_secs(2), || core.tags().iter().any(|t| t.key == "prázdný" && t.count == 1)).is_some(), "count 1 within 2 s");
}

// ------------------------------------------------------------------------------------------------ FR-FMT-07, FR-SYN-06

#[test]
fn fr_fmt_07_ac23_viewing_never_rewrites() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let before = snapshot(&root);
    let core = open(&root, &sb.dirs, true);
    let rows = core.tag_rows();
    for r in &rows {
        let _ = (core.tag_objects(&r.key), core.tag_usage(&r.key), search_tags(&core, "", &[r.key.as_str()]));
    }
    let _ = (core.list_type("tag"), core.type_get("tag"), core.duplicate_titles());
    std::thread::sleep(Duration::from_millis(300));
    drop(core);
    assert_eq!(snapshot(&root), before, "indexing tags, tag pages, All tags, type/tag and tag searches write nothing");
    assert_eq!(rows.len(), 10, "the tag query answers (R80)");
}

#[test]
fn fr_syn_06_ac32_core_actions_write_only_their_files() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let fs = CountingFs::new(LocalFs::new(&root));
    let core = match Core::open_with(fs.clone(), &sb.dirs, CoreOptions { watch: false, sync: None }) {
        Ok(c) => c,
        Err(e) => panic!("setup: open_with: {e:?}"),
    };
    assert!(core.wait_idle(Duration::from_secs(60)), "setup: idle");
    let w0 = fs.write_count();
    assert!(core.create_exact("Tags/Účetnictví.md", tag_file("Účetnictví", None).as_bytes()).is_ok(), "New tag");
    let w1 = fs.write_count();
    let base = ucty_base(&core);
    assert!(base.is_some(), "F-účty's version");
    let green = swap(&fixture(F_UCTY), "color: blue", "color: green");
    let _ = core.write_note(F_UCTY, green.as_bytes(), base.as_ref());
    let w2 = fs.write_count();
    let b2 = ucty_base(&core);
    if let Some(b2) = b2 {
        let _ = core.trash_object(F_UCTY, &b2);
    }
    let w3 = fs.write_count();
    assert_eq!(row(&core.tag_rows(), "účetnictví").map(|r| r.count), Some(0), "the new tag exists");
    assert!(w1 - w0 >= 1 && w2 - w1 >= 1 && w3 - w2 >= 1, "each action wrote ({}, {}, {})", w1 - w0, w2 - w1, w3 - w2);
    assert_eq!(tag_files_on_disk(&root), vec!["Tags/Dvojí (2).md", "Tags/a b.md", "Tags/dvojí.md", "Tags/neznámá.md", "Tags/prázdný.md", "Tags/Účetnictví.md"].into_iter().map(String::from).collect::<Vec<_>>().into_iter().collect::<BTreeSet<_>>().into_iter().collect::<Vec<_>>(), "New tag: one file; Delete only the tag: F-účty moved");
}
