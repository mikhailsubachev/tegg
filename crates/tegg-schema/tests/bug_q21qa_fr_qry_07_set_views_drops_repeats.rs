//! QA review of slice Q2.1: `TypeOp::SetViews` with a name listed twice made the later copy a clone of the first item
//! (its own `sort` and `columns` copied). Contract v1-views §14.2: a kept name takes the first existing item with its
//! name key, later repeats go. FR-QRY-07 AC-25 (d): a type file listing `Přečtené 2026` twice with different settings;
//! Remove of `Výborné knihy` sends the names the tabs had (the repeat included, or not): the result keeps one
//! `Přečtené 2026` item, the first, byte for byte.

use std::path::PathBuf;

use tegg_schema::{patch, PatchContext, TypeNames, TypeOp};

fn overlay() -> String {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/vaults/views-usage/.tegg/types/book.yml");
    std::fs::read_to_string(p).expect("setup: read the overlay's book.yml")
}

fn set_views(text: &str, names: &[&str]) -> Option<String> {
    let others = [TypeNames { key: "book", name: "Book", folder: "Books", is_self: true }];
    patch("book", text, &[TypeOp::SetViews(names.iter().map(|s| s.to_string()).collect())], &PatchContext { others: &others }).expect("SetViews applies")
}

#[test]
fn bug_q21qa_fr_qry_07_set_views_drops_later_repeats() {
    let base = overlay();
    // AC-25 (d)'s file: `přečtené 2026` listed again after `Výborné knihy`, with its own columns.
    let dup = base.replacen("  - Výborné knihy\n", "  - Výborné knihy\n  - name: přečtené 2026\n    columns: [author]\n", 1);
    assert_ne!(dup, base, "setup: the repeat is in the file");
    let want = base.replacen("  - Výborné knihy\n", "", 1);
    for names in [&["Rozečtené", "Přečtené 2026", "přečtené 2026"][..], &["Rozečtené", "Přečtené 2026", "Přečtené 2026"][..], &["Rozečtené", "Přečtené 2026"][..]] {
        assert_eq!(set_views(&dup, names).as_deref(), Some(want.as_str()), "Remove of Výborné knihy with {names:?}: one Přečtené 2026 item, the first, its lines kept");
    }
    // A new name listed twice is written once.
    let added = set_views(&base, &["Rozečtené", "Přečtené 2026", "Výborné knihy", "Nová", "nová"]).expect("a write");
    assert_eq!(added.matches("  - Nová\n").count() + added.matches("  - nová\n").count(), 1, "one new item:\n{added}");
}
