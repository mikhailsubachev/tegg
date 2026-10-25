//! Slice MM, L4 at the core (docs/acceptance/mindmap.md; D-682, D-92): FR-MMP-02 AC-21 (node text is note text:
//! Search finds `Přehled Q4` in Výjezd 2026 and `cestovani` (folded) as text or tag filter in Uzly; the switcher matches
//! titles only), FR-LNK-01 AC-27 (Lisabon's backlinks are exactly Výjezd 2026 and Uzly, never Stará mapa in `.trash/` or
//! the template; a runtime NFD note adds a third within 2 s; the Broken links page lists Uzly's `[[Neexistuje]]` with
//! the excerpt `Neexistuje`; the same after an index rebuild, AR-01), FR-MMP-04 AC-1 (the bytes part: the Projekt
//! type's template is Šablona's bytes exactly, a Projekt created with them keeps them, and the template is never in
//! Search, backlinks or the switcher, FR-TPL-07). On a temporary copy of tests/fixtures/vaults/mindmap plus
//! new-empty/.tegg. No extractor change is expected (links and tags in callouts are ordinary). Written from the ACs and
//! the contracts only (D-61).

mod common;

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono_tz::Tz;
use common::*;
use tegg_core::{Core, CoreOptions, SearchQuery};
use tegg_format::excerpt::RSeg;
use tegg_format::nfc;

macro_rules! ok {
    ($e:expr, $what:expr) => {
        match $e {
            Ok(v) => v,
            Err(e) => {
                assert!(false, "{} failed: {:?}", $what, e);
                unreachable!()
            }
        }
    };
}

const PRAGUE: Tz = chrono_tz::Europe::Prague;
const LISABON: &str = "Pages/Lisabon.md";
const VYJEZD: &str = "Pages/Výjezd 2026.md";
const UZLY: &str = "Pages/Uzly.md";
const SABLONA: &str = "_templates/Projekt/Projekt.md";

fn copy_dir(from: &Path, to: &Path, skip: &[&str]) {
    std::fs::create_dir_all(to).expect("setup: dir");
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
fn mindmap_vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Mapy");
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fx.join("mindmap"), &root, &["README.md"]);
    copy_dir(&fx.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    root
}
fn open_dirs(root: &Path, dirs: &tegg_vault::AppDirs, watch: bool) -> Core {
    let core = ok!(Core::open(root, dirs, CoreOptions { watch, sync: None }), "Core::open");
    assert!(core.wait_idle(Duration::from_secs(60)), "indexing did not become idle within 60 s");
    core
}
fn search(core: &Core, q: &SearchQuery) -> BTreeSet<String> {
    ok!(core.search(q), format!("search {:?}", q.text)).results.iter().map(|r| nfc(&r.path)).collect()
}
fn backlink_sources(core: &Core, path: &str) -> Vec<String> {
    let mut v: Vec<String> = core.backlinks(path).iter().map(|p| nfc(p)).collect();
    v.sort();
    v
}

// ------------------------------------------------------------------------------------------------ FR-MMP-02 AC-21

#[test]
fn fr_mmp_02_ac21_node_text_is_searchable_and_the_switcher_matches_titles_only() {
    let sb = sandbox();
    let root = mindmap_vault(&sb);
    let core = open_dirs(&root, &sb.dirs, false);
    assert!(search(&core, &SearchQuery::text("Přehled Q4", PRAGUE)).contains(VYJEZD), "Search for Přehled Q4 lists Výjezd 2026");
    assert!(search(&core, &SearchQuery::text("cestovani", PRAGUE)).contains(UZLY), "cestovani (folded) as text finds Uzly");
    let mut tagged = SearchQuery::text("", PRAGUE);
    tagged.tags = vec!["cestovani".to_string()];
    let with_tag = search(&core, &tagged);
    let mut tagged2 = SearchQuery::text("", PRAGUE);
    tagged2.tags = vec!["cestování".to_string()];
    assert!(with_tag.contains(UZLY) || search(&core, &tagged2).contains(UZLY), "the tag filter finds Uzly");
    let sw: Vec<String> = core.switcher("Přehled Q4", 20).iter().filter_map(|i| i.path.clone()).map(|p| nfc(&p)).collect();
    assert!(!sw.contains(&VYJEZD.to_string()), "the switcher doesn't match node text: {sw:?}");
    assert!(!search(&core, &SearchQuery::text("Přehled Q4", PRAGUE)).iter().any(|p| p.starts_with(".trash/") || p.starts_with("_templates/")), "no trashed or template note");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-01 AC-27

#[test]
fn fr_lnk_01_ac27_node_links_are_backlinks() {
    let sb = sandbox();
    let root = mindmap_vault(&sb);
    let core = open_dirs(&root, &sb.dirs, true);
    assert_eq!(backlink_sources(&core, LISABON), vec![UZLY.to_string(), VYJEZD.to_string()], "exactly Výjezd 2026 and Uzly");
    let panel = core.backlinks_panel(LISABON);
    assert_eq!(panel.objects, 2, "Pages, 2");
    assert_eq!(panel.groups.iter().map(|g| (g.type_key.clone(), g.entries.len())).collect::<Vec<_>>(), vec![("page".to_string(), 2)], "one group Pages with 2 entries, each once");
    // `Lisabon` has no diacritics, so its NFD bytes equal its NFC bytes; the note's title carries NFD (see the next
    // test for a target whose NFD form differs).
    let nfd_text = "---\nid: 01JB4M0000000000000000M030\ntype: page\ntitle: NFD odkaz s ha\u{301}c\u{30C}ky\n---\n> [!mindmap]\n> - [[Lisabon]]\n";
    write_raw(&root, "Pages/NFD odkaz.md", nfd_text.as_bytes());
    let third = wait_until(Duration::from_secs(2), || core.backlinks(LISABON).len() == 3);
    assert!(third.is_some(), "a runtime note with [[Lisabon]] in a mindmap adds a third backlink within 2 s");
}

#[test]
fn fr_lnk_01_ac27_nfd_target_in_a_node_is_a_backlink() {
    let sb = sandbox();
    let root = mindmap_vault(&sb);
    // The target in NFD bytes: rename Lisabon to a title with diacritics first (Lisabón), then link it in NFD.
    let lis = std::fs::read_to_string(root.join(LISABON)).expect("setup");
    std::fs::remove_file(root.join(LISABON)).expect("setup");
    write_raw(&root, "Pages/Lisabón.md", lis.replace("title: Lisabon", "title: Lisabón").as_bytes());
    write_raw(&root, "Pages/NFD odkaz.md", "---\nid: 01JB4M0000000000000000M031\ntype: page\ntitle: NFD odkaz\n---\n> [!mindmap]\n> - [[Lisabo\u{301}n]]\n".as_bytes());
    let core = open_dirs(&root, &sb.dirs, false);
    assert!(backlink_sources(&core, "Pages/Lisabón.md").contains(&"Pages/NFD odkaz.md".to_string()), "an NFD link in a node resolves (FR-FMT-12)");
}

#[test]
fn fr_lnk_01_ac27_broken_node_link_excerpt_and_rebuild() {
    let sb = sandbox();
    let root = mindmap_vault(&sb);
    let core = open_dirs(&root, &sb.dirs, false);
    let broken = core.broken_links();
    let g = broken.groups.iter().find(|g| g.key == "neexistuje");
    assert!(g.is_some(), "the Broken links page lists Neexistuje: {:?}", broken.groups.iter().map(|g| &g.key).collect::<Vec<_>>());
    let g = g.unwrap();
    assert_eq!(g.sources.iter().map(|s| nfc(&s.source)).collect::<Vec<_>>(), vec![UZLY.to_string()], "from Uzly");
    let ex: Vec<String> = g.sources[0].occurrences.iter().map(|o| nfc(&o.excerpt.segments.iter().map(|s| match s { RSeg::Text { text, .. } | RSeg::Link { text, .. } => text.as_str() }).collect::<String>())).collect();
    assert_eq!(ex, vec!["Neexistuje".to_string()], "the excerpt is the item's own text (D-277): no >, - or child items");
    let first = format!("{:?}", core.backlinks_panel(LISABON));
    let first_broken = format!("{:?}", core.broken_links());
    drop(core);
    let core = open_dirs(&root, &fresh_dirs(&sb, "Rebuilt"), false);
    assert_eq!(format!("{:?}", core.backlinks_panel(LISABON)), first, "the panel query is the same after a rebuild (AR-01)");
    assert_eq!(format!("{:?}", core.broken_links()), first_broken, "and the Broken links page");
}

// ------------------------------------------------------------------------------------------------ FR-MMP-04 AC-1

#[test]
fn fr_mmp_04_ac1_template_bytes_are_copied_verbatim() {
    let sb = sandbox();
    let root = mindmap_vault(&sb);
    let core = open_dirs(&root, &sb.dirs, false);
    let sablona = std::fs::read(root.join(SABLONA)).expect("setup");
    let t = ok!(core.type_template("projekt"), "type_template(projekt)");
    let (path, bytes) = t.expect("the Projekt type has a default template");
    assert_eq!(nfc(&path), SABLONA, "the template path");
    assert_eq!(bytes, sablona, "the template's bytes");
    assert_eq!(String::from_utf8_lossy(&bytes), "> [!mindmap] Cíle projektu\n> - Cíle projektu\n>   - Proč\n>   - Co\n>   - Kdy\n", "Šablona");
    let head = "---\nid: 01JB4M0000000000000000M040\ntype: projekt\ntitle: Nový projekt\ncreated: 2026-10-22T10:00:00+02:00\nmodified: 2026-10-22T10:00:00+02:00\n---\n";
    let mut text = head.as_bytes().to_vec();
    text.extend_from_slice(&bytes);
    let made = ok!(core.create_object("projekt", "Nový projekt", &text), "create_object");
    assert_eq!(nfc(&made), "Projekty/Nový projekt.md", "in the type folder");
    let written = std::fs::read(root.join("Projekty/Nový projekt.md")).expect("the new file");
    assert_eq!(&written[head.len()..], &sablona[..], "the body equals Šablona's bytes exactly");
    assert_eq!(std::fs::read(root.join(SABLONA)).expect("template"), sablona, "Šablona untouched");
    assert!(!search(&core, &SearchQuery::text("Cíle projektu", PRAGUE)).contains(SABLONA), "the template is never in Search (FR-TPL-07)");
    assert!(!core.switcher("Projekt", 20).iter().filter_map(|i| i.path.clone()).any(|p| nfc(&p) == SABLONA), "nor in the switcher");
}
