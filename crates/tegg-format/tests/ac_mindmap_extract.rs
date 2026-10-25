//! Slice MM, L4: FR-MMP-02 AC-21, extraction part (docs/acceptance/mindmap.md; D-682; contract docs/contracts/
//! ms4-links.md §2.1): `extract()` of Výjezd lists the link `Lisabon` with `block` pointing at a `ListItem` excerpt block
//! holding only that link (the item's own text: no `>`, `-` or child items, D-277), and Uzly's node links and tag are
//! ordinary links and tags. No extractor change is expected for mindmaps. Written from the AC and the contract only.

use std::path::PathBuf;

use tegg_format::excerpt::{BlockKind, Segment};
use tegg_format::*;

fn fx(rel: &str) -> Vec<u8> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/vaults/mindmap");
    std::fs::read(root.join(rel)).expect("setup: fixture")
}

#[test]
fn fr_mmp_02_ac21_extract_lists_node_links_with_list_item_blocks() {
    let x = extract(&fx("Pages/Výjezd 2026.md"), "Výjezd 2026");
    let targets: Vec<&str> = x.links.iter().map(|l| l.target.as_str()).collect();
    assert_eq!(targets, vec!["Lisabon"], "one link");
    let b = x.links[0].block.expect("the link has an excerpt block") as usize;
    assert_eq!(x.blocks[b].kind, BlockKind::ListItem, "a listItem excerpt block");
    assert_eq!(x.blocks[b].segments, vec![Segment::Link { link: 0, marks: vec![] }], "only the link: no `>`, `-` or children");
    let u = extract(&fx("Pages/Uzly.md"), "Uzly");
    let mut ut: Vec<(String, bool)> = u.links.iter().map(|l| (nfc(&l.target), l.embed)).collect();
    ut.sort();
    let mut want = vec![
        ("2026-10-20".to_string(), false), ("Lisabon".to_string(), false), ("Neexistuje".to_string(), false),
        ("Zalít květiny".to_string(), true), ("fotka.png".to_string(), true),
    ];
    want.sort();
    assert_eq!(ut, want, "Uzly's node links");
    assert_eq!(u.tags, vec!["cestování".to_string()], "the node tag");
    let n = u.links.iter().position(|l| l.target == "Neexistuje").expect("Neexistuje");
    let nb = u.links[n].block.expect("block") as usize;
    assert_eq!(u.blocks[nb].kind, BlockKind::ListItem);
    assert_eq!(u.blocks[nb].segments, vec![Segment::Link { link: n as u32, marks: vec![] }], "Neexistuje's block is the item's own text");
}
